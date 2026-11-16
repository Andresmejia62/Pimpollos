// Exploracion 3D del mapa (sin jugabilidad): vista orbital inclinable tipo Google Earth dentro del planificador y
// vista de suelo tipo Street View a la altura de los ojos, desde el planificador o desde el atlas.
//
// No crea ningun recurso pesado: dibuja con el MISMO renderer del juego las mallas, materiales y texturas que ya
// estan en memoria (terreno de 6 m, faldon, crater Gale MOLA con curvatura, cielo, estructuras, rocas) con una
// camara propia. Encima anade solo cosas ligeras: el calco de la capa de datos (comparte la geometria del
// terreno), las rutas como cintas pegadas al relieve y los marcadores en un lienzo 2D.
//  - modo "card": se dibuja en una esquina del lienzo del juego y se copia al lienzo del mapa del planificador
//    (el juego vuelve a pintar su fotograma justo despues, en el mismo fotograma, asi que no se ve la esquina)
//  - modo "street": ocupa toda la pantalla; el bucle principal deja de dibujar el juego mientras tanto
// La simulacion sigue en pausa porque el planificador o el atlas siguen abiertos por debajo.
import * as THREE from "three";
import { t, getLang } from "../i18n.js";
import { fmtLat, fmtLon, fmtDist, num, gcBearing } from "../geo.js";

const D2R = Math.PI / 180;
const L = (es, en) => ({ es, en });
const $ = (id) => document.getElementById(id);
export const EYE_M = 1.75;                // altura de los ojos de un astronauta sobre el suelo
const PITCH_MAX = 75;                     // inclinacion maxima de la vista orbital (0 = cenital)
const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
const smooth = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const hhmm = (h) => { h = ((h % 24) + 24) % 24; return `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`; };

