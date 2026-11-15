// Interiores caminables: estructuras circulares (cupulas, invernaderos) en las que se entra a pie por sus
// esclusas. Cada interior aporta:
//  - un suelo propio (mas alto que el terreno) y una rampa en cada puerta, via floorAt(x, z);
//  - un muro de colisiones alrededor con huecos en las puertas, y paredes laterales en cada esclusa;
//  - un refugio presurizado (Game lo trata como los de la mision: recarga O2 y bateria, protege de tormentas).
export const INTERIORS = [];

// Altura del suelo de algun interior en (x, z), o null si no hay
export function floorAt(x, z) {
  let best = null;
  for (const it of INTERIORS) {
    const dx = x - it.x, dz = z - it.z;
    if (Math.abs(dx) > it.reach || Math.abs(dz) > it.reach) continue;
    const d = Math.hypot(dx, dz);
    if (d <= it.r) { best = Math.max(best ?? -Infinity, it.floorY); continue; }
    // rampas de las puertas: del suelo interior (dentro) al terreno (fuera)
    for (const dr of it.doors) {
      const along = dx * dr.ux + dz * dr.uz, side = -dx * dr.uz + dz * dr.ux;
      if (along < it.r - 0.5 || along > it.r + dr.len || Math.abs(side) > dr.w / 2 + 0.2) continue;
      // tramo llano dentro de la esclusa (flat m) y luego la rampa hasta el terreno
      const fl = dr.flat || 0;
      const f = (along - it.r - fl) / Math.max(0.1, dr.len - fl);
      const y = it.floorY + (dr.outerY - it.floorY) * Math.max(0, Math.min(1, f));
      best = Math.max(best ?? -Infinity, y);
    }
  }
  return best;
}

// Altura del suelo que pisa el astronauta: terreno o, si esta mas alto, el suelo de un interior
export function makeGround(heightAt) {
  return (x, z) => {
    const h = heightAt(x, z), f = INTERIORS.length ? floorAt(x, z) : null;
    return f != null && f > h - 0.05 ? f : h;
  };
}

// Registra un interior circular. ms: MarsScene. opts: { id, name, x, z, yaw, r, floorY, wallTop,
// doors: [{ a (rad, local: 0 = +z), len (m hacia fuera), w (ancho libre, m), flat (m llanos antes de la rampa) }],
// noShelter: no crear un refugio aparte (la estructura ya es un refugio de la mision) }
export function addWalkIn(ms, { id, name, x, z, yaw = 0, r, floorY, wallTop, doors = [], noShelter = false }) {
  const C = ms.colliders;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const toW = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const ds = doors.map((d) => {
    // direccion de la puerta en el mundo
    const [ex, ez] = toW(Math.sin(d.a), Math.cos(d.a));
    const ux = ex - x, uz = ez - z;
    const [ox, oz] = toW(Math.sin(d.a) * (r + d.len), Math.cos(d.a) * (r + d.len));
    return { ...d, ux, uz, outerY: ms.heightAt(ox, oz) };
  });
  // muro: circulos a lo largo del perimetro, salvo en los huecos de las puertas
  const step = 1.6, n = Math.ceil((2 * Math.PI * r) / step);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (doors.some((d) => Math.abs(Math.atan2(Math.sin(a - d.a), Math.cos(a - d.a))) * r < d.w / 2 + 0.7)) continue;
    const [wx, wz] = toW(Math.sin(a) * (r + 0.3), Math.cos(a) * (r + 0.3));
    C.addCircle(wx, wz, 0.9, wallTop);
  }
  // paredes laterales de cada esclusa (un pasillo de ancho w)
  for (const d of doors) {
    const ca = Math.cos(d.a), sa = Math.sin(d.a);
    for (const side of [-1, 1]) {
      const off = side * (d.w / 2 + 0.35);
      const mid = r + d.len / 2;
      const lx = sa * mid + ca * off, lz = ca * mid - sa * off;
      const [wx, wz] = toW(lx, lz);
      C.addBox(wx, wz, 0.3, d.len / 2 + 0.6, yaw + d.a, wallTop);
    }
  }
  const it = { id, name, x, z, r, floorY, doors: ds, noShelter, reach: r + Math.max(...doors.map((d) => d.len), 0) + 2 };
  INTERIORS.push(it);
  return it;
}

// Colisiones de objetos dentro de un interior, en coordenadas locales del interior
export function interiorFrame(ms, x, z, yaw) { return ms.colliders.frame(x, z, yaw); }
