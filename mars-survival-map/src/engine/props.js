import * as THREE from "three";

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

// ---- Land Rover: todoterreno clasico adaptado a Marte, conducible ----------------------------------
export const LAND_ROVER = { wheelR: 0.46 };

export function buildLandRover(ms) {
  const P = {
    body: std("#2f4b3a", 0.55, 0.15),        // verde clasico
    roof: std("#eae5d8", 0.7),
    wheel: std("#e2dccd", 0.6, 0.2),
    trim: std("#1b1c1f", 0.8),
    head: glow("#fff3cf", 1.2),
    tail: glow("#ff3b30", 1.0),
    amber: glow("#ffb02e", 0.9),
    bar: glow("#fff8e6", 0.4),
  };
  const R = LAND_ROVER.wheelR;
  const root = new THREE.Group();      // posicion, rumbo e inclinacion del terreno
  const body = new THREE.Group();      // carroceria: balanceo de la suspension
  root.add(body);

  // bastidor, ejes y ruedas
  body.add(box(1.4, 0.16, 4.2, P.trim, 0, 0.66, -0.05));
  const AXLES = [-1.35, 1.25];
  const wheels = [];
  for (const wz of AXLES) {
    root.add(cyl(0.07, 0.07, 1.6, P.trim, 0, R, wz, 8).rotateZ(Math.PI / 2), ball(0.17, P.trim, 0.1, R, wz, 10));
    for (const sx of [-1, 1]) {
      const wh = makeWheel(R, 0.3, P.wheel);
      wh.root.position.set(sx * 0.83, R, wz);
      wh.front = wz < 0;
      root.add(wh.root);
      wheels.push(wh);
      body.add(box(0.14, 0.07, 1.16, P.trim, sx * 0.94, 0.985, wz));                // aleta
    }
  }

  // carroceria baja (hasta la linea de cintura), estribos y franja de mision
  body.add(box(1.8, 0.55, 4.5, P.body, 0, 1.225, 0));
  body.add(box(1.82, 0.07, 4.52, MAT.accent, 0, 1.41, 0));
  body.add(box(1.84, 0.1, 1.46, P.trim, 0, 0.9, -0.05));
  // capo, parrilla, faros y defensa
  body.add(box(1.34, 0.13, 1.36, P.body, 0, 1.565, -1.55), box(1.2, 0.02, 0.04, P.trim, 0, 1.635, -1.2));
  body.add(box(1.02, 0.36, 0.06, P.trim, 0, 1.25, -2.26));
  for (let i = 0; i < 5; i++) body.add(box(0.9, 0.025, 0.03, MAT.metal, 0, 1.13 + i * 0.06, -2.3));
  for (const sx of [-1, 1]) {
    body.add(cyl(0.15, 0.15, 0.06, P.trim, sx * 0.66, 1.27, -2.26, 16).rotateX(Math.PI / 2));
    body.add(cyl(0.125, 0.125, 0.05, P.head, sx * 0.66, 1.27, -2.285, 16).rotateX(Math.PI / 2));
    body.add(box(0.09, 0.09, 0.04, P.amber, sx * 0.8, 1.06, -2.265), box(0.09, 0.07, 0.04, P.bar, sx * 0.8, 1.48, -2.265));
  }
  body.add(box(1.92, 0.17, 0.2, P.trim, 0, 0.88, -2.38), box(0.36, 0.2, 0.26, MAT.metal, 0, 0.92, -2.5));
  // barra de proteccion delantera
  for (const sx of [-0.48, 0.48]) body.add(cyl(0.035, 0.035, 0.7, P.trim, sx, 1.2, -2.47, 8));
  body.add(cyl(0.035, 0.035, 1.04, P.trim, 0, 1.55, -2.47, 8).rotateZ(Math.PI / 2), cyl(0.03, 0.03, 1.0, P.trim, 0, 1.22, -2.47, 8).rotateZ(Math.PI / 2));

  // cabina: parabrisas casi vertical, ventanas laterales y ventanillas alpinas en el techo
  body.add(box(1.74, 0.62, 3.0, P.body, 0, 1.81, 0.72));
  const shield = box(1.56, 0.5, 0.05, MAT.glass, 0, 1.82, -0.8);
  shield.rotation.x = 0.1;
  body.add(shield, box(0.04, 0.5, 0.04, P.body, 0, 1.82, -0.82));
  for (const sx of [-1, 1]) {
    body.add(box(0.04, 0.4, 0.82, MAT.glass, sx * 0.875, 1.84, -0.28), box(0.04, 0.4, 0.74, MAT.glass, sx * 0.875, 1.84, 0.58), box(0.04, 0.34, 0.86, MAT.glass, sx * 0.875, 1.84, 1.58));
    body.add(box(0.26, 0.02, 0.6, MAT.glass, sx * 0.72, 2.205, 1.45));                                  // ventanilla alpina
    for (const dz of [-0.78, 0.16, 1.06]) body.add(box(0.012, 0.52, 0.025, P.trim, sx * 0.905, 1.22, dz));   // juntas de puerta
    for (const dz of [0.02, 0.92]) body.add(box(0.03, 0.04, 0.14, MAT.metal, sx * 0.915, 1.36, dz));        // tiradores
    body.add(box(0.2, 0.03, 0.03, P.trim, sx * 0.98, 1.66, -0.74), box(0.05, 0.17, 0.12, P.trim, sx * 1.07, 1.72, -0.74)); // retrovisor
    body.add(box(0.1, 0.2, 0.05, P.tail, sx * 0.78, 1.3, 2.265), box(0.1, 0.09, 0.05, P.amber, sx * 0.78, 1.12, 2.265));
  }
  body.add(box(0.95, 0.36, 0.05, MAT.glass, -0.22, 1.86, 2.225));
  // techo blanco y baca con panel solar, barra de luces y carga
  body.add(box(1.82, 0.09, 3.1, P.roof, 0, 2.155, 0.72));
  for (const sx of [-0.8, 0.8]) {
    body.add(box(0.05, 0.05, 2.9, P.trim, sx, 2.33, 0.75));
    for (const dz of [-0.6, 0.75, 2.1]) body.add(box(0.04, 0.14, 0.04, P.trim, sx, 2.26, dz));
  }
  for (const dz of [-0.68, 0.1, 0.9, 1.6, 2.18]) body.add(box(1.64, 0.04, 0.05, P.trim, 0, 2.33, dz));
  body.add(box(1.3, 0.05, 1.2, MAT.solar, 0, 2.38, 0.2), box(1.2, 0.09, 0.09, P.bar, 0, 2.4, -0.68));
  body.add(box(0.6, 0.32, 0.8, MAT.accent, -0.38, 2.51, 1.55), box(0.24, 0.4, 0.5, MAT.metal, 0.42, 2.55, 1.6), box(0.24, 0.4, 0.5, P.body, 0.14, 2.55, 1.6));
  // toma de aire elevada (filtra el polvo), antena y rueda de repuesto
  body.add(box(0.09, 0.95, 0.09, P.trim, 0.9, 1.98, -0.9), box(0.13, 0.16, 0.16, P.trim, 0.9, 2.5, -0.9));
  const tipMat = glow("#ff4d4d", 1.5);
  body.add(cyl(0.012, 0.018, 1.5, MAT.metal, -0.8, 2.9, 2.1, 6), ball(0.04, tipMat, -0.8, 3.66, 2.1, 8));
  const spare = makeWheel(0.43, 0.26, P.wheel).root;
  spare.rotation.y = Math.PI / 2;
  body.add(at(spare, 0.28, 1.5, 2.4));
  body.add(box(1.92, 0.15, 0.17, P.trim, 0, 0.88, 2.34));
  for (const dy of [1.0, 1.3, 1.6, 1.9]) body.add(box(0.3, 0.03, 0.03, MAT.metal, -0.68, dy, 2.29));
  for (const sx of [-0.83, -0.53]) body.add(box(0.03, 1.15, 0.03, MAT.metal, sx, 1.45, 2.29));

  castAll(root);
  ms.scene.add(root);

  // estela de polvo: un pequeno grupo de particulas recicladas
  const N = 56;
  const dPos = new Float32Array(N * 3), dAge = new Float32Array(N).fill(1), dVel = new Float32Array(N * 3);
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));
  dGeo.setAttribute("aAge", new THREE.BufferAttribute(dAge, 1));
  const dMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uScale: ms.dustMat.uniforms.uScale, uColor: { value: ms.fogColor } },
    vertexShader: /* glsl */ `
      uniform float uScale; attribute float aAge; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (0.7 + 2.6 * aAge) / max(-mv.z, 0.5);
        vA = aAge >= 1.0 ? 0.0 : (1.0 - aAge) * smoothstep(0.0, 0.08, aAge);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying float vA;
      void main() {
        float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * vA * 0.4;
        gl_FragColor = vec4(uColor * 0.82, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dust = new THREE.Points(dGeo, dMat);
  dust.frustumCulled = false;
  dust.renderOrder = 4;
  ms.scene.add(dust);

  const st = { yaw: 0, init: false, spin: 0, steer: 0, n: new THREE.Vector3(0, 1, 0), next: 0, emit: 0, x: 0, z: 0 };
  const nTmp = new THREE.Vector3(), q = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), rear = new THREE.Vector3();
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  function update(dt, x, z, heading, speed, time) {
    const jumped = !st.init || Math.hypot(x - st.x, z - st.z) > 6;
    st.x = x; st.z = z;
    ms.normalAt(x, z, nTmp);
    const dh = wrap(heading - st.yaw);
    if (jumped) { st.yaw = heading; st.n.copy(nTmp); st.init = true; }
    else {
      st.yaw += dh * Math.min(1, dt * 6);
      st.n.lerp(nTmp, Math.min(1, dt * 7)).normalize();
    }
    root.position.set(x, ms.heightAt(x, z), z);
    root.quaternion.copy(q.setFromUnitVectors(UP, st.n)).multiply(qYaw.setFromAxisAngle(UP, st.yaw));

    // ruedas: rodadura y direccion
    const k = Math.min(1, speed / 8);
    st.spin -= (speed * dt) / R;
    st.steer += ((speed > 0.3 ? Math.max(-0.55, Math.min(0.55, dh * 1.6)) : 0) - st.steer) * Math.min(1, dt * 9);
    for (const wh of wheels) {
      wh.spin.rotation.x = st.spin;
      if (wh.front) wh.steer.rotation.y = st.steer;
    }
    // suspension: vibra con el terreno y se inclina en las curvas
    body.position.y = Math.sin(time * 11) * 0.012 * k + Math.sin(time * 5.3) * 0.01 * k;
    body.rotation.z = -st.steer * 0.07 * k;
    body.rotation.x = Math.sin(time * 7.1) * 0.006 * k;
    P.head.emissiveIntensity = 1.2 + 1.6 * k;
    P.bar.emissiveIntensity = 0.4 + 1.8 * (speed > 0.3 ? 1 : 0);
    tipMat.emissiveIntensity = Math.sin(time * 4) > 0.7 ? 3 : 0.3;

    // polvo detras de las ruedas traseras
    st.emit += speed * dt;
    if (speed > 1.5 && st.emit > 0.9) {
      st.emit = 0;
      for (const sx of [-0.83, 0.83]) {
        const i = st.next = (st.next + 1) % N;
        rear.set(sx, 0.15, 1.7).applyQuaternion(root.quaternion).add(root.position);
        dPos[i * 3] = rear.x; dPos[i * 3 + 1] = rear.y; dPos[i * 3 + 2] = rear.z;
        dVel[i * 3] = (Math.random() - 0.5) * 1.2; dVel[i * 3 + 1] = 0.9 + Math.random() * 0.8; dVel[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
        dAge[i] = 0;
      }
    }
    for (let i = 0; i < N; i++) {
      if (dAge[i] >= 1) continue;
      dAge[i] = Math.min(1, dAge[i] + dt / 2.2);
      dPos[i * 3] += dVel[i * 3] * dt; dPos[i * 3 + 1] += dVel[i * 3 + 1] * dt * (1 - dAge[i]); dPos[i * 3 + 2] += dVel[i * 3 + 2] * dt;
    }
    dGeo.attributes.position.needsUpdate = true;
    dGeo.attributes.aAge.needsUpdate = true;
  }

  return { group: root, update };
}
