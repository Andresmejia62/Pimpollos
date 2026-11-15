import * as THREE from "three";
import { std, glow, at, box, cyl, castAll, MAT } from "./props.js";
import { addWalkIn } from "./interiors.js";

// Colonia Aeolis: cupula presurizada con cultivos y modulos habitables, unida al habitat por una tuberia,
// con un campo solar y un modulo exterior conectado por un tunel. El sitio se elige con el DTM real:
// el terreno mas llano (pendiente maxima baja en toda la huella) a 120-420 m del habitat, lejos de
// otras estructuras y de los objetivos de la mision.
const R = 26;                     // radio de la cupula (m)
const H = 0.62;                   // la cupula es una media esfera achatada: alto = R * H

const M = {
  glass: new THREE.MeshPhysicalMaterial({ color: "#d8ecff", roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, emissive: "#28465c", emissiveIntensity: 0.25 }),
  frame: new THREE.LineBasicMaterial({ color: "#ece6da", transparent: true, opacity: 0.75 }),
  sinter: std("#8a6a55", 0.95),                     // regolito sinterizado (cimientos)
  soil: std("#4f6b3a", 0.95, 0, { emissive: "#18300f", emissiveIntensity: 0.35 }),
  crop: std("#5fae4f", 0.85, 0, { emissive: "#1b4a16", emissiveIntensity: 0.5 }),
  leaf: std("#3f8a45", 0.9, 0, { emissive: "#123d18", emissiveIntensity: 0.45 }),
  trunk: std("#6b5040", 0.9),
  path: std("#cfc8bb", 0.9),
  white: std("#f2efe9", 0.6),
  panel: std("#16264a", 0.3, 0.5, { emissive: "#0b1a3d", emissiveIntensity: 0.6 }),
  window: glow("#ffd9a0", 1.2),
  water: glow("#5ab8ff", 0.9),
  pipe: std("#2a5bd7", 0.5, 0.2),
  pipeBand: std("#e8e2d6", 0.6),
  stripe: std("#d4541c", 0.7),
  lamp: glow("#fff1c8", 1.5),
  green: glow("#3ddc97", 2),
  door: std("#1c2a33", 0.2, 0.4, { emissive: "#ffd9a0", emissiveIntensity: 0.5 }),
  bench: std("#9b7653", 0.8),
  screen: std("#0b1a24", 0.3, 0, { emissive: "#3fa9ff", emissiveIntensity: 1.2 }),
  umbrella: std("#d4541c", 0.8, 0, { side: THREE.DoubleSide }),
};

// Mobiliario de la plaza central: bancos, mesas con sombrilla, quiosco con el mapa y jardineras.
// Devuelve los obstaculos (locales) para registrarlos con la altura del suelo.
function plaza(g) {
  const cols = [];
  const bench = (x, z, rot) => {
    const b = new THREE.Group();
    b.add(box(1.8, 0.08, 0.5, M.bench, 0, 0.48, 0), box(1.8, 0.45, 0.06, M.bench, 0, 0.75, -0.24));
    for (const sx of [-0.8, 0.8]) b.add(box(0.06, 0.48, 0.45, MAT.metal, sx, 0.24, 0));
    b.position.set(x, 0.18, z); b.rotation.y = rot; g.add(b);
    cols.push({ x, z, r: 0.75, top: 0.9 });
  };
  bench(4.6, 4.2, -Math.PI * 0.75); bench(-4.6, 4.2, Math.PI * 0.75); bench(4.4, -3.2, -Math.PI * 0.25);
  // terraza: mesas redondas con sombrilla
  for (const [tx, tz] of [[3.6, 6.2], [-3.2, 6.6], [-2.6, 9.4]]) {
    g.add(cyl(0.55, 0.55, 0.05, M.white, tx, 0.95, tz, 18), cyl(0.05, 0.05, 0.78, MAT.metal, tx, 0.56, tz, 6), cyl(0.03, 0.03, 2.3, MAT.metal, tx, 1.3, tz, 6));
    const um = at(new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.45, 12, 1, true), M.umbrella), tx, 2.45, tz); g.add(um);
    for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.4; g.add(cyl(0.2, 0.2, 0.05, M.bench, tx + Math.cos(a) * 0.85, 0.62, tz + Math.sin(a) * 0.85, 12), cyl(0.03, 0.03, 0.42, MAT.metal, tx + Math.cos(a) * 0.85, 0.4, tz + Math.sin(a) * 0.85, 6)); }
    cols.push({ x: tx, z: tz, r: 0.75, top: 1.1 });
  }
  // quiosco con el mapa de la region (pantalla) junto al cruce de caminos
  g.add(box(0.12, 2.0, 0.12, MAT.metal, 2.2, 1.18, -2.4), box(1.4, 0.9, 0.08, M.screen, 2.2, 1.9, -2.4), box(1.5, 1.0, 0.04, MAT.dark, 2.2, 1.9, -2.46));
  cols.push({ x: 2.2, z: -2.4, r: 0.45, top: 2.5 });
  // jardineras alrededor de la torre
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const px = Math.cos(a) * 3.8, pz = Math.sin(a) * 3.8;
    g.add(cyl(0.6, 0.5, 0.5, M.white, px, 0.43, pz, 14), at(new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), M.crop), px, 0.95, pz));
    cols.push({ x: px, z: pz, r: 0.6, top: 1.0 });
  }
  // fuente sobre el estanque: anillo y surtidor
  g.add(cyl(0.35, 0.5, 1.2, M.white, -12, 0.8, -12, 14), cyl(0.12, 0.12, 0.9, M.water, -12, 1.8, -12, 10));
  cols.push({ x: -12, z: -12, r: 0.6, top: 2.0 });
  return cols;
}

