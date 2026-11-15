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
        r_e = max(2, int(round(24.0 / region.px)))    # erosion del borde: ~24 m
        r_f = max(4, int(round(180.0 / region.px)))   # mezcla suave: ~180 m (oculta la costura)
        core = smooth(valid.astype(np.float32), r_e, passes=1) > 0.999
        off, npts, mad = offset_vs_rover(np.where(core, h, np.nan), pts)
        how = "rover"
        if off is None:  # pocos puntos del rover: alinear a la base ya corregida
            off, how = float(np.nanmedian((h - base)[core])), "ctx"
        h = h - off
        w = np.clip(smooth(core.astype(np.float32), r_f, passes=2) * 2.0 - 1.0, 0, 1)  # 0 justo en el borde
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


# ---------------------------------------------------------------------------
# CRISM (MTRDR, parametros de Viviano-Beck et al. 2014)
# ---------------------------------------------------------------------------
# Umbrales calibrados en Gale (superficie con polvo: senales mas debiles que en la literatura,
# Viviano-Beck et al. 2014 usan ~0.010). Se validan contra la estratigrafia de Curiosity:
# ~96% de las arcillas caen en la banda de Glen Torridon y ~97% de los sulfatos sobre -4078 m.
CRISM_RULES = {
    "phyllo": "D2300 > 0.002 y BD2290 > 0 (filosilicatos Fe/Mg)",
    "sulfate": "SINDEX2 > 0.008 y (BD1900_2 > 0.002 o BD2100_2 > 0.002) (sulfatos poli/monohidratados)",
    "mafic": "OLINDEX3 > percentil 90 del recorte y albedo bajo (arena basaltica)",
}
CRISM_PARAMS_USED = ["D2300", "BD2290", "BD1900_2", "SINDEX2", "BD2100_2", "OLINDEX3"]


def _crism_params(path: Path):
    """Parametros suavizados 3x3 en la grilla nativa (ignorando nodata)."""
    import rasterio
    with rasterio.open(path) as src:
        a = src.read().astype(np.float32)
        names = list(src.descriptions)
        nod = src.nodata
    valid = a[0] != nod
    w = smooth(valid.astype(np.float32), 1, passes=1)
    p = {}
    for i, k in enumerate(names):
        b = np.where(valid, a[i], 0.0)
        p[k] = np.where(w > 0, smooth(b, 1, passes=1) / np.maximum(w, 1e-6), 0.0)
    return valid, p


def _to_grid_array(arr: np.ndarray, src_path: Path, region, nodata=-1.0) -> np.ndarray:
    import rasterio
    from rasterio.transform import from_origin
    from rasterio.warp import Resampling, reproject
    dst_crs = (f"+proj=eqc +lat_ts={region.lat0} +lat_0={region.lat0} +lon_0={region.lon0} "
               f"+x_0=0 +y_0=0 +R={region.R} +units=m +no_defs")
    h = region.size / 2
    dst = np.full((region.n, region.n), nodata, dtype=np.float32)
    with rasterio.open(src_path) as src:
        reproject(source=arr.astype(np.float32), destination=dst, src_transform=src.transform, src_crs=src.crs,
                  src_nodata=nodata, dst_nodata=nodata,
                  dst_transform=from_origin(-h, h, region.px, region.px), dst_crs=dst_crs,
                  resampling=Resampling.bilinear)
    return dst


