// Estado y reglas del juego. Implementa public/layers/rules.json (M3) tal cual
// y la campana de public/story/missions.json (M4).
import { floorAt } from "../engine/interiors.js";
import { loadDiff } from "./difficulty.js";
import { MARS, PHYS, boxCollider } from "../engine/physics.js";
import { Physiology, REF, REF_FLAT_W, DEFAULT_PROFILE, BASE_KIT_KG, SAMPLE_KG } from "../engine/physiology.js";
import { Rng } from "./rng.js";
import { stepCore } from "./simcore.js";

const clone = (o) => JSON.parse(JSON.stringify(o));

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Rover marciano: transporte rapido sin presurizar (no es refugio). Conducir no cansa ni desgasta el traje.
const DRIVE = { speed_k: 2.4, board_radius_m: 6, look_m: 3 };

export class Game {
  constructor(data, world, groundAt, colliders = null, dynamics = null) {
    this.data = data;
    this.world = world;
    this.groundAt = groundAt;
    this.colliders = colliders;
    this.dynamics = dynamics;
    this.diff = loadDiff();
    this._p = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
    this._v = { vx: 0, vz: 0 };
    // el mundo esta comprimido: la traccion se escala igual que la velocidad de marcha (ver PHYS.realWalkSpeed)
    this.rules = data.rules;
    this.gripScale = this.rules.movement.walk_speed_mps / PHYS.realWalkSpeed;
    this.objectives = Object.fromEntries(data.objectives.objectives.map((o) => [o.id, o]));
    this.missions = [...data.missions.missions].sort((a, b) => a.order - b.order);
    this.dialogs = Object.fromEntries(data.dialogs.dialogs.map((d) => [d.id, d]));
    this.facts = Object.fromEntries(data.facts.facts.map((f) => [f.id, f]));
    this.listeners = {};
    this._ext = {};          // estado serializable de otros componentes (clima, EVA-2) para los puntos de control
    this.rng = new Rng();    // azar de la simulacion (tormentas, remolinos, eventos); se guarda en el checkpoint
    // modo libre: una "mision" sin guion cuyo objetivo lo define el usuario (setFreeTarget)
    this._free = { id: "free", order: 0, free: true, title: { es: "Modo libre · simulación", en: "Free mode · simulation" }, objective_id: null, action: "scan", points: 0 };
    this.setProfile(DEFAULT_PROFILE);
    this.reset();
  }

  // Perfil fisico del astronauta (engine/physiology.js): cambia la velocidad, el salto y el gasto de O2 y bateria
  setProfile(profile) {
    this.bio = new Physiology(profile, this.s ? this.cargoKg() : BASE_KIT_KG);
    this.speedK = this.bio.vDesign / REF.vDesign;              // pierna mas larga -> marcha mas rapida (Froude)
    this.loadK = Math.sqrt(REF.total / this.bio.total);        // misma potencia de piernas, mas masa -> algo mas lento
    this.realPerWorld = REF.vDesign / this.rules.movement.walk_speed_mps;
    // capacidad de O2 del traje: 8 h para el astronauta de referencia caminando en llano (rules.json -> oxygen)
    this._o2Base = REF.o2gPerH(REF_FLAT_W) * 8 * (this.rules.resources.oxygen.metabolic_calibration || 1);
    this.o2CapacityG = this._o2Base * (this.diff ? this.diff.o2K : 1);
  }

  // Dificultad (gameplay/difficulty.js): margenes del traje y frecuencia de tormentas
  setDiff(d) {
    this.diff = d;
    if (this._o2Base) this.o2CapacityG = this._o2Base * d.o2K;
  }

