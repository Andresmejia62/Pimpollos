// Sonidos sintetizados con WebAudio (sin archivos). Empieza despues de una interaccion del usuario.
let ctx = null;
let wind = null;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    // viento marciano: ruido filtrado muy suave
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = 0.98 * last + 0.02 * (Math.random() * 2 - 1); d[i] = last * 3; }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 420;
    wind = ctx.createGain(); wind.gain.value = 0.05;
    src.connect(f).connect(wind).connect(ctx.destination);
    src.start();
  } catch (e) { ctx = null; }
}

function tone(freq, dur, type = "sine", vol = 0.12, when = 0, slide = 0) {
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t0 + dur);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

export const sfx = {
  blip: () => tone(880, 0.12, "sine", 0.08),
  chime: () => { tone(660, 0.25, "triangle", 0.1); tone(990, 0.3, "triangle", 0.08, 0.12); },
  klaxon: () => { for (let i = 0; i < 3; i++) tone(520, 0.22, "sawtooth", 0.07, i * 0.28, -160); },
  scan: () => tone(440, 0.6, "sine", 0.06, 0, 440),
  success: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, "triangle", 0.09, i * 0.11)); },
  fail: () => { [392, 330, 262].forEach((f, i) => tone(f, 0.45, "sawtooth", 0.06, i * 0.22)); },
  step: () => tone(90 + Math.random() * 30, 0.06, "sine", 0.04),
};

export function setWind(level) { if (wind) wind.gain.value = level; }

// ---- Sonido de la cinematica de llegada: rugido continuo (motor / plasma) y explosion del impacto ----
let noiseBuf = null;
function noise() {
  if (!noiseBuf) {
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf; s.loop = true;
  return s;
}
export const cine = {
  rumble: null,
  start() {
    if (!ctx || this.rumble) return;
    const src = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = "lowpass"; f.frequency.value = 180; g.gain.value = 0;
    src.connect(f).connect(g).connect(ctx.destination);
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
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t); src.stop(t + 2.7);
    tone(55, 1.6, "sine", 0.5, 0, -30);
  },
  stop() {
    if (!this.rumble) return;
    const r = this.rumble; this.rumble = null;
    r.g.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    setTimeout(() => { try { r.src.stop(); } catch (e) { /* ya parado */ } }, 800);
  },
};
