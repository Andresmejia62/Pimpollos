// Elige donde van las estructuras del mapa a partir de los datos de NASA ya procesados:
//   - traza real de Curiosity (data/raw/MSL_waypoints.json, JPL MMGIS) -> sitios de perforacion, balizas, rover
//   - pendiente (DTM HiRISE + CTX), radiacion (RAD), temperatura (REMS + THEMIS) y minerales (CRISM)
//     de public/layers/grid.bin -> terreno llano para construir, puntos altos para antenas, zonas frias, etc.
// Salida: public/layers/structures.json (lo carga el juego). Uso: npm run structures
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

const region = J("public/layers/region.json");
const L = J("public/layers/layers.json").layers;
const rules = J("public/layers/rules.json");
const objectives = J("public/layers/objectives.json").objectives;
const traverse = J("public/layers/traverse.json").points;         // [sol, x, z] dentro del recorte
const waypoints = J("data/raw/MSL_waypoints.json").features;

// ---- capas -------------------------------------------------------------------------------------
const N = region.grid_px, NN = N * N, PX = region.pixel_size_m, HALF = region.size_m / 2;
const grid = fs.readFileSync(path.join(ROOT, "public/layers/grid.bin"));
const order = L.binary.grid.order;
const plane = Object.fromEntries(order.map((k, i) => [k, grid.subarray(i * NN, (i + 1) * NN)]));
const demBuf = fs.readFileSync(path.join(ROOT, "public/layers/dem.bin"));
const dem = new Uint16Array(demBuf.buffer, demBuf.byteOffset, NN);
const demRange = L.dem.decode.max - L.dem.decode.min;
const dec = (k, v) => L[k].decode.min + (v / 255) * (L[k].decode.max - L[k].decode.min);
const clampI = (v) => Math.min(N - 1, Math.max(0, v));
const index = (x, z) => clampI(Math.round((z + HALF) / PX - 0.5)) * N + clampI(Math.round((x + HALF) / PX - 0.5));
const height = (x, z) => (dem[index(x, z)] / 65535) * demRange;
const slope = (x, z) => dec("slope", plane.slope[index(x, z)]);
const radiation = (x, z) => dec("radiation", plane.radiation[index(x, z)]);
const tempDay = (x, z) => dec("thermal", plane.thermal[index(x, z)]);
const spectral = (x, z) => plane.spectral[index(x, z)];
const BLOCKED = rules.hazards.slope.blocked_above_deg;
const SPECTRAL_NAME = Object.fromEntries(Object.entries(L.spectral.classes).map(([k, v]) => [k, { es: v.es, en: v.en }]));

// ---- conversion lat/lon -> mundo (misma proyeccion equirectangular local que region.json) -------
const R_MARS = region.mars_radius_m, LAT0 = region.center.lat, LON0 = region.center.lon_east, RAD = Math.PI / 180;
const toWorld = (lat, lon) => ({ x: (lon - LON0) * RAD * R_MARS * Math.cos(LAT0 * RAD), z: -(lat - LAT0) * RAD * R_MARS });

// ---- utilidades de emplazamiento ---------------------------------------------------------------
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const placed = [];                                   // {x, z, r}: huella de lo ya colocado
const hab = objectives.find((o) => o.id === "habitat").world;
// zonas que deben quedar libres: objetivos y refugios, salida del jugador y aparcamiento del Land Rover
const keepOut = [
  ...objectives.map((o) => ({ x: o.world.x, z: o.world.z, r: (o.radius_m || 15) + 12 })),
  { x: hab.x + 18, z: hab.z + 14, r: 12 }, { x: hab.x + 13, z: hab.z + 24, r: 12 },
];

