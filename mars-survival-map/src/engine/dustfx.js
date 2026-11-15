import * as THREE from "three";
import { MARS } from "./physics.js";

// Polvo levantado por pisadas, saltos y aterrizajes, con la misma fisica para todos:
//  - granos gruesos: parabola balistica con la gravedad de Marte (3,72 m/s2), casi sin rozamiento del aire;
//  - polvo fino: se frena enseguida (Stokes), cae despacio y deriva con el mismo viento que las motas del escenario.
// El color sale del suelo que se pisa (clase mineral CRISM).
export const WIND = new THREE.Vector3(2.2, 0, 0.9);       // m/s, igual que las motas de polvo de scene.js
const SOIL = {
  0: [0.56, 0.36, 0.24],   // basalto / polvo
  1: [0.52, 0.38, 0.3],    // arcillas
  2: [0.66, 0.5, 0.36],    // sulfatos (mas claros)
  3: [0.7, 0.58, 0.46],    // vetas boxwork
  4: [0.3, 0.24, 0.22],    // arena basaltica oscura (dunas)
};

export class DustFX {
  constructor(ms, n = 420) {
    this.ms = ms; this.n = n; this.next = 0;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1); this.life = new Float32Array(n).fill(1);
    this.size = new Float32Array(n); this.col = new Float32Array(n * 3); this.fine = new Uint8Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("aAge", new THREE.BufferAttribute(this.age, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    g.setAttribute("aCol", new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: ms.dustMat.uniforms.uScale, uLight: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uScale; attribute float aAge; attribute float aSize; attribute vec3 aCol; varying float vA; varying vec3 vC;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uScale * aSize * (0.6 + 1.6 * aAge) / max(-mv.z, 0.3);
          vA = aAge >= 1.0 ? 0.0 : (1.0 - aAge) * smoothstep(0.0, 0.06, aAge);
          vC = aCol;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uLight; varying float vA; varying vec3 vC;
        void main() {
          float a = smoothstep(0.5, 0.05, length(gl_PointCoord - 0.5)) * vA * 0.85;
          // el polvo suspendido al sol se ve mas claro que el suelo del que sale
          gl_FragColor = vec4(min(vC * 1.35, vec3(1.0)) * uLight, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mat = mat;
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    ms.scene.add(this.points);
  }

  // x,y,z: punto de contacto; opts: { n, spread (m/s), up (m/s), soil (clase), size (m), fineFrac }
  puff(x, y, z, { n = 8, spread = 1.2, up = 1.2, soil = 0, size = 0.25, fineFrac = 0.5, dir = null } = {}) {
    const c = SOIL[soil] || SOIL[0];
    for (let k = 0; k < n; k++) {
      const i = (this.next = (this.next + 1) % this.n);
      const fine = Math.random() < fineFrac;
      const a = Math.random() * Math.PI * 2, sp = spread * (0.3 + Math.random() * 0.9);
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.2; this.pos[i * 3 + 1] = y + 0.04; this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.2;
      let vx = Math.cos(a) * sp, vz = Math.sin(a) * sp;
      if (dir) { vx += dir.x * spread * 0.8; vz += dir.z * spread * 0.8; }
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = up * (0.4 + Math.random() * 0.8); this.vel[i * 3 + 2] = vz;
      this.fine[i] = fine ? 1 : 0;
      this.life[i] = fine ? 2.2 + Math.random() * 1.6 : 0.7 + Math.random() * 0.5;
      this.age[i] = 0;
      this.size[i] = size * (fine ? 2.0 + Math.random() * 1.2 : 0.6 + Math.random() * 0.4);
      const shade = 0.85 + Math.random() * 0.25;
      this.col[i * 3] = c[0] * shade; this.col[i * 3 + 1] = c[1] * shade; this.col[i * 3 + 2] = c[2] * shade;
    }
  }

  update(dt, light = 1) {
    const g = MARS.g;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= 1) continue;
      this.age[i] = Math.min(1, this.age[i] + dt / this.life[i]);
      const j = i * 3;
      if (this.fine[i]) {
        // el polvo fino tiende rapido a la velocidad del viento y cae a su velocidad terminal (~0,3 m/s)
        const k = Math.min(1, dt * 3.5);
        this.vel[j] += (WIND.x - this.vel[j]) * k; this.vel[j + 2] += (WIND.z - this.vel[j + 2]) * k;
        this.vel[j + 1] += (-0.3 - this.vel[j + 1]) * k;
      } else {
        this.vel[j + 1] -= g * dt;                                   // balistico: casi no hay aire que lo frene
      }
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      // al tocar el suelo, el grano grueso se detiene
      if (!this.fine[i]) {
        const gy = this.ms.heightAt(this.pos[j], this.pos[j + 2]);
        if (this.pos[j + 1] < gy) { this.pos[j + 1] = gy; this.vel[j] = this.vel[j + 1] = this.vel[j + 2] = 0; this.age[i] = Math.max(this.age[i], 0.75); }
      }
    }
    this.mat.uniforms.uLight.value = light;
    const at = this.points.geometry.attributes;
    at.position.needsUpdate = at.aAge.needsUpdate = at.aSize.needsUpdate = at.aCol.needsUpdate = true;
  }
}
