// Geodesia de Marte: conversion mundo <-> latitud/longitud, distancias sobre la esfera y atmosfera.
// Sistema: planetocentrico, longitud Este 0-360 (el que usa USGS/IAU para Marte y los productos MOLA).
// El recorte del juego usa una proyeccion equirectangular local (region.json -> crs) sobre la esfera IAU R = 3 396 190 m.

export const MARS_GEO = {
  R_eq: 3396190,        // radio ecuatorial IAU (m), el de la proyeccion del recorte
  R_mean: 3389500,      // radio medio (m), para distancias de circulo maximo
  g: 3.721,             // m/s^2
  P0: 610,              // Pa, presion media en el datum (areoide MOLA, elevacion 0)
  H: 11100,             // m, altura de escala de la atmosfera (CO2, ~210 K)
  triple_pa: 611.657,   // Pa, punto triple del agua
};
const D2R = Math.PI / 180;

export class GeoFrame {
  // region = public/layers/region.json
  constructor(region) {
    this.lat0 = region.center.lat;
    this.lon0 = region.center.lon_east;
    this.R = region.mars_radius_m || MARS_GEO.R_eq;
    this.cos0 = Math.cos(this.lat0 * D2R);
    this.bounds = region.bounds;
  }
  // x = Este (m), z = Sur (m) desde el centro del recorte
  toLatLon(x, z) {
    return { lat: this.lat0 - (z / this.R) / D2R, lon: wrapLon(this.lon0 + (x / (this.R * this.cos0)) / D2R) };
  }
  toWorld(lat, lon) {
    let dl = lon - this.lon0;
    if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
    return { x: dl * D2R * this.R * this.cos0, z: -(lat - this.lat0) * D2R * this.R };
  }
  contains(lat, lon) {
    const b = this.bounds;
    return lat <= b.north_lat && lat >= b.south_lat && lon >= b.west_lon_east && lon <= b.east_lon_east;
  }
}

export const wrapLon = (l) => ((l % 360) + 360) % 360;

// Distancia de circulo maximo (haversine), en metros
export function gcDistance(lat1, lon1, lat2, lon2, R = MARS_GEO.R_mean) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dp = p2 - p1, dl = (lon2 - lon1) * D2R;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
// Rumbo inicial (azimut desde el norte, sentido horario), grados 0-360
export function gcBearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}
// Punto intermedio (fraccion f) sobre el circulo maximo
export function gcInterpolate(lat1, lon1, lat2, lon2, f) {
  const p1 = lat1 * D2R, l1 = lon1 * D2R, p2 = lat2 * D2R, l2 = lon2 * D2R;
  const d = gcDistance(lat1, lon1, lat2, lon2, 1);
  if (d < 1e-12) return { lat: lat1, lon: lon1 };
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) / D2R, lon: wrapLon(Math.atan2(y, x) / D2R) };
}

// ---- atmosfera (modelo hidrostatico isotermo) -----------------------------------------
// P(h) = P0 * exp(-h / H). En la realidad varia ~±12 % a lo largo del ano porque el CO2 se congela en los polos
// (REMS en Gale: ~700-930 Pa). Es una estimacion, no una medida.
export const pressureAt = (elev_m) => MARS_GEO.P0 * Math.exp(-elev_m / MARS_GEO.H);
// Masa de la columna de aire sobre el punto (g/cm^2): el "blindaje" atmosferico contra la radiacion cosmica
export const columnMass = (p_pa) => p_pa / MARS_GEO.g / 10;
// Punto de ebullicion del agua (Clausius-Clapeyron, L = 40,65 kJ/mol). Por debajo del punto triple no hay agua liquida.
export function boilingPointC(p_pa) {
  if (p_pa < MARS_GEO.triple_pa) return null;
  const T = 1 / (1 / 373.15 - (8.314 / 40650) * Math.log(p_pa / 101325));
  return T - 273.15;
}

// ---- formato -----------------------------------------------------------------------
export function fmtLat(lat, d = 5) { return `${Math.abs(lat).toFixed(d)}° ${lat < 0 ? "S" : "N"}`; }
export function fmtLon(lon, d = 5) { return `${wrapLon(lon).toFixed(d)}° E`; }
export function fmtDMS(v, pos, neg) {
  const a = Math.abs(v), deg = Math.floor(a), mf = (a - deg) * 60, m = Math.floor(mf), s = (mf - m) * 60;
  return `${deg}°${String(m).padStart(2, "0")}′${s.toFixed(1).padStart(4, "0")}″${v < 0 ? neg : pos}`;
}
export function fmtDist(m, lang = "es") {
  const dec = lang === "es" ? "," : ".";
  if (m >= 100000) return Math.round(m / 1000).toLocaleString(lang === "es" ? "es" : "en") + " km";
  if (m >= 1000) return (m / 1000).toFixed(m >= 10000 ? 1 : 2).replace(".", dec) + " km";
  return Math.round(m) + " m";
}
export const num = (v, d = 0, lang = "es") => v.toFixed(d).replace(".", lang === "es" ? "," : ".");
