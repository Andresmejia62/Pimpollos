import * as THREE from "three";
import { MARS } from "./physics.js";
import { addWalkIn } from "./interiors.js";
import { skin, tex64 } from "./tex64.js";

// Estructuras y vehiculos hechos con primitivas (sin modelos externos).
// Convencion: los vehiculos miran hacia -Z, igual que el rumbo del juego (rotation.y = heading).

const UP = new THREE.Vector3(0, 1, 0);
const std = (color, roughness = 0.8, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
const glow = (color, intensity = 1.5) => std(color, 0.4, 0, { emissive: color, emissiveIntensity: intensity });
const at = (m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); return m; };
const box = (w, h, d, mat, x, y, z) => at(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), x, y, z);
const cyl = (rt, rb, h, mat, x, y, z, seg = 18) => at(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat), x, y, z);
const ball = (r, mat, x, y, z, seg = 16) => at(new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg - 4)), mat), x, y, z);
const castAll = (g) => { g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); return g; };

const MAT = {
  hull: std("#ebe6dc", 0.78),
  hull2: std("#cfc9bd", 0.85),
  base: std("#6d5f55", 0.95),
  dark: std("#2b2d33", 0.85),
  metal: std("#b9bdc6", 0.4, 0.7),
  accent: std("#d4541c", 0.7),
  solar: std("#16264a", 0.3, 0.5, { emissive: "#0b1a3d", emissiveIntensity: 0.6 }),
  glass: std("#0d1820", 0.12, 0.5, { emissive: "#132a3a", emissiveIntensity: 0.5 }),
  window: glow("#ffd9a0", 1.3),
  regolith: std("#96603f", 1),
  tire: std("#1e1e21", 0.95),
  hullIn: std("#e2ddd3", 0.85, 0, { side: THREE.DoubleSide }),
  deck: std("#4a4d55", 0.7, 0.3),
};
// Texturas de 64 x 64 px (engine/tex64.js): multiplican el color del material y dan relieve. El segundo numero es
// lo que mide un mosaico en metros.
skin(MAT.hull, "panel", 2.4, 1.2); skin(MAT.hull2, "panel", 2.4, 1.2); skin(MAT.hullIn, "panel", 2.4);
skin(MAT.base, "grain", 1.6, 1.0); skin(MAT.regolith, "grain", 1.2, 1.2);
skin(MAT.dark, "rubber", 0.8); skin(MAT.tire, "rubber", 0.4);
skin(MAT.metal, "brushed", 0.9); skin(MAT.accent, "paint", 1.2);
skin(MAT.deck, "tread", 0.6, 1.0);
MAT.solar.color.set("#ffffff"); skin(MAT.solar, "solar", 1.2);       // la textura de celulas ya lleva el color

// Panel solar sobre un poste, inclinado hacia el norte (por donde pasa el sol a esta latitud)
function solarPanel(w = 4, d = 2.4, postH = 1.6) {
  const g = new THREE.Group();
  g.add(cyl(0.07, 0.09, postH, MAT.metal, 0, postH / 2, 0, 8));
  const panel = new THREE.Group();
  panel.position.y = postH;
  panel.rotation.x = 0.45;
  panel.add(box(w, 0.07, d, MAT.solar, 0, 0, 0), box(w + 0.1, 0.05, d + 0.1, MAT.metal, 0, -0.05, 0));
  for (let i = 1; i < 4; i++) panel.add(box(0.03, 0.075, d, MAT.metal, -w / 2 + (i * w) / 4, 0, 0));
  g.add(panel);
  return g;
}

// Mastil con luz intermitente; devuelve el material de la luz para animarlo
function beaconMast(h, color) {
  const g = new THREE.Group();
  const lightMat = glow(color, 2);
  g.add(cyl(0.05, 0.09, h, MAT.metal, 0, h / 2, 0, 8), ball(0.16, lightMat, 0, h + 0.1, 0, 10));
  return { g, lightMat };
}

function dish(r = 0.9) {
  const g = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.32), skin(std("#e3e0d8", 0.6, 0.2, { side: THREE.DoubleSide }), "panel", 2.4));
  bowl.rotation.x = Math.PI;       // la concavidad mira hacia arriba
  bowl.position.y = r;
  g.add(bowl, cyl(0.02, 0.02, r * 0.75, MAT.metal, 0, r * 0.4, 0, 6), ball(0.06, MAT.dark, 0, r * 0.78, 0, 8));
  return g;
}

