// EVA-2: compañero controlado por el juego. La regla de seguridad de las EVA reales es no salir nunca solo
// ("buddy system"). EVA-2:
//  - te sigue a unos metros, por terreno transitable (A* si se queda atras o hay un obstaculo);
//  - hace una segunda tarea en cada objetivo: mide con sus instrumentos el punto (datos reales de las capas);
//  - en la mision del canal de Gediz Vallis resbala y queda atrapado: tienes que llegar y mantener F para
//    ayudarlo (le pasas parte de tu O2 por la manguera de emergencia, como el "buddy breathing" de los trajes EMU).
//    Si tardas, no se va: abre su reserva de emergencia (como el SOP de los trajes EMU) y te espera sentado.
//    Despues del rescate cojea hasta el siguiente refugio, donde se recupera.
// Su O2 se gasta con el modelo metabolico del astronauta de referencia y se recarga en los refugios.
import { REF } from "../engine/physiology.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const L = (es, en) => ({ es, en });

export const BUDDY = {
  followDist: 5, catchupDist: 40, warpDist: 160,
  rescueMission: "obj_azufre", triggerDist: 520, assistS: 3, shareO2: 8,
  leakPerS: 0.35, abortBelow: 12, bonusTask: 15, bonusRescue: 60, bonusLate: 30, limpK: 0.6,
};

export class Companion {
  constructor(game, world, path, groundAt) {
    Object.assign(this, { game, world, path, groundAt });
    this.listeners = {};
    this.reset();
    // su estado (posicion, O2, tareas, bonificaciones, rescate, temporizadores) entra en los puntos de control
    game.registerState("buddy", { get: () => this.getState(), set: (st) => this.setState(st) });
  }
  getState() { return JSON.parse(JSON.stringify(this.st)); }
  // se actualiza en el sitio: el minimapa y la escena guardan una referencia a this.st
  setState(st) { this._assign(JSON.parse(JSON.stringify(st))); }
  _assign(v) {
    if (!this.st) { this.st = v; return; }
    for (const k of Object.keys(this.st)) delete this.st[k];
    Object.assign(this.st, v);
  }
  // reloj de la simulacion en ms (no el reloj de pared: al reintentar, los temporizadores se repiten igual)
  get _now() { return this.game.s.realSeconds * 1000; }
  on(e, fn) { (this.listeners[e] ||= []).push(fn); }
  emit(e, p) { (this.listeners[e] || []).forEach((fn) => fn(p)); }

  reset() {
    const s = this.game.s;
    this._assign({
      x: s.x - 3, z: s.z + 3, heading: s.heading, speed: 0, o2: 100,
      mode: "follow", route: null, routeAt: 0, stuckT: 0, assist: 0,
      tasksDone: {}, taskT: 0, rescueDone: false, bonus: 0, limp: false,
    });
  }
  // al reintentar una mision el compañero vuelve con el jugador
  snapTo(s) {
    const b = this.st;
    if (b.mode === "stuck" || b.mode === "reserve") { b.mode = "follow"; b.assist = 0; b.o2 = Math.max(b.o2, 60); b.limp = true; }
    if (!b.taskObj) { b.x = s.x - 3; b.z = s.z + 3; }
    b.route = null;
  }

