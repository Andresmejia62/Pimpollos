// Atlas de Marte (mapa grande): elevacion real MOLA (Mars Global Surveyor) y traza completa de Curiosity.
// Sin dependencias: solo Node (zlib para el PNG).
//
//   node data/scripts/build_atlas.mjs            # descarga lo que falte a data/raw/mola/ y genera public/atlas/
//
// Productos (NASA PDS Geosciences Node, MGS MOLA MEGDR, "topography" = m sobre el areoide):
//   - megt90n000eb.img : global 16 pix/grado (~3,7 km/px). Se promedia a 8 pix/grado para la web.
//   - megt00n000gb.img : 64 pix/grado (~925 m/px), 0..90 S, 0..180 E. Solo se descargan (HTTP Range) las
//     filas del recorte del crater Gale.
// Salida (*.z, zlib): elevacion cuantizada u = round((elev_m + OFFSET) / q), codificada por filas como diferencia
// con el pixel de la izquierda (zigzag), en dos planos de bytes (alto y bajo). Asi comprime ~2x mejor que un PNG.
// El navegador la descomprime (DecompressionStream "deflate"), reconstruye la altura y calcula el relieve sombreado,
// asi el mapa tambien sirve para leer la elevacion real en cualquier punto.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const RAW = path.join(ROOT, "data/raw/mola");
const OUT = path.join(ROOT, "public/atlas");
const PDS = "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x";
const OFFSET = 10000; // elevacion minima de Marte ~ -8200 m (Hellas)

const GLOBAL = { file: "megt90n000eb.img", url: `${PDS}/meg016/megt90n000eb.img`, lines: 2880, samples: 5760, ppd: 16 };
// recorte de Gale en el producto de 64 pix/grado: filas 128..543 (2,0 S .. 8,5 S), columnas 8608..9055 (134,5 E .. 141,5 E)
const GALE = { file: "gale_rows128_544_64ppd.bin", url: `${PDS}/meg064/megt00n000gb.img`, recordBytes: 23040, row0: 128, row1: 544, col0: 8608, col1: 9056, ppd: 64 };