  // Carga a pie: kit base + muestras recogidas y no entregadas todavia
  cargoKg() { const c = this.s.cargo; return c.kit + c.carried * SAMPLE_KG; }
  _applyLoad() {
    this.bio.setLoad(this.cargoKg());
    this.loadK = Math.sqrt(REF.total / this.bio.total);
    this.emit("cargo", this.s.cargo);
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  emit(evt, payload) { (this.listeners[evt] || []).forEach((fn) => fn(payload)); }

  reset() {
    const R = this.rules.resources;
    const start = this.objectives[this.data.missions.campaign.start_at];
    this.s = {
      x: start.world.x + 18, z: start.world.z + 14, heading: Math.PI,
      oxygen: R.oxygen.start, energy: R.energy.start, integrity: R.integrity.start,
      gameSeconds: 0, realSeconds: 0, clockOffset: 0,   // clockOffset: ajuste manual de la hora (s), no cuenta como EVA
      missionIndex: 0, phase: "title",
      scanProgress: 0, scanned: false, moving: false, speed: 0, movedTotal: 0,
      blockedAhead: false, inShelter: null,
      cargo: { kit: BASE_KIT_KG, carried: 0, stored: 0 },   // muestras: en la mochila / entregadas en refugios
      spe: null, stormBonus: false,
      science: 0, layer: null, routeOn: false,
      tutorialStep: 0, tutorialTimer: 0, routeToggledInStep: false,
      failCause: null,
      // fisica: altura de los pies, velocidad y contacto con el suelo (y = null -> se apoya al empezar)
      y: null, vx: 0, vy: 0, vz: 0, grounded: true, air: 0,
      driving: false,
      car: { x: start.world.x + 13, z: start.world.z + 24, heading: 2.3 },
      // fisiologia y telemetria acumulada de la EVA
      bio: { M: this.bio ? this.bio.metabolic(0) : 150, grade: 0, eta: 1.2, fatigue: 0, kcal: 0, o2g: 0, co2g: 0, waterg: 0, doseUgy: 0, hr: 70, vReal: 0 },
      track: [],
      // modo libre (simulacion): sin campana; sim = recursos que no se gastan; freeN/freeDone = destinos definidos/medidos
      free: false, sim: { lockO2: false, lockEnergy: false, lockIntegrity: false }, freeN: 0, freeDone: 0,
    };
    this.checkpoint = null;
    delete this.objectives.custom;
    this._free.objective_id = null;
    this._grade = 0;
    this.env = null;
    // carga del kit base: la fisiologia no debe arrastrar las muestras de la partida anterior
    if (this.bio) {
      this.bio.setLoad(this.cargoKg());
      this.loadK = Math.sqrt(REF.total / this.bio.total);
      this.s.bio.M = this.bio.metabolic(0);
    }
    this.rng = new Rng();                          // nueva semilla en cada partida
    this.emit("reset");
  }

  // ---- estado serializable y puntos de control ------------------------------------------------------------
  // Otros componentes (clima, EVA-2) registran como guardar y restaurar su parte del estado
  registerState(key, provider) { this._ext[key] = provider; }
  get restoring() { return !!this._restoring; }
  captureCheckpoint() {
    const ext = {};
    for (const [k, p] of Object.entries(this._ext)) ext[k] = clone(p.get());
    this.checkpoint = { s: clone(this.s), rng: this.rng.getState(), ext };
    return this.checkpoint;
  }
  restoreCheckpoint(cp = this.checkpoint) {
    if (!cp) return false;
    this._restoring = true;
    this.s = clone(cp.s);
    this.rng.setState(cp.rng);
    for (const [k, p] of Object.entries(this._ext)) if (cp.ext && cp.ext[k] !== undefined) p.set(clone(cp.ext[k]));
    // fisiologia y carga del punto de control (sin muestras de lo jugado despues)
    this._grade = 0;
    this.env = null;
    this._applyLoad();
    this._restoring = false;
    return true;
  }

  // ---- recursos: unico punto de entrada para gastarlos (respeta los bloqueos del modo libre) ---------------
  // key: "oxygen" | "energy" | "integrity"
  locks() {
    const s = this.s;
    return s.free ? { oxygen: !!s.sim.lockO2, energy: !!s.sim.lockEnergy, integrity: !!s.sim.lockIntegrity } : null;
  }
  isLocked(key) { const l = this.locks(); return !!(l && l[key]); }
  spend(key, amount) {
    if (!(amount > 0) || this.isLocked(key)) return 0;
    this.s[key] -= amount;
    if (key === "energy") this.s.energy = Math.max(0, this.s.energy);
    return amount;
  }
  gain(key, amount, cap = 100) {
    if (!(amount > 0)) return 0;
    const before = this.s[key];
    this.s[key] = Math.min(cap, before + amount);
    return this.s[key] - before;
  }

  // Contexto del nucleo de simulacion (gameplay/simcore.js), compartido con el planificador
  simCtx() { return { world: this.world, rules: this.rules, bio: this.bio, o2CapacityG: this.o2CapacityG, diff: this.diff, realPerWorld: this.realPerWorld }; }

  // Refugio en (x, z): misma regla en la partida y en el planificador
  shelterAt(x, z) {
    for (const o of Object.values(this.objectives)) {
      if (!o.shelter) continue;
      const d = Math.hypot(o.world.x - x, o.world.z - z);
      // los interiores caminables (cupula, invernadero) solo cuentan si estas dentro de verdad
      if (o.interior ? d < o.radius_m : d < this.radiusOf(o) + 6) return o.id;
    }
    return null;
  }

  get mission() { return this.s.free ? this._free : this.missions[this.s.missionIndex]; }
  get target() {
    const s = this.s;
    if (s.spe && s.spe.phase !== "ended") return this.nearestShelter();
    if (s.free) return this.objectives.custom || null;
    return this.objectives[this.mission.objective_id];
  }
  // Temperatura del suelo con el efecto de la tormenta de polvo (si la hay)
  tempAt(x, z, hour = this.hour) { return this.world.temperature(x, z, hour) + (this.weather ? this.weather.thermalOffset(hour) : 0); }
  get hour() { return this.rules.time.start_local_time_h + (this.s.gameSeconds + (this.s.clockOffset || 0)) / 3600; }

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

  // ---- Rover marciano -------------------------------------------------------------------
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

  // ---- modo libre (simulacion) ----------------------------------------------------
  // Sin objetivo predefinido: el usuario elige destino, punto de salida, hora, tormentas y que recursos se gastan.
  startFree() {
    this.reset();
    const s = this.s;
    s.free = true;
    s.phase = "playing";
    this.emit("free", true);
    this.captureCheckpoint();               // despues de que el clima y EVA-2 se inicialicen (handlers de "free")
  }

  // Destino propio en (x, z) del mundo. latlon = [lat, lonEste] (lo calcula quien llama con GeoFrame)
  setFreeTarget(x, z, latlon, name = null) {
    const s = this.s;
    if (!s.free) return null;
    s.freeN += 1;
    const y = this.groundAt(x, z);
    const o = {
      id: "custom", type: "custom", radius_m: 15, n: s.freeN,
      name: name || { es: `Destino ${s.freeN}`, en: `Destination ${s.freeN}` },
      world: { x, y, z }, latlon, elevation_m: y + this.world.yRef,
    };
    this.objectives.custom = o;
    this._free.objective_id = "custom";
    s.scanProgress = 0; s.scanned = false; s.plan = null;
    this.emit("freeTarget", o);
    return o;
  }

  clearFreeTarget() {
    const s = this.s;
    if (!s.free) return;
    delete this.objectives.custom;
    this._free.objective_id = null;
    s.scanProgress = 0; s.scanned = false; s.plan = null;
    this.emit("freeTarget", null);
  }

  // Coloca al astronauta (y al rover, si va a bordo) en otro punto del mapa
  teleport(x, z) {
    const s = this.s;
    s.x = x; s.z = z; s.y = null;
    s.vx = s.vy = s.vz = 0;
    s.scanProgress = 0;
    if (s.driving) { s.car.x = x; s.car.z = z; }
  }

  // Lleva el rover junto al astronauta (modo libre)
  summonVehicle() {
    const s = this.s;
    if (s.driving) return;
    for (const [dx, dz] of [[5, 3], [-5, 3], [5, -3], [-5, -3], [0, 6], [0, -6]]) {
      if (!this.world.blockedAt(s.x + dx, s.z + dz)) { s.car = { x: s.x + dx, z: s.z + dz, heading: s.heading }; return; }
    }
    s.car = { x: s.x + 4, z: s.z, heading: s.heading };
  }

  // Cambia la hora solar local (0-24 h) dentro del sol actual
  // Mueve solo el reloj solar (hacia delante o hacia atras) sin cambiar de sol ni la duracion de la EVA
  setHour(h) {
    const cur = this.hour, day = Math.floor(cur / 24);
    this.s.clockOffset = (this.s.clockOffset || 0) + (day * 24 + h - cur) * 3600;
  }

  endStorm() {
    const s = this.s;
    if (!s.spe || s.spe.phase === "ended") return;
    s.spe.phase = "ended";
    this.emit("spe", s.spe);
  }

  // Pone a cero la traza y los contadores de la EVA sin mover al astronauta
  resetCounters() {
    const s = this.s, b = s.bio;
    s.track = []; s.movedTotal = 0; s.realSeconds = 0;
    b.kcal = b.o2g = b.co2g = b.waterg = b.doseUgy = 0; b.fatigue = 0;
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
    s.subs = this._makeSubs(this.mission);
    // misiones con "vehicle": "beside" (mision 3): el rover aparece aparcado junto al astronauta
    if (!s.free && this.mission.vehicle === "beside") this.summonVehicle();
    s.phase = "briefing";
    this.emit("mission", this.mission);
    this.captureCheckpoint();               // despues de colocar a EVA-2 junto al jugador (handler de "mission")
  }

  // Subobjetivos de una mision (missions.json -> subtargets): puntos reales de una clase mineral de CRISM
  // alrededor del objetivo. Se eligen transitables, separados entre si y siempre los mismos (sin azar).
  _makeSubs(m) {
    const st = m && m.subtargets, obj = m && this.objectives[m.objective_id];
    if (!st || !obj) return null;
    const W = this.world, o = obj.world, R = st.radius_m || 350, minSep = st.min_sep_m || 60;
    const want = (cls) => {
      const cand = [];
      for (let dz = -R; dz <= R; dz += 6) for (let dx = -R; dx <= R; dx += 6) {
        const d = Math.hypot(dx, dz);
        if (d > R || d < (st.min_dist_m || 40)) continue;
        const x = o.x + dx, z = o.z + dz;
        if (W.spectral(x, z) !== cls || W.blockedAt(x, z) || W.slope(x, z) > 18) continue;
        cand.push([x, z, d]);
      }
      return cand;
    };
    let cand = want(st.class);
    if (cand.length < st.count) cand = cand.concat(want(st.fallback_class ?? 2));
    // del mas cercano al objetivo hacia fuera, respetando la separacion minima
    cand.sort((a, b) => a[2] - b[2]);
    const out = [];
    for (const c of cand) {
      if (out.every((q) => Math.hypot(q.x - c[0], q.z - c[1]) >= minSep)) out.push({ x: c[0], z: c[1], found: false, cls: W.spectral(c[0], c[1]) });
      if (out.length >= st.count) break;
    }
    return out.length ? out : null;
  }
  get subsLeft() { return this.s.subs ? this.s.subs.filter((q) => !q.found).length : 0; }

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

  // Reintentar: restaura jugador, clima, EVA-2 y el estado del generador aleatorio al punto de control
  // (con las mismas entradas se repiten los mismos eventos)
  retry() {
    if (!this.checkpoint) return;
    if (this.s.free) {
      // modo libre: vuelve al inicio de la simulacion; conserva el destino definido y que recursos se gastan
      const sim = { ...this.s.sim };
      this.restoreCheckpoint();
      this.s.sim = sim;
      this._restoring = true; this.emit("free", true); this._restoring = false;
      return;
    }
    this.restoreCheckpoint();
    this.s.phase = "briefing";
    this._restoring = true; this.emit("mission", this.mission); this._restoring = false;
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
    // Movimiento: en pasos cortos para que las colisiones no se salten obstaculos a pocos FPS
    s.blockedAhead = false;
    const steps = Math.min(4, Math.ceil(dt / 0.034));
    for (let i = 0; i < steps; i++) this._move(dt / steps, move, jump);
    if (this.dynamics) this.dynamics.step(dt, s.x, s.z);
    if (s.driving) { s.car.x = s.x; s.car.z = s.z; s.car.heading = s.heading; }

    // Tiempo, ambiente, refugio, fisiologia y recursos (nucleo compartido con el planificador)
    const onFoot = s.moving && !s.driving;
    if (this._simStep(dt, { x: s.x, z: s.z, vReal: onFoot ? s.speed * this.realPerWorld : 0, grade: onFoot ? this._grade || 0 : 0, onFoot, driving: s.driving })) return;

    if (s.oxygen <= 0) { s.oxygen = 0; this._fail("fail_oxygen"); return; }
    if (s.integrity <= 0) { s.integrity = 0; this._fail("fail_integrity"); return; }

    // Subobjetivos (vetas de la mision 4): basta con llegar a menos de 6 m de cada uno
    if (s.subs) for (const q of s.subs) {
      if (!q.found && Math.hypot(q.x - s.x, q.z - s.z) < 6) {
        q.found = true;
        const pts = (this.mission.subtargets && this.mission.subtargets.points) || 20;
        s.science += pts;
        this.emit("subFound", { sub: q, left: this.subsLeft, points: pts });
      }
    }

    // Objetivo de la mision
    const m = this.mission;
    const obj = m.objective_id ? this.objectives[m.objective_id] : null;
    const d = obj ? this.distTo(obj) : Infinity;
    s.scanBlocked = !!(obj && !s.scanned && this.subsLeft > 0 && d < this.radiusOf(obj));
    if (obj && !s.scanned && !s.scanBlocked && !(s.spe && s.spe.phase !== "ended")) {
      if (m.action === "reach") {
        if (d < this.radiusOf(obj)) { s.scanned = true; this._completeMission(); return; }
      } else if (d < this.radiusOf(obj)) {
        if (s.scanProgress === 0) this.emit("scanStart");
        s.scanProgress += dt;
        if (s.scanProgress >= this.rules.science.scan_time_s) {
          s.scanned = true;
          this.spend("energy", R.energy.scanner_cost);
          s.cargo.carried += 1;          // muestra recogida: se suma a la carga
          this._applyLoad();
          if (s.free) {
            // modo libre: se mide el punto y la simulacion sigue; el usuario decide el siguiente destino
            s.freeDone += 1;
            this.emit("freeScan", { objective: obj });
          } else {
            s.phase = "card";
            this.emit("scanComplete", { mission: m, objective: obj, fact: this.facts[m.fact_id] });
          }
        }
      } else if (s.scanProgress > 0) {
        s.scanProgress = 0;
        this.emit("scanLost");
      }
    }

    this._tutorial(dt);
  }

  // Un paso de simulacion fuera del movimiento: reloj, refugio, nucleo (gameplay/simcore.js), tormenta solar.
  // kin = { x, z, vReal, grade, onFoot, driving }. Devuelve true si el paso cerro la mision (no seguir).
  // Lo usan Game.update y la prueba de equivalencia con el planificador (mismas entradas, mismo codigo).
  _simStep(dt, kin) {
    const s = this.s, W = this.world;
    s.realSeconds += dt;
    s.gameSeconds += dt * this.rules.time.time_scale;
    // Refugios
    const prevShelter = s.inShelter;
    s.inShelter = this.shelterAt(s.x, s.z);
    if (s.inShelter && s.inShelter !== prevShelter) {
      this.emit("shelter", this.objectives[s.inShelter]);
      // se dejan las muestras en el rover o en el refugio: vuelve a pesar solo el kit
      if (s.cargo.carried > 0) {
        const n = s.cargo.carried;
        s.cargo.stored += n; s.cargo.carried = 0;
        this._applyLoad();
        this.emit("cargoUnload", { n, kg: n * SAMPLE_KG, where: this.objectives[s.inShelter] });
      }
    }
    const hour = this.hour, wx = this.weather;
    const st = { oxygen: s.oxygen, energy: s.energy, integrity: s.integrity, inShelter: s.inShelter, spe: s.spe, bio: s.bio, locks: this.locks() };
    const res = stepCore(this.simCtx(), st, {
      x: kin.x, z: kin.z, hour, vReal: kin.vReal, grade: kin.grade, onFoot: kin.onFoot, driving: kin.driving,
      dustLevel: this.dustLevel || 0, dustCover: wx ? wx.cover || 0 : 0, dustThermal: wx ? wx.thermalOffset(hour) : 0,
    }, dt);
    s.oxygen = st.oxygen; s.energy = st.energy; s.integrity = st.integrity;
    this.env = { slope: res.env.slope, temp: res.env.temp, dose: res.env.dose };
    this._track();
    // Tormenta solar (el reloj lo avanza el nucleo; aqui solo las consecuencias de la campana)
    if (res.spe === "active") this.emit("spe", s.spe);
    if (res.spe === "ended") {
      const E = this.rules.events.solar_particle_event;
      s.stormBonus = s.spe.sheltered >= 0.5 * E.duration_s;
      this.emit("spe", s.spe);
      if (s.free) return true;                     // en modo libre la tormenta no cierra ninguna mision
      if (s.integrity > 0 && s.oxygen > 0) this._completeMission();
      return true;
    }
    return false;
  }

  // ---- fisica del movimiento ---------------------------------------------------------
  // Suelo bajo (x, z): el terreno o, a pie, la cima de una roca que se pueda pisar
  _ground(x, z) {
    const base = this.groundAt(x, z), s = this.s;
    if (!this.colliders || s.y == null) return base;
    // el rover sube a plataformas bajas, pero no se apoya en las rocas: las pasa con su altura libre
    return s.driving ? this.colliders.groundOn(x, z, s.y, PHYS.carClear, base, false) : this.colliders.groundOn(x, z, s.y, PHYS.step, base);
  }

  _move(dt, move, jump) {
    const s = this.s, W = this.world, H = this.rules.hazards, C = this.colliders;
    const drv = s.driving;
    if (s.y == null || Math.abs(s.y - this.groundAt(s.x, s.z)) > 60) { s.y = this._ground(s.x, s.z); s.vy = 0; s.grounded = true; }
    const slopeHere = W.slope(s.x, s.z);
    const slopeK = clamp(1 - (slopeHere - H.slope.slow_above_deg) / 26, 0.5, 1);
    const fatigueK = 1 - 0.45 * Math.min(1, s.bio.fatigue / 100);
    const top = this.rules.movement.walk_speed_mps * slopeK * (drv ? DRIVE.speed_k : (s.energy <= 0 ? 0.4 : 1) * this.speedK * fatigueK * (this.loadK || 1));

    // velocidad deseada: a pie va hacia donde se pulsa; el rover gira poco a poco y avanza de frente
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
        const parked = boxCollider(s.car.x, s.car.z, 1.45, 2.0, s.car.heading);
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
          // el rover tiene 1800 kg de inercia: un choque frontal rapido se nota en el traje
          if (drv && -vn > PHYS.carCrashSafe) {
            const damage = (-vn - PHYS.carCrashSafe) * PHYS.carCrashDamage * (this.diff ? this.diff.damageK : 1);
            this.spend("integrity", damage);
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
    // pendiente a lo largo del movimiento (+ = cuesta arriba), para el gasto metabolico
    if (moved > 1e-4) this._grade = (hx * (nx - x0) + hz * (nz - z0)) / moved;
    s.speed = moved / dt;
    s.moving = s.speed > 0.1;
    s.movedTotal += moved;

    // vertical: gravedad de Marte. En el suelo el cuerpo sigue la pendiente; despega si salta,
    // si el suelo cae mas rapido de lo que la gravedad permite seguirlo (cresta) o si pisa un borde.
    const gNew = this._ground(nx, nz);
    const vG = clamp((this.groundAt(nx, nz) - g0) / dt, -s.speed * 1.2 - 0.5, s.speed * 1.2 + 0.5);
    if (s.grounded) {
      if (jump && !drv) {
        s.vy = Math.max(0, vG) * 0.5 + PHYS.jumpV * this.bio.jumpK;
        s.grounded = false;
        this.emit("jump");
      } else if (!(!drv && floorAt(nx, nz) != null && Math.abs(s.y - gNew) < PHYS.step) && (s.y - gNew > PHYS.step || vG < s.vy - MARS.g * dt - (drv ? PHYS.carCrestTol : PHYS.crestTol))) {
        // (en suelos construidos -rampas y esclusas- se camina pegado al suelo: no hay "salto de cresta")
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
        const damage = Math.max(0, impact - safe) * (drv ? PHYS.carImpactDamage : PHYS.impactDamage) * (this.diff ? this.diff.damageK : 1);
        if (damage > 0) this.spend("integrity", damage);
        if (impact > 1.2) this.emit("land", { impact, damage, driving: drv });
      }
    }
    s.air = s.grounded ? 0 : Math.max(0, s.y - gNew);
  }

  // Registro de la traza (cada 12 m o cada 2 min de Marte): [t_marte_s, x, z, elevacion_m, W, O2 %]
  _track() {
    const s = this.s, tr = s.track, last = tr[tr.length - 1];
    if (last && Math.hypot(s.x - last[1], s.z - last[2]) < 12 && s.gameSeconds - last[0] < 120) return;
    const elev = this.groundAt(s.x, s.z) + this.world.yRef;
    tr.push([Math.round(s.gameSeconds), +s.x.toFixed(1), +s.z.toFixed(1), +elev.toFixed(1), Math.round(s.bio.M), +s.oxygen.toFixed(1)]);
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
