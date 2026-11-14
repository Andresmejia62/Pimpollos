// Estado y reglas del juego. Implementa public/layers/rules.json (M3) tal cual
// y la campana de public/story/missions.json (M4).
export class Game {
  constructor(data, world, groundAt) {
    this.data = data;
    this.world = world;
    this.groundAt = groundAt;
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
  update(dt, move) {
    const s = this.s;
    if (s.phase !== "playing") return;
    const R = this.rules.resources, H = this.rules.hazards, W = this.world;
    s.realSeconds += dt;
    s.gameSeconds += dt * this.rules.time.time_scale;

    // Movimiento
    const slopeHere = W.slope(s.x, s.z);
    let speed = 0;
    s.blockedAhead = false;
    if (move) {
      const slopeK = Math.min(1, Math.max(0.5, 1 - (slopeHere - H.slope.slow_above_deg) / 26));
      speed = this.rules.movement.walk_speed_mps * slopeK * (s.energy <= 0 ? 0.4 : 1);
      const nx = s.x + move[0] * speed * dt, nz = s.z + move[1] * speed * dt;
      const look = 1.5; // mirar un poco adelante para detectar el escalon
      const okBoth = !W.blockedAt(nx + move[0] * look, nz + move[1] * look);
      if (okBoth) { s.x = nx; s.z = nz; }
      else if (move[0] && !W.blockedAt(nx + Math.sign(move[0]) * look, s.z)) { s.x = nx; speed *= Math.abs(move[0]); s.blockedAhead = true; }
      else if (move[1] && !W.blockedAt(s.x, nz + Math.sign(move[1]) * look)) { s.z = nz; speed *= Math.abs(move[1]); s.blockedAhead = true; }
      else { speed = 0; s.blockedAhead = true; }
      if (speed > 0) s.heading = Math.atan2(-move[0], -move[1]);
      s.movedTotal += speed * dt;
    }
    s.speed = speed;
    s.moving = speed > 0.1;

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
    let o2 = R.oxygen.base_drain_per_s * (s.moving ? 1 + slope / 25 : 1);
    if (s.energy <= 0) o2 *= 1.5;
    s.oxygen -= o2 * dt;
    s.energy -= R.energy.base_drain_per_s * (1 + R.energy.cold.extra_per_deg * Math.max(0, R.energy.cold.comfort_c - temp)) * dt;
    const E = this.rules.events.solar_particle_event;
    const speMult = s.spe && s.spe.phase === "active" ? E.dose_multiplier : 1;
    const shelterK = s.inShelter ? E.shelter_factor : 1;
    s.integrity -= R.integrity.radiation.k_per_ugy_h * dose * speMult * shelterK * dt;
    if (s.moving && slope > R.integrity.slip.from_deg && slope <= R.integrity.slip.to_deg) s.integrity -= R.integrity.slip.drain_per_s * dt;
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
