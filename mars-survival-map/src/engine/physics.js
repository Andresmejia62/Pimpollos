// Fisica del juego: constantes de Marte y colisiones en planta (circulos y cajas orientadas).
// El terreno es un campo de alturas; la gravedad y los saltos se integran en gameplay/game.js.

export const MARS = {
  g: 3.72,            // m/s^2 en la superficie (NASA Mars Fact Sheet)
  gEarth: 9.81,
  ratio: 0.38,        // g de Marte / g de la Tierra
};

export const PHYS = {
  // a pie
  radius: 0.42,       // radio del astronauta (m)
  step: 0.35,         // escalon que se sube sin saltar (m)
  jumpV: 3.4,         // velocidad de salto: ~1,55 m de altura y ~1,8 s en el aire con la gravedad de Marte
  accel: 20,          // m/s^2 al arrancar (suelo)
  friction: 16,       // m/s^2 al soltar las teclas (suelo)
  airAccel: 2.5,      // casi sin control en el aire
  crestTol: 0.9,      // m/s: cambio brusco de pendiente que el cuerpo absorbe sin despegar
  slideK: 0.6,        // fraccion de g*sin(pendiente) que arrastra cuesta abajo en laderas resbaladizas
  safeImpact: 5.5,    // m/s: caida libre de ~4 m en Marte (en la Tierra bastarian 1,5 m)
  impactDamage: 3,    // integridad perdida por cada m/s por encima del limite
  // Land Rover
  carRadius: 1.05,    // dos circulos, delante y detras
  carAxle: 1.3,
  carClear: 0.45,     // altura libre: las rocas mas bajas se pasan por encima
  carAccel: 9,
  carBrake: 13,
  carTurn: 2.3,       // rad/s
  carCrestTol: 2.2,   // la suspension absorbe mas que las piernas
  carSafeImpact: 7.5,
  carImpactDamage: 1.2,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Empuja el circulo p = {x, z} de radio r fuera del obstaculo o. Devuelve true si habia contacto
// y deja en p.nx, p.nz la normal del contacto (hacia fuera del obstaculo).
function pushOut(p, r, o) {
  const dx = p.x - o.x, dz = p.z - o.z;
  if (o.hx === undefined) {
    const rr = r + o.r, d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) return false;
    const d = Math.sqrt(d2);
    const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
    p.x = o.x + nx * rr; p.z = o.z + nz * rr;
    p.nx = nx; p.nz = nz;
    return true;
  }
  // caja orientada: se trabaja en su sistema local (x' = lx c + lz s ; z' = -lx s + lz c)
  const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
  const ex = lx - clamp(lx, -o.hx, o.hx), ez = lz - clamp(lz, -o.hz, o.hz);
  const d = Math.hypot(ex, ez);
  let nx, nz, pen;
  if (d > 1e-6) {
    if (d >= r) return false;
    nx = ex / d; nz = ez / d; pen = r - d;
  } else {
    // el centro esta dentro: sale por la cara mas cercana
    const px = o.hx - Math.abs(lx), pz = o.hz - Math.abs(lz);
    if (px < pz) { nx = lx < 0 ? -1 : 1; nz = 0; pen = px + r; }
    else { nx = 0; nz = lz < 0 ? -1 : 1; pen = pz + r; }
  }
  const wx = nx * o.c + nz * o.s, wz = -nx * o.s + nz * o.c;
  p.x += wx * pen; p.z += wz * pen;
  p.nx = wx; p.nz = wz;
  return true;
}

export const boxCollider = (x, z, hx, hz, yaw) => ({ x, z, hx, hz, c: Math.cos(yaw), s: Math.sin(yaw) });

export class Colliders {
  constructor() {
    this.statics = [];   // estructuras: {x, z, r} o cajas orientadas
    this.rocks = [];     // rocas cercanas al jugador: {x, z, r, top}; las regenera la escena
  }

  addCircle(x, z, r) { this.statics.push({ x, z, r }); }
  addBox(x, z, hx, hz, yaw) { this.statics.push(boxCollider(x, z, hx, hz, yaw)); }

  // Para registrar obstaculos en las coordenadas locales de una estructura girada (rotation.y = yaw)
  frame(cx, cz, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const wx = (lx, lz) => cx + lx * c + lz * s, wz = (lx, lz) => cz - lx * s + lz * c;
    return {
      circle: (lx, lz, r) => this.addCircle(wx(lx, lz), wz(lx, lz), r),
      box: (lx, lz, hx, hz) => this.addBox(wx(lx, lz), wz(lx, lz), hx, hz, yaw),
    };
  }

  // Saca el circulo p = {x, z} de todos los obstaculos. Las rocas cuya cima queda por debajo de
  // feetY + step no cuentan: se pisan o se pasan por encima. `extra` es un obstaculo movil opcional.
  resolve(p, r, feetY, step, extra) {
    p.hit = false;
    for (let pass = 0; pass < 2; pass++) {
      let any = false;
      for (const o of this.statics) if (pushOut(p, r, o)) any = true;
      if (extra && pushOut(p, r, extra)) any = true;
      for (const k of this.rocks) if (k.top > feetY + step && pushOut(p, r, k)) any = true;
      if (!any) break;
      p.hit = true;
    }
    return p;
  }

  // Suelo efectivo: el terreno o la cima de una roca sobre la que se puede estar de pie
  groundOn(x, z, feetY, step, base) {
    let g = base;
    for (const k of this.rocks) {
      if (k.top <= g || k.top > feetY + step) continue;
      const dx = x - k.x, dz = z - k.z, rr = k.r * 0.75;
      if (dx * dx + dz * dz < rr * rr) g = k.top;
    }
    return g;
  }
}
