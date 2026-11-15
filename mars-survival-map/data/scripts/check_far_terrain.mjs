// Comprobacion del terreno lejano en 3D (engine/mola.js) sin navegador:  npm test
//   1. la elevacion MOLA decodificada coincide con la medida de Curiosity en su aterrizaje
//   2. el MOLA y el DEM del juego (HiRISE + CTX) casan en el borde del recorte (misma escala y datum)
//   3. escala real: tamano del crater, altura del monte Sharp y curvatura de Marte
//   4. la malla no tiene huecos, valores no finitos ni triangulos invertidos
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { MolaGrid, unpackElevation, MARS_RADIUS_M } from "../../src/engine/mola.js";
import { World } from "../../src/engine/world.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const buf = (p) => { const b = fs.readFileSync(path.join(ROOT, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? "  ->  " + detail : ""}`); if (!ok) failed++; };

const atlas = J("public/atlas/atlas.json"), region = J("public/layers/region.json"), layers = J("public/layers/layers.json");
const raster = atlas.rasters.find((r) => r.id === "gale");
const bytes = zlib.inflateSync(fs.readFileSync(path.join(ROOT, "public/atlas", raster.file)));
const yRef = layers.layers.dem.y_ref_m;
const mola = new MolaGrid(raster, unpackElevation(bytes, raster.w, raster.h, raster.q, atlas.offset_m), region, yRef);
const world = new World({ region, layers, rules: J("public/layers/rules.json"), dem: buf("public/layers/dem.bin"), grid: buf("public/layers/grid.bin") });

// 1. rango y punto de control
let mn = Infinity, mx = -Infinity;
for (const v of mola.elev) { if (v < mn) mn = v; if (v > mx) mx = v; }
check("rango de elevacion igual al de atlas.json", mn === raster.min && mx === raster.max, `${mn} .. ${mx} m`);
const D2R = Math.PI / 180, L = atlas.check.landing;
const lx = (L.lon - region.center.lon_east) * D2R * region.mars_radius_m * Math.cos(region.center.lat * D2R), lz = -(L.lat - region.center.lat) * D2R * region.mars_radius_m;
const eLand = mola.elevationAt(lx, lz);
check("aterrizaje de Curiosity: MOLA frente a la medida del rover", Math.abs(eLand - L.msl_elev_m) < 40, `MOLA ${eLand.toFixed(0)} m, rover ${L.msl_elev_m} m`);

// 2. continuidad con el DEM del juego a lo largo del borde del recorte
let sum = 0, sumAbs = 0, worst = 0, n = 0;
const lim = world.half - 6;
for (let t = -lim; t <= lim; t += 96) for (const [x, z] of [[t, -lim], [t, lim], [-lim, t], [lim, t]]) {
  const d = mola.elevationAt(x, z) - yRef - world.demHeight(x, z);
  sum += d; sumAbs += Math.abs(d); worst = Math.max(worst, Math.abs(d)); n++;
}
check("MOLA y DEM del juego casan en el borde (media < 60 m)", sumAbs / n < 60, `diferencia media ${(sum / n).toFixed(1)} m, media absoluta ${(sumAbs / n).toFixed(1)} m, maxima ${worst.toFixed(0)} m en ${n} puntos`);

// 3. escala real
const { positions, indices, radius } = mola.buildMesh(9000);
const kmEW = (mola.colX(mola.w - 1) - mola.colX(0)) / 1000, kmNS = (mola.rowZ(mola.h - 1) - mola.rowZ(0)) / 1000;
check("extension del terreno lejano a escala 1:1", kmEW > 380 && kmEW < 440 && kmNS > 360 && kmNS < 400, `${kmEW.toFixed(0)} km E-O x ${kmNS.toFixed(0)} km N-S (${(1000 * kmEW / mola.w).toFixed(0)} m por pixel)`);
// cima de Aeolis Mons (monte Sharp): el punto mas alto a menos de 60 km del recorte
let peak = -Infinity, px = 0, pz = 0, floor = Infinity;
for (let r = 0; r < mola.h; r++) for (let c = 0; c < mola.w; c++) {
  const x = mola.colX(c), z = mola.rowZ(r), e = mola.elev[r * mola.w + c];
  if (Math.hypot(x, z) < 60000) { if (e > peak) { peak = e; px = x; pz = z; } if (e < floor) floor = e; }
}
check("monte Sharp: ~5 km sobre el fondo del crater", peak - floor > 4500 && peak - floor < 6500, `cima ${peak} m, fondo ${floor} m, desnivel ${(peak - floor).toFixed(0)} m, a ${(Math.hypot(px, pz) / 1000).toFixed(1)} km del centro del mapa`);
const drop30 = mola.curvatureDrop(mola.half + 30000, 0), drop100 = mola.curvatureDrop(mola.half + 100000, 0);
check("curvatura de Marte: d^2 / (2R)", Math.abs(drop30 - 30000 ** 2 / (2 * MARS_RADIUS_M)) < 1e-6 && mola.curvatureDrop(100, -200) === 0, `cae ${drop30.toFixed(0)} m a 30 km y ${drop100.toFixed(0)} m a 100 km; 0 dentro del recorte`);
const eye = 2, horizon = Math.sqrt(2 * MARS_RADIUS_M * eye);
check("horizonte de un astronauta de pie en llano (~3,7 km)", horizon > 3500 && horizon < 3900, `${(horizon / 1000).toFixed(2)} km (en la Tierra serian ${(Math.sqrt(2 * 6371000 * eye) / 1000).toFixed(2)} km)`);

// 4. malla
let bad = 0;
for (const v of positions) if (!Number.isFinite(v)) bad++;
check("posiciones finitas", bad === 0, `${positions.length / 3} vertices`);
let flipped = 0, maxIdx = 0;
for (let i = 0; i < indices.length; i += 3) {
  const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
  maxIdx = Math.max(maxIdx, indices[i], indices[i + 1], indices[i + 2]);
  const ux = positions[b] - positions[a], uz = positions[b + 2] - positions[a + 2], vx = positions[c] - positions[a], vz = positions[c + 2] - positions[a + 2];
  if (uz * vx - ux * vz <= 0) flipped++;                // componente y de la normal: debe mirar hacia arriba
}
check("triangulos mirando hacia arriba e indices validos", flipped === 0 && maxIdx < positions.length / 3, `${indices.length / 3} triangulos`);
const full = (mola.w - 1) * (mola.h - 1) * 2;
check("el hueco bajo el faldon cercano quita pocos triangulos", indices.length / 3 < full && indices.length / 3 > full * 0.99, `${full - indices.length / 3} de ${full}`);
check("la malla cubre el horizonte en todas direcciones", radius > 150000, `${(radius / 1000).toFixed(0)} km`);

console.log(failed ? `\n${failed} comprobaciones fallidas` : "\nTodo correcto");
process.exit(failed ? 1 : 0);
