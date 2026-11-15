// Planificacion de la EVA: estima tiempo, oxigeno, energia, integridad, fatiga y dosis de una ruta
// antes de salir. Usa las mismas reglas que Game.update (rules.json + engine/physiology.js), recorriendo
// la ruta en pasos de ~6 m a la velocidad que tendria el astronauta (pendiente, rocas, fatiga, carga).
import { REF, REF_FLAT_W, TERRAIN_ETA } from "../engine/physiology.js";

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

// stops: indices de la polilinea densificada donde hay un refugio (recarga segun rules.json -> shelter_refill)
export function estimateRoute(game, pts, { start = game.s, refills = [] } = {}) {
  const W = game.world, R = game.rules, Rs = R.resources, H = R.hazards, bio = game.bio;
  const ts = R.time.time_scale, ws = R.movement.walk_speed_mps;
  const path = densify(pts);
  let o2 = start.oxygen, en = start.energy, integ = start.integrity, fatigue = start.bio?.fatigue || 0;
  let tReal = 0, dist = 0, kcal = 0, dose = 0, up = 0, down = 0, maxSlope = 0, minO2 = o2;
  let blockedM = 0, rockyM = 0, slipM = 0, duneM = 0, coldMin = Infinity, radInt = 0;
  const classM = [0, 0, 0, 0, 0];             // metros sobre cada clase mineral de CRISM (0 sin firma .. 4 dunas)
  const profile = [[0, W.demHeight(path[0][0], path[0][1]) + W.yRef]];
  const hour0 = game.hour;
  for (let i = 1; i < path.length; i++) {
    const [x0, z0] = path[i - 1], [x1, z1] = path[i];
    const d = Math.hypot(x1 - x0, z1 - z0);
    if (d < 1e-6) continue;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const h0 = W.demHeight(x0, z0), h1 = W.demHeight(x1, z1), grade = (h1 - h0) / d;
    const slope = W.slope(mx, mz);
    maxSlope = Math.max(maxSlope, slope);
    if (h1 > h0) up += h1 - h0; else down += h0 - h1;
    if (W.blockedAt(mx, mz)) blockedM += d;
    const cls = W.spectral(mx, mz);
    classM[cls] = (classM[cls] || 0) + d;
    let eta = TERRAIN_ETA[cls] ?? 1.2;
    if (eta >= 2) duneM += d;
    const rc = W.rockClass ? W.rockClass(mx, mz) : 0;
    if (rc && H.boulders) { eta = Math.max(eta, rc === 2 ? H.boulders.eta_field : H.boulders.eta_rocky); rockyM += d; }
    const slopeK = clamp(1 - (slope - H.slope.slow_above_deg) / 26, 0.5, 1);
    const v = ws * slopeK * (en <= 0 ? 0.4 : 1) * game.speedK * (game.loadK || 1) * (1 - 0.45 * Math.min(1, fatigue / 100));
    const dt = d / v, dtg = dt * ts;
    tReal += dt; dist += d;
    const M = bio.metabolic(v * game.realPerWorld, grade, eta);
    const p = bio.pctVO2max(M);
    fatigue = clamp(fatigue + (p > 0.55 ? (p - 0.55) * 0.1 : -(0.55 - p) * 0.12) * dtg, 0, 100);
    kcal += (bio.kcalPerH(M) * dtg) / 3600;
    o2 -= (100 * ((bio.o2gPerH(M) * dtg) / 3600) * (en <= 0 ? 1.5 : 1)) / game.o2CapacityG;
    const hour = hour0 + (tReal * ts) / 3600;
    const temp = W.temperature(mx, mz, hour);
    coldMin = Math.min(coldMin, temp);
    const cold = Rs.energy.cold.extra_per_deg * Math.max(0, Rs.energy.cold.comfort_c - temp) * (bio.bsa / REF.bsa) * clamp(Math.sqrt(REF_FLAT_W / M), 0.7, 1.3);
    en = Math.max(0, en - Rs.energy.base_drain_per_s * (0.85 + 0.15 * (M / REF_FLAT_W)) * (1 + cold) * (game.diff ? game.diff.drainK : 1) * dt);
    const rad = W.radiation(mx, mz);
    radInt += rad * d;
    integ -= Rs.integrity.radiation.k_per_ugy_h * rad * (game.diff ? game.diff.damageK : 1) * dt;
    dose += (rad * dtg) / 3600;
    if (slope > Rs.integrity.slip.from_deg && slope <= Rs.integrity.slip.to_deg) { integ -= Rs.integrity.slip.drain_per_s * dt; slipM += d; }
    // escala en un refugio: recarga O2 y energia (el rover solo hasta rover_cap)
    const stop = refills.find((r) => r.i === i);
    if (stop) {
      const cap = stop.id === "rover" ? Rs.shelter_refill.rover_cap : 100;
      const need = Math.max(0, cap - Math.min(o2, en));
      tReal += need / Rs.shelter_refill.oxygen_per_s;
      o2 = Math.max(o2, cap); en = Math.max(en, cap);
    }
    minO2 = Math.min(minO2, o2);
    if (i % 4 === 0 || i === path.length - 1) profile.push([dist, h1 + W.yRef]);
  }
  const marsH = (tReal * ts) / 3600;
  const ok = blockedM < 1 && minO2 > 20 && en > 10 && integ > 30;
  const risky = !ok || minO2 < 35 || fatigue > 60;
  return {
    dist, realMin: tReal / 60, marsH, arrivalHour: hour0 + marsH, kcal, dose,
    o2End: o2, minO2, energyEnd: en, integrityEnd: integ, fatigueEnd: fatigue,
    up, down, maxSlope, blockedM, rockyM, slipM, duneM, coldMin, classM, radMean: dist > 0 ? radInt / dist : 0,
    verdict: blockedM >= 1 ? "blocked" : !ok ? "fail" : risky ? "risky" : "ok",
    profile,
  };
}