// pendiente maxima dentro de la huella (radio foot)
function maxSlope(x, z, foot) {
  let m = slope(x, z);
  const k = Math.ceil(foot / PX) * PX, lim = foot + PX / 2;
  for (let dz = -k; dz <= k; dz += PX) for (let dx = -k; dx <= k; dx += PX) {
    if (dx * dx + dz * dz > lim * lim) continue;
    m = Math.max(m, slope(x + dx, z + dz));
  }
  return m;
}
function free(x, z, foot, gap = 6) {
  if (Math.abs(x) > HALF - 80 || Math.abs(z) > HALF - 80) return false;
  for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < p.r + foot + gap) return false;
  for (const k of keepOut) if (Math.hypot(k.x - x, k.z - z) < k.r + foot) return false;
  return true;
}
// Mejor celda alrededor de (cx, cz) entre rMin y rMax: huella libre y pendiente <= limit. Menor score gana.
function findSite(cx, cz, rMin, rMax, foot, limit, score = (x, z, d) => d) {
  let best = null;
  for (let dz = -rMax; dz <= rMax; dz += PX) for (let dx = -rMax; dx <= rMax; dx += PX) {
    const d = Math.hypot(dx, dz);
    if (d < rMin || d > rMax) continue;
    const x = Math.round(cx + dx), z = Math.round(cz + dz);
    if (!free(x, z, foot)) continue;
    const ms = maxSlope(x, z, foot);
    if (ms > limit || ms > BLOCKED) continue;
    const s = score(x, z, d, ms);
    if (!best || s < best.s) best = { x, z, s, slope: ms };
  }
  return best;
}

const out = [];
function add(type, site, foot, props) {
  if (!site) { console.warn("sin sitio para", type, props.id); return null; }
  placed.push({ x: site.x, z: site.z, r: foot });
  const e = {
    id: props.id, type, x: site.x, z: site.z,
    elevation_m: Math.round((height(site.x, site.z) + L.dem.y_ref_m) * 10) / 10,
    at_point: {
      slope_deg: Math.round(slope(site.x, site.z) * 10) / 10,
      radiation_ugy_h: Math.round(radiation(site.x, site.z) * 100) / 100,
      temperature_c: Math.round(tempDay(site.x, site.z) * 10) / 10,
      spectral_class: spectral(site.x, site.z),
    },
    ...props,
  };
  out.push(e);
  return e;
}

// posicion de Curiosity en un sol dado: ultimo punto de la traza con sol <= s
function trackAt(sol) {
  let p = null;
  for (const t of traverse) { if (t[0] <= sol) p = t; else break; }
  return p ? { sol: p[0], x: p[1], z: p[2] } : null;
}

// ---- 1. Base Aeolis: lo que rodea al habitat ----------------------------------------------------
add("landing_pad", findSite(hab.x, hab.z, 60, 170, 16, 8, (x, z, d, ms) => ms * 30 + d), 16, {
  id: "pad_aeolis", name: { es: "Plataforma de aterrizaje y vehículo de ascenso", en: "Landing pad and ascent vehicle" },
  info: { es: "El terreno más llano a menos de 170 m del hábitat según el DTM de HiRISE. El vehículo de ascenso fabrica su combustible con CO₂ marciano.", en: "The flattest ground within 170 m of the habitat according to the HiRISE DTM. The ascent vehicle makes its propellant from Martian CO₂." },
  source: "DTM HiRISE + CTX (pendiente)",
});
add("solar_farm", findSite(hab.x, hab.z, 40, 130, 13, 9, (x, z, d, ms) => ms * 20 + d), 13, {
  id: "solar_aeolis", name: { es: "Campo solar", en: "Solar farm" },
  info: { es: "Marte recibe ~43 % de la luz solar que llega a la Tierra y el polvo cubre los paneles: por eso están inclinados y son tantos.", en: "Mars gets ~43% of the sunlight Earth does and dust coats the panels: that is why they are tilted and there are so many." },
  source: "NASA Mars Fact Sheet",
});
add("isru", findSite(hab.x, hab.z, 36, 110, 9, 10), 9, {
  id: "isru_aeolis", name: { es: "Planta de oxígeno ISRU", en: "ISRU oxygen plant" },
  info: { es: "Versión grande de MOXIE, el instrumento de Perseverance que en 2021 produjo oxígeno a partir del CO₂ de la atmósfera marciana.", en: "A scaled-up MOXIE, the Perseverance instrument that made oxygen from Martian atmospheric CO₂ in 2021." },
  source: "NASA/JPL MOXIE (Mars 2020)",
});
add("greenhouse", findSite(hab.x, hab.z, 34, 100, 8, 10), 8, {
  id: "greenhouse_aeolis", name: { es: "Invernadero", en: "Greenhouse" },
  info: { es: "El regolito marciano contiene percloratos tóxicos: aquí se cultiva en sustrato lavado y bajo presión.", en: "Martian regolith contains toxic perchlorates: crops here grow in washed soil and under pressure." },
  source: "NASA Phoenix / Curiosity SAM (percloratos)",
});

