// Sonidos sintetizados con WebAudio (sin archivos). Empieza despues de una interaccion del usuario.
//
// Tres buses, como se oiria desde dentro de un traje en Marte:
//  - suit: lo que llega por el propio traje y el casco (respiracion, ventiladores, pasos por las botas, radio).
//  - ext:  el exterior a traves del aire de Marte (~600-900 Pa): mucho mas bajo y sin agudos. Los microfonos de
//          Perseverance mostraron que la atmosfera atenua fuerte por encima de ~1 kHz.
//  - ui:   interfaz (pitidos del HUD).
// Todo pasa por un filtro maestro que "ahoga" el sonido cuando hay un menu encima (pausa, atlas...).
let ctx = null;
let wind = null, windF = null;
const bus = {};
let master = null, muffleF = null, muffle = 0;

// Volumen por canal (0..1), guardado en el navegador. BASE es la mezcla de referencia de cada bus.
const BASE = { master: 0.9, ambient: 0.85, suit: 1, vehicle: 0.45, ui: 0.85 };
const VOL_KEY = "msm-volume";
export const VOLUME = { master: 0.8, ambient: 0.8, suit: 0.8, vehicle: 0.6, ui: 0.7 };
try { Object.assign(VOLUME, JSON.parse(localStorage.getItem(VOL_KEY) || "{}")); } catch (e) { /* sin almacenamiento */ }
const BUS_OF = { ambient: "ext", suit: "suit", vehicle: "vehicle", ui: "ui" };
function applyVolume(name) {
  if (!ctx) return;
  const t = ctx.currentTime;
  if (name === "master") master.gain.setTargetAtTime(BASE.master * VOLUME.master * (1 - 0.45 * muffle), t, 0.05);
  else if (bus[BUS_OF[name]]) bus[BUS_OF[name]].gain.setTargetAtTime(BASE[name] * VOLUME[name], t, 0.05);
}
export function setVolume(name, v) {
  VOLUME[name] = Math.max(0, Math.min(1, +v));
  applyVolume(name);
  try { localStorage.setItem(VOL_KEY, JSON.stringify(VOLUME)); } catch (e) { /* ignorar */ }
}

export function initAudio() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = 0.9;
    muffleF = ctx.createBiquadFilter(); muffleF.type = "lowpass"; muffleF.frequency.value = 20000;
    master.connect(muffleF).connect(comp).connect(ctx.destination);
    bus.suit = ctx.createGain(); bus.suit.connect(master);
    bus.ui = ctx.createGain(); bus.ui.connect(master);
    bus.vehicle = ctx.createGain(); bus.vehicle.connect(master);
    // exterior: paso bajo + atenuacion fuerte (aire de Marte)
    const extF = ctx.createBiquadFilter(); extF.type = "lowpass"; extF.frequency.value = 1100; extF.Q.value = 0.4;
    bus.ext = ctx.createGain();
    bus.ext.connect(extF).connect(master);
    for (const k of Object.keys(BASE)) applyVolume(k);
    bus.extF = extF;
    // viento marciano: ruido rosa filtrado, con rafagas lentas
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = 0.985 * last + 0.015 * (Math.random() * 2 - 1); d[i] = last * 3.2; }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    windF = ctx.createBiquadFilter(); windF.type = "bandpass"; windF.frequency.value = 260; windF.Q.value = 0.5;
    wind = ctx.createGain(); wind.gain.value = 0.05;
    src.connect(windF).connect(wind).connect(bus.ext);
    src.start();
  } catch (e) { ctx = null; }
}
export const audioCtx = () => ctx;
export const audioBus = (name) => bus[name];

// Atenua y oscurece todo (0 = normal, 1 = muy ahogado) cuando hay un menu delante
export function setMuffle(level) {
  if (!ctx) return;
  if (Math.abs(level - muffle) < 0.01) return;
  muffle = level;
  const t = ctx.currentTime;
  muffleF.frequency.setTargetAtTime(20000 * Math.pow(0.03, level), t, 0.12);
  master.gain.setTargetAtTime(BASE.master * VOLUME.master * (1 - 0.45 * level), t, 0.12);
}

