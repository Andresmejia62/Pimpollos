import * as THREE from "three";
import { MARS } from "./physics.js";

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
};

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
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.32), std("#e3e0d8", 0.6, 0.2, { side: THREE.DoubleSide }));
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
  const lock = cyl(1.55, 1.55, 4.2, MAT.hull, 0, 1.7, 7.0, 24);
  lock.rotation.x = Math.PI / 2;
  const lockRing = at(new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.12, 8, 28), MAT.accent), 0, 1.7, 9.05);
  g.add(lock, lockRing, cyl(1.5, 1.5, 0.12, MAT.hull2, 0, 1.7, 9.1, 24).rotateX(Math.PI / 2));
  g.add(box(1.25, 2.1, 0.1, MAT.dark, 0, 1.45, 9.18), box(0.5, 0.5, 0.06, MAT.glass, 0, 1.95, 9.24), box(1.3, 0.1, 0.08, glow("#3ddc97", 2), 0, 2.62, 9.2));
  const rampY = gy(0, 11.5);
  const ramp = box(2.2, 0.16, 4.2, MAT.metal, 0, (0.4 + rampY) / 2, 11.2);
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

  // obstaculos (coordenadas locales del habitat)
  const col = ms.colliders.frame(x, z, g.rotation.y);
  col.circle(0, 0, 6.5);
  col.box(0, 7.1, 1.6, 2.2);                       // esclusa
  col.box(-7.2, 0, 1.6, 1.25);                     // tunel
  col.box(-10.6, 0, 2.35, 5.05);                   // laboratorio
  for (let i = 0; i < 3; i++) col.circle(-5 + i * 5.2, -12.5, 0.3);
  col.circle(7.6, -4.5, 0.3);
  col.box(4.65, 8.4, 1.65, 0.5);                   // depositos
  col.box(-3.85, 9, 0.65, 0.65);                   // carga

  castAll(g);
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