  update(dt, assistHeld) {
    const g = this.game, s = g.s, b = this.st, W = this.world, R = g.rules;
    const ts = R.time.time_scale;
    const dP = Math.hypot(s.x - b.x, s.z - b.z);
    const m = g.mission, obj = g.objectives[m.objective_id];

    // ---- rescate guionizado en el canal de Gediz Vallis ----
    // (no mientras va en el rover contigo: primero bajais los dos)
    if (b.mode === "follow" && !b.rescueDone && !s.driving && m.objective_id === BUDDY.rescueMission && !(s.spe && s.spe.phase !== "ended")) {
      if (g.distTo(obj) < BUDDY.triggerDist && dP < 30) {
        // si acaba de bajar del rover esta encima de ti: cae unos metros detras, en suelo transitable
        if (b.riding || dP < 2.5) this._placeNear(s, 6);
        b.riding = false;
        b.mode = "stuck"; b.speed = 0;
        this.emit("stuck", { x: b.x, z: b.z });
      }
    }
    if (b.mode === "stuck" || b.mode === "reserve") {
      b.speed = 0;
      if (b.riding) { b.riding = false; if (dP < 2.5) this._placeNear(s, 6); }   // nunca herido "dentro" del rover
      if (b.mode === "stuck") b.o2 -= BUDDY.leakPerS * dt;  // fuga en la junta de la rodilla
      if (dP < 4.5 && assistHeld) {
        b.assist += dt;
        if (b.assist >= BUDDY.assistS) {
          const late = b.mode === "reserve", bonus = late ? BUDDY.bonusLate : BUDDY.bonusRescue;
          b.mode = "follow"; b.rescueDone = true; b.assist = 0; b.limp = true;
          g.spend("oxygen", BUDDY.shareO2); b.o2 = Math.min(100, b.o2 + BUDDY.shareO2 * 1.5);
          b.bonus += bonus; s.science += bonus;
          this.emit("rescued", { bonus, late });
        }
      } else b.assist = Math.max(0, b.assist - dt * 2);
      // sin margen: abre la reserva de emergencia y espera sentado (ya no pierde O2, pero sigue herido)
      if (b.mode === "stuck" && b.o2 <= BUDDY.abortBelow) {
        b.mode = "reserve"; b.o2 = BUDDY.abortBelow;
        this.emit("reserve", {});
      }
      return;
    }
    // cojea hasta llegar a un refugio, donde se recupera
    if (b.limp) for (const o of Object.values(g.objectives)) {
      if (o.shelter && Math.hypot(o.world.x - b.x, o.world.z - b.z) < g.radiusOf(o) + 8) { b.limp = false; this.emit("recovered", { where: o }); break; }
    }

    // ---- O2 de EVA-2 (metabolismo del astronauta de referencia) ----
    const vReal = b.speed * g.realPerWorld;
    const M = REF.metabolic(vReal, 0, 1.2);
    b.o2 -= (100 * ((REF.o2gPerH(M) * dt * ts) / 3600)) / g.o2CapacityG;
    if (s.inShelter && dP < 30) b.o2 = Math.min(100, b.o2 + R.resources.shelter_refill.oxygen_per_s * dt);
    b.o2 = clamp(b.o2, 0, 100);

    // ---- segunda tarea: medir junto al objetivo mientras tu escaneas (sigue aunque la mision avance) ----
    const storm = s.spe && s.spe.phase !== "ended";
    if (!b.taskObj && !storm && obj && obj.type === "science" && !b.tasksDone[obj.id] && g.distTo(obj) < 70) b.taskObj = obj.id;
    if (b.taskObj && !storm) {
      const o = g.objectives[b.taskObj];
      const tx = o.world.x + 9, tz = o.world.z - 7;
      if (Math.hypot(s.x - tx, s.z - tz) > 150) { b.tasksDone[o.id] = true; b.taskObj = null; b.taskT = 0; }   // te fuiste sin esperarlo
      else if (Math.hypot(tx - b.x, tz - b.z) > 3) { this._walkTo(dt, tx, tz, 1.15); return; }
      else {
        b.speed = 0;
        b.taskT += dt;
        if (b.taskT > g.rules.science.scan_time_s + 1) {
          b.tasksDone[o.id] = true; b.taskObj = null; b.taskT = 0;
          b.bonus += BUDDY.bonusTask; s.science += BUDDY.bonusTask;
          this.emit("task", { obj: o, reading: this._reading(b.x, b.z) });
        }
        return;
      }
    }

    // ---- seguir al jugador ----
    if (s.driving) {
      // va en el rover contigo
      b.x = s.x; b.z = s.z; b.speed = 0; b.riding = true; return;
    }
    if (b.riding) { b.riding = false; b.x = s.x + 2.5; b.z = s.z + 2.5; }
    if (dP > BUDDY.warpDist) { b.x = s.x - 3; b.z = s.z + 3; b.route = null; }  // te alcanza (no se pierde)
    if (dP < BUDDY.followDist) { b.speed = Math.max(0, b.speed - 8 * dt); return; }
    const k = dP > BUDDY.catchupDist ? 1.25 : clamp((dP - BUDDY.followDist) / 6, 0.3, 1.1);
    this._walkTo(dt, s.x, s.z, k);
  }

  // Coloca a EVA-2 a `r` metros detras del jugador (o a un lado si alli no se puede estar)
  _placeNear(s, r) {
    const b = this.st, W = this.world;
    const back = s.heading + Math.PI;
    for (const da of [0, 0.8, -0.8, 1.6, -1.6, Math.PI]) {
      const a = back + da, x = s.x - Math.sin(a) * r, z = s.z - Math.cos(a) * r;
      if (!W.blockedAt(x, z)) { b.x = x; b.z = z; return; }
    }
    b.x = s.x - 3; b.z = s.z + 3;
  }

