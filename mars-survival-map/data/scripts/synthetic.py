"""Terreno SINTETICO tipo Mount Sharp para que M1 y M2 trabajen sin esperar los datos reales.

No son datos de NASA. Imita la morfologia del area (pendiente regional hacia el
sur, estratos en terrazas, canal Gediz Vallis, mesetas, crateres, dunas y una
zona de boxwork) y se construye alrededor de los objetivos de objectives.json.
Se reemplaza con el DTM real pasando --dem a build_layers.py.
"""
import math

import numpy as np

from layers_lib import resize_float, smooth


def fractal_noise(n: int, rng: np.random.Generator, octaves=(8, 16, 32, 64, 128), gain=0.55) -> np.ndarray:
    out = np.zeros((n, n), dtype=np.float32)
    amp, total = 1.0, 0.0
    for o in octaves:
        out += amp * resize_float(rng.standard_normal((o, o)).astype(np.float32), n)
        total += amp
        amp *= gain
    out /= total
    return (out - out.mean()) / (out.std() + 1e-9)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def channel_center_col(row):
    """Linea central del canal Gediz Vallis (columna en funcion de la fila)."""
    return 376 + 38 * np.sin(row / 85.0 + 0.4) + 12 * np.sin(row / 23.0)


def generate(n: int, px: float, objectives: list, seed: int = 42) -> dict:
    rng = np.random.default_rng(seed)
    r, c = np.mgrid[0:n, 0:n].astype(np.float32)
    rn = r / (n - 1)

    # 1) Pendiente regional: el monte sube hacia el sur (~300 m en 4 km)
    z = -4250.0 + 300.0 * rn ** 1.15
    z += 14.0 * fractal_noise(n, rng, octaves=(4, 8, 16, 32, 64))
    z += 0.6 * fractal_noise(n, rng, octaves=(128, 256), gain=0.6)

    # 2) Estratos en terrazas con escalones empinados y rampas donde el ruido lo permite
    step = 30.0
    frac = (z + 5000.0) / step % 1.0
    riser = smoothstep(0.80, 0.97, frac)
    strength = smoothstep(-0.1, 0.9, fractal_noise(n, rng, octaves=(4, 8, 16), gain=0.5))
    z += strength * step * 0.55 * (riser - frac)

    # 3) Mesetas (buttes) con laderas muy empinadas
    for (br, bc, rad, h) in ((240, 860, 55, 42.0), (640, 140, 65, 50.0), (800, 470, 35, 30.0)):
        d = np.hypot(r - br, c - bc) / rad
        z += h * (1 - smoothstep(0.82, 1.0, d))

    # 4) Canal Gediz Vallis: de sur a norte, termina en un abanico hacia la fila ~430
    cc = channel_center_col(r)
    dist = np.abs(c - cc)
    half_w = 18.0 + 6.0 * np.sin(r / 40.0)
    along = smoothstep(420, 520, r)
    depth = 26.0 * along
    z -= depth * (1 - smoothstep(0.55, 1.0, dist / half_w))
    fan = np.exp(-(((r - 430) / 60.0) ** 2 + ((c - 360) / 90.0) ** 2))
    z += 6.0 * fan
    channel_mask = (dist < half_w * 0.9) & (r > 470)

    # 5) Crateres pequenos (borde elevado + cuenco)
    craters = [(180, 520, 22), (380, 900, 16), (520, 760, 28), (760, 920, 12), (980, 260, 20),
               (330, 120, 10), (870, 620, 14), (120, 760, 18)]
    for (cr, ccol, rad) in craters:
        d = np.hypot(r - cr, c - ccol) / rad
        bowl = -0.45 * rad * px * 0.25 * (1 - smoothstep(0.0, 1.0, d))
        rim = 0.12 * rad * px * 0.25 * np.exp(-((d - 1.0) / 0.18) ** 2)
        z += bowl + rim

    # 6) Campo de dunas al noroeste (ondulaciones)
    dune_zone = (1 - smoothstep(0.7, 1.0, np.hypot((r - 330) / 170.0, (c - 120) / 150.0)))
    ripples = np.sin((c * 0.8 + r * 0.6) / 4.8 + 2.0 * fractal_noise(n, rng, octaves=(16, 32)))
    z += 3.5 * dune_zone * ripples
    dune_mask = dune_zone > 0.35

    # 7) Boxwork: red poligonal de crestas minerales (Voronoi) al sureste
    box_c = (900, 820)
    box_zone = 1 - smoothstep(0.75, 1.0, np.hypot((r - box_c[0]) / 150.0, (c - box_c[1]) / 190.0))
    m = 256
    s = n / m
    pts = np.column_stack([rng.uniform(700, 1023, 260), rng.uniform(560, 1023, 260)]) / s
    gr, gc = np.mgrid[0:m, 0:m].astype(np.float32)
    d1 = np.full((m, m), 1e9, dtype=np.float32)
    d2 = np.full((m, m), 1e9, dtype=np.float32)
    for pr, pc in pts:
        d = np.hypot(gr - pr, gc - pc)
        d2 = np.where(d < d1, d1, np.minimum(d2, d))
        d1 = np.minimum(d1, d)
    edge = resize_float(d2 - d1, n) * s
    ridges = np.exp(-(edge / 3.2) ** 2)
    z += 2.8 * box_zone * ridges
    boxwork_mask = (box_zone > 0.4)

    # 8) Aplanar alrededor de objetivos para que sean alcanzables y legibles
    for o in objectives:
        orow, ocol = o["px"]
        rad_px = max(10.0, 2.5 * o.get("radius_m", 15) / px)
        d = np.hypot(r - orow, c - ocol) / rad_px
        w = 1 - smoothstep(0.35, 1.0, d)
        local = float(z[int(orow), int(ocol)])
        z = z * (1 - w) + local * w

    # --- Inercia termica (TIU), albedo y clases espectrales sinteticas ---
    ti = 420.0 + 60.0 * fractal_noise(n, rng, octaves=(16, 32, 64))
    ti = np.where(dune_mask, 230.0, ti)
    ti = np.where(channel_mask, 340.0, ti)
    ti = ti + 180.0 * box_zone * ridges
    ti = smooth(ti.astype(np.float32), 2, passes=2)

    e = (z - z.min()) / (z.max() - z.min())
    patch = fractal_noise(n, rng, octaves=(16, 32, 64, 128))
    classes = np.zeros((n, n), dtype=np.uint8)
    classes[(e > 0.14) & (e < 0.46) & (patch > -0.2)] = 1          # arcillas (filosilicatos)
    classes[(e > 0.52) & (patch > -0.35)] = 2                        # sulfatos
    classes[boxwork_mask & (ridges > 0.35)] = 3                      # vetas boxwork
    classes[dune_mask] = 4                                           # dunas basalticas
    for o in objectives:
        k = o.get("mineral_class")
        if k:
            rad_px = 2.0 * o.get("radius_m", 15) / px
            classes[np.hypot(r - o["px"][0], c - o["px"][1]) < rad_px] = k

    albedo = np.clip(0.55 + 0.15 * fractal_noise(n, rng, octaves=(32, 64, 128)), 0, 1)
    albedo = np.where(dune_mask, 0.15, albedo)
    albedo = np.where(classes == 2, np.maximum(albedo, 0.75), albedo)

    return {
        "dem": z.astype(np.float32),
        "thermal_inertia": ti.astype(np.float32),
        "spectral": classes,
        "albedo": albedo.astype(np.float32),
    }
