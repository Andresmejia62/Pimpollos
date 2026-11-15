// Guarda una copia de NASA DONKI (ultimos 30 dias) en public/spaceweather/donki.json para que el juego
// tenga pronostico aunque no haya red. Uso:
//   NASA_API_KEY=tu_clave node data/scripts/fetch_donki.mjs      (clave gratis en https://api.nasa.gov)
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const KEY = process.env.NASA_API_KEY || "DEMO_KEY";
const end = new Date(), start = new Date(end - 30 * 864e5);
const range = [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
const raw = {};
for (const type of ["FLR", "SEP", "WSAEnlilSimulations"]) {
  const url = `https://api.nasa.gov/DONKI/${type}?startDate=${range[0]}&endDate=${range[1]}&api_key=${KEY}`;
  const r = await fetch(url);
  if (!r.ok) { console.error(type, r.status, await r.text()); process.exit(1); }
  raw[type] = await r.json();
  console.log(type, Array.isArray(raw[type]) ? raw[type].length : 0, "registros");
}
const out = path.join(ROOT, "public/spaceweather/donki.json");
fs.writeFileSync(out, JSON.stringify({ source: "NASA DONKI (CCMC/GSFC) via api.nasa.gov", fetchedAt: Date.now(), range, raw }));
console.log("guardado", out);
