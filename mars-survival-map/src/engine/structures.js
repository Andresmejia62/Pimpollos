import * as THREE from "three";
import { UP, std, glow, at, box, cyl, ball, castAll, MAT, dish, makeWheel } from "./props.js";

// Estructuras que pueblan el mapa. Sus posiciones vienen de public/layers/structures.json, que
// data/scripts/build_structures.mjs calcula con la traza de Curiosity y las capas de NASA.
// Todas registran sus obstaculos en ms.colliders (con altura: lo bajo se pisa o se salta) y los
// objetos sueltos (cajas, bidones, rocas) son cuerpos de ms.dynamics con la gravedad de Marte.

const M = {
  white: std("#f1eee8", 0.7),
  foil: std("#c79a3c", 0.35, 0.6, { emissive: "#3d2a08", emissiveIntensity: 0.5 }),   // manta termica dorada
  black: std("#18191c", 0.8),
  alu: std("#9da2ab", 0.45, 0.6),
  tarp: std("#7a8a6b", 0.95),
  chute: std("#e8e2d6", 0.9, 0, { side: THREE.DoubleSide }),
  tailings: std("#cdc6ba", 1),                                                            // polvo gris de la perforacion
  dome: std("#cfeedd", 0.1, 0, { transparent: true, opacity: 0.3, depthWrite: false, emissive: "#1d4a35", emissiveIntensity: 0.5 }),
  plant: std("#3f8f4a", 0.9, 0, { emissive: "#123d18", emissiveIntensity: 0.6 }),
  grow: glow("#ff7ad9", 1.4),
  rock: std("#7b4e36", 1, 0, { flatShading: true }),
  // luces intermitentes compartidas: una sola animacion para todo el mapa
  blinkRed: glow("#ff4d4d", 2),
  blinkBlue: glow("#7fd1ff", 2),
  blinkGreen: glow("#3ddc97", 2),
  blinkAmber: glow("#ffb02e", 2),
};

// numero pseudoaleatorio estable por estructura (0..1)
function seeded(id) {
  let s = 2166136261;
  for (let i = 0; i < id.length; i++) s = Math.imul(s ^ id.charCodeAt(i), 16777619) >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// cilindro entre dos puntos (patas, tirantes, tubos)
function strut(x1, y1, z1, x2, y2, z2, r, mat) {
  const a = new THREE.Vector3(x1, y1, z1), b = new THREE.Vector3(x2, y2, z2);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 6), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, b.sub(a).normalize());
  return m;
}

// Grupo vertical en el sitio, girado `yaw`; gy(lx, lz) = desnivel del suelo en coordenadas locales
function site(ms, e, yaw = 0) {
  const g = new THREE.Group();
  const y0 = ms.heightAt(e.x, e.z);
  g.position.set(e.x, y0, e.z);
  g.rotation.y = yaw;
  const col = ms.colliders.frame(e.x, e.z, yaw);
  const gy = (lx, lz) => ms.heightAt(col.wx(lx, lz), col.wz(lx, lz)) - y0;
  return { g, y0, gy, col };
}

function finish(ms, e, g) {
  castAll(g);
  ms.scene.add(g);
  ms.structures.push({ group: g, x: e.x, z: e.z });
  return g;
}

