import * as THREE from "three";
import { assetUrl } from "../data.js";
import { Colliders, Dynamics } from "./physics.js";
import { loadMolaGale } from "./mola.js";
import { moonsAt, sunAngularRadius } from "./moons.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

// Limpia el bufer HDR antes del resplandor: un pixel NaN o infinito (p. ej. una superficie pegada a una luz
// puntual supera el maximo del half-float) se extenderia con el desenfoque del bloom como bloques negros.
const SANITIZE = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: /* glsl */ `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // exponente con todos los bits a 1: infinito (mantisa 0) o NaN (mantisa != 0). Se comprueba con bits porque
      // algunos drivers eliminan isnan/isinf. Un infinito suele ser el brillo del Sol en el vidrio o en un visor
      // (supera el maximo del half-float): se deja como destello maximo; un NaN se apaga.
      uvec3 u = floatBitsToUint(c.rgb);
      bvec3 special = equal(u & uvec3(0x7f800000u), uvec3(0x7f800000u));
      bvec3 isNan = bvec3(special.x && (u.x & 0x007fffffu) != 0u, special.y && (u.y & 0x007fffffu) != 0u, special.z && (u.z & 0x007fffffu) != 0u);
      vec3 col = vec3(special.x ? 48.0 : c.r, special.y ? 48.0 : c.g, special.z ? 48.0 : c.b);
      col = vec3(isNan.x ? 0.0 : col.r, isNan.y ? 0.0 : col.g, isNan.z ? 0.0 : col.b);
      gl_FragColor = vec4(clamp(col, 0.0, 48.0), 1.0);
    }`,
};
import { GFX, onGfx, MAX_DPR, SHADOW_SIZE } from "../gfx.js";

// Dibuja las dos escenas (lejana y cercana) en el bufer del compositor, como render() sin post-proceso
class DualRenderPass extends Pass {
  constructor(ms) { super(); this.ms = ms; this.needsSwap = false; }
  render(r, writeBuffer, readBuffer) {
    const ms = this.ms;
    r.setRenderTarget(readBuffer);
    r.clear();
    r.render(ms.skyScene, ms.farCamera);
    r.clearDepth();
    r.render(ms.scene, ms.camera);
  }
}

// Ajustes de aspecto (un solo sitio para retocar la luz y la profundidad de toda la escena)
export const LOOK = {
  fogDensity: 0.000035,  // 1/m: bruma de polvo (~29 km de alcance). La misma para terreno, rocas, estructuras y relieve lejano
  dustScaleH: 11100,     // m: altura de escala de la atmosfera; el polvo se aclara con la altura
  delight: 0.85,         // cuanta luz "horneada" de la ortoimagen HiRISE se quita (0 = nada)
  flatten: 0.35,         // cuanto se iguala la exposicion entre zonas claras y oscuras del mapa
  aoFloor: 0.6,          // oscuridad maxima de las hondonadas (antes 0,42)
  fill: 0.16,            // luz de relleno del cielo polvoriento: ninguna ladera queda en negro
};

// Los materiales de three.js (rocas, estructuras, astronauta, vehiculos) usan la misma ley de bruma que el
// terreno: 1 - exp(-densidad * distancia). La de FogExp2 es cuadratica y daria otra sensacion de profundidad.
THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace(
  "float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );",
  "float fogFactor = 1.0 - exp( - fogDensity * vFogDepth );");

// Colores de Marte (sRGB) para la rampa de albedo: sombra -> polvo -> roca clara
const COL_LO = "#1f0f09", COL_MID = "#8a5536", COL_HI = "#dcb48f";
const HORIZON_DAY = new THREE.Color("#d2a37c"), ZENITH_DAY = new THREE.Color("#8f6a55");
const STORM_TINT = new THREE.Color("#8a3b1c");

// ---- ruido repetible para la textura de detalle --------------------------------------
function tileNoise(size, cells, seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(size * size);
  const k = cells / size;
  for (let y = 0; y < size; y++) {
    const fy = y * k, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < size; x++) {
      const fx = x * k, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
      const a = g[(y0 % cells) * cells + (x0 % cells)], b = g[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = g[((y0 + 1) % cells) * cells + (x0 % cells)], d = g[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
  }
  return out;
}

// R = altura (grava/arena), G/B = derivadas (relieve fino), A = segundo ruido independiente
function detailTexture() {
  const S = 512;
  const h = new Float32Array(S * S), h2 = new Float32Array(S * S);
  [[8, 0.45, 11], [16, 0.26, 23], [32, 0.15, 37], [64, 0.09, 51], [128, 0.05, 67]].forEach(([c, w, seed]) => {
    const n = tileNoise(S, c, seed), m = tileNoise(S, c, seed + 1000);
    for (let i = 0; i < h.length; i++) { h[i] += n[i] * w; h2[i] += m[i] * w; }
  });
  // granos: picos dispersos
  const grain = tileNoise(S, 256, 77);
  for (let i = 0; i < h.length; i++) h[i] = Math.min(1, h[i] * 0.85 + Math.max(0, grain[i] - 0.72) * 1.1);
  const data = new Uint8Array(S * S * 4);
  const at = (x, y) => h[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    data[i] = Math.round(255 * Math.min(1, Math.max(0, h[y * S + x])));
    data[i + 1] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + (at(x + 1, y) - at(x - 1, y)) * 4.4)));
    data[i + 2] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + (at(x, y + 1) - at(x, y - 1)) * 4.4)));
    data[i + 3] = Math.round(255 * Math.min(1, Math.max(0, h2[y * S + x])));
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// Textura "micro" para el suelo cercano (1024 px, repetible): regolito visto de cerca.
//   R = altura: arena con grano fino (0..0,38) y piedras sueltas con forma de casquete (0,42..1)
//   G/B = derivadas de la altura (relieve: las piedras se iluminan por un lado y se sombrean por el otro)
//   A = cavidad: > 0,5 en lo que sobresale, < 0,5 en los huecos y al pie de las piedras (sombra de contacto)
// El sombreador la usa a dos escalas: gravilla (2,4 m por repeticion) y guijarros y cantos (9,3 m, girada).
function microTexture() {
  const S = 1024;
  const h = new Float32Array(S * S);
  // arena: ondulacion suave + grano cada vez mas fino
  [[12, 0.11, 5], [32, 0.08, 9], [96, 0.07, 13], [256, 0.06, 17], [512, 0.06, 29]].forEach(([c, w, seed]) => {
    const n = tileNoise(S, c, seed);
    for (let i = 0; i < h.length; i++) h[i] += n[i] * w;
  });
  // piedras: elipses con perfil de casquete, muchas pequenas y pocas grandes (reparto de tamanos de un regolito)
  let sd = 90210;
  const rnd = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
  const rough = tileNoise(S, 384, 61);
  for (let k = 0; k < 520; k++) {
    const cx = rnd() * S, cy = rnd() * S, r = 3 + Math.pow(rnd(), 3.3) * 24;
    const ax = 0.65 + rnd() * 0.7, ang = rnd() * Math.PI, ca = Math.cos(ang), sa = Math.sin(ang);
    const peak = 0.35 + 0.65 * rnd(), flat = 0.18 + rnd() * 0.3;          // lados empinados y cima casi plana
    // contorno irregular (anguloso) y cima inclinada: asi cada piedra tiene caras que miran a sitios distintos
    const p3 = rnd() * 6.28, p5 = rnd() * 6.28, a3 = 0.1 + rnd() * 0.2, a5 = 0.05 + rnd() * 0.14;
    const tx = (rnd() - 0.5) * 0.5, ty = (rnd() - 0.5) * 0.5;
    const R = Math.ceil(r * 1.8);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const u = (dx * ca + dy * sa) / (r * ax), v = (-dx * sa + dy * ca) / (r / ax);
      const th = Math.atan2(v, u), edge = 1 + a3 * Math.sin(3 * th + p3) + a5 * Math.sin(5 * th + p5);
      const d2 = (u * u + v * v) / (edge * edge);
      if (d2 >= 1) continue;
      const i = (((Math.round(cy) + dy) % S + S) % S) * S + (((Math.round(cx) + dx) % S + S) % S);
      const cap = Math.pow(1 - d2, flat);
      const val = 0.42 + 0.58 * peak * cap * (1 + tx * u + ty * v) + (rough[i] - 0.5) * 0.08 * cap;
      if (val > h[i]) h[i] = val;
    }
  }
  // cavidad: altura frente a la media de alrededor (desenfoque de caja separable, radio 6)
  const blur = new Float32Array(S * S), tmp = new Float32Array(S * S), Rb = 6, nb = 2 * Rb + 1;
  for (let y = 0; y < S; y++) { let acc = 0; for (let x = -Rb; x <= Rb; x++) acc += h[y * S + ((x + S) % S)]; for (let x = 0; x < S; x++) { tmp[y * S + x] = acc / nb; acc += h[y * S + ((x + Rb + 1) % S)] - h[y * S + ((x - Rb + S) % S)]; } }
  for (let x = 0; x < S; x++) { let acc = 0; for (let y = -Rb; y <= Rb; y++) acc += tmp[((y + S) % S) * S + x]; for (let y = 0; y < S; y++) { blur[y * S + x] = acc / nb; acc += tmp[((y + Rb + 1) % S) * S + x] - tmp[((y - Rb + S) % S) * S + x]; } }
  const data = new Uint8Array(S * S * 4);
  const at = (x, y) => h[((y + S) % S) * S + ((x + S) % S)];
  const c8 = (v) => Math.round(255 * Math.min(1, Math.max(0, v)));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, j = i * 4;
    data[j] = c8(h[i]);
    data[j + 1] = c8(0.5 + (at(x + 1, y) - at(x - 1, y)) * 5.0);
    data[j + 2] = c8(0.5 + (at(x, y + 1) - at(x, y - 1)) * 5.0);
    data[j + 3] = c8(0.5 + (h[i] - blur[i]) * 3.2);
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 16;
  tex.needsUpdate = true;
  return tex;
}

