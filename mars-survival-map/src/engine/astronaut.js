import * as THREE from "three";
import { markAnimated, mergeChildren } from "./merge.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "../data.js";

const lerp = (a, b, k) => a + (b - a) * k;

// Opciones de personalizacion del traje (pantalla de perfil). Solo cambian el aspecto, no la fisiologia.
const L = (es, en) => ({ es, en });
export const LOOK_OPTIONS = {
  suit: {
    white: { hex: "#efebe3", name: L("Blanco EVA", "EVA white") },
    ivory: { hex: "#e4d6bd", name: L("Marfil", "Ivory") },
    gray: { hex: "#a9adb5", name: L("Gris lunar", "Lunar gray") },
    sand: { hex: "#c99a6e", name: L("Arena marciana", "Mars sand") },
    graphite: { hex: "#45484f", name: L("Grafito", "Graphite") },
  },
  accent: {
    orange: { hex: "#d4541c", name: L("Naranja de mision", "Mission orange") },
    blue: { hex: "#2f7de1", name: L("Azul", "Blue") },
    red: { hex: "#c8242e", name: L("Rojo", "Red") },
    green: { hex: "#2e9e5a", name: L("Verde", "Green") },
    yellow: { hex: "#e6b422", name: L("Amarillo", "Yellow") },
    purple: { hex: "#7a4bd1", name: L("Violeta", "Violet") },
  },
  visor: {
    gold: { hex: "#e0a437", emissive: "#6b3d06", name: L("Dorada (filtro solar)", "Gold (sun filter)") },
    silver: { hex: "#c9d2dc", emissive: "#3a4450", name: L("Plateada", "Silver") },
    blue: { hex: "#4f86c9", emissive: "#0f2b4f", name: L("Azul", "Blue") },
    amber: { hex: "#c8662a", emissive: "#4a1a05", name: L("Ambar", "Amber") },
    clear: { hex: "#cfe6ff", emissive: "#000000", clear: true, name: L("Transparente (se ve la cara)", "Clear (face visible)") },
  },
  skin: {
    s1: { hex: "#f1d0b5" }, s2: { hex: "#e0ac85" }, s3: { hex: "#c68a5e" },
    s4: { hex: "#9a6440" }, s5: { hex: "#6b4128" }, s6: { hex: "#45291a" },
  },
};
export const DEFAULT_LOOK = { suit: "white", accent: "orange", visor: "gold", skin: "s3", lamps: true, antenna: true, crest: true };
export function sanitizeLook(l = {}) {
  const pick = (k) => (LOOK_OPTIONS[k][l[k]] ? l[k] : DEFAULT_LOOK[k]);
  const flag = (k) => (typeof l[k] === "boolean" ? l[k] : DEFAULT_LOOK[k]);
  return { suit: pick("suit"), accent: pick("accent"), visor: pick("visor"), skin: pick("skin"), lamps: flag("lamps"), antenna: flag("antenna"), crest: flag("crest") };
}

// Gestos cotidianos (emotes). dur = segundos; loop = se mantiene hasta que el jugador se mueve.
export const EMOTES = {
  wave: { key: "z", dur: 2.8, name: L("Saludar", "Wave") },
  thumbs: { key: "x", dur: 2.2, name: L("Pulgar arriba", "Thumbs up") },
  sit: { key: "c", loop: true, name: L("Sentarse", "Sit down") },
  dance: { key: "v", dur: 7, name: L("Bailar", "Dance") },
  stretch: { key: "b", dur: 3.4, name: L("Estirarse", "Stretch") },
  // solo para EVA-2 herido (sin tecla): sentado con la pierna danada estirada y las manos en la rodilla
  hurt: { loop: true, name: L("Herido", "Injured") },
};

// ---- geometria y texturas del traje -----------------------------------------------------------------------
const DUST = new THREE.Color("#b07a52");       // polvo de Marte que se pega al tejido

// Superficie por secciones ("loft"): anillos apilados en Y. Cada seccion: { y, rx, rz = rx, x = 0, z = 0, p = 2 }.
// p es el exponente de la superelipse (2 = elipse; mas alto = esquinas mas cuadradas, para piezas rigidas).
// cap: 1 tapa inferior, 2 tapa superior, 3 las dos. Las UV van en metros para que el tejido tenga la misma escala.
function loft(secs, seg = 18, cap = 3) {
  if (secs[secs.length - 1].y < secs[0].y) secs = [...secs].reverse();
  const n = secs.length, row = seg + 1, pos = [], uv = [], idx = [];
  const R = Math.max(...secs.map((q) => (q.rx + (q.rz ?? q.rx)) / 2));
  const ring = (q, out) => {
    const rz = q.rz ?? q.rx, e = 2 / (q.p || 2);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      out.push((q.x || 0) + q.rx * Math.sign(c) * Math.abs(c) ** e, q.y, (q.z || 0) + rz * Math.sign(sn) * Math.abs(sn) ** e);
    }
  };
  let v = 0;
  for (let i = 0; i < n; i++) {
    const q = secs[i];
    if (i) { const o = secs[i - 1]; v += Math.hypot(q.y - o.y, q.rx - o.rx, (q.z || 0) - (o.z || 0)); }
    ring(q, pos);
    for (let j = 0; j <= seg; j++) uv.push((j / seg) * 2 * Math.PI * R, v);
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // (las tapas llevan sus propios vertices: arista viva)
  const addCap = (q, top) => {
    const base = pos.length / 3;
    ring(q, pos);
    for (let j = 0; j <= seg; j++) uv.push(pos[(base + j) * 3], pos[(base + j) * 3 + 2]);
    pos.push(q.x || 0, q.y, q.z || 0); uv.push(q.x || 0, q.z || 0);
    const ctr = base + row;
    for (let j = 0; j < seg; j++) top ? idx.push(ctr, base + j + 1, base + j) : idx.push(ctr, base + j, base + j + 1);
  };
  if (cap & 1) addCap(secs[0], false);
  if (cap & 2) addCap(secs[n - 1], true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // la costura (j = 0 y j = seg son el mismo punto): se promedian las normales para que no se note
  const nor = geo.attributes.normal;
  for (let i = 0; i < n; i++) {
    const a = i * row, b = a + seg;
    const x = nor.getX(a) + nor.getX(b), y = nor.getY(a) + nor.getY(b), z = nor.getZ(a) + nor.getZ(b), l = Math.hypot(x, y, z) || 1;
    nor.setXYZ(a, x / l, y / l, z / l); nor.setXYZ(b, x / l, y / l, z / l);
  }
  return geo;
}

// Fuelle (convoluta) de una articulacion: secciones con el radio ondulado
function bellows(y0, y1, r0, r1, ribs, amp) {
  const out = [], n = ribs * 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ y: y0 + (y1 - y0) * t, rx: r0 + (r1 - r0) * t + amp * Math.cos(t * ribs * 2 * Math.PI) });
  }
  return out;
}

