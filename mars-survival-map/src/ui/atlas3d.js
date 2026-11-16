// Atlas en 3D: globo de Marte con el relieve real de MOLA y, al acercarse, el terreno de Gale (MOLA 64 px/°)
// y de la zona EVA (DTM HiRISE+CTX) como mallas 3D. Todo en coordenadas planetocentricas, longitud Este.
//
// Geometria: cada vertice guarda su direccion en la esfera unidad y su elevacion real (m); el relieve se
// desplaza en el shader con una exageracion vertical configurable (uK), asi se puede cambiar sin rehacer mallas.
// La reticula lat/lon se dibuja en el shader, pegada al relieve. Los marcadores y rotulos los pinta el atlas
// en su lienzo 2D usando project()/unproject() de esta clase.
import * as THREE from "three";
import { texture164, meanLuma164 } from "./tex164.js";

const D2R = Math.PI / 180;
const R_MARS = 3389500;
const FOV = 38;

// lat/lon (grados) -> direccion unitaria. Este queda a la derecha con el norte arriba.
export function llToDir(lat, lon, out = new THREE.Vector3()) {
  const p = lat * D2R, l = lon * D2R, c = Math.cos(p);
  return out.set(c * Math.cos(l), Math.sin(p), -c * Math.sin(l));
}
export function dirToLL(v) {
  const n = v.clone().normalize();
  return { lat: Math.asin(Math.max(-1, Math.min(1, n.y))) / D2R, lon: ((Math.atan2(-n.z, n.x) / D2R) % 360 + 360) % 360 };
}

