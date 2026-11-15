// Planificacion de la EVA: estima tiempo, oxigeno, energia, integridad, fatiga y dosis de una ruta antes de
// salir. Usa el MISMO nucleo de simulacion que la partida (gameplay/simcore.js): metabolismo con cinetica del
// VO2, tormenta solar, proteccion de refugios, efecto termico y desgaste del polvo, recargas y bloqueos de gasto.
import { TERRAIN_ETA, Physiology, REF, SAMPLE_KG } from "../engine/physiology.js";
import { stepCore } from "./simcore.js";
import { thermalOffsetFor } from "./weather.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Densifica una polilinea [[x, z], ...] a pasos de `step` metros
export function densify(pts, step = 6) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
  }
  return out;
}

// Copia independiente del estado relevante de la partida (el planificador nunca escribe en game.s)
function coreState(game, start, locks) {
  const b = start.bio || {};
  return {
    oxygen: start.oxygen, energy: start.energy, integrity: start.integrity, inShelter: null,
    spe: start.spe ? { ...start.spe } : null,
    bio: { M: b.M ?? game.bio.metabolic(0), hr: b.hr ?? 70, fatigue: b.fatigue || 0, kcal: 0, o2g: 0, co2g: 0, waterg: 0, doseUgy: 0, vReal: 0, grade: 0, eta: 1.2, rock: 0 },
    locks: locks === undefined ? (game.locks ? game.locks() : null) : locks,
  };
}

// Velocidad de marcha (m/s del juego): la misma formula que Game._move usa como velocidad objetivo
export function walkSpeed(game, st, slope, loadK = game.loadK) {
  const R = game.rules, H = R.hazards;
  const slopeK = clamp(1 - (slope - H.slope.slow_above_deg) / 26, 0.5, 1);
  return R.movement.walk_speed_mps * slopeK * (st.energy <= 0 ? 0.4 : 1) * game.speedK * (loadK || 1) * (1 - 0.45 * Math.min(1, st.bio.fatigue / 100));
}