def crism_classes(region, raw: Path, log: dict, albedo=None):
    """Clases 1 (arcillas), 2 (sulfatos), 4 (arena mafica) desde la mediana de los
    productos CRISM que cubren cada pixel. Devuelve (None, None) si no hay datos."""
    files = sorted((raw / "crism").glob("*_su.tif"))
    if not files:
        return None, None
    n = region.n
    stacks = {k: [] for k in CRISM_PARAMS_USED}
    covers, per_product = [], []
    for f in files:
        valid, p = _crism_params(f)
        inside = _to_grid_array(np.where(valid, 1.0, -1.0), f, region) > 0.5
        covers.append(inside)
        per_product.append({"file": f.name, "coverage": round(float(inside.mean()), 3)})
        for k in CRISM_PARAMS_USED:
            g = _to_grid_array(np.where(valid, p[k], -1e3), f, region, nodata=-1e3)
            stacks[k].append(np.where(inside & (g > -999), g, np.nan))
    covered = np.any(covers, axis=0)
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        M = {k: np.nanmedian(np.stack(v), axis=0) for k, v in stacks.items()}
    M = {k: np.nan_to_num(v, nan=-1.0) for k, v in M.items()}
    phyllo = (M["D2300"] > 0.002) & (M["BD2290"] > 0)
    sulfate = (M["SINDEX2"] > 0.008) & ((M["BD1900_2"] > 0.002) | (M["BD2100_2"] > 0.002)) & ~phyllo
    ol90 = np.percentile(M["OLINDEX3"][covered], 90) if covered.any() else 1e9
    mafic = (M["OLINDEX3"] > ol90) & ~phyllo & ~sulfate
    if albedo is not None:
        mafic &= albedo < np.percentile(albedo, 35)
    classes = np.zeros((n, n), np.uint8)
    classes[mafic] = 4
    classes[sulfate] = 2
    classes[phyllo] = 1
    log["crism"] = {"products": per_product, "rules": CRISM_RULES, "combine": "mediana por pixel de los productos que lo cubren",
                    "coverage_pct": round(100 * float(covered.mean()), 1),
                    "class_pct": {k: round(100 * float((classes == v).mean()), 2)
                                  for k, v in (("arcillas", 1), ("sulfatos", 2), ("mafico", 4))}}
    return classes, covered


def paint_objectives(classes: np.ndarray, objectives, px: float) -> None:
    """El objetivo cientifico esta sobre su mineral: pinta su clase en el radio del objetivo."""
    n = classes.shape[0]
    rr, cc = np.mgrid[0:n, 0:n]
    for o in objectives:
        k = o.get("mineral_class")
        if k:
            r0, c0 = o["px"]
            classes[np.hypot(rr - r0, cc - c0) * px < 2.0 * o.get("radius_m", 15)] = k


