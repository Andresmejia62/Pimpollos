// Guarda una copia de NASA DONKI (ultimos 30 dias) en public/spaceweather/donki.json para que el juego
// tenga pronostico aunque no haya red. Uso:
//   NASA_API_KEY=tu_clave node data/scripts/fetch_donki.mjs      (clave gratis en https://api.nasa.gov)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath: con new URL().pathname una ruta con espacios queda como "%20" (y en Windows con "/C:/")
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const KEY = process.env.NASA_API_KEY || "DEMO_KEY";
const end = new Date(), start = new Date(end - 30 * 864e5);
const range = [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
async function main() {
  const raw = {};
  for (const type of ["FLR", "SEP", "WSAEnlilSimulations"]) {
    const url = `https://api.nasa.gov/DONKI/${type}?startDate=${range[0]}&endDate=${range[1]}&api_key=${KEY}`;
    const r = await fetch(url);
    if (r.status === 429 || r.status === 403) {
      const why = r.status === 429 ? "limite de consultas de la clave superado (DEMO_KEY: ~30 por hora y por IP). Usa tu propia clave en NASA_API_KEY o espera una hora." : "clave rechazada: " + (await r.text());
      console.error(type, r.status, why);
      process.exitCode = 1;            // sin process.exit(): en Windows cortar con una peticion abierta hace fallar a libuv
      return;
    }
    if (!r.ok) {
      // un servicio caido en NASA (p. ej. FLR con 404) no impide guardar los demas: queda sin datos
      console.warn(type, r.status, "servicio no disponible en NASA; se guarda vacio");
      raw[type] = [];
      continue;
    }
    raw[type] = await r.json();
    console.log(type, Array.isArray(raw[type]) ? raw[type].length : 0, "registros");
  }
  const dir = path.join(ROOT, "public/spaceweather");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, "donki.json");
  fs.writeFileSync(out, JSON.stringify({ source: "NASA DONKI (CCMC/GSFC) via api.nasa.gov", fetchedAt: Date.now(), range, raw }));
  console.log("guardado", out);
}
await main();
