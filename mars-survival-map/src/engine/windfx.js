import * as THREE from "three";
import { MARS } from "./physics.js";

// Particulas de viento alrededor del jugador, para ver por donde y con que fuerza sopla:
//  - rayas de polvo en suspension que viajan a la velocidad del viento (mas largas y densas con rafagas y tormenta);
//  - saltacion: granos de arena que saltan junto al suelo en arcos balisticos (g = 3,72 m/s2). En Marte los saltos
//    son mas largos y altos que en la Tierra; solo empiezan con rafagas fuertes (hace falta mas viento para mover
//    un grano con un aire tan poco denso).
const N_STREAK = 900, N_GRAIN = 700;
const BOX = { x: 46, y: 20, z: 46 };
const GR = { x: 24, z: 24 };

export class WindFX {
  constructor(ms) {
    this.ms = ms;
    this.p = new Float32Array(N_STREAK * 3);
    this.v = new Float32Array(N_STREAK);
    this.seg = new Float32Array(N_STREAK * 6);
    this.alpha = new Float32Array(N_STREAK * 2);
    for (let i = 0; i < N_STREAK; i++) {
      this.p[i * 3] = (Math.random() - 0.5) * 2 * BOX.x; this.p[i * 3 + 1] = Math.random() * BOX.y; this.p[i * 3 + 2] = (Math.random() - 0.5) * 2 * BOX.z;
      this.v[i] = 0.7 + Math.random() * 0.6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.seg, 3));
    g.setAttribute("aA", new THREE.BufferAttribute(this.alpha, 1));
    this.lineMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(0.78, 0.55, 0.38) }, uOp: { value: 0 } },
      vertexShader: /* glsl */ `attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uOp; varying float vA; void main(){ gl_FragColor = vec4(uColor, vA * uOp); }`,
    });
    this.lines = new THREE.LineSegments(g, this.lineMat);
    this.lines.frustumCulled = false; this.lines.renderOrder = 4;
    ms.scene.add(this.lines);
    // granos de arena
    this.gp = new Float32Array(N_GRAIN * 3); this.gv = new Float32Array(N_GRAIN * 3); this.ga = new Float32Array(N_GRAIN);
    this.rest = new Float32Array(N_GRAIN).fill(1);
    for (let i = 0; i < N_GRAIN; i++) { this.gp[i * 3] = (Math.random() - 0.5) * 2 * GR.x; this.gp[i * 3 + 2] = (Math.random() - 0.5) * 2 * GR.z; this.rest[i] = Math.random() * 2; }
    this.gWorld = new Float32Array(N_GRAIN * 3);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute("position", new THREE.BufferAttribute(this.gWorld, 3));
    gg.setAttribute("aA", new THREE.BufferAttribute(this.ga, 1));
    this.grainMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: ms.dustMat.uniforms.uScale, uColor: { value: new THREE.Color(0.55, 0.38, 0.27) }, uLight: { value: 1 } },
      vertexShader: /* glsl */ `uniform float uScale; attribute float aA; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = max(1.5, uScale * 0.05 / max(-mv.z, 0.3)); vA = aA; }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uLight; varying float vA;
        void main(){ float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5)) * vA; gl_FragColor = vec4(uColor * uLight, a); }`,
    });
    this.grains = new THREE.Points(gg, this.grainMat);
    this.grains.frustumCulled = false; this.grains.renderOrder = 4;
    ms.scene.add(this.grains);
    this.cx = 0; this.cz = 0;
  }

  // dir: direccion del viento (unitaria); speed m/s; gust 0..1; storm 0..1; inside: dentro de un interior
  update(dt, { cx, cy, cz, dir, speed, gust, storm, inside, light }) {
    const P = this.p, seg = this.seg, A = this.alpha;
    const turbT = performance.now() * 0.001;
    // las rayas siguen al viento; su densidad visible depende de rafagas y tormenta
    const vis = inside ? 0 : Math.min(0.75, 0.12 + gust * 0.25 + storm * 0.45);
    this.lineMat.uniforms.uOp.value += (vis - this.lineMat.uniforms.uOp.value) * Math.min(1, dt * 2);
    const len = Math.min(2.5, 0.4 + speed * 0.07) / Math.max(1, speed);  // largo de la raya: 0,5-2,5 m
    for (let i = 0; i < N_STREAK; i++) {
      const j = i * 3, k = this.v[i] * speed;
      const turb = Math.sin(turbT * 1.3 + i) * 0.6;
      P[j] += (dir.x * k + dir.z * turb) * dt; P[j + 1] += Math.sin(turbT * 0.9 + i * 0.37) * 0.4 * dt; P[j + 2] += (dir.z * k - dir.x * turb) * dt;
      // volver a entrar por el otro lado de la caja que rodea al jugador
      if (P[j] > BOX.x) P[j] -= 2 * BOX.x; else if (P[j] < -BOX.x) P[j] += 2 * BOX.x;
      if (P[j + 2] > BOX.z) P[j + 2] -= 2 * BOX.z; else if (P[j + 2] < -BOX.z) P[j + 2] += 2 * BOX.z;
      if (P[j + 1] > BOX.y) P[j + 1] -= BOX.y; else if (P[j + 1] < 0) P[j + 1] += BOX.y;
      const wx = cx + P[j], wz = cz + P[j + 2];
      const wy = this.ms.heightAt(wx, wz) + 0.3 + P[j + 1];
      seg[i * 6] = wx; seg[i * 6 + 1] = wy; seg[i * 6 + 2] = wz;
      seg[i * 6 + 3] = wx - dir.x * k * len; seg[i * 6 + 4] = wy; seg[i * 6 + 5] = wz - dir.z * k * len;
      // se desvanecen hacia los bordes de la caja y con la altura
      const edge = Math.min(1, (BOX.x - Math.abs(P[j])) / 10) * Math.min(1, (BOX.z - Math.abs(P[j + 2])) / 10);
      const a = edge * (1 - P[j + 1] / BOX.y * 0.6);
      A[i * 2] = a; A[i * 2 + 1] = 0;
    }
    const lg = this.lines.geometry.attributes;
    lg.position.needsUpdate = lg.aA.needsUpdate = true;

    // saltacion: solo con rafagas fuertes o tormenta
    const drive = inside ? 0 : Math.max(0, gust - 0.45) * 1.8 + storm * 1.2;
    const G = this.gp, V = this.gv, GA = this.ga, W = this.gWorld, g = MARS.g;
    // la caja de granos se mueve con el jugador: al desplazarse, los granos se recolocan por el otro lado
    const dxm = cx - this.cx, dzm = cz - this.cz;
    this.cx = cx; this.cz = cz;
    for (let i = 0; i < N_GRAIN; i++) {
      const j = i * 3;
      G[j] -= dxm; G[j + 2] -= dzm;
      if (G[j] > GR.x) G[j] -= 2 * GR.x; else if (G[j] < -GR.x) G[j] += 2 * GR.x;
      if (G[j + 2] > GR.z) G[j + 2] -= 2 * GR.z; else if (G[j + 2] < -GR.z) G[j + 2] += 2 * GR.z;
      if (this.rest[i] > 0) {
        this.rest[i] -= dt * (0.3 + drive * 2.5);
        GA[i] = 0; G[j + 1] = 0;
        if (this.rest[i] <= 0 && drive > 0.05) {
          // nuevo salto: sale despedido hacia arriba y a favor del viento
          const s = 0.6 + Math.random() * 0.8;
          V[j] = dir.x * (1.5 + speed * 0.12) * s; V[j + 1] = (0.8 + Math.random() * 1.2) * (0.6 + drive * 0.5); V[j + 2] = dir.z * (1.5 + speed * 0.12) * s;
          G[j + 1] = 0.01;
        } else if (this.rest[i] <= 0) this.rest[i] = 0.5 + Math.random();
      } else {
        V[j + 1] -= g * dt;
        G[j] += V[j] * dt; G[j + 1] += V[j + 1] * dt; G[j + 2] += V[j + 2] * dt;
        GA[i] = Math.min(1, drive) * 0.9;
        if (G[j + 1] <= 0) { G[j + 1] = 0; this.rest[i] = Math.random() * 0.6; GA[i] = 0; }
      }
      const wx = cx + G[j], wz = cz + G[j + 2];
      W[j] = wx; W[j + 1] = this.ms.heightAt(wx, wz) + 0.03 + G[j + 1]; W[j + 2] = wz;
    }
    this.grainMat.uniforms.uLight.value = light;
    const ga = this.grains.geometry.attributes;
    ga.position.needsUpdate = ga.aA.needsUpdate = true;
  }
}