// Coloca una estructura con su frente (eje local +z o +x) mirando cuesta abajo, para que la puerta no quede
// enterrada, y devuelve el desnivel del suelo en coordenadas locales respecto al centro.
function siteFrame(ms, x, z, g, front) {
  const y0 = ms.heightAt(x, z), e = 8;
  const dx = ms.heightAt(x - e, z) - ms.heightAt(x + e, z), dz = ms.heightAt(x, z - e) - ms.heightAt(x, z + e);
  const yaw = front === "z" ? Math.atan2(dx, dz) : Math.atan2(-dz, dx);
  g.position.set(x, y0, z);
  g.rotation.y = yaw;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return (lx, lz) => ms.heightAt(x + lx * c + lz * s, z - lx * s + lz * c) - y0;
}

// ---- Interior del habitat ----------------------------------------------------------------------
// Texturas de lienzo de 64 x 64 px (engine/tex64.js): paneles acolchados de la pared (como el aislamiento de los modulos de la ISS) y suelo
// de placas con rejilla. Se crean una vez.
let _tex = null;
function interiorTextures() {
  if (_tex) return _tex;
  // 64 x 64 px: un panel acolchado por mosaico (40 x 12 paneles en la pared) y una placa por mosaico (6 x 6 en el suelo)
  const wall = tex64("wall", 40, 12), floor = tex64("floor", 6, 6);
  return (_tex = { wall, floor });
}