const VS = /* glsl */ `
  attribute float aElev;
  attribute vec2 aGrad;          // pendiente real del terreno: dE/d(este), dE/d(norte) en m/m
  uniform float uK, uLift;
  varying vec2 vUv; varying vec2 vLL; varying vec3 vN; varying vec3 vPos; varying vec2 vGrad; varying float vElev;
  void main() {
    vUv = uv;
    vN = normalize(position);
    vGrad = aGrad;
    vElev = aElev;
    vLL = vec2(atan(-vN.z, vN.x), asin(clamp(vN.y, -1.0, 1.0))) * 57.29578;
    vec3 p = vN * (1.0 + aElev * uK + uLift);
    vPos = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const FS = /* glsl */ `
  uniform sampler2D uMap, uOverlay;
  uniform sampler2D uTileA, uTileB;
  uniform float uTileOn, uZoneM;
  uniform vec2 uTileMean;
  uniform float uStep, uGrid, uOverlayOn, uSeamFix;
  uniform float uExag;           // exageracion vertical actual (x)
  uniform float uDetail;         // cuanto grano fino se anade (0 en la ortoimagen, que ya tiene detalle real)
  uniform float uIce;            // 1 = pintar los casquetes polares (solo en "tono marciano")
  varying vec2 vUv; varying vec2 vLL; varying vec3 vN; varying vec3 vPos; varying vec2 vGrad; varying float vElev;
  float gridLine(float v, float step) {
    float g = v / step;
    float d = abs(fract(g - 0.5) - 0.5) / max(fwidth(g), 1e-6);
    return 1.0 - clamp(d - 0.4, 0.0, 1.0);
  }
  float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), u.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), u.x), u.y),
               mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), u.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), u.x), u.y), u.z);
  }
  void main() {
    vec3 col = texture2D(uMap, vUv).rgb;
    vec3 V = normalize(cameraPosition - vPos);
    float ndv = clamp(dot(vN, V), 0.0, 1.0);

    // ---- grano fino: la textura de MOLA se queda borrosa al acercarse; varias octavas de ruido sobre la esfera
    // (cada una se apaga cuando su tamano baja de ~2 pixeles, para que no parpadee) dan la sensacion de terreno
    float fw = length(fwidth(vN));
    float dsum = 0.0, wsum = 0.0, fr = 90.0;
    for (int o = 0; o < 8; o++) {
      // solo las octavas cuyo grano mide entre ~3 y ~14 pixeles: textura, no relieve inventado
      float w = (1.0 - smoothstep(0.12, 0.36, fw * fr)) * smoothstep(0.02, 0.07, fw * fr);
      dsum += (vnoise(vN * fr + 17.0) - 0.5) * w; wsum += w;
      fr *= 3.7;
    }
    col *= 1.0 + dsum * 0.17 * uDetail;

    // Mosaicos metricos solo en EVA; pendientes reales sin exageracion vertical.
    if (uTileOn > 0.5) {
      float tileRock = smoothstep(0.08, 0.4, length(vGrad));
      vec2 tileLarge = vUv * (uZoneM / 560.0), tileSmall = vUv * (uZoneM / 56.0);
      vec2 tileFwL = fwidth(tileLarge), tileFwS = fwidth(tileSmall);
      float tileFadeL = 1.0 - smoothstep(1.0 / 8.0, 1.0 / 6.0, max(tileFwL.x, tileFwL.y));
      float tileFadeS = 1.0 - smoothstep(1.0 / 8.0, 1.0 / 6.0, max(tileFwS.x, tileFwS.y));
      vec3 tileL = mix(texture2D(uTileA, tileLarge).rgb, texture2D(uTileB, tileLarge).rgb, tileRock);
      vec3 tileS = mix(texture2D(uTileA, tileSmall).rgb, texture2D(uTileB, tileSmall).rgb, tileRock);
      // Centrar con las mismas proporciones de roca y regolito conserva el brillo.
      float tileMean = mix(uTileMean.x, uTileMean.y, tileRock);
      col *= clamp(1.0 + (tileL - vec3(tileMean)) * 1.6 * tileFadeL, 0.6, 1.4);
      col *= clamp(1.0 + (tileS - vec3(tileMean)) * 1.2 * tileFadeS, 0.6, 1.4);
    }

    // ---- casquetes polares (hielo de agua y CO2 estacional), con borde irregular
    if (uIce > 0.5) {
      float edge = (vnoise(vN * 14.0) - 0.5) * 5.0 + (vnoise(vN * 60.0) - 0.5) * 1.6;
      float ice = max(smoothstep(79.0, 82.5, vLL.y + edge), smoothstep(-82.5, -86.0, vLL.y + edge));
      vec3 iceCol = vec3(0.93, 0.9, 0.87) * (0.8 + 0.2 * dot(col, vec3(0.5)) / 0.6);
      col = mix(col, iceCol, ice * 0.88);
    }

    // ---- luz de cartografo: del noroeste, a 40 grados sobre el horizonte, con la normal real del relieve
    vec3 east = normalize(vec3(vN.z, 0.0, -vN.x) + 1e-6), north = cross(vN, east);
    vec3 N = normalize(vN - (east * vGrad.x + north * vGrad.y) * uExag);
    vec3 Ldir = normalize(-east * 0.55 + north * 0.55 + vN * 0.63);
    float ndl = max(dot(N, Ldir), 0.0) / 0.63;                       // 1 en terreno llano
    float slope = 1.0 - clamp(dot(N, vN), 0.0, 1.0);
    // (la textura ya trae un sombreado suave horneado: aqui se limita la sombra para que las laderas empinadas,
    // como los flancos de los volcanes, no se queden negras)
    col *= clamp(mix(1.0, ndl, 0.5), 0.7, 1.5) * 1.05;
    col *= 1.0 - 0.16 * smoothstep(0.15, 0.7, slope);                 // paredes y escarpes mas oscuros (roca desnuda)
    // brillo rasante sobre las crestas que miran a la luz
    col += vec3(1.0, 0.86, 0.7) * pow(max(dot(N, normalize(Ldir + V)), 0.0), 24.0) * 0.05;

    if (uOverlayOn > 0.5) { vec4 o = texture2D(uOverlay, vUv); col = mix(col, o.rgb, o.a * 0.85); }

    // ---- volumen de la esfera y bruma de polvo hacia el limbo
    col *= mix(0.55, 1.0, pow(ndv, 0.5));
    col = mix(col, vec3(0.9, 0.62, 0.43), pow(1.0 - ndv, 4.0) * 0.6);

    if (uGrid > 0.5) {
      // la longitud usa el uv para no romperse en la costura 0/360
      float lon = uSeamFix > 0.5 ? vUv.x * 360.0 : vLL.x;
      float pole = smoothstep(89.5, 86.0, abs(vLL.y));
      float g = max(gridLine(vLL.y, uStep), gridLine(lon, uStep) * pole);
      float eq = max(gridLine(vLL.y, 90.0), gridLine(lon, 180.0) * pole);       // ecuador y meridiano 0/180
      col = mix(col, vec3(1.0), g * 0.22);
      col = mix(col, vec3(1.0, 0.82, 0.45), eq * 0.5);
    }
    // un poco mas de contraste y saturacion
    col = mix(vec3(dot(col, vec3(0.3, 0.55, 0.15))), col, 1.12);
    col = clamp((col - 0.5) * 1.06 + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
  }`;

function terrainMaterial(tex, lift, seamFix, detail = 1) {
  return new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS,
    uniforms: { uMap: { value: tex }, uOverlay: { value: null }, uOverlayOn: { value: 0 }, uK: { value: 12 / R_MARS }, uLift: { value: lift }, uStep: { value: 30 }, uGrid: { value: 1 }, uSeamFix: { value: seamFix ? 1 : 0 },
      uExag: { value: 12 }, uDetail: { value: detail }, uIce: { value: 1 },
      uTileA: { value: tex }, uTileB: { value: tex }, uTileOn: { value: 0 }, uZoneM: { value: 1 }, uTileMean: { value: new THREE.Vector2(1, 1) } },
  });
}

// Malla regular en lat/lon. elevFn(i, j) -> metros, con i = columna (oeste -> este), j = fila (norte -> sur).
// rawFn(i, j): elevacion sin los hundimientos artificiales (para calcular la pendiente real); por defecto elevFn.
function gridMesh(latN, lonW, latSpan, lonSpan, nx, ny, elevFn, skirtM = 0, rawFn = elevFn) {
  const sk = skirtM > 0 ? 1 : 0;
  const W = nx + 1 + 2 * sk, H = ny + 1 + 2 * sk;
  const pos = new Float32Array(W * H * 3), uv = new Float32Array(W * H * 2), el = new Float32Array(W * H), gr = new Float32Array(W * H * 2);
  const v = new THREE.Vector3();
  for (let J = 0; J < H; J++) for (let I = 0; I < W; I++) {
    const i = Math.min(nx, Math.max(0, I - sk)), j = Math.min(ny, Math.max(0, J - sk));
    const edge = sk && (I === 0 || J === 0 || I === W - 1 || J === H - 1);
    const lat = latN - (j / ny) * latSpan, lon = lonW + (i / nx) * lonSpan;
    llToDir(lat, lon, v);
    const k = J * W + I;
    pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
    uv[k * 2] = i / nx; uv[k * 2 + 1] = 1 - j / ny;
    el[k] = elevFn(i, j) - (edge ? skirtM : 0);
    // pendiente por diferencias centradas, en metros reales (la malla es regular en lat/lon)
    const i0 = Math.max(0, i - 1), i1 = Math.min(nx, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(ny, j + 1);
    const mE = Math.max(1, ((i1 - i0) / nx) * lonSpan * D2R * R_MARS * Math.max(0.02, Math.cos(lat * D2R)));
    const mN = Math.max(1, ((j1 - j0) / ny) * latSpan * D2R * R_MARS);
    gr[k * 2] = (rawFn(i1, j) - rawFn(i0, j)) / mE;
    gr[k * 2 + 1] = (rawFn(i, j0) - rawFn(i, j1)) / mN;        // j crece hacia el sur
  }
  const idx = new Uint32Array((W - 1) * (H - 1) * 6);
  let q = 0;
  for (let J = 0; J < H - 1; J++) for (let I = 0; I < W - 1; I++) {
    const a = J * W + I, b = a + 1, c = a + W, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("aElev", new THREE.BufferAttribute(el, 1));
  g.setAttribute("aGrad", new THREE.BufferAttribute(gr, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
  return g;
}

export class Globe3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(0x070506, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 20);
    this.cam = { lat: -5, lon: 137.6, alt: 3.2, tilt: 0, heading: 0 };   // foco en la superficie, altura (radios de Marte)
    this.exagMode = "auto";
    this.k = 12;
    this.W = 1; this.H = 1;
    this.mats = [];
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._ray = new THREE.Ray();
    this._stars();
    this._atmosphere();
  }

  _stars() {
    const n = 1500, p = new Float32Array(n * 3);
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, a = rnd() * 6.2832, r = Math.sqrt(1 - u * u);
      p[i * 3] = r * Math.cos(a) * 15; p[i * 3 + 1] = u * 15; p[i * 3 + 2] = r * Math.sin(a) * 15;
    }
    // brillo y tono variados (muchas tenues, pocas brillantes; algunas azuladas o anaranjadas)
    const col = new Float32Array(n * 3), sz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const b = 0.25 + 0.75 * Math.pow(rnd(), 3.2), tint = rnd();
      col[i * 3] = b * (tint > 0.8 ? 1 : 0.9); col[i * 3 + 1] = b * 0.92; col[i * 3 + 2] = b * (tint < 0.25 ? 1 : 0.85);
      sz[i] = 1 + 2.2 * Math.pow(rnd(), 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sz, 1));
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uPx: { value: 1 } },
      vertexShader: /* glsl */ `attribute float aSize; attribute vec3 color; uniform float uPx; varying vec3 vC;
        void main(){ vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uPx; }`,
      fragmentShader: /* glsl */ `varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vC, smoothstep(0.5, 0.1, d)); }`,
    }));
    this.starMat = pts.material;
    pts.frustumCulled = false;
    this.scene.add(pts);
  }

  _atmosphere() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(position); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `varying vec3 vN; varying vec3 vP;
        void main(){ vec3 V = normalize(cameraPosition - vP); float f = clamp(1.0 + dot(vN, V), 0.0, 1.0);
          // halo fino: palido pegado al limbo y anaranjado hacia fuera (polvo en suspension)
          float a = pow(f, 2.6);
          vec3 c = mix(vec3(0.85, 0.42, 0.24), vec3(1.0, 0.8, 0.62), pow(f, 5.0));
          gl_FragColor = vec4(c * a, a * 0.95); }`,
    });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1.035, 64, 32), mat);
    this.scene.add(this.atmo);
  }

  // rG, rGale: rasters del atlas ({w, h, ppd, lat_north, lon_west, elev, canvas}); local: {bounds, n, h(Float32), yRef, image, sizeM}
  build(rG, rGale, local, region = null) {
    const mk = (canvasOrImg) => { const t = new THREE.CanvasTexture(canvasOrImg); t.colorSpace = THREE.NoColorSpace; t.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); t.wrapS = THREE.ClampToEdgeWrapping; return t; };
    const galeN = rGale.lat_north, galeW = rGale.lon_west, galeLat = rGale.h / rGale.ppd, galeLon = rGale.w / rGale.ppd;
    const b = local.bounds, m64 = 1 / rGale.ppd;
    const rb = region ? { n: region.lat_north, w: region.lon_west, s: region.lat_north - region.h / region.ppd, e: region.lon_west + region.w / region.ppd } : null;
    // --- globo: 720 x 360 celdas (0,5°). Bajo el parche de Gale se hunde para que no asome ---
    const NX = 720, NY = 360, sx = rG.w / NX, sy = rG.h / NY;
    const gRaw = (i, j) => rG.elev[Math.min(rG.h - 1, Math.round(j * sy)) * rG.w + (Math.min(rG.w - 1, Math.round(i * sx) % rG.w))];
    const gElev = (i, j) => {
      const x = Math.min(rG.w - 1, Math.round(i * sx) % rG.w), y = Math.min(rG.h - 1, Math.round(j * sy));
      let e = rG.elev[y * rG.w + x];
      const lat = 90 - (j / NY) * 180, lon = (i / NX) * 360;
      if (lat < galeN - 0.6 && lat > galeN - galeLat + 0.6 && lon > galeW + 0.6 && lon < galeW + galeLon - 0.6) e -= 9000;
      return e;
    };
    this.texG = mk(rG.canvas);
    const globe = new THREE.Mesh(gridMesh(90, 0, 180, 360, NX, NY, gElev, 0, gRaw), terrainMaterial(this.texG, 0, true, 1));
    // --- Gale: MOLA 64 px/°, una celda por pixel; hundido bajo la zona EVA ---
    const cRaw = (i, j) => rGale.elev[Math.min(rGale.h - 1, j) * rGale.w + Math.min(rGale.w - 1, i)];
    const cElev = (i, j) => {
      const x = Math.min(rGale.w - 1, i), y = Math.min(rGale.h - 1, j);
      let e = rGale.elev[y * rGale.w + x];
      const lat = galeN - (j / rGale.h) * galeLat, lon = galeW + (i / rGale.w) * galeLon;
      if (lat < b.north_lat - m64 && lat > b.south_lat + m64 && lon > b.west_lon_east + m64 && lon < b.east_lon_east - m64) e -= 2500;
      // bajo la zona de 60 km (HRSC+MOLA 200 m) tambien se hunde: si no, el MOLA grueso asomaria por encima
      else if (rb && lat < rb.n - m64 && lat > rb.s + m64 && lon > rb.w + m64 && lon < rb.e - m64) e -= 2500;
      return e;
    };
    this.texGale = mk(rGale.canvas);
    const gale = new THREE.Mesh(gridMesh(galeN, galeW, galeLat, galeLon, rGale.w, rGale.h, cElev, 7000, cRaw), terrainMaterial(this.texGale, 3e-6, false, 1));
    // --- zona EVA: DTM del juego (1024 -> 256 celdas), ortoimagen CTX ---
    const NL = 256, st = local.n / NL;
    const lElev = (i, j) => local.h[Math.min(local.n - 1, Math.round(j * st)) * local.n + Math.min(local.n - 1, Math.round(i * st))] + local.yRef;
    this.texLocal = mk(local.image);
    const loc = new THREE.Mesh(gridMesh(b.north_lat, b.west_lon_east, b.north_lat - b.south_lat, b.east_lon_east - b.west_lon_east, NL, NL, lElev, 1800), terrainMaterial(this.texLocal, 6e-6, false, 0.15));
    this.localMat = loc.material;
    this.localMat.uniforms.uTileA.value = texture164("regolith");
    this.localMat.uniforms.uTileB.value = texture164("bedrock");
    this.localMat.uniforms.uTileMean.value.set(meanLuma164("regolith"), meanLuma164("bedrock"));
    this.localMat.uniforms.uZoneM.value = local.sizeM;
    this.localMat.uniforms.uTileOn.value = 1;
    const meshes = [globe, gale, loc];
    // --- zona de ~60 km: HRSC+MOLA 200 m, una celda por pixel; hundida bajo la zona EVA ---
    if (region) {
      const rStep = 1 / region.ppd;
      const rRaw = (i, j) => region.elev[Math.min(region.h - 1, j) * region.w + Math.min(region.w - 1, i)];
      const rElev = (i, j) => {
        let e = region.elev[Math.min(region.h - 1, j) * region.w + Math.min(region.w - 1, i)];
        const lat = rb.n - (j / region.h) * (rb.n - rb.s), lon = rb.w + (i / region.w) * (rb.e - rb.w);
        if (lat < b.north_lat - rStep && lat > b.south_lat + rStep && lon > b.west_lon_east + rStep && lon < b.east_lon_east - rStep) e -= 1500;
        return e;
      };
      this.texRegion = mk(region.canvas);
      const reg = new THREE.Mesh(gridMesh(rb.n, rb.w, rb.n - rb.s, rb.e - rb.w, region.w, region.h, rElev, 2500, rRaw), terrainMaterial(this.texRegion, 4.5e-6, false, 0.45));
      meshes.push(reg);
    }
    for (const m of meshes) { m.frustumCulled = false; this.scene.add(m); this.mats.push(m.material); }
    this.built = true;
  }

  // casquetes polares: solo con el "tono marciano" (en relieve o presion taparian la escala de color)
  setIce(on) { for (const m of this.mats) m.uniforms.uIce.value = on ? 1 : 0; }
  texturesChanged() { if (this.texG) { this.texG.needsUpdate = true; this.texGale.needsUpdate = true; if (this.texRegion) this.texRegion.needsUpdate = true; } }
  setOverlay(img) {
    if (!this.localMat) return;
    if (img && img.complete && img.naturalWidth) {
      if (this._ovImg !== img) { this._ovImg = img; this._ovTex = new THREE.CanvasTexture(img); this._ovTex.colorSpace = THREE.NoColorSpace; }
      this.localMat.uniforms.uOverlay.value = this._ovTex; this.localMat.uniforms.uOverlayOn.value = 1;
    } else this.localMat.uniforms.uOverlayOn.value = 0;
  }

  setSize(w, h, dpr) {
    this.W = w; this.H = h;
    this.renderer.setPixelRatio(dpr);
    if (this.starMat) this.starMat.uniforms.uPx.value = dpr;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // pixeles por grado de arco en el foco (mirando en vertical): la "escala" que usa el atlas para decidir rotulos
  get s() { return (D2R * this.H) / (2 * this.cam.alt * Math.tan((FOV * D2R) / 2)); }
  altForS(s) { return (D2R * this.H) / (2 * s * Math.tan((FOV * D2R) / 2)); }
  get exag() { return this.k; }

  // exageracion vertical: automatica (12x de lejos -> 2x de cerca) o fija
  _updateK() {
    this.k = this.exagMode === "auto" ? Math.max(1.5, Math.min(12, 2 + 4.35 * Math.log10(this.cam.alt / 0.005))) : +this.exagMode;
    for (const m of this.mats) { m.uniforms.uK.value = this.k / R_MARS; m.uniforms.uExag.value = this.k; }
  }

  // elevFn(lat, lon) -> m (la da el atlas). Coloca la camara segun foco, altura, inclinacion y rumbo.
  updateCamera(elevFn) {
    const c = this.cam;
    c.lat = Math.max(-89.5, Math.min(89.5, c.lat));
    c.lon = ((c.lon % 360) + 360) % 360;
    c.alt = Math.max(0.0009, Math.min(6, c.alt));
    c.tilt = Math.max(0, Math.min(80, c.tilt));
    this._updateK();
    const p = c.lat * D2R, l = c.lon * D2R;
    const n = llToDir(c.lat, c.lon, this._n || (this._n = new THREE.Vector3()));
    const east = (this._e || (this._e = new THREE.Vector3())).set(-Math.sin(l), 0, -Math.cos(l));
    const north = (this._no || (this._no = new THREE.Vector3())).set(-Math.sin(p) * Math.cos(l), Math.cos(p), Math.sin(p) * Math.sin(l));
    const h = c.heading * D2R, t = c.tilt * D2R;
    const f = (this._f || (this._f = new THREE.Vector3())).copy(north).multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h));
    const e0 = elevFn ? elevFn(c.lat, c.lon) : 0;
    const P = this._v.copy(n).multiplyScalar(1 + (e0 * this.k) / R_MARS);
    this.focusPoint = (this.focusPoint || new THREE.Vector3()).copy(P);
    this.camera.position.copy(P).addScaledVector(n, c.alt * Math.cos(t)).addScaledVector(f, -c.alt * Math.sin(t));
    this.camera.up.copy(c.tilt < 1 ? f : n);
    this.camera.lookAt(P);
    this.camera.near = Math.max(1e-5, c.alt * 0.02);
    this.camera.far = c.alt + 4 + 16;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    this.screenRight = (this._r || (this._r = new THREE.Vector3())).copy(east).multiplyScalar(Math.cos(h)).addScaledVector(north, -Math.sin(h));
    this.screenUp = f;
  }

  render(gridStep, gridOn) {
    for (const m of this.mats) { m.uniforms.uStep.value = gridStep; m.uniforms.uGrid.value = gridOn ? 1 : 0; }
    this.renderer.render(this.scene, this.camera);
  }

  // lat, lon, elevacion (m) -> pixeles; NaN si queda en la cara oculta o fuera de la vista
  project(lat, lon, elev = 0) {
    const v = llToDir(lat, lon, this._v2).multiplyScalar(1 + ((elev + 60) * this.k) / R_MARS);
    // visible si la superficie mira hacia la camara
    const cx = this.camera.position.x - v.x, cy = this.camera.position.y - v.y, cz = this.camera.position.z - v.z;
    const facing = (v.x * cx + v.y * cy + v.z * cz) / (v.length() * Math.hypot(cx, cy, cz));
    if (facing < 0.02) return { x: NaN, y: NaN };
    v.project(this.camera);
    if (v.z < -1 || v.z > 1) return { x: NaN, y: NaN };
    return { x: (v.x * 0.5 + 0.5) * this.W, y: (1 - (v.y * 0.5 + 0.5)) * this.H };
  }

  // pixel -> lat/lon sobre el relieve (interseccion rayo-esfera, refinada con la elevacion del punto)
  unproject(x, y, elevFn) {
    const o = this.camera.position;
    const d = this._v2.set((x / this.W) * 2 - 1, -((y / this.H) * 2 - 1), 0.5).unproject(this.camera).sub(o).normalize();
    // se parte de la elevacion del foco: en el fondo de Gale (~4 km bajo el datum) una camara baja queda dentro
    // de la esfera de radio 1 y el rayo no la cortaria por fuera
    let r = elevFn ? 1 + (elevFn(this.cam.lat, this.cam.lon) * this.k) / R_MARS : 1, hit = null;
    for (let it = 0; it < 4; it++) {
      const b = o.dot(d), c = o.lengthSq() - r * r, disc = b * b - c;
      if (disc < 0) return hit;
      const tt = -b - Math.sqrt(disc);
      if (tt < 0 || c < 0) return hit;
      const pnt = this._v.copy(o).addScaledVector(d, tt);
      hit = dirToLL(pnt);
      if (!elevFn) break;
      r = 1 + (elevFn(hit.lat, hit.lon) * this.k) / R_MARS;
    }
    return hit;
  }

  // arrastrar: mueve el foco sobre la superficie (dx, dy en pixeles)
  pan(dx, dy) {
    const c = this.cam, s = this.s, h = c.heading * D2R;
    const dE = (-dx * Math.cos(h) + dy * Math.sin(h)) / s, dN = (dx * Math.sin(h) + dy * Math.cos(h)) / s / Math.max(0.35, Math.cos(c.tilt * D2R));
    c.lat += dN;
    c.lon += dE / Math.max(0.05, Math.cos(c.lat * D2R));
  }
  // boton derecho / Ctrl + arrastrar: girar el rumbo e inclinar la vista
  orbit(dx, dy) { this.cam.heading = (this.cam.heading - dx * 0.3 + 360) % 360; this.cam.tilt -= dy * 0.3; }
  zoom(k) { this.cam.alt /= k; }
}
