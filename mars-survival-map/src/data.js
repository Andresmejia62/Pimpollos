// Carga de todos los datos del juego: capas de M3 (public/layers) e historia de M4 (public/story).
const BASE = import.meta.env.BASE_URL;

async function getJSON(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`No se pudo cargar ${path} (${r.status})`);
  return r.json();
}

async function getBinary(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`No se pudo cargar ${path} (${r.status})`);
  return r.arrayBuffer();
}

export async function loadAll(onProgress = () => {}) {
  const jobs = [
    ["region", () => getJSON("layers/region.json")],
    ["layers", () => getJSON("layers/layers.json")],
    ["rules", () => getJSON("layers/rules.json")],
    ["objectives", () => getJSON("layers/objectives.json")],
    ["traverse", () => getJSON("layers/traverse.json").catch(() => ({ points: [] }))],
    ["missions", () => getJSON("story/missions.json")],
    ["dialogs", () => getJSON("story/dialogs.json")],
    ["alerts", () => getJSON("story/alerts.json")],
    ["facts", () => getJSON("story/facts.json")],
    ["pov", () => getJSON("pov/pov.json").catch(() => ({ images: {} }))],
    ["dem", () => getBinary("layers/dem.bin")],
    ["grid", () => getBinary("layers/grid.bin")],
  ];
  let done = 0;
  const out = {};
  await Promise.all(jobs.map(async ([key, fn]) => {
    out[key] = await fn();
    done += 1;
    onProgress(done / jobs.length, key);
  }));
  return out;
}

export const assetUrl = (p) => BASE + p;
