import * as THREE from "three";

// Texturas de las estructuras: lienzos de 64 x 64 px generados al cargar (sin archivos externos).
// Casi todas son en tonos claros: multiplican el color del material, asi cada material conserva su color y la
// textura aporta juntas, remaches, vetas o trama. Sirven tambien de relieve (bumpMap): lo oscuro queda hundido.
// Las UV de las piezas se pasan a metros (metricUVs), de modo que `tile` es lo que mide un mosaico en metros.
export const TEX_SIZE = 64;
const S = TEX_SIZE;

// ruido de valor repetible (se puede poner en mosaico)
function tileNoise(gx, gy, seed) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const gr = Array.from({ length: gx * gy }, rnd), sm = (t) => (1 - Math.cos(t * Math.PI)) / 2;
  const at = (i, j) => gr[(((j % gy) + gy) % gy) * gx + (((i % gx) + gx) % gx)];
  return (x, y) => {
    const fx = (x / S) * gx, fy = (y / S) * gy, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
  };
}
const gray = (v, warm = 0) => [v, v * (1 - 0.012 * warm), v * (1 - 0.04 * warm)];

// Cada dibujo devuelve [r, g, b] (0-255) para el pixel (x, y)
const DRAW = {
  // paneles del casco: 2 x 2 placas por mosaico, con junta hundida, canto claro, remaches y algo de polvo
  panel() {
    const dirt = tileNoise(4, 4, 11), fine = tileNoise(32, 32, 12), streak = tileNoise(16, 2, 13);
    return (x, y) => {
      const px = x % 32, py = y % 32;
      let v = 232 + 12 * (dirt(x, y) - 0.5) + 7 * (fine(x, y) - 0.5) - 9 * streak(x, y) * (py / 32);
      if (px === 0 || py === 0) v = 150; else if (px === 1 || py === 1) v = 247; else if (px === 31 || py === 31) v -= 14;
      const rx = Math.min(px, 32 - px), ry = Math.min(py, 32 - py);
      if ((rx === 4 || rx === 5) && (ry === 4 || ry === 5)) v = rx === 4 && ry === 4 ? 250 : 168;      // remache
      return gray(v, 1);
    };
  },
  // metal cepillado: vetas largas en una direccion
  brushed() {
    const vein = tileNoise(2, 32, 21), vein2 = tileNoise(4, 64, 22), spot = tileNoise(6, 6, 23);
    return (x, y) => gray(206 + 34 * (vein(x, y) - 0.5) + 22 * (vein2(x, y) - 0.5) + 10 * (spot(x, y) - 0.5));
  },
  // goma y materiales compuestos oscuros: grano fino
  rubber() {
    const a = tileNoise(32, 32, 31), b = tileNoise(8, 8, 32);
    return (x, y) => gray(214 + 34 * (a(x, y) - 0.5) + 16 * (b(x, y) - 0.5));
  },
  // pintura con desconchones y polvo en las zonas gastadas
  paint() {
    const chip = tileNoise(9, 9, 41), fine = tileNoise(32, 32, 42);
    return (x, y) => {
      const c = chip(x, y);
      return gray(c > 0.74 ? 178 + 60 * (0.9 - c) : 238 + 8 * (fine(x, y) - 0.5), c > 0.74 ? 2 : 0);
    };
  },
  // regolito, regolito sinterizado y hormigon: granos y poros
  grain() {
    const a = tileNoise(16, 16, 51), b = tileNoise(32, 32, 52), c = tileNoise(5, 5, 53);
    return (x, y) => {
      const pore = b(x, y) > 0.86 ? -42 : 0;
      return gray(206 + 44 * (a(x, y) - 0.5) + 26 * (c(x, y) - 0.5) + pore);
    };
  },
  // tela acolchada: rombos cosidos con el centro abombado y trama
  fabric() {
    const fine = tileNoise(32, 32, 61);
    return (x, y) => {
      const d1 = (x + y) % 16, d2 = (((x - y) % 16) + 16) % 16;
      const e = Math.min(d1, 16 - d1, d2, 16 - d2);
      const v = e < 1 ? 170 : 208 + 30 * Math.min(1, e / 6) + 8 * (fine(x, y) - 0.5) + ((x + y) & 1 ? 3 : -3);
      return gray(v, 0.5);
    };
  },
  // manta termica metalizada: facetas arrugadas
  foil() {
    const a = tileNoise(6, 6, 71), b = tileNoise(13, 13, 72);
    return (x, y) => gray(176 + 78 * Math.abs(a(x, y) - 0.5) * 2 * (0.5 + 0.5 * b(x, y)) + 16 * (b(x, y) - 0.5));
  },
  // chapa antideslizante: lagrimas en dos direcciones
  tread() {
    const fine = tileNoise(32, 32, 81);
    return (x, y) => {
      const cx = x % 16, cy = y % 16, odd = ((x >> 4) + (y >> 4)) & 1;
      const u = odd ? cx - cy : cx + cy - 15, w = odd ? cx + cy - 15 : cx - cy;
      const lug = Math.abs(u) <= 1 && Math.abs(w) <= 5;
      return gray(lug ? 250 : 200 + 10 * (fine(x, y) - 0.5));
    };
  },
  // celulas solares (en color): 4 x 4 celulas con sus hilos conductores y marco plateado
  solar() {
    const fine = tileNoise(32, 32, 91);
    return (x, y) => {
      const cx = x % 16, cy = y % 16;
      if (cx === 0 || cy === 0) return [168, 176, 190];
      if (cy === 5 || cy === 11) return [52, 76, 128];
      const k = 0.9 + 0.2 * (fine(x, y) - 0.5) + 0.12 * (cx / 16);
      return [22 * k + 4, 38 * k + 4, 78 * k + 6];
    };
  },
  // interior del habitat (en color): panel acolchado como el aislamiento de los modulos de la ISS
  wall() {
    return (x, y) => {
      if (x === 0 || y === 0) return [168, 162, 150];
      const d = Math.min(1, Math.hypot(x - 32, y - 32) / 40);
      const corner = Math.hypot(Math.min(x, 64 - x) - 4, Math.min(y, 64 - y) - 4) < 1.8;
      if (corner) return [141, 134, 121];
      return [244 - 37 * d, 241 - 40 * d, 234 - 45 * d];
    };
  },
  // suelo del habitat (en color): una placa con rejilla de tacos
  floor() {
    return (x, y) => {
      if (x < 2 || y < 2) return [58, 61, 68];
      const sx = (x - 7) % 9, sy = (y - 7) % 9;
      if (x >= 7 && y >= 7 && x < 61 && y < 61 && sx < 5 && sy < 5) return [106, 110, 119];
      return [86, 90, 98];
    };
  },
};

