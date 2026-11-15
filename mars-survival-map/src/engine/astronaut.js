import * as THREE from "three";
import { markAnimated, mergeChildren } from "./merge.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "../data.js";

const lerp = (a, b, k) => a + (b - a) * k;

// Opciones de personalizacion del traje (pantalla de perfil). Solo cambian el aspecto, no la fisiologia.
const L = (es, en) => ({ es, en });
export const LOOK_OPTIONS = {
  suit: {
    white: { hex: "#efebe3", name: L("Blanco EVA", "EVA white") },
    ivory: { hex: "#e4d6bd", name: L("Marfil", "Ivory") },
    gray: { hex: "#a9adb5", name: L("Gris lunar", "Lunar gray") },
    sand: { hex: "#c99a6e", name: L("Arena marciana", "Mars sand") },
    graphite: { hex: "#45484f", name: L("Grafito", "Graphite") },
  },
  accent: {
    orange: { hex: "#d4541c", name: L("Naranja de mision", "Mission orange") },
    blue: { hex: "#2f7de1", name: L("Azul", "Blue") },
    red: { hex: "#c8242e", name: L("Rojo", "Red") },
    green: { hex: "#2e9e5a", name: L("Verde", "Green") },
    yellow: { hex: "#e6b422", name: L("Amarillo", "Yellow") },
    purple: { hex: "#7a4bd1", name: L("Violeta", "Violet") },
  },
  visor: {
    gold: { hex: "#e0a437", emissive: "#6b3d06", name: L("Dorada (filtro solar)", "Gold (sun filter)") },
    silver: { hex: "#c9d2dc", emissive: "#3a4450", name: L("Plateada", "Silver") },
    blue: { hex: "#4f86c9", emissive: "#0f2b4f", name: L("Azul", "Blue") },
    amber: { hex: "#c8662a", emissive: "#4a1a05", name: L("Ambar", "Amber") },
    clear: { hex: "#cfe6ff", emissive: "#000000", clear: true, name: L("Transparente (se ve la cara)", "Clear (face visible)") },
  },
  skin: {
    s1: { hex: "#f1d0b5" }, s2: { hex: "#e0ac85" }, s3: { hex: "#c68a5e" },
    s4: { hex: "#9a6440" }, s5: { hex: "#6b4128" }, s6: { hex: "#45291a" },
  },
};
export const DEFAULT_LOOK = { suit: "white", accent: "orange", visor: "gold", skin: "s3", lamps: true, antenna: true, crest: true };
export function sanitizeLook(l = {}) {
  const pick = (k) => (LOOK_OPTIONS[k][l[k]] ? l[k] : DEFAULT_LOOK[k]);
  const flag = (k) => (typeof l[k] === "boolean" ? l[k] : DEFAULT_LOOK[k]);
  return { suit: pick("suit"), accent: pick("accent"), visor: pick("visor"), skin: pick("skin"), lamps: flag("lamps"), antenna: flag("antenna"), crest: flag("crest") };
}

// Gestos cotidianos (emotes). dur = segundos; loop = se mantiene hasta que el jugador se mueve.
export const EMOTES = {
  wave: { key: "z", dur: 2.8, name: L("Saludar", "Wave") },
  thumbs: { key: "x", dur: 2.2, name: L("Pulgar arriba", "Thumbs up") },
  sit: { key: "c", loop: true, name: L("Sentarse", "Sit down") },
  dance: { key: "v", dur: 7, name: L("Bailar", "Dance") },
  stretch: { key: "b", dur: 3.4, name: L("Estirarse", "Stretch") },
  // solo para EVA-2 herido (sin tecla): sentado con la pierna danada estirada y las manos en la rodilla
  hurt: { loop: true, name: L("Herido", "Injured") },
};

// Astronauta. Usa public/models/astronaut.glb de M1 si existe; si no, un traje EVA articulado hecho con primitivas.
// El modelo mira hacia -Z (igual que el rumbo del juego) y mide ~1,9 m con los pies en y = 0.
export class Astronaut {
  // opts.accent: color de las franjas del traje (EVA-2 lleva otro color para distinguirlo)
  constructor(scene, opts = {}) {
    this.opts = opts;
    this.root = new THREE.Group();
    this.phase = 0;
    this.gait = 0;     // 0 parado .. 1 a paso completo (suavizado)
    this.clock = 0;
    this.mixer = null;
    this._buildSuit();
    scene.add(this.root);
  }

