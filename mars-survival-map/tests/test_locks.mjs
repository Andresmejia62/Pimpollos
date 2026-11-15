// Fase 3: con un recurso desactivado en modo libre, ningun subsistema lo reduce (clima, escaneo, compañero,
// golpes, tormenta solar); las recargas siguen funcionando; la fisiologia y la dosis se siguen calculando.
// Ademas: reiniciar recupera la carga correcta (sin muestras de la partida anterior).
import { ok, summary } from "./helpers.mjs";
import { makeSim, frame } from "./harness.mjs";
import { BUDDY } from "../src/gameplay/companion.js";
import { BASE_KIT_KG } from "../src/engine/physiology.js";

// ---- modo libre con todo bloqueado bajo tormenta de polvo maxima y tormenta solar activa ------------------
{
  const sim = makeSim(), g = sim.game, w = sim.weather;
  g.startFree();
  Object.assign(g.s.sim, { lockO2: true, lockEnergy: true, lockIntegrity: true });
  // fuera de cualquier refugio, en terreno con radiacion
  g.teleport(-1500, -800);
  g.s.oxygen = 60; g.s.energy = 60; g.s.integrity = 60;
  w.startStorm();
  w.storm = { phase: "peak", t: 0, level: 1, tau: 4.2 };
  g.triggerStorm(); g.s.spe.phase = "active"; g.s.spe.t = 1e6;
  const o2g0 = g.s.bio.o2g, dose0 = g.s.bio.doseUgy;
  for (let i = 0; i < 900; i++) frame(sim, 1 / 30, [0.6, 0.8]);
  ok(g.s.oxygen === 60 && g.s.energy === 60 && g.s.integrity === 60, "bloqueado: clima + SPE + marcha no reducen O2/bateria/integridad", `O2 ${g.s.oxygen} · E ${g.s.energy} · I ${g.s.integrity}`);
  ok(g.dustLevel > 0.75, "la tormenta de polvo estaba activa durante la prueba", `nivel ${g.dustLevel.toFixed(2)}`);
  ok(g.s.bio.o2g > o2g0 && g.s.bio.doseUgy > dose0, "bloqueado: la fisiologia y la dosis se siguen registrando", `O2 ${(g.s.bio.o2g - o2g0).toFixed(2)} g · dosis +${(g.s.bio.doseUgy - dose0).toFixed(3)} µGy`);
  // escaneo: coste del escaner bloqueado (durante una tormenta solar no se escanea: se termina antes)
  g.endStorm();
  g.setFreeTarget(g.s.x, g.s.z, [0, 0]);
  const e0 = g.s.energy;
  for (let i = 0; i < 400 && !g.s.scanned; i++) frame(sim, 1 / 30, null);
  ok(g.s.scanned && g.s.energy === e0, "bloqueado: el escaneo no gasta bateria", `escaneado ${g.s.scanned} · E ${g.s.energy}`);
  // compañero: compartir O2 al rescatarlo
  const b = sim.buddy.st;
  Object.assign(b, { mode: "stuck", x: g.s.x + 1, z: g.s.z, o2: 50 });
  const o0 = g.s.oxygen;
  for (let i = 0; i < 200 && b.mode !== "follow"; i++) frame(sim, 1 / 30, null, { assist: true });
  ok(b.mode === "follow" && g.s.oxygen === o0, "bloqueado: rescatar a EVA-2 no gasta O2", `modo ${b.mode} · O2 ${g.s.oxygen}`);
  // golpes: gasto directo por el canal central
  ok(g.spend("integrity", 5) === 0 && g.s.integrity === 60, "bloqueado: un golpe no reduce la integridad");
  // recargas: siguen funcionando
  g.s.oxygen = 40; g.s.energy = 40;
  const hab = g.objectives.habitat;
  g.teleport(hab.world.x, hab.world.z);
  for (let i = 0; i < 60; i++) frame(sim, 1 / 30, null);
  ok(g.s.oxygen > 40 && g.s.energy > 40, "bloqueado: la recarga en el refugio sigue funcionando", `O2 ${g.s.oxygen.toFixed(2)} · E ${g.s.energy.toFixed(2)}`);
}

// ---- sin bloqueos, los mismos subsistemas si gastan (control de la prueba) ---------------------------------
{
  const sim = makeSim(), g = sim.game, w = sim.weather;
  g.startFree();
  g.teleport(-1500, -800);
  w.storm = { phase: "peak", t: 0, level: 1, tau: 4.2 };
  const i0 = g.s.integrity, e0 = g.s.energy;
  for (let i = 0; i < 300; i++) frame(sim, 1 / 30, null);
  ok(g.s.integrity < i0 && g.s.energy < e0, "sin bloqueo: el polvo desgasta el traje y gasta bateria", `I -${(i0 - g.s.integrity).toFixed(4)} · E -${(e0 - g.s.energy).toFixed(4)}`);
  g.s.oxygen = 70; g.spend("oxygen", BUDDY.shareO2);
  ok(Math.abs(g.s.oxygen - (70 - BUDDY.shareO2)) < 1e-12, "sin bloqueo: spend() descuenta el O2 compartido");
  // en la campana no hay bloqueos aunque s.sim tenga valores
  const c = makeSim().game;
  c.reset(); c.startMission(0); c.beginMission();
  Object.assign(c.s.sim, { lockO2: true, lockEnergy: true, lockIntegrity: true });
  ok(c.locks() === null, "campana: los bloqueos del modo libre no se aplican");
}

// ---- reiniciar recupera la carga correcta -------------------------------------------------------------
{
  const sim = makeSim(), g = sim.game;
  g.reset(); g.startMission(0); g.beginMission();
  g.s.cargo.carried = 3; g._applyLoad();
  const loaded = g.bio.loadKg;
  g.reset();
  ok(Math.abs(g.bio.loadKg - BASE_KIT_KG) < 1e-9 && loaded > BASE_KIT_KG, "reset(): la fisiologia vuelve al kit base", `${loaded.toFixed(1)} kg -> ${g.bio.loadKg.toFixed(1)} kg`);
  ok(Math.abs(g.s.bio.M - g.bio.metabolic(0)) < 1e-9, "reset(): metabolismo inicial en reposo con la carga correcta", `${g.s.bio.M.toFixed(1)} W`);
  // retry: vuelve a la carga del punto de control
  g.startMission(0); g.beginMission();
  g.s.cargo.carried = 2; g._applyLoad();
  g.retry();
  ok(Math.abs(g.bio.loadKg - g.cargoKg()) < 1e-9 && g.s.cargo.carried === 0, "retry(): carga del punto de control", `${g.bio.loadKg.toFixed(1)} kg`);
}
summary("test_locks");