// ---- cuerpos sueltos -------------------------------------------------------------------------------
// Masas reales: pesan el 38 % que en la Tierra, pero tienen la misma inercia.
const BODY = {
  crate: { r: 0.55, h: 0.7, mass: 70, mu: 0.55, rest: 0.1, roll: false },
  barrel: { r: 0.48, h: 0.64, mass: 45, rest: 0.25, roll: true },
  canister: { r: 0.22, h: 0.26, mass: 4, rest: 0.3, roll: true },
  boulder: { r: 0.5, h: 0.95, mass: 600, rest: 0.2, roll: true },
};
const bodyGeo = {};
function bodyMesh(kind, rnd) {
  const d = BODY[kind];
  if (kind === "crate") {
    bodyGeo.crate ||= new THREE.BoxGeometry(0.8, 0.7, 0.8);
    const m = new THREE.Mesh(bodyGeo.crate, rnd() < 0.5 ? MAT.accent : MAT.hull2);
    m.add(box(0.82, 0.08, 0.82, M.alu, 0, 0.2, 0), box(0.82, 0.08, 0.82, M.alu, 0, -0.2, 0));
    return m;
  }
  if (kind === "boulder") {
    bodyGeo.boulder ||= new THREE.IcosahedronGeometry(d.h / 2, 1);
    return new THREE.Mesh(bodyGeo.boulder, M.rock);
  }
  // bidon o bote de muestras: cilindro tumbado, con el eje perpendicular a la marcha
  const len = kind === "barrel" ? 0.9 : 0.4;
  bodyGeo[kind] ||= new THREE.CylinderGeometry(d.h / 2, d.h / 2, len, 14).rotateZ(Math.PI / 2);
  const m = new THREE.Mesh(bodyGeo[kind], kind === "barrel" ? MAT.metal : M.white);
  m.add(cyl(d.h / 2 + 0.01, d.h / 2 + 0.01, len * 0.14, MAT.accent, 0, 0, 0, 14).rotateZ(Math.PI / 2));
  return m;
}

function spawnBody(ms, kind, x, z, rnd) {
  const mesh = bodyMesh(kind, rnd);
  mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  ms.scene.add(mesh);
  const b = ms.dynamics.add({ kind, x, z, yaw: rnd() * Math.PI * 2, ...BODY[kind] });
  b.mesh = mesh;
  return b;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _n = new THREE.Vector3(), _X = new THREE.Vector3(1, 0, 0);
function syncBody(ms, b) {
  if (b.y == null) b.y = ms.heightAt(b.x, b.z);
  const m = b.mesh;
  m.position.set(b.x, b.y + b.h / 2, b.z);
  if (b.roll) m.quaternion.setFromAxisAngle(UP, b.dir).multiply(_q.setFromAxisAngle(_X, b.spin));
  else m.quaternion.setFromUnitVectors(UP, ms.normalAt(b.x, b.z, _n)).multiply(_q2.setFromAxisAngle(UP, b.yaw));
  b.dirty = false;
}

// ---- Base Aeolis -------------------------------------------------------------------------------------
function buildLandingPad(ms, e, rnd) {
  const { g, y0, gy, col } = site(ms, e);
  const R = 11;
  // la losa queda a ras del lado mas alto del terreno; por los demas lados hay que saltar
  let top = 0;
  for (let i = 0; i < 16; i++) top = Math.max(top, gy(Math.cos(i * 0.3927) * R, Math.sin(i * 0.3927) * R));
  top += 0.12;
  g.add(cyl(R, R + 0.7, 3.6, MAT.base, 0, top - 1.8, 0, 40));
  const ring = at(new THREE.Mesh(new THREE.TorusGeometry(R - 1.2, 0.18, 4, 48), MAT.accent), 0, top, 0);
  ring.rotation.x = Math.PI / 2;
  ring.scale.z = 0.15;
  g.add(ring, box(7, 0.04, 0.9, M.white, 0, top + 0.01, 0), box(0.9, 0.04, 7, M.white, 0, top + 0.01, 0));
  for (let i = 0; i < 6; i++) g.add(ball(0.16, M.blinkAmber, Math.cos(i * 1.047) * (R - 0.4), top + 0.12, Math.sin(i * 1.047) * (R - 0.4), 8));
  // vehiculo de ascenso sobre tres patas
  const b0 = top + 1.0;
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094 + 0.5;
    g.add(strut(Math.cos(a) * 1.0, b0 + 0.9, Math.sin(a) * 1.0, Math.cos(a) * 2.4, top, Math.sin(a) * 2.4, 0.09, M.alu), cyl(0.3, 0.3, 0.06, M.alu, Math.cos(a) * 2.4, top + 0.03, Math.sin(a) * 2.4, 10));
  }
  g.add(cyl(0.55, 0.9, 0.9, M.black, 0, b0 - 0.3, 0, 16));                       // tobera
  g.add(cyl(1.25, 1.25, 5.2, M.white, 0, b0 + 2.75, 0, 24), cyl(1.27, 1.27, 0.35, MAT.accent, 0, b0 + 4.4, 0, 24), cyl(1.27, 1.27, 0.2, M.black, 0, b0 + 0.9, 0, 24));
  g.add(at(new THREE.Mesh(new THREE.ConeGeometry(1.25, 2.3, 24), M.white), 0, b0 + 6.5, 0), ball(0.14, M.blinkRed, 0, b0 + 7.7, 0, 8));
  for (const a of [0, 1.571, 3.142, 4.712]) g.add(box(0.06, 1.3, 0.8, MAT.accent, Math.cos(a) * 1.55, b0 + 0.9, Math.sin(a) * 1.55).rotateY(-a));
  col.circle(0, 0, R, y0 + top);
  col.circle(0, 0, 2.5);
  // depositos de combustible (metano y oxigeno fabricados aqui)
  for (const s of [-1, 1]) {
    const lx = R + 3.6, lz = s * 2.3, y = gy(lx, lz);
    g.add(ball(1.5, s < 0 ? M.white : MAT.metal, lx, y + 2.0, lz, 18), cyl(1.0, 1.3, 0.6, M.black, lx, y + 0.3, lz, 12));
    col.circle(lx, lz, 1.6);
  }
  g.add(strut(R + 2.2, gy(R + 2.2, 0) + 0.35, 0, 2.4, top + 0.3, 0, 0.08, M.alu));
  for (let i = 0; i < 2; i++) spawnBody(ms, "barrel", col.wx(R + 5 + rnd() * 2, -5 + i * 9), col.wz(R + 5, -5 + i * 9), rnd);
  return finish(ms, e, g);
}