function habitatInterior() {
  const T = interiorTextures();
  const g = new THREE.Group(), F = 0.5;            // F: suelo (y local)
  const m = {
    wall: std("#ffffff", 0.9, 0, { map: T.wall, side: THREE.BackSide }),
    floor: std("#ffffff", 0.75, 0.2, { map: T.floor }),
    white: std("#e8e6e1", 0.6), grey: std("#8e939c", 0.5, 0.4), dark: std("#2a2d33", 0.6, 0.3),
    blue: std("#2f5c8f", 0.9), orange: std("#d4541c", 0.8), wood: std("#9b7653", 0.8),
    screen: std("#0b1a24", 0.3, 0, { emissive: "#3fa9ff", emissiveIntensity: 1.1 }),
    screen2: std("#0b1a24", 0.3, 0, { emissive: "#3ddc97", emissiveIntensity: 1.0 }),
    leaf: std("#3f8f3a", 0.85), leaf2: std("#6bb04a", 0.85), grow: std("#2a0f2e", 0.4, 0, { emissive: "#d06cff", emissiveIntensity: 1.6 }),
    lamp: std("#fff6e6", 0.4, 0, { emissive: "#fff1d6", emissiveIntensity: 2.2 }),
    glass: std("#9fc4d8", 0.1, 0.1, { transparent: true, opacity: 0.35 }),
  };
  const colliders = [];
  const C = (x, z, r, top) => colliders.push({ x, z, r, top });
  const B = (x, z, hx, hz, top) => colliders.push({ x, z, hx, hz, top });

  // cascaron interior con un hueco hacia la esclusa (+z)
  const R = 5.95, gap = 0.27, thHole = 1.0;
  const shellA = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 16, Math.PI / 2 + gap, Math.PI * 2 - 2 * gap, 0, Math.PI / 2), m.wall);
  const shellB = new THREE.Mesh(new THREE.SphereGeometry(R, 6, 10, Math.PI / 2 - gap, 2 * gap, 0, thHole), m.wall);
  for (const sh of [shellA, shellB]) { sh.scale.y = 0.86; sh.position.y = F; sh.userData.shell = true; g.add(sh); }
  // zocalo y suelo de placas
  const floor = new THREE.Mesh(new THREE.CircleGeometry(5.92, 48), m.floor);
  floor.rotation.x = -Math.PI / 2; floor.position.y = F + 0.012;
  g.add(floor);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(5.9, 5.9, 0.35, 48, 1, true), std("#5c6069", 0.6, 0.3, { side: THREE.BackSide }));
  skirt.position.y = F + 0.17; g.add(skirt);

  // anillo de luz y lucernario central
  const ring = at(new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.07, 8, 48), m.lamp), 0, F + 4.15, 0);
  ring.rotation.x = Math.PI / 2; g.add(ring);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; g.add(cyl(0.02, 0.02, 0.9, m.grey, Math.cos(a) * 2.3, F + 4.6, Math.sin(a) * 2.3, 6)); }

  // mesa central con taburetes (reuniones y comidas)
  g.add(cyl(1.0, 1.0, 0.06, m.white, 0, F + 0.78, 0, 32), cyl(0.08, 0.12, 0.76, m.grey, 0, F + 0.38, 0, 10), cyl(0.5, 0.5, 0.04, m.grey, 0, F + 0.02, 0, 20));
  g.add(box(0.7, 0.02, 0.45, m.screen, 0, F + 0.82, 0.1));          // mesa tactil con el mapa de la EVA
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    g.add(cyl(0.22, 0.22, 0.06, m.orange, Math.cos(a) * 1.35, F + 0.5, Math.sin(a) * 1.35, 14), cyl(0.04, 0.04, 0.48, m.grey, Math.cos(a) * 1.35, F + 0.24, Math.sin(a) * 1.35, 6));
  }
  C(0, 0, 1.05, 0.85);

  // literas al fondo (-z): dos camas dobles con cortina
  for (const bx of [-1.35, 1.35]) {
    const bz = -4.0;
    for (const yy of [0.45, 1.6]) {
      g.add(box(2.0, 0.08, 0.95, m.grey, bx, F + yy, bz), box(1.9, 0.14, 0.86, m.blue, bx, F + yy + 0.11, bz));
      g.add(box(0.42, 0.1, 0.6, m.white, bx - 0.68, F + yy + 0.22, bz));
    }
    for (const dx of [-0.98, 0.98]) for (const dz of [-0.45, 0.45]) g.add(box(0.05, 2.3, 0.05, m.grey, bx + dx, F + 1.15, bz + dz));
    g.add(box(2.0, 0.6, 0.02, m.orange, bx, F + 2.05, bz + 0.48));
    B(bx, bz, 1.02, 0.5, 2.3);
  }
  g.add(box(0.12, 1.2, 0.04, m.grey, 0, F + 1.1, -4.4));            // escalerilla compartida

  // laboratorio a la izquierda (-x): banco, guantera, microscopio y pantallas
  g.add(box(0.8, 0.08, 3.2, m.white, -4.1, F + 0.92, 0), box(0.74, 0.86, 3.1, m.grey, -4.1, F + 0.45, 0));
  g.add(box(0.7, 0.55, 0.9, m.glass, -4.1, F + 1.25, -0.9), box(0.72, 0.04, 0.92, m.grey, -4.1, F + 1.53, -0.9));
  for (const dz of [-1.1, -0.7]) { const ring2 = at(new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 6, 14), m.dark), -3.75, F + 1.2, dz); ring2.rotation.y = Math.PI / 2; g.add(ring2); }
  g.add(cyl(0.1, 0.14, 0.08, m.dark, -4.15, F + 1.0, 0.5, 10), cyl(0.035, 0.035, 0.38, m.dark, -4.2, F + 1.2, 0.5, 6), cyl(0.05, 0.05, 0.16, m.grey, -4.12, F + 1.38, 0.5, 8));
  for (const [dz, mat] of [[0.2, m.screen], [1.15, m.screen2]]) {
    const sc = box(0.04, 0.5, 0.8, mat, -4.62, F + 1.55, dz); sc.rotation.z = 0.12; g.add(sc);
  }
  for (let i = 0; i < 4; i++) g.add(cyl(0.07, 0.07, 0.2, [m.orange, m.white, m.blue, m.leaf][i], -3.92, F + 1.06, 1.2 + i * 0.16, 10));   // muestras
  B(-4.1, 0, 0.45, 1.65, 1.0);

  // cocina y soporte vital a la derecha (+x)
  g.add(box(0.8, 0.9, 2.6, m.white, 4.1, F + 0.45, -0.6), box(0.82, 0.05, 2.62, m.grey, 4.1, F + 0.92, -0.6));
  g.add(box(0.5, 0.6, 0.6, m.dark, 4.25, F + 1.25, -1.4), box(0.02, 0.18, 0.3, m.screen2, 3.99, F + 1.3, -1.4));     // horno
  g.add(box(0.06, 0.5, 1.2, m.screen, 4.65, F + 1.6, 0.1));                                                           // panel ECLSS
  for (let i = 0; i < 3; i++) g.add(cyl(0.05, 0.05, 0.12, m.orange, 4.0, F + 1.0, -0.2 + i * 0.15, 8));
  B(4.1, -0.6, 0.45, 1.35, 1.0);

  // cultivo hidroponico (+x, +z) con luz de crecimiento magenta
  const farm = new THREE.Group(); farm.position.set(3.0, F, 2.9); farm.rotation.y = -0.75; g.add(farm);
  for (let k = 0; k < 3; k++) {
    const yy = 0.35 + k * 0.62;
    farm.add(box(1.4, 0.06, 0.55, m.grey, 0, yy, 0), box(1.3, 0.04, 0.08, m.grow, 0, yy + 0.5, 0));
    for (let i = 0; i < 5; i++) farm.add(ball(0.12 + ((i * 7 + k) % 3) * 0.03, (i + k) % 2 ? m.leaf : m.leaf2, -0.55 + i * 0.27, yy + 0.15, 0, 8));
  }
  for (const dx of [-0.7, 0.7]) for (const dz of [-0.26, 0.26]) farm.add(box(0.04, 1.9, 0.04, m.grey, dx, 0.95, dz));
  C(3.0, 2.9, 0.85, 2.0);

  // trajes de repuesto junto a la esclusa (-x, +z)
  for (const dx of [-2.5, -3.4]) {
    g.add(box(0.06, 1.9, 0.06, m.grey, dx, F + 0.95, 3.7));
    g.add(at(new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.6, 4, 10), m.white), dx, F + 1.1, 3.55), ball(0.2, std("#d8b048", 0.15, 0.6), dx, F + 1.7, 3.55, 12));
    g.add(box(0.5, 0.45, 0.2, m.white, dx, F + 1.25, 3.85));
  }
  C(-2.95, 3.7, 0.75, 2.0);
  // taquillas al otro lado de la entrada
  g.add(box(1.2, 1.9, 0.5, m.grey, 2.0, F + 0.95, 4.35));
  for (let i = 0; i < 3; i++) g.add(box(0.36, 1.8, 0.02, i === 1 ? m.orange : m.white, 1.6 + i * 0.4, F + 0.95, 4.1));
  B(2.0, 4.35, 0.6, 0.3, 2.0);
  // compuerta (cerrada) del tunel al laboratorio, con rotulo luminoso
  const hatch = at(new THREE.Mesh(new THREE.CircleGeometry(1.0, 24), m.grey), -5.55, F + 1.4, 0); hatch.rotation.y = Math.PI / 2; g.add(hatch);
  const hring = at(new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.08, 8, 28), m.orange), -5.52, F + 1.4, 0); hring.rotation.y = Math.PI / 2; g.add(hring);
  g.add(box(0.04, 0.16, 0.7, m.screen2, -5.5, F + 2.6, 0));

  // luz interior (fija: solo cambia su intensidad) y parpadeo suave de las pantallas
  const light = new THREE.PointLight("#ffe9cc", 18, 11, 1.6);
  light.position.set(0, F + 3.6, 0); g.add(light);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; if (!o.userData.shell) o.raycast = () => {}; } });
  const tick = (t) => { m.screen.emissiveIntensity = 1.0 + 0.12 * Math.sin(t * 2.3); m.grow.emissiveIntensity = 1.5 + 0.1 * Math.sin(t * 0.7); };
  return { group: g, colliders, tick };
}

