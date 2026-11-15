"""Texturas HD del terreno (public/textures/) a partir de datos reales de NASA/USGS.

  albedo_hd.jpg  4096x4096 (1,5 m/px), gris: ortoimagenes HiRISE (MRO, 1 m/px, las de los 3 DTM del recorte)
                 igualadas en brillo y contraste a la ortoimagen CTX, que rellena donde HiRISE no cubre.
  normal_hd.jpg  2048x2048 (3 m/px): normales en espacio de mundo (x Este, y arriba, z Sur) del DEM
                 HiRISE (1 m leido a 3 m) fundido sobre el DEM del juego (CTX + HiRISE a 6 m).
  ao.png         2048x2048: fraccion aproximada de cielo visible (oclusion ambiental) del mismo DEM.

Convencion de imagen igual que region.json: fila 0 = borde norte, columna 0 = borde oeste.

Uso:
  python3 -m pip install numpy rasterio pillow
  python3 data/scripts/fetch_nasa.py          # si falta data/raw/ (DTM y ortoimagen CTX)
  python3 data/scripts/build_textures.py      # descarga solo la ventana de las ortoimagenes HiRISE (~30 MB)
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from region import ROOT, Region  # noqa: E402

RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "textures"
N_ALB, N_NRM = 4096, 2048
STAC = "https://stac.astrogeology.usgs.gov/api/collections/mro_hirise_socet_dtms/items/{item}"
# (item del DTM, ortoimagen RED a 1 m/px de ese par estereo)
ORTHOS = [
    ("DTEEC_009149_1750_009294_1750_U01", "PSP_009149_1750_RED_C_01_ORTHO"),
    ("DTEEC_019698_1750_019988_1750_U01", "ESP_019698_1750_RED_C_01_ORTHO"),
    ("DTEEC_009650_1755_009716_1755_U01", "PSP_009650_1755_RED_C_01_ORTHO"),
]
DTMS = ["hirise_dtm_009149.tif", "hirise_dtm_019698.tif", "hirise_dtm_009650.tif"]


def to_grid(path: Path, region: Region, n: int, categorical=False) -> np.ndarray:
    """Reproyecta un GeoTIFF a la cuadricula del recorte con n x n pixeles (NaN donde no hay dato)."""
    import rasterio
    from rasterio.transform import from_origin
    from rasterio.warp import Resampling, reproject
    crs = (f"+proj=eqc +lat_ts={region.lat0} +lat_0={region.lat0} +lon_0={region.lon0} "
           f"+x_0=0 +y_0=0 +R={region.R} +units=m +no_defs")
    h, px = region.size / 2, region.size / n
    dst = np.full((n, n), np.nan, dtype=np.float32)
    with rasterio.open(path) as src:
        rs = Resampling.average if abs(src.transform.a) < px else Resampling.bilinear
        reproject(source=rasterio.band(src, 1), destination=dst, src_nodata=src.nodata, dst_nodata=np.nan,
                  dst_transform=from_origin(-h, h, px, px), dst_crs=crs, resampling=rs)
    dst[(dst < -1e30) | (dst > 1e30)] = np.nan
    return dst


def resize(a: np.ndarray, n: int) -> np.ndarray:
    return np.asarray(Image.fromarray(a.astype(np.float32), "F").resize((n, n), Image.BILINEAR), dtype=np.float32)


def _box(a: np.ndarray, r: int, axis: int) -> np.ndarray:
    pad = [(0, 0), (0, 0)]
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis, dtype=np.float64)
    hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
    lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def blur(a: np.ndarray, r: float) -> np.ndarray:
    """Aproximacion gaussiana: tres pasadas de caja separables (sigma ~ r)."""
    k = max(1, int(round(r * 0.58)))
    out = a.astype(np.float32)
    for _ in range(3):
        out = _box(_box(out, k, 0), k, 1)
    return out


def feather(valid: np.ndarray, r: float) -> np.ndarray:
    """Peso 0..1 que baja suavemente hacia el borde de la zona con dato."""
    w = blur(valid.astype(np.float32), r)
    return np.clip((w - 0.5) * 2.0, 0, 1) * valid


def fetch_orthos(region: Region, log: dict):
    from fetch_nasa import fetch_window, get_json
    for item, name in ORTHOS:
        out = RAW / f"hirise_ortho_{name}.tif"
        if out.exists():
            continue
        assets = get_json(STAC.format(item=item))["assets"]
        href = next(a["href"] for a in assets.values() if a["href"].endswith(name + ".tif"))
        print("descargando ventana de", name)
        log[name] = fetch_window(href, out, region, region.size / N_ALB) | {"href": href}


def main():
    region = Region.load()
    OUT.mkdir(parents=True, exist_ok=True)
    log = {}
    fetch_orthos(region, log)

    # ---- albedo: CTX de base + HiRISE igualada a CTX y fundida con borde suave --------------
    ctx = to_grid(RAW / "ctx_ortho.tif", region, N_ALB)
    if np.isnan(ctx).any():
        ctx = np.where(np.isnan(ctx), np.nanmedian(ctx), ctx)
    alb, cover = ctx.copy(), np.zeros_like(ctx)
    for _, name in ORTHOS:
        o = to_grid(RAW / f"hirise_ortho_{name}.tif", region, N_ALB)
        valid = ~np.isnan(o) & (o > 0)               # las sombras muy oscuras tambien son dato valido
        valid &= blur(valid.astype(np.float32), 4) > 0.98      # quitar el borde (pixeles a medias del remuestreo)
        if valid.mean() < 0.01:
            continue
        # igualar media y desviacion a CTX en la zona comun (cada imagen tiene otra iluminacion)
        o = (o - o[valid].mean()) / (o[valid].std() + 1e-6) * ctx[valid].std() + ctx[valid].mean()
        w = feather(valid, 24) * (1 - cover)
        alb = np.where(valid, alb * (1 - w) + np.nan_to_num(o) * w, alb)
        cover = np.maximum(cover, w)
        log.setdefault("coverage", {})[name] = round(float(valid.mean()), 3)
    lo, hi = np.percentile(alb, [0.5, 99.5])
    g = np.clip((alb - lo) / (hi - lo), 0, 1)
    Image.fromarray((g * 255).astype(np.uint8), "L").save(OUT / "albedo_hd.jpg", quality=88, optimize=True)
    log["hirise_fraction"] = round(float((cover > 0.5).mean()), 3)

    # ---- DEM a 3 m: el del juego (6 m) con el detalle de HiRISE encima ------------------------
    L = json.loads((ROOT / "public/layers/layers.json").read_text())["layers"]["dem"]["decode"]
    raw = np.frombuffer((ROOT / "public/layers/dem.bin").read_bytes(), dtype="<u2").reshape(region.n, region.n)
    base = resize(L["min"] + raw.astype(np.float32) / 65535 * (L["max"] - L["min"]), N_NRM)
    dem = base.copy()
    for f in DTMS:
        h = to_grid(RAW / f, region, N_NRM)
        valid = ~np.isnan(h)
        if valid.mean() < 0.01:
            continue
        off = np.median(h[valid] - base[valid])                 # mismo datum que el DEM del juego
        h = h - off
        # solo se toma el detalle fino de HiRISE (alta frecuencia); la forma grande es la del juego
        detail = np.nan_to_num(h) - blur(np.where(valid, h, base), 6)
        w = feather(valid, 12)
        dem = dem + detail * w
    px = region.size / N_NRM
    gz, gx = np.gradient(dem, px)                               # fila = Sur (+z), columna = Este (+x)
    nrm = np.stack([-gx, np.ones_like(dem), -gz], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    Image.fromarray(((nrm * 0.5 + 0.5) * 255).astype(np.uint8), "RGB").save(OUT / "normal_hd.jpg", quality=90, optimize=True)

    # ---- oclusion ambiental aproximada: cuanto mas hundido respecto al entorno, menos cielo -------
    ao = np.ones_like(dem)
    for r, k in ((3, 0.06), (10, 0.025), (30, 0.01)):
        ao -= k * np.clip(blur(dem, r) - dem, 0, None)
    ao = np.clip(ao, 0, 1)
    Image.fromarray((ao * 255).astype(np.uint8), "L").save(OUT / "ao.png", optimize=True)

    for f in ("albedo_hd.jpg", "normal_hd.jpg", "ao.png"):
        print(f, (OUT / f).stat().st_size // 1024, "KB")
    (ROOT / "data/processed/textures_report.json").write_text(json.dumps(log, indent=1))
    print(json.dumps({k: v for k, v in log.items() if k != "href"}, indent=1)[:800])


if __name__ == "__main__":
    main()
