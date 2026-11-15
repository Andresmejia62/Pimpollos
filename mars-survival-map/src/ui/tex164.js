import * as THREE from "three";

export const TEX_SIZE = 164;
const S = TEX_SIZE, TAU = Math.PI * 2;

// Ruido de valor periodico, con semillas fijas para repetir el terreno.
function tileNoise(gx, gy, seed) {
  let s = seed;
  const gr = Array.from({ length: gx * gy }, () => ((s = s * 16807 % 2147483647) / 2147483647));
  const at = (x, y) => gr[((y % gy + gy) % gy) * gx + (x % gx + gx) % gx];
  const sm = (t) => (1 - Math.cos(t * Math.PI)) / 2;
  return (x, y) => {
    const fx = x / S * gx, fy = y / S * gy, i = Math.floor(fx), j = Math.floor(fy), u = sm(fx - i), v = sm(fy - j);
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  };
}

// Solo datos RGBA: no usa lienzos ni objetos de Three.js.
export function pixels164(kind, centered = false) {
  if (kind !== "regolith" && kind !== "bedrock") throw new Error(`Textura desconocida: ${kind}`);
  if (centered) {
    const data = pixels164(kind), means = [0, 0, 0], n = S * S;
    for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) means[c] += data[i + c] / n;
    const deviations = [];
    for (let i = 0; i < data.length; i += 4) {
      deviations.push(Math.max(...means.map((mean, c) => Math.abs(data[i + c] - mean))));
    }
    deviations.sort((a, b) => a - b);
    // Reserva margen en el percentil 99,5: menos del 1% de pixeles saturados.
    const gain = 126 / Math.max(1, deviations[Math.floor(n * 0.995)]);
    for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) data[i + c] = 128 + (data[i + c] - means[c]) * gain;
    return data;
  }
  const broad = tileNoise(5, 5, 171), fine = tileNoise(41, 41, 172), warp = tileNoise(8, 8, 173);
  const data = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = broad(x, y), b = fine(x, y), w = warp(x, y);
    let value;
    if (kind === "regolith") {
      const ripple = Math.sin(TAU * (y * 7 / S + x * 2 / S) + 2 * a);
      const pebble = Math.max(0, (b - 0.78) / 0.22);
      value = 224 + 48 * (a - 0.5) + 36 * (b - 0.5) + 15 * ripple - 75 * pebble;
    } else {
      const strata = Math.sin(TAU * (y * 9 / S + x * 3 / S) + 3 * a);
      const fracture = 1 - Math.min(1, Math.abs(w - 0.5) / 0.045);
      value = 232 + 55 * (a - 0.5) + 30 * (b - 0.5) + 18 * strata - 65 * fracture;
    }
    const k = (y * S + x) * 4;
    data[k] = value; data[k + 1] = value - 1; data[k + 2] = value - 2; data[k + 3] = 255;
  }
  return data;
}

const means = new Map(), canvases = new Map(), textures = new Map();
export function meanLuma164(kind) {
  if (means.has(kind)) return means.get(kind);
  const data = pixels164(kind);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
  const mean = sum / (S * S * 255);
  means.set(kind, mean);
  return mean;
}

export function canvas164(kind, centered = false) {
  const key = `${kind}|${centered}`;
  if (canvases.has(key)) return canvases.get(key);
  const pixels = pixels164(kind, centered), cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d"), im = ctx.createImageData(S, S);
  im.data.set(pixels); ctx.putImageData(im, 0, 0);
  canvases.set(key, cv);
  return cv;
}

export function texture164(kind) {
  if (textures.has(kind)) return textures.get(kind);
  const tex = new THREE.CanvasTexture(canvas164(kind));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  textures.set(kind, tex);
  return tex;
}