// ---- Habitat Aeolis ---------------------------------------------------------------------------
export function buildHabitat(ms, x, z) {
  const g = new THREE.Group();
  const gy = siteFrame(ms, x, z, g, "z");

  // cimiento que absorbe la pendiente y cupula principal
  g.add(cyl(6.7, 7.2, 3.4, MAT.base, 0, -1.2, 0, 36));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(6.1, 40, 18, 0, Math.PI * 2, 0, Math.PI / 2), MAT.hull);
  dome.scale.y = 0.86;
  dome.position.y = 0.5;
  g.add(dome);
  const ring = at(new THREE.Mesh(new THREE.TorusGeometry(6.12, 0.14, 8, 48), MAT.accent), 0, 0.75, 0);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  // costillas de la cupula y ventanas iluminadas
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const rib = at(new THREE.Mesh(new THREE.TorusGeometry(6.13, 0.06, 6, 24, Math.PI / 2), MAT.hull2), 0, 0.5, 0);
    rib.scale.y = 0.86;
    rib.rotation.y = a;
    g.add(rib);
    if (i % 2 === 0) continue;
    const wa = a + 0.39;
    const win = box(1.3, 0.7, 0.3, MAT.window, Math.cos(wa) * 5.52, 2.6, Math.sin(wa) * 5.52);
    win.rotation.y = Math.PI / 2 - wa;
    g.add(win);
  }
  g.add(cyl(1.1, 1.3, 0.5, MAT.hull2, 0, 5.75, 0, 20), ball(0.95, MAT.glass, 0, 5.9, 0, 18));

  // esclusa (cuesta abajo), con rampa y luces
  // esclusa abierta: tubo con suelo, por el que se entra a pie (las compuertas estan recogidas)
  const lock = at(new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 4.3, 24, 1, true), MAT.hullIn), 0, 1.7, 7.0);
  lock.rotation.x = Math.PI / 2;
  const lockRing = at(new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.12, 8, 28), MAT.accent), 0, 1.7, 9.05);
  g.add(lock, lockRing, at(new THREE.Mesh(new THREE.TorusGeometry(1.56, 0.09, 8, 28), MAT.hull2), 0, 1.7, 5.4));
  g.add(box(2.3, 0.1, 4.3, MAT.deck, 0, 0.42, 7.0));
  // compuertas exterior e interior recogidas a los lados, luz verde (presion igualada) y franjas de seguridad
  for (const zz of [8.95, 5.55]) for (const sx of [-1, 1]) g.add(box(0.12, 2.1, 0.62, MAT.hull2, sx * 1.12, 1.5, zz));
  g.add(box(1.3, 0.1, 0.08, glow("#3ddc97", 2), 0, 2.62, 9.2));
  for (const sx of [-1, 1]) g.add(box(0.08, 0.04, 4.1, glow("#ffc23d", 0.9), sx * 0.95, 0.49, 7.0));
  for (let i = 0; i < 3; i++) g.add(box(0.5, 0.05, 0.22, glow("#e8f2ff", 2.2), 0, 3.12, 5.8 + i * 1.3));
  const rampY = gy(0, 11.5);
  const ramp = box(2.2, 0.16, 4.3, MAT.metal, 0, (0.4 + rampY) / 2, 11.25);
  ramp.rotation.x = Math.atan2(0.4 - rampY, 4.2);
  g.add(ramp);
  for (const sx of [-1.9, 1.9]) g.add(cyl(0.05, 0.05, 1.4, MAT.metal, sx, gy(sx, 13.4) + 0.7, 13.4, 6), ball(0.13, glow("#fff1c8", 2), sx, gy(sx, 13.4) + 1.45, 13.4, 8));

  // modulo laboratorio a un lado, unido por un tunel
  const lab = at(new THREE.Mesh(new THREE.CapsuleGeometry(2.3, 5.5, 8, 24), MAT.hull), -10.6, 2.3, 0);
  lab.rotation.x = Math.PI / 2;
  const tunnel = cyl(1.2, 1.2, 4, MAT.hull2, -7, 1.9, 0, 18);
  tunnel.rotation.z = Math.PI / 2;
  const labBand = at(new THREE.Mesh(new THREE.TorusGeometry(2.33, 0.08, 8, 32), MAT.accent), -10.6, 2.3, 1.6);
  g.add(lab, tunnel, labBand, box(0.12, 0.9, 2.2, MAT.window, -8.32, 2.7, -1.2));
  for (const dz of [-2.6, 2.6]) for (const dx of [-1.5, 1.5]) g.add(cyl(0.14, 0.2, 3, MAT.dark, -10.6 + dx, gy(-10.6 + dx, dz) + 0.6, dz, 8));

  // paneles solares detras, antena y mastil
  for (let i = 0; i < 3; i++) {
    const dx = -5 + i * 5.2, dz = -12.5;
    g.add(at(solarPanel(4.4, 2.6, 1.9), dx, gy(dx, dz), dz));
  }
  const d = dish(1.3);
  d.rotation.set(0.5, 0.7, 0);
  g.add(at(d, 3.4, 4.9, -3.2));
  const mast = beaconMast(11, "#ff4d4d");
  g.add(at(mast.g, 7.6, gy(7.6, -4.5), -4.5));
  // depositos y carga junto a la esclusa
  for (let i = 0; i < 3; i++) g.add(at(new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.3, 4, 12), MAT.metal), 3.6 + i * 1.05, gy(4.6, 8.4) + 1.0, 8.4));
  g.add(box(1.2, 0.9, 1.2, MAT.accent, -3.8, gy(-3.8, 9) + 0.45, 9), box(0.9, 0.7, 0.9, MAT.hull2, -3.9, gy(-3.8, 9) + 1.25, 9.05));

  // interior caminable: cupula por dentro, suelo, mobiliario y luz propia
  const y0 = g.position.y, floorY = y0 + 0.5;
  const inner = habitatInterior();
  g.add(inner.group);
  addWalkIn(ms, { id: "habitat_in", name: { es: "Hábitat Aeolis", en: "Aeolis habitat" }, x, z, yaw: g.rotation.y, r: 5.8, floorY, wallTop: y0 + 5.5,
    doors: [{ a: 0, len: 13.3 - 5.8, w: 1.7, flat: 9.15 - 5.8 }], noShelter: true });
  ms.addAnimated((t) => inner.tick(t));

  // obstaculos (coordenadas locales del habitat)
  const col = ms.colliders.frame(x, z, g.rotation.y);
  for (const c of inner.colliders) c.r ? col.circle(c.x, c.z, c.r, floorY + c.top) : col.box(c.x, c.z, c.hx, c.hz, floorY + c.top);
  col.box(-7.2, 0, 1.6, 1.25);                     // tunel
  col.box(-10.6, 0, 2.35, 5.05);                   // laboratorio
  for (let i = 0; i < 3; i++) col.circle(-5 + i * 5.2, -12.5, 0.3);
  col.circle(7.6, -4.5, 0.3);
  col.box(4.65, 8.4, 1.65, 0.5);                   // depositos
  col.box(-3.85, 9, 0.65, 0.65);                   // carga

  castAll(g);
  inner.group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  ms.scene.add(g);
  ms.addAnimated((t) => { mast.lightMat.emissiveIntensity = (t * 0.8) % 1 < 0.15 ? 4 : 0.25; });
  return g;
}