async function download(url, dest, range) {
  if (fs.existsSync(dest)) return;
  console.log("descargando", url, range || "");
  const r = await fetch(url, range ? { headers: { Range: `bytes=${range[0]}-${range[1]}` } } : {});
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

// ---- empaquetado de la elevacion ---------------------------------------------------------
function packElev(w, h, elev, q) {
  const hi = Buffer.alloc(w * h), lo = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    let prev = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const u = Math.round((elev[i] + OFFSET) / q);
      let d = u - prev; prev = u;
      d = d >= 0 ? 2 * d : -2 * d - 1;
      hi[i] = (d >> 8) & 255; lo[i] = d & 255;
    }
  }
  return zlib.deflateSync(Buffer.concat([hi, lo]), { level: 9 });
}
function stats(a) { let mn = Infinity, mx = -Infinity; for (const v of a) { if (v < mn) mn = v; if (v > mx) mx = v; } return { min: mn, max: mx }; }

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  await download(GLOBAL.url, path.join(RAW, GLOBAL.file));
  await download(GALE.url, path.join(RAW, GALE.file), [GALE.row0 * GALE.recordBytes, GALE.row1 * GALE.recordBytes - 1]);

  // ---- global: 16 -> 8 pix/grado (media de 2x2) --------------------------------------
  const g = fs.readFileSync(path.join(RAW, GLOBAL.file));
  if (g.length !== GLOBAL.lines * GLOBAL.samples * 2) throw new Error("tamano inesperado del MEGDR global");
  const W = GLOBAL.samples / 2, H = GLOBAL.lines / 2;
  const glob = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) s += g.readInt16BE(((2 * y + dy) * GLOBAL.samples + 2 * x + dx) * 2);
    glob[y * W + x] = s / 4;
  }
  fs.writeFileSync(path.join(OUT, "mola_global.z"), packElev(W, H, glob, 4));

  // ---- Gale: recorte a 64 pix/grado -------------------------------------------------
  const gb = fs.readFileSync(path.join(RAW, GALE.file));
  const gw = GALE.col1 - GALE.col0, gh = GALE.row1 - GALE.row0;
  const gale = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) gale[y * gw + x] = gb.readInt16BE(y * GALE.recordBytes + (GALE.col0 + x) * 2);
  fs.writeFileSync(path.join(OUT, "mola_gale.z"), packElev(gw, gh, gale, 1));

  // ---- traza completa de Curiosity (MMGIS) y paradas por sol ----------------------------
  const wp = JSON.parse(fs.readFileSync(path.join(ROOT, "data/raw/MSL_waypoints.json"), "utf8")).features.map((f) => f.properties);
  wp.sort((a, b) => a.sol - b.sol || a.dist_total_m - b.dist_total_m);
  const traverse = wp.map((p) => [+p.lat.toFixed(6), +p.lon.toFixed(6), Math.round(p.elev_geoid * 10) / 10, p.sol]);
  // ultima posicion registrada en o antes de ese sol (el rover queda quieto mientras perfora)
  const atSol = (sol) => { let best = null; for (const p of wp) if (p.sol <= sol) best = p; return best; };
  const DRILLS = [
    // Wikipedia, "Timeline of Mars Science Laboratory" -> holes drilled (verificado 2026-11-14)
    ["Glen Etive 1", 2488, "Glen Torridon · arcillas"], ["Hutton", 2671, "Glen Torridon"], ["Edinburgh", 2714, "Pedimento Greenheugh"],
    ["Glasgow", 2754, "Glen Torridon"], ["Mary Anning", 2838, "Glen Torridon"], ["Groken", 2910, "Glen Torridon"],
    ["Nontron", 3057, "Mont Mercou · transición arcillas/sulfatos"], ["Bardou", 3094, "Mont Mercou"], ["Pontours", 3170, "Transición"],
    ["Maria Gordon", 3229, "Transición"], ["Zechstein", 3289, "Transición"], ["Avanavero", 3512, "Marker band"],
    ["Canaima", 3612, "Unidad de sulfatos (1.ª perforación)"], ["Tapo Caparo", 3752, "Unidad de sulfatos"], ["Ubajara", 3823, "Unidad de sulfatos"],
    ["Sequoia", 3982, "Cresta de Gediz Vallis"], ["Mineral King", 4110, "Gediz Vallis"], ["Mammoth Lakes 2", 4218, "Canal Gediz Vallis"],
    ["Kings Canyon", 4263, "Canal Gediz Vallis"], ["Altadena", 4564, "Unidad de sulfatos superior"], ["Valle de la Luna", 4695, "Región boxwork"],
    ["Nevado Sajama", 4718, "Región boxwork"],
  ];
  const drills = DRILLS.map(([name, sol, unit]) => {
    const p = atSol(sol);
    return p && { name, sol, unit, lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), elev_m: Math.round(p.elev_geoid * 10) / 10, waypoint_sol: p.sol };
  }).filter(Boolean);
  const land = wp[0];

  const sample = (a, w, h, lat, lon, lat0, lon0, ppd) => a[Math.round((lat0 - lat) * ppd - 0.5) * w + Math.round((lon - lon0) * ppd - 0.5)];
  const meta = {
    _doc: "Generado por data/scripts/build_atlas.mjs. Elevacion = u*q - offset_m (ver cabecera del script para el formato), en metros sobre el areoide MOLA. Pixel (col, fila) -> lon = lon_west + (col+0.5)/ppd, lat = lat_north - (fila+0.5)/ppd.",
    offset_m: OFFSET,
    mars: { radius_mean_m: 3389500, radius_equatorial_m: 3396190, g_ms2: 3.721, datum_pressure_pa: 610, scale_height_m: 11100 },
    rasters: [
      { id: "global", file: "mola_global.z", w: W, h: H, q: 4, ppd: 8, lat_north: 90, lon_west: 0, ...stats(glob),
        source: "MGS MOLA MEGDR megt90n000eb (16 pix/grado), promediado a 8 pix/grado", url: GLOBAL.url },
      { id: "gale", file: "mola_gale.z", w: gw, h: gh, q: 1, ppd: 64, lat_north: -GALE.row0 / 64, lon_west: GALE.col0 / 64, ...stats(gale),
        source: "MGS MOLA MEGDR megt00n000gb (64 pix/grado), recorte", url: GALE.url },
    ],
    check: {
      _doc: "Elevacion MOLA en la posicion de aterrizaje de Curiosity frente a su propia medida (elev_geoid).",
      landing: { lat: land.lat, lon: land.lon, msl_elev_m: land.elev_geoid, mola_gale_m: sample(gale, gw, gh, land.lat, land.lon, -GALE.row0 / 64, GALE.col0 / 64, 64) },
    },
    curiosity_landing: { lat: land.lat, lon: land.lon, sol: land.sol },
  };
  fs.writeFileSync(path.join(OUT, "atlas.json"), JSON.stringify(meta, null, 1));
  fs.writeFileSync(path.join(OUT, "msl_traverse.json"), JSON.stringify({ source: "NASA/JPL MMGIS MSL_waypoints.json", fields: ["lat", "lon", "elev_m", "sol"], points: traverse }));
  fs.writeFileSync(path.join(OUT, "msl_drills.json"), JSON.stringify({ source: "Posicion: NASA/JPL MMGIS MSL_waypoints.json (ultima parada en o antes del sol). Nombre y sol: registro de perforaciones de MSL.", drills }, null, 1));
  for (const f of fs.readdirSync(OUT)) console.log(f, fs.statSync(path.join(OUT, f)).size);
  console.log(JSON.stringify(meta.rasters.map(({ id, min, max }) => ({ id, min, max }))), JSON.stringify(meta.check.landing));
}

main().catch((e) => { console.error(e); process.exit(1); });