function buildSolarFarm(ms, e, rnd) {
  const { g, y0, gy, col } = site(ms, e, rnd() * 0.5 - 0.25);
  const panelGeo = new THREE.BoxGeometry(4.6, 0.08, 2.6), postGeo = new THREE.CylinderGeometry(0.08, 0.1, 1, 8);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    const lx = (c - 1.5) * 5.6, lz = (r - 1) * 6.2 - 1, y = gy(lx, lz);
    const post = at(new THREE.Mesh(postGeo, MAT.metal), lx, y + 0.95, lz);
    post.scale.y = 1.9;
    const panel = at(new THREE.Mesh(panelGeo, MAT.solar), lx, y + 1.95, lz);
    panel.rotation.x = 0.45;
    g.add(post, panel);
    col.circle(lx, lz, 0.22);
  }
  // contenedor de baterias
  const bx = 0, bz = 10.5, by = gy(bx, bz);
  g.add(box(5.2, 2.4, 2.4, MAT.hull2, bx, by + 1.3, bz), box(5.24, 0.3, 2.44, MAT.accent, bx, by + 2.0, bz), box(5.3, 0.25, 2.5, M.black, bx, by + 0.12, bz), ball(0.12, M.blinkGreen, 2.3, by + 2.6, bz, 8));
  col.box(bx, bz, 2.6, 1.2, y0 + by + 2.5);
  return finish(ms, e, g);
}