// Relieve del tejido exterior, compartido por todos los trajes: pliegues de unos centimetros que rodean cada pieza
// (un traje presurizado se arruga en sentido transversal) y, encima, la trama fina de la tela.
let _weave = null;
function fabricBump() {
  if (_weave) return _weave;
  const S = 256, cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d"), im = ctx.createImageData(S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // ruido de valor repetible (se puede poner en mosaico): rejilla gx x gy interpolada con coseno
  const noise = (gx, gy) => {
    const gr = Array.from({ length: gx * gy }, rnd), sm = (t) => (1 - Math.cos(t * Math.PI)) / 2;
    return (x, y) => {
      const fx = (x / S) * gx, fy = (y / S) * gy, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
      const at = (i, j) => gr[(((j % gy) + gy) % gy) * gx + (((i % gx) + gx) % gx)];
      return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    };
  };
  const fold = noise(3, 11), fold2 = noise(7, 22), grain = noise(40, 40);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const crease = Math.abs(fold(x, y) - 0.5) * 2;                    // crestas y valles de los pliegues
    const thread = (((x >> 1) + (y >> 1)) & 1) * 9;                   // trama
    const vv = 70 + 95 * crease + 46 * fold2(x, y) + 20 * grain(x, y) + thread;
    const k = (y * S + x) * 4;
    im.data[k] = im.data[k + 1] = im.data[k + 2] = Math.max(0, Math.min(255, vv)); im.data[k + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  _weave = new THREE.CanvasTexture(cv);
  _weave.wrapS = _weave.wrapT = THREE.RepeatWrapping;
  _weave.repeat.set(2.6, 2.6);                                        // UV en metros: el mosaico mide ~38 cm
  _weave.anisotropy = 4;
  return _weave;
}

// Entorno de Marte (equirectangular) para los reflejos de la visera y de los anillos metalicos:
// cielo color caramelo mas claro hacia el horizonte, el Sol, lomas lejanas y suelo rojizo.
let _env = null;
function marsEnv() {
  if (_env) return _env;
  const Wd = 256, Hd = 128, cv = document.createElement("canvas");
  cv.width = Wd; cv.height = Hd;
  const ctx = cv.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, Hd / 2);
  sky.addColorStop(0, "#7a5a43"); sky.addColorStop(0.55, "#c79e77"); sky.addColorStop(1, "#f6e0c0");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, Wd, Hd / 2);
  const gnd = ctx.createLinearGradient(0, Hd / 2, 0, Hd);
  gnd.addColorStop(0, "#8a563a"); gnd.addColorStop(0.3, "#5c3625"); gnd.addColorStop(1, "#24140e");
  ctx.fillStyle = gnd; ctx.fillRect(0, Hd / 2, Wd, Hd / 2);
  ctx.fillStyle = "#6e4630";                                           // lomas en el horizonte
  ctx.beginPath(); ctx.moveTo(0, Hd / 2 + 2);
  for (let x = 0; x <= Wd; x += 4) ctx.lineTo(x, Hd / 2 - 3 - 5 * Math.abs(Math.sin(x * 0.045) * Math.sin(x * 0.013 + 1)));
  ctx.lineTo(Wd, Hd / 2 + 2); ctx.closePath(); ctx.fill();
  const sun = ctx.createRadialGradient(70, 30, 0, 70, 30, 34);
  sun.addColorStop(0, "rgba(255,255,250,1)"); sun.addColorStop(0.12, "rgba(255,244,224,.95)"); sun.addColorStop(0.4, "rgba(255,226,190,.35)"); sun.addColorStop(1, "rgba(255,220,180,0)");
  ctx.fillStyle = sun; ctx.fillRect(0, 0, Wd, Hd / 2 + 10);
  _env = new THREE.CanvasTexture(cv);
  _env.mapping = THREE.EquirectangularReflectionMapping;
  _env.colorSpace = THREE.SRGBColorSpace;
  return _env;
}

// Astronauta. Usa public/models/astronaut.glb de M1 si existe; si no, un traje EVA articulado hecho con primitivas.
// El modelo mira hacia -Z (igual que el rumbo del juego) y mide ~1,92 m con los pies en y = 0 (persona de 1,75 m
// con botas y casco). Proporciones y piezas de un traje EVA real: torso rigido, rodamientos, fuelles, guantes con dedos.
export class Astronaut {
  // opts.accent: color de las franjas del traje (EVA-2 lleva otro color para distinguirlo)
  constructor(scene, opts = {}) {
    this.opts = opts;
    this.root = new THREE.Group();
    this.phase = 0;
    this.gait = 0;     // 0 parado .. 1 a paso completo (suavizado)
    this.clock = 0;
    this.mixer = null;
    this._buildSuit();
    scene.add(this.root);
  }