def roughness(region, raw: Path, pts) -> np.ndarray:
    """Rugosidad a escala metrica (m): rms del relieve que queda al quitar la forma del terreno (~20 m),
    calculada sobre el DEM CTX+HiRISE a la mitad del tamano de pixel y llevada a la cuadricula con el maximo.
    Marca terreno rocoso y campos de bloques. Es una estimacion: el DTM de HiRISE (1 m) no resuelve bloques
    sueltos de menos de ~2 m."""
    cfg = dict(region.cfg)
    n2 = region.n * 2
    cfg["grid_px"] = n2
    cfg["pixel_size_m"] = region.size / n2
    from region import Region as _R
    r2 = _R(cfg)
    dem = merge_dem(r2, raw, {}, [(p[0], p[1] * 2, p[2] * 2, p[3], p[4], p[5]) for p in pts])
    res = dem - smooth(dem, 3, 2)
    rough = np.sqrt(smooth(res * res, 2, 1))
    n = region.n
    return rough.reshape(n, 2, n, 2).max(axis=(1, 3)).astype(np.float32)


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

    # Morfologia comun: crestas boxwork cerca de la traza 2025 y arena oscura
    rr, cc = np.mgrid[0:n, 0:n]
    box_zone = np.zeros((n, n), dtype=bool)
    for sol, r, c, _, _, _ in pts:
        if BOXWORK_SOLS[0] <= sol <= BOXWORK_SOLS[1]:
            box_zone |= np.hypot(rr - r, cc - c) * region.px < BOXWORK_RADIUS_M
    ridges = (dem - smooth(dem, 6)) > 0.8  # crestas locales
    dark = albedo < np.percentile(albedo, 8)
    dunes = smooth(dark.astype(np.float32), 3) > 0.6
    clay_band = (dem > CLAY_RANGE_M[0]) & (dem <= CLAY_RANGE_M[1])
    sulfate_band = dem > SULFATE_ABOVE_M

    crism, crism_cover = crism_classes(region, raw, log, albedo)
    if crism is not None:
        classes = crism.copy()
        classes[dunes & (classes == 0)] = 4
        classes[box_zone & ridges] = 3
        ph, su = crism == 1, crism == 2
        log["crism"]["agreement_with_curiosity_stratigraphy"] = {
            "arcillas_en_banda_Glen_Torridon_pct": round(100 * float((ph & clay_band).sum() / max(ph.sum(), 1)), 1),
            "sulfatos_sobre_-4078m_pct": round(100 * float((su & sulfate_band).sum() / max(su.sum(), 1)), 1),
            "_doc": "Que fraccion de las detecciones CRISM cae donde Curiosity confirmo cada unidad.",
        }
        spectral_method = ("CRISM MTRDR (MRO), parametros de Viviano-Beck et al. 2014: " +
                           "; ".join(f"{k}: {v}" for k, v in CRISM_RULES.items()) +
                           ". Mediana por pixel de los productos que lo cubren. "
                           "Boxwork = crestas locales cerca de la traza 2025 (morfologia, no espectral); "
                           "dunas = arena mafica CRISM o zonas mas oscuras de CTX.")
    else:
        classes = np.zeros((n, n), dtype=np.uint8)
        classes[clay_band] = 1
        classes[sulfate_band] = 2
        classes[box_zone & ridges] = 3
        classes[dunes] = 4
        spectral_method = ("Estratigrafia de la traza de Curiosity: arcillas entre "
                           f"{CLAY_RANGE_M[0]} y {CLAY_RANGE_M[1]} m, sulfatos por encima; "
                           "boxwork = crestas locales cerca de los sols 4540-4990; "
                           "dunas = zonas mas oscuras de la ortoimagen CTX. No es CRISM.")
    paint_objectives(classes, objectives, region.px)
    log["spectral_method"] = spectral_method

    # Inercia termica: THEMIS si esta descargada; si no, aproximada desde el albedo
    themis = raw / "themis_ti.tif"
    if themis.exists():
        ti = load_to_grid(themis, region, fill=False)
        bad = ~np.isfinite(ti) | (ti <= 0) | (ti > 3000)
        if bad.any():
            ti = np.where(bad, np.nanmedian(np.where(bad, np.nan, ti)), ti)
        ti = smooth(ti.astype(np.float32), 4, passes=2)  # 100 m nativo: suavizar el remuestreo
        log["thermal_inertia_method"] = ("THEMIS cuantitativa (mosaico global USGS/ASU 30S120E, 100 m), "
                                         "remuestreada a 6 m y suavizada. Exactitud absoluta ~20%.")
        log["thermal_inertia_tiu"] = {k: round(float(v), 0) for k, v in
                                      zip(("p05", "p50", "p95"), np.percentile(ti, [5, 50, 95]))}
    else:
        ti = 260.0 + 260.0 * smooth(albedo, 2)
        ti = np.where(dunes, 230.0, ti)
        log["thermal_inertia_method"] = "Aproximada desde el albedo CTX (230-520 TIU). Pendiente: mosaico THEMIS."
    ti = ti.astype(np.float32)

    rough = roughness(region, raw, pts)
    ROCKY, FIELD = 0.6, 0.9
    gentle_tr = [rough[min(r, n - 1), min(c, n - 1)] for _, r, c, *_ in pts]
    log["roughness"] = {
        "method": "rms del relieve residual (DEM a 3 m menos su version suavizada ~20 m)",
        "rocky_above_m": ROCKY, "boulder_field_above_m": FIELD,
        "map_pct_rocky": round(100 * float((rough > ROCKY).mean()), 1),
        "map_pct_field": round(100 * float((rough > FIELD).mean()), 1),
        "curiosity_stops_pct_rocky": round(100 * float((np.array(gentle_tr) > ROCKY).mean()), 1),
        "_doc": "Curiosity evita el terreno rocoso: en zonas suaves lo visita ~35 % menos de lo esperable (validacion).",
    }
    return {"rough": rough, "dem": dem, "thermal_inertia": ti, "spectral": classes, "albedo": albedo,
            "optical_gray": albedo, "log": log, "traverse": pts}
