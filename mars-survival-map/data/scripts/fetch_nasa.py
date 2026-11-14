"""Descarga SOLO el recorte de los productos NASA/USGS (Miembro 3).

Lee GeoTIFF optimizados para la nube (COG) del bucket publico de USGS Astrogeology
(Analysis Ready Data, catalogo STAC https://stac.astrogeology.usgs.gov) pidiendo
unicamente la ventana del recorte, y la guarda en data/raw/ con su georreferencia
original. Tambien guarda la traza de Curiosity (JPL MMGIS).

Uso:  python3 data/scripts/fetch_nasa.py
Requiere: rasterio (python3 -m pip install rasterio)
"""
import json
import time
import urllib.request
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform_bounds
from rasterio.windows import Window, from_bounds

from region import ROOT, Region

RAW = ROOT / "data" / "raw"
STAC = "https://stac.astrogeology.usgs.gov/api/collections/{col}/items/{item}"
TRAVERSE_URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json"
GEO = "+proj=longlat +R=3396190 +no_defs"
MARGIN_M = 300  # margen alrededor del recorte para reproyectar sin bordes

# (coleccion STAC, item, asset, nombre local, resolucion objetivo en m)
PRODUCTS = [
    ("mro_ctx_controlled_usgs_dtms", "T01_000815_1749_XN_05S222W__P21_009149_1752_XI_04S222W",
     "geoid_adjusted_dem", "ctx_dem.tif", None),
    ("mro_ctx_controlled_usgs_dtms", "T01_000815_1749_XN_05S222W__P21_009149_1752_XI_04S222W",
     "orthoimage", "ctx_ortho.tif", 3.0),
    ("mro_hirise_socet_dtms", "DTEEC_009149_1750_009294_1750_U01", "dtm", "hirise_dtm_009149.tif", 3.0),
    ("mro_hirise_socet_dtms", "DTEEC_019698_1750_019988_1750_U01", "dtm", "hirise_dtm_019698.tif", 3.0),
    ("mro_hirise_socet_dtms", "DTEEC_009650_1755_009716_1755_U01", "dtm", "hirise_dtm_009650.tif", 3.0),
]

GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="2")


def get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "mars-survival-map/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_window(href: str, out: Path, region: Region, target_res: float | None) -> dict:
    m_lat = MARGIN_M / region.m_per_deg_lat
    m_lon = MARGIN_M / region.m_per_deg_lon
    crop = (region.west - m_lon, region.south - m_lat, region.east + m_lon, region.north + m_lat)
    with rasterio.Env(**GDAL_ENV), rasterio.open("/vsicurl/" + href) as src:
        b = transform_bounds(GEO, src.crs, *crop)
        win = from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
        full = Window(0, 0, src.width, src.height)
        win = win.intersection(full)
        scale = 1.0 if not target_res else max(1.0, target_res / src.res[0])
        h, w = max(1, int(win.height / scale)), max(1, int(win.width / scale))
        data = src.read(1, window=win, out_shape=(h, w), masked=True)
        nodata = src.nodata if src.nodata is not None else (-3.4028227e38 if data.dtype.kind == "f" else 0)
        arr = data.filled(nodata)
        tr = src.window_transform(win) * rasterio.Affine.scale(win.width / w, win.height / h)
        profile = dict(driver="GTiff", height=h, width=w, count=1, dtype=arr.dtype, crs=src.crs,
                       transform=tr, nodata=nodata, compress="deflate", tiled=True)
        with rasterio.open(out, "w", **profile) as dst:
            dst.write(arr, 1)
        valid = float(1 - np.ma.getmaskarray(data).mean())
        return {"native_res_m": round(src.res[0], 3), "saved_res_m": round(abs(tr.a), 3),
                "shape": [h, w], "valid_fraction": round(valid, 3), "bytes": out.stat().st_size}


def main():
    region = Region.load()
    RAW.mkdir(parents=True, exist_ok=True)
    manifest = {"accessed_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "region": region.cfg["center"] | {"size_m": region.size}, "products": []}

    print("Traza de Curiosity (JPL MMGIS)...")
    req = urllib.request.Request(TRAVERSE_URL, headers={"User-Agent": "mars-survival-map/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        (RAW / "MSL_waypoints.json").write_bytes(r.read())
    manifest["products"].append({"file": "MSL_waypoints.json", "source": TRAVERSE_URL,
                                 "description": "Posiciones de Curiosity por sol (lat, lon, elevacion sobre el geoide)."})

    items = {}
    for col, item, asset, name, res in PRODUCTS:
        key = (col, item)
        if key not in items:
            items[key] = get_json(STAC.format(col=col, item=item))
        it = items[key]
        href = it["assets"][asset]["href"]
        print(f"{name}: {item} [{asset}]")
        info = fetch_window(href, RAW / name, region, res)
        print(f"   -> {info['shape']} px @ {info['saved_res_m']} m, cobertura {info['valid_fraction']:.0%}, "
              f"{info['bytes'] / 1e6:.1f} MB")
        manifest["products"].append({
            "file": name, "collection": col, "item": item, "asset": asset, "href": href,
            "stac": STAC.format(col=col, item=item),
            "item_datetime": it["properties"].get("datetime"), **info})

    (RAW / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    total = sum(p.get("bytes", 0) for p in manifest["products"])
    print(f"OK: {total / 1e6:.1f} MB en {RAW}")


if __name__ == "__main__":
    main()