// Luz "horneada" en la ortoimagen. Las fotos de HiRISE se tomaron con el sol en una posicion concreta, asi que
// las laderas que lo miraban salen mas claras. Se ajusta por minimos cuadrados  gris = c0 + cx*nx + cz*nz
// (nx, nz: normal del terreno hacia el Este y el Sur) sobre una copia reducida de las dos texturas; el sombreador
// resta esa parte y deja que ilumine solo el sol del juego. Devuelve null si no se puede leer la imagen.
function fitBakedLight(albedoImg, normalImg, S = 256) {
  try {
    const read = (img) => {
      const c = document.createElement("canvas");
      c.width = c.height = S;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, S, S);
      return ctx.getImageData(0, 0, S, S).data;
    };
    const A = read(albedoImg), N = read(normalImg), n = S * S;
    let sg = 0, sx = 0, sz = 0;
    for (let i = 0; i < n; i++) { sg += A[i * 4]; sx += N[i * 4]; sz += N[i * 4 + 2]; }
    const mg = sg / n / 255, mx = (sx / n / 255) * 2 - 1, mz = (sz / n / 255) * 2 - 1;
    // ecuaciones normales 2x2 con las variables centradas
    let sxx = 0, szz = 0, sxz = 0, sxg = 0, szg = 0;
    for (let i = 0; i < n; i++) {
      const g = A[i * 4] / 255 - mg, x = (N[i * 4] / 255) * 2 - 1 - mx, z = (N[i * 4 + 2] / 255) * 2 - 1 - mz;
      sxx += x * x; szz += z * z; sxz += x * z; sxg += x * g; szg += z * g;
    }
    const det = sxx * szz - sxz * sxz;
    if (!(Math.abs(det) > 1e-9)) return null;
    const lim = (v) => Math.max(-1.5, Math.min(1.5, v));
    const cx = lim((sxg * szz - szg * sxz) / det), cz = lim((szg * sxx - sxg * sxz) / det);
    if (![cx, cz, mg, mx, mz].every(Number.isFinite)) return null;
    return { cx, cz, mx, mz, mean: mg };
  } catch (e) {
    console.warn("No se pudo ajustar la luz de la ortoimagen:", e.message);
    return null;
  }
}

const TERRAIN_VS = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    // misma expresion que usa three.js en sus materiales: asi el parche de sombras (ShadowMaterial)
    // obtiene exactamente la misma profundidad que el terreno y no queda oculto por redondeo
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Luz y bruma comunes al terreno cercano, al faldon y al relieve lejano: asi todo el mapa se ilumina igual
// y la profundidad se lee igual a 100 m que a 100 km.
const SHADE_GLSL = /* glsl */ `
  uniform vec3 uSunDir, uSunColor, uAmbient, uFogColor, uColLo, uColMid, uColHi;
  uniform float uFogDensity, uDustH, uStorm, uFill;
  uniform vec3 uLampPos, uLampDir, uHelmPos, uHelmDir;
  uniform float uLampK, uHelmK;

  // Faros del rover y linterna del casco: cono con caida por distancia (solo de noche o con tormenta)
  vec3 lamps(vec3 base, vec3 N, vec3 p) {
    vec3 acc = vec3(0.0);
    if (uLampK > 0.01) {
      vec3 L = uLampPos - p; float d = length(L); vec3 l = L / d;
      float cone = smoothstep(0.80, 0.95, dot(-l, uLampDir));
      float att = 9.0 / (1.0 + 0.035 * d * d) * smoothstep(75.0, 20.0, d);
      float glow = 0.5 * smoothstep(8.0, 0.0, d);
      acc += vec3(0.92, 0.96, 1.08) * uLampK * (cone * att * max(dot(N, l), 0.0) + glow * max(N.y, 0.0));
    }
    if (uHelmK > 0.01) {
      vec3 L = uHelmPos - p; float d = length(L); vec3 l = L / d;
      float cone = smoothstep(0.78, 0.94, dot(-l, uHelmDir));
      float att = 3.2 / (1.0 + 0.06 * d * d) * smoothstep(32.0, 8.0, d);
      acc += vec3(1.0, 0.97, 0.9) * uHelmK * (cone * att * max(dot(N, l), 0.0) + 0.25 * smoothstep(4.0, 0.0, d));
    }
    return base * acc;
  }

  vec3 ramp(float g) {
    return g < 0.5 ? mix(uColLo, uColMid, g * 2.0) : mix(uColMid, uColHi, (g - 0.5) * 2.0);
  }

  // Sol directo + cielo. En Marte el polvo difunde mucha luz: las sombras nunca son negras.
  //   sky  luz del cielo (mas arriba) y rebote calido del suelo (mas abajo)
  //   fill relleno alrededor del sol, que envuelve las laderas que no lo miran de frente
  vec3 marsLight(vec3 base, vec3 N, float ao) {
    float ndl = dot(N, uSunDir);
    float wrap = ndl * 0.5 + 0.5;
    vec3 sky = uAmbient * mix(vec3(0.78, 0.66, 0.58), vec3(1.0), N.y * 0.5 + 0.5);
    vec3 fill = uSunColor * uFill * wrap * wrap;
    vec3 direct = uSunColor * max(ndl, 0.0) * (1.0 - 0.5 * uFill);
    return base * ((sky + fill) * ao + direct * mix(1.0, ao, 0.4));
  }

  // Muestra la textura de detalle dos veces, la segunda girada y a otra escala, y las promedia: a gran
  // escala (cientos de metros o mas) asi no se nota que la textura se repite en cuadricula.
  vec4 untile(sampler2D t, vec2 p) {
    vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p * 0.773 + vec2(0.37, 0.61);
    return (texture2D(t, p) + texture2D(t, q) - 1.0) * 0.72 + 0.5;
  }

  // Bruma de polvo: exponencial con la distancia y mas tenue con la altura (atmosfera con altura de escala uDustH).
  // dy = altura del punto respecto a la camara.
  float marsFog(float dist, float dy) {
    float k = dy / uDustH;
    float thin = abs(k) < 0.001 ? 1.0 : (1.0 - exp(-k)) / k;
    // tormenta de polvo: la opacidad crece mucho mas que linealmente (tau ~0,5 normal -> 3-5 en una tormenta)
    return clamp(1.0 - exp(-dist * uFogDensity * thin * (1.0 + 5.0 * uStorm + 85.0 * uStorm * uStorm)), 0.0, 1.0);
  }
`;

