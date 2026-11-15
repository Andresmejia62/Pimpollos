import * as THREE from "three";
import { WIND } from "../engine/dustfx.js";

// Clima de Marte en el juego: tormentas de polvo regionales y remolinos de polvo (dust devils).
//
// Lo importante (y poco intuitivo): el viento de Marte puede ir a 25-30 m/s en una tormenta, pero el aire tiene
// ~1 % de la densidad del de la Tierra (rho ~0,02 kg/m3 en Gale). La fuerza del viento va con rho*v^2, asi que
// empuja como una brisa terrestre de ~3 m/s: no tumba a nadie (la escena de "The Martian" no podria pasar).
// El peligro real del polvo es otro: visibilidad, sellos y visor del traje, baterias y paneles solares.
//  - Tormenta regional: llega como un muro de polvo desde barlovento, la opacidad tau sube de ~0,6 a ~4
//    (Opportunity midio 10,8 en 2018), la visibilidad cae a cientos de metros y el Sol casi desaparece.
//  - Remolinos: solo de dia (11-16 h, cuando el suelo esta mucho mas caliente que el aire), se desplazan con el
//    viento a 3-6 m/s; dentro cargan de estatica el traje y llenan el visor de polvo, pero apenas empujan.
const RHO_MARS = 0.02, RHO_EARTH = 1.2;
export const earthEquivalent = (v) => v * Math.sqrt(RHO_MARS / RHO_EARTH);          // ~0,13 v
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const L = (es, en) => ({ es, en });

// ---- shaders -----------------------------------------------------------------------------------------
const NOISE = /* glsl */ `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1,0)), u.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), u.x), u.y); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }`;