// ---- 2. Sitios de perforacion reales de Curiosity dentro del recorte ------------------------------
// Nombres y soles aproximados de las perforaciones (el rover pasa semanas en cada sitio, asi que
// unos pocos soles de error no cambian la posicion). La posicion sale de la traza oficial.
const DRILLS = [
  ["Kilmarie", 2384, { es: "Unidad de arcillas de Glen Torridon: las muestras con más minerales de arcilla de la misión.", en: "Glen Torridon clay-bearing unit: the most clay-rich samples of the mission." }],
  ["Hutton", 2668, { es: "Justo bajo el pedimento Greenheugh, al final de Glen Torridon.", en: "Just below the Greenheugh pediment, at the end of Glen Torridon." }],
  ["Edinburgh", 2711, { es: "Arenisca de la cima del pedimento Greenheugh: dunas antiguas convertidas en roca.", en: "Sandstone capping the Greenheugh pediment: ancient dunes turned to rock." }],
  ["Glasgow", 2754, { es: "Unidad de arcillas de Glen Torridon.", en: "Glen Torridon clay-bearing unit." }],
  ["Mary Anning", 2838, { es: "Aquí SAM hizo su experimento de química húmeda en busca de moléculas orgánicas.", en: "SAM ran its wet-chemistry experiment here, searching for organic molecules." }],
  ["Nontron", 3056, { es: "Transición entre las arcillas y los sulfatos: el clima de Marte empezaba a secarse.", en: "The clay-to-sulfate transition: Mars' climate was starting to dry out." }],
  ["Pontours", 3170, { es: "Subida hacia el pedimento por Maria Gordon Notch.", en: "The climb towards the pediment through Maria Gordon Notch." }],
  ["Zechstein", 3289, { es: "Roca bajo el pedimento Greenheugh.", en: "Bedrock beneath the Greenheugh pediment." }],
  ["Avanavero", 3512, { es: "Paso Paraitepuy, en la entrada a la unidad de sulfatos.", en: "Paraitepuy Pass, at the entrance to the sulfate-bearing unit." }],
  ["Canaima", 3612, { es: "Primera muestra de la unidad de sulfatos: sales que dejó el agua al evaporarse.", en: "First sample of the sulfate-bearing unit: salts left behind as water evaporated." }],
  ["Tapo Caparo", 3752, { es: "Banda marcadora: una capa dura y oscura con ondulaciones dejadas por olas de un lago.", en: "Marker band: a hard dark layer with ripples left by lake waves." }],
  ["Ubajara", 3823, { es: "Sulfatos por encima de la banda marcadora; aquí SAM midió carbono orgánico.", en: "Sulfates above the marker band; SAM measured organic carbon here." }],
  ["Sequoia", 3980, { es: "Unidad de sulfatos, camino del canal Gediz Vallis.", en: "Sulfate-bearing unit, on the way to the Gediz Vallis channel." }],
];
for (const [name, sol, info] of DRILLS) {
  const p = trackAt(sol);
  if (!p) continue;
  const site = findSite(p.x, p.z, 0, 30, 3, 22);
  add("drill_site", site, 3, {
    id: "drill_" + name.toLowerCase().replace(/\s+/g, "_"),
    name: { es: `Perforación «${name}»`, en: `"${name}" drill site` },
    info, msl_sol: sol, sol_note: "sol aproximado; posición de la traza oficial en ese sol",
    mineral: SPECTRAL_NAME[spectral(p.x, p.z)], source: "Traza MSL (JPL MMGIS) + CRISM",
  });
}