function tone(freq, dur, type = "sine", vol = 0.12, when = 0, slide = 0, out = "ui") {
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.linearRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(bus[out] || bus.ui);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

let noiseBuf = null;
function noise(loop = true) {
  if (!noiseBuf) {
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf; s.loop = loop;
  if (!loop) s.loopStart = Math.random();
  return s;
}
// Rafaga de ruido filtrado con envolvente (golpes, pasos, siseos)
function burst({ type = "bandpass", f = 1000, f2 = null, q = 1, vol = 0.1, attack = 0.005, dur = 0.12, when = 0, out = "suit" } = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const s = noise(true), fl = ctx.createBiquadFilter(), g = ctx.createGain();
  fl.type = type; fl.frequency.setValueAtTime(f, t0); fl.Q.value = q;
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(fl).connect(g).connect(bus[out] || bus.suit);
  s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.05);
}

// Suelo bajo la bota (clase espectral CRISM / rocas): cambia el timbre del paso
const STEP = {
  regolith: { f: 900, q: 0.9, dur: 0.11, vol: 0.07, thud: 85 },
  sand: { f: 420, q: 0.6, dur: 0.2, vol: 0.06, thud: 70 },
  rock: { f: 2100, q: 1.6, dur: 0.07, vol: 0.06, thud: 110 },
  brittle: { f: 2800, q: 2.2, dur: 0.06, vol: 0.05, thud: 120 },
};

export const sfx = {
  blip: () => tone(880, 0.12, "sine", 0.08),
  click: () => tone(1500, 0.03, "square", 0.025),
  hover: () => burst({ type: "highpass", f: 3000, q: 0.5, vol: 0.012, attack: 0.001, dur: 0.012, out: "ui" }),
  chime: () => { tone(660, 0.25, "triangle", 0.1); tone(990, 0.3, "triangle", 0.08, 0.12); },
  klaxon: () => { for (let i = 0; i < 3; i++) tone(520, 0.22, "sawtooth", 0.07, i * 0.28, -160); },
  scan: () => tone(440, 0.6, "sine", 0.06, 0, 440),
  scanTick: (p) => tone(520 + p * 700, 0.05, "sine", 0.04),
  scanLost: () => tone(600, 0.25, "triangle", 0.05, 0, -300),
  success: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, "triangle", 0.09, i * 0.11)); },
  fail: () => { [392, 330, 262].forEach((f, i) => tone(f, 0.45, "sawtooth", 0.06, i * 0.22)); },
  // paso: golpe sordo que sube por la pierna + crujido del suelo (segun el terreno y el peso)
  footstep: (kind = "regolith", weight = 1) => {
    const k = STEP[kind] || STEP.regolith;
    tone(k.thud + Math.random() * 15, 0.09, "sine", 0.05 * weight, 0, -25, "suit");
    burst({ f: k.f * (0.85 + Math.random() * 0.3), q: k.q, vol: k.vol * weight, dur: k.dur * (0.8 + Math.random() * 0.4), out: "suit" });
  },
  step: () => sfx.footstep("regolith", 0.7),
  // salto: crujido de las juntas del traje + exhalacion de esfuerzo
  jump: () => { burst({ f: 700, f2: 400, q: 0.8, vol: 0.05, attack: 0.02, dur: 0.25 }); tone(140, 0.12, "triangle", 0.025, 0, -40, "suit"); },
  // aterrizaje: cuanto mas fuerte el impacto, mas grave y largo; con dano, chasquido metalico
  land: (impact = 2, damage = 0) => {
    const k = Math.min(1, impact / 8);
    tone(70 - 20 * k, 0.15 + 0.25 * k, "sine", 0.06 + 0.12 * k, 0, -20, "suit");
    burst({ type: "lowpass", f: 900 - 400 * k, q: 0.5, vol: 0.06 + 0.1 * k, dur: 0.18 + 0.3 * k });
    if (damage > 0) { [1730, 2410, 3150].forEach((f, i) => tone(f, 0.25, "triangle", 0.03, 0.01 * i, 0, "suit")); tone(880, 0.12, "square", 0.04, 0.15); tone(880, 0.12, "square", 0.04, 0.32); }
  },
  // golpe del rover contra una roca (llega por la estructura)
  crash: (k = 1) => { tone(55, 0.5, "sine", 0.15 * k, 0, -15, "vehicle"); burst({ type: "lowpass", f: 700, vol: 0.12 * k, dur: 0.4, out: "vehicle" }); [610, 1270, 1990].forEach((f, i) => tone(f, 0.4, "triangle", 0.025 * k, 0.005 * i, -20, "vehicle")); },
  // escotilla / arnes al subir o bajar del rover
  hatch: () => { tone(160, 0.08, "square", 0.04, 0, -60, "vehicle"); burst({ f: 1800, q: 3, vol: 0.04, dur: 0.05, when: 0.02, out: "vehicle" }); tone(110, 0.1, "sine", 0.06, 0.14, -30, "vehicle"); burst({ f: 2600, q: 4, vol: 0.03, dur: 0.04, when: 0.16, out: "vehicle" }); },
  // esclusa del refugio: siseo de presurizacion que sube y un tono de confirmacion
  airlock: () => { burst({ type: "highpass", f: 1200, f2: 4000, q: 0.5, vol: 0.06, attack: 0.3, dur: 1.6 }); tone(740, 0.2, "sine", 0.05, 1.5); tone(988, 0.3, "sine", 0.05, 1.68); },
  // radio: tono Quindar (2525 Hz, como en Apollo) y un poco de estatica al abrir el canal
  radio: (quindar = true) => {
    burst({ f: 2200, q: 0.7, vol: 0.022, dur: 0.12, out: "suit" });
    if (quindar) tone(2525, 0.2, "sine", 0.018, 0.05, 0, "suit");
  },
  // dosimetro: cada particula es un clic seco (impulso de ruido muy corto, sin tono)
  geiger: (v = 1) => burst({ type: "highpass", f: 2500, q: 0.4, vol: 0.05 * v, attack: 0.0005, dur: 0.006, out: "ui" }),
  // alarma maestra del traje (O2 o integridad criticos)
  caution: () => { tone(1200, 0.12, "square", 0.035); tone(1200, 0.12, "square", 0.035, 0.18); },
  emote: () => tone(620, 0.09, "triangle", 0.05, 0, 180),
  whoosh: (up = true) => burst({ f: up ? 500 : 1800, f2: up ? 1800 : 500, q: 0.7, vol: 0.035, attack: 0.06, dur: 0.3, out: "ui" }),
  // descargas de electricidad estatica en el traje (remolinos de polvo)
  static: () => { for (let i = 0; i < 9; i++) burst({ type: "highpass", f: 3500, q: 0.4, vol: 0.03 + Math.random() * 0.03, attack: 0.0005, dur: 0.008 + Math.random() * 0.01, when: Math.random() * 0.9, out: "suit" }); },
  // limpiar el visor con el guante
  wipe: () => burst({ f: 1400, f2: 2600, q: 0.6, vol: 0.05, attack: 0.05, dur: 0.35, out: "suit" }),
  // gravilla que se desliza bajo las botas en laderas sueltas
  scrape: () => burst({ f: 1500, f2: 700, q: 0.9, vol: 0.05, attack: 0.04, dur: 0.45 }),
};