  // Camina hacia (tx, tz); si el camino recto esta bloqueado usa A*
  _walkTo(dt, tx, tz, k) {
    const b = this.st, W = this.world, g = this.game;
    const v = g.rules.movement.walk_speed_mps * k * (b.limp ? BUDDY.limpK : 1);
    let gx = tx, gz = tz;
    const now = this._now;
    const blockedLine = () => { for (let f = 0.1; f <= 1; f += 0.1) if (W.blockedAt(b.x + (tx - b.x) * f, b.z + (tz - b.z) * f)) return true; return false; };
    if (b.route && b.route.length && now - b.routeAt < 3000) {
      const [rx, rz] = b.route[0];
      if (Math.hypot(rx - b.x, rz - b.z) < 4) b.route.shift();
      if (b.route.length) [gx, gz] = b.route[0];
    } else if (blockedLine()) {
      b.route = this.path.find(b.x, b.z, tx, tz);
      b.routeAt = now;
      if (b.route && b.route.length) [gx, gz] = b.route[0];
    } else b.route = null;
    const dx = gx - b.x, dz = gz - b.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { b.speed = 0; return; }
    const step = Math.min(d, v * dt);
    let nx = b.x + (dx / d) * step, nz = b.z + (dz / d) * step;
    // muros y edificios: el mismo sistema de colisiones que el jugador (se desliza por las paredes)
    const C = g.colliders;
    if (C) {
      const p = this._p || (this._p = { x: 0, z: 0 });
      const feet = this.groundAt(b.x, b.z);
      const tryDir = (ang) => {
        const c = Math.cos(ang), sn = Math.sin(ang);
        const ux = (dx * c + dz * sn) / d, uz = (-dx * sn + dz * c) / d;
        p.x = b.x + ux * step; p.z = b.z + uz * step;
        C.resolve(p, 0.45, feet, 0.45);
        return Math.hypot(p.x - b.x, p.z - b.z);
      };
      let m = tryDir(0);
      // pared de frente (p. ej. la cupula entre EVA-2 y el jugador): rodea el obstaculo por un lado,
      // y mantiene ese lado unos segundos para no oscilar
      if (p.hit && m < step * 0.5) {
        if (!b.wallSide || now - b.wallAt > 4000) { b.wallSide = g.rng.next() < 0.5 ? 1 : -1; }
        b.wallAt = now;
        for (const a of [0.7, 1.2, 1.6]) { m = tryDir(a * b.wallSide); if (m > step * 0.5) break; }
      }
      nx = p.x; nz = p.z;
    }
    const moved = Math.hypot(nx - b.x, nz - b.z);
    if (!W.blockedAt(nx, nz) && moved > step * 0.15) { b.x = nx; b.z = nz; b.speed = moved / dt; b.stuckT = Math.max(0, b.stuckT - dt); }
    else { b.speed = 0; b.stuckT += dt; }
    if (b.stuckT > 1.5) {
      b.route = this.path.find(b.x, b.z, tx, tz); b.routeAt = now; b.stuckT = 0;
      b.stuckN = (b.stuckN || 0) + 1;
      // atascado varias veces seguidas (p. ej. dentro de un edificio): reaparece junto al objetivo
      if (b.stuckN > 3 && Math.hypot(tx - b.x, tz - b.z) > 6) {
        const a = Math.atan2(b.x - tx, b.z - tz);
        for (let i = 0; i < 8; i++) {
          const q = { x: tx + Math.sin(a + i * 0.8) * 2.5, z: tz + Math.cos(a + i * 0.8) * 2.5 };
          const r0x = q.x, r0z = q.z;
          if (C) C.resolve(q, 0.45, this.groundAt(q.x, q.z), 0.45);
          if (!W.blockedAt(q.x, q.z) && Math.hypot(q.x - r0x, q.z - r0z) < 0.05) { b.x = q.x; b.z = q.z; break; }
        }
        b.stuckN = 0;
      }
    } else if (b.speed > 0.2 && b.stuckT === 0) b.stuckN = 0;
    b.heading = Math.atan2(-dx, -dz);
  }

  // Medicion de EVA-2 con las capas reales del punto
  _reading(x, z) {
    const W = this.world, g = this.game;
    return {
      temp: g.tempAt(x, z, g.hour), dose: W.radiation(x, z), slope: W.slope(x, z),
      mineral: this.game.data.layers.layers.spectral.classes[W.spectral(x, z)],
    };
  }

  statusText() {
    const b = this.st;
    return {
      follow: b.taskObj ? L("Midiendo junto al objetivo", "Measuring at the target") : b.limp ? L("Herido: cojea hasta un refugio", "Injured: limping to a shelter") : L("Te sigue", "Following"),
      stuck: L("¡Atrapado! Ve y mantén F", "Stuck! Go and hold F"),
      reserve: L("Reserva de emergencia: ve y mantén F", "Emergency reserve: go and hold F"),
    }[b.mode] || L("Te sigue", "Following");
  }
}