function buildIsru(ms, e, rnd) {
  const { g, y0, gy, col } = site(ms, e, rnd() * 6.28);
  g.add(box(9, 1.6, 7, MAT.base, 0, -0.5, 0));                                    // losa (se puede pisar)
  col.box(0, 0, 4.5, 3.5, y0 + 0.3);
  g.add(cyl(1.8, 1.8, 4.6, M.white, -2, 2.6, -0.6, 24), ball(1.8, M.white, -2, 4.9, -0.6, 24), cyl(1.83, 1.83, 0.4, MAT.accent, -2, 3.6, -0.6, 24));
  col.circle(-2, -0.6, 1.9);
  for (const s of [0, 1]) {
    g.add(at(new THREE.Mesh(new THREE.CapsuleGeometry(0.8, 1.9, 4, 14), MAT.metal), 1.4 + s * 1.9, 1.95, -1.6));
    col.circle(1.4 + s * 1.9, -1.6, 0.85);
  }
  g.add(box(2.4, 1.6, 1.8, MAT.hull2, 2.2, 1.1, 1.7), cyl(0.6, 0.6, 0.1, M.black, 2.2, 1.95, 1.7, 14), box(2.44, 0.2, 1.84, M.black, 2.2, 0.45, 1.7));
  col.box(2.2, 1.7, 1.2, 0.9, y0 + 1.9);
  g.add(strut(-0.3, 1.2, -0.6, 1.4, 1.2, -1.6, 0.09, M.alu), strut(2.2, 1.9, 0.9, 2.4, 2.6, -1.6, 0.07, M.alu), strut(-2, 0.6, 1.2, 1.0, 0.6, 1.7, 0.09, M.alu));
  g.add(cyl(0.12, 0.16, 5.5, M.alu, -3.6, 3.05, 2.4, 8), ball(0.16, M.blinkGreen, -3.6, 5.9, 2.4, 8));
  col.circle(-3.6, 2.4, 0.2);
  for (let i = 0; i < 2; i++) spawnBody(ms, i ? "barrel" : "crate", col.wx(6.5 + i * 1.6, 1 - i * 2), col.wz(6.5 + i * 1.6, 1 - i * 2), rnd);
  void gy;
  return finish(ms, e, g);
}

function buildGreenhouse(ms, e, rnd) {
  const { g, col } = site(ms, e, rnd() * 6.28);
  g.add(cyl(5.0, 5.3, 2.4, MAT.base, 0, -0.8, 0, 32), cyl(4.9, 4.9, 0.25, MAT.hull, 0, 0.5, 0, 32));
  for (let i = 0; i < 3; i++) {
    const lz = (i - 1) * 2.3;
    g.add(box(i === 1 ? 7.4 : 5.6, 0.5, 1.3, M.black, 0, 0.85, lz), box(i === 1 ? 7.2 : 5.4, 0.5, 1.1, M.plant, 0, 1.2, lz));
  }
  g.add(box(6.5, 0.08, 0.25, M.grow, 0, 3.6, 0), box(0.25, 0.08, 5, M.grow, 0, 3.6, 0));
  for (let i = 0; i < 6; i++) {
    const rib = at(new THREE.Mesh(new THREE.TorusGeometry(4.82, 0.07, 6, 20, Math.PI / 2), MAT.hull2), 0, 0.6, 0);
    rib.rotation.y = (i / 6) * Math.PI * 2;
    g.add(rib);
  }
  castAll(g);
  // la cupula transparente no proyecta sombra y se dibuja al final
  const dome = at(new THREE.Mesh(new THREE.SphereGeometry(4.8, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2), M.dome), 0, 0.6, 0);
  dome.renderOrder = 3;
  const lock = new THREE.Group();
  lock.add(box(2, 2.4, 2.6, MAT.hull, 0, 1.3, 5.6), box(1.2, 2.0, 0.1, MAT.dark, 0, 1.2, 6.92), box(1.3, 0.1, 0.08, M.blinkGreen, 0, 2.35, 6.93));
  castAll(lock);
  g.add(lock, dome);
  col.circle(0, 0, 5.1);
  col.box(0, 5.8, 1.05, 1.4);
  ms.scene.add(g);
  ms.structures.push({ group: g, x: e.x, z: e.z });
  return g;
}

