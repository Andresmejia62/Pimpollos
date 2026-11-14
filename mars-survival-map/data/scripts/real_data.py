"""Entradas REALES (NASA/USGS) para el pipeline de capas (Miembro 3).

Lee lo que descargo fetch_nasa.py en data/raw/ y lo lleva a la cuadricula del recorte:
  - DEM: DTM CTX (20 m, cobertura total) como base + DTM HiRISE (1 m, leido a 3 m)
    donde haya cobertura, alineados verticalmente a CTX y fundidos con borde suave.
  - Optico: ortoimagen CTX.
  - Inercia termica: APROXIMADA desde el albedo de la ortoimagen (pendiente: THEMIS).
  - Clases minerales: estratigrafia confirmada por Curiosity en su traza
    (pendiente: indices CRISM).
Ademas valida el DEM contra las elevaciones que registro Curiosity en cada parada.
"""
import json
from pathlib import Path

import numpy as np

from layers_lib import smooth

HIRISE_FILES = ["hirise_dtm_009149.tif", "hirise_dtm_019698.tif", "hirise_dtm_009650.tif"]

# Limites de unidades segun la traza de Curiosity (elevacion sobre el geoide, m).
# Glen Torridon (unidad rica en arcillas): sols ~2300-3000, -4150 a -4080 m.
# Unidad de sulfatos: desde ~sol 3000 (-4080 m) hacia arriba.
CLAY_RANGE_M = (-4165.0, -4078.0)
SULFATE_ABOVE_M = -4078.0
BOXWORK_SOLS = (4540, 4990)
BOXWORK_RADIUS_M = 450.0


def load_to_grid(path: Path, region, categorical=False, fill=True) -> np.ndarray:
    import rasterio
    from rasterio.transform import from_origin
    from rasterio.warp import Resampling, reproject
    dst_crs = (f"+proj=eqc +lat_ts={region.lat0} +lat_0={region.lat0} +lon_0={region.lon0} "
               f"+x_0=0 +y_0=0 +R={region.R} +units=m +no_defs")
    h = region.size / 2
    dst = np.full((region.n, region.n), np.nan, dtype=np.float32)
    with rasterio.open(path) as src:
        src_res = abs(src.transform.a)
        rs = Resampling.nearest if categorical else (
            Resampling.average if src_res < region.px else Resampling.bilinear)
        reproject(source=rasterio.band(src, 1), destination=dst,
                  src_nodata=src.nodata, dst_nodata=np.nan,
                  dst_transform=from_origin(-h, h, region.px, region.px), dst_crs=dst_crs,
                  resampling=rs)
    dst[(dst < -1e30) | (dst > 1e30)] = np.nan
    if fill and np.isnan(dst).any():
        dst = np.where(np.isnan(dst), np.nanmedian(dst), dst)
    return dst


def offset_vs_rover(a: np.ndarray, pts, min_points=20):
    """Desfase vertical mediano (fuente - Curiosity) en las paradas del rover."""
    n = a.shape[0]
    d = np.array([a[r, c] - e for _, r, c, e, *_ in pts if 0 <= r < n and 0 <= c < n])
    d = d[~np.isnan(d)]
    if d.size < min_points:
        return None, int(d.size), None
    med = float(np.median(d))
    return med, int(d.size), float(np.median(np.abs(d - med)))


def merge_dem(region, raw: Path, log: dict, pts) -> np.ndarray:
    """Cada fuente se alinea verticalmente a las elevaciones medidas por Curiosity
    (verdad de terreno). Luego HiRISE se funde sobre CTX con borde suave."""
    base = load_to_grid(raw / "ctx_dem.tif", region, fill=False)
    if np.isnan(base).mean() > 0.001:
        raise SystemExit("El DTM CTX no cubre todo el recorte")
    off, npts, mad = offset_vs_rover(base, pts)
    base = base - off
    log["dem_merge"] = [{"file": "ctx_dem.tif", "role": "base", "offset_removed_m": round(off, 2),
                         "rover_points": npts, "mad_vs_rover_m": round(mad, 2)}]
    dem = base.copy()
    for name in HIRISE_FILES:
        p = raw / name
        if not p.exists():
            continue
        h = load_to_grid(p, region, fill=False)
        valid = ~np.isnan(h)
        if valid.mean() < 0.02:
            continue
        # erosionar bordes (los DTM HiRISE tienen orillas ruidosas)
        core = smooth(valid.astype(np.float32), 4, passes=1) > 0.999
        off, npts, mad = offset_vs_rover(np.where(core, h, np.nan), pts)
        how = "rover"
        if off is None:  # pocos puntos del rover: alinear a la base ya corregida
            off, how = float(np.nanmedian((h - base)[core])), "ctx"
        h = h - off
        w = np.clip(smooth(core.astype(np.float32), 12, passes=2) * 1.6 - 0.6, 0, 1)
        w[~core] = 0
        dem = np.where(w > 0, dem * (1 - w) + np.nan_to_num(h) * w, dem)
        log["dem_merge"].append({"file": name, "role": "detalle", "coverage": round(float(core.mean()), 3),
                                 "aligned_to": how, "offset_removed_m": round(off, 2), "rover_points": npts,
                                 "mad_vs_rover_m": None if mad is None else round(mad, 2),
                                 "std_vs_ctx_m": round(float(np.nanstd((h - base)[core])), 2)})
    return dem.astype(np.float32)


