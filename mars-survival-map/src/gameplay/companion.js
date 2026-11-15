// EVA-2: compañero controlado por el juego. La regla de seguridad de las EVA reales es no salir nunca solo
// ("buddy system"). EVA-2:
//  - te sigue a unos metros, por terreno transitable (A* si se queda atras o hay un obstaculo);
//  - hace una segunda tarea en cada objetivo: mide con sus instrumentos el punto (datos reales de las capas);
//  - en la mision del canal de Gediz Vallis resbala y queda atrapado: tienes que llegar y mantener F para
//    ayudarlo (le pasas parte de tu O2 por la manguera de emergencia, como el "buddy breathing" de los trajes EMU).
// Su O2 se gasta con el modelo metabolico del astronauta de referencia y se recarga en los refugios.
import { REF } from "../engine/physiology.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const L = (es, en) => ({ es, en });

export const BUDDY = {
  followDist: 5, catchupDist: 40, warpDist: 160,
  rescueMission: "obj_azufre", triggerDist: 520, assistS: 3, shareO2: 8,
  leakPerS: 0.35, abortBelow: 12, bonusTask: 15, bonusRescue: 60,
};

export class Companion {
  constructor(game, world, path, groundAt) {
    Object.assign(this, { game, world, path, groundAt });
    this.listeners = {};
    this.reset();
  }
  on(e, fn) { (this.listeners[e] ||= []).push(fn); }
  emit(e, p) { (this.listeners[e] || []).forEach((fn) => fn(p)); }

  reset() {
    const s = this.game.s;
    this.st = {
      x: s.x - 3, z: s.z + 3, heading: s.heading, speed: 0, o2: 100,
      mode: "follow", route: null, routeAt: 0, stuckT: 0, assist: 0,
      tasksDone: {}, taskT: 0, rescueDone: false, bonus: 0,
    };
  }
  // al reintentar una mision el compañero vuelve con el jugador
  snapTo(s) {
    const b = this.st;
    if (b.mode === "stuck") { b.mode = "follow"; b.assist = 0; b.o2 = Math.max(b.o2, 60); }
    if (!b.taskObj) { b.x = s.x - 3; b.z = s.z + 3; }
    b.route = null;
  }

  update(dt, assistHeld) {
    const g = this.game, s = g.s, b = this.st, W = this.world, R = g.rules;
    const ts = R.time.time_scale;
    const dP = Math.hypot(s.x - b.x, s.z - b.z);
    const m = g.mission, obj = g.objectives[m.objective_id];

    // ---- rescate guionizado en el canal de Gediz Vallis ----
    if (b.mode === "follow" && !b.rescueDone && m.objective_id === BUDDY.rescueMission && !(s.spe && s.spe.phase !== "ended")) {
      if (g.distTo(obj) < BUDDY.triggerDist && dP < 30) {
        b.mode = "stuck"; b.speed = 0;
        this.emit("stuck", { x: b.x, z: b.z });
      }
    }
    if (b.mode === "stuck") {
      b.o2 -= BUDDY.leakPerS * dt;                         // fuga en la junta de la rodilla
      if (dP < 4.5 && assistHeld) {
        b.assist += dt;
        if (b.assist >= BUDDY.assistS) {
          b.mode = "follow"; b.rescueDone = true; b.assist = 0;
          s.oxygen -= BUDDY.shareO2; b.o2 = Math.min(100, b.o2 + BUDDY.shareO2 * 1.5);
          b.bonus += BUDDY.bonusRescue; s.science += BUDDY.bonusRescue;
          this.emit("rescued", { bonus: BUDDY.bonusRescue });
        }
      } else b.assist = Math.max(0, b.assist - dt * 2);
      if (b.o2 <= BUDDY.abortBelow) {
        b.mode = "abort"; b.rescueDone = true;
        this.emit("aborted", {});
      }
      return;
    }

    // ---- O2 de EVA-2 (metabolismo del astronauta de referencia) ----
    const vReal = b.speed * g.realPerWorld;
    const M = REF.metabolic(vReal, 0, 1.2);
    b.o2 -= (100 * ((REF.o2gPerH(M) * dt * ts) / 3600)) / g.o2CapacityG;
    if (s.inShelter && dP < 30) b.o2 = Math.min(100, b.o2 + R.resources.shelter_refill.oxygen_per_s * dt);
    b.o2 = clamp(b.o2, 0, 100);

    // ---- abortado: vuelve solo al rover de apoyo y desaparece de la EVA ----
    if (b.mode === "abort") {
      const rv = g.objectives.rover.world;
      this._walkTo(dt, rv.x, rv.z, 1.0);
      if (Math.hypot(rv.x - b.x, rv.z - b.z) < 10) { b.mode = "follow"; b.x = s.x - 3; b.z = s.z + 3; b.o2 = 100; this.emit("rejoined", {}); }
      return;
    }

    // ---- segunda tarea: medir junto al objetivo mientras tu escaneas (sigue aunque la mision avance) ----
    const storm = s.spe && s.spe.phase !== "ended";
    if (!b.taskObj && !storm && obj.type === "science" && !b.tasksDone[obj.id] && g.distTo(obj) < 70) b.taskObj = obj.id;
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

  // Camina hacia (tx, tz); si el camino recto esta bloqueado usa A*
  _walkTo(dt, tx, tz, k) {
    const b = this.st, W = this.world, g = this.game;
    const v = g.rules.movement.walk_speed_mps * k;
    let gx = tx, gz = tz;
    const now = performance.now();
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
    const nx = b.x + (dx / d) * step, nz = b.z + (dz / d) * step;
    if (!W.blockedAt(nx, nz)) { b.x = nx; b.z = nz; b.speed = step / dt; b.stuckT = 0; }
    else { b.speed = 0; b.stuckT += dt; if (b.stuckT > 1.5) { b.route = this.path.find(b.x, b.z, tx, tz); b.routeAt = now; b.stuckT = 0; } }
    b.heading = Math.atan2(-dx, -dz);
  }

  // Medicion de EVA-2 con las capas reales del punto
  _reading(x, z) {
    const W = this.world, g = this.game;
    return {
      temp: W.temperature(x, z, g.hour), dose: W.radiation(x, z), slope: W.slope(x, z),
      mineral: this.game.data.layers.layers.spectral.classes[W.spectral(x, z)],
    };
  }

  statusText() {
    const b = this.st;
    return {
      follow: b.taskObj ? L("Midiendo junto al objetivo", "Measuring at the target") : L("Te sigue", "Following"), stuck: L("¡Atrapado! Ve y mantén F", "Stuck! Go and hold F"),
      abort: L("Volviendo al rover", "Returning to the rover"),
    }[b.mode] || L("Te sigue", "Following");
  }
}
