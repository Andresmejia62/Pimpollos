// Fase 1: contratos de los datos cientificos y huellas SHA-256 de los archivos protegidos.
// tests/baseline_hashes.txt se genero ANTES de modificar codigo (data/raw, public/layers, public/atlas).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, ok, summary, loadData } from "./helpers.mjs";
import { World } from "../src/engine/world.js";

// ---- huellas ----
const lines = fs.readFileSync(path.join(ROOT, "tests/baseline_hashes.txt"), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
let same = 0;
const changed = [];
for (const l of lines) {
  const [hash, ...rest] = l.split(/\s+/);
  const f = rest.join(" ");
  const h = crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, f))).digest("hex");
  if (h === hash) same++; else changed.push(f);
}
ok(changed.length === 0, `huellas de los datos protegidos intactas`, `${same}/${lines.length} archivos${changed.length ? " · cambiados: " + changed.join(", ") : ""}`);

// ---- contratos binarios ----
const dem = fs.statSync(path.join(ROOT, "public/layers/dem.bin")).size, grid = fs.statSync(path.join(ROOT, "public/layers/grid.bin")).size;
ok(dem === 2097152, "dem.bin: uint16 LE de 1024 x 1024", `${dem} bytes`);
ok(grid === 7340032, "grid.bin: uint8 de 7 x 1024 x 1024", `${grid} bytes`);
const data = loadData();
const order = data.layers.layers.binary.grid.order;
ok(JSON.stringify(order) === JSON.stringify(["slope", "radiation", "thermal", "thermal_night", "spectral", "cost", "rough"]), "orden de planos de grid.bin", order.join(", "));
ok(data.layers.layers.binary.dem.dtype === "uint16 little-endian" && data.layers.layers.binary.grid.dtype === "uint8", "tipos declarados en layers.json");
ok(data.region.size_m === 6144 && data.region.grid_px === 1024 && data.region.pixel_size_m === 6, "recorte de 6144 m, cuadricula 1024 x 1024, 6 m/px", `${data.region.size_m} m · ${data.region.grid_px} px · ${data.region.pixel_size_m} m`);
ok(/0 = intransitable/.test(data.layers.layers.binary.grid.decode), "cost: 0 = intransitable (metadatos)");

// ---- convenciones de coordenadas (x = Este, z = Sur, fila 0 = norte, columna 0 = oeste) ----
const w = new World(data);
const [r0, c0] = w.toGrid(-w.half + 3, -w.half + 3);
ok(Math.abs(r0) < 1e-9 && Math.abs(c0) < 1e-9, "toGrid: esquina noroeste -> fila 0, columna 0");
const [x1, z1] = w.toWorld(1023, 1023);
ok(Math.abs(x1 - (w.half - 3)) < 1e-9 && Math.abs(z1 - (w.half - 3)) < 1e-9, "toWorld: fila 1023, columna 1023 -> esquina sureste");
// cost === 0 frente a pendiente: todas las celdas con pendiente > 25 grados tienen cost 0
const n = w.n, S = w.planes.slope, C = w.planes.cost, { min, max } = w.decode.slope;
let steep = 0, steepZero = 0, zero = 0;
for (let i = 0; i < n * n; i++) {
  const sl = min + (S[i] / 255) * (max - min);
  if (C[i] === 0) zero++;
  if (sl > data.rules.hazards.slope.blocked_above_deg) { steep++; if (C[i] === 0) steepZero++; }
}
ok(steep === steepZero, "toda celda con pendiente > 25 grados tiene cost === 0", `${steepZero}/${steep} · cost 0 en total: ${zero} (${(100 * zero / (n * n)).toFixed(2)} %)`);
summary("test_data_contracts");
