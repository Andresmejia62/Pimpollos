"""Pipeline de capas de Mars Survival Map (Miembro 3).

Uso (desde la raiz del repo):
  python3 data/scripts/build_layers.py                      # terreno sintetico (placeholder)
  python3 data/scripts/build_layers.py --dem data/raw/dtm.tif \
      [--ti data/raw/themis_ti.tif] [--spectral data/raw/crism_classes.tif] \
      [--optical data/raw/hirise_ortho.tif]                  # datos reales (requiere rasterio)

Salidas en public/layers/ (para M2) y reporte + vista previa en data/processed/.
"""
import argparse
import json
import math
import shutil
import sys
import time
import warnings
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import layers_lib as L
from region import ROOT, Region

OUT = ROOT / "public" / "layers"
PROC = ROOT / "data" / "processed"

SPECTRAL_CLASSES = {
    "0": {"es": "Basalto / polvo (sin firma)", "en": "Basalt / dust (no signature)", "color": "#000000"},
    "1": {"es": "Arcillas (filosilicatos)", "en": "Clays (phyllosilicates)", "color": "#4FC3F7"},
    "2": {"es": "Sulfatos", "en": "Sulfates", "color": "#C792EA"},
    "3": {"es": "Vetas boxwork", "en": "Boxwork veins", "color": "#FFFFFF"},
    "4": {"es": "Dunas basalticas", "en": "Basaltic dunes", "color": "#5C6BC0"},
}

# Sol a media manana (~10:00 LMST, lat -4.8): alto y hacia el este-noreste
SUN_10H = (75.0, 55.0)


def load_raster_to_grid(path: Path, region: Region, categorical=False) -> np.ndarray:
    """Recorta y reproyecta cualquier raster georreferenciado a la cuadricula del recorte."""
    try:
        import rasterio
        from rasterio.transform import from_origin
        from rasterio.warp import Resampling, reproject
    except ImportError:
        sys.exit("Para datos reales instala rasterio:  python3 -m pip install rasterio")
    dst_crs = (f"+proj=eqc +lat_ts={region.lat0} +lat_0={region.lat0} +lon_0={region.lon0} "
               f"+x_0=0 +y_0=0 +R={region.R} +units=m +no_defs")
    h = region.size / 2
    dst = np.full((region.n, region.n), np.nan, dtype=np.float32)
    with rasterio.open(path) as src:
        reproject(
            source=rasterio.band(src, 1), destination=dst,
            src_nodata=src.nodata, dst_nodata=np.nan,
            dst_transform=from_origin(-h, h, region.px, region.px), dst_crs=dst_crs,
            resampling=Resampling.nearest if categorical else Resampling.bilinear,
        )
    bad = np.isnan(dst).mean()
    if bad > 0.01:
        print(f"  AVISO: {path.name} no cubre {bad:.1%} del recorte (se rellena)")
    if bad:
        dst = np.where(np.isnan(dst), np.nanmedian(dst), dst)
    return dst


def reachability(passable: np.ndarray, start) -> np.ndarray:
    """Relleno por inundacion (8 vecinos) desde start sobre celdas transitables."""
    n0, n1 = passable.shape
    seen = np.zeros(passable.shape, dtype=bool)
    flat_pass = passable.ravel()
    flat_seen = seen.ravel()
    s = start[0] * n1 + start[1]
    if not flat_pass[s]:
        return seen
    flat_seen[s] = True
    q = deque([s])
    offs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    while q:
        i = q.popleft()
        rr, cc = divmod(i, n1)
        for dr, dc in offs:
            a, b = rr + dr, cc + dc
            if 0 <= a < n0 and 0 <= b < n1:
                j = a * n1 + b
                if flat_pass[j] and not flat_seen[j]:
                    flat_seen[j] = True
                    q.append(j)
    return seen


