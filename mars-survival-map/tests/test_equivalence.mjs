// Fase 4: equivalencia numerica entre el motor (Game._simStep, lo que ejecuta Game.update en cada fotograma)
// y el planificador (estimateRoute), sobre la misma ruta, paso a paso, con estados independientes.
//
// Montaje: dos partidas identicas (mismo perfil, carga, recursos, hora, tormenta solar y semilla del PRNG).
// El planificador recorre la ruta y anota en cada paso sus entradas (dt, posicion, velocidad, pendiente,
// marcha/espera, polvo). El motor reproduce exactamente esas entradas con su propio codigo de partida
// (_simStep: reloj, deteccion de refugio, nucleo, tormenta solar, bloqueos) y se comparan los estados.
// Incluye: tormenta solar (aviso -> activa durante la ruta), tormenta de polvo (rampa 0 -> 1 -> 0,4),
// paso por un refugio y una parada de recarga con espera.
//
// Tolerancias (absolutas y relativas; se aplica la mayor de |abs| y |rel * valor|):
//   tiempo            abs 1e-9 s
//   O2, bateria, integridad   abs 1e-8 puntos %, rel 1e-10
//   fatiga            abs 1e-8 puntos %
//   metabolismo M     abs 1e-8 W, rel 1e-12
//   O2 consumido      abs 1e-8 g, rel 1e-10;   energia del cuerpo  abs 1e-8 kcal, rel 1e-10
//   dosis             abs 1e-10 µGy, rel 1e-10
// Justificacion: los dos lados ejecutan las mismas funciones en float64 y en el mismo orden; la unica
// diferencia de redondeo es como se acumula la hora (gameSeconds del motor frente a tReal * time_scale del
// planificador), del orden de 1e-15 relativo por paso; con ~1e4 pasos el error esperado es < 1e-11 relativo.
// Un error de logica o de unidades (un factor x14 de tiempo de Marte, un multiplicador olvidado, el refugio sin
// aplicar) cambia los resultados al menos en 1e-4 por paso, muy por encima de estas tolerancias.
import { ok, approx, summary } from "./helpers.mjs";
import { makeSim } from "./harness.mjs";
import { estimateRoute, densify } from "../src/gameplay/planner.js";
import { thermalOffsetFor } from "../src/gameplay/weather.js";

const TOL = {
  time: [1e-9, 0], res: [1e-8, 1e-10], fatigue: [1e-8, 0], M: [1e-8, 1e-12], o2g: [1e-8, 1e-10], kcal: [1e-8, 1e-10], dose: [1e-10, 1e-10],
};
const within = (a, b, [abs, rel]) => Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));

// polvo en funcion del tiempo real: llega a los 40 s, satura a los 100 s y baja a 0,4 desde los 400 s
const dustAt = (t) => t < 40 ? 0 : t < 100 ? (t - 40) / 60 : t < 400 ? 1 : 0.4;

function setupGame(sim, spe) {
  const g = sim.game;
  g.startFree();                                 // sin campana: la tormenta solar no cierra misiones
  g.setHour(13.2);
  g.s.oxygen = 82; g.s.energy = 77; g.s.integrity = 91;
  g.s.bio.fatigue = 12; g.s.bio.M = g.bio.metabolic(0);
  g.s.cargo.carried = 1; g._applyLoad();         // carga: kit + 1 muestra
  g.s.spe = spe ? { ...spe } : null;
  g.rng.setState({ seed: 4242, s: 4242 });       // misma semilla en las dos partidas (el nucleo no usa azar)
  return g;
}

const simA = makeSim(), simB = makeSim({ withWeather: false, withBuddy: false });
const SPE = { phase: "warning", t: 25, sheltered: 0, active: 0 };
const A = setupGame(simA, SPE), B = setupGame(simB, SPE);

// ruta: salida -> refugio (parada de recarga) -> mas alla, con tramos reales del A*
const shelter = A.objectives.refugio_sur || Object.values(A.objectives).find((o) => o.shelter && o.id !== "habitat");
const P0 = [shelter.world.x - 420, shelter.world.z - 260], S = [shelter.world.x, shelter.world.z], P2 = [shelter.world.x + 300, shelter.world.z + 180];
const leg1 = simA.path.find(P0[0], P0[1], S[0], S[1]), leg2 = simA.path.find(S[0], S[1], P2[0], P2[1]);
ok(!!leg1 && !!leg2, "ruta de prueba encontrada (A* hasta el refugio y despues)", `refugio ${shelter.id}`);
const pts = [...leg1, ...leg2.slice(1)];
// indice de la parada en la polilinea densificada (como ui/planner.js -> _make)
let idx = 0;
for (let i = 1; i < leg1.length; i++) idx += Math.max(1, Math.ceil(Math.hypot(leg1[i][0] - leg1[i - 1][0], leg1[i][1] - leg1[i - 1][1]) / 6));
ok(Math.hypot(densify(pts)[idx][0] - S[0], densify(pts)[idx][1] - S[1]) < 1e-6, "la parada cae sobre el refugio", `indice ${idx}`);