const _canvas = new Map();
function canvasOf(kind) {
  let cv = _canvas.get(kind);
  if (cv) return cv;
  cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d"), im = ctx.createImageData(S, S), f = DRAW[kind]();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const c = f(x, y), k = (y * S + x) * 4;
    im.data[k] = Math.max(0, Math.min(255, c[0])); im.data[k + 1] = Math.max(0, Math.min(255, c[1])); im.data[k + 2] = Math.max(0, Math.min(255, c[2])); im.data[k + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  _canvas.set(kind, cv);
  return cv;
}

// Textura 64 x 64 de un tipo. repeatU/repeatV: repeticiones por unidad de UV.
const _tex = new Map();
export function tex64(kind, repeatU = 1, repeatV = repeatU) {
  const key = `${kind}|${repeatU}|${repeatV}`;
  let t = _tex.get(key);
  if (t) return t;
  t = new THREE.CanvasTexture(canvasOf(kind));
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatU, repeatV);
  t.anisotropy = 4;
  _tex.set(key, t);
  return t;
}

// Pone a un material una textura 64 x 64. tile = metros que mide un mosaico; bump = fuerza del relieve (0 = sin relieve).
// Devuelve el material. Las piezas que lo usan reciben UV en metros con metricUVs().
export function skin(mat, kind, tile = 2, bump = 0) {
  const t = tex64(kind, 1 / tile);
  mat.map = t;
  if (bump) { mat.bumpMap = t; mat.bumpScale = bump; }
  mat.userData.tex64 = kind;
  mat.needsUpdate = true;
  return mat;
}

// Pasa a metros las UV de las primitivas (cajas, cilindros, esferas...) que usan un material con textura 64 x 64,
// para que el mosaico tenga el mismo tamano en una pared de 10 m que en una caja de 30 cm.
export function metricUVs(root) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material) || !o.material || !o.material.userData.tex64) return;
    const g = o.geometry, P = g && g.parameters, uv = g && g.attributes.uv, nor = g && g.attributes.normal;
    if (!P || !uv || !nor || g.userData.metricUV) return;
    g.userData.metricUV = true;
    const sx = Math.abs(o.scale.x), sy = Math.abs(o.scale.y), sz = Math.abs(o.scale.z), sr = Math.max(sx, sz);
    const each = (fn) => { for (let i = 0; i < uv.count; i++) { const r = fn(uv.getX(i), uv.getY(i), i); uv.setXY(i, r[0], r[1]); } uv.needsUpdate = true; n++; };
    switch (g.type) {
      case "BoxGeometry": {
        const w = P.width * sx, h = P.height * sy, d = P.depth * sz;
        each((u, v, i) => {
          const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i));
          return ax > 0.5 ? [u * d, v * h] : ay > 0.5 ? [u * w, v * d] : [u * w, v * h];
        });
        break;
      }
      case "CylinderGeometry": case "ConeGeometry": {
        const rt = (P.radiusTop ?? 0) * sr, rb = (P.radiusBottom ?? P.radius ?? 0) * sr, h = P.height * sy;
        const around = Math.max(rt, rb) * (P.thetaLength ?? Math.PI * 2);
        // las tapas van despues del manto; su normal es exactamente vertical
        const sideCount = ((P.radialSegments ?? 32) + 1) * ((P.heightSegments ?? 1) + 1);
        each((u, v, i) => {
          if (i < sideCount) return [u * around, v * h];
          const r = nor.getY(i) > 0 ? rt : rb;
          return [(u - 0.5) * 2 * r, (v - 0.5) * 2 * r];
        });
        break;
      }
      case "SphereGeometry": {
        const r = P.radius * (sx + sy + sz) / 3;
        each((u, v) => [u * r * (P.phiLength ?? Math.PI * 2), v * r * (P.thetaLength ?? Math.PI)]);
        break;
      }
      case "CircleGeometry": { const r = P.radius * sr; each((u, v) => [(u - 0.5) * 2 * r, (v - 0.5) * 2 * r]); break; }
      case "PlaneGeometry": { const w = P.width * sx, h = P.height * sy; each((u, v) => [u * w, v * h]); break; }
      case "TorusGeometry": { const a = P.radius * sr * (P.arc ?? Math.PI * 2), b = P.tube * sr * Math.PI * 2; each((u, v) => [u * a, v * b]); break; }
      case "CapsuleGeometry": { const a = P.radius * sr * Math.PI * 2, b = ((P.height ?? P.length ?? 0) + 2 * P.radius) * sy; each((u, v) => [u * a, v * b]); break; }
      default: g.userData.metricUV = false;
    }
  });
  return n;
}