  async tryLoadModel() {
    try {
      const head = await fetch(assetUrl("models/astronaut.glb"), { method: "HEAD" });
      if (!head.ok || !(head.headers.get("content-type") || "").match(/gltf|octet|model/)) return false;
      const gltf = await new GLTFLoader().loadAsync(assetUrl("models/astronaut.glb"));
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const h = box.max.y - box.min.y || 1;
      model.scale.setScalar(1.85 / h);
      model.position.y = -box.min.y * (1.85 / h);
      this.root.remove(this.body);
      this.root.add(model);
      this.body = model;
      this.parts = null;
      if (gltf.animations.length) {
        this.mixer = new THREE.AnimationMixer(model);
        this.actions = Object.fromEntries(gltf.animations.map((a) => [a.name.toLowerCase(), this.mixer.clipAction(a)]));
        (this.actions.idle || Object.values(this.actions)[0]).play();
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  _buildSuit() {
    const std = (color, roughness = 0.85, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    const weave = fabricBump(), env = marsEnv();
    const cloth = (color, rough = 0.92, bump = 2.6) => std(color, rough, 0, { bumpMap: weave, bumpScale: bump });
    const M = {
      suit: cloth("#efebe3"),                    // tejido exterior (ortho-fabric): blanco para reflejar el sol
      cover: cloth("#efebe3", 0.9, 0.9),          // funda de las piezas rigidas (mochila, modulo del pecho): mas tensa
      suitDusty: cloth("#d9c4ad", 0.96),         // mismas piezas por debajo de la rodilla: polvo marciano adherido
      fabric: cloth("#d2cec6", 0.96),            // fuelles (convolutas) de hombros, codos y rodillas
      boot: cloth("#b9a48f", 0.97),
      glove: cloth("#b9b7b1", 0.9),
      dark: std("#2a2c31", 0.85),                // goma de las yemas de los dedos y juntas
      sole: std("#3c3e44", 0.95),
      accent: std(this.opts.accent || "#d4541c", 0.75),
      metal: std("#c9ccd2", 0.32, 1, { envMap: env, envMapIntensity: 0.9 }),      // anillos de casco, cintura y munecas
      // visera con bano de oro: refleja el cielo y el suelo de Marte (mapa de entorno propio, ver marsEnv)
      visor: std("#e0a437", 0.07, 1, { envMap: env, envMapIntensity: 1.25, emissive: "#6b3d06", emissiveIntensity: 0.18 }),
      visorRim: std("#1c1d21", 0.55, 0.3),
      lamp: std("#fff6de", 0.4, 0, { emissive: "#fff1c8", emissiveIntensity: 1.6 }),
      led: std("#3ddc97", 0.4, 0, { emissive: "#3ddc97", emissiveIntensity: 2.2 }),
      ledRed: std("#ff4d4d", 0.4, 0, { emissive: "#ff4d4d", emissiveIntensity: 2.2 }),
      panel: std("#22252c", 0.5, 0.2),
      skin: std("#c68a5e", 0.65),
      liner: std("#34363c", 0.95, 0, { side: THREE.BackSide }),
    };
    const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
    const tube = (pts, mat, seg = 16, cap = 3) => new THREE.Mesh(loft(pts.map(([y, r, z = 0]) => ({ y, rx: r, z })), seg, cap), mat);
    const g = new THREE.Group();

    // ---- torso rigido (HUT): pivota en la cintura ----------------------------------------------------
    const torso = new THREE.Group();
    torso.position.y = 0.98;
    const hut = mesh(loft([
      { y: 0.02, rx: 0.186, rz: 0.134, p: 2.5 }, { y: 0.12, rx: 0.2, rz: 0.15, p: 2.6 }, { y: 0.26, rx: 0.226, rz: 0.166, p: 2.8 },
      { y: 0.4, rx: 0.246, rz: 0.168, p: 2.8 }, { y: 0.49, rx: 0.232, rz: 0.156, p: 2.6 }, { y: 0.55, rx: 0.176, rz: 0.142, p: 2.3 },
      { y: 0.585, rx: 0.15, rz: 0.142 },
    ], 24), M.suit);
    // parte blanda inferior (cadera y entrepierna) y rodamiento de cintura
    const brief = mesh(loft([
      { y: -0.175, rx: 0.1, rz: 0.085 }, { y: -0.13, rx: 0.172, rz: 0.125, p: 2.4 }, { y: -0.06, rx: 0.198, rz: 0.142, p: 2.4 },
      { y: 0.0, rx: 0.192, rz: 0.138, p: 2.4 }, { y: 0.03, rx: 0.186, rz: 0.134, p: 2.4 },
    ], 22), M.suit);
    const waistRing = mesh(new THREE.TorusGeometry(0.19, 0.016, 8, 32), M.metal, 0, 0.025, 0);
    waistRing.rotation.x = Math.PI / 2;
    waistRing.scale.set(1, 0.73, 1);
    const neck = tube([[0.575, 0.158], [0.6, 0.152], [0.62, 0.15], [0.63, 0.142]], M.metal, 28);
    const neckLock = mesh(new THREE.TorusGeometry(0.153, 0.007, 6, 32), M.accent, 0, 0.607, 0);
    neckLock.rotation.x = Math.PI / 2;
    // rodamientos de los hombros (scye)
    for (const side of [-1, 1]) {
      const scye = mesh(new THREE.TorusGeometry(0.09, 0.013, 8, 24), M.metal, side * 0.262, 0.445, 0);
      scye.rotation.set(0, Math.PI / 2, 0);
      scye.rotation.z = -side * 0.12;
      torso.add(scye);
    }
    // modulo de control del pecho (DCM): pantalla, interruptores, valvula de purga y conectores
    const dcm = new THREE.Group();
    dcm.position.set(0, 0.3, -0.196);
    const dcmBody = mesh(loft([{ y: -0.082, rx: 0.118, rz: 0.04, p: 5 }, { y: -0.075, rx: 0.126, rz: 0.046, p: 5 }, { y: 0.075, rx: 0.126, rz: 0.046, p: 5 }, { y: 0.082, rx: 0.118, rz: 0.04, p: 5 }], 20), M.cover);
    dcm.add(dcmBody,
      mesh(new THREE.BoxGeometry(0.2, 0.11, 0.008), M.panel, 0, 0.005, -0.048),
      mesh(new THREE.BoxGeometry(0.085, 0.032, 0.006), std("#9fe6ff", 0.4, 0, { emissive: "#7fd1ff", emissiveIntensity: 1.1 }), -0.045, 0.03, -0.053),
      mesh(new THREE.BoxGeometry(0.014, 0.014, 0.008), M.led, 0.035, 0.038, -0.053),
      mesh(new THREE.BoxGeometry(0.014, 0.014, 0.008), M.ledRed, 0.06, 0.038, -0.053));
    for (let i = 0; i < 4; i++) {                       // interruptores de palanca
      const sw = mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.022, 6), M.metal, -0.075 + i * 0.03, -0.02, -0.058);
      sw.rotation.x = Math.PI / 2 - 0.5;
      dcm.add(sw);
    }
    const purge = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.022, 12), M.ledRed, 0.07, -0.022, -0.056);
    purge.rotation.x = Math.PI / 2;
    const conn = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 12), M.metal, 0.085, -0.09, -0.012);
    const conn2 = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.03, 10), M.metal, -0.085, -0.09, -0.012);
    dcm.add(purge, conn, conn2);
    // umbilicales del DCM: salen de los conectores inferiores y entran en el torso por los costados
    const hoseGeo = new THREE.TorusGeometry(0.058, 0.0105, 6, 12, Math.PI * 0.55);
    const hose = mesh(hoseGeo, M.fabric, 0.143, 0.2, -0.168), hose2 = mesh(hoseGeo, M.fabric, -0.143, 0.2, -0.168);
    hose.rotation.set(0, 0.5, Math.PI); hose2.rotation.set(0, Math.PI - 0.5, Math.PI);
    // parche de mision y etiqueta con el nombre
    const patch = mesh(new THREE.CircleGeometry(0.03, 20), M.accent, 0.105, 0.455, -0.166);
    patch.rotation.set(-0.12, Math.PI, 0);
    const tag = mesh(new THREE.PlaneGeometry(0.075, 0.02), M.panel, -0.1, 0.45, -0.167);
    tag.rotation.set(-0.12, Math.PI, 0);
    torso.add(hut, brief, waistRing, neck, neckLock, dcm, hose, hose2, patch, tag);

    // ---- mochila de soporte vital (PLSS) y bloque de oxigeno secundario ----------------------------
    const pack = new THREE.Group();
    pack.position.set(0, 0.31, 0.262);
    const packBody = mesh(loft([{ y: -0.36, rx: 0.212, rz: 0.08, p: 5 }, { y: -0.335, rx: 0.236, rz: 0.098, p: 6 }, { y: 0.335, rx: 0.236, rz: 0.098, p: 6 }, { y: 0.365, rx: 0.214, rz: 0.082, p: 5 }], 24), M.cover);
    const sop = mesh(loft([{ y: -0.5, rx: 0.186, rz: 0.07, p: 5 }, { y: -0.485, rx: 0.2, rz: 0.082, p: 6 }, { y: -0.36, rx: 0.2, rz: 0.082, p: 6 }], 20), M.fabric);
    const packStripe = mesh(loft([{ y: 0.19, rx: 0.2385, rz: 0.1005, p: 6 }, { y: 0.23, rx: 0.2385, rz: 0.1005, p: 6 }], 24, 0), M.accent);
    const radiator = mesh(new THREE.BoxGeometry(0.33, 0.27, 0.01), M.panel, 0, -0.09, 0.099);
    for (let i = 0; i < 6; i++) pack.add(mesh(new THREE.BoxGeometry(0.31, 0.01, 0.014), M.metal, 0, -0.2 + i * 0.044, 0.106));
    const label = mesh(new THREE.BoxGeometry(0.12, 0.035, 0.006), M.panel, -0.09, 0.285, 0.099);
    const handleGeo = new THREE.CapsuleGeometry(0.008, 0.22, 3, 6);
    const handL = mesh(handleGeo, M.metal, -0.246, 0.02, 0.02), handR = mesh(handleGeo, M.metal, 0.246, 0.02, 0.02);
    const comm = mesh(new THREE.BoxGeometry(0.1, 0.03, 0.08), M.panel, 0.14, 0.375, 0.01);
    const mast = mesh(new THREE.CylinderGeometry(0.004, 0.007, 0.42, 6), M.metal, 0.17, 0.59, 0.02);
    const mastTip = mesh(new THREE.SphereGeometry(0.014, 8, 6), M.ledRed, 0.17, 0.805, 0.02);
    pack.add(packBody, sop, packStripe, radiator, label, handL, handR, comm, mast, mastTip);
    torso.add(pack);

    // ---- casco: burbuja + conjunto de viseras (EVVA) --------------------------------------------------
    const head = new THREE.Group();
    head.position.y = 0.762;
    const R = 0.172, SC = [1, 1.04, 1.07];
    const W = Math.PI * 0.8, T0 = Math.PI * 0.21, TL = Math.PI * 0.5, P0 = Math.PI * 1.5 - W / 2;
    const shell = mesh(new THREE.SphereGeometry(R, 32, 22), M.suit);
    shell.scale.set(...SC);
    // visera dorada: casquete centrado en -Z
    const visor = mesh(new THREE.SphereGeometry(R + 0.006, 32, 20, P0, W, T0, TL), M.visor);
    visor.scale.set(...SC);
    const rim = mesh(new THREE.SphereGeometry(R + 0.0025, 32, 20, P0 - 0.07, W + 0.14, T0 - 0.06, TL + 0.12), M.visorRim);
    rim.scale.set(...SC);
    // franja de identificacion sobre el casco (de la frente a la nuca)
    const crest = new THREE.Group();
    const dPhi = 0.2;
    crest.add(mesh(new THREE.SphereGeometry(R + 0.004, 6, 8, Math.PI * 1.5 - dPhi / 2, dPhi, 0.02, T0 - 0.1), M.accent),
      mesh(new THREE.SphereGeometry(R + 0.004, 6, 14, Math.PI * 0.5 - dPhi / 2, dPhi, 0.02, Math.PI * 0.62), M.accent));
    crest.scale.set(...SC);
    // ejes de la visera y focos del casco
    const pivotGeo = new THREE.CylinderGeometry(0.034, 0.034, 0.016, 16);
    const pivL = mesh(pivotGeo, M.fabric, -(R + 0.004), -0.005, 0.0), pivR = mesh(pivotGeo, M.fabric, R + 0.004, -0.005, 0.0);
    pivL.rotation.z = pivR.rotation.z = Math.PI / 2;
    const lampGeo = new THREE.BoxGeometry(0.034, 0.05, 0.085);
    const lampL = mesh(lampGeo, M.panel, -0.186, 0.058, -0.012), lampR = mesh(lampGeo, M.panel, 0.186, 0.058, -0.012);
    const beamGeo = new THREE.CircleGeometry(0.0135, 12);
    const beamL = mesh(beamGeo, M.lamp, -0.186, 0.058, -0.0555), beamR = mesh(beamGeo, M.lamp, 0.186, 0.058, -0.0555);
    beamL.rotation.y = beamR.rotation.y = Math.PI;
    const camPod = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 10), M.dark, 0.186, 0.098, -0.02);
    camPod.rotation.x = Math.PI / 2;
    // cabeza (solo se ve con la visera transparente): craneo, cara, gorro de comunicaciones y microfono
    const face = new THREE.Group();
    const skull = mesh(loft([
      { y: -0.118, rx: 0.03, rz: 0.034, z: -0.034 }, { y: -0.092, rx: 0.058, rz: 0.068, z: -0.016 }, { y: -0.05, rx: 0.07, rz: 0.084, z: -0.006 },
      { y: 0.0, rx: 0.075, rz: 0.091 }, { y: 0.05, rx: 0.075, rz: 0.092, z: 0.004 }, { y: 0.092, rx: 0.058, rz: 0.074, z: 0.008 }, { y: 0.114, rx: 0.026, rz: 0.034, z: 0.008 },
    ], 18), M.skin);
    const neckSkin = tube([[-0.2, 0.052], [-0.085, 0.048]], M.skin, 12, 0);
    neckSkin.position.z = 0.012;
    const eyeW = std("#f4f1ec", 0.4), eyeGeo = new THREE.SphereGeometry(0.0115, 10, 8), irisGeo = new THREE.SphereGeometry(0.0062, 8, 6);
    const browGeo = new THREE.BoxGeometry(0.03, 0.005, 0.006);
    for (const sx of [-1, 1]) {
      const eye = mesh(eyeGeo, eyeW, sx * 0.031, 0.012, -0.079); eye.scale.set(1.25, 0.8, 1);
      const brow = mesh(browGeo, M.dark, sx * 0.032, 0.032, -0.088); brow.rotation.z = -sx * 0.12;
      const ear = mesh(new THREE.SphereGeometry(0.02, 8, 6), M.skin, sx * 0.076, -0.005, 0.008); ear.scale.set(0.45, 1.2, 0.8);
      face.add(eye, mesh(irisGeo, M.dark, sx * 0.031, 0.012, -0.0865), brow, ear);
    }
    const nose = mesh(loft([{ y: -0.028, rx: 0.013, rz: 0.012, z: -0.097 }, { y: -0.012, rx: 0.011, rz: 0.012, z: -0.098 }, { y: 0.02, rx: 0.007, rz: 0.008, z: -0.09 }], 8), M.skin);
    const mouth = mesh(new THREE.BoxGeometry(0.034, 0.005, 0.006), std("#7a3b33", 0.6), 0, -0.058, -0.084);
    // gorro de comunicaciones ("Snoopy cap") con auriculares y microfono
    const capMat = cloth("#e9e6df", 0.95);
    const cap = mesh(new THREE.SphereGeometry(0.097, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.46), capMat, 0, 0.012, 0.012);
    cap.scale.set(0.86, 1.1, 1.02);
    const cupGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.014, 12);
    const cupL = mesh(cupGeo, M.dark, -0.081, -0.005, 0.006), cupR = mesh(cupGeo, M.dark, 0.081, -0.005, 0.006);
    cupL.rotation.z = cupR.rotation.z = Math.PI / 2;
    const boom = mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.085, 5), M.dark, -0.058, -0.04, -0.055);
    boom.rotation.set(1.05, 0.5, 0);
    const mic = mesh(new THREE.SphereGeometry(0.008, 8, 6), M.dark, -0.026, -0.062, -0.092);
    const liner = mesh(new THREE.SphereGeometry(R - 0.004, 20, 14), M.liner);
    liner.scale.set(...SC);
    face.add(skull, neckSkin, nose, mouth, cap, cupL, cupR, boom, mic, liner);
    face.visible = false;
    // carcasa con ventana: sustituye a la esfera completa cuando la visera es transparente
    const shellOpen = new THREE.Group();
    shellOpen.add(
      mesh(new THREE.SphereGeometry(R, 32, 22, P0 + W, Math.PI * 2 - W), M.suit),
      mesh(new THREE.SphereGeometry(R, 14, 6, P0, W, 0, T0), M.suit),
      mesh(new THREE.SphereGeometry(R, 14, 10, P0, W, T0 + TL, Math.PI - T0 - TL), M.suit));
    shellOpen.scale.set(...SC);
    shellOpen.visible = false;
    head.add(shellOpen, shell, rim, visor, crest, pivL, pivR, lampL, lampR, beamL, beamR, camPod, face);
    torso.add(head);

    // ---- brazos: hombro -> codo -> guante ---------------------------------------------------------------
    const mkArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.286, 0.445, 0);
      const joint = mesh(new THREE.SphereGeometry(0.096, 16, 12), M.fabric);
      const upper = tube([[-0.01, 0.086], [-0.06, 0.082], [-0.16, 0.076], [-0.27, 0.07]], M.suit, 16, 0);
      const bearing = tube([[-0.118, 0.0835], [-0.142, 0.0825]], M.metal, 18, 0);       // rodamiento del brazo
      shoulder.add(joint, upper, bearing);
      if (side < 0) shoulder.add(tube([[-0.185, 0.0785], [-0.225, 0.0765]], M.accent, 18, 0));   // franja de identificacion
      const elbow = new THREE.Group();
      elbow.position.y = -0.31;
      const elbowJoint = mesh(new THREE.SphereGeometry(0.0715, 14, 10), M.fabric);
      const convo = new THREE.Mesh(loft(bellows(0.05, -0.06, 0.072, 0.069, 4, 0.006), 16, 0), M.fabric);
      const fore = tube([[-0.05, 0.069], [-0.12, 0.068], [-0.2, 0.06], [-0.262, 0.055]], M.suit, 16, 0);
      const wrist = tube([[-0.255, 0.059], [-0.262, 0.062], [-0.282, 0.062], [-0.29, 0.058]], M.metal, 18);
      // guante: guantelete, palma y dedos algo curvados (como quedan con el traje presurizado)
      const gaunt = tube([[-0.288, 0.05], [-0.31, 0.047]], M.glove, 14, 0);
      const palm = mesh(loft([{ y: -0.395, rx: 0.022, rz: 0.046, p: 3 }, { y: -0.345, rx: 0.027, rz: 0.049, p: 3 }, { y: -0.305, rx: 0.031, rz: 0.042, p: 2.4 }], 14), M.glove);
      elbow.add(elbowJoint, convo, fore, wrist, gaunt, palm);
      const f1 = new THREE.CapsuleGeometry(0.0125, 0.034, 3, 8), f2 = new THREE.CapsuleGeometry(0.0118, 0.026, 3, 8);
      [-0.034, -0.0115, 0.0115, 0.034].forEach((fz, i) => {
        const len = [0.92, 1, 0.97, 0.82][i];
        const a = mesh(f1, M.glove, -side * 0.006, -0.412, fz); a.rotation.z = -side * 0.28; a.scale.y = len;
        const b = mesh(f2, M.dark, -side * 0.026, -0.456 * (0.985 + 0.015 * len), fz); b.rotation.z = -side * 0.75; b.scale.y = len;
        elbow.add(a, b);
      });
      const th1 = mesh(new THREE.CapsuleGeometry(0.0145, 0.03, 3, 8), M.glove, -side * 0.008, -0.348, -0.058); th1.rotation.set(0.75, 0, -side * 0.25);
      const th2 = mesh(new THREE.CapsuleGeometry(0.0135, 0.02, 3, 8), M.dark, -side * 0.018, -0.376, -0.08); th2.rotation.set(0.45, 0, -side * 0.4);
      elbow.add(th1, th2);
      if (side < 0) {
        // lista de tareas y pantalla en el antebrazo izquierdo
        const pad = mesh(new THREE.BoxGeometry(0.02, 0.1, 0.075), M.panel, -0.066, -0.15, 0);
        const padGlow = mesh(new THREE.BoxGeometry(0.006, 0.075, 0.052), std("#7fd1ff", 0.4, 0, { emissive: "#7fd1ff", emissiveIntensity: 1.4 }), -0.078, -0.15, 0);
        elbow.add(pad, padGlow);
      } else {
        // espejo de muneca (para leer los controles del pecho)
        elbow.add(mesh(new THREE.BoxGeometry(0.008, 0.045, 0.05), M.metal, 0.066, -0.215, 0));
      }
      shoulder.add(elbow);
      shoulder.rotation.z = side * 0.1;
      torso.add(shoulder);
      return { shoulder, elbow };
    };
    const armL = mkArm(-1), armR = mkArm(1);

    // ---- piernas: cadera -> rodilla -> bota --------------------------------------------------------------
    const mkLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.105, 0.95, 0);
      const hipJoint = mesh(new THREE.SphereGeometry(0.1, 14, 10), M.fabric);
      const thigh = tube([[0.03, 0.097], [-0.08, 0.1], [-0.24, 0.092], [-0.4, 0.083]], M.suit, 18, 0);
      const stripe = tube([[-0.2, 0.0975], [-0.24, 0.0955]], M.accent, 18, 0);
      hip.add(hipJoint, thigh, stripe);
      if (side > 0) hip.add(mesh(new THREE.BoxGeometry(0.03, 0.13, 0.1), M.suit, 0.092, -0.2, -0.005));   // bolsillo del muslo
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      const kneeJoint = mesh(new THREE.SphereGeometry(0.084, 14, 10), M.fabric);
      const convo = new THREE.Mesh(loft(bellows(0.06, -0.075, 0.085, 0.082, 4, 0.007), 18, 0), M.fabric);
      const kneePad = mesh(new THREE.SphereGeometry(0.058, 12, 8), M.suitDusty, 0, -0.005, -0.062);
      kneePad.scale.set(1.05, 1.2, 0.5);
      const shin = tube([[-0.06, 0.082], [-0.16, 0.085, 0.006], [-0.28, 0.074, 0.004], [-0.37, 0.069]], M.suitDusty, 18, 0);
      // bota: polaina, empeine con puntera y suela con tacos
      const boot = mesh(loft([
        { y: -0.478, rx: 0.063, rz: 0.152, z: -0.046, p: 2.7 }, { y: -0.445, rx: 0.065, rz: 0.152, z: -0.046, p: 2.7 },
        { y: -0.418, rx: 0.063, rz: 0.136, z: -0.034, p: 2.5 }, { y: -0.395, rx: 0.062, rz: 0.098, z: -0.01, p: 2.3 },
        { y: -0.368, rx: 0.068, rz: 0.076 }, { y: -0.33, rx: 0.076, rz: 0.079 },
      ], 18), M.boot);
      const sole = mesh(loft([{ y: -0.51, rx: 0.066, rz: 0.156, z: -0.046, p: 3 }, { y: -0.5, rx: 0.07, rz: 0.16, z: -0.046, p: 3 }, { y: -0.476, rx: 0.069, rz: 0.158, z: -0.046, p: 3 }], 18), M.sole);
      const toe = mesh(new THREE.SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.sole, 0, -0.478, -0.15);
      toe.scale.set(1.02, 0.62, 0.75);
      knee.add(kneeJoint, convo, kneePad, shin, boot, sole, toe);
      hip.add(knee);
      g.add(hip);
      return { hip, knee };
    };
    const legL = mkLeg(-1), legR = mkLeg(1);

    g.add(torso);
    // solo las piezas grandes dan sombra (tornillos, franjas y luces no se ven en el mapa de sombras)
    g.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      o.castShadow = o.geometry.boundingSphere.radius >= 0.07 && o.material !== M.liner;
    });
    this.parts = { torso, head, pack, armL, armR, legL, legR, mastTip, mast, face, shell, shellOpen, rim, crest, lamps: [lampL, lampR, beamL, beamR] };
    // piezas que se muestran u ocultan segun la apariencia: no se fusionan (engine/merge.js)
    for (const o of [mastTip, mast, face, shell, shellOpen, rim, crest, lampL, lampR, beamL, beamR]) if (o) o.userData.dynamic = true;
    this.M = M;
    this._tint();
    this.body = g;
    this.root.add(g);
  }

  // Colores derivados del tejido: los fuelles son algo mas oscuros y de rodilla para abajo se pega el polvo de Marte
  _tint() {
    const M = this.M;
    M.cover.color.copy(M.suit.color);
    M.fabric.color.copy(M.suit.color).multiplyScalar(0.88);
    M.suitDusty.color.copy(M.suit.color).lerp(DUST, 0.3);
    M.boot.color.copy(M.suit.color).lerp(DUST, 0.5);
  }

  // Aplica la apariencia elegida en el perfil (colores del traje, visera, cara y accesorios)
  // Fusiona las piezas que se mueven juntas (menos llamadas de dibujo y de sombra). Recorre la marcha, el salto
  // y todos los gestos para detectar que nodos se animan, y deja al astronauta en reposo.
  optimize() {
    if (!this.parts || this._optimized) return null;
    this._optimized = true;
    const r = this.root;
    markAnimated(r, (i) => {
      const sp = [0, 1.2, 3, 6, 0.5, 2][i % 6];
      this.update(0.08, sp, 0, i % 3 ? 0 : 0.6, 0, i * 0.3, i % 3 === 0 ? 0.8 : 0, { grade: (i % 4) * 0.1, fatigue: (i % 5) / 5, load: 10 + i, chest: (i % 2) * 0.8, night: i % 2 });
      if (i === 5) this.land(4);
    }, 12);
    // gestos
    for (const name of Object.keys(EMOTES)) {
      const before = []; r.traverse((o) => before.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
      this.playEmote(name);
      for (let k = 0; k < 14; k++) this.update(0.12, 0, 0, 0, 0, 0, 0, {});
      for (const [o, p, q, sc] of before) if (o !== r && (p.distanceToSquared(o.position) > 1e-10 || Math.abs(q.dot(o.quaternion)) < 1 - 1e-7 || sc.distanceToSquared(o.scale) > 1e-10)) o.userData.animated = true;
      this.stopEmote();
      for (let k = 0; k < 30; k++) this.update(0.1, 0, 0, 0, 0, 0, 0, {});
      this.emote = null;
    }
    return mergeChildren(r, { minShadow: 0.1 });
  }

  setLook(look) {
    const l = sanitizeLook(look), O = LOOK_OPTIONS, M = this.M, p = this.parts;
    this.look = l;
    if (!M || !p) return;
    M.suit.color.set(O.suit[l.suit].hex);
    M.accent.color.set(this.opts.accent || O.accent[l.accent].hex);
    this._tint();
    const v = O.visor[l.visor];
    M.visor.color.set(v.hex);
    M.visor.emissive.set(v.emissive);
    M.visor.transparent = !!v.clear;
    M.visor.opacity = v.clear ? 0.28 : 1;
    M.visor.depthWrite = !v.clear;
    // visera reflectante (bano metalico) o burbuja transparente de policarbonato
    M.visor.metalness = v.clear ? 0.15 : 1;
    M.visor.roughness = v.clear ? 0.04 : 0.07;
    M.visor.emissiveIntensity = v.clear ? 0 : 0.18;
    this._visorEnv = v.clear ? 0.9 : 1.25;
    M.visor.envMapIntensity = this._visorEnv;
    M.visor.needsUpdate = true;
    M.skin.color.set(O.skin[l.skin].hex);
    p.face.visible = p.shellOpen.visible = !!v.clear;
    p.shell.visible = p.rim.visible = !v.clear;
    p.lamps.forEach((m) => (m.visible = l.lamps));
    p.mast.visible = p.mastTip.visible = l.antenna;
    p.crest.visible = l.crest;
  }

  // Complexion segun el perfil fisico: hombros y cintura algo mas anchos con mas IMC
  setBuild(mass, height) {
    const bmi = mass / (height / 100) ** 2;
    const w = Math.min(1.12, Math.max(0.9, Math.sqrt(bmi / 24.5)));
    this.root.scale.setScalar(height / 175);
    if (this.body) this.body.scale.set(w, 1, Math.sqrt(w));
  }

  // Empieza un gesto (o lo quita si es el mismo que ya esta en bucle). Devuelve true si empezo.
  playEmote(name) {
    if (!EMOTES[name] || !this.parts) return false;
    if (this.emote && this.emote.name === name && EMOTES[name].loop) { this.emote.ending = true; return false; }
    this.emote = { name, t: 0, w: this.emote ? this.emote.w : 0, ending: false };
    return true;
  }
  stopEmote() { if (this.emote) this.emote.ending = true; }

  // Mezcla la pose del gesto sobre la pose base (w = 0..1). Los brazos cuelgan hacia -y: rotation.x > 0 los
  // lleva hacia delante y rotation.z los abre hacia fuera (positivo en el derecho, negativo en el izquierdo).
  _applyEmote(dt, busy) {
    const e = this.emote, p = this.parts;
    if (!e) return;
    const def = EMOTES[e.name];
    e.t += dt;
    if (busy || (!def.loop && e.t > def.dur - 0.35)) e.ending = true;
    e.w = Math.max(0, Math.min(1, e.w + (e.ending ? -dt * (busy ? 9 : 3.5) : dt * 4)));
    if (e.ending && e.w <= 0) { this.emote = null; return; }
    const w = e.w * e.w * (3 - 2 * e.w), t = e.t;
    const set = (o, ax, v) => { o.rotation[ax] = lerp(o.rotation[ax], v, w); };
    const R = p.armR, Lf = p.armL;
    if (e.name === "wave") {
      set(R.shoulder, "z", 2.5); set(R.shoulder, "x", 0.1);
      set(R.elbow, "x", 0.5); set(R.elbow, "z", Math.sin(t * 8.5) * 0.55);
      set(p.torso, "z", -0.06); set(p.head, "y", 0); set(p.head, "z", 0.08);
    } else if (e.name === "thumbs") {
      set(R.shoulder, "x", 1.25); set(R.shoulder, "z", 0.25); set(R.elbow, "x", 1.05);
      set(p.head, "y", 0); set(p.head, "x", Math.max(0, Math.sin(t * 6)) * 0.18 * (t < 1.6 ? 1 : 0));
    } else if (e.name === "sit") {
      for (const leg of [p.legL, p.legR]) { set(leg.hip, "x", 1.9); set(leg.knee, "x", -2.0); }
      set(p.torso, "x", 0.22); set(p.torso, "y", 0);
      for (const a of [Lf, R]) { set(a.shoulder, "x", 0.95); set(a.elbow, "x", 0.55); }
      this.body.position.y = lerp(this.body.position.y, -0.56, w);
      set(p.head, "x", -0.12);
    } else if (e.name === "dance") {
      const b = t * 5.2, sw = Math.sin(b), sw2 = Math.sin(b * 0.5);
      set(p.torso, "y", sw2 * 0.45); set(p.torso, "z", sw * 0.08);
      set(R.shoulder, "z", 1.5 + sw * 0.6); set(R.elbow, "x", 1.0 + sw * 0.3);
      set(Lf.shoulder, "z", -1.5 + sw * 0.6); set(Lf.elbow, "x", 1.0 - sw * 0.3);
      set(p.legL.hip, "x", Math.max(0, sw) * 0.5); set(p.legL.knee, "x", -Math.max(0, sw) * 0.9);
      set(p.legR.hip, "x", Math.max(0, -sw) * 0.5); set(p.legR.knee, "x", -Math.max(0, -sw) * 0.9);
      set(p.head, "y", -sw2 * 0.3);
      // con el 38 % de gravedad cada saltito dura mas
      this.body.position.y = lerp(this.body.position.y, Math.abs(Math.sin(b * 0.5)) * 0.22, w);
    } else if (e.name === "hurt") {
      set(p.legL.hip, "x", 1.9); set(p.legL.knee, "x", -2.0);                 // pierna sana doblada
      set(p.legR.hip, "x", 1.5); set(p.legR.knee, "x", -0.15);                // pierna herida estirada
      set(p.torso, "x", 0.35 + Math.sin(t * 1.7) * 0.04); set(p.torso, "z", 0.06);
      for (const a of [Lf, R]) { set(a.shoulder, "x", 1.05); set(a.elbow, "x", 0.9); }
      set(R.shoulder, "z", 0.05); set(Lf.shoulder, "z", -0.25);
      this.body.position.y = lerp(this.body.position.y, -0.56, w);
      set(p.head, "x", 0.35); set(p.head, "y", Math.sin(t * 0.6) * 0.15);
    } else if (e.name === "stretch") {
      const u = Math.min(1, t / 1.1);
      for (const [a, sgn] of [[R, 1], [Lf, -1]]) { set(a.shoulder, "x", 2.9 * u); set(a.shoulder, "z", sgn * 0.35); set(a.elbow, "x", 0.15); }
      set(p.torso, "x", 0.16 * u + Math.sin(t * 2.2) * 0.03); set(p.head, "x", -0.2 * u); set(p.head, "y", 0);
      this.body.position.y = lerp(this.body.position.y, 0.05 * u, w);   // de puntillas
    }
  }

  // speed en m/s del mundo; el paso es un "salto" de baja gravedad (38 % de la terrestre)
  // air: metros sobre el suelo (0 = apoyado)
  // Golpe al aterrizar: las rodillas absorben el impacto (impact en m/s)
  land(impact) { this.squashV = (this.squashV || 0) + Math.min(3, impact * 0.4); }

  // opts: { grade (subida/avance), fatigue 0..1, load (kg ademas del traje), chest 0..1.4 (respiracion),
  //         night 0..1 (enciende las luces del casco) }
  update(dt, speed, x, y, z, heading, air = 0, opts = {}) {
    this.root.position.set(x, y, z);
    // giro suave hacia el rumbo (el juego cambia el rumbo de golpe) e inclinacion hacia la curva
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    if (this.yaw == null) this.yaw = heading;
    const dYaw = wrap(heading - this.yaw);
    this.yaw += dYaw * Math.min(1, dt * 11);
    this.root.rotation.y = this.yaw;
    if (this.mixer) {
      this.mixer.update(dt);
      return;
    }
    const p = this.parts;
    if (!p) return;
    this.clock += dt;
    const grade = Math.max(-0.6, Math.min(0.6, opts.grade || 0)), fat = Math.min(1, Math.max(0, opts.fatigue || 0));
    const load = opts.load || 0;
    const flying = air > 0.25;
    const moving = speed > 0.2 && !flying;
    this.gait = lerp(this.gait, moving ? Math.min(1, speed / 4.5) : 0, Math.min(1, dt * 6));
    this.fly = lerp(this.fly || 0, flying ? 1 : 0, Math.min(1, dt * 9));
    const k = this.gait, f = this.fly;
    // cadencia ligada a la velocidad sobre el suelo (los pies no patinan): en baja gravedad la zancada se alarga
    // y aparece una fase aerea ("lope" de las EVA lunares). phase avanza 1 por paso.
    const sc = this.root.scale.x || 1;
    const stepLen = (0.85 + 0.13 * speed) * sc * (1 - 0.25 * Math.max(0, grade)) * (1 - 0.15 * fat);
    const prev = this.phase;
    this.phase += dt * (moving ? speed / stepLen : 0.8 * k);
    if (moving && Math.floor(this.phase - 0.5) !== Math.floor(prev - 0.5) && this.onFootfall) this.onFootfall(Math.floor(this.phase) % 2 ? 1 : -1, speed);
    const a = this.phase * Math.PI;
    const s = Math.sin(a), c = Math.cos(a);
    const chest = opts.chest != null ? opts.chest : 0.3 + 0.3 * Math.sin(this.clock * 1.6);
    const swing = 0.62 * (1 - 0.3 * Math.max(0, grade)) * (1 - 0.2 * fat);

    // piernas: el muslo oscila y la rodilla se flexiona mientras la pierna avanza
    p.legL.hip.rotation.x = s * swing * k;
    p.legR.hip.rotation.x = -s * swing * k;
    p.legL.knee.rotation.x = -(0.08 + 0.85 * Math.max(0, c)) * k;
    p.legR.knee.rotation.x = -(0.08 + 0.85 * Math.max(0, -c)) * k;
    // brazos en contrafase, codos algo recogidos (el traje presurizado no deja estirarlos); con fatiga, menos braceo
    const arm = 0.5 * (1 - 0.45 * fat);
    p.armL.shoulder.rotation.x = -s * arm * k + 0.03 * chest * (1 - k);
    p.armR.shoulder.rotation.x = s * arm * k + 0.03 * chest * (1 - k);
    p.armL.elbow.rotation.x = 0.28 + 0.4 * k + 0.2 * Math.max(0, -s) * k;
    p.armR.elbow.rotation.x = 0.28 + 0.4 * k + 0.2 * Math.max(0, s) * k;
    // torso: se inclina hacia delante cuesta arriba y con carga, hacia atras cuesta abajo (frena), y respira
    const lean = (0.07 + 0.012 * speed) * k + grade * 0.75 * k + Math.min(0.12, load * 0.004) + 0.1 * fat;
    p.torso.rotation.x = -lean;
    p.torso.rotation.y = s * 0.09 * k;
    p.torso.rotation.z = c * 0.03 * k - Math.max(-0.12, Math.min(0.12, dYaw * 0.5)) * k;
    p.torso.position.y = 0.98 + 0.012 * chest * (1 - 0.6 * k);
    p.head.rotation.y = -s * 0.07 * k + Math.sin(this.clock * 0.45) * 0.22 * (1 - k);
    p.head.rotation.x = 0.06 * k + 0.16 * fat - grade * 0.25 * k;
    p.mastTip.material.emissiveIntensity = Math.sin(this.clock * 4) > 0.7 ? 3 : 0.3;   // baliza de la antena
    // luces del casco: se encienden al anochecer
    if (opts.night != null && this.M) {
      this.M.lamp.emissiveIntensity = 0.5 + 2.2 * opts.night;
      const dayK = 1 - 0.85 * Math.min(1, opts.night);                  // de noche el cielo ya no se refleja
      this.M.visor.envMapIntensity = (this._visorEnv || 1.25) * dayK;
      this.M.metal.envMapIntensity = 0.9 * dayK;
      p.lamps[2].visible = p.lamps[3].visible = this.look ? this.look.lamps && opts.night > 0.15 : opts.night > 0.15;
    }
    // en el aire (salto o caida lenta de baja gravedad): piernas recogidas y brazos abiertos para equilibrarse
    if (f > 0.01) {
      p.legL.hip.rotation.x = lerp(p.legL.hip.rotation.x, 0.5, f);
      p.legR.hip.rotation.x = lerp(p.legR.hip.rotation.x, 0.15, f);
      p.legL.knee.rotation.x = lerp(p.legL.knee.rotation.x, -0.9, f);
      p.legR.knee.rotation.x = lerp(p.legR.knee.rotation.x, -0.5, f);
      p.armL.shoulder.rotation.x = lerp(p.armL.shoulder.rotation.x, 0.5, f);
      p.armR.shoulder.rotation.x = lerp(p.armR.shoulder.rotation.x, 0.5, f);
      p.torso.rotation.x = lerp(p.torso.rotation.x, -0.08, f);
    }
    p.armL.shoulder.rotation.z = -0.1 - 0.75 * f;
    p.armR.shoulder.rotation.z = 0.1 + 0.75 * f;
    p.armL.elbow.rotation.z = p.armR.elbow.rotation.z = 0;
    p.head.rotation.z = 0;
    // rebote del paso: en baja gravedad cada paso tiene una fase aerea (mas alta cuanto mas rapido)
    const bob = Math.min(0.26, 0.05 + 0.028 * speed) * k;
    // amortiguacion del aterrizaje: muelle sub-amortiguado sobre las rodillas
    this.squashV = (this.squashV || 0) + (-(this.squash || 0) * 140 - (this.squashV || 0) * 14) * dt;
    this.squash = Math.max(-0.05, Math.min(0.3, (this.squash || 0) + this.squashV * dt));
    const sq = Math.max(0, this.squash);
    this.body.position.y = Math.pow(Math.abs(s), 0.8) * bob * (1 - f) - sq;
    if (sq > 0.005) {
      p.legL.hip.rotation.x += sq * 2.2; p.legR.hip.rotation.x += sq * 2.2;
      p.legL.knee.rotation.x -= sq * 4; p.legR.knee.rotation.x -= sq * 4;
      p.torso.rotation.x -= sq * 1.2;
    }
    // cojera (EVA-2 tras el rescate): la pierna derecha apenas se dobla y el cuerpo se balancea hacia ella
    if (this.limp && k > 0.05) {
      p.legR.hip.rotation.x *= 0.35;
      p.legR.knee.rotation.x *= 0.25;
      p.torso.rotation.z += Math.max(0, -s) * 0.12 * k;
      this.body.position.y *= 0.55;
    }
    // baliza de emergencia: parpadeo rapido mientras esta herido
    if (this.distress) p.mastTip.material.emissiveIntensity = Math.sin(this.clock * 14) > 0 ? 4 : 0.2;
    // gestos: se cancelan al caminar o saltar ("hurt" no: lo controla el juego)
    this._applyEmote(dt, (moving || flying) && !(this.emote && this.emote.name === "hurt"));
  }
}