// ---- cintas de ruta: ancho minimo en pixeles (se leen desde la orbita) y en metros (a pie) ----------------------
const RIBBON_VS = /* glsl */ `
  attribute vec2 aSide; attribute float aSgn; attribute float aDist;
  uniform float uMinPx, uPxRad, uHalfW;
  varying float vSgn; varying float vDist; varying float vPeriod;
  void main() {
    vec3 w = (modelMatrix * vec4(position, 1.0)).xyz;
    float d = distance(cameraPosition, w);
    float hw = max(uHalfW, d * uPxRad * uMinPx);
    vec3 p = position + vec3(aSide.x, 0.0, aSide.y) * aSgn * hw;
    p.y += 0.04 + hw * 0.35;               // en laderas transversales el borde no se hunde en el terreno
    vSgn = aSgn; vDist = aDist; vPeriod = max(3.0, d * uPxRad * 16.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const RIBBON_FS = /* glsl */ `
  uniform vec3 uColor; uniform float uDash, uOpacity;
  varying float vSgn; varying float vDist; varying float vPeriod;
  void main() {
    if (uDash > 0.5 && fract(vDist / vPeriod) > 0.58) discard;
    float e = smoothstep(0.5, 0.92, abs(vSgn));
    gl_FragColor = vec4(mix(uColor, uColor * 0.22, e), uOpacity);
    #include <colorspace_fragment>
  }`;
// calco de la capa cientifica: misma geometria que el terreno del juego, dibujada encima
const DRAPE_VS = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DRAPE_FS = /* glsl */ `
  uniform sampler2D uMap; uniform float uAlpha; varying vec2 vUv;
  void main() { vec4 o = texture2D(uMap, vUv); gl_FragColor = vec4(o.rgb, o.a * uAlpha);
    #include <colorspace_fragment>
  }`;

function ribbonGeometry(pts, heightAt, step = 6) {
  const P = [];
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let k = 0; k < n; k++) P.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
  }
  if (pts.length) P.push(pts[pts.length - 1]);
  const n = P.length;
  const pos = new Float32Array(n * 6), side = new Float32Array(n * 4), sgn = new Float32Array(n * 2), dist = new Float32Array(n * 2);
  let d = 0;
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    if (i) d += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    const y = heightAt(P[i][0], P[i][1]);
    for (let s = 0; s < 2; s++) {
      const k = i * 2 + s;
      pos[k * 3] = P[i][0]; pos[k * 3 + 1] = y; pos[k * 3 + 2] = P[i][1];
      side[k * 2] = -tz; side[k * 2 + 1] = tx;
      sgn[k] = s ? 1 : -1; dist[k] = d;
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSide", new THREE.BufferAttribute(side, 2));
  g.setAttribute("aSgn", new THREE.BufferAttribute(sgn, 1));
  g.setAttribute("aDist", new THREE.BufferAttribute(dist, 1));
  g.setIndex(idx);
  return g;
}

export class Explorer3D {
  // scene: engine/scene.js (MarsScene ya inicializada); hide: objetos que se ocultan si la camara se les mete dentro
  constructor({ scene, world, game, geo, data, hide = [] }) {
    Object.assign(this, { S: scene, world, game, geo, data, hide });
    this.mode = "off";                  // "off" | "card" | "street"
    this.cam = new THREE.PerspectiveCamera(50, 1, 0.3, 60000);
    this.cam.rotation.order = "YXZ";
    this.farCam = new THREE.PerspectiveCamera(50, 1, 800, 480000);
    this.orbit = { x: 0, z: 0, dist: 7000, pitch: 50, bearing: 0 };
    this.street = { x: 0, z: 0, yaw: 0, pitch: -4, fov: 62 };
    this.ov = new THREE.Scene();        // capa ligera propia: calco, cintas y rocas de la vista de suelo
    this.routes = [];
    this.markers = [];
    this.layer = "";
    this.dirty = true;
    this._ray = new THREE.Raycaster();
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();
    this._vp = new THREE.Vector4(); this._sc = new THREE.Vector4();
    this._bindStreet();
  }

  // ---- contenido ---------------------------------------------------------------------------------------
  _ensure() {
    if (this._built || !this.S.terrain) return !!this._built;
    const S = this.S;
    this.drapeMat = new THREE.ShaderMaterial({
      vertexShader: DRAPE_VS, fragmentShader: DRAPE_FS, transparent: true, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
      uniforms: { uMap: { value: null }, uAlpha: { value: 0.85 } },
    });
    this.drape = new THREE.Mesh(S.terrain.geometry, this.drapeMat);      // geometria compartida, no se copia
    this.drape.visible = false;
    this.drape.renderOrder = 1;
    this.ov.add(this.drape);
    // rocas de la vista de suelo: misma geometria, material y colocacion que las del juego, en otro sitio
    if (S.rocks) {
      this.rocks = new THREE.InstancedMesh(S.rocks.geometry, S.rocks.material, S.rocks.instanceMatrix.count);
      this.rocks.count = 0; this.rocks.frustumCulled = false;
      // se anaden a la escena del juego solo mientras se dibuja la vista de suelo (mismas luces y bruma)
    }
    this.ov.fog = S.scene.fog;
    this._findFeatures();
    this._built = true;
    return true;
  }

  // Cima del monte Sharp y el punto del borde de Gale mas cercano: rotulos de referencia en el horizonte
  _findFeatures() {
    this.features = [];
    const m = this.S.mola;
    if (!m) return;
    const c = this.geo.toWorld(-5.37, 137.81);            // centro del crater Gale
    let best = null, rim = null;
    for (let r = 0; r < m.h; r += 1) for (let col = 0; col < m.w; col += 1) {
      const x = m.colX(col), z = m.rowZ(r), d = Math.hypot(x - c.x, z - c.z), e = m.elev[r * m.w + col];
      if (d < 30000 && (!best || e > best.e)) best = { x, z, e };
    }
    // borde: el punto mas alto entre 55 y 95 km del centro en la direccion de la zona EVA
    const dir = Math.atan2(-c.x, -c.z);
    for (let d = 55000; d <= 95000; d += 900) for (let a = -0.25; a <= 0.25; a += 0.05) {
      const x = c.x + Math.sin(dir + a) * d, z = c.z + Math.cos(dir + a) * d, e = m.elevationAt(x, z);
      if (!rim || e > rim.e) rim = { x, z, e };
    }
    if (best) this.features.push({ kind: "feature", x: best.x, z: best.z, label: L("Monte Sharp (Aeolis Mons)", "Mount Sharp (Aeolis Mons)") });
    if (rim) this.features.push({ kind: "feature", x: rim.x, z: rim.z, label: L("Borde del cráter Gale", "Gale crater rim") });
  }

  // routes: [{ id, pts:[[x,z]], color, sel, dash, minPx }]
  setRoutes(routes) {
    if (!this._ensure()) { this.routes = routes; return; }
    const keep = new Map(this.routes.filter((r) => r.mesh).map((r) => [r.id, r]));
    const next = [];
    for (const r of routes) {
      if (!r.pts || r.pts.length < 2) continue;
      let o = keep.get(r.id);
      if (!o || o.pts !== r.pts) {
        if (o) { this.ov.remove(o.mesh); o.mesh.geometry.dispose(); }
        const mat = new THREE.ShaderMaterial({
          vertexShader: RIBBON_VS, fragmentShader: RIBBON_FS, toneMapped: false, depthWrite: false, transparent: true,
          polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -12,
          uniforms: { uColor: { value: new THREE.Color() }, uDash: { value: 0 }, uOpacity: { value: 1 }, uMinPx: { value: 2 }, uPxRad: { value: 0.001 }, uHalfW: { value: 0 } },
        });
        o = { id: r.id, pts: r.pts, mesh: new THREE.Mesh(ribbonGeometry(r.pts, (x, z) => this.ground(x, z)), mat) };
        o.mesh.frustumCulled = false;
        this.ov.add(o.mesh);
      }
      keep.delete(r.id);
      const u = o.mesh.material.uniforms;
      u.uColor.value.set(r.color); u.uDash.value = r.dash ? 1 : 0; u.uOpacity.value = r.opacity ?? 1;
      o.minPx = r.minPx ?? (r.sel ? 3 : 1.6);
      o.street = r.street ?? (r.sel ? 0.55 : 0.3);
      o.mesh.renderOrder = r.sel ? 4 : 3;
      next.push(o);
    }
    for (const o of keep.values()) { this.ov.remove(o.mesh); o.mesh.geometry.dispose(); o.mesh.material.dispose(); }
    this.routes = next;
    this.dirty = true;
  }
  // markers: [{ kind: "start"|"shelter"|"obj"|"goal"|"way"|"feature", x, z, label, color, n }]
  setMarkers(markers) { this.markers = markers; this.dirty = true; }
  setLayer(k) {
    this.layer = k || "";
    if (this._ensure()) {
      const tex = this.layer && this.S.overlays[this.layer];
      this.drapeMat.uniforms.uMap.value = tex || null;
      this.drape.visible = !!tex;
    }
    this.dirty = true;
  }
  // contenido por defecto (desde el atlas): objetivos, tu posicion, ruta planificada y traza de Curiosity
  defaultContent() {
    const g = this.game, mk = [];
    for (const o of Object.values(g.objectives)) mk.push({ kind: o.shelter ? "shelter" : "obj", x: o.world.x, z: o.world.z, label: o.name, color: g.target && o.id === g.target.id ? "#3DDC97" : "#fff" });
    mk.push({ kind: "start", x: g.s.x, z: g.s.z, label: L("Tú", "You"), color: "#7FD1FF" });
    this.setMarkers(mk);
    const rs = [];
    const tr = this.traversePts();
    if (tr) rs.push({ id: "msl", pts: tr, color: "#f4f1ea", dash: true, minPx: 1.4, street: 0.25, opacity: 0.85 });
    if (g.s.plan && g.s.plan.pts) rs.push({ id: "plan", pts: g.s.plan.pts, color: "#3DDC97", sel: true });
    this.setRoutes(rs);
    this.setLayer(g.s.layer || "");
  }
  // traza real de Curiosity (MMGIS) dentro del recorte, en coordenadas del mundo
  traversePts() {
    if (this._trav !== undefined) return this._trav;
    const P = (this.data.traverse && this.data.traverse.points) || [];
    const pts = P.filter(([, x, z]) => this.world.inside(x, z, 4)).map(([, x, z]) => [x, z]);
    return (this._trav = pts.length > 1 ? pts : null);
  }

  // ---- geometria del suelo ------------------------------------------------------------------------------
  // altura del mundo (y) en cualquier punto: malla del juego dentro del recorte y MOLA (con curvatura) fuera
  ground(x, z) {
    if (this.world.inside(x, z)) return this.S.heightAt(x, z);
    return this.S.mola ? this.S.mola.worldY(x, z) : this.S.heightAt(x, z);
  }
  // pixel -> punto del terreno del recorte (marcha por el rayo y refina por biseccion); null si no toca el recorte
  pick(px, py, W, H) {
    const cam = this.cam;
    const o = cam.position, d = this._v2.set((px / W) * 2 - 1, -(py / H) * 2 + 1, 0.5).unproject(cam).sub(o).normalize();
    let t0 = 0, t = Math.max(0.2, cam.near), prevAbove = true;
    for (let i = 0; i < 900 && t < 40000; i++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t, h = this.ground(x, z), dh = y - h;
      if (dh < 0 && prevAbove) {
        let a = t0, b = t;
        for (let k = 0; k < 18; k++) { const m = (a + b) / 2; const mx = o.x + d.x * m, mz = o.z + d.z * m; if (o.y + d.y * m - this.ground(mx, mz) < 0) b = m; else a = m; }
        const hx = o.x + d.x * b, hz = o.z + d.z * b;
        return { x: hx, z: hz, y: this.ground(hx, hz), dist: b, inside: this.world.inside(hx, hz, 12) };
      }
      t0 = t;
      t += Math.min(400, Math.max(0.15, dh * 0.5, t * 0.004));
    }
    return null;
  }
  // mundo -> pixel en la vista actual; null si queda detras de la camara
  project(x, y, z, W, H) {
    const v = this._v.set(x, y, z).project(this.cam);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * W, y: (1 - (v.y * 0.5 + 0.5)) * H };
  }
  // linea de vision de la camara a un punto (lo tapa una loma o el monte?)
  visible(x, y, z) {
    const o = this.cam.position, n = 56;
    for (let i = 1; i < n; i++) {
      const f = i / n, px = o.x + (x - o.x) * f, pz = o.z + (z - o.z) * f, py = o.y + (y - o.y) * f;
      if (f > 0.97) break;
      if (py < this.ground(px, pz) - 0.6) return false;
    }
    return true;
  }

  // ---- camaras --------------------------------------------------------------------------------------
  _orbitPose(o = this.orbit) {
    const c = this.cam, b = o.bearing * D2R, p = o.pitch * D2R;
    const fy = this.ground(o.x, o.z), fx = Math.sin(b), fz = -Math.cos(b);
    c.position.set(o.x - fx * o.dist * Math.sin(p), fy + o.dist * Math.cos(p), o.z - fz * o.dist * Math.sin(p));
    // que la camara no se meta bajo una loma al inclinar mucho
    const gy = this.ground(c.position.x, c.position.z) + 30;
    if (c.position.y < gy) c.position.y = gy;
    c.rotation.set(-(90 - o.pitch) * D2R, -b, 0, "YXZ");
    c.fov = 50;
    c.near = Math.max(0.5, o.dist * 0.004); c.far = Math.max(40000, o.dist * 6);
  }
  _streetPose(s = this.street) {
    const c = this.cam;
    c.position.set(s.x, this.ground(s.x, s.z) + EYE_M, s.z);
    c.rotation.set(s.pitch * D2R, -s.yaw * D2R, 0, "YXZ");
    c.fov = s.fov; c.near = 0.12; c.far = 40000;
  }
  get heading() { return this.mode === "street" || this.anim ? this.street.yaw : this.orbit.bearing; }

  // ---- render compartido ----------------------------------------------------------------------------
  // Dibuja la vista en (x0, y0, w, h) del lienzo del juego (pixeles CSS, origen abajo a la izquierda).
  _render(w, h, x0 = 0, y0 = 0) {
    const S = this.S, r = S.renderer, cam = this.cam, far = this.farCam;
    cam.aspect = w / h; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    far.fov = cam.fov; far.aspect = cam.aspect; far.updateProjectionMatrix();
    far.position.copy(cam.position); far.quaternion.copy(cam.quaternion); far.updateMatrixWorld(true);
    const street = this.mode === "street" || !!this.anim;
    const pxRad = (cam.fov * D2R) / h;
    for (const o of this.routes) {
      const u = o.mesh.material.uniforms;
      u.uPxRad.value = pxRad; u.uMinPx.value = o.minPx; u.uHalfW.value = street ? o.street : 0;
    }
    // estado del juego que se toca solo durante este dibujo y se devuelve tal cual
    const tu = S.terrainMat.uniforms, ovOn = tu.uOverlayOn.value;
    const skyPos = this._v2.copy(S.sky.position);
    const fogU = S.shade && S.shade.uFogDensity, fog0 = fogU ? fogU.value : 0, fogS = S.scene.fog ? S.scene.fog.density : 0;
    const altK = street ? 1 : Math.max(0.22, Math.min(1, 1 - (this.orbit.dist - 400) / 7000));
    const hidden = [];
    for (const o of this.hide) if (o && o.visible && o.position.distanceTo(cam.position) < 6) { o.visible = false; hidden.push(o); }
    const route = S.routeLine, routeVis = route ? route.visible : false;
    const autoClear = r.autoClear, scT = r.getScissorTest();
    r.getViewport(this._vp); r.getScissor(this._sc);
    try {
      tu.uOverlayOn.value = 0;                 // la capa la pone el calco (no se desvanece con la distancia)
      S.sky.position.copy(cam.position);
      if (fogU) fogU.value = fog0 * altK;
      if (S.scene.fog) S.scene.fog.density = fogS * altK;
      if (route) route.visible = false;        // la ruta del juego: aqui se dibujan las del mapa
      if (street && this.rocks) S.scene.add(this.rocks);
      r.setRenderTarget(null);
      r.autoClear = false;
      r.setViewport(x0, y0, w, h); r.setScissor(x0, y0, w, h); r.setScissorTest(true);
      r.clear();
      r.render(S.skyScene, far);
      r.clearDepth();
      r.render(S.scene, cam);
      r.render(this.ov, cam);
    } finally {
      tu.uOverlayOn.value = ovOn;
      S.sky.position.copy(skyPos);
      if (fogU) fogU.value = fog0;
      if (S.scene.fog) S.scene.fog.density = fogS;
      if (route) route.visible = routeVis;
      if (this.rocks && this.rocks.parent) this.rocks.parent.remove(this.rocks);
      for (const o of hidden) o.visible = true;
      r.setScissorTest(scT); r.setViewport(this._vp); r.setScissor(this._sc);
      r.autoClear = autoClear;
    }
  }

  // Lo llama el bucle principal antes de dibujar el juego
  frame(now) {
    if (this.mode === "off" || !this._ensure()) return;
    // luz de la hora de la mision (la de la ficha): desde la portada la escena esta en su crepusculo fijo.
    // El bucle principal vuelve a poner su hora al empezar el siguiente fotograma.
    if (Number.isFinite(this.game.hour)) this.S.setTimeOfDay(this.game.hour);
    if (this.anim) this._stepAnim(now);
    if (this.mode === "street") { this._renderStreet(); return; }
    if (this.mode === "card" && (this.dirty || this.anim)) this._renderCard();
  }
  get fullscreen() { return this.mode === "street"; }

  // ---- modo tarjeta (planificador) ---------------------------------------------------------------------
  // canvas: lienzo 2D del mapa; opts: { onClick(hit, px, py), onChange() }
  openCard(canvas, opts = {}) {
    this._ensure();
    if (this.card && this.card.canvas !== canvas) this.closeCard();
    if (!this.card) {
      this.card = { canvas, ctx: canvas.getContext("2d"), ...opts };
      this._bindCard(canvas);
    } else Object.assign(this.card, opts);
    this.mode = "card";
    this.dirty = true;
  }
  closeCard() {
    if (this.card && this.card.unbind) this.card.unbind();
    this.card = null;
    if (this.mode === "card") this.mode = "off";
  }
  // encuadra un rectangulo del mapa (x0, z0, ancho, alto) con la inclinacion dada
  fit(cx, cz, span, pitch = 50, bearing = 0) {
    const r = this.card ? this.card.canvas.getBoundingClientRect() : { width: innerWidth, height: innerHeight };
    const asp = Math.max(0.3, r.width / Math.max(1, r.height));
    const d = (span / 2) / Math.tan(25 * D2R) / Math.min(1, asp) * 1.05;
    Object.assign(this.orbit, { x: cx, z: cz, dist: Math.max(150, Math.min(16000, d)), pitch, bearing });
    this.dirty = true;
  }
  resetNorth() {
    const o = this.orbit, b0 = ((o.bearing + 540) % 360) - 180;
    if (this.mode === "street") { const y0 = ((this.street.yaw + 540) % 360) - 180; this._tween(300, (e) => { this.street.yaw = y0 * (1 - e); }); return; }
    this._tween(450, (e) => { o.bearing = b0 * (1 - e); });
  }
  _tween(ms, fn) {
    const t0 = performance.now(), id = (this._tw = (this._tw || 0) + 1);
    const step = (now) => { if (id !== this._tw) return; const u = Math.min(1, (now - t0) / ms); fn(ease(u)); this.dirty = true; if (u < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  _clampOrbit() {
    const o = this.orbit, h = this.world.half;
    o.x = Math.max(-h, Math.min(h, o.x)); o.z = Math.max(-h, Math.min(h, o.z));
    o.dist = Math.max(120, Math.min(16000, o.dist));
    o.pitch = Math.max(0, Math.min(PITCH_MAX, o.pitch));
    o.bearing = ((o.bearing % 360) + 360) % 360;
  }
  _bindCard(cv) {
    const touches = new Map();
    let drag = null, moved = 0, orbitDrag = false, two = null;
    const rect = () => cv.getBoundingClientRect();
    const down = (e) => {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      orbitDrag = e.button === 2 || e.ctrlKey || e.altKey || e.shiftKey;
      drag = [e.clientX, e.clientY]; moved = 0; two = null;
      this._tw = (this._tw || 0) + 1;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* puntero ya liberado */ }
    };
    const move = (e) => {
      if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
      const o = this.orbit;
      if (touches.size === 2) {
        // dos dedos: pellizco = zoom, girar = rumbo, deslizar en vertical = inclinacion
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]), my = (a[1] + b[1]) / 2;
        if (two) {
          o.dist *= two.d / Math.max(1, d);
          let da = ang - two.ang; da = Math.atan2(Math.sin(da), Math.cos(da));
          o.bearing -= da / D2R;
          o.pitch -= (my - two.my) * 0.35;
        }
        two = { d, ang, my }; moved = 99; drag = null;
        this._clampOrbit(); this.dirty = true;
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag[0], dy = e.clientY - drag[1];
      moved += Math.abs(dx) + Math.abs(dy);
      drag = [e.clientX, e.clientY];
      if (orbitDrag) { o.bearing -= dx * 0.3; o.pitch -= dy * 0.3; }
      else {
        const H = rect().height || 1, mpp = (2 * o.dist * Math.tan(25 * D2R)) / H, b = o.bearing * D2R;
        const fx = Math.sin(b), fz = -Math.cos(b), rx = Math.cos(b), rz = Math.sin(b);
        const k = 1 / Math.max(0.35, Math.cos(o.pitch * D2R));
        o.x += -rx * dx * mpp + fx * dy * mpp * k;
        o.z += -rz * dx * mpp + fz * dy * mpp * k;
      }
      this._clampOrbit(); this.dirty = true;
    };
    const up = (e) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) two = null;
      if (drag && moved < 6 && !orbitDrag && this.card && this.card.onClick) {
        const r = rect(), px = e.clientX - r.left, py = e.clientY - r.top;
        this._orbitPose();
        this.cam.aspect = r.width / r.height; this.cam.updateProjectionMatrix(); this.cam.updateMatrixWorld(true);
        this.card.onClick(this.pick(px, py, r.width, r.height), px, py);
      }
      drag = null;
    };
    const cancel = (e) => { touches.delete(e.pointerId); drag = null; two = null; };
    const wheel = (e) => { e.preventDefault(); this._tw = (this._tw || 0) + 1; this.orbit.dist *= Math.exp(e.deltaY * 0.0015); this._clampOrbit(); this.dirty = true; };
    const ctx = (e) => e.preventDefault();
    cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", cancel); cv.addEventListener("wheel", wheel, { passive: false }); cv.addEventListener("contextmenu", ctx);
    this.card.unbind = () => {
      cv.removeEventListener("pointerdown", down); cv.removeEventListener("pointermove", move); cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", cancel); cv.removeEventListener("wheel", wheel); cv.removeEventListener("contextmenu", ctx);
    };
  }
  _renderCard() {
    const c = this.card;
    if (!c) return;
    const cv = c.canvas, rc = cv.getBoundingClientRect();
    if (rc.width < 4 || rc.height < 4) return;
    this.dirty = false;
    const r = this.S.renderer, pr = r.getPixelRatio(), dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.min(rc.width, innerWidth), H = Math.min(rc.height, innerHeight);
    if (!this.anim) this._orbitPose();
    this._render(W, H, 0, 0);
    if (cv.width !== Math.round(rc.width * dpr) || cv.height !== Math.round(rc.height * dpr)) { cv.width = Math.round(rc.width * dpr); cv.height = Math.round(rc.height * dpr); }
    const ctx = c.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const src = r.domElement, sh = Math.round(H * pr);
    ctx.drawImage(src, 0, src.height - sh, Math.round(W * pr), sh, 0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._drawMarkers(ctx, rc.width, rc.height, false);
    this._compass();
    if (c.onDrawn) c.onDrawn(ctx, rc.width, rc.height);
  }

  // ---- marcadores (los mismos en la tarjeta y a pie) ----------------------------------------------------
  _drawMarkers(ctx, W, H, street) {
    const lang = getLang(), eye = this.cam.position;
    const items = [...this.markers, ...(this.features || [])];
    const drawn = [];
    for (const m of items) {
      const y = this.ground(m.x, m.z);
      const d = Math.hypot(m.x - eye.x, m.z - eye.z);
      if (street && m.kind !== "feature" && d < 3) continue;
      const lift = m.kind === "feature" ? 40 : street ? 2.2 : 0;
      const p = this.project(m.x, y + lift, m.z, W, H);
      if (!p || p.x < -40 || p.y < -40 || p.x > W + 40 || p.y > H + 40) continue;
      if (m.kind !== "feature" && !this.visible(m.x, y + 2.5, m.z)) continue;
      const stalk = m.kind === "feature" ? 0 : 18;
      const tx = p.x, ty = p.y - stalk;
      ctx.lineCap = "round";
      if (stalk) { ctx.strokeStyle = "rgba(0,0,0,.65)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tx, ty); ctx.stroke(); ctx.strokeStyle = m.color || "#fff"; ctx.lineWidth = 1.4; ctx.stroke(); ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.beginPath(); ctx.ellipse(p.x, p.y, 4, 2, 0, 0, 7); ctx.fill(); }
      const col = m.color || "#fff";
      ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.fillStyle = col;
      if (m.kind === "shelter") { ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(tx - 7, ty - 7, 14, 14); ctx.strokeRect(tx - 7, ty - 7, 14, 14); }
      else if (m.kind === "obj") { ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.beginPath(); ctx.arc(tx, ty, 7, 0, 7); ctx.fill(); ctx.stroke(); }
      else if (m.kind === "goal") { ctx.beginPath(); ctx.arc(tx, ty, 12, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(tx, ty, 4, 0, 7); ctx.fill(); }
      else if (m.kind === "start") { ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx, ty, 8, 0, 7); ctx.fill(); ctx.stroke(); }
      else if (m.kind === "way") {
        ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx, ty, 9, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#111"; ctx.font = "700 12px Rajdhani, sans-serif"; ctx.textAlign = "center"; ctx.fillText(String(m.n), tx, ty + 4); ctx.textAlign = "left";
      }
      if (!m.label) continue;
      let text = t(m.label);
      if (street) text += ` · ${fmtDist(d, lang)}`;
      const lx = m.kind === "feature" ? tx : tx + 13, ly = m.kind === "feature" ? ty : ty + 4;
      // rotulos que se pisan: se omite el mas lejano
      ctx.font = m.kind === "feature" ? "italic 600 14px Rajdhani, sans-serif" : "600 13px Rajdhani, sans-serif";
      const w = ctx.measureText(text).width;
      const box = m.kind === "feature" ? [lx - w / 2, ly - 12, w, 16] : [lx, ly - 12, w, 16];
      if (drawn.some((b) => box[0] < b[0] + b[2] && box[0] + box[2] > b[0] && box[1] < b[1] + b[3] && box[1] + box[3] > b[1])) continue;
      drawn.push(box);
      ctx.textAlign = m.kind === "feature" ? "center" : "left";
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.strokeText(text, lx, ly);
      ctx.fillStyle = m.kind === "feature" ? "#ffe2bf" : col; ctx.fillText(text, lx, ly);
      ctx.textAlign = "left";
    }
  }
  // brujulas: la aguja apunta al norte de la vista actual
  _compass() {
    const h = this.heading;
    document.querySelectorAll(".map-compass").forEach((el) => {
      if (el.dataset.src === "atlas") return;
      const n = el.querySelector(".needle");
      if (n) n.style.transform = `rotate(${-h}deg)`;
      el.setAttribute("aria-label", `${t(L("Norte · rumbo", "North · heading"))} ${Math.round(h)}°`);
    });
  }

  // ---- vista de suelo -------------------------------------------------------------------------------
  // opts: { from: "planner" | "atlas", startAlt, yaw, onExit() }
  enterStreet(x, z, opts = {}) {
    if (!this._ensure()) return false;
    const h = this.world.half - 12;
    x = Math.max(-h, Math.min(h, x)); z = Math.max(-h, Math.min(h, z));
    this.exitOpts = opts;
    this.prevMode = this.mode;
    // punto de partida: la camara actual (tarjeta) o una vista cenital alta sobre el punto (atlas / mapa 2D)
    let fromPos, fromYaw, fromPitch;
    if (this.mode === "card") {
      this._orbitPose();
      fromPos = this.cam.position.clone(); fromYaw = this.orbit.bearing; fromPitch = -(90 - this.orbit.pitch);
    } else {
      const alt = opts.startAlt || 2200;
      fromPos = new THREE.Vector3(x, this.ground(x, z) + alt, z); fromYaw = opts.yaw ?? 0; fromPitch = -89;
    }
    const yaw = opts.yaw ?? fromYaw;
    Object.assign(this.street, { x, z, yaw, pitch: -4, fov: 62 });
    this.mode = "street";
    this._showStreet(true);
    this._fillRocks(x, z);
    this._telemetry();
    this._flight({ pos: fromPos, yaw: fromYaw, pitch: fromPitch, fov: 50 }, { x, z, yaw, pitch: -4, fov: 62 }, 1900);
    return true;
  }
  exitStreet() {
    if (this.mode !== "street") return;
    const s = this.street;
    // sube a una vista aerea y devuelve el control al mapa
    const from = { pos: this.cam.position.clone(), yaw: s.yaw, pitch: s.pitch, fov: s.fov };
    const back = () => {
      this._showStreet(false);
      this.mode = this.prevMode === "card" && this.card ? "card" : "off";
      this.dirty = true;
      const o = this.exitOpts || {};
      this.exitOpts = null;
      if (o.onExit) o.onExit();
    };
    if (this.prevMode === "card") {
      // vuelve a la vista orbital, centrada en el punto visitado
      Object.assign(this.orbit, { x: s.x, z: s.z, bearing: ((s.yaw % 360) + 360) % 360 });
      this.orbit.dist = Math.min(this.orbit.dist, 2500);
      this._clampOrbit();
      this._orbitPose();
      const to = { pos: this.cam.position.clone(), yaw: this.orbit.bearing, pitch: -(90 - this.orbit.pitch), fov: 50 };
      this._flight(from, to, 900, back, true);
    } else {
      const to = { pos: new THREE.Vector3(s.x, this.ground(s.x, s.z) + 1600, s.z), yaw: s.yaw, pitch: -89, fov: 50 };
      this._flight(from, to, 800, back, true);
    }
  }
  // vuelo suave: horizontal con ease, altura sobre el suelo interpolada en escala logaritmica
  _flight(a, b, ms, done, toPose = false) {
    const ax = a.pos.x, az = a.pos.z, aAlt = Math.max(EYE_M, a.pos.y - this.ground(ax, az));
    const bx = b.pos ? b.pos.x : b.x, bz = b.pos ? b.pos.z : b.z, bAlt = b.pos ? Math.max(EYE_M, b.pos.y - this.ground(bx, bz)) : EYE_M;
    let dy = (b.yaw - a.yaw) % 360; if (dy > 180) dy -= 360; if (dy < -180) dy += 360;
    this.anim = { t0: performance.now(), ms, done, step: (u) => {
      const e = ease(u), x = ax + (bx - ax) * e, z = az + (bz - az) * e;
      const alt = Math.exp(Math.log(aAlt) + (Math.log(bAlt) - Math.log(aAlt)) * e);
      // al bajar, la mirada se levanta hacia el horizonte al final; al subir, mira abajo pronto
      const pe = toPose ? smooth(0, 0.6, u) : smooth(0.35, 1, u);
      const c = this.cam;
      c.position.set(x, this.ground(x, z) + alt, z);
      c.rotation.set((a.pitch + (b.pitch - a.pitch) * pe) * D2R, -(a.yaw + dy * e) * D2R, 0, "YXZ");
      c.fov = a.fov + (b.fov - a.fov) * e;
      c.near = Math.max(0.12, Math.min(20, alt * 0.01)); c.far = Math.max(40000, alt * 8);
    } };
  }
  _stepAnim(now) {
    const A = this.anim, u = Math.min(1, (now * 1000 - A.t0) / A.ms);
    A.step(Math.max(0, u));
    this.dirty = true;
    if (u >= 1) { this.anim = null; if (A.done) A.done(); }
  }
  _fillRocks(x, z) { if (this.rocks) this.S.updateRocks(x, z, this.rocks); }

  _showStreet(on) {
    $("scrStreet").hidden = !on;
    document.body.classList.toggle("sv-on", on);
    if (on) { this._resizeStreet(); $("svCanvas").focus({ preventScroll: true }); this._hint(); }
    else { this.hover = null; }
  }
  _resizeStreet() {
    const cv = $("svCanvas"), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
  }
  _renderStreet() {
    const W = innerWidth, H = innerHeight;
    if (!this.anim) this._streetPose();
    this._render(W, H, 0, 0);
    const cv = $("svCanvas"), ctx = cv.getContext("2d"), dpr = cv.width / W;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (this.anim) { this._compass(); return; }
    this._drawMarkers(ctx, W, H, true);
    this._drawCursor(ctx, W, H);
    this._heading(ctx, W);
    this._compass();
  }
  // disco en el suelo bajo el puntero: a donde se salta con un clic
  _drawCursor(ctx, W, H) {
    const h = this.hover;
    if (!h) return;
    const ok = h.inside && h.dist < 600;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2, x = h.x + Math.cos(a) * 1.6, z = h.z + Math.sin(a) * 1.6;
      const p = this.project(x, this.ground(x, z) + 0.05, z, W, H);
      if (!p) return;
      pts.push(p);
    }
    ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
    ctx.fillStyle = ok ? "rgba(255,255,255,.18)" : "rgba(255,77,77,.16)"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = ok ? "rgba(255,255,255,.85)" : "rgba(255,120,120,.8)"; ctx.stroke();
  }
  // cinta de rumbo arriba: N, NE, E... y la direccion de cada marcador
  _heading(ctx, W) {
    const yaw = this.street.yaw, fov = this.cam.fov * this.cam.aspect, cx = W / 2, w = Math.min(560, W - 40), y = 22;
    const pxDeg = w / Math.max(40, Math.min(160, fov));
    ctx.fillStyle = "rgba(12,10,14,.55)"; ctx.fillRect(cx - w / 2, 6, w, 30);
    ctx.save(); ctx.beginPath(); ctx.rect(cx - w / 2, 6, w, 30); ctx.clip();
    const names = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"].map((s, i) => (getLang() === "en" ? ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][i] : s));
    ctx.textAlign = "center"; ctx.font = "700 13px Rajdhani, sans-serif";
    for (let a = 0; a < 360; a += 15) {
      let d = a - yaw; d = ((d + 540) % 360) - 180;
      const x = cx + d * pxDeg;
      if (x < cx - w / 2 - 20 || x > cx + w / 2 + 20) continue;
      ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, 30); ctx.lineTo(x, a % 45 ? 34 : 36); ctx.stroke();
      if (a % 45 === 0) { ctx.fillStyle = a === 0 ? "#FF8A65" : "#F6EDE4"; ctx.fillText(names[a / 45], x, y + 4); }
    }
    const eye = this.cam.position, ll0 = this.geo.toLatLon(eye.x, eye.z);
    for (const m of this.markers) {
      if (m.kind === "feature") continue;
      const ll = this.geo.toLatLon(m.x, m.z);
      if (Math.hypot(m.x - eye.x, m.z - eye.z) < 3) continue;
      let d = gcBearing(ll0.lat, ll0.lon, ll.lat, ll.lon) - yaw; d = ((d + 540) % 360) - 180;
      const x = cx + d * pxDeg;
      ctx.fillStyle = m.color || "#fff"; ctx.beginPath(); ctx.moveTo(x, 9); ctx.lineTo(x - 4, 14); ctx.lineTo(x + 4, 14); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = "#FFC23D"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, 6); ctx.lineTo(cx, 36); ctx.stroke();
    ctx.textAlign = "left";
  }

  // Ficha del punto: los mismos datos que el atlas y la estimacion de rutas (World + Game)
  _telemetry() {
    const s = this.street, W = this.world, g = this.game, lang = getLang();
    const ll = this.geo.toLatLon(s.x, s.z);
    const elev = W.demHeight(s.x, s.z) + W.yRef;
    const cls = this.data.layers.layers.spectral.classes, ci = W.spectral(s.x, s.z);
    const rock = W.rockClass(s.x, s.z), blocked = W.blockedAt(s.x, s.z);
    const row = (k, v) => `<tr><td>${t(k)}</td><td>${v}</td></tr>`;
    $("svData").innerHTML = `<table class="kv">
      ${row(L("Latitud", "Latitude"), fmtLat(ll.lat))}
      ${row(L("Longitud", "Longitude"), fmtLon(ll.lon))}
      ${row(L("Elevación", "Elevation"), `${num(elev, 1, lang)} m`)}
      ${row(L("Pendiente", "Slope"), `${num(W.slope(s.x, s.z), 1, lang)}°${blocked ? ` <i class="bad">${t(L("intransitable", "impassable"))}</i>` : ""}`)}
      ${row(L("T. del suelo", "Ground T"), `${num(g.tempAt(s.x, s.z, g.hour), 0, lang)} °C <span class="muted">${hhmm(g.hour)} LMST</span>`)}
      ${row(L("Radiación", "Radiation"), `${num(W.radiation(s.x, s.z), 2, lang)} µGy/h`)}
      ${row(L("Mineral (CRISM)", "Mineral (CRISM)"), t(cls[ci]) || "—")}
      ${row(L("Terreno", "Terrain"), t([L("Liso", "Smooth"), L("Rocoso", "Rocky"), L("Campo de bloques", "Boulder field")][rock]))}
    </table>`;
  }
  _hint(text) {
    $("svHint").textContent = text || t(L(
      "Arrastra para mirar alrededor · rueda o pellizco = zoom · clic en el suelo para saltar ahí · Esc vuelve al mapa aéreo",
      "Drag to look around · wheel or pinch = zoom · click the ground to jump there · Esc returns to the aerial map"));
  }
  applyLang() {
    if (this.mode === "street") { this._telemetry(); this._hint(); }
    this.dirty = true;
  }

  _bindStreet() {
    const cv = $("svCanvas");
    if (!cv) return;
    const touches = new Map();
    let drag = null, moved = 0, two = null;
    const s = this.street;
    const evt = (e) => ({ x: e.clientX, y: e.clientY });
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    cv.addEventListener("pointerdown", (e) => {
      if (this.anim) return;
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      drag = [e.clientX, e.clientY]; moved = 0; two = null;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
    });
    cv.addEventListener("pointermove", (e) => {
      if (this.mode !== "street" || this.anim) return;
      if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size === 2) {
        const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (two) s.fov = Math.max(22, Math.min(85, s.fov * (two / Math.max(1, d))));
        two = d; moved = 99; drag = null; this.hover = null;
        return;
      }
      if (drag) {
        // "agarrar" el paisaje: el punto bajo el dedo sigue al dedo
        const dx = e.clientX - drag[0], dy = e.clientY - drag[1], k = s.fov / innerHeight;
        moved += Math.abs(dx) + Math.abs(dy);
        s.yaw = (((s.yaw - dx * k) % 360) + 360) % 360;
        s.pitch = Math.max(-80, Math.min(70, s.pitch + dy * k));
        drag = [e.clientX, e.clientY];
        if (moved > 5) this.hover = null;
        return;
      }
      if (e.pointerType === "mouse") { const p = evt(e); this._streetPose(); this.cam.aspect = innerWidth / innerHeight; this.cam.updateProjectionMatrix(); this.cam.updateMatrixWorld(true); this.hover = this.pick(p.x, p.y, innerWidth, innerHeight); }
    });
    const end = (e) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) two = null;
      if (drag && moved < 6 && this.mode === "street" && !this.anim) this._jumpAt(e.clientX, e.clientY);
      drag = null;
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", (e) => { touches.delete(e.pointerId); drag = null; two = null; });
    cv.addEventListener("pointerleave", () => { this.hover = null; });
    cv.addEventListener("wheel", (e) => { e.preventDefault(); s.fov = Math.max(22, Math.min(85, s.fov * Math.exp(e.deltaY * 0.001))); }, { passive: false });
    $("svBack").onclick = () => this.exitStreet();
    // teclado (fase de captura: va antes que los atajos del juego y del atlas)
    window.addEventListener("keydown", (e) => {
      if (this.mode !== "street") return;
      const k = e.key.toLowerCase();
      if (k === "escape" || k === "m" || k === "backspace") { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat && !this.anim) this.exitStreet(); return; }
      const rot = { arrowleft: [-6, 0], arrowright: [6, 0], arrowup: [0, 4], arrowdown: [0, -4], a: [-6, 0], d: [6, 0] }[k];
      if (rot) { e.preventDefault(); s.yaw = (((s.yaw + rot[0]) % 360) + 360) % 360; s.pitch = Math.max(-80, Math.min(70, s.pitch + rot[1])); }
      if (k === "w" || k === "s") { e.preventDefault(); if (!e.repeat && !this.anim) this._step(k === "w" ? 12 : -12); }
      if (k === "+" || k === "=") s.fov = Math.max(22, s.fov / 1.15);
      if (k === "-") s.fov = Math.min(85, s.fov * 1.15);
      // el resto de teclas no llega al juego mientras se mira desde el suelo
      e.stopImmediatePropagation();
    }, true);
    window.addEventListener("resize", () => { if (this.mode === "street") this._resizeStreet(); this.dirty = true; });
  }
  _jumpAt(px, py) {
    this._streetPose();
    this.cam.aspect = innerWidth / innerHeight; this.cam.updateProjectionMatrix(); this.cam.updateMatrixWorld(true);
    const h = this.pick(px, py, innerWidth, innerHeight);
    if (!h) return;
    if (!h.inside) { this._hint(t(L("Fuera de la zona EVA no hay datos de 6 m: elige un punto dentro del recorte.", "Outside the EVA zone there is no 6 m data: pick a point inside the crop."))); return; }
    if (h.dist > 600) { this._hint(t(L("Demasiado lejos para un salto (máx. 600 m): acércate por pasos o vuelve al mapa aéreo.", "Too far for one jump (max 600 m): move in steps or return to the aerial map."))); return; }
    this._goTo(h.x, h.z);
  }
  _step(m) {
    const s = this.street, b = s.yaw * D2R, h = this.world.half - 12;
    const x = Math.max(-h, Math.min(h, s.x + Math.sin(b) * m)), z = Math.max(-h, Math.min(h, s.z - Math.cos(b) * m));
    this._goTo(x, z);
  }
  _goTo(x, z) {
    const s = this.street, from = { pos: this.cam.position.clone(), yaw: s.yaw, pitch: s.pitch, fov: s.fov };
    const d = Math.hypot(x - s.x, z - s.z);
    this.hover = null;
    this._flight(from, { x, z, yaw: s.yaw, pitch: s.pitch, fov: s.fov }, Math.min(1200, 350 + d * 2), () => {
      s.x = x; s.z = z;
      this._fillRocks(x, z);
      this._telemetry();
      this._hint();
    });
    // la altura de vuelo es la de los ojos en los dos extremos: el salto va pegado al suelo
  }
}