// ---- ciencia ------------------------------------------------------------------------------------------
function buildDrillSite(ms, e, rnd) {
  const { g, col } = site(ms, e, rnd() * 6.28);
  // el agujero real mide 1,6 cm; aqui esta agrandado para que se vea, con su anillo de polvo gris
  g.add(cyl(0.55, 0.6, 0.03, M.tailings, 0, 0.03, 0, 20), cyl(0.09, 0.09, 0.04, M.black, 0, 0.05, 0, 10));
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094;
    g.add(strut(Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95, 0, 1.85, 0, 0.03, M.alu));
  }
  g.add(ball(0.11, M.blinkBlue, 0, 1.95, 0, 8), cyl(0.05, 0.05, 0.5, M.alu, 0, 1.6, 0, 6));
  g.add(cyl(0.03, 0.03, 1.1, M.alu, 1.25, 0.55, 0.2, 6), box(0.6, 0.4, 0.04, MAT.accent, 1.25, 1.2, 0.2).rotateY(0.5));
  g.add(box(0.6, 0.3, 0.35, MAT.metal, -1.1, 0.2, 0.7));
  for (let i = 0; i < 3; i++) g.add(cyl(0.04, 0.04, 0.2, M.white, -1.28 + i * 0.18, 0.43, 0.7, 8));
  col.circle(0, 0, 0.5);
  col.box(-1.1, 0.7, 0.3, 0.18, g.position.y + 0.38);
  spawnBody(ms, "canister", col.wx(1.9, -1.2), col.wz(1.9, -1.2), rnd);
  return finish(ms, e, g);
}

function buildRelay(ms, e, rnd) {
  const { g, col } = site(ms, e, rnd() * 6.28);
  g.add(box(1.7, 1.2, 1.7, M.black, 0, 0.1, 0));
  const H = 9.5;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.add(strut(sx * 0.75, 0.6, sz * 0.75, sx * 0.14, H, sz * 0.14, 0.05, M.alu));
  for (const y of [2.6, 4.8, 7]) {
    const k = 0.75 - ((y - 0.6) / (H - 0.6)) * 0.61;
    const hoop = at(new THREE.Mesh(new THREE.TorusGeometry(k * 1.414, 0.035, 4, 4), M.alu), 0, y, 0);
    hoop.rotation.set(Math.PI / 2, 0, Math.PI / 4);
    g.add(hoop);
  }
  g.add(cyl(0.05, 0.07, 3.2, M.alu, 0, H + 1.5, 0, 8), ball(0.16, M.blinkRed, 0, H + 3.2, 0, 8));
  const d1 = dish(0.75), d2 = dish(0.55);
  d1.rotation.set(1.2, 0, 0); d2.rotation.set(1.2, 2.4, 0);
  g.add(at(d1, 0, H - 1.2, 0.35), at(d2, 0.3, H + 0.4, -0.25));
  const sol = box(1.6, 0.05, 1.0, MAT.solar, 1.5, 1.5, 0);
  sol.rotation.x = 0.45;
  g.add(sol, strut(0.7, 0.6, 0, 1.5, 1.45, 0, 0.04, M.alu), box(0.6, 0.5, 0.45, M.foil, -0.2, 0.95, 0.5));
  col.box(0, 0, 0.9, 0.9);
  // una roca suelta en la cima: si se empuja, rueda ladera abajo
  const a = rnd() * 6.28;
  spawnBody(ms, "boulder", e.x + Math.cos(a) * 3.2, e.z + Math.sin(a) * 3.2, rnd);
  return finish(ms, e, g);
}