// estado de la partida A antes de estimar (para comprobar que el planificador no la toca)
const snapA = () => JSON.stringify({ s: A.s, rng: A.rng.getState(), w: simA.weather.getState(), dust: A.dustLevel });
const before = snapA();

// ---- planificador ----
const trace = [];
const est = estimateRoute(A, pts, { refills: [{ i: idx, id: shelter.id }], dt: 0.25, dustAt, trace });
ok(snapA() === before, "estimar la ruta no modifica la partida, su clima ni su PRNG");
ok(trace.length > 200, "el planificador recorrio la ruta paso a paso", `${trace.length} pasos · ${est.realMin.toFixed(2)} min · ${est.dist.toFixed(0)} m`);
ok(trace.some((e) => !e.onFoot) && est.stops.length === 1 && est.stops[0].waitMin > 0, "hubo parada de recarga con espera", `${est.stops[0].waitMin.toFixed(2)} min`);
ok(trace.some((e) => e.dustLevel >= 1) && est.speActiveMin > 0, "condiciones: polvo saturado y tormenta solar activa durante la ruta", `SPE activa ${est.speActiveMin.toFixed(2)} min`);

// ---- motor: mismas entradas con el codigo de la partida ----
const t0 = B.s.realSeconds;
const stub = { level: 0, cover: 0, thermalOffset(h) { return thermalOffsetFor(this.level, h); } };
B.weather = stub;
let worst = {}, firstBad = null;
const engine = [];
const fields = [["oxygen", "res"], ["energy", "res"], ["integrity", "res"], ["fatigue", "fatigue"], ["M", "M"], ["o2g", "o2g"], ["kcal", "kcal"], ["doseUgy", "dose"]];
for (let k = 0; k < trace.length; k++) {
  const e = trace[k];
  B.s.x = e.x; B.s.z = e.z;
  B.dustLevel = e.dustLevel; stub.level = e.dustLevel;
  B._simStep(e.dt, { x: e.x, z: e.z, vReal: e.vReal, grade: e.grade, onFoot: e.onFoot, driving: false });
  const got = { tReal: B.s.realSeconds - t0, oxygen: B.s.oxygen, energy: B.s.energy, integrity: B.s.integrity, fatigue: B.s.bio.fatigue, M: B.s.bio.M, o2g: B.s.bio.o2g, kcal: B.s.bio.kcal, doseUgy: B.s.bio.doseUgy, inShelter: B.s.inShelter };
  engine.push(got);
  if (!within(got.tReal, e.tReal, TOL.time) && !firstBad) firstBad = `paso ${k}: tiempo ${got.tReal} != ${e.tReal}`;
  if (got.inShelter !== e.inShelter && !firstBad) firstBad = `paso ${k}: refugio ${got.inShelter} != ${e.inShelter}`;
  for (const [f, tk] of fields) {
    const d = Math.abs(got[f] - e[f]);
    worst[f] = Math.max(worst[f] || 0, d);
    if (!within(got[f], e[f], TOL[tk]) && !firstBad) firstBad = `paso ${k}: ${f} motor ${got[f]} != planificador ${e[f]}`;
  }
}
ok(!firstBad, "equivalencia paso a paso (tiempo, refugio, O2, bateria, integridad, fatiga, M, O2 g, kcal, dosis)", firstBad || `${trace.length} pasos`);
console.log("     diferencias maximas:", Object.entries(worst).map(([k, v]) => `${k} ${v.toExponential(2)}`).join(" · "));

