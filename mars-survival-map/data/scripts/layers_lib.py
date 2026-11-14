"""Calculo de capas de supervivencia a partir de un DEM (solo numpy + Pillow).

Cada funcion recibe y devuelve arreglos float32 de forma (n, n) alineados con la
cuadricula de region.py (fila 0 = norte, columna 0 = oeste).
"""
import math

import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

def box_blur(a: np.ndarray, r: int) -> np.ndarray:
    """Desenfoque de caja separable con radio r (bordes replicados)."""
    if r <= 0:
        return a.astype(np.float32)
    k = 2 * r + 1
    p = np.pad(a.astype(np.float64), r, mode="edge")
    c = np.cumsum(p, axis=0)
    c = np.vstack([np.zeros((1, c.shape[1])), c])
    p = (c[k:] - c[:-k]) / k
    c = np.cumsum(p, axis=1)
    c = np.hstack([np.zeros((c.shape[0], 1)), c])
    return ((c[:, k:] - c[:, :-k]) / k).astype(np.float32)


def smooth(a: np.ndarray, r: int, passes: int = 3) -> np.ndarray:
    """Aproximacion gaussiana: varias pasadas de box blur."""
    for _ in range(passes):
        a = box_blur(a, r)
    return a


def resize_float(a: np.ndarray, n: int) -> np.ndarray:
    return np.asarray(Image.fromarray(a.astype(np.float32), mode="F").resize((n, n), Image.BICUBIC),
                      dtype=np.float32)

# ---------------------------------------------------------------------------
# Geomorfometria
# ---------------------------------------------------------------------------

def gradients(dem: np.ndarray, px: float):
    """Devuelve (dz/dEste, dz/dNorte) en m/m."""
    dz_drow, dz_dcol = np.gradient(dem.astype(np.float64), px)
    return dz_dcol.astype(np.float32), (-dz_drow).astype(np.float32)


def slope_deg(dem: np.ndarray, px: float) -> np.ndarray:
    gx, gy = gradients(dem, px)
    return np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)


def incidence_cos(dem: np.ndarray, px: float, sun_az_deg: float, sun_el_deg: float) -> np.ndarray:
    """Coseno del angulo de incidencia solar sobre cada faceta (0 si esta de espaldas).
    Azimut desde el Norte, en sentido horario (90 = Este). No calcula sombras proyectadas."""
    gx, gy = gradients(dem, px)
    nx, ny, nz = -gx, -gy, np.ones_like(gx)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    az, el = math.radians(sun_az_deg), math.radians(sun_el_deg)
    sx, sy, sz = math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el)
    return np.clip((nx * sx + ny * sy + nz * sz) / norm, 0, 1).astype(np.float32)


def _shift(a: np.ndarray, dr: int, dc: int) -> np.ndarray:
    """a desplazado de modo que out[r, c] = a[r+dr, c+dc] (bordes replicados)."""
    n0, n1 = a.shape
    rows = np.clip(np.arange(n0) + dr, 0, n0 - 1)
    cols = np.clip(np.arange(n1) + dc, 0, n1 - 1)
    return a[np.ix_(rows, cols)]


def sky_view_factor(dem: np.ndarray, px: float, max_dist_m: float = 600.0,
                    n_dirs: int = 16, n_steps: int = 36) -> np.ndarray:
    """Fraccion del cielo visible (1 = cielo completo, terreno plano abierto).
    Busca el angulo de horizonte en n_dirs azimuts con pasos crecientes."""
    dem = dem.astype(np.float32)
    max_px = max_dist_m / px
    dists = np.unique(np.round(np.geomspace(1, max_px, n_steps)).astype(int))
    acc = np.zeros_like(dem)
    for k in range(n_dirs):
        th = 2 * math.pi * k / n_dirs
        dr, dc = -math.cos(th), math.sin(th)  # 0 = Norte (fila decreciente)
        horizon = np.zeros_like(dem)
        for d in dists:
            sr, sc = int(round(dr * d)), int(round(dc * d))
            dist_m = math.hypot(sr, sc) * px
            if dist_m == 0:
                continue
            ang = np.arctan((_shift(dem, sr, sc) - dem) / dist_m)
            np.maximum(horizon, ang, out=horizon)
        acc += np.cos(horizon) ** 2
    return (acc / n_dirs).astype(np.float32)

# ---------------------------------------------------------------------------
# Modelos de supervivencia (ver docs/fuentes.md y rules.json)
# ---------------------------------------------------------------------------

RAD_SURFACE_UGY_H = 210.0 / 24.0  # RAD/Curiosity: ~0.21 mGy/dia en superficie (Hassler et al. 2014)


def radiation_ugy_h(svf: np.ndarray, dem: np.ndarray, elev_ref_m: float) -> np.ndarray:
    """Tasa de dosis absorbida GCR en uGy/h.
    - La radiacion cosmica llega casi isotropa desde arriba: el terreno que tapa el
      cielo bloquea parte del flujo primario (factor svf). Una parte (~25%) es
      secundaria/albedo del suelo y no depende del cielo visible.
    - Mas altura = menos columna de atmosfera: +~1% por cada 100 m (aprox. lineal
      a partir de la anticorrelacion dosis-presion medida por RAD)."""
    shield = 0.25 + 0.75 * svf
    alt = 1.0 + 0.01 * (dem - elev_ref_m) / 100.0
    return (RAD_SURFACE_UGY_H * shield * alt).astype(np.float32)


