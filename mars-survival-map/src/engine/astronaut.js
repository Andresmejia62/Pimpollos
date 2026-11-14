import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "../data.js";

const lerp = (a, b, k) => a + (b - a) * k;

// Astronauta. Usa public/models/astronaut.glb de M1 si existe; si no, un traje EVA articulado hecho con primitivas.
// El modelo mira hacia -Z (igual que el rumbo del juego) y mide ~1,9 m con los pies en y = 0.
export class Astronaut {
  constructor(scene) {
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
      accent: std("#d4541c", 0.7),
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
    head.add(shell, rim, visor, crest, lampL, lampR, beamL, beamR, camPod);
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
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.parts = { torso, head, pack, armL, armR, legL, legR, mastTip };
    this.body = g;
    this.root.add(g);
  }

  // speed en m/s del mundo; el paso es un "salto" de baja gravedad (38 % de la terrestre)
  update(dt, speed, x, y, z, heading) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = heading;
    if (this.mixer) {
      this.mixer.update(dt);
      return;
    }
    const p = this.parts;
    if (!p) return;
    this.clock += dt;
    const moving = speed > 0.2;
    this.gait = lerp(this.gait, moving ? Math.min(1, speed / 5) : 0, Math.min(1, dt * 7));
    const k = this.gait;
    this.phase += dt * (2.2 + speed * 0.35) * (moving ? 1 : k);
    const a = this.phase * Math.PI;
    const s = Math.sin(a), c = Math.cos(a);
    const breathe = Math.sin(this.clock * 1.6);

    // piernas: el muslo oscila y la rodilla se flexiona mientras la pierna avanza
    p.legL.hip.rotation.x = s * 0.62 * k;
    p.legR.hip.rotation.x = -s * 0.62 * k;
    p.legL.knee.rotation.x = -(0.08 + 0.85 * Math.max(0, c)) * k;
    p.legR.knee.rotation.x = -(0.08 + 0.85 * Math.max(0, -c)) * k;
    // brazos en contrafase, codos algo recogidos (el traje presurizado no deja estirarlos)
    p.armL.shoulder.rotation.x = -s * 0.5 * k + 0.04 * breathe * (1 - k);
    p.armR.shoulder.rotation.x = s * 0.5 * k - 0.04 * breathe * (1 - k);
    p.armL.elbow.rotation.x = 0.28 + 0.4 * k + 0.2 * Math.max(0, -s) * k;
    p.armR.elbow.rotation.x = 0.28 + 0.4 * k + 0.2 * Math.max(0, s) * k;
    // torso: se inclina al avanzar, gira un poco con el paso y respira en reposo
    p.torso.rotation.x = -0.12 * k;
    p.torso.rotation.y = s * 0.09 * k;
    p.torso.rotation.z = c * 0.03 * k;
    p.torso.position.y = 0.98 + 0.006 * breathe * (1 - k);
    p.head.rotation.y = -s * 0.07 * k + Math.sin(this.clock * 0.45) * 0.22 * (1 - k);
    p.head.rotation.x = 0.06 * k;
    p.mastTip.material.emissiveIntensity = Math.sin(this.clock * 4) > 0.7 ? 3 : 0.3;   // baliza de la antena
    this.body.position.y = Math.abs(s) * 0.24 * k;
  }
}
