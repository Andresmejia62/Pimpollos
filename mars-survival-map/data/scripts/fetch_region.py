"""Relieve e imagen de la zona que rodea el recorte EVA (unos 60 x 60 km) para el atlas 3D.

Fuentes (USGS Astrogeology, mosaicos globales publicos; se leen solo las filas y columnas del recorte):
  - DEM: Mars MGS MOLA - MEX HRSC Blended DEM Global 200m v2 (Fergason et al. 2018)
  - Imagen: Mars Odyssey THEMIS Day IR Global Mosaic 100m v12 (Edwards et al. 2011, ASU)
Salida:
  data/raw/region_dem200.tif, data/raw/region_themis100.tif   (recortes originales)
  public/atlas/region.json, region_dem.bin (Int16 LE, m), region_themis.jpg
Uso: python3 data/scripts/fetch_region.py
"""
import json
import math
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
RAW, OUT = ROOT / "data/raw", ROOT / "public/atlas"
DEM_URL = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"
THEMIS_URL = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12.tif"
# los mosaicos van por filas completas sin comprimir: con lectura directa solo se piden los bytes del recorte
ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
           GDAL_HTTP_USERAGENT="mars-survival-map/1.0", GTIFF_DIRECT_IO="YES", CPL_VSIL_CURL_CHUNK_SIZE="8192")
R_MARS = 3396190.0
HALF_DEG = 0.5          # +-0.5 grados alrededor del centro del recorte EVA (~59 km de lado)


def read_window(src, href, win):
    """Lee la ventana con peticiones HTTP Range propias: una por fila, en paralelo y con reintentos.
    Los mosaicos son GeoTIFF sin comprimir con una tira por fila, asi que cada fila es un trozo contiguo."""
    dt = np.dtype(src.dtypes[0]).newbyteorder("<")
    bpp = dt.itemsize
    c0, r0, w, h = int(win.col_off), int(win.row_off), int(win.width), int(win.height)

    def row(r):
        off = int(src.get_tag_item(f"BLOCK_OFFSET_0_{r0 + r}", "TIFF", bidx=1))
        a, b = off + c0 * bpp, off + (c0 + w) * bpp - 1
        for k in range(6):
            try:
                req = urllib.request.Request(href, headers={"Range": f"bytes={a}-{b}", "User-Agent": "mars-survival-map/1.0"})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = resp.read()
                if len(data) == w * bpp:
                    return r, np.frombuffer(data, dtype=dt)
            except Exception:
                pass
            time.sleep(1 + k * 2)
        raise RuntimeError(f"fila {r0 + r}: sin respuesta tras 6 intentos")

    out = np.zeros((h, w), dtype=dt)
    with ThreadPoolExecutor(8) as ex:
        for r, v in ex.map(row, range(h)):
            out[r] = v
    return out.astype(dt.newbyteorder("="))


def save_tif(path, arr, transform, crs, nodata):
    with rasterio.open(path, "w", driver="GTiff", width=arr.shape[1], height=arr.shape[0], count=1,
                       dtype=arr.dtype, transform=transform, crs=crs, nodata=nodata, compress="deflate") as d:
        d.write(arr, 1)


def main():
    region = json.loads((ROOT / "public/layers/region.json").read_text())
    lat0, lon0 = region["center"]["lat"], region["center"]["lon_east"]
    north, south, west, east = lat0 + HALF_DEG, lat0 - HALF_DEG, lon0 - HALF_DEG, lon0 + HALF_DEG

    with rasterio.Env(**ENV):
        # ---- DEM 200 m (geografico, grados) ----
        with rasterio.open("/vsicurl/" + DEM_URL) as s:
            T = s.transform
            c0, r0 = int((west - T.c) / T.a), int((T.f - north) / -T.e)
            c1, r1 = int(math.ceil((east - T.c) / T.a)), int(math.ceil((T.f - south) / -T.e))
            win = Window(c0, r0, c1 - c0, r1 - r0)
            dem = read_window(s, DEM_URL, win)
            dtr = s.window_transform(win)
            save_tif(RAW / "region_dem200.tif", dem, dtr, s.crs, s.nodata)
            dem_meta = dict(w=int(win.width), h=int(win.height), lat_north=dtr.f, lon_west=dtr.c, ppd=1 / T.a,
                            res_m=round(T.a * math.pi / 180 * R_MARS, 1))
        print("DEM", dem.shape, int(dem.min()), int(dem.max()))

        # ---- THEMIS Day IR 100 m (cilindrica simple, meridiano central 180) ----
        with rasterio.open("/vsicurl/" + THEMIS_URL) as s:
            T = s.transform
            k = math.pi / 180 * R_MARS
            xw, xe = (west - 180) * k, (east - 180) * k
            yn, ys = north * k, south * k
            c0, r0 = int((xw - T.c) / T.a), int((T.f - yn) / -T.e)
            c1, r1 = int(math.ceil((xe - T.c) / T.a)), int(math.ceil((T.f - ys) / -T.e))
            win = Window(c0, r0, c1 - c0, r1 - r0)
            img = read_window(s, THEMIS_URL, win)
            ttr = s.window_transform(win)
            save_tif(RAW / "region_themis100.tif", img, ttr, s.crs, s.nodata)
            img_meta = dict(w=int(win.width), h=int(win.height), lat_north=ttr.f / k, lon_west=ttr.c / k + 180,
                            ppd=k / T.a)
        print("THEMIS", img.shape, int(img.min()), int(img.max()))

    OUT.mkdir(parents=True, exist_ok=True)
    dem.astype("<i2").tofile(OUT / "region_dem.bin")
    # estirado de contraste robusto: el mosaico de dia tiene poco rango en esta zona
    v = img[img > 0].astype(np.float32)
    lo, hi = np.percentile(v, [1, 99.5]) if v.size else (0, 255)
    g = np.clip((img.astype(np.float32) - lo) / max(1, hi - lo), 0, 1)
    Image.fromarray((g * 255).astype(np.uint8)).save(OUT / "region_themis.jpg", quality=90)
    meta = {
        "_doc": "Relieve e imagen de ~60 km alrededor del recorte EVA para el atlas 3D. Generado por data/scripts/fetch_region.py.",
        "dem": {**dem_meta, "file": "region_dem.bin", "dtype": "int16", "nodata": -32768,
                "source": "Mars MGS MOLA - MEX HRSC Blended DEM Global 200m v2 (USGS Astrogeology)", "url": DEM_URL},
        "image": {**img_meta, "file": "region_themis.jpg",
                  "source": "Mars Odyssey THEMIS Day IR Global Mosaic 100m v12 (ASU / USGS)", "url": THEMIS_URL},
    }
    (OUT / "region.json").write_text(json.dumps(meta, indent=1))
    print("public/atlas/region.json listo")


if __name__ == "__main__":
    main()