// ---- Rover presurizado de apoyo (refugio movil de 6 ruedas) --------------------------------------
export function buildRover(ms, x, z) {
  const g = new THREE.Group();
  const y = ms.heightAt(x, z);
  g.position.set(x, y, z);
  g.quaternion.setFromUnitVectors(UP, ms.normalAt(x, z)).multiply(new THREE.Quaternion().setFromAxisAngle(UP, 0.6));

  g.add(box(2.5, 0.3, 6, MAT.dark, 0, 1.0, 0));
  for (const wz of [-2.2, 0, 2.2]) {
    for (const sx of [-1, 1]) g.add(makeWheel(0.62, 0.5, MAT.metal).root.translateX(sx * 1.55).translateY(0.62).translateZ(wz));
    g.add(cyl(0.09, 0.09, 3.1, MAT.dark, 0, 0.62, wz, 8).rotateZ(Math.PI / 2));
  }
  const cabin = at(new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 3.2, 8, 24), MAT.hull), 0, 2.35, 0.1);
  cabin.rotation.x = Math.PI / 2;
  cabin.scale.x = 1.08;
  const W = Math.PI * 0.62;
  const wind = at(new THREE.Mesh(new THREE.SphereGeometry(1.33, 24, 14, Math.PI * 1.5 - W / 2, W, Math.PI * 0.28, Math.PI * 0.3), MAT.glass), 0, 2.35, -1.5);
  wind.scale.x = 1.08;
  const band = at(new THREE.Mesh(new THREE.TorusGeometry(1.33, 0.07, 8, 32), MAT.accent), 0, 2.35, 0.6);
  band.scale.x = 1.08;
  g.add(cabin, wind, band);
  g.add(box(2.2, 0.07, 3, MAT.solar, 0, 3.78, 0.5), box(2.3, 0.05, 3.1, MAT.metal, 0, 3.72, 0.5));
  for (const sx of [-0.9, 0.9]) for (const sz of [-0.7, 1.7]) g.add(cyl(0.04, 0.04, 0.3, MAT.metal, sx, 3.58, sz, 6));
  g.add(cyl(0.85, 0.85, 0.25, MAT.hull2, 0, 2.2, 3.05, 20).rotateX(Math.PI / 2), cyl(0.6, 0.6, 0.1, MAT.dark, 0, 2.2, 3.2, 20).rotateX(Math.PI / 2));
  for (const sx of [-0.75, 0.75]) g.add(cyl(0.16, 0.16, 0.1, glow("#fff1c8", 1.6), sx, 1.55, -2.95, 12).rotateX(Math.PI / 2));
  g.add(box(2.4, 0.2, 0.25, MAT.dark, 0, 1.2, -3.0));
  const d = dish(0.7);
  d.rotation.set(-0.4, 0, 0.3);
  g.add(at(d, -0.7, 3.8, -1.3));
  const mast = beaconMast(2.2, "#3ddc97");
  g.add(at(mast.g, 0.8, 3.6, 2.1));

  ms.colliders.addBox(x, z, 1.95, 3.35, 0.6);

  castAll(g);
  ms.scene.add(g);
  ms.addAnimated((t) => { mast.lightMat.emissiveIntensity = 1.2 + Math.sin(t * 3) * 1.0; });
  return g;
}