export function setWind(level, gust = 0) {
  if (!wind) return;
  const t = ctx.currentTime;
  wind.gain.setTargetAtTime(level * (0.7 + gust * 1.4), t, 0.35);
  windF.frequency.setTargetAtTime(200 + level * 700 + gust * 220, t, 0.4);
}

// ---- Capas continuas (las controla soundscape.js) ------------------------------------
// Devuelve un nodo de ruido filtrado + ganancia ya conectado, para modular desde fuera.
export function makeNoiseLayer({ type = "bandpass", f = 800, q = 1, out = "suit" } = {}) {
  if (!ctx) return null;
  const src = noise(true), fl = ctx.createBiquadFilter(), g = ctx.createGain();
  fl.type = type; fl.frequency.value = f; fl.Q.value = q; g.gain.value = 0;
  src.connect(fl).connect(g).connect(bus[out] || bus.suit);
  src.start();
  return { src, f: fl, g };
}
export function makeToneLayer({ freqs = [110], type = "sawtooth", lp = 500, out = "suit" } = {}) {
  if (!ctx) return null;
  const fl = ctx.createBiquadFilter(), g = ctx.createGain();
  fl.type = "lowpass"; fl.frequency.value = lp; g.gain.value = 0;
  const oscs = freqs.map((fr) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = fr; o.connect(fl); o.start(); return o; });
  fl.connect(g).connect(bus[out] || bus.suit);
  return { oscs, f: fl, g };
}
// Programa una envolvente sobre la ganancia de una capa (respiracion, latidos)
export function envelope(gainParam, points) {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  gainParam.cancelScheduledValues(t0);
  gainParam.setValueAtTime(gainParam.value, t0);
  for (const [dt, v] of points) gainParam.linearRampToValueAtTime(v, t0 + dt);
}
export const tone2 = tone;

// ---- Sonido de la cinematica de llegada: rugido continuo (motor / plasma) y explosion del impacto ----
export const cine = {
  rumble: null,
  start() {
    if (!ctx || this.rumble) return;
    const src = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = "lowpass"; f.frequency.value = 180; g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    src.start();
    this.rumble = { src, f, g };
  },
  // level 0..1, cutoff en Hz (mas alto = plasma mas aspero)
  set(level, cutoff = 200) {
    if (!this.rumble) return;
    const t = ctx.currentTime;
    this.rumble.g.gain.setTargetAtTime(level * 0.35, t, 0.08);
    this.rumble.f.frequency.setTargetAtTime(cutoff, t, 0.1);
  },
  boom() {
    if (!ctx) return;
    const t = ctx.currentTime, src = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = "lowpass"; f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(60, t + 2.2);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    src.connect(f).connect(g).connect(master);
    src.start(t); src.stop(t + 2.7);
    tone(55, 1.6, "sine", 0.5, 0, -30, "suit");
  },
  stop() {
    if (!this.rumble) return;
    const r = this.rumble; this.rumble = null;
    r.g.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    setTimeout(() => { try { r.src.stop(); } catch (e) { /* ya parado */ } }, 800);
  },
};