function buildDepot(ms, e, rnd) {
  const { g, y0, gy, col } = site(ms, e, rnd() * 6.28);
  g.add(box(3.4, 0.5, 2.0, M.black, -0.2, -0.1, -0.5));
  g.add(box(1.25, 1.0, 1.25, MAT.accent, -1.0, 0.65, -0.5), box(1.25, 1.0, 1.25, MAT.hull2, 0.45, 0.65, -0.5), box(1.05, 0.9, 1.05, M.tarp, -0.25, 1.6, -0.5));
  g.add(box(2.8, 0.05, 0.12, M.alu, -0.27, 1.0, 0.14), box(2.8, 0.05, 0.12, M.alu, -0.27, 0.45, 0.14));
  col.box(-0.27, -0.5, 1.4, 0.65, y0 + 1.15);
  col.box(-0.25, -0.5, 0.53, 0.53, y0 + 2.05);
  // botellas de oxigeno
  const ty = gy(1.9, 1.3);
  for (let i = 0; i < 3; i++) g.add(at(new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.0, 4, 10), i === 1 ? M.white : MAT.metal), 1.3 + i * 0.62, ty + 0.8, 1.3));
  g.add(box(2.1, 0.1, 0.75, M.black, 1.92, ty + 0.05, 1.3));
  col.box(1.92, 1.3, 1.0, 0.36, y0 + ty + 1.6);
  // banderin y luz para encontrarlo de lejos
  g.add(cyl(0.03, 0.04, 4.2, M.alu, -2.4, 2.1, 0.6, 6), box(0.8, 0.45, 0.02, MAT.accent, -1.98, 3.9, 0.6), ball(0.11, M.blinkGreen, -2.4, 4.3, 0.6, 8));
  col.circle(-2.4, 0.6, 0.1);
  // paracaidas de la entrega, medio enterrado por el polvo
  const cx = 5 + rnd() * 2, cz = -3 + rnd() * 5;
  const chute = at(new THREE.Mesh(new THREE.SphereGeometry(2.6, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.chute), cx, gy(cx, cz) - 0.05, cz);
  chute.scale.set(1, 0.16, 0.8);
  g.add(chute);
  finish(ms, e, g);
  chute.castShadow = false;
  // carga suelta alrededor: cajas (resbalan) y bidones (ruedan)
  for (let i = 0; i < 5; i++) {
    const a = rnd() * 6.28, d = 3.2 + rnd() * 2.5;
    spawnBody(ms, i < 3 ? "crate" : "barrel", e.x + Math.cos(a) * d, e.z + Math.sin(a) * d, rnd);
  }
  return g;
}

function buildWeather(ms, e, rnd) {
  const { g, col } = site(ms, e, rnd() * 6.28);
  for (let i = 0; i < 3; i++) g.add(strut(Math.cos(i * 2.094) * 0.7, 0, Math.sin(i * 2.094) * 0.7, 0, 0.9, 0, 0.03, M.alu));
  g.add(cyl(0.04, 0.04, 2.6, M.alu, 0, 1.6, 0, 8));
  // dos brazos de sensores a 120 grados, como los de REMS en el mastil de Curiosity
  g.add(strut(0, 1.7, 0, 0.62, 1.7, 0, 0.025, M.white), strut(0, 1.9, 0, -0.31, 1.9, 0.54, 0.025, M.white), box(0.1, 0.07, 0.07, M.black, 0.64, 1.7, 0), box(0.1, 0.07, 0.07, M.black, -0.33, 1.9, 0.56));
  g.add(box(0.22, 0.06, 0.22, M.black, 0, 2.93, 0), ball(0.07, M.blinkBlue, 0, 3.02, 0, 8));
  const sol = box(0.8, 0.03, 0.55, MAT.solar, 0, 1.15, -0.5);
  sol.rotation.x = -0.5;
  g.add(sol, box(0.4, 0.35, 0.3, M.foil, 0.1, 0.5, 0.15));
  col.circle(0, 0, 0.4);
  return finish(ms, e, g);
}