function devilMaterial(seed) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: { value: 0 }, uSeed: { value: seed }, uAlpha: { value: 0 }, uLight: { value: 1 }, uColor: { value: new THREE.Color(0.66, 0.46, 0.32) }, uSway: { value: 0 } },
    vertexShader: /* glsl */ `
      uniform float uTime, uSeed, uSway; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vUv = uv;
        vec3 p = position;
        // la columna se curva y oscila con la altura (el viento arriba es mas fuerte)
        float k = uv.y * uv.y;
        p.x += sin(uTime * 0.35 + uSeed) * uSway * k + uSway * 0.6 * k;
        p.z += cos(uTime * 0.27 + uSeed * 1.7) * uSway * 0.6 * k;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: NOISE + /* glsl */ `
      uniform float uTime, uSeed, uAlpha, uLight; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        // bandas que giran y suben en espiral
        vec2 q = vec2(vUv.x * 6.0 - uTime * 0.9 + vUv.y * 3.0, vUv.y * 5.0 - uTime * 0.55);
        float n = fbm(q + uSeed) * 0.75 + fbm(q * 2.7 - uSeed) * 0.35;
        float body = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 0.7) * smoothstep(0.0, 0.04, vUv.y);
        float edge = pow(abs(dot(vN, vV)), 0.6);                        // mas denso en el centro que en el borde
        float a = smoothstep(0.32, 0.85, n) * body * edge * uAlpha;
        gl_FragColor = vec4(uColor * (0.75 + 0.35 * n) * uLight, a * 0.85);
      }`,
  });
}
function wallMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uLight: { value: 1 }, uNear: { value: 0 }, uColor: { value: new THREE.Color(0.58, 0.33, 0.2) }, uFog: { value: new THREE.Color(0.7, 0.5, 0.36) } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: NOISE + /* glsl */ `
      uniform float uTime, uAlpha, uLight, uNear; uniform vec3 uColor, uFog; varying vec2 vUv;
      void main(){
        // frente de la tormenta: un banco de polvo que sale de detras del relieve (la base queda bajo el terreno),
        // con torres de nubes que suben y una cima difusa. De lejos se confunde con la bruma; al acercarse se
        // vuelve oscuro y denso.
        vec2 q = vec2(vUv.x * 9.0 + uTime * 0.03, vUv.y * 2.6 - uTime * 0.06);
        float n = fbm(q) * 0.8 + fbm(q * 2.4 + 7.0) * 0.35;
        float cols = fbm(vec2(vUv.x * 14.0 + uTime * 0.015, 1.7));          // torres de polvo de distinta altura
        float top = 0.42 + 0.38 * cols;
        float body = smoothstep(top + 0.16, top - 0.30, vUv.y + (n - 0.5) * 0.12);
        float lit = smoothstep(0.45, 0.95, n) * smoothstep(top - 0.35, top + 0.05, vUv.y);
        vec3 col = mix(uColor * 0.6, vec3(0.8, 0.55, 0.37), lit * 0.8 + n * 0.15);
        col = mix(uFog, col, 0.35 + 0.65 * uNear);                           // de lejos tiene el color de la bruma
        float sides = smoothstep(0.0, 0.28, vUv.x) * smoothstep(1.0, 0.72, vUv.x);
        float a = body * (0.7 + 0.35 * n) * sides * (0.55 + 0.45 * uNear);
        gl_FragColor = vec4(col * uLight, clamp(a, 0.0, 1.0) * uAlpha);
      }`,
  });
}

const STORM_D = { approach: 45, front: 22, peak: 85, clearing: 40 };
const NEXT_PHASE = { approach: "front", front: "peak", peak: "clearing", clearing: "none" };

// Efecto termico de una tormenta de nivel L a la hora local dada (funcion pura; la usan el motor y el planificador)
export function thermalOffsetFor(L, hour) {
  if (L < 0.01) return 0;
  const h = ((hour % 24) + 24) % 24;
  const day = clamp(Math.sin(((h - 6) / 12) * Math.PI), 0, 1);
  return L * (-18 * day + 14 * (1 - day));
}
// Nivel objetivo de la tormenta en una fase (el nivel real lo sigue con un retraso de primer orden)
function stormTarget(phase, t, clock, gust) {
  return phase === "front" ? smooth(0, STORM_D.front, t) : phase === "peak" ? 0.88 + 0.12 * Math.sin(clock * 0.7) * gust : phase === "clearing" ? 1 - smooth(0, STORM_D.clearing, t) : 0;
}
const FORECAST_LEAD = 150;          // s de aviso antes de que empiece la aproximacion

export class Weather {
  // El azar que decide la simulacion (cuando llega una tormenta, rafagas, donde y como nace un remolino) sale del
  // generador con semilla de la partida (game.rng) y se guarda en el punto de control. El azar solo visual (el
  // dibujo de cada remolino) usa Math.random y no altera la secuencia de eventos.
  constructor(ms, game, { onAlert, onStatic } = {}) {
    Object.assign(this, { ms, game, onAlert, onStatic });
    this.windDir = WIND.clone().normalize();
    this.devils = [];
    this.devilNear = 0;             // 0..1: lo cerca que pasa un remolino (para el sonido)
    this.frontR = null;             // radio del frente de polvo mientras se acerca (para el minimapa)
    this.cover = 0;
    // muro de la tormenta: arco de cilindro alrededor del jugador que se va cerrando
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 64, 1, true, 0, 2.4), wallMaterial());
    this.wall.frustumCulled = false; this.wall.renderOrder = 5; this.wall.visible = false;
    ms.scene.add(this.wall);
    game.weather = this;
    this.reset();
    // nueva partida: clima nuevo con la semilla nueva; el estado entra en los puntos de control
    game.on("reset", () => this.reset());
    game.registerState("weather", { get: () => this.getState(), set: (st) => this.setState(st) });
  }
  get rnd() { return this.game.rng.next(); }

  reset() {
    this._clearDevils();
    this.gust = 0.25;
    this.visor = 0;                 // polvo pegado al visor (0..1)
    this.storm = { phase: "none", t: 0, level: 0, tau: 0.6 };
    this.clock = 0;                 // segundos reales de juego activo
    this.nextStorm = (260 + this.rnd * 120) * (this.game.diff ? this.game.diff.stormK : 1);
    this.nextDevil = 12;
    this.saidForce = false;
    this.forecastSaid = false;      // aviso previo (pronostico orbital, como el informe diario de MRO/MARCI)
    this.firstDevil = true;         // el primer remolino aparece a la vista, aunque la EVA empiece por la tarde
    this.game.dustLevel = 0;
  }

  // ---- estado serializable (sin objetos graficos) ------------------------------------------------------
  getState() {
    return {
      gust: this.gust, visor: this.visor, storm: { ...this.storm }, clock: this.clock, nextStorm: this.nextStorm, nextDevil: this.nextDevil,
      saidForce: this.saidForce, forecastSaid: this.forecastSaid, firstDevil: this.firstDevil,
      devils: this.devils.map(({ g, mats, ...d }) => ({ ...d })),
    };
  }
  setState(st) {
    this._clearDevils();
    Object.assign(this, { gust: st.gust, visor: st.visor, storm: { ...st.storm }, clock: st.clock, nextStorm: st.nextStorm, nextDevil: st.nextDevil,
      saidForce: st.saidForce, forecastSaid: st.forecastSaid, firstDevil: st.firstDevil });
    for (const d of st.devils || []) this._addDevil({ ...d });
    this.game.dustLevel = this.storm.level;
    this._lastLv = -1;
  }
  _clearDevils() {
    for (const dv of this.devils || []) { this.ms.scene.remove(dv.g); dv.mats.forEach((m) => m.dispose()); }
    this.devils = [];
  }

  // Pronostico del nivel de polvo (0..1) cada `step` s durante `seconds` s, desde el estado actual y sin tocarlo
  // (ni el generador aleatorio): las rafagas futuras se suponen iguales a la actual. Lo usa el planificador.
  forecastLevels(seconds, step = 1) {
    const n = Math.max(1, Math.ceil(seconds / step) + 1), out = new Float32Array(n);
    let phase = this.storm.phase, t = this.storm.t, level = this.storm.level, clock = this.clock;
    const sub = Math.min(step, 0.25), k = Math.ceil(step / sub), dt = step / k;
    const speActive = this.game.s.spe && this.game.s.spe.phase !== "ended";
    for (let i = 0; i < n; i++) {
      out[i] = level;
      for (let j = 0; j < k; j++) {
        clock += dt;
        if (phase === "none" && clock > this.nextStorm && !speActive) { phase = "approach"; t = 0; }
        if (phase !== "none") {
          t += dt;
          if (t > STORM_D[phase]) { t = 0; phase = NEXT_PHASE[phase]; }
          level += (stormTarget(phase, t, clock, this.gust) - level) * Math.min(1, dt * 1.5);
        } else level += (0 - level) * Math.min(1, dt * 0.5);
      }
    }
    return out;
  }

  get windSpeed() {
    const st = this.storm.level;
    return 4 + this.gust * 9 + st * 18;                                  // m/s
  }

  // Forzar una tormenta (depuracion o eventos)
  startStorm() { if (this.storm.phase === "none") { this.forecastSaid = true; this.storm = { phase: "approach", t: 0, level: 0, tau: 0.6 }; this._alert("approach"); } }

  // Pronostico: segundos reales hasta que el frente llegue al jugador (null si aun no hay aviso) y hasta que escampe
  eta() {
    const S = this.storm, D = STORM_D;
    if (S.phase === "none") return this.forecastSaid ? { inS: Math.max(0, this.nextStorm - this.clock) + D.approach, clearS: null, phase: "forecast" } : null;
    if (S.phase === "approach") return { inS: D.approach - S.t, clearS: D.approach - S.t + D.front + D.peak + D.clearing, phase: S.phase };
    const rest = S.phase === "front" ? D.front - S.t + D.peak + D.clearing : S.phase === "peak" ? D.peak - S.t + D.clearing : D.clearing - S.t;
    return { inS: 0, clearS: rest, phase: S.phase };
  }

  // Efecto termico de la tormenta en el suelo (°C): el polvo tapa el Sol de dia y frena el enfriamiento de noche
  // (lo observado por Viking y Curiosity/REMS en 2018: menos amplitud diaria). Proporcional a la opacidad.
  thermalOffset(hour) { return thermalOffsetFor(this.storm.level, hour); }

  _alert(kind) {
    if (!this.onAlert) return;
    const v = Math.round(this.windSpeedFor(kind)), ve = earthEquivalent(v).toFixed(1);
    const T = {
      forecast: { id: "a_dust_forecast", severity: "info", text: L(`Pronóstico orbital: un frente de polvo regional llegará a tu posición en unos ${Math.round((this.eta()?.inS || 0) / 60)} min. Abre el planificador (G) para ver si llegas antes a un refugio.`, `Orbital forecast: a regional dust front will reach you in about ${Math.round((this.eta()?.inS || 0) / 60)} min. Open the planner (G) to see whether you reach a shelter first.`) },
      approach: { id: "a_dust_storm", severity: "caution", text: L(`Tormenta de polvo regional acercándose desde el oeste. Opacidad prevista τ ≈ 4: la visibilidad caerá a unos cientos de metros. Busca un refugio o sigue la ruta con el minimapa.`, `Regional dust storm approaching from the west. Expected opacity τ ≈ 4: visibility will drop to a few hundred meters. Find a shelter or follow the route on the minimap.`) },
      front: { id: "a_dust_front", severity: "info", text: L(`Dentro de la tormenta: viento de ${v} m/s, pero con el 1 % de la densidad del aire terrestre empuja como una brisa de ${ve.replace(".", ",")} m/s en la Tierra. El riesgo es el polvo: visor, sellos y baterías.`, `Inside the storm: ${v} m/s wind, but at 1 % of Earth's air density it pushes like a ${ve} m/s breeze on Earth. The risk is dust: visor, seals and batteries.`) },
      clearing: { id: "a_dust_clear", severity: "info", text: L("La tormenta se aleja: la opacidad baja y vuelve la luz del Sol.", "The storm is moving away: opacity drops and sunlight returns.") },
      devil: { id: "a_dust_devil", severity: "info", text: L("Te ha atravesado un remolino de polvo: viento giratorio de ~15 m/s que apenas empuja, pero carga de estática el traje y ensucia el visor (pulsa V para limpiarlo). En Marte también limpian los paneles solares: así sobrevivieron años Spirit y Opportunity.", "A dust devil just went through you: ~15 m/s swirling wind that barely pushes, but it charges the suit with static and coats the visor (press V to wipe it). On Mars they also clean solar panels: that's how Spirit and Opportunity lasted for years.") },
    };
    this.onAlert(T[kind]);
  }
  windSpeedFor(kind) { return kind === "front" ? 24 : kind === "devil" ? 15 : this.windSpeed; }

  wipe() { const had = this.visor > 0.05; this.visor = 0; return had; }

  // El primero sale delante de la camara, a media distancia, y su trayectoria cruza cerca del jugador
  // (se usa el rumbo del jugador, no la camara: lo que se dibuja no debe cambiar la simulacion)
  _spawnDevilInView(px, pz) {
    const hd = this.game.s.heading || 0, f = new THREE.Vector3(-Math.sin(hd), 0, -Math.cos(hd));
    const d = 170 + this.rnd * 60;
    // se coloca a barlovento de un punto delante del jugador, asi el viento lo trae hacia la linea de vision
    const cx = px + f.x * d, cz = pz + f.z * d;
    return this._spawnDevil(px, pz, cx - this.windDir.x * 60, cz - this.windDir.z * 60, 1.3);
  }

  _spawnDevil(px, pz, fx, fz, big = 1) {
    // siempre se consumen los mismos numeros del generador, nazca o no el remolino
    const d = 260 + this.rnd * 480;
    const perp = new THREE.Vector3(-this.windDir.z, 0, this.windDir.x);
    const off = (this.rnd - 0.5) * 420;
    const x = fx ?? px - this.windDir.x * d + perp.x * off, z = fz ?? pz - this.windDir.z * d + perp.z * off;
    const h = (140 + this.rnd * 260) * big, r0 = 3 + this.rnd * 6, r1 = (18 + this.rnd * 28) * big;
    const life = 80 + this.rnd * 70, speed = 3.5 + this.rnd * 2.5;
    const seed = this.rnd * 100;                 // fase del serpenteo: mueve el remolino, asi que es de la simulacion
    if (!this.game.world.inside(x, z, 60)) return;
    // oscilacion del dibujo: azar visual (no afecta a la simulacion)
    this._addDevil({ x, z, r0, r1, h, life, age: 0, speed, touched: false, seed, sway: 6 + Math.random() * 14 });
  }

  // crea el dibujo de un remolino a partir de sus datos (al nacer o al restaurar un punto de control)
  _addDevil(dv) {
    const { x, z, r0, h, seed } = dv, r1 = dv.r1 ?? r0 * 5;
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, 28, 10, true), devilMaterial(seed));
    core.position.y = h / 2;
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(r1 * 1.5, r0 * 2.4, h * 0.85, 28, 8, true), devilMaterial(seed + 31));
    outer.position.y = h * 0.85 / 2;
    // falda de polvo en la base
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(r0 * 3.2, r0 * 4.2, 9, 28, 2, true), devilMaterial(seed + 7));
    skirt.position.y = 4.5;
    for (const m of [core, outer, skirt]) { m.frustumCulled = false; m.renderOrder = 5; g.add(m); }
    outer.material.uniforms.uColor.value.multiplyScalar(1.08);
    g.position.set(x, this.ms.heightAt(x, z), z);
    this.ms.scene.add(g);
    this.devils.push({ ...dv, r1, g, mats: [core.material, outer.material, skirt.material] });
  }

  // dt real; running = la simulacion avanza; p = {x, z} del jugador; hour = hora local; day = 0..1 (luz)
  update(dt, { running, x, z, hour, day, now }) {
    const ms = this.ms, s = this.game.s;
    // rafagas: paseo aleatorio lento (lo comparten el sonido y las particulas). Solo avanza con la simulacion
    // en marcha: en pausa no se consumen numeros del generador.
    if (running) this.gust = clamp(this.gust + (this.rnd - 0.5) * dt * 2.2 - (this.gust - 0.25) * dt * 0.35, 0, 1);
    const light = 0.3 + 0.7 * day;
    if (running) this.clock += dt;

    // ---- tormenta regional ----------------------------------------------------------------------
    const S = this.storm;
    const speActive = s.spe && s.spe.phase !== "ended";
    if (running && S.phase === "none" && !this.forecastSaid && this.clock > this.nextStorm - FORECAST_LEAD && !speActive) { this.forecastSaid = true; this._alert("forecast"); }
    if (running && S.phase === "none" && this.clock > this.nextStorm && !speActive) this.startStorm();
    if (S.phase === "none" && speActive && this.nextStorm - this.clock < 30) this.nextStorm = this.clock + 30;   // la tormenta solar va primero
    if (S.phase !== "none" && running) {
      S.t += dt;
      const D = STORM_D;
      if (S.t > D[S.phase]) {
        S.t = 0;
        S.phase = { approach: "front", front: "peak", peak: "clearing", clearing: "none" }[S.phase];
        if (S.phase === "front") this._alert("front");
        if (S.phase === "clearing") this._alert("clearing");
        if (S.phase === "none") { this.nextStorm = this.clock + (420 + this.rnd * 300) * (this.game.diff?.stormK ?? 1); this.forecastSaid = false; }
      }
      const target = stormTarget(S.phase, S.t, this.clock, this.gust);
      S.level += (target - S.level) * Math.min(1, dt * 1.5);
    } else if (S.phase === "none") S.level += (0 - S.level) * Math.min(1, dt * 0.5);
    S.tau = 0.6 + 3.6 * S.level;
    this.game.dustLevel = S.level;
    if (Math.abs(S.level - (this._lastLv ?? -1)) > 0.004) { ms.setStorm(S.level * 0.95); this._lastLv = S.level; }

    // muro de polvo: se acerca durante la aproximacion y te alcanza al empezar el frente
    const W = this.wall;
    if (S.phase === "approach" || (S.phase === "front" && S.t < 8)) {
      const u = S.phase === "approach" ? S.t / 45 : 1 + S.t / 8;
      const r = Math.max(40, 4200 * (1 - smooth(0, 1.15, u)));
      // la base queda 400 m por debajo del jugador: el frente sale siempre de detras del relieve y no flota
      const H = 1400 * (0.6 + 0.4 * smooth(0, 0.6, u)) + 400;
      W.visible = true;
      this.frontR = r;
      W.scale.set(r, H, r);
      W.position.set(x, ms.heightAt(x, z) - 400 + H / 2, z);
      W.material.uniforms.uNear.value = smooth(0.35, 1.0, u);
      W.material.uniforms.uFog.value.copy(ms.fogColor);
      // el arco (2,4 rad) mira hacia barlovento (de donde viene el viento)
      W.rotation.y = Math.atan2(-this.windDir.x, -this.windDir.z) - 1.2;
      W.material.uniforms.uAlpha.value = smooth(0, 0.25, u) * (1 - smooth(1.4, 2, u));
      W.material.uniforms.uTime.value = now;
      W.material.uniforms.uLight.value = light;
    } else { W.visible = false; this.frontR = null; }

    // efectos en el traje (solo fuera de un refugio): polvo en el visor, algo de desgaste y mas consumo
    // El rover es un refugio parcial (no presurizado): al volante el parabrisas y la carroceria paran la mayor
    // parte del polvo, y el traje se conecta a su bateria; agachado junto a el (a sotavento) tambien protege algo
    const outside = !s.inShelter;
    let cover = 0;
    if (s.driving) cover = 0.7;
    else if (s.car) {
      const dx = x - s.car.x, dz = z - s.car.z, dc = Math.hypot(dx, dz);
      if (dc < 3.4) cover = (dx * this.windDir.x + dz * this.windDir.z) / (dc || 1) > -0.2 ? 0.55 : 0.3;
    }
    this.cover = cover;
    // (el desgaste del traje y el gasto extra de bateria por el polvo los aplica Game con el nucleo compartido,
    //  gameplay/simcore.js -> dustDeltas, respetando los bloqueos de gasto del modo libre)
    if (running && outside && S.level > 0.05) this.visor = Math.min(0.8, this.visor + S.level * 0.011 * (1 - cover) * dt);
    if (!outside) this.visor = Math.max(0, this.visor - dt * 0.5);       // dentro se limpia
    else this.visor = Math.max(0, this.visor - dt * 0.002);

    // ---- remolinos de polvo ----------------------------------------------------------------------
    const h = ((hour % 24) + 24) % 24;
    // de dia, con un maximo hacia las 13 h (cuando el suelo esta mas caliente que el aire); de noche no hay
    const devilHours = h > 9.5 && h < 18.5 && S.level < 0.3;
    const peak = Math.max(0.25, 1 - Math.abs(h - 13) / 5.5);
    if (running && devilHours && this.clock > this.nextDevil && this.devils.length < 3) {
      this.nextDevil = this.clock + (18 + this.rnd * 28) / peak;
      if (this.firstDevil) { this.firstDevil = false; this._spawnDevilInView(x, z); }
      else this._spawnDevil(x, z);
    }
    let near = 0;
    for (let i = this.devils.length - 1; i >= 0; i--) {
      const dv = this.devils[i];
      if (running) dv.age += dt;
      if (!devilHours && dv.life > dv.age + 12) dv.life = dv.age + 12;     // al caer la tarde o con tormenta se deshacen
      const fade = smooth(0, 8, dv.age) * (1 - smooth(dv.life - 12, dv.life, dv.age));
      if (dv.age > dv.life || !this.game.world.inside(dv.x, dv.z, 30)) { ms.scene.remove(dv.g); dv.mats.forEach((m) => m.dispose()); this.devils.splice(i, 1); continue; }
      if (running) {
        // deriva con el viento y serpentea un poco
        const perpX = -this.windDir.z, perpZ = this.windDir.x, wob = Math.sin(dv.age * 0.23 + dv.seed) * 1.6;
        dv.x += (this.windDir.x * dv.speed + perpX * wob) * dt;
        dv.z += (this.windDir.z * dv.speed + perpZ * wob) * dt;
      }
      dv.g.position.set(dv.x, ms.heightAt(dv.x, dv.z), dv.z);
      for (const m of dv.mats) { m.uniforms.uTime.value = now; m.uniforms.uAlpha.value = fade; m.uniforms.uLight.value = light; m.uniforms.uSway.value = dv.sway; }
      const dist = Math.hypot(dv.x - x, dv.z - z);
      near = Math.max(near, fade * clamp(1 - (dist - dv.r0) / 200, 0, 1));
      // al atravesarte: estatica y polvo en el visor; el empujon es minimo (poca densidad del aire)
      if (running && outside && dist < dv.r0 * 1.8 + 3 && fade > 0.4) {
        if (!dv.touched) {
          dv.touched = true;
          this.visor = Math.min(0.85, this.visor + 0.35 * (1 - this.cover));
          if (this.onStatic) this.onStatic();
          if (!this.saidForce) { this.saidForce = true; this._alert("devil"); }
        }
        const tx = -(z - dv.z) / (dist || 1), tz = (x - dv.x) / (dist || 1);    // empujon tangencial, muy suave
        s.vx += tx * 0.6 * dt; s.vz += tz * 0.6 * dt;
      }
    }
    this.devilNear = near;
  }

  // Texto corto para el HUD
  status() {
    const S = this.storm;
    const v = this.windSpeed, ve = earthEquivalent(v);
    return { phase: S.phase, tau: S.tau, wind: v, windEarth: ve, devils: this.devils.length, visor: this.visor };
  }
}
