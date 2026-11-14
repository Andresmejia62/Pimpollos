import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "../data.js";

// Astronauta. Usa public/models/astronaut.glb de M1 si existe; si no, un modelo low-poly de primitivas.
export class Astronaut {
  constructor(scene) {
    this.root = new THREE.Group();
    this.phase = 0;
    this.mixer = null;
    this._buildPlaceholder();
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

  _buildPlaceholder() {
    const suit = new THREE.MeshLambertMaterial({ color: "#eeeae4" });
    const dark = new THREE.MeshLambertMaterial({ color: "#3b3b40" });
    const visor = new THREE.MeshStandardMaterial({ color: "#c98a2a", metalness: 0.9, roughness: 0.15, emissive: "#3a2000" });
    const accent = new THREE.MeshLambertMaterial({ color: "#c1440e" });
    const g = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 6, 12), suit);
    torso.position.y = 1.2;
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.28), suit);
    pack.position.set(0, 1.28, 0.33);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.3), accent);
    stripe.position.set(0, 1.45, 0.33);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 14), suit);
    helmet.position.y = 1.72;
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14, -Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.3, Math.PI * 0.4), visor);
    face.position.set(0, 1.72, -0.06);
    face.rotation.y = Math.PI;
    const mkLimb = (r, len, mat) => {
      const pivot = new THREE.Group();
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat);
      m.position.y = -len / 2 - r;
      pivot.add(m);
      return pivot;
    };
    const legL = mkLimb(0.12, 0.55, suit), legR = mkLimb(0.12, 0.55, suit);
    legL.position.set(-0.15, 0.92, 0); legR.position.set(0.15, 0.92, 0);
    const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.3), dark); bootL.position.set(0, -0.84, -0.04); legL.add(bootL);
    const bootR = bootL.clone(); legR.add(bootR);
    const armL = mkLimb(0.09, 0.45, suit), armR = mkLimb(0.09, 0.45, suit);
    armL.position.set(-0.4, 1.45, 0); armR.position.set(0.4, 1.45, 0);
    g.add(torso, pack, stripe, helmet, face, legL, legR, armL, armR);
    g.traverse((o) => { o.castShadow = false; });
    this.parts = { legL, legR, armL, armR, torso };
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
    const moving = speed > 0.2;
    this.phase += dt * (moving ? 2.2 + speed * 0.35 : 0);
    const k = moving ? Math.min(1, speed / 5) : 0;
    const s = Math.sin(this.phase * Math.PI);
    p.legL.rotation.x = s * 0.6 * k;
    p.legR.rotation.x = -s * 0.6 * k;
    p.armL.rotation.x = -s * 0.45 * k;
    p.armR.rotation.x = s * 0.45 * k;
    this.body.position.y = Math.abs(Math.sin(this.phase * Math.PI)) * 0.35 * k;
  }
}
