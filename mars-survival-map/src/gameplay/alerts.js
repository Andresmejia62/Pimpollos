// Alertas de public/story/alerts.json. Cada id tiene su condicion en codigo (no se evalua texto).
// Se disparan en el flanco de subida de la condicion y respetan cooldown_s.
export class AlertSystem {
  constructor(def, game) {
    this.def = def;
    this.game = game;
    this.byId = Object.fromEntries(def.alerts.map((a) => [a.id, a]));
    this.prev = {};
    this.last = {};
    this.flags = {};
    this.listeners = [];
    this.clearListeners = [];
    game.on("scanStart", () => { this.flags.scan_started = true; });
    game.on("scanLost", () => { this.flags.scan_interrupted = true; });
    game.on("scanComplete", () => { this.flags.scan_complete = true; });
    game.on("shelter", () => { this.flags.entered_shelter = true; });
    game.on("spe", (sp) => { if (sp.phase === "ended") this.flags.spe_ended = true; });
  }

  onAlert(fn) { this.listeners.push(fn); }
  onClear(fn) { this.clearListeners.push(fn); }

  check(time) {
    const g = this.game, s = g.s, env = g.env || { slope: 0, temp: 0, dose: 0 };
    const spe = s.spe;
    const target = g.target;
    const dTarget = target ? g.distTo(target) : Infinity;
    const edge = g.world.half - Math.max(Math.abs(s.x), Math.abs(s.z));
    const H = g.rules.hazards;
    const C = {
      a_o2_low: s.oxygen < 40,
      a_o2_critical: s.oxygen < 15,
      a_energy_low: s.energy < 30,
      a_energy_zero: s.energy <= 0,
      a_integrity_low: s.integrity < 50,
      a_integrity_critical: s.integrity < 20,
      a_slope_slow: env.slope > H.slope.slow_above_deg && s.moving,
      a_slope_slip: env.slope > g.rules.resources.integrity.slip.from_deg && s.moving,
      a_slope_blocked: s.blockedAhead,
      a_rad_exposed: env.dose > H.radiation.danger_above_ugy_h && !(spe && spe.phase === "active"),
      a_cold: env.temp < H.temperature.danger_below_c,
      a_spe_warning: spe && spe.phase === "warning",
      a_spe_active: spe && spe.phase === "active" && !s.inShelter,
      a_spe_sheltered: spe && spe.phase === "active" && !!s.inShelter,
      a_spe_end: !!this.flags.spe_ended,
      a_shelter_enter: !!this.flags.entered_shelter,
      a_target_near: dTarget < 60 && !s.scanned && s.scanProgress === 0,
      a_scan_start: !!this.flags.scan_started,
      a_scan_lost: !!this.flags.scan_interrupted,
      a_scan_done: !!this.flags.scan_complete,
      a_out_of_bounds: edge < 40,
    };
    const fired = [];
    for (const [id, on] of Object.entries(C)) {
      const a = this.byId[id];
      if (!a) continue;
      const rising = on && !this.prev[id];
      if (!on && this.prev[id]) this.clearListeners.forEach((fn) => fn(a));
      this.prev[id] = !!on;
      if (!rising) continue;
      if (this.last[id] != null && time - this.last[id] < (a.cooldown_s || 0)) continue;
      this.last[id] = time;
      fired.push(a);
    }
    this.flags = {};
    // las de mayor severidad primero
    const rank = { danger: 0, caution: 1, info: 2 };
    fired.sort((a, b) => rank[a.severity] - rank[b.severity]).forEach((a) => this.listeners.forEach((fn) => fn(a)));
  }
}