const TERRAIN_FS = /* glsl */ `
  uniform sampler2D uAlbedo;     // gris HiRISE+CTX (o la ortoimagen coloreada si no hay HD)
  uniform sampler2D uNormalMap;  // normales del DEM a 3 m, espacio de mundo
  uniform sampler2D uAO;         // fraccion de cielo visible
  uniform sampler2D uOverlay;
  uniform sampler2D uDetail;
  uniform sampler2D uMicro;      // regolito de cerca: R altura, GB derivadas, A cavidad (microTexture)
  uniform float uHasHD, uOverlayOn, uUseFlat, uSize, uDelight, uFlatten, uAoFloor, uMeanG;
  uniform float uHole;           // faldon: no se dibuja dentro del recorte detallado (|x|,|z| < uHole)
  uniform vec4 uBake;            // luz horneada en la ortoimagen: (cx, cz, media nx, media nz)
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
` + SHADE_GLSL + /* glsl */ `
  void main() {
    if (uHole > 0.0 && max(abs(vPosW.x), abs(vPosW.z)) < uHole) discard;
    float dist = distance(cameraPosition, vPosW);
    float near = 1.0 - smoothstep(25.0, 320.0, dist);
    float mid = 1.0 - smoothstep(250.0, 2600.0, dist);

    vec4 d1 = texture2D(uDetail, vPosW.xz / 3.3);
    vec4 d2 = texture2D(uDetail, vPosW.xz / 27.0 + 0.37);
    vec4 d3 = untile(uDetail, vPosW.xz / 230.0 + 0.11);
    vec4 d4 = untile(uDetail, vPosW.xz / 1900.0 + 0.53);

    vec3 N = normalize(vNormalW);
    // tono generico para el terreno lejano (fuera del recorte) y para el borde del recorte
    float gFlat = 0.5 + (d3.r - 0.5) * 0.22 + (d4.a - 0.5) * 0.3;
    float g = gFlat;
    float ao = 1.0;
    if (uUseFlat < 0.5) {
      float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
      float inside = smoothstep(0.0, 0.02, edge);         // en el borde se funde con el terreno lejano
      vec3 nmRaw = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
      vec3 nm = normalize(nmRaw);
      N = normalize(mix(N, nm, uHasHD * inside));
      vec3 a = texture2D(uAlbedo, vUv).rgb;
      float gt = mix(dot(a, vec3(0.35, 0.5, 0.15)) * 1.25, a.r, uHasHD);
      // La ortoimagen trae la luz del dia en que se tomo (laderas al sol mas claras). Se resta esa
      // componente, ajustada contra el mapa de normales al cargar, para que solo ilumine el sol del juego.
      gt -= uDelight * uHasHD * (uBake.x * (nmRaw.x - uBake.z) + uBake.y * (nmRaw.z - uBake.w));
      // Exposicion por zonas: acerca el brillo medio de cada zona (~100 m) al del mapa entero
      gt += (uMeanG - textureLod(uAlbedo, vUv, 6.5).r) * uFlatten * uHasHD;
      gt = clamp(gt, 0.0, 1.0);
      float gBlur = texture2D(uAlbedo, vUv, 6.0).r;       // version desenfocada (mipmap)
      g = mix(gBlur, gt, inside);
      ao = mix(1.0, mix(uAoFloor, 1.0, smoothstep(0.6, 1.0, texture2D(uAO, vUv).r)), inside);
    } else {
      // terreno lejano: prolonga el tono del borde del recorte y lo lleva al tono generico
      vec2 uvw = vec2(vPosW.x / uSize + 0.5, 0.5 - vPosW.z / uSize);
      vec2 uvc = clamp(uvw, 0.004, 0.996);
      float outside = length((uvw - uvc) * uSize);
      g = mix(texture2D(uAlbedo, uvc, 6.0).r, gFlat, smoothstep(0.0, 2200.0, outside) * 0.85 * uHasHD + (1.0 - uHasHD));
    }
    g = clamp((g - 0.5) * 1.15 + 0.5, 0.0, 1.0);          // un poco mas de contraste

    // roca en las pendientes, arena en lo llano
    float steep = 1.0 - N.y;
    float rock = smoothstep(0.045, 0.15, steep + (d2.r - 0.5) * 0.06);
    // en las paredes la textura proyectada desde arriba se estira: ahi se mezcla una proyeccion lateral
    float wall = smoothstep(0.12, 0.4, steep);
    vec4 dv = texture2D(uDetail, vec2((vPosW.x + vPosW.z) * 0.7, vPosW.y) / 3.3);
    d1 = mix(d1, dv, wall);
    float strata = sin(vPosW.y * 1.9 + d2.a * 5.0 + d3.r * 6.0) * 0.5 + 0.5;
    strata = mix(strata, sin(vPosW.y * 7.1 + d1.a * 3.0) * 0.5 + 0.5, 0.3);
    // ondulaciones de arena: solo cerca (lejos formarian un patron de rayas)
    float close = 1.0 - smoothstep(12.0, 70.0, dist);
    float ripples = sin((vPosW.x * 0.8 + vPosW.z * 0.55) * 2.6 + d2.r * 9.0 + d3.a * 14.0) * 0.5 + 0.5;
    float gSand = g * mix(1.0, 0.86 + 0.28 * d1.r, near) * mix(1.0, 0.94 + 0.12 * ripples, close * (1.0 - rock)) * mix(1.0, 0.9 + 0.2 * d2.r, mid);
    float gRock = g * mix(1.0, 0.55 + 0.7 * smoothstep(0.25, 0.75, strata), mid * 0.9) * mix(1.0, 0.76 + 0.48 * d1.a, near);
    vec3 base = ramp(clamp(mix(gSand, gRock * 0.94, rock), 0.0, 1.0));
    base = mix(base, base * vec3(0.86, 0.78, 0.74), rock * 0.7);
    // variacion de color a gran escala: manchas de polvo claro (mas ocre) y de arena basaltica (mas gris)
    base *= mix(vec3(1.05, 1.0, 0.93), vec3(0.94, 0.98, 1.04), smoothstep(0.3, 0.7, d4.r * 0.6 + d3.a * 0.4));
    // el polvo fino se acumula en lo llano y resguardado
    base = mix(base, base * vec3(1.08, 1.03, 0.95), (1.0 - rock) * smoothstep(0.9, 0.6, ao) * 0.5);
    // guijarros oscuros sueltos, solo de cerca
    // ---- regolito de cerca (textura micro): grano de arena, gravilla y guijarros ----
    // dos escalas giradas entre si para que no se note la repeticion; las piedras aparecen en parches
    float k0 = 1.0 - smoothstep(5.0, 26.0, dist);            // gravilla: a pocos metros
    float k1 = 1.0 - smoothstep(18.0, 85.0, dist);           // guijarros y cantos: hasta media distancia
    mat2 rotM = mat2(0.8, -0.6, 0.6, 0.8);
    vec4 m0 = texture2D(uMicro, vPosW.xz / 2.4);
    vec4 m1 = texture2D(uMicro, rotM * vPosW.xz / 9.3 + 0.31);
    float patch0 = smoothstep(0.30, 0.62, d2.a + (d3.r - 0.5) * 0.5);
    float patch1 = smoothstep(0.40, 0.68, d3.a * 0.55 + d2.r * 0.45) * (1.0 - 0.5 * rock);
    float st0 = smoothstep(0.42, 0.52, m0.r) * k0 * patch0;
    float st1 = smoothstep(0.42, 0.52, m1.r) * k1 * patch1;
    // arena: grano fino y huecos mas oscuros; al pie de cada piedra queda su sombra de contacto
    base *= mix(1.0, 0.84 + 0.32 * m0.a, k0 * mix(0.4, 1.0, patch0)) * mix(1.0, 0.86 + 0.28 * m1.a, k1 * mix(0.4, 1.0, patch1));
    // piedras: basalto mas oscuro y gris que el polvo; el polvo claro se queda en las cimas
    vec3 grayB = vec3(dot(base, vec3(0.3, 0.5, 0.2)));
    vec3 stone0 = mix(grayB * vec3(0.72, 0.66, 0.64), base, 0.15 + 0.3 * smoothstep(0.6, 1.0, m0.r));
    vec3 stone1 = mix(grayB * vec3(0.66, 0.61, 0.6), base, 0.12 + 0.3 * smoothstep(0.6, 1.0, m1.r));
    base = mix(base, stone0, st0);
    base = mix(base, stone1, st1);

    // relieve fino
    vec2 bump = (d1.gb - 0.5) * 1.7 * near + (d2.gb - 0.5) * 1.0 * mid;
    bump += vec2(0.8, 0.55) * cos((vPosW.x * 0.8 + vPosW.z * 0.55) * 2.6 + d2.r * 9.0 + d3.a * 14.0) * 0.1 * close * (1.0 - rock);
    N = normalize(N + vec3(bump.x, 0.0, bump.y) * mix(0.5, 1.25, rock));
    // relieve del regolito de cerca (normal = -gradiente de la altura; la capa girada se devuelve al mundo)
    vec2 g0 = (m0.gb - 0.5) * k0 * mix(0.45, 1.0, patch0);
    vec2 g1 = ((m1.gb - 0.5) * rotM) * k1 * mix(0.35, 1.0, patch1);
    N = normalize(N - vec3(g0.x + g1.x, 0.0, g0.y + g1.y) * 2.6);
    // la luz del cielo de Marte es muy difusa y aplana el relieve fino: se refuerza la cara que mira al Sol
    // y se oscurece la contraria, para que las piedras se lean como bultos y no como hoyos
    float relief = dot(-(g0 + g1), normalize(uSunDir.xz + 1e-4)) * clamp(uSunColor.g, 0.0, 1.0);
    base *= clamp(1.0 + relief * 2.4, 0.5, 1.6);
    // los estratos forman pequenos escalones: oscurecen la cara inferior de cada capa
    float ledge = smoothstep(0.55, 0.75, strata) - smoothstep(0.75, 0.95, strata);
    base *= 1.0 - 0.22 * ledge * rock * mid;

    vec3 col = marsLight(base, N, ao) + lamps(base, N, vPosW);

    vec4 ov = texture2D(uOverlay, vUv);
    // la capa de datos se ve entera de cerca y se desvanece a lo lejos (en las laderas lejanas se estiraba en manchas)
    col = mix(col, ov.rgb, ov.a * uOverlayOn * 0.85 * (1.0 - 0.85 * smoothstep(400.0, 2400.0, dist)));

    col = mix(col, uFogColor, marsFog(dist, vPosW.y - cameraPosition.y));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const FAR_VS = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vPosW = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FAR_FS = /* glsl */ `
  uniform sampler2D uDetail;
  varying vec3 vNormalW;
  varying vec3 vPosW;
