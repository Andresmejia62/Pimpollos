// Fisica del juego: constantes de Marte, colisiones en planta (circulos y cajas orientadas, con altura)
// y cuerpos sueltos (cajas, bidones, rocas) que caen, ruedan, resbalan y se empujan.
// El terreno es un campo de alturas; el movimiento del jugador y del rover se integra en gameplay/game.js.

export const MARS = {
  g: 3.72,              // m/s^2 en la superficie (NASA Mars Fact Sheet)
  gEarth: 9.81,
  ratio: 0.38,          // g de Marte / g de la Tierra
  airDensity: 0.02,     // kg/m^3 (Tierra: 1,2): el aire no frena nada apreciable; no se simula rozamiento con el aire
  pressureMbar: 7,
};

// El peso baja al 38 %, pero la masa (la inercia) es la misma: frenar o empujar cuesta igual que en la Tierra,
// y como el rozamiento depende del peso, todo agarra menos y resbala mas lejos.
export const PHYS = {
  // El mundo esta comprimido (el astronauta "camina" a 7 m/s): las aceleraciones de traccion se escalan
  // por el mismo factor para que arrancar y frenar duren lo mismo que a escala real.
  realWalkSpeed: 1.5,
  // a pie
  radius: 0.42,         // radio del astronauta (m)
  mass: 125,            // astronauta + traje (kg)
  step: 0.35,           // escalon que se sube sin saltar (m)
  jumpV: 3.4,           // velocidad de salto: ~1,55 m de altura y ~1,8 s en el aire con la gravedad de Marte
  bootMu: 0.9,          // rozamiento de las botas sobre regolito: traccion = mu * g * cos(pendiente)
  airAccel: 2.5,        // casi sin control en el aire
  crestTol: 0.9,        // m/s: cambio brusco de pendiente que el cuerpo absorbe sin despegar
  slideK: 0.6,          // fraccion de g*sin(pendiente) que arrastra cuesta abajo en laderas de regolito suelto
  safeImpact: 5.5,      // m/s: caida libre de ~4 m en Marte (en la Tierra bastarian 1,5 m)
  impactDamage: 3,      // integridad perdida por cada m/s por encima del limite
  // Rover marciano (estilo Curiosity/Perseverance, escala para tripulacion)
  carRadius: 1.35,      // dos circulos, delante y detras (vias de 2,8 m con las ruedas)
  carAxle: 1.3,
  carMass: 1800,
  carClear: 0.6,        // altura libre del rocker-bogie: pasa por encima de rocas de hasta ~60 cm
  carMu: 0.62,          // neumaticos sobre regolito: limita la frenada y la aceleracion
  carEngine: 9,         // m/s^2 que da el motor (si hay agarre)
  carTurn: 2.3,         // rad/s
  carCrestTol: 2.2,     // la suspension absorbe mas que las piernas
  carSafeImpact: 7.5,
  carImpactDamage: 1.2,
  carCrashSafe: 6,      // m/s contra un obstaculo sin danos
  carCrashDamage: 1.0,  // integridad por cada m/s de mas
  carBounce: 0.15,
  // cuerpos sueltos
  crr: 0.07,            // resistencia a la rodadura sobre regolito
  bodyRange: 220,       // solo se simulan los cuerpos a esta distancia del jugador (m)
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

// true si (x, z) cae dentro de la huella del obstaculo (para apoyarse encima)
function inside(o, x, z) {
  const dx = x - o.x, dz = z - o.z;
  if (o.hx === undefined) return dx * dx + dz * dz < o.r * o.r * 0.8;
  return Math.abs(dx * o.c - dz * o.s) <= o.hx && Math.abs(dx * o.s + dz * o.c) <= o.hz;
}

// top: altura (y del mundo) de la cara superior; sin ella el obstaculo es una pared de altura ilimitada
export const boxCollider = (x, z, hx, hz, yaw, top) => ({ x, z, hx, hz, c: Math.cos(yaw), s: Math.sin(yaw), top, rad: Math.hypot(hx, hz) });

export class Colliders {
  constructor() {
    this.statics = [];   // estructuras: {x, z, r, top?} o cajas orientadas
    this.rocks = [];     // rocas cercanas al jugador: {x, z, r, top}; las regenera la escena
  }

  addCircle(x, z, r, top) { this.statics.push({ x, z, r, top, rad: r }); }
  addBox(x, z, hx, hz, yaw, top) { this.statics.push(boxCollider(x, z, hx, hz, yaw, top)); }

  // Para registrar obstaculos en las coordenadas locales de una estructura girada (rotation.y = yaw)
  frame(cx, cz, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const wx = (lx, lz) => cx + lx * c + lz * s, wz = (lx, lz) => cz - lx * s + lz * c;
    return {
      wx, wz,
      circle: (lx, lz, r, top) => this.addCircle(wx(lx, lz), wz(lx, lz), r, top),
      box: (lx, lz, hx, hz, top) => this.addBox(wx(lx, lz), wz(lx, lz), hx, hz, yaw, top),
    };
  }

  // Saca el circulo p = {x, z} de todos los obstaculos. Los que tienen la cima por debajo de
  // feetY + step no cuentan: se pisan o se pasan por encima. `extra` es un obstaculo movil opcional.
  resolve(p, r, feetY, step, extra) {
    p.hit = false;
    const lim = feetY + step;
    for (let pass = 0; pass < 2; pass++) {
      let any = false;
      for (const o of this.statics) {
        const reach = o.rad + r;
        if (Math.abs(p.x - o.x) > reach || Math.abs(p.z - o.z) > reach) continue;
        if (o.top !== undefined && o.top <= lim) continue;
        if (pushOut(p, r, o)) any = true;
      }
      if (extra && pushOut(p, r, extra)) any = true;
      for (const k of this.rocks) if (k.top > lim && pushOut(p, r, k)) any = true;
      if (!any) break;
      p.hit = true;
    }
    return p;
  }

  // Suelo efectivo: el terreno o la cima de una estructura o roca sobre la que se puede estar
  groundOn(x, z, feetY, step, base, withRocks = true) {
    let g = base;
    const lim = feetY + step;
    for (const o of this.statics) {
      if (o.top === undefined || o.top <= g || o.top > lim) continue;
      if (Math.abs(x - o.x) > o.rad || Math.abs(z - o.z) > o.rad) continue;
      if (inside(o, x, z)) g = o.top;
    }
    if (withRocks) for (const k of this.rocks) {
      if (k.top <= g || k.top > lim) continue;
      const dx = x - k.x, dz = z - k.z, rr = k.r * 0.75;
      if (dx * dx + dz * dz < rr * rr) g = k.top;
    }
    return g;
  }
}

// ---- cuerpos sueltos -----------------------------------------------------------------------------
// Cada cuerpo es un circulo en planta con altura: {x, y, z, vx, vy, vz, r, h, mass, mu, rest, roll}.
//   mu   rozamiento al deslizar (cajas); los que ruedan usan PHYS.crr
//   rest restitucion: fraccion de la velocidad que conserva al rebotar
export class Dynamics {
  constructor(colliders, groundAt, half = Infinity) {
    this.colliders = colliders;
    this.groundAt = groundAt;
    this.half = half;
    this.bodies = [];
    this._p = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
  }

  add(o) {
    const b = {
      kind: o.kind || "crate", x: o.x, z: o.z, y: null, vx: 0, vy: 0, vz: 0,
      r: o.r ?? 0.5, h: o.h ?? 0.7, mass: o.mass ?? 60, mu: o.mu ?? 0.55, rest: o.rest ?? 0.15, roll: !!o.roll,
      yaw: o.yaw ?? 0, dir: o.yaw ?? 0, spin: 0, asleep: true, grounded: true, dirty: true, mesh: null,
    };
    this.bodies.push(b);
    return b;
  }

  _settle(b) { if (b.y == null) { b.y = this.groundAt(b.x, b.z); b.dirty = true; } }

  // Avanza la simulacion de los cuerpos despiertos cerca de (fx, fz)
  step(dt, fx, fz) {
    const G = MARS.g, R = PHYS.bodyRange, gA = this.groundAt, p = this._p;
    const awake = [];
    for (const b of this.bodies) {
      if (b.asleep) continue;
      if (Math.abs(b.x - fx) > R || Math.abs(b.z - fz) > R) { b.asleep = true; b.vx = b.vy = b.vz = 0; continue; }
      this._settle(b);
      awake.push(b);
    }
    if (!awake.length) return;
    const n = Math.min(4, Math.ceil(dt / 0.034)), h = dt / n;
    for (let it = 0; it < n; it++) {
      for (const b of awake) {
        if (b.asleep) continue;
        const g0 = gA(b.x, b.z);
        if (b.grounded) {
          // pendiente local: la gravedad tira cuesta abajo con g * grad / (1 + |grad|^2)
          const e = 0.6;
          const hx = (gA(b.x + e, b.z) - gA(b.x - e, b.z)) / (2 * e), hz = (gA(b.x, b.z + e) - gA(b.x, b.z - e)) / (2 * e);
          const k = 1 + hx * hx + hz * hz;
          const ax = (-G * hx) / k, az = (-G * hz) / k;
          // el rozamiento depende del peso sobre el suelo: mu * g * cos(pendiente)
          const resist = (b.roll ? PHYS.crr : b.mu) * G / Math.sqrt(k);
          const sp0 = Math.hypot(b.vx, b.vz);
          if (sp0 < 0.06 && Math.hypot(ax, az) <= resist) {
            b.vx = b.vz = b.vy = 0; b.asleep = true; b.dirty = true;   // el rozamiento estatico lo sujeta
            continue;
          }
          b.vx += ax * h; b.vz += az * h;
          const sp = Math.hypot(b.vx, b.vz), dec = resist * h;
          if (sp <= dec) { b.vx = 0; b.vz = 0; } else { b.vx *= (sp - dec) / sp; b.vz *= (sp - dec) / sp; }
        }
        // desplazamiento y choques con estructuras y rocas
        p.x = b.x + b.vx * h; p.z = b.z + b.vz * h;
        if (this.colliders.resolve(p, b.r, b.y, 0.1).hit) {
          const vn = b.vx * p.nx + b.vz * p.nz;
          if (vn < 0) { b.vx -= (1 + b.rest) * vn * p.nx; b.vz -= (1 + b.rest) * vn * p.nz; }
        }
        const lim = this.half - 12;
        if (Math.abs(p.x) > lim || Math.abs(p.z) > lim) { p.x = clamp(p.x, -lim, lim); p.z = clamp(p.z, -lim, lim); b.vx = b.vz = 0; }
        const moved = Math.hypot(p.x - b.x, p.z - b.z);
        if (moved > 1e-5) { b.dir = Math.atan2(p.x - b.x, p.z - b.z); if (b.roll && b.grounded) b.spin += moved / Math.max(0.05, b.h / 2); }
        b.x = p.x; b.z = p.z;
        // vertical: sigue el suelo, cae por los bordes y rebota al aterrizar
        const g1 = gA(b.x, b.z), sph = Math.hypot(b.vx, b.vz);
        const vG = clamp((g1 - g0) / h, -sph * 1.2 - 0.5, sph * 1.2 + 0.5);
        if (b.grounded) {
          if (b.y - g1 > 0.25 || vG < b.vy - G * h - 1.2) b.grounded = false;
          else { b.y = g1; b.vy = vG; }
        }
        if (!b.grounded) {
          b.vy -= G * h;
          b.y += b.vy * h;
          if (b.y <= g1) {
            const impact = Math.max(0, vG - b.vy);
            b.y = g1;
            if (impact * b.rest > 0.6) { b.vy = vG + impact * b.rest; b.vx *= 0.85; b.vz *= 0.85; }
            else { b.vy = vG; b.grounded = true; }
          }
        }
        b.dirty = true;
      }
      // choques entre cuerpos: se separan segun su masa y reparten la cantidad de movimiento
      for (let i = 0; i < awake.length; i++) {
        const a = awake[i];
        for (const b of this.bodies) {
          if (b === a || (!b.asleep && awake.indexOf(b) < i)) continue;
          const dx = b.x - a.x, dz = b.z - a.z, rr = a.r + b.r;
          if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr) continue;
          this._settle(b);
          if (a.y >= b.y + b.h || b.y >= a.y + a.h) continue;
          const d = Math.sqrt(d2) || 1e-4, nx = dx / d, nz = dz / d;
          const ma = a.mass, mb = b.mass, pen = rr - d;
          a.x -= nx * pen * (mb / (ma + mb)); a.z -= nz * pen * (mb / (ma + mb));
          b.x += nx * pen * (ma / (ma + mb)); b.z += nz * pen * (ma / (ma + mb));
          const vrel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
          if (vrel > 0) {
            const j = (1.3 * vrel) / (1 / ma + 1 / mb);
            a.vx -= (j / ma) * nx; a.vz -= (j / ma) * nz;
            b.vx += (j / mb) * nx; b.vz += (j / mb) * nz;
          }
          if (b.asleep) { b.asleep = false; awake.push(b); }
          a.dirty = b.dirty = true;
        }
      }
    }
  }

  // Un empujador (astronauta o rover) en p = {x, z} con radio r, velocidad v = {vx, vz} y masa `mass`
  // choca con los cuerpos: les cede cantidad de movimiento y pierde la suya (accion y reaccion).
  // Si el cuerpo no puede apartarse (esta contra una pared), el que retrocede es el empujador.
  pushBy(p, r, v, mass, feetY, clear) {
    let hit = false;
    const q = this._p;
    for (const b of this.bodies) {
      const rr = r + b.r, dx = b.x - p.x, dz = b.z - p.z;
      if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      this._settle(b);
      if (b.y + b.h <= feetY + clear) continue;          // se pasa por encima
      const d = Math.sqrt(d2) || 1e-4, nx = dx / d, nz = dz / d;
      const vrel = (v.vx - b.vx) * nx + (v.vz - b.vz) * nz;
      if (vrel > 0) {
        const j = (1.1 * vrel) / (1 / mass + 1 / b.mass);
        b.vx += (j / b.mass) * nx; b.vz += (j / b.mass) * nz;
        v.vx -= (j / mass) * nx; v.vz -= (j / mass) * nz;
        // un golpe fuerte lo levanta del suelo: con tan poca gravedad tarda en volver a caer
        const kick = (j / b.mass) * 0.22;
        if (kick > 1 && b.grounded) { b.vy += Math.min(4, kick); b.grounded = false; }
      }
      b.asleep = false; b.dirty = true;
      q.x = p.x + nx * rr; q.z = p.z + nz * rr;
      this.colliders.resolve(q, b.r, b.y, 0.1);
      b.x = q.x; b.z = q.z;
      const left = rr - Math.hypot(b.x - p.x, b.z - p.z);
      if (left > 1e-4) { p.x -= nx * left; p.z -= nz * left; p.nx = -nx; p.nz = -nz; hit = true; }
    }
    return hit;
  }
}
