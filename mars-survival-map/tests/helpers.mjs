// Utilidades comunes de las pruebas de Node: carga de datos reales y mini-marco de asserts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const BIN = (p) => { const b = fs.readFileSync(path.join(ROOT, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

// Mismos datos que carga src/data.js en el navegador (sin red)
export function loadData() {
  return {
    region: J("public/layers/region.json"),
    layers: J("public/layers/layers.json"),
    rules: J("public/layers/rules.json"),
    objectives: J("public/layers/objectives.json"),
    missions: J("public/story/missions.json"),
    dialogs: J("public/story/dialogs.json"),
    facts: J("public/story/facts.json"),
    dem: BIN("public/layers/dem.bin"),
    grid: BIN("public/layers/grid.bin"),
  };
}

let failures = 0, checks = 0;
export function ok(cond, label, detail = "") {
  checks++;
  if (cond) console.log(`OK   ${label}${detail ? "  ->  " + detail : ""}`);
  else { failures++; console.error(`FALLO ${label}${detail ? "  ->  " + detail : ""}`); }
}
export function approx(a, b, absTol, relTol, label, unit = "") {
  const diff = Math.abs(a - b);
  const lim = Math.max(absTol, relTol * Math.max(Math.abs(a), Math.abs(b)));
  ok(diff <= lim, label, `|${a} - ${b}| = ${diff.toExponential(2)} ${unit} (tol ${lim.toExponential(2)})`);
}
export function summary(name) {
  console.log(`\n${name}: ${checks - failures}/${checks} comprobaciones correctas`);
  if (failures) { process.exitCode = 1; }
  return failures === 0;
}
