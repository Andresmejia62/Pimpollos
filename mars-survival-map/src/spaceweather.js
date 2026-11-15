// Clima espacial: pronostico a partir de NASA DONKI (Space Weather Database Of Notifications, Knowledge,
// Information; CCMC/GSFC). Orden de fuentes:
//   1. En vivo: https://api.nasa.gov/DONKI/... (clave VITE_NASA_API_KEY o DEMO_KEY, ~30 consultas/h por IP)
//   2. Copia guardada: public/spaceweather/donki.json (node data/scripts/fetch_donki.mjs)
//   3. Evento real de referencia (sin conexion): la tormenta de mayo de 2024 que Curiosity midio en Marte.
const KEY = (import.meta.env && import.meta.env.VITE_NASA_API_KEY) || "DEMO_KEY";
const API = "https://api.nasa.gov/DONKI";
const CACHE = "msm-donki-v1", CACHE_MS = 3 * 3600 * 1000;

// Evento de referencia (NASA, jun 2024: "NASA Watches Mars Light Up During Epic Solar Storm"):
// fulguracion del 20 may 2024, estimada en X12 con Solar Orbiter; RAD (Curiosity) midio 8 100 µGy,
// unas 39 veces la dosis diaria normal (0,21 mGy/dia). MAVEN observo auroras en todo el planeta.
export const REFERENCE_EVENT = {
  date: "2024-05-20", flareClass: "X12", doseUgy: 8100, baselineUgyDay: 210,
  text: { es: "Fulguración X12 del 20 may 2024: Curiosity (RAD) midió 8 100 µGy en Gale, ~39 veces la dosis de un día normal. MAVEN vio auroras en todo Marte.", en: "X12 flare of 20 May 2024: Curiosity (RAD) measured 8,100 µGy in Gale, ~39 times a normal day's dose. MAVEN saw planet-wide auroras." },
  src: "NASA/JPL (jun 2024), MSL RAD · MAVEN",
};

const iso = (d) => d.toISOString().slice(0, 10);
const classRank = (c) => (c ? { A: 0, B: 1, C: 2, M: 3, X: 4 }[c[0]] * 100 + parseFloat(c.slice(1) || 0) : 0);

async function getJSON(url, ms = 8000) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(to); }
}

// Resume las respuestas de DONKI en un pronostico para Marte
export function summarize(raw, now = new Date()) {
  const flares = (raw.FLR || []).filter((f) => /^[MX]/.test(f.classType || "")).map((f) => ({ id: f.flrID, time: f.peakTime || f.beginTime, cls: f.classType, region: f.activeRegionNum, link: f.link }))
    .sort((a, b) => classRank(b.cls) - classRank(a.cls));
  const seps = (raw.SEP || []).map((s) => ({ id: s.sepID, time: s.eventTime, link: s.link }));
  const marsHits = [];
  for (const sim of raw.WSAEnlilSimulations || []) for (const imp of sim.impactList || []) {
    if (/mars/i.test(imp.location || "")) marsHits.push({ time: imp.arrivalTime, glancing: imp.isGlancingBlow, cme: (sim.cmeInputs || []).map((c) => c.cmeStartTime).join(", "), link: sim.link });
  }
  marsHits.sort((a, b) => new Date(a.time) - new Date(b.time));
  const days = (t) => (now - new Date(t)) / 864e5;
  const upcoming = marsHits.filter((h) => days(h.time) > -10 && days(h.time) < 1);
  const recentX = flares.filter((f) => f.cls[0] === "X" && days(f.time) < 3);
  const recentSep = seps.filter((s) => days(s.time) < 3);
  const recentM = flares.filter((f) => days(f.time) < 3);
  const level = upcoming.length || recentX.length || recentSep.length ? "high" : recentM.length ? "moderate" : "low";
  return { level, flares, seps, marsHits, upcoming, counts: { flaresMX: flares.length, sep: seps.length, mars: marsHits.length } };
}

export async function loadSpaceWeather(assetUrl) {
  // 1. cache del navegador
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || "null");
    if (c && Date.now() - c.at < CACHE_MS) return { ...summarize(c.raw), source: "live", fetchedAt: c.at, range: c.range };
  } catch (e) { /* sin almacenamiento */ }
  // 2. en vivo (si fallo hace poco, no se reintenta: la clave DEMO_KEY tiene un limite por hora)
  const end = new Date(), start = new Date(end - 30 * 864e5), range = [iso(start), iso(end)];
  let failedRecently = false;
  try { failedRecently = Date.now() - +(localStorage.getItem(CACHE + "-fail") || 0) < 30 * 60 * 1000; } catch (e) { /* ignorar */ }
  if (!failedRecently) try {
    const q = `startDate=${range[0]}&endDate=${range[1]}&api_key=${KEY}`;
    // un servicio caido (p. ej. FLR devolvio 404 en nov 2026) cuenta como sin datos; solo falla si caen todos
    const got = await Promise.allSettled([
      getJSON(`${API}/FLR?${q}`), getJSON(`${API}/SEP?${q}`), getJSON(`${API}/WSAEnlilSimulations?${q}`),
    ]);
    if (got.every((g) => g.status === "rejected")) throw got[0].reason;
    const [FLR, SEP, WSAEnlilSimulations] = got.map((g) => (g.status === "fulfilled" ? g.value : []));
    const raw = { FLR, SEP, WSAEnlilSimulations };
    try { localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), raw, range })); } catch (e) { /* ignorar */ }
    return { ...summarize(raw), source: "live", fetchedAt: Date.now(), range };
  } catch (e) {
    // sin red, limite de la clave o CORS
    try { localStorage.setItem(CACHE + "-fail", String(Date.now())); } catch (e2) { /* ignorar */ }
  }
  // 3. copia guardada en el repo
  try {
    const snap = await getJSON(assetUrl("spaceweather/donki.json"), 4000);
    return { ...summarize(snap.raw, new Date(snap.fetchedAt)), source: "snapshot", fetchedAt: snap.fetchedAt, range: snap.range };
  } catch (e) { /* no hay copia */ }
  return { level: "reference", flares: [], seps: [], marsHits: [], upcoming: [], counts: null, source: "reference" };
}

export const LEVEL_TEXT = {
  high: { es: "ALTA", en: "HIGH" }, moderate: { es: "MODERADA", en: "MODERATE" }, low: { es: "BAJA", en: "LOW" }, reference: { es: "SIN DATOS EN VIVO", en: "NO LIVE DATA" },
};
export const LEVEL_COLOR = { high: "var(--danger)", moderate: "var(--caution)", low: "var(--safe)", reference: "var(--hud-text-dim)" };
