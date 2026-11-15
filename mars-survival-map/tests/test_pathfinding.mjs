// Fase 2: las rutas sugeridas no atraviesan celdas finas con cost === 0 ni cortan esquinas en diagonal.
// Validador independiente del Pathfinder: muestreo denso (px/24) + comprobacion de cruces diagonales.
import { loadData, ok, summary } from "./helpers.mjs";
import { World } from "../src/engine/world.js";
import { Pathfinder } from "../src/gameplay/pathfinding.js";

const data = loadData();
const world = new World(data);
const path = new Pathfinder(world, 2);
const n = world.n, half = world.half, px = world.size / n;
const cost = world.planes.cost;
const cellOf = (x, z) => [Math.min(n - 1, Math.max(0, Math.floor((z + half) / px))), Math.min(n - 1, Math.max(0, Math.floor((x + half) / px)))];
const blocked = (r, c) => r < 0 || c < 0 || r >= n || c >= n || cost[r * n + c] === 0;

// true si la polilinea pisa alguna celda bloqueada o cruza en diagonal entre dos bloqueadas.
// skipSet: celdas toleradas (la de salida y la de llegada, donde ya esta o quiere estar el usuario).
function routeInvalid(pts, skipSet) {
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
    const L = Math.hypot(x1 - x0, z1 - z0), steps = Math.max(2, Math.ceil((L / px) * 24));
    let pr = null, pc = null;
    for (let k = 0; k <= steps; k++) {
      const x = x0 + ((x1 - x0) * k) / steps, z = z0 + ((z1 - z0) * k) / steps;
      const [r, c] = cellOf(x, z);
      if (blocked(r, c) && !skipSet.has(r * n + c)) return `celda bloqueada (${r},${c}) en el tramo ${i}`;
      if (pr !== null && r !== pr && c !== pc) {
        // paso diagonal entre muestras: las dos ortogonales no pueden estar ambas bloqueadas
        if (blocked(pr, c) && blocked(r, pc)) return `corte diagonal entre (${pr},${pc}) y (${r},${c}) en el tramo ${i}`;
      }
      pr = r; pc = c;
    }
  }
  return null;
}
function skipFor(a, b) {
  const s = new Set();
  const [r0, c0] = cellOf(a[0], a[1]); s.add(r0 * n + c0);
  const [r1, c1] = cellOf(b[0], b[1]); s.add(r1 * n + c1);
  return s;
}
function checkRoute(label, a, b) {
  const r = path.find(a[0], a[1], b[0], b[1]);
  if (!r) { ok(false, `${label}: devuelve ruta`, "null"); return null; }
  const bad = routeInvalid(r, skipFor(a, b));
  ok(!bad, `${label}: ruta valida (${r.length} puntos)`, bad || "sin bloqueos ni cortes diagonales");
  const d0 = Math.hypot(r[0][0] - a[0], r[0][1] - a[1]), d1 = Math.hypot(r[r.length - 1][0] - b[0], r[r.length - 1][1] - b[1]);
  ok(d0 < 0.01 && d1 < 0.01, `${label}: extremos exactos`, `inicio ${d0.toFixed(3)} m, fin ${d1.toFixed(3)} m`);
  return r;
}

// ---- caso de regresion: tramo con pendiente > 25 grados en la linea recta ------------------------
{
  const a = [-1575, -855], b = [-1407, -639];
  const direct = routeInvalid([a, b], skipFor(a, b));
  ok(!!direct, "regresion: la linea recta (-1575,-855)->(-1407,-639) atraviesa bloqueos", direct || "");
  checkRoute("regresion (-1575,-855)->(-1407,-639)", a, b);
}

// ---- los cinco recorridos principales de la campana ---------------------------------------------
{
  const objs = Object.fromEntries(data.objectives.objectives.map((o) => [o.id, o]));
  const missions = [...data.missions.missions].sort((x, y) => x.order - y.order);
  let from = objs[data.missions.campaign.start_at];
  let fromPt = [from.world.x + 18, from.world.z + 14];          // punto inicial del jugador (game.reset)
  for (const m of missions) {
    const o = objs[m.objective_id];
    if (!o) continue;
    checkRoute(`campana ${m.id} -> ${m.objective_id}`, fromPt, [o.world.x, o.world.z]);
    fromPt = [o.world.x, o.world.z];
  }
}

// ---- el suavizado no reintroduce bloqueos (muchas rutas aleatorias deterministas) ----------------
{
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let okAll = 0, total = 0, nulls = 0;
  for (let i = 0; i < 40; i++) {
    const a = [(rnd() - 0.5) * 5200, (rnd() - 0.5) * 5200];
    const b = [(rnd() - 0.5) * 5200, (rnd() - 0.5) * 5200];
    const r = path.find(a[0], a[1], b[0], b[1]);
    if (!r) { nulls++; continue; }
    total++;
    if (!routeInvalid(r, skipFor(a, b))) okAll++;
  }
  ok(okAll === total, `40 rutas aleatorias: todas las devueltas son validas`, `${okAll}/${total} validas, ${nulls} null`);
}
summary("test_pathfinding");