// ---- final ----
const last = engine[engine.length - 1];
approx(last.tReal / 60, est.realMin, 1e-9 / 60, 0, "final: tiempo transcurrido", "min");
approx(last.oxygen, est.o2End, ...TOL.res, "final: O2", "%");
approx(last.energy, est.energyEnd, ...TOL.res, "final: bateria", "%");
approx(last.integrity, est.integrityEnd, ...TOL.res, "final: integridad", "%");
approx(last.fatigue, est.fatigueEnd, ...TOL.fatigue, "final: fatiga", "%");
approx(last.M, est.mEnd, ...TOL.M, "final: metabolismo", "W");
approx(last.o2g, est.o2g, ...TOL.o2g, "final: O2 consumido", "g");
approx(last.kcal, est.kcal, ...TOL.kcal, "final: energia del cuerpo", "kcal");
approx(last.doseUgy, est.dose, ...TOL.dose, "final: dosis acumulada", "µGy");

// ---- minimos de recursos antes, durante y despues de la parada ----
{
  const firstWait = trace.findIndex((e) => !e.onFoot), lastWait = trace.length - 1 - [...trace].reverse().findIndex((e) => !e.onFoot);
  const startO2 = 82, startEn = 77;
  const mn = (a, b, key, init) => engine.slice(a, b).reduce((m, x) => Math.min(m, x[key]), init);
  const atWaitStart = engine[firstWait - 1];
  const r = est.stops[0];
  approx(mn(0, firstWait, "oxygen", startO2), r.minO2Before, ...TOL.res, "parada: O2 minimo antes", "%");
  approx(mn(firstWait, lastWait + 1, "oxygen", atWaitStart.oxygen), r.minO2During, ...TOL.res, "parada: O2 minimo durante", "%");
  approx(mn(lastWait + 1, engine.length, "oxygen", engine[lastWait].oxygen), r.minO2After, ...TOL.res, "parada: O2 minimo despues", "%");
  approx(mn(0, firstWait, "energy", startEn), r.minEnergyBefore, ...TOL.res, "parada: bateria minima antes", "%");
  approx(mn(firstWait, lastWait + 1, "energy", atWaitStart.energy), r.minEnergyDuring, ...TOL.res, "parada: bateria minima durante", "%");
  approx(mn(lastWait + 1, engine.length, "energy", engine[lastWait].energy), r.minEnergyAfter, ...TOL.res, "parada: bateria minima despues", "%");
  ok(engine.slice(firstWait, lastWait + 1).every((x) => x.inShelter), "durante la espera el motor tambien esta en el refugio");
}

// ---- efectos que el planificador debe reflejar --------------------------------------------------------
{
  const base = estimateRoute(A, pts, { dustAt: () => 0, start: { ...A.s, spe: null } });
  const spe = estimateRoute(A, pts, { dustAt: () => 0, start: { ...A.s, spe: { phase: "active", t: 1e6, sheltered: 0, active: 0 } } });
  ok(spe.dose > base.dose * 1.5, "una tormenta solar activa aumenta la exposicion estimada", `${base.dose.toFixed(2)} -> ${spe.dose.toFixed(2)} µGy`);
  const dust = estimateRoute(A, pts, { dustAt: () => 1, start: { ...A.s, spe: null } });
  ok(dust.integrityEnd < base.integrityEnd && dust.energyEnd < base.energyEnd, "la tormenta de polvo aumenta el desgaste y el gasto estimados", `I ${base.integrityEnd.toFixed(3)} -> ${dust.integrityEnd.toFixed(3)} · E ${base.energyEnd.toFixed(3)} -> ${dust.energyEnd.toFixed(3)}`);
  ok(dust.coldMin !== base.coldMin, "el efecto termico del polvo cambia la temperatura estimada", `${base.coldMin.toFixed(1)} -> ${dust.coldMin.toFixed(1)} °C`);
  const withStop = estimateRoute(A, pts, { dustAt: () => 0, start: { ...A.s, spe: null, oxygen: 50, energy: 50 }, refills: [{ i: idx, id: shelter.id }] });
  const noStop = estimateRoute(A, pts, { dustAt: () => 0, start: { ...A.s, spe: null, oxygen: 50, energy: 50 } });
  ok(withStop.realMin > noStop.realMin + 0.5 * withStop.stops[0].waitMin && withStop.stops[0].waitMin > 0, "la recarga incluye el tiempo de permanencia", `${noStop.realMin.toFixed(2)} -> ${withStop.realMin.toFixed(2)} min (espera ${withStop.stops[0].waitMin.toFixed(2)} min)`);
  ok(withStop.o2End > noStop.o2End, "la recarga se refleja en el O2 final", `${noStop.o2End.toFixed(1)} -> ${withStop.o2End.toFixed(1)} %`);
  ok(snapA() === before, "ninguna estimacion modifico la partida");
}
summary("test_equivalence");
