// Paisaje sonoro continuo de la EVA, guiado por el estado real del juego:
//  - respiracion: ritmo y profundidad segun el %VO2max, la fatiga y el O2 (modelo de engine/physiology.js);
//    expone la fase para que el pecho del astronauta se mueva al mismo ritmo que se oye;
//  - soporte vital (ventilador y flujo de aire del PLSS): baja de tono y falla sin bateria;
//  - latidos cuando la frecuencia cardiaca es alta o falta O2;
//  - rover: motor electrico y crujido de ruedas (llega por la estructura al traje);
//  - dosimetro: chasquidos con la tasa de dosis real del terreno (capa RAD) y la tormenta solar;
//  - viento con rafagas (exterior, muy atenuado por el aire fino);
//  - alarma maestra del traje con O2 o integridad criticos, y gravilla al resbalar en laderas.
import { sfx, setWind, makeNoiseLayer, makeToneLayer, envelope, tone2, audioCtx } from "./audio.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Soundscape {
  constructor() {
    this.breathPhase = 0;      // 0..1 dentro del ciclo actual (0 = empieza a inspirar)
    this.breathAmp = 0.3;      // profundidad visual 0..1
    this.nextBreath = 0;
    this.nextBeat = 0;
    this.nextCaution = 0;
    this.nextScrape = 0;
    this.gust = 0;
    this.t = 0;
  }

  _ensure() {
    if (this.ready || !audioCtx()) return !!this.ready;
    this.breath = makeNoiseLayer({ type: "bandpass", f: 1200, q: 0.9, out: "suit" });
    this.fanTone = makeToneLayer({ freqs: [118, 177.5], type: "sawtooth", lp: 380, out: "suit" });
    this.fanAir = makeNoiseLayer({ type: "lowpass", f: 650, q: 0.4, out: "suit" });
    this.motor = makeToneLayer({ freqs: [90, 135], type: "triangle", lp: 600, out: "vehicle" });
    this.wheels = makeNoiseLayer({ type: "lowpass", f: 380, q: 0.5, out: "vehicle" });
    // ambiente exterior, segun las grabaciones de Perseverance (SuperCam): rumor grave del viento,
    // siseo de arena que salta con las rafagas fuertes, y remolinos de polvo que pasan de vez en cuando
    this.rumble = makeNoiseLayer({ type: "lowpass", f: 110, q: 0.3, out: "ext" });
    this.sand = makeNoiseLayer({ type: "bandpass", f: 900, q: 0.6, out: "ext" });
    this.devil = makeNoiseLayer({ type: "bandpass", f: 240, q: 0.7, out: "ext" });
    this.habHum = makeToneLayer({ freqs: [60, 120], type: "sine", lp: 300, out: "ext" });
    this.nextDevil = audioCtx().currentTime + 50 + Math.random() * 60;
    this.ready = true;
    return true;
  }

  silence() {
    if (!this.ready) return;
    const t = audioCtx().currentTime;
    for (const l of [this.breath, this.fanTone, this.fanAir, this.motor, this.wheels, this.sand, this.devil, this.habHum]) l.g.gain.setTargetAtTime(0, t, 0.2);
    this.rumble.g.gain.setTargetAtTime(0.03, t, 0.4);
    setWind(0.03);
  }

  // st: { game, running, onFoot, driving, speed, slipping }
  update(dt, st) {
    if (!this._ensure()) return;
    const ctx = audioCtx(), now = ctx.currentTime;
    const g = st.game, s = g.s, b = s.bio, bio = g.bio;
    this.t += dt;
    if (!st.running) { this.silence(); this.paused = true; return; }
    this.paused = false;
    const pct = clamp(bio.pctVO2max(b.M), 0, 1.1), fat = clamp(b.fatigue / 100, 0, 1);
    const lowO2 = s.oxygen < 15, noPower = s.energy <= 0;

    // ---- respiracion -------------------------------------------------------------------------
    const bpm = 12 + 26 * pct + 10 * fat + (lowO2 ? 9 : 0);
    const period = 60 / bpm;
    this.breathPhase = (this.breathPhase + dt / period) % 1;
    this.breathAmp = clamp(0.25 + 0.9 * pct + 0.5 * fat + (lowO2 ? 0.4 : 0), 0.2, 1.4);
    if (now >= this.nextBreath) {
      this.nextBreath = now + period;
      this.breathPhase = 0;
      const vol = 0.006 + 0.03 * pct + 0.02 * fat + (lowO2 ? 0.02 : 0);
      const tin = period * 0.4, tout = period * 0.5;
      envelope(this.breath.g.gain, [[tin * 0.35, vol * 0.8], [tin, vol * 0.25], [tin + 0.06, vol * 0.2], [tin + tout * 0.3, vol], [tin + tout, 0.0001]]);
      const f = this.breath.f.frequency;
      f.cancelScheduledValues(now); f.setValueAtTime(1500 + 400 * pct, now); f.linearRampToValueAtTime(1900, now + tin);
      f.setValueAtTime(900, now + tin + 0.05); f.linearRampToValueAtTime(650, now + tin + tout);
    }

    // ---- soporte vital (PLSS) ---------------------------------------------------------------
    const powerK = noPower ? 0 : s.energy < 15 ? 0.6 + 0.4 * Math.sin(this.t * 9) * 0.5 : 1;
    this.fanTone.g.gain.setTargetAtTime(0.012 * powerK, now, 0.3);
    this.fanAir.g.gain.setTargetAtTime(0.018 * powerK * (0.8 + 0.4 * pct), now, 0.3);
    const fanHz = noPower ? 40 : 118 * (s.energy < 15 ? 0.85 : 1) * (1 + 0.08 * pct);
    this.fanTone.oscs[0].frequency.setTargetAtTime(fanHz, now, 0.4);
    this.fanTone.oscs[1].frequency.setTargetAtTime(fanHz * 1.503, now, 0.4);

    // ---- latidos ------------------------------------------------------------------------------
    const hr = b.hr || 70;
    const beatVol = clamp((hr - 118) / 60, 0, 1) * 0.07 + (lowO2 ? 0.05 : 0);
    if (beatVol > 0.005 && now >= this.nextBeat) {
      this.nextBeat = now + 60 / hr;
      tone2(52, 0.12, "sine", beatVol, 0, -10, "suit");
      tone2(46, 0.1, "sine", beatVol * 0.7, 0.16, -8, "suit");
    } else if (beatVol <= 0.005) this.nextBeat = now;

    // ---- rover -------------------------------------------------------------------------------
    const v = st.driving ? st.speed : 0;
    this.motor.g.gain.setTargetAtTime(st.driving ? 0.004 + 0.0018 * v : 0, now, 0.15);
    this.motor.oscs[0].frequency.setTargetAtTime(90 + v * 38, now, 0.1);
    this.motor.oscs[1].frequency.setTargetAtTime((90 + v * 38) * 1.5, now, 0.1);
    this.wheels.g.gain.setTargetAtTime(st.driving ? Math.min(0.03, v * 0.0025) : 0, now, 0.12);
    this.wheels.f.frequency.setTargetAtTime(300 + v * 40, now, 0.2);

    // ---- dosimetro: tasa real de la capa RAD x tormenta x refugio --------------------------------
    const env = g.env || { dose: 8.4 };
    const E = g.rules.events.solar_particle_event;
    const spe = s.spe && s.spe.phase === "active" ? E.dose_multiplier : 1;
    const shelterK = s.inShelter ? E.shelter_factor : 1;
    const rate = (env.dose / 8.4) * 0.22 * spe * shelterK;         // clics por segundo
    if (Math.random() < 1 - Math.exp(-rate * dt)) sfx.geiger(spe > 1 ? 1 : 0.6);

    // ---- viento con rafagas (exterior) --------------------------------------------------------
    // rafagas, tormenta de polvo y remolinos: los marca el clima (gameplay/weather.js) para que lo que se oye
    // coincida con lo que se ve; sin clima, un paseo aleatorio
    const W = st.weather;
    if (W) this.gust = W.gust;
    else this.gust = clamp(this.gust + (Math.random() - 0.5) * dt * 2.2 - (this.gust - 0.25) * dt * 0.35, 0, 1);
    const speOn = s.spe && s.spe.phase === "active" ? 1 : 0;
    const dust = W ? W.storm.level : 0;
    const inside = !!s.inShelter;
    const windLv = inside ? 0.012 + 0.02 * dust : 0.08 + 0.04 * speOn + 0.14 * dust;
    setWind(windLv * (st.driving ? 1.25 : 1), Math.min(1, this.gust + dust * 0.5));
    this.rumble.g.gain.setTargetAtTime(inside ? 0.01 + 0.02 * dust : 0.05 + 0.06 * this.gust + 0.08 * dust, now, 0.5);
    // la arena solo salta con rafagas fuertes; en la tormenta golpea el visor sin parar
    const salt = inside ? 0 : Math.max(0, this.gust - 0.55) * 0.16 + dust * 0.09;
    const devil = W ? W.devilNear : 0;
    this.sand.g.gain.setTargetAtTime(salt + devil * devil * 0.1, now, 0.25);
    this.sand.f.frequency.setTargetAtTime(700 + this.gust * 500 + dust * 300, now, 0.3);
    this.habHum.g.gain.setTargetAtTime(inside ? 0.02 : 0, now, 0.6);
    // remolino: el rugido sube y baja con la distancia real del remolino visible mas cercano
    this.devil.g.gain.setTargetAtTime(inside ? 0 : devil * devil * 0.17, now, 0.3);
    this.devil.f.frequency.setTargetAtTime(150 + devil * 300, now, 0.4);

    // ---- alarma maestra y gravilla -------------------------------------------------------------
    if ((lowO2 || s.integrity < 20 || noPower) && now >= this.nextCaution) { this.nextCaution = now + 3.2; sfx.caution(); }
    if (st.slipping && st.onFoot && now >= this.nextScrape) { this.nextScrape = now + 0.9 + Math.random() * 0.8; sfx.scrape(); }
  }

  // Elevacion del pecho (0..1) sincronizada con lo que se oye: sube al inspirar, baja al espirar
  chest() {
    const p = this.breathPhase;
    const v = p < 0.4 ? Math.sin((p / 0.4) * Math.PI * 0.5) : Math.cos(((p - 0.4) / 0.6) * Math.PI * 0.5);
    return v * this.breathAmp;
  }
}