def downsample_cost(cost: np.ndarray, f: int) -> np.ndarray:
    n = cost.shape[0] // f
    blocks = cost.reshape(n, f, n, f).swapaxes(1, 2).reshape(n, n, f * f).astype(np.float32)
    blocked_frac = (blocks == 0).mean(axis=2)
    vals = np.where(blocks == 0, np.nan, blocks)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        mean = np.nanmean(vals, axis=2)
    out = np.clip(np.round(np.nan_to_num(mean, nan=0)), 1, 254).astype(np.uint8)
    out[blocked_frac >= 0.5] = 0
    return out


def level(a, safe_fn, danger_fn):
    lv = np.ones(a.shape, dtype=np.uint8)
    lv[safe_fn(a)] = 0
    lv[danger_fn(a)] = 2
    return lv


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", choices=["auto", "real", "synthetic"], default="auto",
                    help="auto = real si existe data/raw/manifest.json (correr fetch_nasa.py)")
    ap.add_argument("--ti", help="Reemplazo: inercia termica THEMIS (GeoTIFF, TIU)")
    ap.add_argument("--spectral", help="Reemplazo: clases minerales CRISM ya clasificadas (GeoTIFF, 0-4)")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    t0 = time.time()
    region = Region.load()
    rules = json.loads((ROOT / "data" / "rules.json").read_text(encoding="utf-8"))
    objs_doc = json.loads((ROOT / "data" / "objectives.json").read_text(encoding="utf-8"))
    objectives = objs_doc["objectives"]
    for o in objectives:
        if "latlon" in o:
            x, z = region.latlon_to_world(*o["latlon"])
            o["px"] = [round(v) for v in region.world_to_px(x, z)]
        if not (0 <= o["px"][0] < region.n and 0 <= o["px"][1] < region.n):
            sys.exit(f"Objetivo {o['id']} fuera del recorte: {o['px']}")

    OUT.mkdir(parents=True, exist_ok=True)
    PROC.mkdir(parents=True, exist_ok=True)
    n, px = region.n, region.px

    # ---- Entradas -----------------------------------------------------------
    raw = ROOT / "data" / "raw"
    source = args.source
    if source == "auto":
        source = "real" if (raw / "manifest.json").exists() else "synthetic"
    real_log, traverse, raw_manifest = {}, [], None
    if source == "real":
        print("Datos REALES NASA/USGS desde data/raw/")
        import real_data
        inp = real_data.build_inputs(region, raw, objectives)
        dem, ti, spectral, albedo = inp["dem"], inp["thermal_inertia"], inp["spectral"], inp["albedo"]
        real_log, traverse = inp["log"], inp["traverse"]
        raw_manifest = json.loads((raw / "manifest.json").read_text(encoding="utf-8"))
        if args.ti:
            ti = real_data.load_to_grid(Path(args.ti), region)
        if args.spectral:
            spectral = real_data.load_to_grid(Path(args.spectral), region, categorical=True).astype(np.uint8)
    else:
        print("Terreno SINTETICO (placeholder, no son datos NASA)")
        import synthetic
        syn = synthetic.generate(n, px, objectives, seed=args.seed)
        dem, ti, spectral, albedo = syn["dem"], syn["thermal_inertia"], syn["spectral"], syn["albedo"]

    # ---- Capas derivadas ----------------------------------------------------
    print("Pendiente...")
    slope = L.slope_deg(dem, px)
    print("Factor de cielo visible (radiacion)...")
    svf = L.sky_view_factor(dem, px)
    elev_ref = float(np.median(dem))
    rad = L.radiation_ugy_h(svf, dem, elev_ref)
    print("Temperatura...")
    cos10 = L.incidence_cos(dem, px, *SUN_10H)
    t_day = L.surface_temperature_c(cos10, ti)
    t_night = L.surface_temperature_c(cos10, ti, night=True)

    hz = rules["hazards"]
    blocked = slope > hz["slope"]["blocked_above_deg"]
    cost = L.traverse_cost(slope, rad, t_day, rules)
    cost256 = downsample_cost(cost, n // 256)

    # ---- Rangos de codificacion --------------------------------------------
    y_ref = float(math.floor(dem.min()))
    dem_max = float(math.ceil(dem.max()))
    ranges = {
        "slope": (0.0, 60.0),
        "radiation": (5.0, 10.0),
        "thermal": (-80.0, 10.0),
        "thermal_night": (-120.0, -40.0),
    }

    # ---- Escritura ----------------------------------------------------------
    print("Escribiendo capas...")
    L.save_png16(dem, y_ref, dem_max, OUT / "dem16.png")
    L.save_png8(slope, *ranges["slope"], OUT / "slope.png")
    L.save_png8(rad, *ranges["radiation"], OUT / "radiation.png")
    L.save_png8(t_day, *ranges["thermal"], OUT / "thermal.png")
    L.save_png8(t_night, *ranges["thermal_night"], OUT / "thermal_night.png")
    L.save_classes(spectral, OUT / "spectral.png")
    L.save_mask(blocked, OUT / "slope_blocked.png")
    L.save_classes(cost, OUT / "cost.png")
    L.save_classes(cost256, OUT / "cost_256.png")

    pal = rules["palette"]
    slope_lv = level(slope, lambda a: a < hz["slope"]["safe_below_deg"], lambda a: a > hz["slope"]["blocked_above_deg"])
    rad_lv = level(rad, lambda a: a < hz["radiation"]["safe_below_ugy_h"], lambda a: a > hz["radiation"]["danger_above_ugy_h"])
    tmp_lv = level(t_day, lambda a: a > hz["temperature"]["safe_above_c"], lambda a: a < hz["temperature"]["danger_below_c"])
    L.hazard_overlay(slope_lv, pal, OUT / "slope_overlay.png")
    L.hazard_overlay(rad_lv, pal, OUT / "radiation_overlay.png")
    L.hazard_overlay(tmp_lv, pal, OUT / "thermal_overlay.png")
    L.class_overlay(spectral, {k: v["color"] for k, v in SPECTRAL_CLASSES.items()}, OUT / "spectral_overlay.png")

    if source == "real":
        shade = 0.55 + 0.45 * L.hillshade(dem, px)
        rgb = L.mars_tint(np.clip(0.15 + 0.85 * albedo, 0, 1) * shade)
        optical_note = ("Ortoimagen CTX (MRO) reproyectada al recorte, coloreada en tonos marcianos "
                        "y combinada con un sombreado suave del DEM. Resolucion nativa 20 m: para detalle cercano M1 usa textura de suelo.")
    else:
        shade = 0.25 + 0.75 * L.hillshade(dem, px)
        rgb = L.mars_tint(shade, albedo)
        optical_note = "PLACEHOLDER: sombreado del DEM coloreado (no es imagen real)"
    Image.fromarray(rgb, mode="RGB").save(OUT / "optical.png", optimize=True)

    # ---- Objetivos enriquecidos --------------------------------------------
    out_objs = []
    for o in objectives:
        rr, cc = o["px"]
        x, zz = region.px_to_world(rr, cc)
        lat, lon = region.world_to_latlon(x, zz)
        q = dict(o)
        q["latlon"] = [round(lat, 6), round(lon, 6)]
        q["world"] = {"x": round(x, 2), "y": round(float(dem[rr, cc]) - y_ref, 2), "z": round(zz, 2)}
        q["elevation_m"] = round(float(dem[rr, cc]), 1)
        q["at_point"] = {
            "slope_deg": round(float(slope[rr, cc]), 1),
            "radiation_ugy_h": round(float(rad[rr, cc]), 2),
            "temperature_c": round(float(t_day[rr, cc]), 1),
            "spectral_class": int(spectral[rr, cc]),
        }
        out_objs.append(q)
    (OUT / "objectives.json").write_text(json.dumps(
        {"status": objs_doc.get("status"), "source": source, "objectives": out_objs},
        ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- Conectividad (QA): todos los objetivos alcanzables desde el habitat --
    print("Verificando que todos los objetivos sean alcanzables...")
    start = next(o for o in objectives if o["type"] == "base")["px"]
    reach = reachability(~blocked, tuple(start))
    reach_report = {o["id"]: bool(reach[o["px"][0], o["px"][1]]) for o in objectives}

    # ---- Manifiesto de capas -------------------------------------------------
    def scalar(file, units, rng, desc, overlay=None, bits=8):
        d = {"file": file, "kind": "scalar", "bits": bits, "units": units,
             "decode": {"min": rng[0], "max": rng[1],
                        "formula": f"valor = min + pixel/{(1 << bits) - 1} * (max - min)"},
             "description": desc}
        if overlay:
            d["overlay"] = overlay
        return d

    manifest = {
        "source": source,
        "provenance": ({"products": [{k: p.get(k) for k in ("file", "collection", "item", "asset", "href", "stac", "source")}
                                     for p in raw_manifest["products"]],
                        "accessed_utc": raw_manifest["accessed_utc"],
                        "methods": {k: v for k, v in real_log.items() if k.endswith("method")}}
                       if raw_manifest else "terreno sintetico"),
        "generated_unix": int(time.time()),
        "region": "region.json",
        "rules": "rules.json",
        "image_orientation": "fila 0 = norte, columna 0 = oeste; ver region.json -> world",
        "layers": {
            "dem": dict(scalar("dem16.png", "m (elevacion sobre el datum de Marte)", (y_ref, dem_max),
                               "Elevacion. Para Three.js: y = valor - y_ref_m. Para Blender (Displace): strength = max - min en metros.",
                               bits=16), y_ref_m=y_ref),
            "slope": scalar("slope.png", "grados", ranges["slope"],
                            "Pendiente del terreno. > 25 grados = bloqueado.", "slope_overlay.png"),
            "slope_blocked": {"file": "slope_blocked.png", "kind": "mask",
                              "description": "Blanco (255) = pendiente intransitable (> 25 grados). M1 lo combina con rocas y crateres para collision_map.png."},
            "radiation": scalar("radiation.png", "uGy/h", ranges["radiation"],
                                "Tasa de dosis GCR modelada: RAD (Curiosity) x fraccion de cielo visible x altitud.",
                                "radiation_overlay.png"),
            "thermal": scalar("thermal.png", "C", ranges["thermal"],
                              "Temperatura del suelo ~10:00 LMST (modelo con inercia termica y orientacion al sol).",
                              "thermal_overlay.png"),
            "thermal_night": scalar("thermal_night.png", "C", ranges["thermal_night"],
                                    "Temperatura del suelo antes del amanecer (para ciclo dia/noche opcional)."),
            "spectral": {"file": "spectral.png", "kind": "classes", "overlay": "spectral_overlay.png",
                         "classes": SPECTRAL_CLASSES,
                         "description": ("Clases minerales (indice = valor del pixel). " +
                                         real_log.get("spectral_method", "Sinteticas por elevacion."))},
            "cost": {"file": "cost.png", "kind": "cost", "file_256": "cost_256.png",
                     "decode": "0 = intransitable; costo = pixel / 25",
                     "description": "Costo de recorrido para A* (ver rules.json -> pathfinding)."},
            "optical": {"file": "optical.png", "kind": "rgb", "description": optical_note},
        },
        "overlays": {
            "levels": "0 seguro (verde, liso tenue), 1 precaucion (ambar, puntos), 2 peligro (rojo, rayas diagonales)",
            "palette": pal,
        },
    }
    (OUT / "layers.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "region.json").write_text(json.dumps(region.to_public(), ensure_ascii=False, indent=2), encoding="utf-8")
    shutil.copyfile(ROOT / "data" / "rules.json", OUT / "rules.json")

    # ---- Reporte y vista previa ----------------------------------------------
    def stats(a):
        return {k: round(float(v), 2) for k, v in
                zip(("min", "p05", "p50", "p95", "max"), np.percentile(a, [0, 5, 50, 95, 100]))}

    report = {
        "source": source,
        "seconds": round(time.time() - t0, 1),
        "elevation_m": stats(dem),
        "slope_deg": stats(slope),
        "sky_view_factor": stats(svf),
        "radiation_ugy_h": stats(rad),
        "temperature_10h_c": stats(t_day),
        "temperature_night_c": stats(t_night),
        "percent_blocked": round(100 * float(blocked.mean()), 2),
        "hazard_share_percent": {
            name: [round(100 * float((lv == k).mean()), 1) for k in (0, 1, 2)]
            for name, lv in (("slope", slope_lv), ("radiation", rad_lv), ("temperature", tmp_lv))
        },
        "spectral_share_percent": {k: round(100 * float((spectral == int(k)).mean()), 1) for k in SPECTRAL_CLASSES},
        "reachable_from_habitat": reach_report,
        "reachable_area_percent": round(100 * float(reach.mean()), 1),
        "objectives_at_point": {o["id"]: o["at_point"] for o in out_objs},
        **real_log,
    }
    if traverse:
        on_trav = np.array([slope[min(r, n - 1), min(c, n - 1)] for _, r, c, *_ in traverse
                            if 0 <= r < n and 0 <= c < n])
        report["curiosity_traverse_slope_deg"] = {
            "points": int(on_trav.size), "p50": round(float(np.median(on_trav)), 1),
            "p95": round(float(np.percentile(on_trav, 95)), 1),
            "percent_on_blocked": round(100 * float((on_trav > hz["slope"]["blocked_above_deg"]).mean()), 1),
            "_doc": "Pendiente del DEM donde se detuvo Curiosity: sirve para validar el umbral de bloqueo.",
        }
    (PROC / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    make_preview(OUT, out_objs, PROC / "preview.png", traverse=[(r, c) for _, r, c, *_ in traverse])

    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not all(reach_report.values()):
        print("ERROR: hay objetivos inalcanzables desde el habitat", file=sys.stderr)
        sys.exit(2)
    print(f"OK en {report['seconds']} s -> {OUT}")


def make_preview(out: Path, objs, path: Path, tile=340, traverse=()):
    items = [("optical.png", None, "Optico"),
             ("dem16.png", None, "Elevacion"),
             ("slope.png", "slope_overlay.png", "Pendiente"),
             ("radiation.png", "radiation_overlay.png", "Radiacion"),
             ("thermal.png", "thermal_overlay.png", "Temperatura 10:00"),
             ("optical.png", "spectral_overlay.png", "Espectral"),
             ("cost.png", None, "Costo A*"),
             ("slope_blocked.png", None, "Bloqueado (>25)"),
             ("optical.png", None, "Objetivos")]
    sheet = Image.new("RGB", (tile * 3, (tile + 22) * 3), (16, 12, 10))
    draw = ImageDraw.Draw(sheet)
    s = tile / 1024
    for i, (base, ov, label) in enumerate(items):
        im = Image.open(out / base)
        if im.mode == "I;16" or im.mode == "I":
            a = np.asarray(im, dtype=np.float32)
            im = Image.fromarray(np.uint8(255 * (a - a.min()) / (a.max() - a.min() + 1e-9)))
        im = im.convert("RGB")
        if ov:
            im = Image.alpha_composite(im.convert("RGBA"), Image.open(out / ov).convert("RGBA")).convert("RGB")
        im = im.resize((tile, tile), Image.BILINEAR)
        x0, y0 = (i % 3) * tile, (i // 3) * (tile + 22)
        sheet.paste(im, (x0, y0 + 22))
        draw.text((x0 + 6, y0 + 5), label, fill=(240, 220, 200))
        if label == "Objetivos" and traverse:
            draw.line([(x0 + c * s, y0 + 22 + r * s) for r, c in traverse], fill=(255, 210, 80), width=1)
        if label == "Objetivos" or label == "Pendiente":
            for o in objs:
                rr, cc = o["px"]
                cx, cy = x0 + cc * s, y0 + 22 + rr * s
                col = (61, 220, 151) if o["type"] != "science" else (255, 255, 255)
                draw.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], outline=col, width=2)
                if label == "Objetivos":
                    draw.text((cx + 7, cy - 6), o["id"], fill=col)
    sheet.save(path)


if __name__ == "__main__":
    main()
