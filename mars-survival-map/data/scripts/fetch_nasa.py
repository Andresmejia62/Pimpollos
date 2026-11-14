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

GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
                CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.cub,.lbl,.img,.LBL,.IMG",
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
    return manifest


# ---------------------------------------------------------------------------
# THEMIS: inercia termica cuantitativa (Christensen/Fergason, USGS Astropedia)
# ---------------------------------------------------------------------------
THEMIS_TI_URL = ("https://asc-astropedia.s3.us-west-2.amazonaws.com/Mars/Odyssey/THEMIS-Global-Thermal-Inertia-Mosaic/"
                 "Quantitative-32-Bit/THEMIS_TI_Mosaic_Quant_30S120E_100mpp.cub")
THEMIS_TI_PAGE = "https://astrogeology.usgs.gov/search/map/themis_thermal_inertia_mosaic_quantitative_30s120e_100mpp"


def fetch_themis(region: Region) -> list:
    print("themis_ti.tif: THEMIS TI cuantitativa 30S120E (100 m)")
    info = fetch_window(THEMIS_TI_URL, RAW / "themis_ti.tif", region, None)
    print(f"   -> {info['shape']} px @ {info['saved_res_m']} m, cobertura {info['valid_fraction']:.0%}")
    return [{"file": "themis_ti.tif", "href": THEMIS_TI_URL, "source": THEMIS_TI_PAGE,
             "description": "Inercia termica cuantitativa THEMIS (J m-2 K-1 s-1/2), mosaico global USGS/ASU.", **info}]


# ---------------------------------------------------------------------------
# CRISM: parametros espectrales MTRDR (Viviano-Beck et al. 2014), PDS Geosciences
# ---------------------------------------------------------------------------
ODE_URL = ("https://oderest.rsl.wustl.edu/live2/?query=product&results=fp&target=mars&ihid=MRO&iid=CRISM"
           "&pt=MTRDR&westernlon={w}&easternlon={e}&minlat={s}&maxlat={n}&output=JSON")
CRISM_PARAMS = ["D2300", "BD2290", "BD1900_2", "SINDEX2", "BD2100_2", "MIN2295_2480", "OLINDEX3", "LCPINDEX2"]


def fetch_crism(region: Region) -> list:
    import re
    url = ODE_URL.format(w=round(region.west, 4), e=round(region.east, 4), s=round(region.south, 4), n=round(region.north, 4))
    res = get_json(url)["ODEResults"]["Products"]["Product"]
    res = [res] if isinstance(res, dict) else res
    out_dir = RAW / "crism"
    out_dir.mkdir(exist_ok=True)
    entries = []
    for p in res:
        files = p["Product_files"]["Product_file"]
        files = [files] if isinstance(files, dict) else files
        lbl = next((f["URL"] for f in files if re.search(r"_SU\d+J_MTR3\.LBL$", f["FileName"])), None)
        if not lbl:
            continue
        label = urllib.request.urlopen(urllib.request.Request(lbl, headers={"User-Agent": "mars-survival-map/1.0"}),
                                       timeout=60).read().decode("latin-1")
        names = [s.strip().strip('"') for s in re.search(r"BAND_NAME\s*=\s*\((.*?)\)", label, re.S).group(1).split(",")]
        idx = [names.index(k) + 1 for k in CRISM_PARAMS]
        name = p["pdsid"].split("_")[0].upper() + "_su.tif"
        print(f"crism/{name}: {p['pdsid']} bandas {CRISM_PARAMS}")
        info = None
        for attempt in range(3):
            try:
                info = fetch_window_bands(lbl, out_dir / name, region, idx, CRISM_PARAMS, nodata=65535.0)
                break
            except Exception as e:  # lecturas remotas de PDS a veces fallan: reintentar
                print(f"   intento {attempt + 1} fallo: {str(e)[:120]}")
                time.sleep(5 * (attempt + 1))
        if info is None:
            print("   OMITIDO tras 3 intentos")
            continue
        if info["valid_fraction"] < 0.02:
            (out_dir / name).unlink(missing_ok=True)
            print("   sin cobertura util: descartado")
            continue
        print(f"   -> {info['shape']} px @ {info['saved_res_m']} m, cobertura {info['valid_fraction']:.0%}, "
              f"{info['bytes'] / 1e6:.1f} MB")
        entries.append({"file": f"crism/{name}", "pdsid": p["pdsid"], "href": lbl, "ode_query": url,
                        "bands": CRISM_PARAMS, **info})
    return entries


def fetch_window_bands(href, out: Path, region: Region, indexes, names, nodata) -> dict:
    m_lat = MARGIN_M / region.m_per_deg_lat
    m_lon = MARGIN_M / region.m_per_deg_lon
    crop = (region.west - m_lon, region.south - m_lat, region.east + m_lon, region.north + m_lat)
    with rasterio.Env(**GDAL_ENV), rasterio.open("/vsicurl/" + href) as src:
        b = transform_bounds(GEO, src.crs, *crop)
        win = from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
        win = win.intersection(Window(0, 0, src.width, src.height))
        data = src.read(indexes, window=win).astype(np.float32)
        data[(data >= 65534) | ~np.isfinite(data)] = nodata
        tr = src.window_transform(win)
        profile = dict(driver="GTiff", height=data.shape[1], width=data.shape[2], count=len(indexes),
                       dtype="float32", crs=src.crs, transform=tr, nodata=nodata, compress="deflate", tiled=True)
        with rasterio.open(out, "w", **profile) as dst:
            dst.write(data)
            for i, n in enumerate(names, 1):
                dst.set_band_description(i, n)
        valid = float((data[0] != nodata).mean())
        return {"native_res_m": round(src.res[0], 3), "saved_res_m": round(abs(tr.a), 3),
                "shape": list(data.shape[1:]), "valid_fraction": round(valid, 3), "bytes": out.stat().st_size}


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="base,themis,crism",
                    help="grupos separados por coma: base (traza + DTM/orto), themis, crism")
    groups = set(ap.parse_args().only.split(","))
    region = Region.load()
    RAW.mkdir(parents=True, exist_ok=True)
    mpath = RAW / "manifest.json"
    if "base" in groups:
        manifest = main()
    else:
        manifest = json.loads(mpath.read_text(encoding="utf-8"))
    new = []
    if "themis" in groups:
        new += fetch_themis(region)
    if "crism" in groups:
        new += fetch_crism(region)
    files_new = {p["file"] for p in new}
    manifest["products"] = [p for p in manifest["products"] if p["file"] not in files_new] + new
    manifest.setdefault("accessed_utc_by_group", {}).update(
        {g: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) for g in groups})
    mpath.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    total = sum(p.get("bytes", 0) for p in manifest["products"])
    print(f"OK: {total / 1e6:.1f} MB en {RAW}")
