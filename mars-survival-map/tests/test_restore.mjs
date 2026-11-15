// Fase 3: capturar un punto de control, avanzar la simulacion, restaurarlo y repetir las mismas entradas
// reproduce los mismos eventos (tormentas, remolinos, tormenta solar, refugios, compañero) y estados.
import { ok, summary } from "./helpers.mjs";
import { makeSim, frame } from "./harness.mjs";

const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === "sway" ? undefined : v)));   // sway: azar solo visual
const snapshot = (sim) => strip({
  s: sim.game.s, rng: sim.game.rng.getState(), weather: sim.weather.getState(), buddy: sim.buddy.getState(),
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function firstDiff(a, b, path = "") {
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return a === b ? null : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], `${path}.${k}`); if (d) return d; }
  return null;
}

// entradas deterministas: direccion de marcha que cambia poco a poco, y una tormenta solar a mitad
const N = 3600, DT = 1 / 30;
const input = (i) => { const a = Math.sin(i / 400) * 1.2 + 0.4; return i % 900 < 700 ? [Math.sin(a), Math.cos(a)] : null; };
function run(sim) {
  const g = sim.game;
  sim.events.length = 0;
  const devils = [];                 // remolinos que nacen (posicion de nacimiento y tiempo)
  let nDev = sim.weather.devils.length;
  for (let i = 0; i < N; i++) {
    if (i === 2700) g.triggerStorm();
    frame(sim, DT, input(i), { assist: i % 50 < 30 });
    const D = sim.weather.devils;
    if (D.length > nDev) devils.push([+D[D.length - 1].x.toFixed(6), +D[D.length - 1].z.toFixed(6), +sim.weather.clock.toFixed(4)]);
    nDev = D.length;
    if (g.s.phase !== "playing") break;
  }
  return { events: sim.events.slice(), devils, snap: snapshot(sim) };
}

const sim = makeSim(), g = sim.game, w = sim.weather;
g.reset();
g.startMission(0);
g.beginMission();
// condiciones con azar: tormenta de polvo pronta y remolinos de mediodia (todo sale del generador con semilla)
g.setHour(12.5);
w.nextStorm = 50; w.nextDevil = 1;
const cp = g.captureCheckpoint();
ok(cp.rng && Number.isFinite(cp.rng.seed) && Number.isFinite(cp.rng.s), "el checkpoint guarda la semilla y el estado interno del PRNG", JSON.stringify(cp.rng));
ok(cp.ext && cp.ext.weather && cp.ext.buddy, "el checkpoint incluye clima y EVA-2 (datos serializables, sin objetos graficos)", `claves: ${Object.keys(cp.ext).join(", ")}`);
ok(!JSON.stringify(cp).includes('"isMesh"') && !("g" in (cp.ext.weather.devils[0] || {})), "el checkpoint no contiene mallas ni materiales");

const A = run(sim);
const kinds = new Set(A.events.map((e) => e[0] === "alert" ? e[1] : e[0]));
ok(kinds.has("a_dust_forecast") && kinds.has("a_dust_storm") && kinds.has("spe"), "la ejecucion produce eventos de azar y de reloj", [...kinds].join(", "));
ok(A.devils.length > 0, "nacieron remolinos de polvo durante la ejecucion", `${A.devils.length} remolinos`);
ok(!same(A.snap.rng, cp.rng), "el PRNG avanzo durante la ejecucion");

// ---- restaurar ----
const sciBefore = cp.s.science;
g.retry();
ok(same(g.rng.getState(), cp.rng), "retry(): restaura el estado interno del PRNG");
ok(g.s.science === sciBefore && g.s.phase === "briefing", "retry(): puntuacion y fase del punto de control", `ciencia ${g.s.science}`);
ok(same(strip(w.getState()), strip(cp.ext.weather)), "retry(): restaura el clima (tormenta, temporizadores, remolinos)");
ok(same(sim.buddy.getState(), cp.ext.buddy), "retry(): restaura EVA-2 (posicion, O2, tareas, bonos, rescate)");
g.beginMission();

const B = run(sim);
ok(A.events.length === B.events.length && same(A.events, B.events), "repetir las entradas reproduce los mismos eventos", `${A.events.length} eventos`);
ok(same(A.devils, B.devils), "repetir las entradas reproduce los mismos remolinos (lugar y momento)", `${B.devils.length} remolinos`);
const d = firstDiff(A.snap, B.snap);
ok(!d, "repetir las entradas reproduce el mismo estado final (jugador, clima, EVA-2, PRNG)", d || `O2 ${B.snap.s.oxygen.toFixed(6)} · E ${B.snap.s.energy.toFixed(6)} · I ${B.snap.s.integrity.toFixed(6)}`);

// ---- los fotogramas en pausa no consumen el generador ----
{
  const s2 = makeSim(), g2 = s2.game;
  g2.reset(); g2.startMission(0);                   // fase briefing: la simulacion no corre
  const r0 = g2.rng.getState();
  for (let i = 0; i < 300; i++) frame(s2, DT, null);
  ok(same(g2.rng.getState(), r0), "en pausa/briefing los fotogramas no avanzan el PRNG ni el clima", `clock ${s2.weather.clock}`);
}
summary("test_restore");