def traverse_points(raw: Path, region):
    feats = json.loads((raw / "MSL_waypoints.json").read_text(encoding="utf-8"))["features"]
    pts = []
    for f in feats:
        p = f["properties"]
        x, z = region.latlon_to_world(p["lat"], p["lon"])
        if region.contains_world(x, z):
            r, c = region.world_to_px(x, z)
            pts.append((p["sol"], int(round(r)), int(round(c)), p["elev_geoid"], x, z))
    return pts


def paint_objectives(classes: np.ndarray, objectives, px: float) -> None:
    """El objetivo cientifico esta sobre su mineral: pinta su clase en el radio del objetivo."""
    n = classes.shape[0]
    rr, cc = np.mgrid[0:n, 0:n]
    for o in objectives:
        k = o.get("mineral_class")
        if k:
            r0, c0 = o["px"]
            classes[np.hypot(rr - r0, cc - c0) * px < 2.0 * o.get("radius_m", 15)] = k


def build_inputs(region, raw: Path, objectives=()) -> dict:
    log = {}
    n = region.n
    pts = traverse_points(raw, region)
    dem = merge_dem(region, raw, log, pts)

    ortho = load_to_grid(raw / "ctx_ortho.tif", region)
    lo, hi = np.percentile(ortho, [1, 99])
    albedo = np.clip((ortho - lo) / (hi - lo), 0, 1).astype(np.float32)

    # Validacion contra Curiosity
    d =np.array([dem[min(max(r, 0), n - 1), min(max(c, 0), n - 1)] - e for _, r, c, e, _, _ in pts])
    log["validation_vs_curiosity"] = {
        "points": len(pts),
        "median_diff_m": round(float(np.median(d)), 2),
        "mad_m": round(float(np.median(np.abs(d - np.median(d)))), 2),
        "p95_abs_diff_m": round(float(np.percentile(np.abs(d), 95)), 2),
        "_doc": "DEM menos elevacion del rover (elev_geoid) en cada parada dentro del recorte.",
    }

    # Clases minerales por estratigrafia de la traza
    classes = np.zeros((n, n), dtype=np.uint8)
    classes[(dem > CLAY_RANGE_M[0]) & (dem <= CLAY_RANGE_M[1])] = 1
    classes[dem > SULFATE_ABOVE_M] = 2
    rr, cc = np.mgrid[0:n, 0:n]
    box_zone = np.zeros((n, n), dtype=bool)
    for sol, r, c, _, _, _ in pts:
        if BOXWORK_SOLS[0] <= sol <= BOXWORK_SOLS[1]:
            box_zone |= np.hypot(rr - r, cc - c) * region.px < BOXWORK_RADIUS_M
    ridges = (dem - smooth(dem, 6)) > 0.8  # crestas locales
    classes[box_zone & ridges] = 3
    dark = albedo < np.percentile(albedo, 8)
    dunes = smooth(dark.astype(np.float32), 3) > 0.6
    classes[dunes] = 4
    paint_objectives(classes, objectives, region.px)
    log["spectral_method"] = ("Estratigrafia de la traza de Curiosity: arcillas entre "
                              f"{CLAY_RANGE_M[0]} y {CLAY_RANGE_M[1]} m, sulfatos por encima; "
                              "boxwork = crestas locales cerca de los sols 4540-4990; "
                              "dunas = zonas mas oscuras de la ortoimagen CTX. No es CRISM.")

    # Inercia termica aproximada (arena oscura = baja TI; roca clara = alta TI)
    ti = 260.0 + 260.0 * smooth(albedo, 2)
    ti = np.where(dunes, 230.0, ti).astype(np.float32)
    log["thermal_inertia_method"] = "Aproximada desde el albedo CTX (230-520 TIU). Pendiente: mosaico THEMIS."

    return {"dem": dem, "thermal_inertia": ti, "spectral": classes, "albedo": albedo,
            "optical_gray": albedo, "log": log, "traverse": pts}