  async tryLoadModel() {
    try {
      const head = await fetch(assetUrl("models/astronaut.glb"), { method: "HEAD" });
      if (!head.ok || !(head.headers.get("content-type") || "").match(/gltf|octet|model/)) return false;
      const gltf = await new GLTFLoader().loadAsync(assetUrl("models/astronaut.glb"));
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const h = box.max.y - box.min.y || 1;
      model.scale.setScalar(1.85 / h);
      model.position.y = -box.min.y * (1.85 / h);
      this.root.remove(this.body);
      this.root.add(model);
      this.body = model;
      this.parts = null;
      if (gltf.animations.length) {
        this.mixer = new THREE.AnimationMixer(model);
        this.actions = Object.fromEntries(gltf.animations.map((a) => [a.name.toLowerCase(), this.mixer.clipAction(a)]));
        (this.actions.idle || Object.values(this.actions)[0]).play();
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  _buildSuit() {
    const std = (color, roughness = 0.85, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    const M = {
      suit: std("#efebe3", 0.82),
      fabric: std("#9a9ca3", 0.95),            // fuelles de las articulaciones
      dark: std("#2c2e34", 0.9),
      sole: std("#55585f", 0.95),
      accent: std(this.opts.accent || "#d4541c", 0.7),
      metal: std("#c3c7cf", 0.35, 0.75),
      // sin mapa de entorno un metal puro se veria negro: el dorado sale de un emisivo suave
      visor: std("#e0a437", 0.16, 0.55, { emissive: "#6b3d06", emissiveIntensity: 0.75 }),
      visorRim: std("#1c1d21", 0.6, 0.3),
      lamp: std("#fff6de", 0.4, 0, { emissive: "#fff1c8", emissiveIntensity: 1.6 }),
      led: std("#3ddc97", 0.4, 0, { emissive: "#3ddc97", emissiveIntensity: 2.2 }),
      ledRed: std("#ff4d4d", 0.4, 0, { emissive: "#ff4d4d", emissiveIntensity: 2.2 }),
      panel: std("#22252c", 0.5, 0.2),
    };
    const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
    const capsule = (r, len, mat) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat);
    const g = new THREE.Group();

    // ---- torso (pivota en la cintura) ---------------------------------------------------
    const torso = new THREE.Group();
    torso.position.y = 0.98;
    const pelvis = mesh(new THREE.SphereGeometry(0.25, 16, 12), M.suit, 0, 0.0, 0);
    pelvis.scale.set(1.05, 0.72, 0.85);
    const belt = mesh(new THREE.TorusGeometry(0.235, 0.03, 8, 24), M.metal, 0, 0.1, 0);
    belt.rotation.x = Math.PI / 2;
    belt.scale.set(1.05, 0.85, 1);
    const chest = capsule(0.265, 0.3, M.suit);
    chest.position.y = 0.36;
    chest.scale.set(1.16, 1, 0.88);
    // franjas naranjas de mision en los hombros
    const yoke = mesh(new THREE.TorusGeometry(0.262, 0.022, 8, 28), M.accent, 0, 0.5, 0);
    yoke.rotation.x = Math.PI / 2;
    yoke.scale.set(1.16, 0.88, 1);
    const neck = mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.08, 24), M.metal, 0, 0.67, 0);
    // unidad de control del pecho
    const dcm = mesh(new THREE.BoxGeometry(0.27, 0.19, 0.1), M.suit, 0, 0.35, -0.255);
    const dcmFace = mesh(new THREE.BoxGeometry(0.22, 0.14, 0.012), M.panel, 0, 0.35, -0.308);
    const dcmLed = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.012), M.led, -0.07, 0.385, -0.316);
    const dcmLed2 = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.012), M.ledRed, -0.025, 0.385, -0.316);
    const dcmKnob = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 10), M.metal, 0.06, 0.33, -0.318);
    dcmKnob.rotation.x = Math.PI / 2;
    const hose = mesh(new THREE.TorusGeometry(0.11, 0.016, 6, 16, Math.PI), M.fabric, 0.17, 0.3, -0.19);
    hose.rotation.set(0, Math.PI / 2, -Math.PI / 2);
    torso.add(pelvis, belt, chest, yoke, neck, dcm, dcmFace, dcmLed, dcmLed2, dcmKnob, hose);

    // ---- mochila de soporte vital ---------------------------------------------------------
    const pack = new THREE.Group();
    pack.position.set(0, 0.36, 0.33);
    const packBody = mesh(new THREE.BoxGeometry(0.5, 0.62, 0.24), M.suit);
    const packTop = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 14, 1, false, 0, Math.PI), M.suit, 0, 0.31, 0);
    packTop.rotation.z = Math.PI / 2;   // medio cilindro tumbado: remate redondeado
    const packStripe = mesh(new THREE.BoxGeometry(0.51, 0.055, 0.25), M.accent, 0, 0.17, 0);
    const radiator = mesh(new THREE.BoxGeometry(0.36, 0.3, 0.012), M.panel, 0, -0.1, 0.123);
    for (let i = 0; i < 4; i++) pack.add(mesh(new THREE.BoxGeometry(0.34, 0.012, 0.02), M.metal, 0, -0.21 + i * 0.07, 0.132));
    const tankGeo = new THREE.CapsuleGeometry(0.06, 0.36, 4, 10);
    const tankL = mesh(tankGeo, M.metal, -0.285, -0.05, 0), tankR = mesh(tankGeo, M.metal, 0.285, -0.05, 0);
    const mast = mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.5, 6), M.metal, 0.19, 0.62, 0.04);
    const mastTip = mesh(new THREE.SphereGeometry(0.022, 8, 6), M.ledRed, 0.19, 0.88, 0.04);
    pack.add(packBody, packTop, packStripe, radiator, tankL, tankR, mast, mastTip);
    torso.add(pack);

    // ---- casco -----------------------------------------------------------------------------
    const head = new THREE.Group();
    head.position.y = 0.86;
    const shell = mesh(new THREE.SphereGeometry(0.265, 28, 20), M.suit);
    shell.scale.set(1, 1.02, 1.04);
    // visera dorada: casquete centrado en -Z
    const W = Math.PI * 0.74;
    const visor = mesh(new THREE.SphereGeometry(0.274, 28, 18, Math.PI * 1.5 - W / 2, W, Math.PI * 0.26, Math.PI * 0.4), M.visor);
    visor.scale.set(1, 1.02, 1.04);
    const rim = mesh(new THREE.SphereGeometry(0.27, 28, 18, Math.PI * 1.5 - W / 2 - 0.07, W + 0.14, Math.PI * 0.26 - 0.05, Math.PI * 0.4 + 0.1), M.visorRim);
    rim.scale.set(1, 1.02, 1.04);
    const crest = mesh(new THREE.BoxGeometry(0.1, 0.035, 0.34), M.accent, 0, 0.262, 0.03);
    const lampGeo = new THREE.CylinderGeometry(0.035, 0.04, 0.07, 10);
    const lampL = mesh(lampGeo, M.fabric, -0.27, 0.07, -0.05), lampR = mesh(lampGeo, M.fabric, 0.27, 0.07, -0.05);
    lampL.rotation.x = lampR.rotation.x = Math.PI / 2;
    const beamGeo = new THREE.CircleGeometry(0.03, 10);
    const beamL = mesh(beamGeo, M.lamp, -0.27, 0.07, -0.087), beamR = mesh(beamGeo, M.lamp, 0.27, 0.07, -0.087);
    beamL.rotation.y = beamR.rotation.y = Math.PI;
    const camPod = mesh(new THREE.BoxGeometry(0.06, 0.05, 0.08), M.dark, 0.2, 0.2, -0.08);
    // cara (solo se ve con la visera transparente)
    const face = new THREE.Group();
    M.skin = std("#c68a5e", 0.7);
    const skull = mesh(new THREE.SphereGeometry(0.17, 20, 16), M.skin, 0, -0.01, -0.02);
    skull.scale.set(0.92, 1.08, 1);
    const eyeGeo = new THREE.SphereGeometry(0.018, 8, 6);
    const eyeL = mesh(eyeGeo, M.dark, -0.055, 0.02, -0.175), eyeR = mesh(eyeGeo, M.dark, 0.055, 0.02, -0.175);
    const nose = mesh(new THREE.SphereGeometry(0.022, 8, 6), M.skin, 0, -0.02, -0.185);
    const cap = mesh(new THREE.SphereGeometry(0.178, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.3), std("#2a2c31", 0.95), 0, 0.0, 0.03);
    // carcasa con ventana: sustituye a la esfera completa cuando la visera es transparente
    const T0 = Math.PI * 0.26, TL = Math.PI * 0.4, P0 = Math.PI * 1.5 - W / 2;
    const shellOpen = new THREE.Group();
    shellOpen.add(
      mesh(new THREE.SphereGeometry(0.265, 28, 20, P0 + W, Math.PI * 2 - W), M.suit),
      mesh(new THREE.SphereGeometry(0.265, 12, 6, P0, W, 0, T0), M.suit),
      mesh(new THREE.SphereGeometry(0.265, 12, 10, P0, W, T0 + TL, Math.PI - T0 - TL), M.suit));
    shellOpen.scale.set(1, 1.02, 1.04);
    shellOpen.visible = false;
    head.add(shellOpen);
    face.add(skull, eyeL, eyeR, nose, cap);
    face.visible = false;
    head.add(shell, rim, visor, crest, lampL, lampR, beamL, beamR, camPod, face);
    torso.add(head);

    // ---- brazos: hombro -> codo -> guante ----------------------------------------------------
    const mkArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.37, 0.5, 0);
      const joint = mesh(new THREE.SphereGeometry(0.125, 14, 10), M.fabric);
      const upper = capsule(0.092, 0.2, M.suit);
      upper.position.y = -0.2;
      const band = mesh(new THREE.CylinderGeometry(0.096, 0.096, 0.05, 14), side < 0 ? M.accent : M.panel, 0, -0.17, 0);
      const elbow = new THREE.Group();
      elbow.position.y = -0.36;
      const elbowJoint = mesh(new THREE.SphereGeometry(0.094, 12, 10), M.fabric);
      const fore = capsule(0.084, 0.18, M.suit);
      fore.position.y = -0.17;
      const cuff = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 14), M.metal, 0, -0.3, 0);
      const glove = mesh(new THREE.SphereGeometry(0.085, 12, 10), M.dark, 0, -0.385, -0.01);
      glove.scale.set(0.9, 1.15, 1.05);
      const thumb = mesh(new THREE.CapsuleGeometry(0.025, 0.04, 3, 6), M.dark, -side * 0.06, -0.37, -0.05);
      elbow.add(elbowJoint, fore, cuff, glove, thumb);
      if (side < 0) {
        // pantalla de muneca en el brazo izquierdo
        const pad = mesh(new THREE.BoxGeometry(0.035, 0.11, 0.09), M.panel, -0.085, -0.17, 0);
        const padGlow = mesh(new THREE.BoxGeometry(0.012, 0.08, 0.06), std("#7fd1ff", 0.4, 0, { emissive: "#7fd1ff", emissiveIntensity: 1.4 }), -0.105, -0.17, 0);
        elbow.add(pad, padGlow);
      }
      shoulder.add(joint, upper, band, elbow);
      shoulder.rotation.z = side * 0.1;
      torso.add(shoulder);
      return { shoulder, elbow };
    };
    const armL = mkArm(-1), armR = mkArm(1);

    // ---- piernas: cadera -> rodilla -> bota ----------------------------------------------------
    const mkLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.14, 0.95, 0);
      const thigh = capsule(0.125, 0.24, M.suit);
      thigh.position.y = -0.21;
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      const kneeJoint = mesh(new THREE.SphereGeometry(0.118, 12, 10), M.fabric);
      const kneePad = mesh(new THREE.BoxGeometry(0.15, 0.13, 0.05), M.suit, 0, 0, -0.105);
      const shin = capsule(0.105, 0.2, M.suit);
      shin.position.y = -0.2;
      const shinBand = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.04, 14), M.accent, 0, -0.3, 0);
      const boot = mesh(new THREE.BoxGeometry(0.2, 0.15, 0.34), M.dark, 0, -0.415, -0.04);
      const sole = mesh(new THREE.BoxGeometry(0.22, 0.045, 0.38), M.sole, 0, -0.488, -0.05);
      knee.add(kneeJoint, kneePad, shin, shinBand, boot, sole);
      hip.add(thigh, knee);
      g.add(hip);
      return { hip, knee };
    };
    const legL = mkLeg(-1), legR = mkLeg(1);

    g.add(torso);
    // solo las piezas grandes dan sombra (tornillos, franjas y luces no se ven en el mapa de sombras)
    g.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      o.castShadow = o.geometry.boundingSphere.radius >= 0.07;
    });
    this.parts = { torso, head, pack, armL, armR, legL, legR, mastTip, mast, face, shell, shellOpen, rim, crest, lamps: [lampL, lampR, beamL, beamR] };
    // piezas que se muestran u ocultan segun la apariencia: no se fusionan (engine/merge.js)
    for (const o of [mastTip, mast, face, shell, shellOpen, rim, crest, lampL, lampR, beamL, beamR]) if (o) o.userData.dynamic = true;
    this.M = M;
    this.body = g;
    this.root.add(g);
  }

  // Aplica la apariencia elegida en el perfil (colores del traje, visera, cara y accesorios)
  // Fusiona las piezas que se mueven juntas (menos llamadas de dibujo y de sombra). Recorre la marcha, el salto
  // y todos los gestos para detectar que nodos se animan, y deja al astronauta en reposo.
  optimize() {
    if (!this.parts || this._optimized) return null;
    this._optimized = true;
    const r = this.root;
    markAnimated(r, (i) => {
      const sp = [0, 1.2, 3, 6, 0.5, 2][i % 6];
      this.update(0.08, sp, 0, i % 3 ? 0 : 0.6, 0, i * 0.3, i % 3 === 0 ? 0.8 : 0, { grade: (i % 4) * 0.1, fatigue: (i % 5) / 5, load: 10 + i, chest: (i % 2) * 0.8, night: i % 2 });
      if (i === 5) this.land(4);
    }, 12);
    // gestos
    for (const name of Object.keys(EMOTES)) {
      const before = []; r.traverse((o) => before.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
      this.playEmote(name);
      for (let k = 0; k < 14; k++) this.update(0.12, 0, 0, 0, 0, 0, 0, {});
      for (const [o, p, q, sc] of before) if (o !== r && (p.distanceToSquared(o.position) > 1e-10 || Math.abs(q.dot(o.quaternion)) < 1 - 1e-7 || sc.distanceToSquared(o.scale) > 1e-10)) o.userData.animated = true;
      this.stopEmote();
      for (let k = 0; k < 30; k++) this.update(0.1, 0, 0, 0, 0, 0, 0, {});
      this.emote = null;
    }
    return mergeChildren(r, { minShadow: 0.1 });
  }

  setLook(look) {
    const l = sanitizeLook(look), O = LOOK_OPTIONS, M = this.M, p = this.parts;
    this.look = l;
    if (!M || !p) return;
    M.suit.color.set(O.suit[l.suit].hex);
    M.accent.color.set(this.opts.accent || O.accent[l.accent].hex);
    const v = O.visor[l.visor];
    M.visor.color.set(v.hex);
    M.visor.emissive.set(v.emissive);
    M.visor.transparent = !!v.clear;
    M.visor.opacity = v.clear ? 0.28 : 1;
    M.visor.depthWrite = !v.clear;
    M.visor.needsUpdate = true;
    M.skin.color.set(O.skin[l.skin].hex);
    p.face.visible = p.shellOpen.visible = !!v.clear;
    p.shell.visible = p.rim.visible = !v.clear;
    p.lamps.forEach((m) => (m.visible = l.lamps));
    p.mast.visible = p.mastTip.visible = l.antenna;
    p.crest.visible = l.crest;
  }

  // Complexion segun el perfil fisico: hombros y cintura algo mas anchos con mas IMC
  setBuild(mass, height) {
    const bmi = mass / (height / 100) ** 2;
    const w = Math.min(1.12, Math.max(0.9, Math.sqrt(bmi / 24.5)));
    this.root.scale.setScalar(height / 175);
    if (this.body) this.body.scale.set(w, 1, Math.sqrt(w));
  }

  // Empieza un gesto (o lo quita si es el mismo que ya esta en bucle). Devuelve true si empezo.
  playEmote(name) {
    if (!EMOTES[name] || !this.parts) return false;
    if (this.emote && this.emote.name === name && EMOTES[name].loop) { this.emote.ending = true; return false; }
    this.emote = { name, t: 0, w: this.emote ? this.emote.w : 0, ending: false };
    return true;
  }
  stopEmote() { if (this.emote) this.emote.ending = true; }

  // Mezcla la pose del gesto sobre la pose base (w = 0..1). Los brazos cuelgan hacia -y: rotation.x > 0 los
  // lleva hacia delante y rotation.z los abre hacia fuera (positivo en el derecho, negativo en el izquierdo).
  _applyEmote(dt, busy) {
    const e = this.emote, p = this.parts;
    if (!e) return;
    const def = EMOTES[e.name];
    e.t += dt;
    if (busy || (!def.loop && e.t > def.dur - 0.35)) e.ending = true;
    e.w = Math.max(0, Math.min(1, e.w + (e.ending ? -dt * (busy ? 9 : 3.5) : dt * 4)));
    if (e.ending && e.w <= 0) { this.emote = null; return; }
    const w = e.w * e.w * (3 - 2 * e.w), t = e.t;
    const set = (o, ax, v) => { o.rotation[ax] = lerp(o.rotation[ax], v, w); };
    const R = p.armR, Lf = p.armL;
    if (e.name === "wave") {
      set(R.shoulder, "z", 2.5); set(R.shoulder, "x", 0.1);
      set(R.elbow, "x", 0.5); set(R.elbow, "z", Math.sin(t * 8.5) * 0.55);
      set(p.torso, "z", -0.06); set(p.head, "y", 0); set(p.head, "z", 0.08);
    } else if (e.name === "thumbs") {
      set(R.shoulder, "x", 1.25); set(R.shoulder, "z", 0.25); set(R.elbow, "x", 1.05);
      set(p.head, "y", 0); set(p.head, "x", Math.max(0, Math.sin(t * 6)) * 0.18 * (t < 1.6 ? 1 : 0));
    } else if (e.name === "sit") {
      for (const leg of [p.legL, p.legR]) { set(leg.hip, "x", 1.9); set(leg.knee, "x", -2.0); }
      set(p.torso, "x", 0.22); set(p.torso, "y", 0);
      for (const a of [Lf, R]) { set(a.shoulder, "x", 0.95); set(a.elbow, "x", 0.55); }
      this.body.position.y = lerp(this.body.position.y, -0.56, w);
      set(p.head, "x", -0.12);
    } else if (e.name === "dance") {
      const b = t * 5.2, sw = Math.sin(b), sw2 = Math.sin(b * 0.5);
      set(p.torso, "y", sw2 * 0.45); set(p.torso, "z", sw * 0.08);
      set(R.shoulder, "z", 1.5 + sw * 0.6); set(R.elbow, "x", 1.0 + sw * 0.3);
      set(Lf.shoulder, "z", -1.5 + sw * 0.6); set(Lf.elbow, "x", 1.0 - sw * 0.3);
      set(p.legL.hip, "x", Math.max(0, sw) * 0.5); set(p.legL.knee, "x", -Math.max(0, sw) * 0.9);
      set(p.legR.hip, "x", Math.max(0, -sw) * 0.5); set(p.legR.knee, "x", -Math.max(0, -sw) * 0.9);
      set(p.head, "y", -sw2 * 0.3);
      // con el 38 % de gravedad cada saltito dura mas
      this.body.position.y = lerp(this.body.position.y, Math.abs(Math.sin(b * 0.5)) * 0.22, w);
    } else if (e.name === "hurt") {
      set(p.legL.hip, "x", 1.9); set(p.legL.knee, "x", -2.0);                 // pierna sana doblada
      set(p.legR.hip, "x", 1.5); set(p.legR.knee, "x", -0.15);                // pierna herida estirada
      set(p.torso, "x", 0.35 + Math.sin(t * 1.7) * 0.04); set(p.torso, "z", 0.06);
      for (const a of [Lf, R]) { set(a.shoulder, "x", 1.05); set(a.elbow, "x", 0.9); }
      set(R.shoulder, "z", 0.05); set(Lf.shoulder, "z", -0.25);
      this.body.position.y = lerp(this.body.position.y, -0.56, w);
      set(p.head, "x", 0.35); set(p.head, "y", Math.sin(t * 0.6) * 0.15);
    } else if (e.name === "stretch") {
      const u = Math.min(1, t / 1.1);
      for (const [a, sgn] of [[R, 1], [Lf, -1]]) { set(a.shoulder, "x", 2.9 * u); set(a.shoulder, "z", sgn * 0.35); set(a.elbow, "x", 0.15); }
      set(p.torso, "x", 0.16 * u + Math.sin(t * 2.2) * 0.03); set(p.head, "x", -0.2 * u); set(p.head, "y", 0);
      this.body.position.y = lerp(this.body.position.y, 0.05 * u, w);   // de puntillas
    }
  }

  // speed en m/s del mundo; el paso es un "salto" de baja gravedad (38 % de la terrestre)
  // air: metros sobre el suelo (0 = apoyado)
  // Golpe al aterrizar: las rodillas absorben el impacto (impact en m/s)
  land(impact) { this.squashV = (this.squashV || 0) + Math.min(3, impact * 0.4); }

  // opts: { grade (subida/avance), fatigue 0..1, load (kg ademas del traje), chest 0..1.4 (respiracion),
  //         night 0..1 (enciende las luces del casco) }
  update(dt, speed, x, y, z, heading, air = 0, opts = {}) {
    this.root.position.set(x, y, z);
    // giro suave hacia el rumbo (el juego cambia el rumbo de golpe) e inclinacion hacia la curva
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    if (this.yaw == null) this.yaw = heading;
    const dYaw = wrap(heading - this.yaw);
    this.yaw += dYaw * Math.min(1, dt * 11);
    this.root.rotation.y = this.yaw;
    if (this.mixer) {
      this.mixer.update(dt);
      return;
    }
    const p = this.parts;
    if (!p) return;
    this.clock += dt;
    const grade = Math.max(-0.6, Math.min(0.6, opts.grade || 0)), fat = Math.min(1, Math.max(0, opts.fatigue || 0));
    const load = opts.load || 0;
    const flying = air > 0.25;
    const moving = speed > 0.2 && !flying;
    this.gait = lerp(this.gait, moving ? Math.min(1, speed / 4.5) : 0, Math.min(1, dt * 6));
    this.fly = lerp(this.fly || 0, flying ? 1 : 0, Math.min(1, dt * 9));
    const k = this.gait, f = this.fly;
    // cadencia ligada a la velocidad sobre el suelo (los pies no patinan): en baja gravedad la zancada se alarga
    // y aparece una fase aerea ("lope" de las EVA lunares). phase avanza 1 por paso.
    const sc = this.root.scale.x || 1;
    const stepLen = (0.85 + 0.13 * speed) * sc * (1 - 0.25 * Math.max(0, grade)) * (1 - 0.15 * fat);
    const prev = this.phase;
    this.phase += dt * (moving ? speed / stepLen : 0.8 * k);
    if (moving && Math.floor(this.phase - 0.5) !== Math.floor(prev - 0.5) && this.onFootfall) this.onFootfall(Math.floor(this.phase) % 2 ? 1 : -1, speed);
    const a = this.phase * Math.PI;
    const s = Math.sin(a), c = Math.cos(a);
    const chest = opts.chest != null ? opts.chest : 0.3 + 0.3 * Math.sin(this.clock * 1.6);
    const swing = 0.62 * (1 - 0.3 * Math.max(0, grade)) * (1 - 0.2 * fat);

    // piernas: el muslo oscila y la rodilla se flexiona mientras la pierna avanza
    p.legL.hip.rotation.x = s * swing * k;
    p.legR.hip.rotation.x = -s * swing * k;
    p.legL.knee.rotation.x = -(0.08 + 0.85 * Math.max(0, c)) * k;
    p.legR.knee.rotation.x = -(0.08 + 0.85 * Math.max(0, -c)) * k;
    // brazos en contrafase, codos algo recogidos (el traje presurizado no deja estirarlos); con fatiga, menos braceo
    const arm = 0.5 * (1 - 0.45 * fat);
    p.armL.shoulder.rotation.x = -s * arm * k + 0.03 * chest * (1 - k);
    p.armR.shoulder.rotation.x = s * arm * k + 0.03 * chest * (1 - k);
    p.armL.elbow.rotation.x = 0.28 + 0.4 * k + 0.2 * Math.max(0, -s) * k;
    p.armR.elbow.rotation.x = 0.28 + 0.4 * k + 0.2 * Math.max(0, s) * k;
    // torso: se inclina hacia delante cuesta arriba y con carga, hacia atras cuesta abajo (frena), y respira
    const lean = (0.07 + 0.012 * speed) * k + grade * 0.75 * k + Math.min(0.12, load * 0.004) + 0.1 * fat;
    p.torso.rotation.x = -lean;
    p.torso.rotation.y = s * 0.09 * k;
    p.torso.rotation.z = c * 0.03 * k - Math.max(-0.12, Math.min(0.12, dYaw * 0.5)) * k;
    p.torso.position.y = 0.98 + 0.012 * chest * (1 - 0.6 * k);
    p.head.rotation.y = -s * 0.07 * k + Math.sin(this.clock * 0.45) * 0.22 * (1 - k);
    p.head.rotation.x = 0.06 * k + 0.16 * fat - grade * 0.25 * k;
    p.mastTip.material.emissiveIntensity = Math.sin(this.clock * 4) > 0.7 ? 3 : 0.3;   // baliza de la antena
    // luces del casco: se encienden al anochecer
    if (opts.night != null && this.M) {
      this.M.lamp.emissiveIntensity = 0.5 + 2.2 * opts.night;
      p.lamps[2].visible = p.lamps[3].visible = this.look ? this.look.lamps && opts.night > 0.15 : opts.night > 0.15;
    }
    // en el aire (salto o caida lenta de baja gravedad): piernas recogidas y brazos abiertos para equilibrarse
    if (f > 0.01) {
      p.legL.hip.rotation.x = lerp(p.legL.hip.rotation.x, 0.5, f);
      p.legR.hip.rotation.x = lerp(p.legR.hip.rotation.x, 0.15, f);
      p.legL.knee.rotation.x = lerp(p.legL.knee.rotation.x, -0.9, f);
      p.legR.knee.rotation.x = lerp(p.legR.knee.rotation.x, -0.5, f);
      p.armL.shoulder.rotation.x = lerp(p.armL.shoulder.rotation.x, 0.5, f);
      p.armR.shoulder.rotation.x = lerp(p.armR.shoulder.rotation.x, 0.5, f);
      p.torso.rotation.x = lerp(p.torso.rotation.x, -0.08, f);
    }
    p.armL.shoulder.rotation.z = -0.1 - 0.75 * f;
    p.armR.shoulder.rotation.z = 0.1 + 0.75 * f;
    p.armL.elbow.rotation.z = p.armR.elbow.rotation.z = 0;
    p.head.rotation.z = 0;
    // rebote del paso: en baja gravedad cada paso tiene una fase aerea (mas alta cuanto mas rapido)
    const bob = Math.min(0.26, 0.05 + 0.028 * speed) * k;
    // amortiguacion del aterrizaje: muelle sub-amortiguado sobre las rodillas
    this.squashV = (this.squashV || 0) + (-(this.squash || 0) * 140 - (this.squashV || 0) * 14) * dt;
    this.squash = Math.max(-0.05, Math.min(0.3, (this.squash || 0) + this.squashV * dt));
    const sq = Math.max(0, this.squash);
    this.body.position.y = Math.pow(Math.abs(s), 0.8) * bob * (1 - f) - sq;
    if (sq > 0.005) {
      p.legL.hip.rotation.x += sq * 2.2; p.legR.hip.rotation.x += sq * 2.2;
      p.legL.knee.rotation.x -= sq * 4; p.legR.knee.rotation.x -= sq * 4;
      p.torso.rotation.x -= sq * 1.2;
    }
    // cojera (EVA-2 tras el rescate): la pierna derecha apenas se dobla y el cuerpo se balancea hacia ella
    if (this.limp && k > 0.05) {
      p.legR.hip.rotation.x *= 0.35;
      p.legR.knee.rotation.x *= 0.25;
      p.torso.rotation.z += Math.max(0, -s) * 0.12 * k;
      this.body.position.y *= 0.55;
    }
    // baliza de emergencia: parpadeo rapido mientras esta herido
    if (this.distress) p.mastTip.material.emissiveIntensity = Math.sin(this.clock * 14) > 0 ? 4 : 0.2;
    // gestos: se cancelan al caminar o saltar ("hurt" no: lo controla el juego)
    this._applyEmote(dt, (moving || flying) && !(this.emote && this.emote.name === "hurt"));
  }
}