// ---- 3. Recorrido de la expedicion: longitud acumulada sobre la traza desde el habitat ------------
const iStart = traverse.findIndex((t) => t[0] >= 2320);
const path_ = [];
let acc = 0;
for (let i = iStart; i < traverse.length; i++) {
  if (i > iStart) acc += Math.hypot(traverse[i][1] - traverse[i - 1][1], traverse[i][2] - traverse[i - 1][2]);
  path_.push({ sol: traverse[i][0], x: traverse[i][1], z: traverse[i][2], d: acc });
}
const along = (d) => path_.find((p) => p.d >= d) || path_[path_.length - 1];
const shelters = objectives.filter((o) => o.shelter).map((o) => o.world);

// antenas repetidoras: el punto mas alto y despejado cerca de la traza, cada ~2,6 km
for (let d = 900, k = 1; d < acc - 300; d += 2600, k++) {
  const p = along(d);
  const site = findSite(p.x, p.z, 0, 170, 4, 13, (x, z) => -height(x, z) - radiation(x, z) * 40);
  add("relay", site, 4, {
    id: "relay_" + k, name: { es: `Repetidora ${k}`, en: `Relay ${k}` },
    info: { es: "Colocada en el punto más alto y con más cielo visible de la zona: cuanto más cielo, mejor enlace con los orbitadores (y más radiación).", en: "Placed on the highest spot with the most open sky nearby: more sky means a better link to the orbiters (and more radiation)." },
    near_sol: p.sol, source: "DTM HiRISE + CTX, capa de radiación (RAD)",
  });
}

// depositos de suministros: terreno llano y protegido de la radiacion, cada ~2 km, lejos de los refugios
for (let d = 1200, k = 1; d < acc - 200; d += 2000) {
  const p = along(d);
  if (shelters.some((s) => dist(s, p) < 260)) continue;
  const site = findSite(p.x, p.z, 10, 80, 7, 8, (x, z, dd) => radiation(x, z) * 300 + dd);
  if (add("depot", site, 7, {
    id: "depot_" + k, name: { es: `Depósito de suministros ${k}`, en: `Supply cache ${k}` },
    info: { es: "Carga lanzada antes de la expedición. Las cajas pesan aquí un 38 % de lo que pesarían en la Tierra, pero cuesta lo mismo empujarlas y frenarlas: la masa no cambia.", en: "Cargo dropped ahead of the expedition. Crates weigh 38% of their Earth weight here, but they are just as hard to push and stop: mass does not change." },
    near_sol: p.sol, source: "DTM HiRISE + CTX, capa de radiación (RAD)",
  })) k++;
}

// estaciones meteorologicas tipo REMS: el punto mas frio, el mas expuesto y una junto a la base
const corridor = (score) => {
  let best = null;
  for (const p of path_) {
    const s = findSite(p.x, p.z, 0, 120, 3, 12, score);
    if (s && (!best || s.s < best.s)) best = s;
  }
  return best;
};
add("weather", corridor((x, z) => tempDay(x, z)), 3, {
  id: "meteo_frio", name: { es: "Estación meteorológica «Trampa de frío»", en: "\"Cold trap\" weather station" },
  info: { es: "El suelo más frío a media mañana cerca de la ruta, según el mapa térmico. REMS, la estación de Curiosity, mide de −90 °C de noche a unos 0 °C de día.", en: "The coldest mid-morning ground near the route on the thermal map. REMS, Curiosity's weather station, records from −90 °C at night to about 0 °C by day." },
  source: "REMS (Curiosity) + THEMIS",
});
add("weather", corridor((x, z) => -radiation(x, z)), 3, {
  id: "meteo_radiacion", name: { es: "Estación de radiación «Cielo abierto»", en: "\"Open sky\" radiation station" },
  info: { es: "El punto de la ruta más expuesto al cielo. Marte no tiene campo magnético global ni atmósfera densa: RAD mide aquí ~0,21 mGy al día.", en: "The spot on the route most exposed to the sky. Mars has no global magnetic field or thick atmosphere: RAD measures ~0.21 mGy per day here." },
  source: "RAD (Curiosity)",
});
add("weather", findSite(hab.x, hab.z, 45, 140, 3, 12), 3, {
  id: "meteo_base", name: { es: "Estación meteorológica de la base", en: "Base weather station" },
  info: { es: "Presión de unos 7 mbar: menos del 1 % de la terrestre. El viento apenas empuja, aunque levante polvo.", en: "Pressure of about 7 mbar: under 1% of Earth's. The wind barely pushes, even when it lifts dust." },
  source: "REMS (Curiosity)",
});

