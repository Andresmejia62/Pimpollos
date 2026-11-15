// Cinematica de llegada (tras "Comenzar EVA"): el modulo de la expedicion cruza el espacio hacia Marte,
// entra en la atmosfera envuelto en plasma, falla el paracaidas y se estrella en el crater Gale.
//
//  1. Espacio (renderer propio): Marte con el relieve real de MOLA; Gale mira hacia la trayectoria de entrada.
//  2. Superficie (escena del juego): terreno real HiRISE+CTX; el modulo cae desde el cielo y se estrella a unos
//     600 m del habitat. El estruendo llega ~2,5 s despues del destello: en Marte el sonido va a ~240 m/s.
//  3. Tarjeta final con las coordenadas reales del impacto.
// Se puede saltar en cualquier momento (boton, Esc, Enter o Espacio).
import * as THREE from "three";
import { t, getLang } from "../i18n.js";
import { cine, sfx } from "../audio.js";
import { marsNow } from "../marsclock.js";
import { fmtLat, fmtLon, num } from "../geo.js";

const $ = (id) => document.getElementById(id);
const L = (es, en) => ({ es, en });
const D2R = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const MARS_R_KM = 3389.5, R = 10;                       // radio de Marte en unidades de la escena espacial

// Tiempos (s)
const T_SPACE = 7.2;          // fin de la parte en el espacio (destello de plasma)
const T_IMPACT = 10.4;        // impacto en la superficie
const SOUND_MPS = 240;        // velocidad del sonido en Marte (CO2 frio, ~240 m/s)

// ---- materiales aditivos -------------------------------------------------------------------
function glowMat(color, power = 1.5) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uI: { value: 1 }, uPow: { value: power }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uI, uPow, uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float along = pow(clamp(1.0 - vUv.y, 0.0, 1.0), uPow);                 // brillante en la base, se apaga hacia la punta
        float flick = 0.85 + 0.15 * sin(uTime * 40.0 + vUv.y * 20.0);
        float rim = 0.35 + 0.65 * pow(1.0 - abs(dot(vN, vV)), 1.2);
        float a = along * rim * flick * uI;
        gl_FragColor = vec4(mix(uColor, vec3(1.0, 0.97, 0.9), along * 0.6) * a, a);
      }`,
  });
}
function shellMat(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uI: { value: 0 } },
    vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uI; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 1.6); float a = (0.25 + f) * uI; gl_FragColor = vec4(mix(uColor, vec3(1.0,0.95,0.85), 0.3) * a, a); }`,
  });
}
function radialTexture(stops) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([o, col]) => grd.addColorStop(o, col));
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// ---- modulo de descenso: cohete con cofia, aletas, tobera, llama, plasma y estela -------------------
// Construido a lo largo de +Y (la punta hacia +Y), ~6 unidades de largo.
function buildRocket() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: "#eeeae2", roughness: 0.55, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: "#26282d", roughness: 0.6, metalness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: "#d4541c", roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: "#9aa0a8", roughness: 0.35, metalness: 0.85 });
  const add = (geo, mat, y, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.rotation.x = rx; g.add(m); return m; };
  add(new THREE.CylinderGeometry(0.5, 0.5, 4, 28), white, 0);
  add(new THREE.ConeGeometry(0.5, 1.7, 28), white, 2.85);
  add(new THREE.CylinderGeometry(0.505, 0.505, 0.18, 28), accent, 1.25);
  add(new THREE.CylinderGeometry(0.505, 0.505, 0.08, 28), dark, -0.6);
  for (let i = 0; i < 6; i++) { const w = add(new THREE.BoxGeometry(0.06, 0.32, 0.14), dark, 0.6); w.position.x = Math.cos(i) * 0.5; w.position.z = Math.sin(i) * 0.5; }   // ventanas
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.7), dark);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    f.position.set(Math.cos(a) * 0.72, -1.55, Math.sin(a) * 0.72);
    f.rotation.y = -a;
    g.add(f);
  }
  add(new THREE.CylinderGeometry(0.3, 0.46, 0.55, 20, 1, true), metal, -2.27);
  // llama del motor (abierta, hacia -Y)
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.42, 3.4, 20, 1, true), glowMat("#ff8a2a", 1.3));
  flame.rotation.x = Math.PI; flame.position.y = -4.25;
  g.add(flame);
  // capa de plasma alrededor de la punta y estela incandescente detras
  const plasma = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), shellMat("#ff6a1a"));
  plasma.scale.set(1.0, 2.2, 1.0); plasma.position.y = 2.2;
  g.add(plasma);
  const trail = new THREE.Mesh(new THREE.ConeGeometry(1.25, 12, 24, 1, true), glowMat("#ff5a14", 1.0));
  trail.rotation.x = Math.PI; trail.position.y = -3.2;
  g.add(trail);
  g.userData = { flame, plasma, trail };
  return g;
}
function setRocketFx(r, { engine = 0, plasma = 0, time = 0 }) {
  const u = r.userData;
  u.flame.visible = engine > 0.01;
  u.flame.material.uniforms.uI.value = engine;
  u.flame.material.uniforms.uTime.value = time;
  u.flame.scale.set(1, 0.85 + 0.25 * Math.sin(time * 37) * engine, 1);
  u.plasma.visible = u.trail.visible = plasma > 0.01;
  u.plasma.material.uniforms.uI.value = plasma * 1.2;
  u.trail.material.uniforms.uI.value = plasma;
  u.trail.material.uniforms.uTime.value = time;
  u.trail.scale.set(1, 0.6 + plasma * 0.8, 1);
}
function orient(obj, dir) { obj.quaternion.setFromUnitVectors(UP, dir.clone().normalize()); }

