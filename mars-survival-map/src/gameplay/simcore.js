// Nucleo de simulacion compartido por la ejecucion (gameplay/game.js) y la estimacion de rutas
// (gameplay/planner.js). Funciones puras sobre un estado plano: sin interfaz, sin escena, sin azar.
//
// Las formulas y unidades son exactamente las que aplicaba Game.update (rules.json + engine/physiology.js);
// este modulo solo las reune en un sitio para que el planificador no tenga una copia distinta.
//
//   ctx  = { world, rules, bio (Physiology), o2CapacityG, diff, realPerWorld }
//   st   = { oxygen, energy, integrity, inShelter, spe, bio: {M, hr, fatigue, kcal, o2g, co2g, waterg, doseUgy, ...},
//            locks: { oxygen, energy, integrity } }   (locks: true = ese recurso no se gasta; modo libre)
//   inp  = { x, z, hour, vReal, grade, onFoot, driving, dustLevel, dustCover, dustThermal }
import { REF, REF_FLAT_W, TERRAIN_ETA } from "../engine/physiology.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- ambiente en un punto ------------------------------------------------------------------------
// dustThermal: desplazamiento termico de la tormenta de polvo (Weather.thermalOffset) a esa hora, en °C
export function envAt(ctx, x, z, hour, dustThermal = 0) {
  const W = ctx.world, H = ctx.rules.hazards;
  const cls = W.spectral(x, z);
  let eta = TERRAIN_ETA[cls] ?? 1.2;
  const rock = W.rockClass(x, z), B = H.boulders;
  if (B && rock) eta = Math.max(eta, rock === 2 ? B.eta_field : B.eta_rocky);
  return { slope: W.slope(x, z), temp: W.temperature(x, z, hour) + dustThermal, dose: W.radiation(x, z), eta, rock, cls };
}

// ---- cuerpo: metabolismo con cinetica del VO2, fatiga y consumos acumulados ---------------------------
// Devuelve los gramos de O2 consumidos en el paso (ya con el x1,5 de bateria agotada).
export function bodyStep(ctx, st, inp, env, dt) {
  const bio = ctx.bio, b = st.bio, ts = ctx.rules.time.time_scale;
  const dtg = dt * ts;                                                     // segundos en Marte
  b.vReal = inp.onFoot ? inp.vReal : 0;
  b.grade = inp.onFoot ? inp.grade : 0;
  b.eta = env.eta;
  b.rock = env.rock;
  const Mnow = inp.driving ? bio.metabolic(0) * 0.95 : bio.metabolic(b.vReal, b.grade, b.eta);
  b.M += (Mnow - b.M) * Math.min(1, dt / 1.5);                            // cinetica del VO2 (~30 s en Marte)
  const pct = bio.pctVO2max(b.M);
  b.hr = bio.heartRate(b.M);
  // fatiga: por encima de ~55 % del VO2max se acumula; por debajo se recupera
  b.fatigue = clamp(b.fatigue + (pct > 0.55 ? (pct - 0.55) * 0.1 : -(0.55 - pct) * 0.12) * dtg, 0, 100);
  b.kcal += (bio.kcalPerH(b.M) * dtg) / 3600;
  const o2g = ((bio.o2gPerH(b.M) * dtg) / 3600) * (st.energy <= 0 ? 1.5 : 1);
  b.o2g += o2g;
  b.co2g += (bio.co2gPerH(b.M) * dtg) / 3600;
  b.waterg += (bio.waterGPerH(b.M) * dtg) / 3600;
  return o2g;
}