// sismometro tipo SEIS: el suelo mas llano y tranquilo cerca de los sulfatos, apartado de la ruta
const sulf = objectives.find((o) => o.id === "obj_sulfatos").world;
add("seismic", findSite(sulf.x, sulf.z, 70, 240, 5, 6, (x, z, d, ms) => ms * 40 + d * 0.2), 5, {
  id: "sismo_1", name: { es: "Sismómetro", en: "Seismometer" },
  info: { es: "Como SEIS, de la misión InSight, que registró más de 1300 martemotos. Va bajo una cúpula que lo protege del viento y del frío.", en: "Like SEIS on the InSight mission, which recorded over 1,300 marsquakes. It sits under a dome that shields it from wind and cold." },
  source: "NASA InSight (SEIS)",
});

// ---- 4. Curiosity: ultima posicion de la traza bien dentro del mapa, con su orientacion real ------
{
  let wp = null;
  for (const f of waypoints) {
    const w = toWorld(f.properties.lat, f.properties.lon);
    if (Math.abs(w.x) < HALF - 160 && Math.abs(w.z) < HALF - 160) wp = { ...w, sol: f.properties.sol, yaw: f.properties.yaw, elev: f.properties.elev_geoid, km: f.properties.dist_km };
  }
  const site = findSite(wp.x, wp.z, 0, 25, 3, 20);
  add("curiosity", site, 3, {
    id: "curiosity", name: { es: "Rover Curiosity (MSL)", en: "Curiosity rover (MSL)" },
    info: { es: `Aquí estaba Curiosity en el sol ${wp.sol}, tras ${String(wp.km).replace(".", ",")} km de recorrido desde su aterrizaje en 2012. Pesa 899 kg en la Tierra; en Marte sus ruedas cargan como si fueran 340.`, en: `Curiosity was here on sol ${wp.sol}, after driving ${wp.km} km since landing in 2012. It weighs 899 kg on Earth; on Mars its wheels carry the equivalent of 340.` },
    msl_sol: wp.sol, heading_rad: Math.round(-wp.yaw * RAD * 1000) / 1000, source: "Traza MSL (JPL MMGIS): posición y rumbo reales",
  });
}

// ---- 5. Balizas sobre las huellas de Curiosity, cada ~170 m ---------------------------------------
const posts = [];
{
  let last = null, run = 1e9;
  for (const t of traverse) {
    const p = { x: t[1], z: t[2] };
    if (last) run += dist(p, last);
    last = p;
    if (run < 170) continue;
    const x = Math.round(p.x * 10) / 10, z = Math.round(p.z * 10) / 10;
    if (!free(x, z, 1, 3) || slope(x, z) > BLOCKED) continue;
    if (posts.some((q) => Math.hypot(q[0] - x, q[1] - z) < 90)) continue;
    posts.push([x, z, t[0]]);
    run = 0;
  }
}

const doc = {
  _doc: "Estructuras del mapa. Generado por data/scripts/build_structures.mjs a partir de la traza de Curiosity y de las capas del recorte. x = Este, z = Sur (metros, origen en el centro).",
  sources: ["NASA/JPL MMGIS MSL_waypoints.json", "MRO HiRISE + CTX (DTM, pendiente)", "MSL RAD (radiación)", "MSL REMS + Odyssey THEMIS (temperatura)", "MRO CRISM (minerales)"],
  structures: out,
  track_posts: { _doc: "[x, z, sol]: balizas sobre la traza de Curiosity", spacing_m: 170, points: posts },
};
fs.writeFileSync(path.join(ROOT, "public/layers/structures.json"), JSON.stringify(doc, null, 1));
const byType = {};
for (const e of out) byType[e.type] = (byType[e.type] || 0) + 1;
console.log("structures.json:", out.length, "estructuras", byType, "+", posts.length, "balizas");
for (const e of out) console.log(" ", e.type.padEnd(12), e.id.padEnd(22), String(e.x).padStart(6), String(e.z).padStart(6), "pend", e.at_point.slope_deg, "rad", e.at_point.radiation_ugy_h, e.msl_sol || e.near_sol || "");