// Textura de Marte en tono natural a partir de la elevacion y el sombreado de MOLA (atlas)
function marsTexture(r) {
  const c = document.createElement("canvas");
  if (!r || !r.shade) {
    c.width = 512; c.height = 256;
    const g = c.getContext("2d"); g.fillStyle = "#b5582c"; g.fillRect(0, 0, 512, 256);
    return new THREE.CanvasTexture(c);
  }
  const { w, h, elev, shade } = r;
  c.width = w; c.height = h;
  const g = c.getContext("2d"), img = g.createImageData(w, h), px = img.data;
  const stops = [[-8200, [70, 34, 20]], [-4000, [128, 62, 32]], [0, [176, 92, 50]], [4000, [196, 124, 76]], [10000, [214, 160, 112]], [21200, [238, 214, 186]]];
  for (let i = 0; i < w * h; i++) {
    const e = elev[i];
    let k = 0; while (k < stops.length - 2 && e > stops[k + 1][0]) k++;
    const f = clamp((e - stops[k][0]) / (stops[k + 1][0] - stops[k][0]), 0, 1);
    const s = 0.55 + 0.6 * shade[i];
    const y = (i / w) | 0, polar = smooth(70, 84, Math.abs(90 - (y + 0.5) / (h / 180)));        // casquetes
    for (let j = 0; j < 3; j++) {
      const v = (stops[k][1][j] + f * (stops[k + 1][1][j] - stops[k][1][j])) * s;
      px[i * 4 + j] = Math.min(255, v * (1 - polar) + 236 * s * polar);
    }
    px[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class IntroCinematic {
  // ms = MarsScene del juego; site = { x, z } del habitat; geo = GeoFrame; getMarsRaster = () => raster global MOLA (o null)
  constructor({ ms, site, geo, getMarsRaster }) {
    Object.assign(this, { ms, site, geo, getMarsRaster });
    this.active = false;
    this.groundActive = false;
    $("introSkip").onclick = () => this.skip();
    $("introGo").onclick = () => this._finish();
    window.addEventListener("keydown", (e) => {
      if (!this.active) return;
      if (["Escape", "Enter", " "].includes(e.key)) { e.preventDefault(); this.cardShown ? this._finish() : this.skip(); }
    });
  }

  play(onDone) {
    this.onDone = onDone;
    this.active = true; this.cardShown = false; this.t = 0; this.stage = 0;
    $("scrIntro").hidden = false;
    $("introCard").hidden = true;
    $("introCanvas").hidden = false;
    $("introFlash").style.opacity = 0;
    $("introWarn").hidden = true;
    $("introHud").hidden = false;
    this.light = marsNow().lightMin;
    // sin un segundo contexto WebGL (limite del navegador o GPU ocupada) se salta la cinematica
    try { this._setupSpace(); } catch (e) { console.warn("Cinemática omitida", e); this.sp = null; this._finish(); return; }
    cine.start();
    this.last = performance.now();
    const loop = (now) => {
      if (!this.active) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.t += dt;
      if (this.t < T_SPACE) this._frameSpace(dt);
      else if (!this.groundActive && !this.cardShown) this._toGround();
      this._hud();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ==== 1. ESPACIO ===================================================================================
  _setupSpace() {
    if (this.sp) return;
    const cv = $("introCanvas");
    const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    // 1,5x basta en pantallas retina (a 2x serian ~10 Mpx por fotograma solo para el espacio)
    renderer.setPixelRatio(Math.min(1.5, devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020103);
    const cam = new THREE.PerspectiveCamera(50, 1, 0.005, 2000);
    // Sol, luz ambiente y estrellas
    // el Sol ilumina la cara por la que se entra (Gale de dia, la tarde marciana) con el terminador al fondo
    const nrm = new THREE.Vector3(0.15, 0.32, 1).normalize();               // normal en el punto de impacto
    const tdir0 = new THREE.Vector3(1, 0, 0).sub(nrm.clone().multiplyScalar(nrm.x)).normalize().negate();
    const sunDir = nrm.clone().multiplyScalar(0.85).addScaledVector(tdir0, -0.55).addScaledVector(new THREE.Vector3().crossVectors(nrm, tdir0).normalize(), 0.35).normalize();
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6); sun.position.copy(sunDir).multiplyScalar(100); scene.add(sun);
    scene.add(new THREE.AmbientLight(0x38281f, 0.35));
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture([[0, "rgba(255,250,235,1)"], [0.15, "rgba(255,230,190,.9)"], [0.4, "rgba(255,190,120,.18)"], [1, "rgba(0,0,0,0)"]]), blending: THREE.AdditiveBlending, depthWrite: false }));
    sunSprite.position.copy(sunDir).multiplyScalar(900); sunSprite.scale.setScalar(90); scene.add(sunSprite);
    const n = 2200, p = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * 6.2832, rr = Math.sqrt(1 - u * u);
      p[i * 3] = rr * Math.cos(a) * 1500; p[i * 3 + 1] = u * 1500; p[i * 3 + 2] = rr * Math.sin(a) * 1500;
      const w = 0.55 + Math.random() * 0.45, tint = Math.random();
      col[i * 3] = w; col[i * 3 + 1] = w * (0.92 + tint * 0.08); col[i * 3 + 2] = w * (0.85 + (1 - tint) * 0.15);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(p, 3)); sg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: false, vertexColors: true })));
    // Marte, con Gale girado hacia la llegada
    const mars = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), new THREE.MeshStandardMaterial({ map: marsTexture(this.getMarsRaster()), roughness: 1, metalness: 0 }));
    const lat = -5.4, lon = 137.8, th = (90 - lat) * D2R, ph = (lon / 360) * Math.PI * 2;
    const gDir = new THREE.Vector3(-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th));
    mars.quaternion.setFromUnitVectors(gDir, nrm);
    scene.add(mars);
    // atmosfera: halo fino y rojizo
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.025, 96, 64), new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uSun: { value: sunDir } },
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(position); vP = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vP,1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uSun; varying vec3 vN; varying vec3 vP;
        void main(){ vec3 V = normalize(cameraPosition - vP); float f = pow(clamp(1.0 + dot(vN, V), 0.0, 1.0), 4.0); float day = 0.35 + 0.65 * clamp(dot(vN, uSun) + 0.3, 0.0, 1.0);
          gl_FragColor = vec4(vec3(0.95, 0.58, 0.36) * f * day * 1.4, f * day); }`,
    }));
    scene.add(atmo);
    // trayectoria: altura h y distancia horizontal d caen hasta el punto de impacto I
    const I = nrm.clone().multiplyScalar(R);
    const tdir = new THREE.Vector3(1, 0, 0).sub(nrm.clone().multiplyScalar(nrm.x)).normalize().negate();  // la nave llega desde -x
    const side = new THREE.Vector3().crossVectors(nrm, tdir).normalize();
    const rocket = buildRocket();
    scene.add(rocket);
    this.sp = { renderer, scene, cam, mars, rocket, I, n: nrm, tdir, side, H0: 46, D0: 74, shake: new THREE.Vector3(), look: new THREE.Vector3() };
    this._resize();
    this._onResize = () => this._resize();
    window.addEventListener("resize", this._onResize);
  }
  _resize() {
    if (!this.sp) return;
    const w = innerWidth, h = innerHeight;
    this.sp.renderer.setSize(w, h, false);
    this.sp.cam.aspect = w / h; this.sp.cam.updateProjectionMatrix();
  }
  _path(s, out = new THREE.Vector3()) {
    const S = this.sp, h = S.H0 * Math.pow(1 - s, 2.2), d = S.D0 * Math.pow(1 - s, 1.4);
    return out.copy(S.I).addScaledVector(S.n, h).addScaledVector(S.tdir, d);
  }
  _sOf(time) { return 0.9 * Math.pow(clamp(time / T_SPACE, 0, 1), 0.62); }

  _frameSpace() {
    const S = this.sp, tt = this.t;
    const s = this._sOf(tt), pos = this._path(s), ahead = this._path(Math.min(0.999, s + 0.004));
    const vel = ahead.clone().sub(pos).normalize();
    const h = S.H0 * Math.pow(1 - s, 2.2);
    this.altKm = (h / R) * MARS_R_KM;
    const k = clamp(h / 9, 0.09, 1);                          // escala del cohete: llena la pantalla aunque Marte crezca
    S.rocket.position.copy(pos);
    S.rocket.scale.setScalar(0.28 * k);
    orient(S.rocket, vel);
    const plasma = smooth(3.9, 6.4, tt);
    this.plasma = plasma;
    setRocketFx(S.rocket, { engine: 1 - smooth(3.2, 4.0, tt), plasma, time: tt });
    // camara: plano general (la nave pasa al lado y se aleja hacia Marte) -> persecucion
    // plano general: detras de la nave y un poco a un lado; Marte queda al fondo y crece mientras ella se aleja
    const p0 = this._path(0), back = p0.clone().sub(S.I).normalize();
    const wide = p0.clone().addScaledVector(back, 9).addScaledVector(S.side, 3.2).addScaledVector(S.n, 1.4);
    const chase = pos.clone().addScaledVector(vel, -5.2 * k * 0.28 * 3.4).addScaledVector(S.n, 1.7 * k).addScaledVector(S.side, 1.3 * k);
    const b = smooth(2.3, 3.8, tt);
    S.cam.position.copy(wide).lerp(chase, b);
    // al principio se mira a un punto entre la nave y Marte, para tener los dos en cuadro
    // en la persecucion se mira un poco hacia abajo para ver la superficie que se acerca
    const target = pos.clone().lerp(S.I, 0.35 * (1 - b)).addScaledVector(vel, 2.5 * k * b).addScaledVector(S.n, -1.4 * k * b);
    S.look.lerp(target, tt < 0.05 ? 1 : 0.25);
    // vibracion por el plasma
    const shake = plasma * plasma * 0.06 * k;
    S.cam.position.add(S.shake.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
    S.cam.up.copy(S.n);
    S.cam.lookAt(S.look);
    S.cam.near = Math.max(0.002, 0.02 * k); S.cam.updateProjectionMatrix();
    S.renderer.render(S.scene, S.cam);
    // capas CSS: brillo naranja del plasma y destello final
    $("introGlow").style.opacity = (plasma * 0.75).toFixed(3);
    $("introFlash").style.opacity = smooth(T_SPACE - 0.55, T_SPACE, tt).toFixed(3);
    cine.set(0.25 + 0.15 * (1 - plasma) + plasma * 0.9, 160 + plasma * 900);
    this.speed = 5.9 - 0.9 * plasma;
    if (tt > 5.4 && this.stage < 1) { this.stage = 1; $("introWarn").hidden = false; sfx.klaxon(); }
  }

  // ==== 2. SUPERFICIE ================================================================================
  _toGround() {
    const ms = this.ms, sc = ms.scene;
    this.groundActive = true;
    $("introCanvas").hidden = true;
    $("introGlow").style.opacity = 0;
    // impacto a ~620 m del habitat, hacia el NE (llanura del fondo del crater)
    const ix = this.site.x + 300, iz = this.site.z - 380;
    const iy = ms.heightAt(ix, iz);
    this.imp = new THREE.Vector3(ix, iy, iz);
    this.camBase = new THREE.Vector3(this.site.x - 40, ms.heightAt(this.site.x - 40, this.site.z + 30) + 4, this.site.z + 30);
    this.dist = this.camBase.distanceTo(this.imp);
    // trayectoria de caida: desde el SO, pendiente de ~35°, a ~1,1 km/s al entrar en escena
    const from = new THREE.Vector3(-1, 0, 0.55).normalize();
    this.fallStart = this.imp.clone().addScaledVector(from, 3200).add(new THREE.Vector3(0, 2300, 0));
    this.fallDir = this.imp.clone().sub(this.fallStart).normalize();
    const g = (this.gr = { rocket: buildRocket(), objs: [], parts: [], t0: this.t });
    g.rocket.scale.setScalar(7);
    this.fov0 = ms.camera.fov;
    sc.add(g.rocket);
    g.objs.push(g.rocket);
    this.smokeTex = radialTexture([[0, "rgba(255,255,255,.9)"], [0.45, "rgba(255,255,255,.35)"], [1, "rgba(255,255,255,0)"]]);
    this.dustTex = radialTexture([[0, "rgba(255,255,255,1)"], [0.5, "rgba(255,255,255,.85)"], [0.8, "rgba(255,255,255,.3)"], [1, "rgba(255,255,255,0)"]]);
    this.fireTex = radialTexture([[0, "rgba(255,255,235,1)"], [0.25, "rgba(255,200,110,.85)"], [0.6, "rgba(255,90,20,.3)"], [1, "rgba(0,0,0,0)"]]);
    this.lookAt = this.fallStart.clone();
    this.groundStart = this.t;
    this.boomAt = T_IMPACT + this.dist / SOUND_MPS;
    $("introFlash").style.transition = "opacity .5s"; $("introFlash").style.opacity = 0;
    setTimeout(() => { $("introFlash").style.transition = ""; }, 600);
  }

  _sprite(tex, color, size, pos, add = true) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false }));
    sp.position.copy(pos); sp.scale.setScalar(size);
    this.ms.scene.add(sp); this.gr.objs.push(sp);
    return sp;
  }

  // la llama el bucle principal del juego mientras groundActive: mueve la camara de la escena del juego
  frameGround(dt) {
    const g = this.gr, ms = this.ms, tt = this.t, cam = ms.camera;
    const tf = clamp((tt - T_SPACE) / (T_IMPACT - T_SPACE), 0, 1);
    const fallLen = this.fallStart.distanceTo(this.imp);
    if (tt < T_IMPACT) {
      // caida: ligeramente acelerada; el modulo da vueltas porque perdio el control
      const p = this.fallStart.clone().addScaledVector(this.fallDir, fallLen * Math.pow(tf, 1.25));
      g.rocket.position.copy(p);
      orient(g.rocket, this.fallDir.clone().add(new THREE.Vector3(Math.sin(tt * 3) * 0.08, 0, Math.cos(tt * 2.3) * 0.08)));
      g.rocket.rotateY(tt * 2.2);
      setRocketFx(g.rocket, { engine: Math.sin(tt * 31) > 0.3 ? 0.55 : 0.05, plasma: 0.55 * (1 - tf), time: tt });
      // estela de humo y fuego
      if (Math.random() < 0.9) {
        const s = this._sprite(this.smokeTex, new THREE.Color(0.32, 0.24, 0.2), 30, p, false);
        s.material.opacity = 0.7;
        g.parts.push({ s, v: new THREE.Vector3((Math.random() - 0.5) * 6, 4 + Math.random() * 4, (Math.random() - 0.5) * 6), life: 4, age: 0, grow: 14, fade: 0.7 });
        const f = this._sprite(this.fireTex, new THREE.Color(1, 0.7, 0.4), 45, p, true);
        g.parts.push({ s: f, v: new THREE.Vector3(), life: 0.5, age: 0, grow: 30, fade: 1 });
      }
      this.altKm = Math.max(0, (g.rocket.position.y - this.imp.y) / 1000);
      this.speed = 1.1 + 0.25 * tf;
      cine.set(0.55 + 0.4 * tf, 420 + 900 * tf);
    } else if (!g.impacted) this._impact();
    // camara: en el borde del habitat, sigue la caida y luego mira la nube
    const target = tt < T_IMPACT ? g.rocket.position : this.imp.clone().add(new THREE.Vector3(0, 120 * smooth(T_IMPACT, T_IMPACT + 3, tt), 0));
    this.lookAt.lerp(target, Math.min(1, dt * 6));
    cam.position.copy(this.camBase);
    // sacudida: llega con la onda de presion (a la velocidad del sonido), no con el destello
    const quake = g.impacted ? Math.max(0, 1 - Math.abs(tt - this.boomAt) * 1.4) * (tt > this.boomAt - 0.1 ? 1 : 0) : 0;
    if (quake > 0) cam.position.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(quake * 1.6));
    cam.up.set(0, 1, 0);
    cam.lookAt(this.lookAt);
    // teleobjetivo durante la caida (la nave se ve grande) y gran angular para la explosion
    const fov = tt < T_IMPACT ? 24 + 14 * smooth(T_SPACE, T_IMPACT, tt) : 38 + 12 * smooth(T_IMPACT, T_IMPACT + 2, tt);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    ms.setTimeOfDay(16.4);
    ms.setFocus(this.camBase.x, this.camBase.y, this.camBase.z);
    if (g.impacted && !this.boomed && tt >= this.boomAt) { this.boomed = true; cine.boom(); }
    // particulas
    for (let i = g.parts.length - 1; i >= 0; i--) {
      const q = g.parts[i];
      q.age += dt;
      const u = q.age / q.life;
      if (u >= 1) { ms.scene.remove(q.s); q.s.material.dispose(); g.parts.splice(i, 1); continue; }
      if (q.grav) q.v.y -= 3.72 * dt;
      q.s.position.addScaledVector(q.v, dt);
      if (q.drag) q.v.multiplyScalar(1 - q.drag * dt);
      q.s.scale.setScalar(q.s.scale.x + q.grow * dt);
      q.s.material.opacity = q.fade * (1 - u) * (q.fadeIn ? smooth(0, 0.15, u) : 1);
    }
    if (g.ring) {
      const u = clamp((tt - T_IMPACT) / 1.6, 0, 1);
      g.ring.scale.setScalar(5 + u * 420);
      g.ring.material.opacity = 0.7 * (1 - u);
    }
    if (g.flash) g.flash.material.opacity = Math.max(0, 1 - (tt - T_IMPACT) * 2.2);
    if (tt > this.boomAt + 1.2 && !this.cardShown) this._card();
  }

  _impact() {
    const g = this.gr, I = this.imp, ms = this.ms;
    g.impacted = true;
    g.rocket.visible = false;
    $("introWarn").hidden = true;
    cine.set(0.08, 120);
    // destello, bola de fuego, polvo y escombros
    g.flash = this._sprite(this.fireTex, new THREE.Color(1, 0.95, 0.85), 380, I.clone().add(new THREE.Vector3(0, 30, 0)), true);
    for (let i = 0; i < 9; i++) {
      const f = this._sprite(this.fireTex, new THREE.Color(1, 0.55 + Math.random() * 0.2, 0.25), 40 + Math.random() * 40, I.clone().add(new THREE.Vector3((Math.random() - 0.5) * 40, 15 + Math.random() * 30, (Math.random() - 0.5) * 40)), true);
      g.parts.push({ s: f, v: new THREE.Vector3((Math.random() - 0.5) * 30, 25 + Math.random() * 30, (Math.random() - 0.5) * 30), life: 1.1 + Math.random() * 0.6, age: 0, grow: 45, fade: 0.9, drag: 0.8 });
    }
    // el polvo de Marte es oscuro y rojizo contra el cielo claro
    const dust = new THREE.Color(0.2, 0.12, 0.08);
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * 6.2832, up = Math.random();
      const s = this._sprite(this.dustTex, dust.clone().multiplyScalar(0.8 + Math.random() * 0.5), 50 + Math.random() * 50, I.clone().add(new THREE.Vector3(0, 10, 0)), false);
      s.material.opacity = 0;
      const sp = 40 + Math.random() * 70;
      g.parts.push({ s, v: new THREE.Vector3(Math.cos(a) * sp * (1 - up * 0.6), 15 + up * 90, Math.sin(a) * sp * (1 - up * 0.6)), life: 6 + Math.random() * 2, age: 0, grow: 40 + Math.random() * 30, fade: 0.95, drag: 0.55, fadeIn: true });
    }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.2832, el = 0.4 + Math.random() * 0.9, sp = 50 + Math.random() * 90;
      const s = this._sprite(this.fireTex, new THREE.Color(1, 0.6, 0.3), 7, I.clone().add(new THREE.Vector3(0, 6, 0)), true);
      g.parts.push({ s, v: new THREE.Vector3(Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(a) * Math.cos(el) * sp), life: 3 + Math.random() * 1.5, age: 0, grow: -1, fade: 1, grav: true });
    }
    // onda de choque sobre el suelo
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffd2a0, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    ring.rotation.x = -Math.PI / 2; ring.position.copy(I).add(new THREE.Vector3(0, 2, 0));
    ms.scene.add(ring); g.objs.push(ring); g.ring = ring;
    this.altKm = 0; this.speed = 0;
  }

  // ==== 3. TARJETA FINAL ==============================================================================
  _card() {
    this.cardShown = true;
    const ll = this.geo.toLatLon(this.imp.x, this.imp.z), lang = getLang();
    const elev = this.imp.y + (this.ms.world ? this.ms.world.yRef : 0);
    $("introCardBody").innerHTML = `
      <div class="eyebrow" style="color:var(--danger)">${t(L("Aterrizaje forzoso", "Crash landing"))}</div>
      <h2>${t(L("El módulo se estrelló en el cráter Gale", "The lander crashed in Gale crater"))}</h2>
      <p class="ic-coords">${fmtLat(ll.lat, 4)} · ${fmtLon(ll.lon, 4)} · ${num(elev, 0, lang)} m · ${num(this.dist, 0, lang)} m ${t(L("del hábitat Aeolis", "from Aeolis habitat"))}</p>
      <p class="body">${t(L("El paracaídas no se abrió y el módulo cayó a más de 1 km/s. Tú saltaste a tiempo: tu traje funciona y el hábitat Aeolis está cerca. A partir de aquí, sobrevivir depende de leer los datos.", "The parachute failed and the lander came down at over 1 km/s. You bailed out in time: your suit works and Aeolis habitat is close. From here on, survival depends on reading the data."))}</p>
      <p class="small muted">${t(L(`El destello se vio antes de que llegara el estruendo: en Marte el sonido viaja a unos 240 m/s (en la Tierra, 343 m/s), así que tardó ${num(this.dist / SOUND_MPS, 1, lang)} s en recorrer ${num(this.dist, 0, lang)} m.`, `The flash was seen before the boom arrived: on Mars sound travels at about 240 m/s (343 m/s on Earth), so it took ${num(this.dist / SOUND_MPS, 1, lang)} s to cover ${num(this.dist, 0, lang)} m.`))}</p>`;
    $("introCard").hidden = false;
    $("introSkip").hidden = true;
    $("introGo").focus();
  }

  _hud() {
    $("introHud").hidden = this.cardShown;
    if (this.cardShown) return;
    const lang = getLang(), tt = this.t;
    const phase = tt < 3.4 ? L("Aproximación a Marte", "Approaching Mars") : tt < T_SPACE ? L("Entrada atmosférica · escudo térmico a ~1 500 °C", "Atmospheric entry · heat shield at ~1,500 °C")
      : tt < T_IMPACT ? L("Descenso sin paracaídas", "Descent without parachute") : L("Impacto", "Impact");
    const html = `
      <div class="ih-t">${t(L("Expedición Aeolis-1 · módulo de descenso", "Aeolis-1 expedition · descent module"))}</div>
      <div class="ih-p">${t(phase)}</div>
      <dl>
        <dt>T+</dt><dd>${num(tt, 1, lang)} s</dd>
        <dt>ALT</dt><dd>${this.altKm != null ? (this.altKm >= 10 ? num(this.altKm, 0, lang) + " km" : num(this.altKm * 1000, 0, lang) + " m") : "—"}</dd>
        <dt>VEL</dt><dd>${this.speed != null ? num(this.speed, 2, lang) + " km/s" : "—"}</dd>
        <dt>${t(L("SEÑAL", "SIGNAL"))}</dt><dd>${t(L("llega a la Tierra en", "reaches Earth in"))} ${num(this.light || 0, 1, lang)} min</dd>
      </dl>`;
    // solo se reescribe si cambia (antes se reconstruia el HTML en cada fotograma)
    if (html !== this._hudHtml) { this._hudHtml = html; $("introHud").innerHTML = html; }
  }

  skip() {
    if (!this.active) return;
    if (!this.cardShown) {
      // saltar: directo a la tarjeta (con un impacto ya calculado si aun no se llego a la superficie)
      if (!this.groundActive) { this.t = T_SPACE; this._toGround(); }
      if (!this.gr.impacted) { this.t = T_IMPACT; this._impact(); }
      cine.stop();
      this._card();
    } else this._finish();
  }

  _finish() {
    if (!this.active) return;
    this.active = false;
    this.groundActive = false;
    cine.stop();
    // limpiar todo lo que se añadio a la escena del juego y liberar el renderer del espacio
    if (this.fov0) { this.ms.camera.fov = this.fov0; this.ms.camera.updateProjectionMatrix(); }
    if (this.gr) { for (const o of this.gr.objs) { this.ms.scene.remove(o); if (o.material && o.material.dispose) o.material.dispose(); } this.gr = null; }
    if (this.sp) { this.sp.renderer.dispose(); this.sp.renderer.forceContextLoss(); window.removeEventListener("resize", this._onResize); this.sp = null; }
    $("scrIntro").hidden = true;
    $("introSkip").hidden = false;
    this.onDone && this.onDone();
  }
}