function buildSeismic(ms, e, rnd) {
  const { g, y0, gy, col } = site(ms, e, rnd() * 6.28);
  // cupula contra el viento y el frio, con faldon, como la de SEIS
  g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.85, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.white), 0, 0.1, 0), cyl(0.9, 1.1, 0.3, M.foil, 0, 0.1, 0, 20));
  col.circle(0, 0, 0.95, y0 + 0.95);
  const ly = gy(4.2, 0);
  g.add(strut(0.9, 0.06, 0, 3.4, ly + 0.5, 0, 0.03, M.foil));
  // modulo de aterrizaje con dos paneles circulares
  g.add(box(1.6, 0.45, 1.6, M.foil, 4.2, ly + 0.85, 0), cyl(0.5, 0.5, 0.08, M.white, 4.2, ly + 1.12, 0, 12));
  for (let i = 0; i < 3; i++) g.add(strut(4.2 + Math.cos(i * 2.094) * 0.6, ly + 0.65, Math.sin(i * 2.094) * 0.6, 4.2 + Math.cos(i * 2.094) * 1.15, ly, Math.sin(i * 2.094) * 1.15, 0.04, M.alu));
  for (const s of [-1, 1]) g.add(cyl(1.05, 1.05, 0.04, MAT.solar, 4.2, ly + 0.98, s * 1.85, 10));
  g.add(cyl(0.02, 0.02, 0.9, M.alu, 4.6, ly + 1.55, 0.4, 6), ball(0.06, M.blinkBlue, 4.6, ly + 2.02, 0.4, 8));
  col.box(4.2, 0, 0.9, 2.9, y0 + ly + 1.05);
  return finish(ms, e, g);
}

// ---- Curiosity: 3 m de largo, 2,7 de ancho, mastil a 2,2 m; seis ruedas con balancin ---------------------
function buildCuriosity(ms, e) {
  const g = new THREE.Group();
  const yaw = e.heading_rad || 0;
  g.position.set(e.x, ms.heightAt(e.x, e.z), e.z);
  g.quaternion.setFromUnitVectors(UP, ms.normalAt(e.x, e.z)).multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
  const dusty = std("#b9aa98", 0.85), wheelMat = std("#8d8880", 0.5, 0.6);
  const R = 0.26, WX = 1.2, WZ = [-1.2, 0.1, 1.15];
  for (const s of [-1, 1]) {
    for (const wz of WZ) {
      const w = makeWheel(R, 0.4, wheelMat);
      w.root.position.set(s * WX, R, wz);
      g.add(w.root);
    }
    // balancin (rocker) y bogie
    const x = s * 0.98;
    g.add(strut(x, R + 0.12, WZ[0], x, 0.95, -0.25, 0.045, M.alu), strut(x, 0.95, -0.25, x, 0.62, 0.62, 0.045, M.alu));
    g.add(strut(x, 0.62, 0.62, x, R + 0.12, WZ[1], 0.04, M.alu), strut(x, 0.62, 0.62, x, R + 0.12, WZ[2], 0.04, M.alu));
    g.add(strut(s * 0.8, 0.95, -0.25, x, 0.95, -0.25, 0.05, M.alu));
    for (const wz of WZ) g.add(strut(x, R + 0.12, wz, s * WX, R, wz, 0.04, M.alu));
  }
  // cuerpo: laterales oscuros y cubierta blanca
  g.add(box(1.6, 0.5, 1.9, M.black, 0, 1.02, 0.05), box(1.66, 0.05, 1.96, dusty, 0, 1.3, 0.05));
  // generador de radioisotopos (RTG) inclinado en la popa, con aletas
  const rtg = new THREE.Group();
  rtg.add(cyl(0.2, 0.2, 0.75, M.white, 0, 0, 0, 12), box(0.72, 0.6, 0.03, dusty, 0, 0, 0), box(0.03, 0.6, 0.72, dusty, 0, 0, 0));
  rtg.position.set(0, 1.42, 1.22);
  rtg.rotation.x = 1.0;
  g.add(rtg);
  // mastil con la "cabeza": ChemCam (el ojo grande) y las dos Mastcam
  g.add(cyl(0.05, 0.06, 1.0, dusty, 0.55, 1.8, -0.72, 8), box(0.42, 0.26, 0.26, M.white, 0.55, 2.42, -0.74));
  g.add(cyl(0.085, 0.085, 0.06, M.black, 0.45, 2.44, -0.89, 12).rotateX(Math.PI / 2), box(0.07, 0.07, 0.05, M.black, 0.62, 2.38, -0.88), box(0.07, 0.07, 0.05, M.black, 0.71, 2.38, -0.88));
  // antena de alta ganancia (hexagonal) y antena UHF
  const hga = cyl(0.27, 0.27, 0.03, M.foil, -0.55, 1.72, 0.25, 6);
  hga.rotation.set(0.9, 0.4, 0);
  g.add(hga, cyl(0.03, 0.03, 0.42, M.alu, -0.55, 1.5, 0.25, 6), cyl(0.045, 0.045, 0.3, M.white, -0.6, 1.47, 0.85, 8));
  // brazo robotico plegado delante, con la torreta del taladro
  g.add(strut(-0.5, 1.05, -0.95, -0.55, 1.0, -1.75, 0.05, M.alu), strut(-0.55, 1.0, -1.75, 0.3, 0.92, -1.6, 0.05, M.alu), cyl(0.2, 0.2, 0.26, dusty, 0.42, 0.92, -1.58, 10));
  g.add(box(0.5, 0.18, 0.3, M.foil, 0.2, 1.42, -0.5));
  ms.colliders.addBox(e.x, e.z, 1.5, 1.6, yaw);
  return finish(ms, e, g);
}