// ---- eleccion del sitio -------------------------------------------------------------------------
function footprintSlope(world, x, z, r) {
  let mx = 0;
  for (const rr of [0, r * 0.5, r, r + 10]) {
    const n = rr ? 16 : 1;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      mx = Math.max(mx, world.slope(x + Math.cos(a) * rr, z + Math.sin(a) * rr));
    }
  }
  return mx;
}
export function findColonySite(world, home, avoid) {
  let best = null;
  for (let ri = 0; ri < 10; ri++) {
    const d = 120 + ri * 33;
    for (let ai = 0; ai < 28; ai++) {
      const a = (ai / 28) * Math.PI * 2, x = home.x + Math.cos(a) * d, z = home.z + Math.sin(a) * d;
      if (!world.inside(x, z, R + 90)) continue;
      if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < R + (p.r || 25))) continue;
      const sl = footprintSlope(world, x, z, R);
      if (sl > 9) continue;
      const score = sl * 10 + d * 0.025;
      if (!best || score < best.score) best = { x, z, score, slope: sl };
    }
  }
  return best;
}

// Cupula geodesica: aristas de un icosaedro subdividido, solo la mitad de arriba
function geodesicFrame() {
  const ico = new THREE.IcosahedronGeometry(R, 3);
  const edges = new THREE.EdgesGeometry(ico, 1);
  const p = edges.attributes.position, keep = [];
  for (let i = 0; i < p.count; i += 2) {
    const y1 = p.getY(i), y2 = p.getY(i + 1);
    if (y1 < -0.2 || y2 < -0.2) continue;
    keep.push(p.getX(i), Math.max(0, y1) * H, p.getZ(i), p.getX(i + 1), Math.max(0, y2) * H, p.getZ(i + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(keep, 3));
  return new THREE.LineSegments(g, M.frame);
}

// Modulo con ventanas iluminadas
function building(w, h, d, x, z, rot = 0) {
  const g = new THREE.Group();
  g.add(box(w, h, d, M.white, 0, h / 2, 0));
  const rows = Math.max(1, Math.floor(h / 2.6));
  for (let r = 0; r < rows; r++) {
    const y = 1.4 + r * 2.6;
    g.add(box(w * 0.82, 0.55, 0.06, M.window, 0, y, d / 2 + 0.03), box(w * 0.82, 0.55, 0.06, M.window, 0, y, -d / 2 - 0.03));
  }
  g.add(box(w + 0.1, 0.18, d + 0.1, M.stripe, 0, h - 0.4, 0));
  // entrada con marquesina, puerta iluminada y rotulo
  g.add(box(1.5, 2.3, 0.1, M.door, 0, 1.15, d / 2 + 0.05), box(2.2, 0.1, 1.2, M.white, 0, 2.55, d / 2 + 0.6));
  for (const sx of [-0.95, 0.95]) g.add(box(0.08, 2.5, 0.08, MAT.metal, sx, 1.25, d / 2 + 1.1));
  g.add(box(1.1, 0.22, 0.04, M.green, 0, 2.95, d / 2 + 0.06));
  g.position.set(x, 0, z); g.rotation.y = rot;
  return g;
}
function tree(x, z, s = 1) {
  const g = new THREE.Group();
  g.add(cyl(0.18 * s, 0.25 * s, 2.2 * s, M.trunk, 0, 1.1 * s, 0, 8));
  g.add(at(new THREE.Mesh(new THREE.IcosahedronGeometry(1.5 * s, 1), M.leaf), 0, 2.9 * s, 0));
  g.position.set(x, 0, z);
  return g;
}
// Modulo habitable exterior: capsula blanca con franja naranja (como el de las bases de superficie de NASA)
function capsule(len, r) {
  const g = new THREE.Group();
  const body = cyl(r, r, len, M.white, 0, 0, 0, 28); body.rotation.z = Math.PI / 2;
  const capA = at(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 14), M.white), len / 2, 0, 0);
  const capB = at(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 14), M.white), -len / 2, 0, 0);
  g.add(body, capA, capB);
  for (const dx of [-len * 0.3, 0, len * 0.3]) { const b = cyl(r + 0.03, r + 0.03, 0.25, M.stripe, dx, 0, 0, 28); b.rotation.z = Math.PI / 2; g.add(b); }
  for (let i = 0; i < 4; i++) g.add(box(0.7, 0.35, 0.05, M.window, -len * 0.35 + i * len * 0.23, r * 0.35, r * 0.93));
  for (const dx of [-len * 0.35, len * 0.35]) for (const dz of [-r * 0.7, r * 0.7]) g.add(cyl(0.12, 0.18, r * 0.9, MAT.metal, dx, -r * 0.8, dz, 8));
  return g;
}