def surface_temperature_c(cos_i: np.ndarray, thermal_inertia: np.ndarray,
                          t_mean_c: float = -45.0, amp_ref_c: float = 55.0,
                          ti_ref: float = 400.0, night: bool = False) -> np.ndarray:
    """Temperatura del suelo (C), modelo simplificado calibrado al rango diurno de REMS.
    Amplitud termica ~ 1/sqrt(inercia termica): arena (baja TI) se calienta y enfria mas
    que la roca. De dia, la orientacion de la pendiente respecto al sol modula el valor."""
    amp = amp_ref_c * np.sqrt(ti_ref / np.clip(thermal_inertia, 50, 2000))
    if night:
        return (t_mean_c - 0.75 * amp).astype(np.float32)
    return (t_mean_c + amp * (1.6 * cos_i - 0.9)).astype(np.float32)


def traverse_cost(slope: np.ndarray, rad: np.ndarray, temp: np.ndarray, rules: dict,
                  extra_blocked: np.ndarray | None = None) -> np.ndarray:
    """Costo por celda para A*. 0 = intransitable; 1..254 = costo; ver rules.json -> pathfinding."""
    pf = rules["pathfinding"]
    th = rules["hazards"]
    blocked = slope > th["slope"]["blocked_above_deg"]
    if extra_blocked is not None:
        blocked |= extra_blocked
    c = np.ones_like(slope)
    c += pf["w_slope"] * np.clip(slope / th["slope"]["blocked_above_deg"], 0, 1) ** 2
    r_lo, r_hi = th["radiation"]["safe_below_ugy_h"], th["radiation"]["danger_above_ugy_h"]
    c += pf["w_radiation"] * np.clip((rad - r_lo) / (r_hi - r_lo), 0, 1)
    t_lo, t_hi = th["temperature"]["danger_below_c"], th["temperature"]["safe_above_c"]
    c += pf["w_cold"] * np.clip((t_hi - temp) / (t_hi - t_lo), 0, 1)
    out = np.clip(np.round(c * pf["encode_scale"]), 1, 254).astype(np.uint8)
    out[blocked] = 0
    return out

# ---------------------------------------------------------------------------
# Codificacion de imagenes
# ---------------------------------------------------------------------------

def save_png8(a: np.ndarray, vmin: float, vmax: float, path) -> None:
    v = np.clip((a - vmin) / (vmax - vmin), 0, 1)
    Image.fromarray(np.round(v * 255).astype(np.uint8), mode="L").save(path, optimize=True)


def save_png16(a: np.ndarray, vmin: float, vmax: float, path) -> None:
    v = np.clip((a - vmin) / (vmax - vmin), 0, 1)
    Image.fromarray(np.round(v * 65535).astype(np.uint16)).save(path)


def save_mask(m: np.ndarray, path) -> None:
    Image.fromarray(np.where(m, 255, 0).astype(np.uint8), mode="L").save(path, optimize=True)


def save_classes(a: np.ndarray, path) -> None:
    Image.fromarray(a.astype(np.uint8), mode="L").save(path, optimize=True)


def _patterns(n: int):
    r, c = np.mgrid[0:n, 0:n]
    stripes = ((r + c) % 16) < 5            # diagonales: PELIGRO
    dots = ((r % 10) < 3) & ((c % 10) < 3)  # puntos: PRECAUCION
    return stripes, dots


def hazard_overlay(level: np.ndarray, palette: dict, path) -> None:
    """level: 0 seguro, 1 precaucion, 2 peligro. Genera RGBA semitransparente con
    patron (no depende solo del color): seguro liso tenue, precaucion con puntos,
    peligro con rayas diagonales."""
    n = level.shape[0]
    stripes, dots = _patterns(n)
    rgba = np.zeros((n, n, 4), dtype=np.uint8)
    for lv, key, base_a, pat, pat_a in ((0, "safe", 40, None, 0),
                                        (1, "caution", 90, dots, 200),
                                        (2, "danger", 110, stripes, 210)):
        m = level == lv
        rgba[m, :3] = _hex(palette[key])
        rgba[m, 3] = base_a
        if pat is not None:
            rgba[m & pat, 3] = pat_a
    Image.fromarray(rgba, mode="RGBA").save(path, optimize=True)


def class_overlay(classes: np.ndarray, colors: dict, path) -> None:
    n = classes.shape[0]
    rgba = np.zeros((n, n, 4), dtype=np.uint8)
    for k, hexcol in colors.items():
        m = classes == int(k)
        if int(k) == 0:
            continue
        rgba[m, :3] = _hex(hexcol)
        rgba[m, 3] = 150
    Image.fromarray(rgba, mode="RGBA").save(path, optimize=True)


def hillshade(dem: np.ndarray, px: float, az: float = 315, el: float = 40) -> np.ndarray:
    return incidence_cos(dem, px, az, el)


def mars_tint(shade: np.ndarray, albedo: np.ndarray | None = None) -> np.ndarray:
    """Imagen RGB tipo Marte para usar como textura provisional."""
    s = np.clip(shade, 0, 1)
    if albedo is not None:
        s = s * (0.75 + 0.25 * albedo)
    lo = np.array([60, 30, 18], dtype=np.float32)
    hi = np.array([222, 160, 112], dtype=np.float32)
    rgb = lo + (hi - lo) * s[..., None]
    return np.clip(rgb, 0, 255).astype(np.uint8)


def _hex(h: str):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]