` + SHADE_GLSL + /* glsl */ `
  void main() {
    float dist = distance(cameraPosition, vPosW);
    vec4 d3 = untile(uDetail, vPosW.xz / 230.0 + 0.11);
    vec4 d4 = untile(uDetail, vPosW.xz / 1900.0 + 0.53);
    vec4 d5 = untile(uDetail, vPosW.xz / 17000.0 + 0.29);
    // a mas de unos kilometros el grano de 230 m ya no se distingue: se apaga para que no haga moare
    d3 = mix(d3, vec4(0.5), smoothstep(6000.0, 25000.0, dist));
    vec3 N = normalize(vNormalW);
    // mismo tono generico que el faldon (asi no hay costura) con manchas grandes de albedo
    float g = 0.5 + (d3.r - 0.5) * 0.22 + (d4.a - 0.5) * 0.3 + (d5.r - 0.5) * 0.18;
    g = clamp((g - 0.5) * 1.15 + 0.5, 0.0, 1.0);
    float steep = 1.0 - N.y;
    float rock = smoothstep(0.02, 0.1, steep + (d4.r - 0.5) * 0.03);
    vec3 base = ramp(clamp(mix(g, g * 0.8, rock), 0.0, 1.0));
    base = mix(base, base * vec3(0.86, 0.78, 0.74), rock * 0.7);
    base *= mix(vec3(1.05, 1.0, 0.93), vec3(0.94, 0.98, 1.04), smoothstep(0.3, 0.7, d4.r * 0.6 + d3.a * 0.4));
    // la malla MOLA mide ~925 m por celda: un poco de relieve falso evita que las laderas queden lisas
    N = normalize(N + vec3(d4.g - 0.5, 0.0, d4.b - 0.5) * 0.35 + vec3(d5.g - 0.5, 0.0, d5.b - 0.5) * 0.25);
    vec3 col = marsLight(base, N, 1.0);
    col = mix(col, uFogColor, marsFog(dist, vPosW.y - cameraPosition.y));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const SKY_VS = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;
const SKY_FS = /* glsl */ `
  uniform vec3 uSunDir, uHorizon, uZenith;
  uniform float uStorm, uTime, uDay, uLow, uSunRad, uAurora;
  uniform vec4 uPhobos, uDeimos;   // xyz = direccion, w = radio angular (rad)
  uniform vec2 uMoonLit;           // fraccion iluminada de cada luna (0 en eclipse)
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.07 + 13.7; a *= 0.5; }
    return s / 0.9375;
  }
  // angulo (rad) entre la direccion de vista y otra direccion; estable para angulos pequenos
  float angTo(vec3 d, vec3 o) { return sqrt(max(0.0, 2.0 * (1.0 - dot(d, o)))); }

  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    float s = max(dot(d, uSunDir), 0.0);
    float ang = angTo(d, uSunDir);
    float calm = 1.0 - 0.7 * uStorm;

    // degradado: polvo claro en el horizonte, mas oscuro y rojizo hacia el cenit
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.42));
    col = mix(col, uHorizon * vec3(1.1, 1.06, 1.0), exp(-h * 11.0) * 0.55);
    // el polvo dispersa la luz hacia delante: el cielo aclara alrededor del sol
    col += uHorizon * (0.2 * pow(s, 4.0) + 0.08 * pow(s, 1.5)) * calm;

    // estrellas (solo con el sol muy bajo)
    float night = pow(1.0 - uDay, 2.0);
    if (night > 0.01) {
      vec3 g = d * 170.0, id = floor(g), f = fract(g) - 0.5;
      float r = hash3(id);
      vec3 off = (vec3(hash3(id + 1.0), hash3(id + 2.0), hash3(id + 3.0)) - 0.5) * 0.5;
      float star = step(0.986, r) * smoothstep(0.3, 0.0, length(f + off));
      col += vec3(0.9, 0.93, 1.0) * star * (0.7 + 0.3 * sin(uTime * 3.0 + r * 90.0)) * night * smoothstep(0.0, 0.15, d.y);
    }

    // lunas a su tamano real en el cielo de Marte: Fobos mide ~0,2 grados (un tercio de nuestra Luna)
    // y Deimos ~2 minutos de arco, apenas un punto brillante
    // (posicion, tamano aparente, fase y eclipses: engine/moons.js)
    float moonLit = 0.5 + 0.5 * uDay;
    float pr = max(uPhobos.w, 0.0009);                      // nunca menos de ~1 pixel
    float phobos = smoothstep(pr * 1.2, pr * 0.8, angTo(d, uPhobos.xyz)) * smoothstep(-0.02, 0.01, uPhobos.y);
    float crater = noise(d.xz * 2600.0);
    float pLit = 0.05 + 0.95 * uMoonLit.x;                  // en eclipse queda apenas la luz que refleja Marte
    col = mix(col, vec3(0.9, 0.84, 0.77) * moonLit * pLit * (0.82 + 0.3 * crater) + col * 0.22, phobos * 0.7);
    float deimos = smoothstep(0.0009, 0.0003, angTo(d, uDeimos.xyz)) * smoothstep(-0.02, 0.01, uDeimos.y);
    col = mix(col, vec3(0.98, 0.95, 0.9) * (0.6 + 0.6 * moonLit) * (0.05 + 0.95 * uMoonLit.y) + col * 0.2, deimos * 0.8);

    // Aurora de la tormenta solar: Marte no tiene campo magnetico global, asi que no forma un ovalo polar sino un
    // resplandor verde difuso en todo el cielo (557,7 nm, oxigeno). MAVEN la vio en todo el planeta en mayo de 2024
    // y Perseverance la fotografio en luz visible. De dia el cielo la tapa casi por completo.
    if (uAurora > 0.001) {
      vec2 qa = d.xz / (0.3 + h);
      float band = fbm(vec2(qa.x * 1.4 + uTime * 0.05, qa.y * 0.5 - uTime * 0.02));
      float rays = noise(vec2(atan(d.x, d.z) * 14.0 + uTime * 0.3, uTime * 0.11));
      float glowA = (0.18 + 0.82 * smoothstep(0.38, 0.8, band)) * (0.7 + 0.3 * rays);
      glowA *= smoothstep(-0.02, 0.2, d.y) * (0.14 + 0.86 * (1.0 - uDay)) * (0.75 + 0.25 * sin(uTime * 1.7 + band * 9.0));
      col += vec3(0.22, 1.0, 0.42) * glowA * uAurora * 0.34;
      col += vec3(0.9, 0.25, 0.35) * glowA * uAurora * 0.12 * smoothstep(0.45, 0.9, d.y);   // tono rojizo en lo alto
    }

    // velos de polvo altos y cirros de hielo de agua (como los que fotografia Curiosity)
    vec2 q = d.xz / (0.22 + h);
    float tm = uTime * 0.005;
    float veil = noise(q * 1.6 + vec2(tm, 0.0)) * 0.6 + noise(q * 3.7) * 0.4;
    col *= 1.0 + (veil - 0.5) * 0.14 * smoothstep(0.0, 0.4, d.y);
    float c1 = fbm(q * 1.1 + vec2(tm, 0.0));
    float c2 = fbm(q * vec2(0.7, 3.2) + vec2(c1 * 1.8 + tm * 1.5, 2.0));
    float cloud = smoothstep(0.5, 0.8, c2) * smoothstep(0.32, 0.62, c1) * smoothstep(0.03, 0.25, d.y);
    vec3 cloudCol = mix(uHorizon * 1.25, vec3(1.0, 0.93, 0.86) * (0.35 + 0.75 * uDay), 0.55);
    cloudCol += vec3(0.5, 0.6, 0.8) * pow(s, 6.0) * 0.35;
    col = mix(col, cloudCol, cloud * 0.42 * calm);

    // sol a su tamano real: desde Marte mide 0,35 grados (en la Tierra 0,53), con aureola azulada al atardecer
    vec3 glow = vec3(0.5, 0.62, 0.85) * (exp(-ang * 14.0) * 0.5 + exp(-ang * 60.0) * 0.9);
    col += glow * (0.6 + 0.9 * uLow) * calm;
    col += mix(vec3(1.0, 0.97, 0.92), vec3(0.85, 0.92, 1.0), uLow) * smoothstep(uSunRad * 1.14, uSunRad * 0.88, ang) * 12.0;
    // (el borde del crater Gale y el monte Sharp ya no se pintan aqui: son relieve 3D real, ver _buildFarTerrain)

    col *= 1.0 - 0.35 * uStorm;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class MarsScene {
  constructor(canvas, world, data) {
    this.world = world;
    this.data = data;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.3, 30000);
    // Escena lejana: cielo, planetas y el crater Gale entero (relieve MOLA real, hasta ~240 km). Se dibuja antes,
    // con su propia camara (misma vista, otro rango de profundidad), y luego se borra la profundidad para dibujar
    // encima la escena cercana. Un solo rango de 0,3 m a 480 km no tendria precision para las dos cosas.
    this.skyScene = new THREE.Scene();
    this.farCamera = new THREE.PerspectiveCamera(58, 1, 800, 480000);
    this.skyRadius = 400000;            // distancia a la que se colocan el cielo y los planetas
    this.renderer.autoClear = false;
    this.sunDir = new THREE.Vector3(0.4, 0.8, 0.2).normalize();
    this.fogColor = HORIZON_DAY.clone();
    // bruma para los materiales de three.js: misma densidad y color que el terreno (ver LOOK y fog_fragment arriba)
    this.scene.fog = new THREE.FogExp2(0xffffff, LOOK.fogDensity);
    this.scene.fog.color = this.fogColor;
    this.storm = 0;
    this.textures = {};
    this.overlays = {};
    this.beacons = [];
    this.animated = [];
    this.colliders = new Colliders();   // obstaculos: las estructuras se registran en props.js, las rocas aqui
    this.dynamics = new Dynamics(this.colliders, (x, z) => this.heightAt(x, z), world.half);   // cajas, bidones y rocas sueltas
    this.structures = [];               // {group, x, z}: se ocultan de lejos para no gastar dibujado
    this._buildSky();
    this._buildDust();
    this._buildLights();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  async init(onProgress = () => {}) {
    const loader = new THREE.TextureLoader();
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const load = (p, srgb = true) => new Promise((res, rej) => loader.load(assetUrl(p), (t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = maxAniso;
      res(t);
    }, undefined, rej));
    const names = ["slope", "radiation", "thermal", "spectral"];
    let done = 0;
    const tick = (p) => p.then((v) => { onProgress(0.6 * (++done / 7)); return v; });
    const hd = Promise.all([tick(load("textures/albedo_hd.jpg", false)), tick(load("textures/normal_hd.jpg", false)), tick(load("textures/ao.png", false))])
      .catch(() => null);
    // relieve real del crater (MOLA) para el terreno lejano; si falta, queda el faldon generico de antes
    const yRef = this.data.layers.layers.dem.y_ref_m;
    const molaP = loadMolaGale(assetUrl, this.data.region, yRef).catch((e) => { console.warn("Sin relieve lejano MOLA:", e.message); return null; });
    const [ovs, hdTex, mola] = await Promise.all([Promise.all(names.map((k) => tick(load(`layers/${k}_overlay.png`)))), hd, molaP]);
    this.mola = mola;
    names.forEach((k, i) => { this.overlays[k] = ovs[i]; });
    const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
    const flatN = new THREE.DataTexture(new Uint8Array([128, 255, 128, 255]), 1, 1); flatN.needsUpdate = true;
    if (hdTex) {
      [this.textures.albedo, this.textures.normal, this.textures.ao] = hdTex;
      this.hasHD = 1;
    } else {
      this.textures.albedo = await load("layers/optical.png", false);
      this.textures.normal = flatN;
      this.textures.ao = white;
      this.hasHD = 0;
    }
    this.bake = this.hasHD ? fitBakedLight(this.textures.albedo.image, this.textures.normal.image) : null;
    this.textures.detail = detailTexture();
    this.textures.micro = microTexture();
    this.textures.empty = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    this.textures.empty.needsUpdate = true;
    onProgress(0.65);
    this._buildTerrain();
    onProgress(0.85);
    this._buildApron();
    this._buildFarTerrain();
    this._buildShadowCatcher();
    this._buildRocks();
    this._buildRoute();
    onProgress(1);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.composer) { const sz = this.renderer.getDrawingBufferSize(new THREE.Vector2()); this.composer.setSize(sz.x, sz.y); }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.farCamera.aspect = w / h;
    this.farCamera.fov = this.camera.fov;
    this.farCamera.updateProjectionMatrix();
    // tamano en pixeles de 1 m a 1 m de distancia (para las motas de polvo)
    const hpx = h * this.renderer.getPixelRatio();
    this.dustMat.uniforms.uScale.value = hpx / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
  }

  // ---- cielo, sol y luces -------------------------------------------------------------
  _buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false,
      uniforms: { uSunDir: { value: this.sunDir }, uHorizon: { value: HORIZON_DAY.clone() }, uZenith: { value: ZENITH_DAY.clone() }, uStorm: { value: 0 }, uTime: { value: 0 }, uDay: { value: 1 }, uLow: { value: 0 },
        uSunRad: { value: sunAngularRadius().radius }, uAurora: { value: 0 },
        uPhobos: { value: new THREE.Vector4(0, -1, 0, 0.0017) }, uDeimos: { value: new THREE.Vector4(0, -1, 0, 0.0003) }, uMoonLit: { value: new THREE.Vector2(1, 1) } },
    });
    this.moons = [];                    // estado de Fobos y Deimos (para las etiquetas del cielo)
    const sky = new THREE.Mesh(new THREE.SphereGeometry(this.skyRadius * 1.1, 32, 16), this.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.sky = sky;                     // sigue a la camara: el sol y las lunas quedan en su direccion exacta
    this.skyScene.add(sky);
  }

  // Polvo en suspension: motas que el viento arrastra alrededor de la camara
  _buildDust() {
    const N = 900, BOX = 70;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    let s = 9173;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < N; i++) { pos[i * 3] = rnd() * BOX; pos[i * 3 + 1] = rnd() * BOX; pos[i * 3 + 2] = rnd() * BOX; seed[i] = rnd(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uBox: { value: BOX }, uScale: { value: 900 }, uStorm: { value: 0 }, uColor: { value: this.fogColor } },
      vertexShader: /* glsl */ `
        uniform float uTime, uBox, uScale, uStorm;
        attribute float aSeed;
        varying float vA;
        void main() {
          vec3 p = position + vec3(2.2, 0.12, 0.9) * uTime * (0.5 + aSeed) * (1.0 + 3.0 * uStorm);
          p.y += sin(uTime * 0.7 + aSeed * 40.0) * 0.6;
          p = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;   // la caja sigue a la camara
          vec4 mv = viewMatrix * vec4(p + cameraPosition, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = max(-mv.z, 0.5);
          gl_PointSize = max(1.5, uScale * (0.02 + 0.035 * aSeed) / dist);
          vA = smoothstep(uBox * 0.5, uBox * 0.3, length(p)) * smoothstep(0.8, 4.0, dist) * (0.35 + 0.65 * aSeed);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uStorm;
        varying float vA;
        void main() {
          float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5)) * vA * (0.4 + 0.4 * uStorm);
          gl_FragColor = vec4(uColor * 1.2, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 4;
    this.scene.add(this.dust);
  }

  _buildLights() {
    // luces para modelos y rocas (el terreno usa su propio shader con los mismos colores)
    this.hemi = new THREE.HemisphereLight("#e9c6a4", "#6a4230", 1.0);
    this.sun = new THREE.DirectionalLight("#fff0dc", 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
    const c = this.sun.shadow.camera;
    // la luz esta a 200 m del jugador hacia el sol: mas alla de ~60 m por detras nada proyecta sombra en la zona visible
    c.left = -46; c.right = 46; c.top = 46; c.bottom = -46; c.near = 1; c.far = 260;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.focus = new THREE.Vector3();
    this._buildEnv();
    onGfx(() => { this._applyEnv(); if (!GFX.bloom && this.composer) { this.composer.dispose(); this.composer = null; } });
  }

  // Mapa de entorno: un cielo de Marte simplificado (cenit caramelo, horizonte claro, suelo oxido) filtrado con
  // PMREM. Da reflejos creibles al metal, al vidrio de las cupulas y a los visores. Se calcula una vez.
  _buildEnv() {
    try {
      const sc = new THREE.Scene();
      const geo = new THREE.SphereGeometry(10, 32, 16);
      const col = [], p = geo.attributes.position;
      const zen = new THREE.Color("#b88a64"), hor = new THREE.Color("#e8c3a0"), gnd = new THREE.Color("#5a3424"), c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i) / 10;
        if (y >= 0) c.copy(hor).lerp(zen, Math.pow(y, 0.6)); else c.copy(hor).lerp(gnd, Math.min(1, -y * 4));
        col.push(c.r, c.g, c.b);
      }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      sc.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
      // "sol" difuso para que haya un brillo especular
      const sun = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.6, 5) }));
      sun.position.set(4, 7, -5); sc.add(sun);
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.envTex = pm.fromScene(sc, 0.04).texture;
      pm.dispose(); geo.dispose();
    } catch (e) { console.warn("Sin mapa de entorno", e); this.envTex = null; }
    this._applyEnv();
  }
  _applyEnv() { this.scene.environment = GFX.env && this.envTex ? this.envTex : null; }

  // Post-proceso con resplandor (UnrealBloom). Si algo falla, se vuelve al render directo.
  _initPost() {
    try {
      const r = this.renderer, size = r.getDrawingBufferSize(new THREE.Vector2());
      // con pantallas de alta densidad 2x MSAA basta (los pixeles ya son pequenos) y ahorra memoria y ancho de banda
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: r.getPixelRatio() >= 1.5 ? 2 : 4 });
      const comp = new EffectComposer(r, rt);
      comp.setPixelRatio(1);
      comp.setSize(size.x, size.y);
      comp.addPass(new DualRenderPass(this));
      comp.addPass(new ShaderPass(SANITIZE));
      // umbral alto: solo brillan las luces y el Sol, no el cielo ni el suelo iluminados (antes velaba la imagen)
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.2, 0.3, 1.25);
      comp.addPass(this.bloom);
      comp.addPass(new OutputPass());
      this.composer = comp;
    } catch (e) { console.warn("Sin post-proceso", e); GFX.bloom = false; this.composer = null; }
  }

  setTimeOfDay(hour) {
    // lat -4,8: el sol sale por el este, pasa alto por el norte y se pone al oeste
    const u = (hour - 6) / 12;
    const uc = Math.min(Math.max(u, 0), 1);
    const el = Math.sin(Math.PI * uc) * 1.25 + (u < 0 || u > 1 ? -0.2 : 0);
    const az = Math.PI / 2 - Math.PI * uc;
    const y = Math.sin(el), c = Math.cos(el);
    this.sunDir.set(Math.sin(az) * c, Math.max(y, 0.04), -Math.cos(az) * c).normalize();
    const day = Math.min(1, Math.max(0, y * 2.5));
    const low = 1 - Math.min(1, Math.max(0, y * 1.6));   // sol bajo: luz mas calida
    const st = this.storm;
    if (this.terrainMat) {
      const k = 1 - 0.7 * st;
      this.terrainMat.uniforms.uSunColor.value.setRGB(1.3 * day * k, (1.2 - 0.22 * low) * day * k, (1.08 - 0.4 * low) * day * k);
      this.terrainMat.uniforms.uAmbient.value.setRGB(0.2 + 0.2 * day, 0.17 + 0.16 * day, 0.15 + 0.13 * day);
    }
    const hz = this.skyMat.uniforms.uHorizon.value.copy(HORIZON_DAY).multiplyScalar(0.3 + 0.7 * day).lerp(STORM_TINT, 0.55 * st);
    this.skyMat.uniforms.uZenith.value.copy(ZENITH_DAY).multiplyScalar(0.22 + 0.78 * day).lerp(STORM_TINT, 0.4 * st);
    this.fogColor.copy(hz);
    this.skyMat.uniforms.uDay.value = day;
    this.skyMat.uniforms.uLow.value = low;
    // lunas: orbita real segun la hora del juego
    const U = this.skyMat.uniforms, mo = moonsAt(hour, this.data.region.center.lat, this.moons);
    U.uPhobos.value.set(mo[0].dir[0], mo[0].dir[1], mo[0].dir[2], mo[0].radius);
    U.uDeimos.value.set(mo[1].dir[0], mo[1].dir[1], mo[1].dir[2], mo[1].radius);
    U.uMoonLit.value.set(mo[0].lit, mo[1].lit);
    this.sun.intensity = 2.6 * day * (1 - 0.75 * st);
    this.sun.color.setRGB(1, 0.95 - 0.15 * low, 0.86 - 0.3 * low);
    // con mapa de entorno, la luz del cielo llega en parte por el (reflejos); el hemisferio baja un poco
    const envOn = !!this.scene.environment;
    this.hemi.intensity = (0.55 + 0.6 * day) * (envOn ? 0.8 : 1);
    this.scene.environmentIntensity = (0.12 + 0.5 * day) * (1 - 0.5 * st);
  }

  // Tormenta de particulas solares (0..1): aurora en el cielo. No es polvo: no cambia la bruma.
  setAurora(v) { this.skyMat.uniforms.uAurora.value = v; }

  // Luces que iluminan el terreno (sus shaders no usan las luces de Three.js)
  setLamps(lamp, helm) {
    const u = this.shade || this._shadeUniforms();
    if (lamp) { u.uLampPos.value.copy(lamp.pos); u.uLampDir.value.copy(lamp.dir); u.uLampK.value = lamp.k; }
    if (helm) { u.uHelmPos.value.copy(helm.pos); u.uHelmDir.value.copy(helm.dir); u.uHelmK.value = helm.k; }
  }

  setStorm(v) {
    this.storm = v;
    this.skyMat.uniforms.uStorm.value = v;
    this.dustMat.uniforms.uStorm.value = v;
    if (this.terrainMat) this.terrainMat.uniforms.uStorm.value = v;
    if (this.apron) this.apron.material.uniforms.uStorm.value = v;
    if (this.farTerrain) this.farTerrain.material.uniforms.uStorm.value = v;
    this.scene.fog.density = LOOK.fogDensity * Math.sqrt(1 + 5 * v + 85 * v * v);
  }

  // ---- terreno --------------------------------------------------------------------------
  _terrainUniforms(flat) {
    const T = this.textures, B = this.bake;
    return {
      uAlbedo: { value: T.albedo }, uNormalMap: { value: T.normal }, uAO: { value: T.ao },
      uOverlay: { value: T.empty }, uDetail: { value: T.detail }, uMicro: { value: T.micro },
      uHasHD: { value: this.hasHD }, uSize: { value: this.world.size }, uOverlayOn: { value: 0 }, uUseFlat: { value: flat ? 1 : 0 },
      // hueco del faldon. Siempre explicito: terreno y faldon comparten programa GLSL y un uniform que un
      // material no declara conserva el ultimo valor que puso el otro (el terreno se descartaria entero)
      uHole: { value: 0 },
      uDelight: { value: LOOK.delight }, uFlatten: { value: LOOK.flatten }, uAoFloor: { value: LOOK.aoFloor },
      uBake: { value: B ? new THREE.Vector4(B.cx, B.cz, B.mx, B.mz) : new THREE.Vector4() }, uMeanG: { value: B ? B.mean : 0.5 },
      ...this._shadeUniforms(),
    };
  }

  // Luz, bruma y paleta: los comparten el terreno, el faldon y el relieve lejano (mismos objetos uniform)
  _shadeUniforms() {
    this.shade ||= {
      uSunDir: { value: this.sunDir }, uSunColor: { value: new THREE.Color(1.3, 1.2, 1.05) }, uAmbient: { value: new THREE.Color(0.4, 0.32, 0.26) },
      uFogColor: { value: this.fogColor }, uFogDensity: { value: LOOK.fogDensity }, uDustH: { value: LOOK.dustScaleH }, uFill: { value: LOOK.fill },
      uColLo: { value: new THREE.Color(COL_LO) }, uColMid: { value: new THREE.Color(COL_MID) }, uColHi: { value: new THREE.Color(COL_HI) },
      uLampPos: { value: new THREE.Vector3() }, uLampDir: { value: new THREE.Vector3(0, 0, -1) }, uLampK: { value: 0 },
      uHelmPos: { value: new THREE.Vector3() }, uHelmDir: { value: new THREE.Vector3(0, 0, -1) }, uHelmK: { value: 0 },
    };
    // uStorm es propio de cada material (setStorm los actualiza uno a uno)
    return { ...this.shade, uStorm: { value: this.storm } };
  }

  _buildTerrain() {
    const w = this.world;
    const S = 767; // 768 vertices por lado (~8 m); el relieve mas fino sale del mapa de normales
    this.seg = S;
    this.step = w.size / S;
    const geo = new THREE.PlaneGeometry(w.size, w.size, S, S);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    this.mh = new Float32Array((S + 1) * (S + 1));
    for (let i = 0; i < pos.count; i++) {
      const y = w.demHeight(pos.getX(i), pos.getZ(i));
      pos.setY(i, y);
      this.mh[i] = y;
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    this.terrainMat = new THREE.ShaderMaterial({ vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS, uniforms: this._terrainUniforms(false) });
    this.terrain = new THREE.Mesh(geo, this.terrainMat);
    this.scene.add(this.terrain);
  }

  // Altura exacta de la malla (misma triangulacion que PlaneGeometry): los pies tocan el suelo
  heightAt(x, z) {
    const S = this.seg, st = this.step, half = this.world.half;
    const u = Math.min(S - 1e-4, Math.max(0, (x + half) / st));
    const v = Math.min(S - 1e-4, Math.max(0, (z + half) / st));
    const ix = Math.floor(u), iz = Math.floor(v);
    const fx = u - ix, fz = v - iz;
    const W = S + 1, h = this.mh;
    const a = h[iz * W + ix], b = h[(iz + 1) * W + ix], c = h[(iz + 1) * W + ix + 1], d = h[iz * W + ix + 1];
    if (fx + fz <= 1) return a + (d - a) * fx + (b - a) * fz;
    return c + (b - c) * (1 - fx) + (d - c) * (1 - fz);
  }

  // Normal del terreno (para apoyar objetos e inclinar al astronauta)
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1.5;
    return out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
  }

  // Terreno lejano de baja resolucion fuera del recorte (extiende los bordes hacia el horizonte)
  _buildApron() {
    const w = this.world, R = 26000, S = 160;
    const geo = new THREE.PlaneGeometry(R, R, S, S);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const lim = w.half - 4, mola = this.mola, cell = R / S;
    // Dentro del recorte y junto a su borde el faldon debe quedar SIEMPRE bajo el terreno detallado. Con
    // celdas de ~160 m, interpolar la altura del DEM en los vertices lo hacia asomar en valles y hondonadas
    // (tapaba las ruedas del rover y los pies). Cada vertice toma el minimo del DEM en una celda a su alrededor.
    const minNear = (cx, cz) => {
      let m = Infinity;
      for (let j = -6; j <= 6; j++) for (let k = -6; k <= 6; k++) {
        const sx = Math.max(-lim, Math.min(lim, cx + (k / 6) * cell)), sz = Math.max(-lim, Math.min(lim, cz + (j / 6) * cell));
        m = Math.min(m, w.demHeight(sx, sz));
      }
      return m;
    };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const cx = Math.max(-lim, Math.min(lim, x)), cz = Math.max(-lim, Math.min(lim, z));
      const out = Math.hypot(x - cx, z - cz);
      const edge = out === 0 ? minNear(cx, cz) - 6 : w.demHeight(cx, cz) - 3;
      if (mola) {
        // del borde del recorte (DEM HiRISE + CTX) al relieve real MOLA en 2,6 km, ya con la curvatura de Marte
        const t = Math.min(1, out / 2600), k = t * t * (3 - 2 * t);
        pos.setY(i, edge + (mola.worldY(x, z) - edge) * k);
      } else {
        const trend = z > lim ? out * 0.12 : -out * 0.03; // sin MOLA: el monte sigue subiendo hacia el sur
        pos.setY(i, edge + trend - Math.sin(x * 0.0021) * Math.cos(z * 0.0017) * 40 * Math.min(1, out / 1500));
      }
    }
    geo.computeVertexNormals();
    const u = this._terrainUniforms(true);
    // dentro del recorte manda siempre el terreno detallado: el faldon (celdas de ~160 m) no puede asomar
    u.uHole.value = w.half;
    this.apron = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS, uniforms: u }));
    this.scene.add(this.apron);
  }

  // Crater Gale completo en 3D: malla del MOLA a escala 1:1 (413 x 384 km), con el borde del crater y el
  // monte Sharp reales. Va en la escena lejana; lo que cae bajo el faldon cercano no se genera.
  _buildFarTerrain() {
    if (!this.mola) return;
    const { positions, indices, radius } = this.mola.buildMesh(9000);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.5);
    const mat = new THREE.ShaderMaterial({ vertexShader: FAR_VS, fragmentShader: FAR_FS, uniforms: { uDetail: { value: this.textures.detail }, ...this._shadeUniforms() } });
    this.farTerrain = new THREE.Mesh(geo, mat);
    this.farTerrain.frustumCulled = false;
    this.skyScene.add(this.farTerrain);
  }

  setOverlay(layer) {
    const tex = layer ? this.overlays[layer] : null;
    this.terrainMat.uniforms.uOverlay.value = tex || this.textures.empty;
    this.terrainMat.uniforms.uOverlayOn.value = tex ? 1 : 0;
  }

  // ---- sombras: un parche de malla identico al terreno que solo recibe sombras ------------
  _buildShadowCatcher() {
    const C = 14; // celdas por lado (~112 m)
    this.catchN = C;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array((C + 1) * (C + 1) * 3);
    const idx = [];
    for (let iz = 0; iz < C; iz++) for (let ix = 0; ix < C; ix++) {
      const a = iz * (C + 1) + ix, b = (iz + 1) * (C + 1) + ix, c = (iz + 1) * (C + 1) + ix + 1, d = iz * (C + 1) + ix + 1;
      idx.push(a, b, d, b, c, d);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    // con normales: sin ellas el sesgo de sombra (normalBias) normaliza un vector nulo y en algunas GPU
    // el resultado es NaN, con lo que no se dibuja ninguna sombra
    geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(pos.length), 3));
    geo.setIndex(idx);
    const mat = new THREE.ShadowMaterial({ opacity: 0.5, color: "#1a0a05", fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.catcher = new THREE.Mesh(geo, mat);
    this.catcher.receiveShadow = true;
    this.catcher.frustumCulled = false;
    this.catcher.renderOrder = 2;
    this.scene.add(this.catcher);
    this.catchCell = null;
  }

  _updateShadowCatcher(px, pz) {
    const C = this.catchN, S = this.seg, W = S + 1, st = this.step, half = this.world.half;
    const cx = Math.max(0, Math.min(S - C, Math.round((px + half) / st) - C / 2));
    const cz = Math.max(0, Math.min(S - C, Math.round((pz + half) / st) - C / 2));
    const key = cx + "," + cz;
    if (key === this.catchCell) return;
    this.catchCell = key;
    const src = this.terrain.geometry.attributes.position, dst = this.catcher.geometry.attributes.position;
    const srcN = this.terrain.geometry.attributes.normal, dstN = this.catcher.geometry.attributes.normal;
    for (let iz = 0; iz <= C; iz++) for (let ix = 0; ix <= C; ix++) {
      const i = (cz + iz) * W + (cx + ix), j = iz * (C + 1) + ix;
      dst.setXYZ(j, src.getX(i), src.getY(i), src.getZ(i));
      dstN.setXYZ(j, srcN.getX(i), srcN.getY(i), srcN.getZ(i));
    }
    dst.needsUpdate = true;
    dstN.needsUpdate = true;
  }

  // Centro de interes (jugador o camara): mueve la luz de sombras, el parche y las rocas
  setFocus(x, y, z) {
    this.focus.set(x, y, z);
    const sx = Math.round(x), sz = Math.round(z); // ajuste a 1 m para que la sombra no tiemble
    this.sun.target.position.set(sx, y, sz);
    this.sun.position.set(sx, y, sz).addScaledVector(this.sunDir, 200);
    this.sun.target.updateMatrixWorld();
    this._updateShadowCatcher(x, z);
    this.updateRocks(x, z);
  }

  // ---- rocas ------------------------------------------------------------------------------
  _buildRocks() {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position;
    const h3 = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 0.72 + 0.5 * h3(Math.round(x * 50), Math.round(y * 50), Math.round(z * 50));
      p.setXYZ(i, x * k, y * k * 0.8, z * k);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, metalness: 0, flatShading: true });
    this.rockMax = 3400;
    this.rocks = new THREE.InstancedMesh(geo, mat, this.rockMax);
    this.rocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rocks.count = 0;
    this.rocks.frustumCulled = false;
    this.rocks.castShadow = true;
    this.rocks.receiveShadow = true;
    this.scene.add(this.rocks);
    this.rockCell = null;
  }

  updateRocks(px, pz) {
    const CELL = 40, RAD = 6;
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    const key = cx + "," + cz;
    if (key === this.rockCell) return;
    this.rockCell = key;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    const solid = [];
    let k = 0;
    for (let gz = cz - RAD; gz <= cz + RAD; gz++) {
      for (let gx = cx - RAD; gx <= cx + RAD; gx++) {
        let seed = ((gx * 73856093) ^ (gz * 19349663)) >>> 0;
        const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
        // mas piedras al pie de las pendientes y pocas en la arena lisa
        const ccx = (gx + 0.5) * CELL, ccz = (gz + 0.5) * CELL;
        const slope = this.world.inside(ccx, ccz, 10) ? this.world.slope(ccx, ccz) : 0;
        const count = Math.floor((3 + rnd() * 8) * (0.6 + Math.min(2.2, slope / 9)));
        for (let i = 0; i < count && k < this.rockMax; i++) {
          const x = (gx + rnd()) * CELL, z = (gz + rnd()) * CELL;
          if (!this.world.inside(x, z, 10)) continue;
          const big = rnd() < 0.07;
          const r = big ? 0.7 + rnd() * 1.3 : 0.1 + rnd() * rnd() * 0.55;
          p.set(x, this.heightAt(x, z) + r * 0.18, z);
          e.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28);
          q.setFromEuler(e);
          s.set(r * (0.8 + rnd() * 0.6), r * (0.5 + rnd() * 0.45), r * (0.8 + rnd() * 0.6));
          m.compose(p, q, s);
          this.rocks.setMatrixAt(k, m);
          // las rocas medianas y grandes son obstaculos (las bajas se pisan): radio y cima aproximados
          const rad = ((s.x + s.y + s.z) / 3) * 0.9;
          if (rad >= 0.3) solid.push({ x, z, r: rad * 0.95, top: p.y + rad * 0.8 });
          col.setHSL(0.045 + rnd() * 0.035, 0.3 + rnd() * 0.2, 0.2 + rnd() * 0.16);
          this.rocks.setColorAt(k, col);
          k++;
        }
      }
    }
    // Bloques grandes donde el DTM marca terreno rocoso (rules.json -> hazards.boulders): no se pueden pisar
    const B = this.world.rules.hazards.boulders;
    if (B && this.world.decode.rough) {
      for (let gz = cz - RAD; gz <= cz + RAD; gz++) {
        for (let gx = cx - RAD; gx <= cx + RAD; gx++) {
          let seed = ((gx * 2654435761) ^ (gz * 40503)) >>> 0;
          const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
          for (let i = 0; i < 26 && k < this.rockMax; i++) {
            const x = (gx + rnd()) * CELL, z = (gz + rnd()) * CELL;
            const u = rnd(), v = rnd(), w = rnd();
            if (!this.world.inside(x, z, 10)) continue;
            const rc = this.world.rockClass(x, z);
            // densidad: campo de bloques ~1 cada 60 m2; terreno rocoso ~1 cada 250 m2
            if (!rc || u > (rc === 2 ? 0.95 : 0.25)) continue;
            const r = rc === 2 ? 1.0 + v * v * 2.5 : 0.6 + v * 1.2;   // radio: 1-3,5 m / 0,6-1,8 m
            p.set(x, this.heightAt(x, z) + r * 0.12, z);
            e.set(w * 6.28, rnd() * 6.28, rnd() * 0.6);
            q.setFromEuler(e);
            s.set(r * (0.85 + rnd() * 0.4), r * (0.55 + rnd() * 0.35), r * (0.85 + rnd() * 0.4));
            m.compose(p, q, s);
            this.rocks.setMatrixAt(k, m);
            const rad = ((s.x + s.z) / 2) * 0.85;
            solid.push({ x, z, r: rad, top: p.y + s.y * 0.85, big: true });
            col.setHSL(0.04 + rnd() * 0.03, 0.28 + rnd() * 0.15, 0.17 + rnd() * 0.12);
            this.rocks.setColorAt(k, col);
            k++;
          }
        }
      }
    }
    this.rocks.count = k;
    this.colliders.rocks = solid;
    this.rocks.instanceMatrix.needsUpdate = true;
    if (this.rocks.instanceColor) this.rocks.instanceColor.needsUpdate = true;
  }

  // ---- balizas -------------------------------------------------------------------------------
  addBeacon(x, z, radius, tall = 380) {
    const y = this.heightAt(x, z);
    const g = new THREE.Group();
    const color = new THREE.Color("#ffffff");
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: color }, uTime: { value: 0 }, uPower: { value: 1 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ",
      fragmentShader: `uniform vec3 uColor; uniform float uTime, uPower; varying vec2 vUv;
        void main(){ float fade = pow(1.0 - vUv.y, 1.6);
          float pulse = 0.6 + 0.4 * sin(vUv.y * 70.0 - uTime * 3.5);   // anillos de luz que suben
          float a = fade * (0.22 + 0.2 * pulse) * uPower;
          gl_FragColor = vec4(uColor * a, a); }`,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, tall, 16, 1, true), beamMat);
    beam.position.set(x, y + tall / 2, z);
    g.add(beam);
    // anillo del radio de escaneo, apoyado en el terreno
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const px = x + Math.cos(a) * radius, pz = z + Math.sin(a) * radius;
      pts.push(new THREE.Vector3(px, this.heightAt(px, pz) + 0.3, pz));
    }
    // las marcas de navegacion no se atenuan con la bruma: deben verse a cualquier distancia
    const ringMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, fog: false });
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat);
    g.add(ring);
    // marcador flotante
    const gemMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, fog: false });
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(1.5, 0), gemMat);
    gem.scale.set(1, 1.7, 1);
    gem.position.set(x, y + 16, z);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.12, 8, 40), gemMat);
    halo.position.copy(gem.position);
    halo.rotation.x = Math.PI / 2;
    g.add(gem, halo);
    const b = { group: g, beamMat, ring, ringMat, gem, halo, gemMat, baseY: y + 16, color, target: false, power: 1, x, z };
    g.visible = false;
    this.beacons.push(b);
    this.scene.add(g);
    return b;
  }

  setBeacon(b, { visible, target, shelter }) {
    b.group.visible = visible;
    b.target = target;
    b.color.set(target ? "#3DDC97" : shelter ? "#2a9d6c" : "#c9c9c9");
    b.ringMat.color.copy(b.color);
    b.gemMat.color.copy(b.color);
    b.ring.visible = target || shelter;
    b.gem.visible = b.halo.visible = target;
    b.power = target ? 1.6 : shelter ? 0.35 : 0.7;
  }

  // ---- ruta sugerida ------------------------------------------------------------------------
  _buildRoute() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 2000), 3));
    geo.setAttribute("lineDistance", new THREE.BufferAttribute(new Float32Array(2000), 1));
    geo.setDrawRange(0, 0);
    this.routeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color("#3DDC97") } },
      vertexShader: "attribute float lineDistance; varying float vD; void main(){ vD = lineDistance; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ",
      fragmentShader: `uniform float uTime; uniform vec3 uColor; varying float vD;
        void main(){ float t = fract((vD - uTime * 9.0) / 11.0);     // guiones que avanzan hacia el objetivo
          if (t > 0.6) discard;
          gl_FragColor = vec4(uColor * (0.9 + 0.5 * (1.0 - t / 0.6)), 0.95); }`,
    });
    this.routeLine = new THREE.Line(geo, this.routeMat);
    this.routeLine.frustumCulled = false;
    this.routeLine.renderOrder = 3;
    this.scene.add(this.routeLine);
  }

  setRoute(points) {
    const pos = this.routeLine.geometry.attributes.position, ld = this.routeLine.geometry.attributes.lineDistance;
    const n = Math.min(points.length, 2000);
    let d = 0;
    for (let i = 0; i < n; i++) {
      const [x, z] = points[i];
      if (i) d += Math.hypot(x - points[i - 1][0], z - points[i - 1][1]);
      pos.setXYZ(i, x, this.heightAt(x, z) + 1.0, z);
      ld.setX(i, d);
    }
    pos.needsUpdate = true;
    ld.needsUpdate = true;
    this.routeLine.geometry.setDrawRange(0, n);
  }

  setRouteVisible(v) { this.routeLine.visible = v; }

  // objetos con animacion propia: fn(time, dt)
  addAnimated(fn) { this.animated.push(fn); }

  // Resolucion dinamica: si el juego baja de ~42 fps de forma sostenida, reduce la densidad de pixeles (hasta el
  // 60 %); si va sobrado durante un rato, la recupera. Ignora pestanas ocultas y tirones aislados.
  _adaptResolution(dt) {
    if (document.hidden || !(dt > 0) || dt > 0.1) return;
    this._ft = this._ft == null ? dt : this._ft * 0.94 + dt * 0.06;
    this._adaptT = (this._adaptT || 0) + dt;
    this._goodT = this._ft < 1 / 57 ? (this._goodT || 0) + dt : 0;
    if (this._adaptT < 2) return;
    const base = Math.min(window.devicePixelRatio, MAX_DPR), lo = Math.max(0.75, base * 0.6), pr = this.renderer.getPixelRatio();
    let next = pr;
    if (this._ft > 1 / 42 && pr > lo + 0.01) next = Math.max(lo, pr - 0.15);
    else if (this._goodT > 8 && pr < base - 0.01) { next = Math.min(base, pr + 0.1); this._goodT = 0; }
    if (next !== pr) { this.renderer.setPixelRatio(next); this.resize(); this._adaptT = 0; }
    else this._adaptT = 1.5;
  }

  render(time, dt = 0.016) {
    this._adaptResolution(dt);
    this.skyMat.uniforms.uTime.value = time;
    this.dustMat.uniforms.uTime.value = time;
    this.routeMat.uniforms.uTime.value = time;
    for (const b of this.beacons) {
      if (!b.group.visible) continue;
      b.beamMat.uniforms.uTime.value = time;
      // el haz se atenua de cerca para no tapar la vista
      const dcam = Math.hypot(this.camera.position.x - b.x, this.camera.position.z - b.z);
      b.beamMat.uniforms.uPower.value = b.power * Math.min(1, Math.max(0.12, (dcam - 10) / 90));
      if (b.target) {
        b.gem.position.y = b.baseY + Math.sin(time * 2.0) * 1.2;
        b.gem.rotation.y = time * 1.4;
        b.halo.position.y = b.gem.position.y;
        b.halo.rotation.z = -time * 0.8;
        const s = 1 + 0.12 * Math.sin(time * 4.0);
        b.halo.scale.set(s, s, s);
        b.ringMat.opacity = 0.65 + 0.3 * Math.sin(time * 4.0);
      }
    }
    for (const fn of this.animated) fn(time, dt);
    // 1) lejos: cielo, planetas y crater Gale; 2) se borra la profundidad; 3) cerca: terreno, rocas, estructuras
    const r = this.renderer, cam = this.camera, far = this.farCamera;
    far.position.copy(cam.position);
    far.quaternion.copy(cam.quaternion);
    this.sky.position.copy(cam.position);
    if (GFX.bloom && !this.composer) this._initPost();
    if (this.composer) {
      // de noche y en tormenta las luces artificiales resaltan mas
      const day = this.skyMat.uniforms.uDay.value;
      this.bloom.strength = 0.1 + 0.32 * (1 - day) * (1 - day) + 0.06 * this.storm;
      this.composer.render(dt);
      return;
    }
    r.clear();
    r.render(this.skyScene, far);
    r.clearDepth();
    r.render(this.scene, cam);
  }
}