// Estima una ruta con el nucleo de simulacion compartido (gameplay/simcore.js), paso a paso, sobre una copia
// del estado: no modifica la partida, ni su clima, ni su generador aleatorio.
//  refills: [{ i (indice de la polilinea densificada), id (refugio) }] -> parada hasta recargar O2 y bateria
//  dt:      paso de integracion (s reales)
//  dustAt:  (tReal) -> nivel de polvo 0..1; por defecto, el pronostico del clima (Weather.forecastLevels)
//  trace:   array opcional donde se anotan, en cada paso, las entradas y el estado resultante (pruebas)
//  locks:   bloqueos de gasto (por defecto los de la partida, como haria el motor)
export function estimateRoute(game, pts, { start = game.s, refills = [], dt = 0.25, dustAt = null, trace = null, locks } = {}) {
  const W = game.world, R = game.rules, Rs = R.resources;
  const ts = R.time.time_scale;
  const ctx = game.simCtx();
  const st = coreState(game, start, locks);
  // fisiologia propia (copia): al entrar en un refugio se dejan las muestras, como en la partida (Game._simStep)
  const cargo = start.cargo || { kit: game.bio.loadKg, carried: 0 };
  let carried = cargo.carried || 0;
  const bio = new Physiology(game.bio.p, cargo.kit + carried * SAMPLE_KG);
  ctx.bio = bio;
  let loadK = Math.sqrt(REF.total / bio.total);
  const ground = game.groundAt || ((x, z) => W.demHeight(x, z));       // superficie que se pisa (con interiores)
  const path = densify(pts);
  const hour0 = game.hour;
  // pronostico de polvo (sin tocar el clima): tabla cada segundo hasta un margen amplio
  let dustTable = null;
  if (!dustAt && game.weather && game.weather.forecastLevels) {
    let len = 0; for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    const horizon = Math.min(7200, 120 + (len / Math.max(0.5, R.movement.walk_speed_mps * 0.3)) + 1800);
    dustTable = game.weather.forecastLevels(horizon, 1);
  }
  const dustLevel = (t) => dustAt ? dustAt(t) : dustTable ? dustTable[Math.min(dustTable.length - 1, Math.floor(t))] : (game.dustLevel || 0);

  let tReal = 0, dist = 0, up = 0, down = 0, maxSlope = 0;
  let minO2 = st.oxygen, minEn = st.energy, minInteg = st.integrity;
  let blockedM = 0, rockyM = 0, slipM = 0, duneM = 0, coldMin = Infinity, radInt = 0, dustMax = 0, speActiveS = 0;
  const classM = [0, 0, 0, 0, 0];             // metros sobre cada clase mineral de CRISM (0 sin firma .. 4 dunas)
  const profile = [[0, W.demHeight(path[0][0], path[0][1]) + W.yRef]];     // elevacion cientifica (DEM)
  const stops = [];
  let x = path[0][0], z = path[0][1];

  // un paso del nucleo en (x, z); kin = desplazamiento de este paso
  const step = (h, vReal, grade, onFoot) => {
    tReal += h;
    const hour = hour0 + (tReal * ts) / 3600;
    st.inShelter = game.shelterAt ? game.shelterAt(x, z) : null;
    if (st.inShelter && carried > 0) { carried = 0; bio.setLoad(cargo.kit); loadK = Math.sqrt(REF.total / bio.total); }
    const lv = dustLevel(tReal);
    dustMax = Math.max(dustMax, lv);
    const inp = { x, z, hour, vReal, grade, onFoot, driving: false, dustLevel: lv, dustCover: 0, dustThermal: thermalOffsetFor(lv, hour) };
    const res = stepCore(ctx, st, inp, h);
    if (st.spe && st.spe.phase === "active") speActiveS += h;
    coldMin = Math.min(coldMin, res.env.temp);
    minO2 = Math.min(minO2, st.oxygen); minEn = Math.min(minEn, st.energy); minInteg = Math.min(minInteg, st.integrity);
    if (trace) trace.push({ dt: h, x, z, vReal, grade, onFoot, dustLevel: lv, tReal, oxygen: st.oxygen, energy: st.energy, integrity: st.integrity, fatigue: st.bio.fatigue, M: st.bio.M, o2g: st.bio.o2g, kcal: st.bio.kcal, doseUgy: st.bio.doseUgy, inShelter: st.inShelter });
    return res;
  };

  for (let i = 1; i < path.length; i++) {
    const [x0, z0] = path[i - 1], [x1, z1] = path[i];
    const d = Math.hypot(x1 - x0, z1 - z0);
    if (d < 1e-6) continue;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const h0 = ground(x0, z0), h1 = ground(x1, z1), grade = (h1 - h0) / d;
    const slope = W.slope(mx, mz);
    maxSlope = Math.max(maxSlope, slope);
    if (h1 > h0) up += h1 - h0; else down += h0 - h1;
    if (W.blockedAt(mx, mz)) blockedM += d;
    const cls = W.spectral(mx, mz);
    classM[cls] = (classM[cls] || 0) + d;
    if ((TERRAIN_ETA[cls] ?? 1.2) >= 2) duneM += d;
    if (W.rockClass(mx, mz) && R.hazards.boulders) rockyM += d;
    if (slope > Rs.integrity.slip.from_deg && slope <= Rs.integrity.slip.to_deg) slipM += d;
    radInt += W.radiation(mx, mz) * d;
    // recorrer el tramo en pasos de dt a la velocidad de marcha (que cambia con la fatiga y la bateria)
    let done = 0;
    while (done < d - 1e-9) {
      const v = walkSpeed(game, st, W.slope(x, z), loadK);
      const h = Math.min(dt, (d - done) / v);
      const adv = Math.min(d - done, v * h);
      done += adv;
      x = x0 + ((x1 - x0) * done) / d; z = z0 + ((z1 - z0) * done) / d;
      const res = step(h, v * game.realPerWorld, grade, true);
      void res;
    }
    dist += d;
    // escala en un refugio: espera (en reposo, en el refugio) hasta recargar O2 y bateria; cuenta el tiempo,
    // el metabolismo y el ambiente de la espera, y los minimos antes, durante y despues
    const stop = refills.find((r) => r.i === i);
    if (stop) {
      const cap = stop.id === "rover" ? Rs.shelter_refill.rover_cap : 100;
      const rec = { id: stop.id, i, minO2Before: minO2, minEnergyBefore: minEn, waitMin: 0, minO2During: st.oxygen, minEnergyDuring: st.energy };
      const t0 = tReal, saved = st.inShelter;
      let guard = Math.ceil(7200 / dt);
      const full = () => (st.oxygen >= cap - 1e-6 || (st.locks && st.locks.oxygen)) && (st.energy >= cap - 1e-6 || (st.locks && st.locks.energy));
      while (!full() && guard-- > 0) {
        // la parada se hace en el refugio: si el punto de la ruta no cae dentro de su radio, se usa el refugio pedido
        const before = game.shelterAt ? game.shelterAt(x, z) : null;
        if (!before) { const o = game.objectives[stop.id]; if (o) { x = o.world.x; z = o.world.z; } }
        step(dt, 0, 0, false);
        rec.minO2During = Math.min(rec.minO2During, st.oxygen); rec.minEnergyDuring = Math.min(rec.minEnergyDuring, st.energy);
      }
      x = path[i][0]; z = path[i][1];
      st.inShelter = saved;
      rec.waitMin = (tReal - t0) / 60;
      rec._minO2At = minO2; rec._minEnAt = minEn;
      stops.push(rec);
      // los minimos "despues" se miden desde aqui
      minO2 = st.oxygen; minEn = st.energy;
      rec._after = true;
    }
    if (i % 4 === 0 || i === path.length - 1) profile.push([dist, W.demHeight(x1, z1) + W.yRef]);
  }
  // minimos despues de cada parada (hasta la siguiente o el final) y minimo global
  for (let k = 0; k < stops.length; k++) {
    const next = stops[k + 1];
    stops[k].minO2After = next ? next.minO2Before : minO2;
    stops[k].minEnergyAfter = next ? next.minEnergyBefore : minEn;
  }
  const globalMinO2 = Math.min(minO2, ...stops.map((r) => Math.min(r.minO2Before, r.minO2During)));
  const globalMinEn = Math.min(minEn, ...stops.map((r) => Math.min(r.minEnergyBefore, r.minEnergyDuring)));
  for (const r of stops) { delete r._minO2At; delete r._minEnAt; delete r._after; }
  const marsH = (tReal * ts) / 3600;
  const ok = blockedM < 1 && globalMinO2 > 20 && st.energy > 10 && st.integrity > 30;
  const risky = !ok || globalMinO2 < 35 || st.bio.fatigue > 60;
  return {
    dist, realMin: tReal / 60, marsH, arrivalHour: hour0 + marsH, kcal: st.bio.kcal, dose: st.bio.doseUgy,
    o2End: st.oxygen, minO2: globalMinO2, energyEnd: st.energy, minEnergy: globalMinEn, integrityEnd: st.integrity, minIntegrity: minInteg, fatigueEnd: st.bio.fatigue,
    o2g: st.bio.o2g, mEnd: st.bio.M,
    up, down, maxSlope, blockedM, rockyM, slipM, duneM, coldMin, classM, radMean: dist > 0 ? radInt / dist : 0,
    dustMax, speActiveMin: speActiveS / 60, stops,
    verdict: blockedM >= 1 ? "blocked" : !ok ? "fail" : risky ? "risky" : "ok",
    profile,
  };
}
