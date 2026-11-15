// Datos comunes de las estructuras del mapa (public/layers/structures.json) para el HUD y el atlas:
// nombre de cada tipo, icono corto y la fila de datos medidos en su punto (DEM, RAD, REMS/THEMIS, CRISM).
import { t, getLang } from "./i18n.js";
import { num } from "./geo.js";

const L = (es, en) => ({ es, en });

export const STRUCT_TYPES = {
  landing_pad: { name: L("Plataforma de aterrizaje", "Landing pad"), icon: "▲" },
  solar_farm: { name: L("Campo solar", "Solar farm"), icon: "☀" },
  isru: { name: L("Planta ISRU", "ISRU plant"), icon: "O₂" },
  greenhouse: { name: L("Invernadero", "Greenhouse"), icon: "✿" },
  drill_site: { name: L("Perforación de Curiosity", "Curiosity drill site"), icon: "◎" },
  relay: { name: L("Repetidora", "Relay"), icon: "⌁" },
  depot: { name: L("Depósito de suministros", "Supply cache"), icon: "▣" },
  weather: { name: L("Estación meteorológica", "Weather station"), icon: "≋" },
  seismic: { name: L("Sismómetro", "Seismometer"), icon: "∿" },
  curiosity: { name: L("Rover Curiosity", "Curiosity rover"), icon: "◆" },
  fission: { name: L("Reactor de fisión", "Fission reactor"), icon: "☢" },
  comm_dish: { name: L("Antena de espacio profundo", "Deep-space antenna"), icon: "◠" },
  inflatable: { name: L("Módulo inflable", "Inflatable module"), icon: "⬭" },
  workshop: { name: L("Taller de vehículos", "Vehicle workshop"), icon: "⚙" },
  heli_pad: { name: L("Helipuerto", "Helipad"), icon: "H" },
  water_extractor: { name: L("Extractor de agua", "Water extractor"), icon: "💧" },
  sample_cache: { name: L("Depósito de muestras", "Sample depot"), icon: "▥" },
};

export const typeName = (e) => t((STRUCT_TYPES[e.type] || {}).name || L("Estructura", "Structure"));
export const typeIcon = (e) => (STRUCT_TYPES[e.type] || {}).icon || "■";

// Fila de datos medidos en el punto de la estructura, con la fuente de cada uno
export function pointFacts(e) {
  const p = e.at_point || {}, lang = getLang();
  const out = [];
  if (e.elevation_m != null) out.push([t(L("Elevación", "Elevation")), `${num(e.elevation_m, 0, lang)} m`, "DTM HiRISE+CTX"]);
  if (p.slope_deg != null) out.push([t(L("Pendiente", "Slope")), `${num(p.slope_deg, 1, lang)}°`, "DTM HiRISE+CTX"]);
  if (p.radiation_ugy_h != null) out.push([t(L("Radiación", "Radiation")), `${num(p.radiation_ugy_h, 2, lang)} µGy/h`, "MSL RAD"]);
  if (p.temperature_c != null) out.push([t(L("Suelo (día)", "Ground (day)")), `${num(p.temperature_c, 0, lang)} °C`, "REMS + THEMIS"]);
  if (e.msl_sol) out.push([t(L("Sol de Curiosity", "Curiosity sol")), String(e.msl_sol), "JPL MMGIS"]);
  return out;
}
