"""Recorte geografico compartido y conversiones de coordenadas.

Una sola fuente de verdad: data/region.json. Todo (capas, objetivos, terreno de
Blender, motor web) se alinea con esta cuadricula.

Convenciones de la cuadricula (contrato con M1 y M2):
  - Imagen de grid_px x grid_px. Fila 0 = borde NORTE, columna 0 = borde OESTE.
  - Mundo 3D (metros, Three.js y-arriba): origen en el centro del recorte,
      x = Este, z = Sur, y = elevacion - y_ref_m (y_ref_m esta en layers.json).
  - Centro del pixel (fila r, col c):
      x = (c + 0.5) * pixel_size - size/2
      z = (r + 0.5) * pixel_size - size/2
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGION_SRC = ROOT / "data" / "region.json"


class Region:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.R = float(cfg["mars_radius_m"])
        self.lat0 = float(cfg["center"]["lat"])
        self.lon0 = float(cfg["center"]["lon_east"])
        self.size = float(cfg["size_m"])
        self.n = int(cfg["grid_px"])
        self.px = self.size / self.n
        if abs(self.px - float(cfg["pixel_size_m"])) > 1e-9:
            raise ValueError("pixel_size_m no coincide con size_m / grid_px")
        self.m_per_deg_lat = 2 * math.pi * self.R / 360.0
        self.m_per_deg_lon = self.m_per_deg_lat * math.cos(math.radians(self.lat0))
        half = self.size / 2
        self.north = self.lat0 + half / self.m_per_deg_lat
        self.south = self.lat0 - half / self.m_per_deg_lat
        self.west = self.lon0 - half / self.m_per_deg_lon
        self.east = self.lon0 + half / self.m_per_deg_lon

    @classmethod
    def load(cls, path: Path = REGION_SRC) -> "Region":
        return cls(json.loads(Path(path).read_text(encoding="utf-8")))

    # --- conversiones -------------------------------------------------------
    def px_to_world(self, row: float, col: float):
        return ((col + 0.5) * self.px - self.size / 2,
                (row + 0.5) * self.px - self.size / 2)

    def world_to_px(self, x: float, z: float):
        return (z + self.size / 2) / self.px - 0.5, (x + self.size / 2) / self.px - 0.5

    def latlon_to_world(self, lat: float, lon: float):
        return ((lon - self.lon0) * self.m_per_deg_lon,
                -(lat - self.lat0) * self.m_per_deg_lat)

    def world_to_latlon(self, x: float, z: float):
        return (self.lat0 - z / self.m_per_deg_lat, self.lon0 + x / self.m_per_deg_lon)

    def contains_world(self, x: float, z: float) -> bool:
        h = self.size / 2
        return -h <= x <= h and -h <= z <= h

    # --- salida para el equipo ----------------------------------------------
    def to_public(self) -> dict:
        out = {k: v for k, v in self.cfg.items() if not k.startswith("_")}
        out["bounds"] = {
            "north_lat": round(self.north, 6), "south_lat": round(self.south, 6),
            "west_lon_east": round(self.west, 6), "east_lon_east": round(self.east, 6),
        }
        out["grid"] = {
            "rows": self.n, "cols": self.n, "pixel_size_m": self.px,
            "row0": "borde norte", "col0": "borde oeste",
        }
        out["world"] = {
            "units": "metros", "up": "y",
            "origin": "centro del recorte",
            "x": "Este (+)", "z": "Sur (+)",
            "y": "elevacion_m - y_ref_m (ver layers.json -> dem.y_ref_m)",
            "pixel_center_to_world": "x = (col+0.5)*pixel_size - size_m/2 ; z = (row+0.5)*pixel_size - size_m/2",
            "texture_uv": "u = x/size_m + 0.5 (oeste->este); v_imagen = z/size_m + 0.5 (fila 0 = norte). En Three.js usar texture.flipY segun la orientacion del plano.",
        }
        return out
