// Estado y reglas del juego. Implementa public/layers/rules.json (M3) tal cual
// y la campana de public/story/missions.json (M4).
import { MARS, PHYS, boxCollider } from "../engine/physics.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Land Rover: transporte rapido sin presurizar (no es refugio). Conducir no cansa ni desgasta el traje.
const DRIVE = { speed_k: 2.4, board_radius_m: 6, look_m: 3 };

export class Game {
  constructor(data, world, groundAt, colliders = null, dynamics = null) {
    this.data = data;
    this.world = world;
    this.groundAt = groundAt;
    this.colliders = colliders;
    this.dynamics = dynamics;
    this._p = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
    this._v = { vx: 0, vz: 0 };
    // el mundo esta comprimido: la traccion se escala igual que la velocidad de marcha (ver PHYS.realWalkSpeed)
    this.gripScale = this.rules.movement.walk_speed_mps / PHYS.realWalkSpeed;
    this.rules = data.rules;
    this.objectives = Object.fromEntries(data.objectives.objectives.map((o) => [o.id, o]));
    this.missions = [...data.missions.missions].sort((a, b) => a.order - b.order);
    this.dialogs = Object.fromEntries(data.dialogs.dialogs.map((d) => [d.id, d]));
    this.facts = Object.fromEntries(data.facts.facts.map((f) => [f.id, f]));
    this.listeners = {};
    this.reset();
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  emit(evt, payload) { (this.listeners[evt] || []).forEach((fn) => fn(payload)); }

  reset() {
    const R = this.rules.resources;
    const start = this.objectives[this.data.missions.campaign.start_at];
    this.s = {
      x: start.world.x + 18, z: start.world.z + 14, heading: Math.PI,
      oxygen: R.oxygen.start, energy: R.energy.start, integrity: R.integrity.start,
      gameSeconds: 0, realSeconds: 0,
      missionIndex: 0, phase: "title",
      scanProgress: 0, scanned: false, moving: false, speed: 0, movedTotal: 0,
      blockedAhead: false, inShelter: null,
      spe: null, stormBonus: false,
      science: 0, layer: null, routeOn: false,
      tutorialStep: 0, tutorialTimer: 0, routeToggledInStep: false,
      failCause: null,
      // fisica: altura de los pies, velocidad y contacto con el suelo (y = null -> se apoya al empezar)
      y: null, vx: 0, vy: 0, vz: 0, grounded: true, air: 0,
      driving: false,
      car: { x: start.world.x + 13, z: start.world.z + 24, heading: 2.3 },
    };
    this.checkpoint = null;
  }

  get mission() { return this.missions[this.s.missionIndex]; }
  get target() {
    const s = this.s;
    if (s.spe && s.spe.phase !== "ended") return this.nearestShelter();
    return this.objectives[this.mission.objective_id];
  }
  get hour() { return this.rules.time.start_local_time_h + this.s.gameSeconds / 3600; }

  nearestShelter(from = { x: this.s.x, z: this.s.z }) {
    let best = null, bd = Infinity;
    for (const o of Object.values(this.objectives)) {
      if (!o.shelter) continue;
      const d = Math.hypot(o.world.x - from.x, o.world.z - from.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  distTo(o) { return Math.hypot(o.world.x - this.s.x, o.world.z - this.s.z); }
  radiusOf(o) { return Math.max(o.radius_m || 15, this.rules.science.scan_radius_m); }

  // ---- Land Rover -------------------------------------------------------------------
  get nearVehicle() { const s = this.s; return !s.driving && Math.hypot(s.car.x - s.x, s.car.z - s.z) < DRIVE.board_radius_m; }

  // Sube si esta cerca; si ya conduce, baja por un costado que no este bloqueado
  toggleVehicle() {
    const s = this.s;
    if (s.phase !== "playing") return false;
    if (s.driving) {
      s.driving = false;
      s.car = { x: s.x, z: s.z, heading: s.heading };
      const rx = Math.cos(s.heading), rz = -Math.sin(s.heading);   // derecha del vehiculo
      for (const k of [-2.3, 2.3, -3.2, 3.2]) {
        const nx = s.x + rx * k, nz = s.z + rz * k;
        if (!this.world.blockedAt(nx, nz)) { s.x = nx; s.z = nz; break; }
      }
      s.y = null;
    } else if (this.nearVehicle) {
      s.driving = true;
      s.x = s.car.x; s.z = s.car.z; s.heading = s.car.heading;
      s.scanProgress = 0;
      s.y = null;
    } else return false;
    s.vx = s.vy = s.vz = 0;
    this.emit("vehicle", s.driving);
    return true;
  }

  // ---- flujo de misiones ---------------------------------------------------------
  startMission(i) {
    const s = this.s;
    s.missionIndex = i;
    s.scanProgress = 0;
    s.scanned = false;
    s.spe = null;
    s.tutorialStep = 0;
    s.tutorialTimer = 0;
    s.phase = "briefing";
    this.checkpoint = JSON.parse(JSON.stringify(s));
    this.emit("mission", this.mission);
  }

  beginMission() {
    this.s.phase = "playing";
    const m = this.mission;
    if (this.s.missionIndex === 0 && !this._introDone) {
      this._introDone = true;
      this.data.missions.campaign.intro_dialogs.forEach((id) => this.emit("dialog", this.dialogs[id]));
    }
    (m.dialogs_start || []).forEach((id) => this.emit("dialog", this.dialogs[id]));
    if (m.layer_hint && m.layer_hint !== "route") this.emit("suggestLayer", m.layer_hint);
    if (m.layer_hint === "route") this.setRoute(true);
  }

  retry() {
    if (!this.checkpoint) return;
    this.s = JSON.parse(JSON.stringify(this.checkpoint));
    this.s.phase = "briefing";
    this.emit("mission", this.mission);
  }

  setLayer(k) { this.s.layer = this.s.layer === k ? null : k; this.emit("layer", this.s.layer); }
  setRoute(on) {
    this.s.routeOn = on ?? !this.s.routeOn;
    if (this.s.routeOn) this.s.routeToggledInStep = true;
    this.emit("route", this.s.routeOn);
  }

  continueAfterCard() {
    const s = this.s;
    s.phase = "playing";
    const m = this.mission;
    const ev = (m.events || []).find((e) => e.on === "scan_complete" && e.event === "solar_particle_event");
    if (ev && !s.spe) {
      this.triggerStorm();
      return;
    }
    this._completeMission();
  }

  triggerStorm() {
    const E = this.rules.events.solar_particle_event;
    this.s.spe = { phase: "warning", t: E.warning_s, sheltered: 0, active: 0 };
    this.emit("spe", this.s.spe);
  }

  _completeMission() {
    const s = this.s, m = this.mission;
    s.science += m.points || 0;
    (m.dialogs_complete || []).forEach((id) => this.emit("dialog", this.dialogs[id]));
    const nextIdx = this.missions.findIndex((x) => x.id === m.next);
    if (!m.next || nextIdx < 0) {
      this._finish();
      return;
    }
    this.emit("missionComplete", m);
    this.startMission(nextIdx);
  }

  _finish() {
    const s = this.s;
    s.phase = "success";
    const minutes = s.realSeconds / 60;
    const score = {
      science: s.science,
      safety: Math.round((100 * (s.oxygen + s.energy + s.integrity)) / 300),
      time: Math.max(0, Math.round(10 * (30 - minutes))),
      storm: s.stormBonus ? this.rules.scoring.storm_bonus : 0,
      minutes,
    };
    score.total = score.science + score.safety + score.time + score.storm;
    this.data.missions.campaign.outro_dialogs.forEach((id) => this.emit("dialog", this.dialogs[id]));
    this.emit("end", { success: true, score });
  }

  _fail(cause) {
    this.s.phase = "fail";
    this.s.failCause = cause;
    this.emit("end", { success: false, cause });
  }

  // ---- bucle principal ------------------------------------------------------------
  update(dt, move, jump = false) {
    const s = this.s;
    if (s.phase !== "playing") return;
    const R = this.rules.resources, H = this.rules.hazards, W = this.world;
    s.realSeconds += dt;
    s.gameSeconds += dt * this.rules.time.time_scale;

    // Movimiento: en pasos cortos para que las colisiones no se salten obstaculos a pocos FPS
    s.blockedAhead = false;
    const steps = Math.min(4, Math.ceil(dt / 0.034));
    for (let i = 0; i < steps; i++) this._move(dt / steps, move, jump);
    if (this.dynamics) this.dynamics.step(dt, s.x, s.z);
    if (s.driving) { s.car.x = s.x; s.car.z = s.z; s.car.heading = s.heading; }

    // Ambiente en la posicion actual
    const slope = W.slope(s.x, s.z);
    const temp = W.temperature(s.x, s.z, this.hour);
    const dose = W.radiation(s.x, s.z);
    this.env = { slope, temp, dose };

    // Refugios
    const prevShelter = s.inShelter;
    s.inShelter = null;
    for (const o of Object.values(this.objectives)) {
      if (o.shelter && this.distTo(o) < this.radiusOf(o) + 6) { s.inShelter = o.id; break; }
    }
    if (s.inShelter && s.inShelter !== prevShelter) this.emit("shelter", this.objectives[s.inShelter]);

    // Recursos (rules.json -> resources)
    const onFoot = s.moving && !s.driving;
    let o2 = R.oxygen.base_drain_per_s * (onFoot ? 1 + slope / 25 : 1);
    if (s.energy <= 0) o2 *= 1.5;
    s.oxygen -= o2 * dt;
    s.energy -= R.energy.base_drain_per_s * (1 + R.energy.cold.extra_per_deg * Math.max(0, R.energy.cold.comfort_c - temp)) * dt;
    const E = this.rules.events.solar_particle_event;
    const speMult = s.spe && s.spe.phase === "active" ? E.dose_multiplier : 1;
    const shelterK = s.inShelter ? E.shelter_factor : 1;
    s.integrity -= R.integrity.radiation.k_per_ugy_h * dose * speMult * shelterK * dt;
    if (onFoot && slope > R.integrity.slip.from_deg && slope <= R.integrity.slip.to_deg) s.integrity -= R.integrity.slip.drain_per_s * dt;
    if (s.inShelter) {
      const cap = s.inShelter === "rover" ? R.shelter_refill.rover_cap : 100;
      if (s.oxygen < cap) s.oxygen = Math.min(cap, s.oxygen + R.shelter_refill.oxygen_per_s * dt);
      if (s.energy < cap) s.energy = Math.min(cap, s.energy + R.shelter_refill.energy_per_s * dt);
    }
    s.energy = Math.max(0, s.energy);
    s.oxygen = Math.min(100, s.oxygen);

    // Tormenta solar
    if (s.spe && s.spe.phase !== "ended") {
      const sp = s.spe;
      sp.t -= dt;
      if (sp.phase === "active") {
        sp.active += dt;
        if (s.inShelter) sp.sheltered += dt;
      }
      if (sp.t <= 0) {
        if (sp.phase === "warning") { sp.phase = "active"; sp.t = E.duration_s; }
        else {
          sp.phase = "ended";
          s.stormBonus = sp.sheltered >= 0.5 * E.duration_s;
          this.emit("spe", sp);
          if (s.integrity > 0 && s.oxygen > 0) this._completeMission();
          return;
        }
        this.emit("spe", sp);
      }
    }

    if (s.oxygen <= 0) { s.oxygen = 0; this._fail("fail_oxygen"); return; }
    if (s.integrity <= 0) { s.integrity = 0; this._fail("fail_integrity"); return; }

    // Objetivo de la mision
    const m = this.mission;
    const obj = this.objectives[m.objective_id];
    const d = this.distTo(obj);
    if (!s.scanned && !(s.spe && s.spe.phase !== "ended")) {
      if (m.action === "reach") {
        if (d < this.radiusOf(obj)) { s.scanned = true; this._completeMission(); return; }
      } else if (d < this.radiusOf(obj)) {
        if (s.scanProgress === 0) this.emit("scanStart");
        s.scanProgress += dt;
        if (s.scanProgress >= this.rules.science.scan_time_s) {
          s.scanned = true;
          s.energy = Math.max(0, s.energy - R.energy.scanner_cost);
          s.phase = "card";
          this.emit("scanComplete", { mission: m, objective: obj, fact: this.facts[m.fact_id] });
        }
      } else if (s.scanProgress > 0) {
        s.scanProgress = 0;
        this.emit("scanLost");
      }
    }

    this._tutorial(dt);
  }

  // ---- fisica del movimiento ---------------------------------------------------------
  // Suelo bajo (x, z): el terreno o, a pie, la cima de una roca que se pueda pisar
  _ground(x, z) {
    const base = this.groundAt(x, z), s = this.s;
    if (!this.colliders || s.y == null) return base;
    // el Land Rover sube a plataformas bajas, pero no se apoya en las rocas: las pasa con su altura libre
    return s.driving ? this.colliders.groundOn(x, z, s.y, PHYS.carClear, base, false) : this.colliders.groundOn(x, z, s.y, PHYS.step, base);
  }

  _move(dt, move, jump) {
    const s = this.s, W = this.world, H = this.rules.hazards, C = this.colliders;
    const drv = s.driving;
    if (s.y == null || Math.abs(s.y - this.groundAt(s.x, s.z)) > 60) { s.y = this._ground(s.x, s.z); s.vy = 0; s.grounded = true; }
    const slopeHere = W.slope(s.x, s.z);
    const slopeK = clamp(1 - (slopeHere - H.slope.slow_above_deg) / 26, 0.5, 1);
    const top = this.rules.movement.walk_speed_mps * slopeK * (drv ? DRIVE.speed_k : s.energy <= 0 ? 0.4 : 1);

    // velocidad deseada: a pie va hacia donde se pulsa; el Land Rover gira poco a poco y avanza de frente
    let tx = 0, tz = 0;
    if (move) {
      if (drv) {
        const dh = wrapAngle(Math.atan2(-move[0], -move[1]) - s.heading);
        if (s.grounded) s.heading += clamp(dh, -PHYS.carTurn * dt, PHYS.carTurn * dt);
        const v = top * Math.max(0.3, Math.cos(dh));
        tx = -Math.sin(s.heading) * v; tz = -Math.cos(s.heading) * v;
      } else {
        tx = move[0] * top; tz = move[1] * top;
        s.heading = Math.atan2(-move[0], -move[1]);
      }
    }
    // Traccion: la fuerza que da el suelo es mu * peso * cos(pendiente). Con el 38 % de peso hay menos agarre,
    // pero la masa es la misma: por eso en Marte cuesta mas arrancar, frenar y girar que en la Tierra.
    const e = 1.5;
    const hx = (this.groundAt(s.x + e, s.z) - this.groundAt(s.x - e, s.z)) / (2 * e), hz = (this.groundAt(s.x, s.z + e) - this.groundAt(s.x, s.z - e)) / (2 * e);
    const k2 = 1 + hx * hx + hz * hz;
    const grip = (drv ? PHYS.carMu : PHYS.bootMu) * MARS.g * this.gripScale / Math.sqrt(k2);
    let acc = PHYS.airAccel;
    if (s.grounded) {
      // la gravedad tira cuesta abajo: subir acelera menos y bajar alarga la frenada
      s.vx -= (MARS.g * hx / k2) * dt; s.vz -= (MARS.g * hz / k2) * dt;
      acc = drv && move ? Math.min(grip, PHYS.carEngine) : grip;
    }
    const dvx = tx - s.vx, dvz = tz - s.vz, dv = Math.hypot(dvx, dvz);
    if (dv > acc * dt) { s.vx += (dvx / dv) * acc * dt; s.vz += (dvz / dv) * acc * dt; }
    else { s.vx = tx; s.vz = tz; }

    // en laderas resbaladizas la gravedad arrastra cuesta abajo
    let mvx = s.vx, mvz = s.vz;
    const slip = this.rules.resources.integrity.slip;
    if (s.grounded && !drv && slopeHere > slip.from_deg) {
      const gx = -hx, gz = -hz;
      const gl = Math.hypot(gx, gz);
      if (gl > 1e-4) {
        const v = MARS.g * Math.sin((slopeHere * Math.PI) / 180) * PHYS.slideK;
        mvx += (gx / gl) * v; mvz += (gz / gl) * v;
      }
    }

    // desplazamiento horizontal: pendientes bloqueadas (reglas de M3) y obstaculos
    const x0 = s.x, z0 = s.z, g0 = this.groundAt(x0, z0);
    let nx = x0 + mvx * dt, nz = z0 + mvz * dt;
    const sp = Math.hypot(mvx, mvz);
    if (sp > 1e-3) {
      const look = drv ? DRIVE.look_m : 1.5; // mirar un poco adelante para detectar el escalon
      const dx = mvx / sp, dz = mvz / sp;
      let blocked = false;
      if (W.blockedAt(nx + dx * look, nz + dz * look)) {
        blocked = true;
        if (mvx && !W.blockedAt(nx + Math.sign(mvx) * look, z0)) { nz = z0; s.vz = 0; }
        else if (mvz && !W.blockedAt(x0, nz + Math.sign(mvz) * look)) { nx = x0; s.vx = 0; }
        else { nx = x0; nz = z0; s.vx = s.vz = 0; }
      }
      if (blocked && move) s.blockedAhead = true;
    }
    if (C) {
      const p = this._p;
      let hit = false;
      if (drv) {
        // dos circulos, sobre cada eje del vehiculo
        const fx = -Math.sin(s.heading) * PHYS.carAxle, fz = -Math.cos(s.heading) * PHYS.carAxle;
        for (const k of [1, -1]) {
          p.x = nx + fx * k; p.z = nz + fz * k;
          if (C.resolve(p, PHYS.carRadius, s.y, PHYS.carClear).hit) { nx = p.x - fx * k; nz = p.z - fz * k; hit = true; }
        }
      } else {
        p.x = nx; p.z = nz;
        const parked = boxCollider(s.car.x, s.car.z, 0.95, 2.35, s.car.heading);
        hit = C.resolve(p, PHYS.radius, s.y, PHYS.step, parked).hit;
        nx = p.x; nz = p.z;
      }
      // cuerpos sueltos (cajas, bidones, rocas): se empujan y devuelven el empujon segun su masa
      const D = this.dynamics;
      if (D) {
        const v = this._v;
        v.vx = s.vx; v.vz = s.vz;
        if (drv) {
          const fx = -Math.sin(s.heading) * PHYS.carAxle, fz = -Math.cos(s.heading) * PHYS.carAxle;
          for (const k of [1, -1]) {
            p.x = nx + fx * k; p.z = nz + fz * k;
            if (D.pushBy(p, PHYS.carRadius, v, PHYS.carMass, s.y, PHYS.carClear)) { nx = p.x - fx * k; nz = p.z - fz * k; hit = true; }
          }
        } else {
          p.x = nx; p.z = nz;
          if (D.pushBy(p, PHYS.radius, v, PHYS.mass, s.y, PHYS.step)) { nx = p.x; nz = p.z; hit = true; }
        }
        s.vx = v.vx; s.vz = v.vz;
      }
      if (hit) {
        // el choque anula la velocidad contra el obstaculo; se sigue deslizando a lo largo de el
        const vn = s.vx * p.nx + s.vz * p.nz;
        if (vn < 0) {
          const bounce = drv ? PHYS.carBounce : 0;
          s.vx -= (1 + bounce) * vn * p.nx; s.vz -= (1 + bounce) * vn * p.nz;
          // el Land Rover tiene 1800 kg de inercia: un choque frontal rapido se nota en el traje
          if (drv && -vn > PHYS.carCrashSafe) {
            const damage = (-vn - PHYS.carCrashSafe) * PHYS.carCrashDamage;
            s.integrity -= damage;
            this.emit("crash", { impact: -vn, damage });
          }
        }
        if (W.blockedAt(nx, nz)) { nx = x0; nz = z0; }
      }
    }
    // en el aire no se atraviesa una ladera mas alta que un escalon
    if (!s.grounded && this._ground(nx, nz) > s.y + PHYS.step * 1.5) { nx = x0; nz = z0; s.vx = s.vz = 0; }
    s.x = nx; s.z = nz;
    const moved = Math.hypot(nx - x0, nz - z0);
    s.speed = moved / dt;
    s.moving = s.speed > 0.1;
    s.movedTotal += moved;

    // vertical: gravedad de Marte. En el suelo el cuerpo sigue la pendiente; despega si salta,
    // si el suelo cae mas rapido de lo que la gravedad permite seguirlo (cresta) o si pisa un borde.
    const gNew = this._ground(nx, nz);
    const vG = clamp((this.groundAt(nx, nz) - g0) / dt, -s.speed * 1.2 - 0.5, s.speed * 1.2 + 0.5);
    if (s.grounded) {
      if (jump && !drv) {
        s.vy = Math.max(0, vG) * 0.5 + PHYS.jumpV;
        s.grounded = false;
        this.emit("jump");
      } else if (s.y - gNew > PHYS.step || vG < s.vy - MARS.g * dt - (drv ? PHYS.carCrestTol : PHYS.crestTol)) {
        s.grounded = false;
      } else {
        s.y = gNew;
        s.vy = vG;
      }
    }
    if (!s.grounded) {
      s.vy -= MARS.g * dt;
      s.y += s.vy * dt;
      if (s.y <= gNew) {
        const impact = Math.max(0, vG - s.vy);
        s.y = gNew;
        s.vy = vG;
        s.grounded = true;
        const safe = drv ? PHYS.carSafeImpact : PHYS.safeImpact;
        const damage = Math.max(0, impact - safe) * (drv ? PHYS.carImpactDamage : PHYS.impactDamage);
        if (damage > 0) s.integrity -= damage;
        if (impact > 1.2) this.emit("land", { impact, damage, driving: drv });
      }
    }
    s.air = s.grounded ? 0 : Math.max(0, s.y - gNew);
  }

  // Tutorial de la mision 1 (missions.json -> tutorial)
  _tutorial(dt) {
    const s = this.s, steps = this.mission.tutorial;
    if (!steps || s.tutorialStep >= steps.length) return;
    s.tutorialTimer += dt;
    const step = steps[s.tutorialStep];
    const done = {
      t_move: () => s.movedTotal >= 10,
      t_hud: () => s.tutorialTimer >= 6,
      t_layers: () => s.layer === "slope",
      t_route: () => s.routeToggledInStep && s.routeOn,
      t_scan: () => s.scanned,
    }[step.id];
    if (done && done()) {
      s.tutorialStep += 1;
      s.tutorialTimer = 0;
      s.routeToggledInStep = false;
    }
  }

  tutorialText() {
    const steps = this.mission.tutorial;
    if (!steps || this.s.tutorialStep >= steps.length) return null;
    return steps[this.s.tutorialStep].text;
  }
}