// ---- Refugio semienterrado (boveda cubierta de regolito) ------------------------------------------
export function buildShelter(ms, x, z) {
  const g = new THREE.Group();
  const gy = siteFrame(ms, x, z, g, "x");

  g.add(box(8.6, 2.4, 7, MAT.base, 0, -1.0, 0));
  const vault = cyl(3.2, 3.2, 7.6, MAT.regolith, 0, 0.2, 0, 28);
  vault.rotation.z = Math.PI / 2;
  g.add(vault);
  // sacos de regolito a los pies de la boveda
  let s = 77;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 16; i++) {
    const bag = ball(0.55, MAT.regolith, -3.6 + i * 0.48, 0.25 + rnd() * 0.1, (i % 2 ? 1 : -1) * (3.05 + rnd() * 0.15), 8);
    bag.scale.set(1, 0.55, 0.75);
    g.add(bag);
  }
  // frente con puerta (eje local +x, cuesta abajo)
  g.add(cyl(3.0, 3.0, 0.3, MAT.hull, 3.8, 0.2, 0, 28).rotateZ(Math.PI / 2));
  g.add(box(0.2, 2.1, 1.3, MAT.dark, 4.0, 1.25, 0), box(0.12, 0.45, 0.45, MAT.glass, 4.08, 1.8, 0), box(0.14, 0.1, 1.4, glow("#3ddc97", 2), 4.02, 2.42, 0));
  g.add(box(0.12, 0.5, 2.2, MAT.accent, 3.98, 0.45, 0));
  const mast = beaconMast(6, "#3ddc97");
  g.add(at(mast.g, 2.6, 3.2, 0));
  g.add(at(solarPanel(3, 2, 1.5), -1.5, gy(-1.5, -6.5), -6.5));
  for (let i = 0; i < 2; i++) g.add(at(new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 12), MAT.metal), 4.6, 0.95, 1.6 + i * 0.85));

  const col = ms.colliders.frame(x, z, g.rotation.y);
  col.box(0, 0, 4.3, 3.5);
  col.box(4.6, 2.0, 0.45, 0.9);                    // depositos
  col.circle(-1.5, -6.5, 0.3);

  castAll(g);
  ms.scene.add(g);
  ms.addAnimated((t) => { mast.lightMat.emissiveIntensity = 1.2 + Math.sin(t * 3 + 1) * 1.0; });
  return g;
}

// Rueda todoterreno: root (posicion) -> steer (giro de direccion) -> spin (rodadura)
function makeWheel(r, w, hubMat) {
  const root = new THREE.Group(), steer = new THREE.Group(), spin = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 20), MAT.tire);
  tire.rotation.z = Math.PI / 2;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.56, r * 0.56, w + 0.02, 16), hubMat);
  hub.rotation.z = Math.PI / 2;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.18, r * 0.18, w + 0.06, 10), MAT.dark);
  cap.rotation.z = Math.PI / 2;
  spin.add(tire, hub, cap);
  // tacos del dibujo: dejan ver que la rueda gira
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const lug = box(w + 0.03, r * 0.11, r * 0.24, MAT.tire, 0, Math.cos(a) * r * 0.99, Math.sin(a) * r * 0.99);
    lug.rotation.x = a;
    spin.add(lug);
  }
  steer.add(spin);
  root.add(steer);
  return { root, steer, spin };
}

// piezas compartidas con engine/structures.js
export { UP, std, glow, at, box, cyl, ball, castAll, MAT, solarPanel, beaconMast, dish, makeWheel };