// ---- balizas sobre las huellas de Curiosity (instanciadas) --------------------------------------------
function buildTrackPosts(ms, points) {
  if (!points.length) return;
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.045, 1.5, 6), M.alu, points.length);
  const lamp = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.11, 0), M.blinkBlue, points.length);
  const m = new THREE.Matrix4();
  points.forEach(([x, z], i) => {
    const y = ms.heightAt(x, z);
    pole.setMatrixAt(i, m.makeTranslation(x, y + 0.75, z));
    lamp.setMatrixAt(i, m.makeTranslation(x, y + 1.62, z));
  });
  pole.castShadow = true;
  // las instancias cubren todo el mapa: sin esto se descartarian por su esfera envolvente inicial
  pole.frustumCulled = lamp.frustumCulled = false;
  ms.scene.add(pole, lamp);
}

const BUILDERS = {
  landing_pad: buildLandingPad, solar_farm: buildSolarFarm, isru: buildIsru, greenhouse: buildGreenhouse,
  drill_site: buildDrillSite, relay: buildRelay, depot: buildDepot, weather: buildWeather, seismic: buildSeismic,
  curiosity: buildCuriosity,
};

// Construye todo lo que describe structures.json. Devuelve la lista de puntos de interes para el HUD.
export function buildStructures(ms, data) {
  const list = (data && data.structures) || [];
  const posts = (data && data.track_posts && data.track_posts.points) || [];
  for (const e of list) {
    const fn = BUILDERS[e.type];
    if (!fn || !ms.world.inside(e.x, e.z, 20)) continue;
    fn(ms, e, seeded(e.id));
  }
  buildTrackPosts(ms, posts);

  const FAR = 1700, FAR_BODY = 600;
  let next = 0;
  ms.addAnimated((t) => {
    // parpadeos: una rafaga corta cada cierto tiempo, desfasada por color
    M.blinkRed.emissiveIntensity = (t * 0.8) % 1 < 0.15 ? 4 : 0.3;
    M.blinkAmber.emissiveIntensity = (t * 0.5) % 1 < 0.5 ? 2.5 : 0.4;
    M.blinkBlue.emissiveIntensity = 1.3 + Math.sin(t * 2.2) * 0.9;
    M.blinkGreen.emissiveIntensity = 1.4 + Math.sin(t * 3 + 1) * 0.9;
    const bodies = ms.dynamics.bodies;
    for (const b of bodies) if (b.dirty && b.mesh) syncBody(ms, b);
    // lo lejano se oculta (cada 0,4 s) para no gastar dibujado
    if (t < next) return;
    next = t + 0.4;
    const f = ms.focus;
    for (const s of ms.structures) s.group.visible = Math.abs(s.x - f.x) < FAR && Math.abs(s.z - f.z) < FAR;
    for (const b of bodies) if (b.mesh) b.mesh.visible = Math.abs(b.x - f.x) < FAR_BODY && Math.abs(b.z - f.z) < FAR_BODY;
  });
  return list;
}
