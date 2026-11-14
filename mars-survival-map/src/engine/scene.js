import * as THREE from "three";
import { assetUrl } from "../data.js";

const MARS_HAZE = new THREE.Color("#c9a07a");
const DUST = new THREE.Color("#a8714a");

// Textura de detalle procedural (grano de arena y grava) para el suelo cercano
function detailTexture() {
  const s = 256;
  const data = new Uint8Array(s * s * 4);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const base = new Float32Array(s * s);
  for (let i = 0; i < s * s; i++) base[i] = rnd();
  // suavizado 3x3 + ruido fino: manchas de grava sobre arena
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let acc = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) acc += base[((y + dy + s) % s) * s + ((x + dx + s) % s)];
      const v = 0.55 * (acc / 25) + 0.45 * base[y * s + x];
      const g = Math.round(255 * Math.min(1, Math.max(0, (v - 0.5) * 2.2 + 0.5)));
      const i = (y * s + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, s, s, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

const TERRAIN_VS = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const TERRAIN_FS = /* glsl */ `
  uniform sampler2D uOptical;
  uniform sampler2D uOverlay;
  uniform sampler2D uDetail;
  uniform float uOverlayOn;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform vec3 uFlatColor;
  uniform float uUseFlat;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 base = mix(texture2D(uOptical, vUv).rgb, uFlatColor, uUseFlat);
    float d1 = texture2D(uDetail, vPosW.xz / 6.0).r;
    float d2 = texture2D(uDetail, vPosW.xz / 47.0).r;
    float dist = distance(cameraPosition, vPosW);
    float near = 1.0 - smoothstep(60.0, 600.0, dist);
    base *= mix(1.0, mix(0.78, 1.18, d1) * mix(0.9, 1.08, d2), near);
    vec3 n = normalize(vNormalW);
    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 col = base * (uAmbient + uSunColor * ndl);
    vec4 ov = texture2D(uOverlay, vUv);
    col = mix(col, ov.rgb, ov.a * uOverlayOn * 0.85);
    float f = 1.0 - exp(-dist * uFogDensity);
    col = mix(col, uFogColor, clamp(f, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const SKY_VS = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;
const SKY_FS = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -0.05, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
    float s = max(dot(d, uSunDir), 0.0);
    col += vec3(0.75, 0.82, 0.95) * pow(s, 220.0) * 2.0;      // disco solar
    col += vec3(0.55, 0.62, 0.75) * pow(s, 18.0) * 0.35;      // halo azulado (dispersion en el polvo)
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class MarsScene {
  constructor(canvas, world, data) {
    this.world = world;
    this.data = data;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 30000);
    this.sunDir = new THREE.Vector3(0.4, 0.8, 0.2).normalize();
    this.textures = {};
    this.overlays = {};
    this._buildSky();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  async init(onProgress = () => {}) {
    const loader = new THREE.TextureLoader();
    const load = (p, srgb = true) => new Promise((res, rej) => loader.load(assetUrl(p), (t) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      res(t);
    }, undefined, rej));
    const names = ["slope", "radiation", "thermal", "spectral"];
    const [optical, ...ovs] = await Promise.all([load("layers/optical.png"), ...names.map((k) => load(`layers/${k}_overlay.png`))]);
    names.forEach((k, i) => { this.overlays[k] = ovs[i]; });
    this.textures.optical = optical;
    this.textures.detail = detailTexture();
    this.textures.empty = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    this.textures.empty.needsUpdate = true;
    onProgress(0.5);
    this._buildTerrain();
    onProgress(0.8);
    this._buildApron();
    this._buildRocks();
    this._buildRoute();
    onProgress(1);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- cielo y sol -----------------------------------------------------------
  _buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false,
      uniforms: { uSunDir: { value: this.sunDir }, uHorizon: { value: new THREE.Color("#d9ae86") }, uZenith: { value: new THREE.Color("#9c7158") } },
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 32, 16), this.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.scene.add(sky);
  }

  setTimeOfDay(hour) {
    // Sol a lat -4,8: sale por el este (~6 h), cenit cerca del mediodia, se pone al oeste (~18 h)
    const u = (hour - 6) / 12;
    const el = Math.sin(Math.PI * Math.min(Math.max(u, 0), 1)) * 1.25 + (u < 0 || u > 1 ? -0.2 : 0);
    // hemisferio sur cerca del ecuador: el sol pasa por el norte (E -> N -> O)
    const az = Math.PI / 2 - Math.PI * Math.min(Math.max(u, 0), 1);
    const y = Math.sin(el), c = Math.cos(el);
    // x = Este, z = Sur: azimut desde el norte en sentido horario
    this.sunDir.set(Math.sin(az) * c, Math.max(y, 0.04), -Math.cos(az) * c).normalize();
    const day = Math.min(1, Math.max(0, y * 2.5));
    if (this.terrainMat) {
      this.terrainMat.uniforms.uSunColor.value.setRGB(1.25 * day, 1.12 * day, 0.98 * day);
      this.terrainMat.uniforms.uAmbient.value.setRGB(0.32 + 0.18 * day, 0.24 + 0.14 * day, 0.2 + 0.1 * day);
    }
    this.skyMat.uniforms.uHorizon.value.set("#d9ae86").multiplyScalar(0.35 + 0.65 * day);
    this.skyMat.uniforms.uZenith.value.set("#9c7158").multiplyScalar(0.25 + 0.75 * day);
  }

  // ---- terreno ---------------------------------------------------------------
  _buildTerrain() {
    const w = this.world;
    const S = 767; // segmentos: 768 vertices por lado (~8 m)
    this.seg = S;
    this.step = w.size / S;
    const geo = new THREE.PlaneGeometry(w.size, w.size, S, S);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    this.mh = new Float32Array((S + 1) * (S + 1));
    for (let i = 0; i < pos.count; i++) {
      const y = w.demHeight(pos.getX(i), pos.getZ(i));
      pos.setY(i, y);
      this.mh[i] = y;
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    this.terrainMat = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS,
      uniforms: {
        uOptical: { value: this.textures.optical }, uOverlay: { value: this.textures.empty }, uDetail: { value: this.textures.detail },
        uOverlayOn: { value: 0 }, uSunDir: { value: this.sunDir }, uSunColor: { value: new THREE.Color(1.2, 1.1, 0.95) },
        uAmbient: { value: new THREE.Color(0.45, 0.35, 0.28) }, uFogColor: { value: MARS_HAZE }, uFogDensity: { value: 0.00016 },
        uFlatColor: { value: DUST }, uUseFlat: { value: 0 },
      },
    });
    this.terrain = new THREE.Mesh(geo, this.terrainMat);
    this.scene.add(this.terrain);
  }

  // Altura exacta de la malla (misma triangulacion que PlaneGeometry): los pies tocan el suelo
  heightAt(x, z) {
    const S = this.seg, st = this.step, half = this.world.half;
    const u = Math.min(S - 1e-4, Math.max(0, (x + half) / st));
    const v = Math.min(S - 1e-4, Math.max(0, (z + half) / st));
    const ix = Math.floor(u), iz = Math.floor(v);
    const fx = u - ix, fz = v - iz;
    const W = S + 1, h = this.mh;
    const a = h[iz * W + ix], b = h[(iz + 1) * W + ix], c = h[(iz + 1) * W + ix + 1], d = h[iz * W + ix + 1];
    if (fx + fz <= 1) return a + (d - a) * fx + (b - a) * fz;
    return c + (b - c) * (1 - fx) + (d - c) * (1 - fz);
  }

  // Terreno lejano de baja resolucion fuera del recorte (extiende los bordes hacia el horizonte)
  _buildApron() {
    const w = this.world, R = 26000, S = 160;
    const geo = new THREE.PlaneGeometry(R, R, S, S);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const lim = w.half - 4;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const cx = Math.max(-lim, Math.min(lim, x)), cz = Math.max(-lim, Math.min(lim, z));
      const out = Math.hypot(x - cx, z - cz);
      // el monte sigue subiendo hacia el sur; el resto baja suavemente hacia la planicie
      const trend = z > lim ? out * 0.12 : -out * 0.03;
      pos.setY(i, w.demHeight(cx, cz) + trend - 3 - Math.sin(x * 0.0021) * Math.cos(z * 0.0017) * 40 * Math.min(1, out / 1500));
    }
    geo.computeVertexNormals();
    const mat = this.terrainMat.clone();
    mat.uniforms = THREE.UniformsUtils.clone(this.terrainMat.uniforms);
    mat.uniforms.uSunDir.value = this.sunDir;
    mat.uniforms.uSunColor = this.terrainMat.uniforms.uSunColor;
    mat.uniforms.uAmbient = this.terrainMat.uniforms.uAmbient;
    mat.uniforms.uUseFlat.value = 1;
    mat.uniforms.uDetail.value = this.textures.detail;
    mat.uniforms.uOverlay.value = this.textures.empty;
    this.apron = new THREE.Mesh(geo, mat);
    this.scene.add(this.apron);
  }

  setOverlay(layer) {
    const tex = layer ? this.overlays[layer] : null;
    this.terrainMat.uniforms.uOverlay.value = tex || this.textures.empty;
    this.terrainMat.uniforms.uOverlayOn.value = tex ? 1 : 0;
  }

  // ---- rocas decorativas alrededor del jugador ------------------------------
  _buildRocks() {
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({ color: "#8a5638" });
    this.rockMax = 2200;
    this.rocks = new THREE.InstancedMesh(geo, mat, this.rockMax);
    this.rocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rocks.count = 0;
    this.rocks.frustumCulled = false;
    this.scene.add(this.rocks);
    this.rockCell = null;
    // luces solo para las rocas y los modelos (el terreno usa su propio shader)
    this.hemi = new THREE.HemisphereLight("#e8c3a0", "#5a3826", 1.1);
    this.sun = new THREE.DirectionalLight("#fff1dc", 2.2);
    this.scene.add(this.hemi, this.sun);
  }

  updateRocks(px, pz) {
    const CELL = 40, RAD = 6;
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    const key = cx + "," + cz;
    if (key === this.rockCell) return;
    this.rockCell = key;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    let k = 0;
    for (let gz = cz - RAD; gz <= cz + RAD; gz++) {
      for (let gx = cx - RAD; gx <= cx + RAD; gx++) {
        let seed = ((gx * 73856093) ^ (gz * 19349663)) >>> 0;
        const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
        const count = 6 + Math.floor(rnd() * 10);
        for (let i = 0; i < count && k < this.rockMax; i++) {
          const x = (gx + rnd()) * CELL, z = (gz + rnd()) * CELL;
          if (!this.world.inside(x, z, 10)) continue;
          const big = rnd() < 0.08;
          const r = big ? 0.7 + rnd() * 1.1 : 0.12 + rnd() * 0.4;
          p.set(x, this.heightAt(x, z) + r * 0.25, z);
          e.set(rnd() * 3, rnd() * 3, rnd() * 3);
          q.setFromEuler(e);
          s.set(r * (0.8 + rnd() * 0.6), r * (0.45 + rnd() * 0.4), r * (0.8 + rnd() * 0.6));
          m.compose(p, q, s);
          this.rocks.setMatrixAt(k, m);
          col.setHSL(0.055 + rnd() * 0.03, 0.42 + rnd() * 0.15, 0.24 + rnd() * 0.14);
          this.rocks.setColorAt(k, col);
          k++;
        }
      }
    }
    this.rocks.count = k;
    this.rocks.instanceMatrix.needsUpdate = true;
    if (this.rocks.instanceColor) this.rocks.instanceColor.needsUpdate = true;
  }

  // ---- marcadores, estructuras y ruta ---------------------------------------
  addBeacon(x, z, color, radius, tall = 380) {
    const y = this.heightAt(x, z);
    const g = new THREE.Group();
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } },
      vertexShader: "varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ",
      fragmentShader: "uniform vec3 uColor; uniform float uTime; varying float vY; void main(){ float a = (1.0 - vY) * (0.35 + 0.1*sin(uTime*2.0)); gl_FragColor = vec4(uColor * a, a); }",
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, tall, 16, 1, true), beamMat);
    beam.position.set(x, y + tall / 2, z);
    g.add(beam);
    // anillo que sigue el terreno (radio de escaneo)
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const px = x + Math.cos(a) * radius, pz = z + Math.sin(a) * radius;
      pts.push(new THREE.Vector3(px, this.heightAt(px, pz) + 0.25, pz));
    }
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
    g.add(ring);
    g.userData = { beamMat };
    this.scene.add(g);
    return g;
  }

  addStructure(kind, x, z) {
    const y = this.heightAt(x, z);
    const g = new THREE.Group();
    const white = new THREE.MeshLambertMaterial({ color: "#e9e4dc" });
    const grey = new THREE.MeshLambertMaterial({ color: "#7d7a76" });
    const gold = new THREE.MeshLambertMaterial({ color: "#d39b3a", emissive: "#3a2400" });
    if (kind === "base") {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), white);
      g.add(dome);
      for (let i = 0; i < 3; i++) {
        const mod = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 9, 16), white);
        mod.rotation.z = Math.PI / 2;
        mod.rotation.y = (i * Math.PI * 2) / 3;
        mod.position.set(Math.cos((i * Math.PI * 2) / 3) * 10, 2.2, -Math.sin((i * Math.PI * 2) / 3) * 10);
        g.add(mod);
      }
      const panel = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 4), new THREE.MeshLambertMaterial({ color: "#1f2b45" }));
      panel.position.set(-16, 1.6, 6); panel.rotation.x = -0.3;
      g.add(panel);
    } else if (kind === "rover") {
      const body = new THREE.Mesh(new THREE.BoxGeometry(5, 2.2, 3), white);
      body.position.y = 1.9;
      g.add(body);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 2.8), gold);
      cab.position.set(2.6, 2.4, 0);
      g.add(cab);
      for (let i = 0; i < 6; i++) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.5, 14), grey);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(-1.8 + (i % 3) * 1.8, 0.6, i < 3 ? 1.7 : -1.7);
        g.add(wheel);
      }
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6), grey);
      mast.position.set(-1.6, 4, 0.8);
      g.add(mast);
    }
    g.position.set(x, y, z);
    this.scene.add(g);
    return g;
  }

  addShelterModule(x, z) {
    const y = this.heightAt(x, z);
    const g = new THREE.Group();
    const white = new THREE.MeshLambertMaterial({ color: "#e6e0d6" });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 12, 20), white);
    m.rotation.z = Math.PI / 2;
    m.position.y = 3;
    g.add(m);
    const lock = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2, 16), white);
    lock.position.set(0, 3, 3.6); lock.rotation.x = Math.PI / 2;
    g.add(lock);
    g.position.set(x, y, z);
    this.scene.add(g);
    return g;
  }

  _buildRoute() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 2000), 3));
    geo.setDrawRange(0, 0);
    this.routeLine = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: "#3DDC97", dashSize: 6, gapSize: 4, transparent: true, opacity: 0.95, depthTest: true }));
    this.routeLine.frustumCulled = false;
    this.scene.add(this.routeLine);
  }

  setRoute(points) {
    const attr = this.routeLine.geometry.attributes.position;
    const n = Math.min(points.length, 2000);
    for (let i = 0; i < n; i++) {
      const [x, z] = points[i];
      attr.setXYZ(i, x, this.heightAt(x, z) + 1.2, z);
    }
    attr.needsUpdate = true;
    this.routeLine.geometry.setDrawRange(0, n);
    this.routeLine.computeLineDistances();
  }

  setRouteVisible(v) { this.routeLine.visible = v; }

  render(time) {
    this.sun.position.copy(this.sunDir).multiplyScalar(100).add(this.camera.position);
    this.sun.target.position.copy(this.camera.position);
    this.sun.target.updateMatrixWorld();
    this.scene.traverse((o) => { if (o.userData && o.userData.beamMat) o.userData.beamMat.uniforms.uTime.value = time; });
    this.renderer.render(this.scene, this.camera);
  }
}