// ---- variaciones de recursos del paso (negativas = gasto) y dosis -----------------------------------------
export function resourceDeltas(ctx, st, inp, env, o2g, dt) {
  const R = ctx.rules.resources, E = ctx.rules.events.solar_particle_event, bio = ctx.bio, b = st.bio;
  const dK = ctx.diff || { drainK: 1, damageK: 1 };
  const dtg = dt * ctx.rules.time.time_scale;
  // bateria: electronica + ventiladores/bomba (crecen con el calor metabolico) + calefaccion (crece con el frio
  // y con la superficie corporal, y baja si el cuerpo produce mas calor)
  const cold = R.energy.cold.extra_per_deg * Math.max(0, R.energy.cold.comfort_c - env.temp) * (bio.bsa / REF.bsa) * clamp(Math.sqrt(REF_FLAT_W / b.M), 0.7, 1.3);
  const speMult = st.spe && st.spe.phase === "active" ? E.dose_multiplier : 1;
  const shelterK = st.inShelter ? E.shelter_factor : 1;
  const d = {
    oxygen: -(100 * o2g) / ctx.o2CapacityG,
    energy: -R.energy.base_drain_per_s * (0.85 + 0.15 * (b.M / REF_FLAT_W)) * (1 + cold) * dK.drainK * dt,
    integrity: -R.integrity.radiation.k_per_ugy_h * env.dose * speMult * shelterK * dK.damageK * dt,
    doseUgy: (env.dose * speMult * shelterK * dtg) / 3600,            // dosis absorbida real de la EVA (µGy)
  };
  if (inp.onFoot && env.slope > R.integrity.slip.from_deg && env.slope <= R.integrity.slip.to_deg) d.integrity -= R.integrity.slip.drain_per_s * dK.damageK * dt;
  return d;
}

// ---- polvo de la tormenta regional fuera de un refugio (antes lo restaba Weather directamente) ------------
// cover: proteccion del rover (0..1). A bordo la bateria del traje no paga el gasto extra.
export function dustDeltas(ctx, st, inp, dt) {
  const L = inp.dustLevel || 0;
  if (st.inShelter || L <= 0.05) return { energy: 0, integrity: 0 };
  const k = 1 - (inp.dustCover || 0), dK = ctx.diff || { damageK: 1 };
  return {
    integrity: -0.004 * L * k * dK.damageK * dt,
    energy: inp.driving ? 0 : -ctx.rules.resources.energy.base_drain_per_s * 0.35 * L * k * dt,
  };
}

// ---- aplicar una variacion respetando los bloqueos de gasto (las recargas siempre se aplican) ---------------
export function applyDelta(st, key, delta) {
  if (!delta) return 0;
  if (delta < 0 && st.locks && st.locks[key]) return 0;
  st[key] += delta;
  return delta;
}

// ---- recarga en un refugio (el rover solo hasta rover_cap) ---------------------------------------------------
export function refillStep(ctx, st, dt) {
  if (!st.inShelter) return;
  const R = ctx.rules.resources, cap = st.inShelter === "rover" ? R.shelter_refill.rover_cap : 100;
  if (st.oxygen < cap) st.oxygen = Math.min(cap, st.oxygen + R.shelter_refill.oxygen_per_s * dt);
  if (st.energy < cap) st.energy = Math.min(cap, st.energy + R.shelter_refill.energy_per_s * dt);
}

// ---- tormenta solar (SPE): avanza su reloj; devuelve "active" | "ended" | null ---------------------------
export function speStep(ctx, st, dt) {
  const sp = st.spe;
  if (!sp || sp.phase === "ended") return null;
  const E = ctx.rules.events.solar_particle_event;
  sp.t -= dt;
  if (sp.phase === "active") {
    sp.active += dt;
    if (st.inShelter) sp.sheltered += dt;
  }
  if (sp.t > 0) return null;
  if (sp.phase === "warning") { sp.phase = "active"; sp.t = E.duration_s; return "active"; }
  sp.phase = "ended";
  return "ended";
}

// ---- un paso completo del nucleo, en el mismo orden que Game.update -------------------------------------
// Devuelve { env, spe: "active" | "ended" | null }.
export function stepCore(ctx, st, inp, dt) {
  const env = envAt(ctx, inp.x, inp.z, inp.hour, inp.dustThermal || 0);
  const o2g = bodyStep(ctx, st, inp, env, dt);
  const d = resourceDeltas(ctx, st, inp, env, o2g, dt);
  applyDelta(st, "oxygen", d.oxygen);
  applyDelta(st, "energy", d.energy);
  applyDelta(st, "integrity", d.integrity);
  st.bio.doseUgy += d.doseUgy;
  const dd = dustDeltas(ctx, st, inp, dt);
  applyDelta(st, "energy", dd.energy);
  applyDelta(st, "integrity", dd.integrity);
  refillStep(ctx, st, dt);
  st.energy = Math.max(0, st.energy);
  st.oxygen = Math.min(100, st.oxygen);
  const spe = speStep(ctx, st, dt);
  return { env, spe };
}