export function buildColony(ms, world, data) {
  const home = data.objectives.objectives.find((o) => o.id === "habitat").world;
  const avoid = [
    ...((data.structures && data.structures.structures) || []).map((e) => ({ x: e.x, z: e.z, r: 30 })),
    ...data.objectives.objectives.map((o) => ({ x: o.world.x, z: o.world.z, r: 45 })),
  ];
  const s = findColonySite(world, home, avoid);
  if (!s) return null;
  const { x, z } = s;
  // los cimientos quedan sobre el punto mas alto de la huella
  let hi = -Infinity, lo = Infinity;
  for (let rr = 0; rr <= R + 1; rr += 4) for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2, h = ms.heightAt(x + Math.cos(a) * rr, z + Math.sin(a) * rr);
    hi = Math.max(hi, h); lo = Math.min(lo, h);
  }
  const floorY = hi + 0.35;
  const g = new THREE.Group();
  g.position.set(x, floorY, z);
  // orientar la entrada principal hacia el habitat
  const toHome = Math.atan2(home.x - x, home.z - z);
  g.rotation.y = toHome;

  // ---- cimientos, suelo de cultivo y caminos ----
  g.add(cyl(R + 0.8, R + 1.2, floorY - lo + 0.8, M.sinter, 0, -(floorY - lo + 0.8) / 2 + 0.05, 0, 64));
  const soil = cyl(R - 0.2, R - 0.2, 0.12, M.soil, 0, 0.1, 0, 64); g.add(soil);
  g.add(box(R * 1.9, 0.06, 2.4, M.path, 0, 0.18, 0), box(2.4, 0.06, R * 1.9, M.path, 0, 0.18, 0));
  g.add(cyl(5.5, 5.5, 0.08, M.path, 0, 0.19, 0, 32));
  // ---- cultivos en hileras (cuadrante norte) ----
  for (let i = 0; i < 7; i++) for (const side of [-1, 1]) {
    const lz = -5 - i * 2.4;
    g.add(box(8.5, 0.5, 1.1, MAT.dark, side * 7.5, 0.4, lz), box(8.3, 0.45, 0.9, M.crop, side * 7.5, 0.82, lz));
  }
  // ---- modulos habitables, laboratorio y almacenes (cuadrante sur) ----
  const BUILD = [[9, 5.2, 6, -9, 9, 0.2], [7, 7.8, 5, 6, 12, -0.3], [5, 2.6, 8, 14, 3, 0.1], [6, 5.2, 4, -15, 1, -0.15]];
  BUILD.forEach((b) => g.add(building(...b)));
  // torre central: tratamiento de aire y agua
  g.add(cyl(2.4, 2.8, 11, M.white, 0, 5.5, 0, 24), cyl(2.9, 2.9, 0.4, M.stripe, 0, 8.5, 0, 24), cyl(1.4, 1.4, 1.2, M.water, 0, 11.6, 0, 20));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.add(box(0.5, 0.4, 0.06, M.window, Math.cos(a) * 2.45, 4, Math.sin(a) * 2.45).rotateY(-a + Math.PI / 2)); }
  // silos y estanque
  g.add(cyl(1.6, 1.6, 6, MAT.metal, 17, 3, -9, 16), cyl(1.6, 1.6, 6, MAT.metal, 19.5, 3, -5.5, 16));
  g.add(cyl(3.2, 3.2, 0.1, M.water, -12, 0.24, -12, 28));
  const TREES = [[-17, -6, 1], [-6, 18, 0.9], [11, -17, 1.1], [-19, 9, 0.8], [3, -20, 0.95], [18, 9, 0.85]];
  for (const [tx, tz, ts] of TREES) g.add(tree(tx, tz, ts));
  const plazaCols = plaza(g);
  // farolas
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2, rr = R - 4; g.add(cyl(0.08, 0.1, 3.2, MAT.metal, Math.cos(a) * rr, 1.6, Math.sin(a) * rr, 6), at(new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), M.lamp), Math.cos(a) * rr, 3.3, Math.sin(a) * rr)); }
  // ---- esclusas (3, a 120 grados; la 0 mira al habitat). La 0 y la 2 son pasillos abiertos por los que se
  // entra caminando (rampa hasta el terreno); la 1 lleva por un tunel al modulo exterior ----
  const locks = [0, 1, 2].map((i) => (i / 3) * Math.PI * 2);
  const LOCK_LEN = 6.5, LOCK_W = 3.0;
  locks.forEach((a, i) => {
    const lg = new THREE.Group();
    const open = i !== 1;
    for (const sx of [-1, 1]) lg.add(box(0.35, 3.6, LOCK_LEN, M.white, sx * (LOCK_W / 2 + 0.18), 1.8, 0));
    lg.add(box(LOCK_W + 0.7, 0.3, LOCK_LEN, M.white, 0, 3.75, 0), box(LOCK_W + 0.8, 0.22, LOCK_LEN + 0.1, M.stripe, 0, 3.45, 0));
    lg.add(box(LOCK_W + 0.7, 0.5, 0.3, M.white, 0, 3.35, LOCK_LEN / 2), box(LOCK_W, 0.12, 0.1, M.green, 0, 3.0, LOCK_LEN / 2 + 0.17));
    // puertas interior y exterior abiertas (hojas plegadas a los lados) o cerrada si lleva al modulo
    if (!open) lg.add(box(LOCK_W, 3.0, 0.15, MAT.dark, 0, 1.5, LOCK_LEN / 2));
    else for (const sx of [-1, 1]) lg.add(box(0.12, 3.0, 1.2, MAT.dark, sx * (LOCK_W / 2 - 0.1), 1.5, LOCK_LEN / 2 - 0.8));
    for (const sx of [-1, 1]) lg.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), M.lamp), sx * (LOCK_W / 2 - 0.2), 3.2, 0));
    lg.position.set(Math.sin(a) * (R + LOCK_LEN / 2 - 0.5), 0, Math.cos(a) * (R + LOCK_LEN / 2 - 0.5));
    lg.rotation.y = a;
    g.add(lg);
  });
  castAll(g);
  // ---- cupula de vidrio y estructura geodesica (sin sombra, al final) ----
  const glass = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2), M.glass);
  glass.scale.y = H; glass.renderOrder = 3;
  const frame = geodesicFrame(); frame.renderOrder = 3;
  // el vidrio y la estructura no frenan la camara: dentro de la cupula se ve todo
  glass.raycast = () => {}; frame.raycast = () => {};
  g.add(glass, frame);
  ms.scene.add(g);
  ms.structures.push({ group: g, x, z });

  // ---- se entra caminando: muro con puertas, suelo propio y rampas (engine/interiors.js) ----
  const interior = addWalkIn(ms, {
    id: "colony_aeolis", name: { es: "Colonia Aeolis", en: "Aeolis Colony" }, x, z, yaw: toHome, r: R, floorY: floorY + 0.18, wallTop: floorY + 40,
    doors: [{ a: locks[0], len: LOCK_LEN - 0.5, w: LOCK_W - 0.2 }, { a: locks[2], len: LOCK_LEN - 0.5, w: LOCK_W - 0.2 }],
  });
  // rampas visibles desde la puerta exterior hasta el terreno
  for (const d of interior.doors) {
    const inY = floorY + 0.18, outY = d.outerY, len = LOCK_LEN - 0.5;
    const ramp = box(LOCK_W - 0.2, 0.12, Math.hypot(len, inY - outY), M.path, 0, 0, 0);
    const mx = x + d.ux * (R + len / 2), mz = z + d.uz * (R + len / 2);
    ramp.position.set(mx, (inY + outY) / 2, mz);
    ramp.rotation.order = "YXZ";
    ramp.rotation.y = Math.atan2(d.ux, d.uz);
    ramp.rotation.x = Math.atan2(inY - outY, len);
    ramp.receiveShadow = true;
    ms.scene.add(ramp);
  }
  // obstaculos de dentro (altura absoluta de su parte de arriba)
  const col = ms.colliders.frame(x, z, toHome);
  const fy = floorY;
  for (let i = 0; i < 7; i++) for (const side of [-1, 1]) col.box(side * 7.5, -5 - i * 2.4, 4.3, 0.6, fy + 1.05);
  for (const [w, h, d, bx, bz, rot] of BUILD) ms.colliders.addBox(...(() => { const c = Math.cos(toHome), sn = Math.sin(toHome); return [x + bx * c + bz * sn, z - bx * sn + bz * c]; })(), w / 2, d / 2, toHome + rot, fy + h);
  col.circle(0, 0, 2.9, fy + 11); col.circle(17, -9, 1.7, fy + 6); col.circle(19.5, -5.5, 1.7, fy + 6);
  for (const [tx, tz] of TREES) col.circle(tx, tz, 0.45, fy + 3);
  for (const c of plazaCols) col.circle(c.x, c.z, c.r, fy + c.top);
  // la esclusa 1 (al modulo exterior) esta cerrada
  col.box(Math.sin(locks[1]) * (R + 2.5), Math.cos(locks[1]) * (R + 2.5), 2.2, 3.2, fy + 4);

  // ---- modulo exterior unido por un tunel a la esclusa 2 ----
  const a2 = locks[1], ex = Math.sin(a2) * (R + 16), ez = Math.cos(a2) * (R + 16);
  const capG = new THREE.Group();
  const cw = new THREE.Vector3(ex, 0, ez).applyAxisAngle(new THREE.Vector3(0, 1, 0), toHome).add(new THREE.Vector3(x, 0, z));
  const cy = ms.heightAt(cw.x, cw.z) + 2.6;
  const cap = capsule(11, 2.1); cap.rotation.y = toHome + a2 + Math.PI / 2;
  capG.add(cap); capG.position.set(cw.x, cy, cw.z);
  castAll(capG); ms.scene.add(capG); ms.structures.push({ group: capG, x: cw.x, z: cw.z });
  ms.colliders.frame(cw.x, cw.z, toHome + a2).box(0, 0, 2.3, 7.8, 5);
  const tunnel = cyl(1.1, 1.1, 9, M.white, 0, 0, 0, 18);
  const lockW = new THREE.Vector3(Math.sin(a2) * (R + 4.5), 0, Math.cos(a2) * (R + 4.5)).applyAxisAngle(new THREE.Vector3(0, 1, 0), toHome).add(new THREE.Vector3(x, 0, z));
  const mid = lockW.clone().lerp(cw, 0.5);
  tunnel.position.set(mid.x, (floorY + 1.6 + cy) / 2, mid.z);
  tunnel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), cw.clone().setY(cy).sub(lockW.clone().setY(floorY + 1.6)).normalize());
  tunnel.scale.y = lockW.distanceTo(cw) / 9;
  castAll(tunnel); ms.scene.add(tunnel);

  // ---- campo solar junto a la cupula (paneles inclinados hacia el norte: el sol pasa por el norte en Gale) ----
  const solar = new THREE.Group();
  const sa = locks[2] + 0.5, sx = x + Math.sin(toHome + sa) * (R + 30), sz = z + Math.cos(toHome + sa) * (R + 30);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++) {
    const px = sx + (c - 3) * 3.4, pz = sz + (r - 1.5) * 4.2, py = ms.heightAt(px, pz);
    const p = new THREE.Group();
    p.add(cyl(0.07, 0.07, 1.4, MAT.metal, 0, 0.7, 0, 6));
    const pan = box(3, 0.06, 2.2, M.panel, 0, 1.45, 0); pan.rotation.x = 0.35; p.add(pan);
    p.position.set(px, py, pz);
    solar.add(p);
  }
  castAll(solar); ms.scene.add(solar); ms.structures.push({ group: solar, x: sx, z: sz });
  ms.colliders.addBox(sx, sz, 12, 8.5, 0, 1.7);

  // ---- tuberia azul hasta el habitat (agua y oxigeno), apoyada en el terreno ----
  // sale por el costado de la esclusa 0, sin cruzar el pasillo de entrada
  const a0 = locks[0], off = LOCK_W / 2 + 0.9;
  const lock0 = new THREE.Vector3(Math.sin(a0) * (R + 6.2) + Math.cos(a0) * off, 0, Math.cos(a0) * (R + 6.2) - Math.sin(a0) * off).applyAxisAngle(new THREE.Vector3(0, 1, 0), toHome).add(new THREE.Vector3(x, 0, z));
  const end = new THREE.Vector3(home.x, 0, home.z);
  const dist = lock0.distanceTo(end);
  if (dist < 520) {
    const pts = [];
    const n = Math.ceil(dist / 4);
    for (let i = 0; i <= n; i++) {
      const p = lock0.clone().lerp(end, i / n);
      // un poco de serpenteo, como una manguera tendida a mano
      const side = Math.sin(i * 0.35) * 1.6 * Math.sin((i / n) * Math.PI);
      p.x += (end.z - lock0.z) / dist * side; p.z -= (end.x - lock0.x) / dist * side;
      p.y = ms.heightAt(p.x, p.z) + 0.28;
      pts.push(p);
    }
    pts[0].y = Math.max(pts[0].y, ms.heightAt(pts[0].x, pts[0].z) + 0.28);
    const curve = new THREE.CatmullRomCurve3(pts);
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(curve, n * 2, 0.26, 10, false), M.pipe);
    pipe.castShadow = true;
    ms.scene.add(pipe);
    // abrazaderas cada ~20 m
    for (let i = 5; i < n; i += 5) {
      const p = pts[i], b = cyl(0.32, 0.32, 0.18, M.pipeBand, p.x, p.y, p.z, 12);
      b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pts[i + 1 < n ? i + 1 : i].clone().sub(pts[i - 1]).normalize());
      ms.scene.add(b);
    }
  }

  // luz de la plaza desde lo alto de la torre (fija; de noche sube su intensidad)
  const plazaLight = new THREE.PointLight("#ffe2b8", 0, 45, 1.3);
  plazaLight.position.set(0, 10, 0); g.add(plazaLight);
  // luces: las ventanas y farolas se notan mas de noche
  ms.addAnimated(() => {
    const night = 1 - ms.skyMat.uniforms.uDay.value;
    plazaLight.intensity = 10 + 140 * night;
    M.door.emissiveIntensity = 0.3 + 1.2 * night;
    M.window.emissiveIntensity = 0.6 + 1.8 * night;
    M.lamp.emissiveIntensity = 0.4 + 2.4 * night;
    M.glass.emissiveIntensity = 0.2 + 0.5 * night;
    M.green.emissiveIntensity = 1.2 + Math.sin(performance.now() / 400) * 0.8;
  });

  const entry = {
    id: "colony_aeolis", type: "colony_dome", x, z, elevation_m: floorY + world.yRef,
    at_point: { slope_deg: +s.slope.toFixed(1), radiation_ugy_h: +world.radiation(x, z).toFixed(2), temperature_c: +world.temperature(x, z, 10).toFixed(1), spectral_class: world.spectral(x, z) },
    name: { es: "Colonia Aeolis (cúpula presurizada)", en: "Aeolis Colony (pressurized dome)" },
    info: { es: `Cúpula presurizada de ${R * 2} m: se entra caminando por las esclusas y dentro recargas O₂ y batería, a salvo de tormentas. Sitio elegido con el DTM: pendiente máxima de ${s.slope.toFixed(1)}°. Una tubería la une al hábitat.`, en: `${R * 2} m pressurized dome: walk in through the airlocks to recharge O₂ and battery, safe from storms. Site picked from the DTM: max slope ${s.slope.toFixed(1)}°. A pipeline links it to the habitat.` },
    source: "DTM HiRISE+CTX (elección del sitio)",
    interior: { r: R - 1, floorY: floorY + 0.18 },
  };
  if (data.structures && data.structures.structures) data.structures.structures.push(entry);
  return entry;
}
