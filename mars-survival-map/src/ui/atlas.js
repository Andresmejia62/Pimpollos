// Atlas de Marte: mapa grande con tres niveles de datos reales y una sola proyeccion (equirectangular, lat/lon E):
//   1. Global  - MOLA (MGS) 8 pix/grado (~7,4 km/px)
//   2. Gale    - MOLA 64 pix/grado (~925 m/px)
//   3. Zona EVA - DTM HiRISE+CTX del juego (6 m/px) y ortoimagen CTX
// Incluye crateres, volcanes, misiones, fenomenos naturales con medidas de proteccion, traza de Curiosity,
// tu traza (tracking), regla de distancia de circulo maximo y perfil de elevacion.
import { t, getLang } from "../i18n.js";
import { assetUrl } from "../data.js";
import { Globe3D } from "./atlas3d.js";
import { canvas164, TEX_SIZE } from "./tex164.js";
import { HackFx } from "./hackfx.js";
import { typeName, typeIcon, pointFacts } from "../structinfo.js";
import { MARS_GEO, wrapLon, gcDistance, gcBearing, gcInterpolate, pressureAt, columnMass, boilingPointC, fmtLat, fmtLon, fmtDMS, fmtDist, num } from "../geo.js";

const $ = (id) => document.getElementById(id);
const D2R = Math.PI / 180;
const M_PER_DEG = MARS_GEO.R_mean * D2R;
const L = (es, en) => ({ es, en });
const PINS_KEY = "msm-atlas-pins-v1";
const norm = (v) => String(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Lee "lat, lon" escrito a mano: decimales con punto o coma, grados opcionales y hemisferio (N/S, E/O/W).
// Ejemplos: "-4.59, 137.44" · "4,59 S 137,44 E" · "4.59°S; 222.56°W". Devuelve {lat, lon} (lon Este 0-360) o null.
export function parseCoords(text) {
  let q = String(text).trim().replace(/[−–]/g, "-");
  if (!q) return null;
  let parts = q.split(/\s*;\s*|,\s+|\s+(?=[-+\d])/).filter(Boolean);
  if (parts.length === 1 && (q.match(/,/g) || []).length === 1) parts = q.split(",");
  // "4,59 S 137,44 E": el hemisferio queda pegado al numero anterior
  if (parts.length !== 2) {
    const m = q.match(/^([-+]?\d+(?:[.,]\d+)?)\s*°?\s*([NSns])?[\s,;]+([-+]?\d+(?:[.,]\d+)?)\s*°?\s*([EeWwOo])?$/);
    if (!m) return null;
    parts = [m[1] + (m[2] || ""), m[3] + (m[4] || "")];
  }
  const one = (p) => {
    const m = p.trim().match(/^([-+]?\d+(?:[.,]\d+)?)\s*°?\s*([A-Za-z])?$/);
    if (!m) return null;
    return { v: parseFloat(m[1].replace(",", ".")), h: (m[2] || "").toUpperCase() };
  };
  const a = one(parts[0]), b = one(parts[1]);
  if (!a || !b || (a.h && !"NS".includes(a.h)) || (b.h && !"EWO".includes(b.h))) return null;
  const lat = a.h === "S" ? -Math.abs(a.v) : a.v;
  const lon = b.h === "W" || b.h === "O" ? 360 - Math.abs(b.v) : b.v;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 360) return null;
  return { lat, lon: wrapLon(lon) };
}

const RAMPS = {
  hypso: [[-8200, "#1a237e"], [-6000, "#1565c0"], [-4000, "#26a69a"], [-2000, "#66bb6a"], [0, "#d4e157"], [2000, "#ffca28"], [4000, "#ff7043"], [8000, "#c62828"], [14000, "#8d6e63"], [21200, "#ffffff"]],
  mars: [[-8200, "#2e160d"], [-4000, "#6e3418"], [0, "#a8572a"], [4000, "#c97c45"], [10000, "#dca46f"], [21200, "#f3dcb8"]],
  pressure: [[60, "#440154"], [150, "#3b528b"], [300, "#21918c"], [611.657, "#5ec962"], [1250, "#fde725"]],
};
const MODES = { hypso: L("Relieve (MOLA)", "Relief (MOLA)"), mars: L("Tono marciano", "Mars tone"), pressure: L("Presión superficial", "Surface pressure") };
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function rampLUT(stops, lo, hi, n = 1024, log = false) {
  const s = stops.map(([v, c]) => [log ? Math.log(v) : v, hex(c)]);
  const a = log ? Math.log(lo) : lo, b = log ? Math.log(hi) : hi;
  const lut = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = a + ((b - a) * i) / (n - 1);
    let k = 0;
    while (k < s.length - 2 && v > s[k + 1][0]) k++;
    const f = Math.max(0, Math.min(1, (v - s[k][0]) / (s[k + 1][0] - s[k][0])));
    for (let j = 0; j < 3; j++) lut[i * 3 + j] = s[k][1][j] + f * (s[k + 1][1][j] - s[k][1][j]);
  }
  return { lut, n, a, b, log };
}

// Relieve HRSC+MOLA 200 m e imagen THEMIS de dia 100 m de la zona que rodea el recorte EVA
// (public/atlas/region.json, generado por data/scripts/fetch_region.py). Se pinta a la resolucion de la
// imagen: el color sale del DEM (como el resto del atlas) y THEMIS aporta el detalle real de la superficie.
async function loadRegion() {
  const meta = await fetch(assetUrl("atlas/region.json")).then((r) => { if (!r.ok) throw new Error("region"); return r.json(); });
  const d = meta.dem;
  const raw = new Int16Array(await fetch(assetUrl("atlas/" + d.file)).then((r) => r.arrayBuffer()));
  const elev = new Float32Array(d.w * d.h);
  let last = 0;
  for (let i = 0; i < elev.length; i++) { const v = raw[i]; elev[i] = v === d.nodata ? last : (last = v); }
  const img = new Image();
  // (img.decode() no siempre se resuelve en algunos navegadores incrustados: se espera al evento load)
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = assetUrl("atlas/" + meta.image.file); });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const cx = c.getContext("2d");
  cx.drawImage(img, 0, 0);
  const photo = cx.getImageData(0, 0, c.width, c.height).data;
  return { id: "region", ...d, elev, canvas: document.createElement("canvas"), photo, image: meta.image, meta };
}

async function loadRaster(meta, offset) {
  const r = await fetch(assetUrl("atlas/" + meta.file));
  if (!r.ok) throw new Error(`atlas/${meta.file}: ${r.status}`);
  const buf = new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  const { w, h, q } = meta, n = w * h;
  const elev = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    let prev = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const z = (buf[i] << 8) | buf[n + i];
      prev += z & 1 ? -((z + 1) >> 1) : z >> 1;
      elev[i] = prev * q - offset;
    }
  }
  return { ...meta, elev, canvas: document.createElement("canvas") };
}

export class Atlas {
  constructor({ game, world, geo, data }) {
    this.game = game; this.world = world; this.geo = geo; this.data = data;
    this.isOpen = false;
    this.mode = "mars";      // tono marciano por defecto
    this.show = { grid: true, crater: true, volcano: true, region: true, canyon: true, polar: true, lander: true, phenomena: true, msl: true, drills: true, track: true, objectives: true, structs: true, overlay: true };
    this.view = { lon: 137.8, lat: -5.0, s: 4 };
    this.measure = null;     // { a: {lat,lon}, b: {lat,lon} }
    this.measuring = false;
    this.selected = null;
    this.hover = null;
    this.hits = [];
    this.profileMode = "track";
    this.pins = [];          // marcadores del usuario: { id, name, lat, lon } (se guardan en el navegador)
    try { const saved = JSON.parse(localStorage.getItem(PINS_KEY) || "[]"); if (Array.isArray(saved)) this.pins = saved.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)); } catch (e) { /* sin almacenamiento */ }
    this.hoverHit = null;
    this.is3d = true;        // globo 3D por defecto; el boton 3D vuelve al mapa plano
    this.g3 = null;
    this.ready = this._load();
    this._bindDom();
  }

  async _load() {
    const J = (p) => fetch(assetUrl(p)).then((r) => r.json());
    const [meta, feat, trav, drills] = await Promise.all([J("atlas/atlas.json"), J("atlas/features.json"), J("atlas/msl_traverse.json"), J("atlas/msl_drills.json")]);
    this.meta = meta; this.feat = feat; this.trav = trav.points; this.drills = drills.drills;
    const [g, gale] = await Promise.all(meta.rasters.map((m) => loadRaster(m, meta.offset_m)));
    this.rGlobal = g; this.rGale = gale;
    this.rRegion = await loadRegion().catch(() => null);      // ~60 km alrededor de la zona EVA (opcional)
    this.optical = new Image(); this.optical.src = assetUrl("layers/optical.png");
    this.overlays = {};
    ["slope", "radiation", "thermal", "spectral"].forEach((k) => { const im = new Image(); im.src = assetUrl(`layers/${k}_overlay.png`); this.overlays[k] = im; });
    this.optical.onload = () => this.dirty = true;
    this._shade(this.rGlobal, 11);     // (con 18 los flancos de los volcanes quedaban negros)
    this._shade(this.rGale, 4);
    if (this.rRegion) this._shade(this.rRegion, 2);
    this._paint();
    this._buildSide();
    this._buildSearch();
    this.dirty = true;
  }

  // relieve sombreado (luz del NO a 45°) con exageracion vertical
  _shade(r, exag) {
    const { w, h, elev, ppd } = r;
    const sh = new Float32Array(w * h);
    const dy = M_PER_DEG / ppd;
    const lx = -Math.SQRT1_2 * Math.SQRT1_2, ly = Math.SQRT1_2 * Math.SQRT1_2, lz = Math.SQRT1_2;
    for (let y = 0; y < h; y++) {
      const lat = r.lat_north - (y + 0.5) / ppd;
      const dx = Math.max(dy * 0.05, dy * Math.cos(lat * D2R));
      const yu = Math.max(0, y - 1), yd = Math.min(h - 1, y + 1);
      for (let x = 0; x < w; x++) {
        const xl = x > 0 ? x - 1 : (r.id === "global" ? w - 1 : 0), xr = x < w - 1 ? x + 1 : (r.id === "global" ? 0 : w - 1);
        const gx = ((elev[y * w + xr] - elev[y * w + xl]) * exag) / (2 * dx);
        const gy = ((elev[yu * w + x] - elev[yd * w + x]) * exag) / ((yd - yu) * dy);
        const nl = Math.hypot(gx, gy, 1);
        sh[y * w + x] = Math.max(0, (-gx * lx + -gy * -ly + lz) / nl);
      }
    }
    r.shade = sh;
  }

  _paint() {
    const lut = this.mode === "pressure" ? rampLUT(RAMPS.pressure, 60, 1250, 1024, true) : rampLUT(RAMPS[this.mode], -8200, 21200);
    for (const r of [this.rGlobal, this.rGale]) {
      const { w, h, elev, shade } = r;
      const c = r.canvas; c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      const img = ctx.createImageData(w, h), px = img.data;
      const P = this.mode === "pressure";
      for (let i = 0; i < w * h; i++) {
        const v = P ? pressureAt(elev[i]) : elev[i];
        const tv = lut.log ? Math.log(Math.max(1, v)) : v;
        const k = Math.max(0, Math.min(lut.n - 1, Math.round(((tv - lut.a) / (lut.b - lut.a)) * (lut.n - 1)))) * 3;
        const s = P ? 0.55 + 0.45 * shade[i] : this.mode === "mars" ? 0.36 + 0.7 * shade[i] : 0.4 + 0.65 * shade[i];   // suelo alto: las laderas a contraluz no quedan negras
        px[i * 4] = Math.min(255, lut.lut[k] * s); px[i * 4 + 1] = Math.min(255, lut.lut[k + 1] * s); px[i * 4 + 2] = Math.min(255, lut.lut[k + 2] * s); px[i * 4 + 3] = 255;
      }
      if (P) {
        // isolinea del punto triple del agua (611,7 Pa, h ~ -30 m): por encima de ella el agua liquida es imposible
        const hT = -MARS_GEO.H * Math.log(MARS_GEO.triple_pa / MARS_GEO.P0);
        for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
          const i = y * w + x, a = elev[i] < hT;
          if (a !== elev[i + 1] < hT || a !== elev[i + w] < hT) { px[i * 4] = 255; px[i * 4 + 1] = 255; px[i * 4 + 2] = 255; }
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    if (this.rRegion) this._paintRegion(lut);
    this._legend();
    if (this.g3) this.g3.texturesChanged();
    this.dirty = true;
  }

  // Zona de ~60 km: color de la rampa segun el DEM (200 m) y brillo de THEMIS (100 m) para el detalle real
  _paintRegion(lut) {
    const r = this.rRegion, im = r.image, W = im.w, H = im.h;
    const c = r.canvas; c.width = W; c.height = H;
    const ctx = c.getContext("2d"), out = ctx.createImageData(W, H), px = out.data;
    const P = this.mode === "pressure";
    for (let y = 0; y < H; y++) {
      const lat = im.lat_north - (y + 0.5) / im.ppd;
      const dy = Math.max(0, Math.min(r.h - 1, Math.round((r.lat_north - lat) * r.ppd - 0.5)));
      for (let x = 0; x < W; x++) {
        const lon = im.lon_west + (x + 0.5) / im.ppd;
        const dx = Math.max(0, Math.min(r.w - 1, Math.round((lon - r.lon_west) * r.ppd - 0.5)));
        const di = dy * r.w + dx, e = r.elev[di];
        const v = P ? pressureAt(e) : e;
        const tv = lut.log ? Math.log(Math.max(1, v)) : v;
        const k = Math.max(0, Math.min(lut.n - 1, Math.round(((tv - lut.a) / (lut.b - lut.a)) * (lut.n - 1)))) * 3;
        const t = r.photo[(y * W + x) * 4] / 255;                // THEMIS: 0 oscuro .. 1 claro
        const s = (P ? 0.55 + 0.45 * r.shade[di] : 0.45 + 0.55 * r.shade[di]) * (0.45 + 0.9 * t);
        const o = (y * W + x) * 4;
        px[o] = Math.min(255, lut.lut[k] * s); px[o + 1] = Math.min(255, lut.lut[k + 1] * s); px[o + 2] = Math.min(255, lut.lut[k + 2] * s); px[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  }

  // Crea el globo 3D la primera vez que hace falta (necesita MOLA y la ortoimagen ya cargadas)
  async _ensure3d() {
    if (this.g3 || this._making3d) return;
    this._making3d = true;
    await this.ready;
    if (!this.optical.complete) await new Promise((res) => { this.optical.addEventListener("load", res, { once: true }); this.optical.addEventListener("error", res, { once: true }); });
    try {
      const g3 = new Globe3D($("atlasGl"));
      g3.build(this.rGlobal, this.rGale, { bounds: this.geo.bounds, n: this.world.n, h: this.world.h, yRef: this.world.yRef, image: this.optical, sizeM: this.world.size }, this.rRegion);
      const v = this.view;
      g3.cam.lat = v.lat; g3.cam.lon = v.lon;
      this.g3 = g3;
      this._resize();
    } catch (e) {
      // sin WebGL: se queda el mapa plano
      console.warn("Atlas 3D no disponible:", e);
      this.is3d = false; this._sync3dUi();
    }
    this._making3d = false;
    this.dirty = true;
  }
  get on3d() { return this.is3d && this.g3 && this.g3.built; }
  _elevFn() { return this._ef || (this._ef = (la, lo) => { const e = this.elevAt(la, lo); return e ? e.elev : 0; }); }
  _sync3dUi() {
    $("atlasGl").hidden = !this.is3d;
    $("atlas3d").setAttribute("aria-pressed", String(this.is3d));
    $("atlasExag").hidden = !this.is3d;
    $("atlasCompass").hidden = !this.is3d;
    this._hint();
  }
  set3d(on) {
    this.is3d = on;
    this._sync3dUi();
    if (on) {
      this._ensure3d().then(() => { if (this.g3) { const v = this.view; Object.assign(this.g3.cam, { lat: v.lat, lon: v.lon, alt: this.g3.altForS(Math.max(v.s, 1)), tilt: v.s > 60 ? 50 : 0, heading: 0 }); this.dirty = true; } });
    } else this._clampView();
    this.dirty = true;
  }

  // ---- DOM y controles ------------------------------------------------------------
  _bindDom() {
    this.cv = $("atlasCanvas");
    this.ctx = this.cv.getContext("2d");
    this.pcv = $("atlasProfile");
    const cv = this.cv;
    let drag = null, moved = 0, orbit = false;
    const touches = new Map();
    let pinch = 0;
    cv.addEventListener("pointerdown", (e) => {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      orbit = e.button === 2 || e.ctrlKey || e.altKey;      // en 3D: girar e inclinar la vista
      this._fly = (this._fly || 0) + 1;
      drag = [e.clientX, e.clientY]; moved = 0; pinch = 0; cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    cv.addEventListener("pointercancel", (e) => { touches.delete(e.pointerId); drag = null; });
    cv.addEventListener("pointermove", (e) => {
      const p = this._evt(e);
      this.hover = this.unproject(p.x, p.y);
      this._hoverAt(p, !!drag);
      if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
      // dos dedos: pellizco = zoom alrededor del punto medio; en el globo 3D, ademas, girar los dedos = rumbo y
      // deslizarlos juntos en vertical = inclinacion (lo que en el ordenador es boton derecho o Ctrl + arrastrar)
      if (touches.size === 2) {
        const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), my = (a[1] + b[1]) / 2;
        const r = this.cv.getBoundingClientRect();
        if (pinch) {
          this.zoomAt((a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top, d / pinch);
          if (this.on3d && this._two) {
            let da = ang - this._two.ang;
            da = Math.atan2(Math.sin(da), Math.cos(da));
            this.g3.cam.heading = (this.g3.cam.heading - (da * 180) / Math.PI + 360) % 360;
            this.g3.cam.tilt = Math.max(0, Math.min(80, this.g3.cam.tilt - (my - this._two.my) * 0.35));
          }
        }
        this._two = { ang, my };
        pinch = d; moved = 99; drag = null;
        this.dirty = true;
        return;
      }
      this._two = null;
      if (drag) {
        const dx = e.clientX - drag[0], dy = e.clientY - drag[1];
        moved += Math.abs(dx) + Math.abs(dy);
        if (this.on3d) { if (orbit) this.g3.orbit(dx, dy); else this.g3.pan(dx, dy); }
        else { this.view.lon -= dx / this.view.s; this.view.lat += dy / this.view.s; this._clampView(); }
        drag = [e.clientX, e.clientY];
      }
      this._readout();
      this.dirty = true;
    });
    cv.addEventListener("pointerup", (e) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) this._two = null;
      if (drag && moved < 5 && !orbit) this._click(this._evt(e), e.shiftKey);
      drag = null;
    });
    $("atlas3d").onclick = () => this.set3d(!this.is3d);
    // Vista de suelo (ui/explore3d.js): el siguiente clic dentro de la zona EVA baja a ese punto
    $("atlasStreet").onclick = () => { this.svPick = !this.svPick; this._syncStreetUi(); this._hint(); };
    // brujula del globo 3D: clic = norte arriba (con la misma inclinacion)
    $("atlasCompass").onclick = () => {
      if (!this.on3d) return;
      const c = this.g3.cam, h0 = ((c.heading + 540) % 360) - 180, t0 = performance.now(), id = (this._fly = (this._fly || 0) + 1);
      const step = (now) => { if (id !== this._fly) return; const u = Math.min(1, (now - t0) / 450), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2; c.heading = (h0 * (1 - e) + 360) % 360; this.dirty = true; if (u < 1 && this.isOpen) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    };
    // paneles deslizantes en pantallas pequenas (capas, informacion, perfil): uno abierto a la vez
    document.querySelectorAll("#scrAtlas [data-drawer]").forEach((b) => { b.onclick = () => this.drawer(b.dataset.drawer); });
    $("atlasExag").onchange = (e) => { if (this.g3) this.g3.exagMode = e.target.value; this.dirty = true; };
    $("atlasZoomIn").onclick = () => this.zoomAt(this.W / 2, this.H / 2, 1.8);
    $("atlasZoomOut").onclick = () => this.zoomAt(this.W / 2, this.H / 2, 1 / 1.8);
    cv.addEventListener("pointerleave", () => { this.hover = null; this.hoverHit = null; this.cursor = null; $("atlasTip").hidden = true; this._readout(); this.dirty = true; });
    // doble clic: acercarse a ese punto
    cv.addEventListener("dblclick", (e) => {
      const p = this._evt(e), ll = this.unproject(p.x, p.y);
      if (!ll) return;
      if (this.on3d) this.flyTo(ll.lat, ll.lon, this.view.s * 2.4); else this.zoomAt(p.x, p.y, 2.4);
    });
    // buscador: coordenadas o nombre de un lugar
    $("atlasSearchForm").addEventListener("submit", (e) => { e.preventDefault(); this.search($("atlasSearch").value); });
    $("atlasSearch").addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); $("atlasSearch").blur(); this.cv.focus(); }
      e.stopPropagation();           // escribir (una "m", un "+") no debe cerrar el atlas ni hacer zoom
    });
    $("atlasSearch").addEventListener("input", () => { $("atlasSearchMsg").hidden = true; });
    cv.tabIndex = 0;
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = this._evt(e);
      this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    $("atlasClose").onclick = () => this.close();
    document.querySelectorAll("#scrAtlas [data-go]").forEach((b) => { b.onclick = () => this.go(b.dataset.go); });
    $("atlasMode").onchange = (e) => { this.mode = e.target.value; this._paint(); };
    $("atlasMeasure").onclick = () => { this.measuring = !this.measuring; this.measure = null; $("atlasMeasure").setAttribute("aria-pressed", String(this.measuring)); this._hint(); this.dirty = true; };
    $("atlasExport").onclick = () => this.exportCSV();
    document.querySelectorAll("#scrAtlas [data-prof]").forEach((b) => { b.onclick = () => { this.profileMode = b.dataset.prof; this._profile(); }; });
    window.addEventListener("resize", () => { if (this.isOpen) { this._resize(); this._profile(); } });
    window.addEventListener("keydown", (e) => {
      if (!this.isOpen) return;
      const tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "+" || e.key === "=") this.zoomAt(this.W / 2, this.H / 2, 1.5);
      if (e.key === "-") this.zoomAt(this.W / 2, this.H / 2, 1 / 1.5);
      // flechas: desplazar el mapa; Inicio: ir a tu posicion; "/": escribir en el buscador
      const arrows = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (arrows) { e.preventDefault(); this._nudge(arrows[0] * 70, arrows[1] * 70); }
      if (e.key === "Home") { e.preventDefault(); this.go("me"); }
      if (e.key === "/") { e.preventDefault(); $("atlasSearch").focus(); $("atlasSearch").select(); }
    });
  }

  _syncStreetUi() {
    $("atlasStreet").setAttribute("aria-pressed", String(!!this.svPick));
    $("atlasStreet").title = t(L("Vista de suelo: haz clic en un punto de la zona EVA para verlo a la altura de los ojos", "Street View: click a point in the EVA zone to see it at eye level"));
    $("atlasCompass").title = t(L("Brújula: clic para poner el norte arriba", "Compass: click to put north up"));
    this.cv.style.cursor = this.svPick ? "cell" : "";
  }
  _evt(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  // desplaza la vista (dx, dy) pixeles, como si se arrastrara el mapa
  _nudge(dx, dy) {
    this._fly = (this._fly || 0) + 1;
    if (this.on3d) this.g3.pan(dx, dy);
    else { this.view.lon -= dx / this.view.s; this.view.lat += dy / this.view.s; this._clampView(); }
    this.dirty = true;
  }

  // nombre de lo que hay bajo un simbolo del mapa
  _hitName(it) {
    if (it.kind === "feature") return t(it.f.name);
    if (it.kind === "phenomenon") return `${t(it.ph.name)} · ${t(it.zone.label)}`;
    if (it.kind === "drill") return `${it.d.name} · sol ${it.d.sol}`;
    if (it.kind === "objective") return t(it.o.name);
    if (it.kind === "struct") return `${typeIcon(it.e)} ${t(it.e.name)}`;
    if (it.kind === "pin") return it.pin.name;
    if (it.kind === "player") return t(L("Tu posición", "Your position"));
    return "";
  }

  // Cursor sobre el mapa: resalta el simbolo que hay debajo y muestra una etiqueta flotante con el nombre,
  // las coordenadas y la elevacion del punto
  _hoverAt(p, dragging) {
    this.cursor = p;
    let best = null, bd = Infinity;
    if (!dragging) for (const h of this.hits) { const d = Math.hypot(h.x - p.x, h.y - p.y); if (d < h.r + 3 && d < bd) { bd = d; best = h; } }
    this.hoverHit = best;
    this.cv.style.cursor = dragging ? "grabbing" : best ? "pointer" : this.measuring ? "crosshair" : "grab";
    const tip = $("atlasTip"), ll = this.hover;
    if (dragging || !ll) { tip.hidden = true; return; }
    const e = this.elevAt(ll.lat, ll.lon), lang = getLang();
    tip.innerHTML = `${best ? `<b>${this._hitName(best.item)}</b>` : ""}${fmtLat(ll.lat, 4)} · ${fmtLon(ll.lon, 4)}${e ? ` <i>· ${num(e.elev, 0, lang)} m</i>` : ""}`;
    tip.hidden = false;
    // junto al cursor, sin salirse del mapa
    const w = tip.offsetWidth, hgt = tip.offsetHeight;
    tip.style.left = Math.max(6, Math.min(this.W - w - 6, p.x + 16)) + "px";
    tip.style.top = Math.max(6, p.y + 18 + hgt > this.H ? p.y - hgt - 12 : p.y + 18) + "px";
  }

  // ---- buscador -----------------------------------------------------------------------------
  _searchIndex() {
    const out = [];
    for (const f of this.feat.features) out.push({ name: t(f.name), lat: f.lat, lon: f.lon, sel: { f }, km: f.d_km || 60 });
    for (const d of this.drills) out.push({ name: `${d.name} (sol ${d.sol})`, lat: d.lat, lon: d.lon, sel: { kind: "drill", d }, km: 0.4 });
    for (const o of this.data.objectives.objectives) out.push({ name: t(o.name), lat: o.latlon[0], lon: o.latlon[1], sel: { kind: "objective", o }, km: 0.6 });
    for (const e of (this.data.structures && this.data.structures.structures) || []) {
      const ll = this.geo.toLatLon(e.x, e.z);
      out.push({ name: t(e.name), lat: ll.lat, lon: ll.lon, sel: { kind: "struct", e, ll }, km: 0.3 });
    }
    for (const pin of this.pins) out.push({ name: pin.name, lat: pin.lat, lon: pin.lon, sel: { kind: "pin", pin }, km: 2 });
    return out;
  }
  _buildSearch() {
    const inp = $("atlasSearch");
    inp.placeholder = t(L("Buscar: «Olympus Mons» o «-4.59, 137.44»   ( / )", "Search: \"Olympus Mons\" or \"-4.59, 137.44\"   ( / )"));
    $("atlasSearchGo").textContent = t(L("Ir", "Go"));
    if (this.feat) $("atlasSearchList").innerHTML = this._searchIndex().map((x) => `<option value="${x.name.replace(/"/g, "&quot;")}"></option>`).join("");
  }
  // Va a unas coordenadas o al lugar cuyo nombre coincide. Devuelve true si encontro algo.
  search(text) {
    const q = String(text).trim(), msg = $("atlasSearchMsg");
    msg.hidden = true;
    if (!q || !this.feat) return false;
    const fit = (km) => Math.min(this.W, this.H) / (km * 2.2 * 1000 / M_PER_DEG);
    const ll = parseCoords(q);
    if (ll) {
      this.selected = { kind: "point", ll };
      this.flyTo(ll.lat, ll.lon, Math.max(this.view.s, fit(40)));
      this._info(); this.dirty = true;
      return true;
    }
    const n = norm(q), idx = this._searchIndex();
    const hit = idx.find((x) => norm(x.name) === n) || idx.find((x) => norm(x.name).startsWith(n)) || idx.find((x) => norm(x.name).includes(n));
    if (!hit) {
      msg.textContent = t(L("Sin resultados. Escribe un nombre del mapa o coordenadas como «-4.59, 137.44» (latitud, longitud Este).", "No results. Type a place on the map or coordinates such as \"-4.59, 137.44\" (latitude, East longitude)."));
      msg.hidden = false;
      return false;
    }
    this.selected = hit.sel;
    if (hit.sel.f) this.show[hit.sel.f.cat] = true;
    this.flyTo(hit.lat, hit.lon, Math.max(fit(hit.km), hit.km < 5 ? 3000 : 0));
    this._info(); this.dirty = true;
    return true;
  }

  // ---- marcadores del usuario ---------------------------------------------------------------
  _savePins() { try { localStorage.setItem(PINS_KEY, JSON.stringify(this.pins)); } catch (e) { /* sin almacenamiento */ } this._buildSearch(); }
  addPin(lat, lon, name) {
    const pin = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name || `${t(L("Marcador", "Pin"))} ${this.pins.length + 1}`, lat, lon: wrapLon(lon) };
    this.pins.push(pin);
    this._savePins();
    this.selected = { kind: "pin", pin };
    this._info(); this.dirty = true;
    return pin;
  }
  removePin(id) {
    this.pins = this.pins.filter((p) => p.id !== id);
    if (this.selected && this.selected.kind === "pin" && this.selected.pin.id === id) this.selected = null;
    this._savePins();
    this._info(); this.dirty = true;
  }
  _pins() {
    const ctx = this.ctx;
    for (const pin of this.pins) {
      const p = this.project(pin.lat, pin.lon);
      if (Number.isNaN(p.x) || p.x < -40 || p.x > this.W + 40 || p.y < -40 || p.y > this.H + 40) continue;
      const sel = this.selected && this.selected.kind === "pin" && this.selected.pin.id === pin.id;
      // chincheta: gota con la punta en el lugar exacto
      ctx.fillStyle = sel ? "#ffffff" : "#FF8A3D"; ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.bezierCurveTo(p.x - 11, p.y - 14, p.x - 8, p.y - 26, p.x, p.y - 26); ctx.bezierCurveTo(p.x + 8, p.y - 26, p.x + 11, p.y - 14, p.x, p.y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#1a0f0a"; ctx.beginPath(); ctx.arc(p.x, p.y - 17, 3.2, 0, 7); ctx.fill();
      this.hits.push({ x: p.x, y: p.y - 14, r: 14, item: { kind: "pin", pin } });
      this._label(pin.name, p.x + 11, p.y - 16, "#FFB27A", false, 13, sel ? 96 : 80);
    }
  }
  // lineas de mira en el mapa plano, con la latitud y la longitud en los bordes, y aro en el simbolo bajo el cursor
  _cursorMarks() {
    const ctx = this.ctx, c = this.cursor, h = this.hoverHit;
    if (h) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.beginPath(); ctx.arc(h.x, h.y, h.r + 4, 0, 7); ctx.stroke(); }
    if (!c || !this.hover || this.on3d) return;
    ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(c.x, 0); ctx.lineTo(c.x, this.H); ctx.moveTo(0, c.y); ctx.lineTo(this.W, c.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = "600 12px Rajdhani, sans-serif";
    const lat = fmtLat(this.hover.lat, 3), lon = fmtLon(this.hover.lon, 3);
    const tag = (txt, x, y) => { const w = ctx.measureText(txt).width + 10; ctx.fillStyle = "rgba(12,10,14,.85)"; ctx.fillRect(x, y - 13, w, 17); ctx.fillStyle = "#7FD1FF"; ctx.fillText(txt, x + 5, y); };
    tag(lat, this.W - ctx.measureText(lat).width - 16, Math.max(16, Math.min(this.H - 60, c.y - 4)));
    tag(lon, Math.max(4, Math.min(this.W - 90, c.x + 6)), this.H - 46);
  }
  _resize() {
    const r = this.cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = r.width; this.H = r.height; this.dpr = dpr;
    this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
    if (this.g3 && r.width > 0) this.g3.setSize(r.width, r.height, dpr);
    this._clampView();
    this.dirty = true;
  }
  get minS() { return Math.min(this.W / 360, this.H / 180) * 0.98; }
  _clampView() {
    const v = this.view;
    v.s = Math.max(this.minS || 1, Math.min(200000, v.s));
    const halfLat = this.H / 2 / v.s;
    v.lat = halfLat >= 90 ? 0 : Math.max(-90 + halfLat, Math.min(90 - halfLat, v.lat));
    v.lon = wrapLon(v.lon);
  }
  project(lat, lon) {
    if (this.on3d) return this.g3.project(lat, lon, this._elevFn()(lat, lon));
    const v = this.view;
    let dl = lon - v.lon;
    if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
    return { x: this.W / 2 + dl * v.s, y: this.H / 2 - (lat - v.lat) * v.s };
  }
  unproject(x, y) {
    if (this.on3d) return this.g3.unproject(x, y, this._elevFn());
    const v = this.view;
    const lat = v.lat - (y - this.H / 2) / v.s;
    if (lat > 90 || lat < -90) return null;
    return { lat, lon: wrapLon(v.lon + (x - this.W / 2) / v.s) };
  }
  zoomAt(x, y, k) {
    if (this.on3d) { this._fly = (this._fly || 0) + 1; this.g3.zoom(k); this.dirty = true; return; }
    const before = this.unproject(x, y);
    this.view.s *= k;
    this._clampView();
    if (before) {
      const after = this.unproject(x, y);
      if (after) {
        let dl = before.lon - after.lon; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
        this.view.lon += dl; this.view.lat += before.lat - after.lat;
        this._clampView();
      }
    }
    this.dirty = true;
  }
  // En 3D: s (px/°) se traduce a altura de camara; opts = { alt, tilt } para fijarlas
  flyTo(lat, lon, s, opts = {}) {
    if (this.on3d) {
      const c = this.g3.cam, a = { ...c }, t0 = performance.now(), dur = opts.dur || 1100, id = (this._fly = (this._fly || 0) + 1);
      const alt = opts.alt ?? this.g3.altForS(s);
      const tilt = opts.tilt ?? (alt > 0.6 ? 0 : alt > 0.05 ? 35 : 55);
      let dl = lon - a.lon; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
      let dh = -a.heading; if (dh < -180) dh += 360;
      const step = (now) => {
        if (id !== this._fly) return;                     // el usuario movio la vista: se cancela el vuelo
        const u = Math.min(1, (now - t0) / dur), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
        c.lon = a.lon + dl * e; c.lat = a.lat + (lat - a.lat) * e;
        c.alt = Math.exp(Math.log(a.alt) + (Math.log(alt) - Math.log(a.alt)) * e);
        c.tilt = a.tilt + (tilt - a.tilt) * e; c.heading = a.heading + dh * e;
        this.dirty = true;
        if (u < 1 && this.isOpen && this.on3d) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      return;
    }
    const a = { ...this.view }, t0 = performance.now(), dur = opts.dur || 900, id = (this._fly = (this._fly || 0) + 1);
    let dl = lon - a.lon; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
    const step = (now) => {
      if (id !== this._fly) return;
      const u = Math.min(1, (now - t0) / dur), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      this.view.lon = a.lon + dl * e; this.view.lat = a.lat + (lat - a.lat) * e;
      this.view.s = Math.exp(Math.log(a.s) + (Math.log(s) - Math.log(a.s)) * e);
      this._clampView(); this.dirty = true;
      if (u < 1 && this.isOpen) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  go(where, opts = {}) {
    if (where === "tour") return this.tour();
    this._tourId = 0;                                     // un salto pedido a mano corta el recorrido
    const me = this.playerLL();
    const fit = (km) => Math.min(this.W, this.H) / (km * 1000 / M_PER_DEG);
    if (where === "global") this.flyTo(this.on3d ? 8 : 0, me.lon, this.minS, { alt: 3.3, tilt: 0, ...opts });
    else if (where === "gale") this.flyTo(-5.2, 137.6, fit(260), opts);
    else if (where === "eva") { const b = this.geo.bounds; this.flyTo((b.north_lat + b.south_lat) / 2, (b.west_lon_east + b.east_lon_east) / 2, fit(7), opts); }
    else if (where === "me") this.flyTo(me.lat, me.lon, Math.max(where === "me" && opts.fromTour ? 0 : this.view.s, fit(1.5)), opts);
  }

  // Recorrido de entrada: Marte entero -> crater Gale -> zona EVA -> tu posicion (~5 s), con la capa terminal.
  // Cada tramo espera a que termine el anterior; si el usuario mueve la vista o pulsa un boton, se detiene.
  async tour() {
    const id = (this._tourId = (this._tourId || 0) + 1);
    const fx = (this.fx ||= new HackFx());
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const me = this.playerLL(), b = this.geo.bounds;
    const evaLL = [(b.north_lat + b.south_lat) / 2, (b.west_lon_east + b.east_lon_east) / 2];
    const legs = [
      ["global", 450, 250, { name: t(L("Marte", "Mars")), lat: 8, lon: me.lon, src: "MOLA 8 px/° (~7.4 km)" }],
      ["gale", 1200, 300, { name: t(L("Cráter Gale", "Gale crater")), lat: -5.2, lon: 137.6, src: "MOLA 64 px/° + HRSC" }],
      ["eva", 1000, 280, { name: t(L("Zona EVA", "EVA zone")), lat: evaLL[0], lon: evaLL[1], src: "DTM HiRISE + CTX 6 m/px" }],
      ["me", 800, 0, { name: this.game.bio?.p?.name || "EVA-1", lat: me.lat, lon: me.lon, src: t(L("telemetría del traje", "suit telemetry")) }],
    ];
    fx.start();
    const g3 = this.on3d && this.g3;
    const stop = () => fx.stop();
    // cada tramo anuncia en el terminal la capa de relieve que se usa: Gale (MOLA 64 px/°), la zona de 60 km
    // y el DTM de la zona EVA
    for (const [where, dur, pause, info] of legs) {
      if (id !== this._tourId || !this.isOpen) { stop(); return; }
      const tid = this._tourId;
      this.go(where, { dur, fromTour: true });
      this._tourId = tid;                                 // go() lo pone a 0: el recorrido sigue siendo el dueno
      fx.leg({ ...info, dur });
      if (g3 && where === "gale") {
        const G = this.rGale;
        setTimeout(() => fx.line(`${t(L("cargando", "loading"))} MOLA 64 px/° · ${G.w}×${G.h}`, "dim"), 360);
      }
      if (g3 && where === "eva") {
        if (this.rRegion) {
          const R = this.rRegion;
          setTimeout(() => fx.line(`${t(L("cargando", "loading"))} HRSC 200 m + THEMIS 100 m`, "dim"), 360);
        }
        setTimeout(() => { if (id === this._tourId) { fx.line(`${t(L("cargando", "loading"))} DTM HiRISE+CTX 6 m/px`, "dim"); } }, dur * 0.4);
      }
      // espera vigilando: si el usuario toma el control a mitad del tramo, la capa se quita al instante
      const fly = this._fly, end = performance.now() + dur + pause;
      while (performance.now() < end) {
        await wait(50);
        if (fly !== this._fly || id !== this._tourId || !this.isOpen) { stop(); return; }
      }
    }
    fx.finish();
  }

  // Coloca la vista en Marte entero sin animacion (punto de partida del recorrido)
  _startGlobal() {
    const me = this.playerLL();
    if (this.g3) { this._fly = (this._fly || 0) + 1; Object.assign(this.g3.cam, { lat: 8, lon: me.lon, alt: 3.3, tilt: 0, heading: 0 }); }
    this.view = { lat: 0, lon: me.lon, s: this.minS || 2 };
    this.dirty = true;
  }
  _afterOpen() { this._profile(); this._info(); this._readout(); }

  open(where = "tour") {
    this.isOpen = true;
    $("scrAtlas").hidden = false;
    this.svPick = false; this._syncStreetUi();
    this._resize();
    this.ready.then(() => {
      if (!this._opened) { this._opened = true; const b = this.geo.bounds; this.view = { lat: (b.north_lat + b.south_lat) / 2, lon: (b.west_lon_east + b.east_lon_east) / 2, s: 4 }; this._resize(); }
      if (where === "tour") this._startGlobal();
      if (this.is3d && !this.g3) { this._sync3dUi(); this._ensure3d().then(() => { this._startGlobal(); this.go(where); }); return this._afterOpen(); }
      this.go(where);
      this._profile();
      this._info();
      this._readout();
    });
    this._hint();
    const loop = () => { if (!this.isOpen) return; if (this.dirty) this.render(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  close() { this.isOpen = false; this._tourId = 0; if (this.fx) this.fx.stop(); this.drawer(null, true); $("scrAtlas").hidden = true; this.onClose && this.onClose(); }
  toggle(where) { this.isOpen ? this.close() : this.open(where); }

  playerLL() { const s = this.game.s; return this.geo.toLatLon(s.x, s.z); }

  // ---- muestreo de elevacion (el dato mas fino disponible) ------------------------------
  sampleRaster(r, lat, lon) {
    const x = (wrapLon(lon) - r.lon_west) * r.ppd - 0.5, y = (r.lat_north - lat) * r.ppd - 0.5;
    if (r.id !== "global" && (x < 0 || y < 0 || x > r.w - 1 || y > r.h - 1)) return null;
    const xi = Math.max(0, Math.min(r.w - 1, Math.round(x))), yi = Math.max(0, Math.min(r.h - 1, Math.round(y)));
    return r.elev[yi * r.w + xi];
  }
  elevAt(lat, lon) {
    if (this.geo.contains(lat, lon)) {
      const p = this.geo.toWorld(lat, lon);
      return { elev: this.world.demHeight(p.x, p.z) + this.world.yRef, src: L("DTM HiRISE+CTX · 6 m/px", "HiRISE+CTX DTM · 6 m/px"), local: p };
    }
    if (!this.rGlobal) return null;
    const rr = this.rRegion && this.sampleRaster(this.rRegion, lat, lon);
    if (rr != null && rr !== false) return { elev: rr, src: L("HRSC+MOLA · 200 m/px", "HRSC+MOLA · 200 m/px") };
    const g = this.sampleRaster(this.rGale, lat, lon);
    if (g != null) return { elev: g, src: L("MOLA · 64 px/° (~925 m)", "MOLA · 64 px/° (~925 m)") };
    return { elev: this.sampleRaster(this.rGlobal, lat, lon), src: L("MOLA · 8 px/° (~7,4 km)", "MOLA · 8 px/° (~7.4 km)") };
  }

  // ---- dibujo ----------------------------------------------------------------------
  _drawGeoImage(img, lonW, latN, lonSpan, latSpan, iw, ih, alpha = 1) {
    const ctx = this.ctx, v = this.view;
    for (const k of lonSpan >= 359 ? [-360, 0, 360] : [0]) {
      let dl = lonW + k - v.lon;
      if (lonSpan < 359) { if (dl > 180) dl -= 360; else if (dl < -180) dl += 360; }
      const x0 = this.W / 2 + dl * v.s, y0 = this.H / 2 - (latN - v.lat) * v.s;
      const dw = lonSpan * v.s, dh = latSpan * v.s;
      // recortar a la ventana (los rectangulos enormes son lentos)
      const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0), cx1 = Math.min(this.W, x0 + dw), cy1 = Math.min(this.H, y0 + dh);
      if (cx1 <= cx0 || cy1 <= cy0) continue;
      const sx = ((cx0 - x0) / dw) * iw, sy = ((cy0 - y0) / dh) * ih, sw = ((cx1 - cx0) / dw) * iw, sh = ((cy1 - cy0) / dh) * ih;
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, sx, sy, Math.max(0.01, sw), Math.max(0.01, sh), cx0, cy0, cx1 - cx0, cy1 - cy0);
      ctx.globalAlpha = 1;
    }
  }

  // Patron anclado al suroeste, como las UV de la malla EVA.
  _drawEvaTiles(alpha) {
    const ctx = this.ctx, b = this.geo.bounds;
    const nw = this.project(b.north_lat, b.west_lon_east), se = this.project(b.south_lat, b.east_lon_east);
    const width = se.x - nw.x, height = se.y - nw.y;
    const x = Math.max(0, nw.x), y = Math.max(0, nw.y), right = Math.min(this.W, se.x), bottom = Math.min(this.H, se.y);
    if (right <= x || bottom <= y) return;
    ctx.save();
    try {
      ctx.beginPath(); ctx.rect(x, y, right - x, bottom - y); ctx.clip();
      ctx.globalCompositeOperation = "overlay";
      const canvas = canvas164("regolith", true);
      if (this._evaPatternCanvas !== canvas) {
        this._evaPattern = ctx.createPattern(canvas, "repeat");
        this._evaPatternCanvas = canvas;
      }
      const pattern = this._evaPattern;
      for (const [meters, strength] of [[560, 0.30], [56, 0.22]]) {
        const tw = width * meters / this.world.size, th = height * meters / this.world.size;
        const px = Math.min(tw, th);
        if (px <= 6) continue;
        const t = Math.min(1, (px - 6) / 2), fade = t * t * (3 - 2 * t);
        pattern.setTransform(new DOMMatrix([tw / TEX_SIZE, 0, 0, th / TEX_SIZE, nw.x, se.y]));
        ctx.fillStyle = pattern;
        ctx.globalAlpha = alpha * strength * fade;
        ctx.fillRect(x, y, right - x, bottom - y);
      }
    } finally { ctx.restore(); }
  }

  render() {
    this.dirty = false;
    const ctx = this.ctx, W = this.W, H = this.H, v = this.view;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const is3 = this.on3d;
    if (is3) ctx.clearRect(0, 0, W, H); else { ctx.fillStyle = "#0b0809"; ctx.fillRect(0, 0, W, H); }
    if (!this.rGlobal) { ctx.fillStyle = "#bfafa3"; ctx.font = "16px Inter, sans-serif"; ctx.fillText(t(L("Cargando MOLA…", "Loading MOLA…")), 20, 30); return; }
    this.hits = [];
    this._lq = [];
    const G = this.rGlobal, R = this.rGale;
    const b = this.geo.bounds;
    if (is3) {
      // 3D: el globo se dibuja en WebGL debajo; este lienzo solo pinta marcadores y rotulos encima
      const g3 = this.g3;
      g3.updateCamera(this._elevFn());
      v.lat = g3.cam.lat; v.lon = g3.cam.lon; v.s = g3.s;
      const steps = [30, 15, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001];
      const step = steps.find((q) => q * v.s < 170) || 0.001;
      g3.setOverlay(this.show.overlay && this.game.s.layer ? this.overlays[this.game.s.layer] : null);
      g3.setIce(this.mode === "mars");
      g3.render(step, this.show.grid);
      const nd = $("atlasCompass").querySelector(".needle");
      if (nd) nd.style.transform = `rotate(${-g3.cam.heading}deg)`;
      if (this.show.grid) this._gratLabels3d(step);
    } else {
    ctx.imageSmoothingEnabled = v.s < 40;
    this._drawGeoImage(G.canvas, 0, 90, 360, 180, G.w, G.h);
    ctx.imageSmoothingEnabled = true;
    if (v.s > 30) this._drawGeoImage(R.canvas, R.lon_west, R.lat_north, R.w / R.ppd, R.h / R.ppd, R.w, R.h, Math.min(1, (v.s - 30) / 30));
    const RG = this.rRegion;
    if (RG && v.s > 150) { const im = RG.image; this._drawGeoImage(RG.canvas, im.lon_west, im.lat_north, im.w / im.ppd, im.h / im.ppd, im.w, im.h, Math.min(1, (v.s - 150) / 150)); }
    if (v.s > 1500 && this.optical.complete) {
      const a = Math.min(1, (v.s - 1500) / 1500);
      this._drawGeoImage(this.optical, b.west_lon_east, b.north_lat, b.east_lon_east - b.west_lon_east, b.north_lat - b.south_lat, this.optical.naturalWidth, this.optical.naturalHeight, a);
      this._drawEvaTiles(a);
      const ov = this.show.overlay && this.game.s.layer && this.overlays[this.game.s.layer];
      if (ov && ov.complete) this._drawGeoImage(ov, b.west_lon_east, b.north_lat, b.east_lon_east - b.west_lon_east, b.north_lat - b.south_lat, ov.naturalWidth, ov.naturalHeight, a * 0.9);
    }
    if (this.show.grid) this._graticule();
    }
    this._rect(R.lat_north, R.lon_west, R.lat_north - R.h / R.ppd, R.lon_west + R.w / R.ppd, "rgba(255,255,255,.25)", [4, 4], v.s > 8 && v.s < 400 ? "MOLA 64 px/°" : null);
    this._rect(b.north_lat, b.west_lon_east, b.south_lat, b.east_lon_east, "#7FD1FF", [6, 4], v.s < 6000 ? t(L("Zona EVA (6 m/px)", "EVA zone (6 m/px)")) : null);
    if (this.show.phenomena) this._phenomena();
    this._features();
    if (this.show.msl && v.s > 150) this._mslTraverse();
    if (this.show.drills && v.s > 2500) this._drills();
    if (this.show.structs && v.s > 2500) this._structs();
    if (this.show.objectives && v.s > 1500) this._objectives();
    if (this.show.track) this._track();
    this._pins();
    this._player();
    this._measure();
    this._flushLabels();
    this._cursorMarks();
    this._scaleBar();
  }

  _graticule() {
    const ctx = this.ctx, v = this.view, W = this.W, H = this.H;
    const steps = [30, 15, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001];
    const step = steps.find((s) => s * v.s < 160) || 0.001;
    const latTop = Math.min(90, v.lat + H / 2 / v.s), latBot = Math.max(-90, v.lat - H / 2 / v.s);
    const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = 1; ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.font = "11px Rajdhani, sans-serif";
    ctx.beginPath();
    for (let lat = Math.ceil(latBot / step) * step; lat <= latTop + 1e-9; lat += step) {
      const y = this.H / 2 - (lat - v.lat) * v.s;
      ctx.moveTo(0, y); ctx.lineTo(W, y);
    }
    const lonL = v.lon - W / 2 / v.s, lonR = v.lon + W / 2 / v.s;
    for (let lon = Math.ceil(lonL / step) * step; lon <= lonR + 1e-9; lon += step) {
      const x = W / 2 + (lon - v.lon) * v.s;
      ctx.moveTo(x, 0); ctx.lineTo(x, H);
    }
    ctx.stroke();
    ctx.shadowColor = "#000"; ctx.shadowBlur = 3;
    for (let lat = Math.ceil(latBot / step) * step; lat <= latTop + 1e-9; lat += step) {
      const y = this.H / 2 - (lat - v.lat) * v.s;
      if (y > 14 && y < H - 4) ctx.fillText(`${Math.abs(lat).toFixed(dec)}°${lat < 0 ? "S" : lat > 0 ? "N" : ""}`, 4, y - 3);
    }
    for (let lon = Math.ceil(lonL / step) * step; lon <= lonR + 1e-9; lon += step) {
      const x = W / 2 + (lon - v.lon) * v.s;
      if (x > 40 && x < W - 30) ctx.fillText(`${wrapLon(lon).toFixed(dec)}°E`, x + 3, 12);
    }
    ctx.shadowBlur = 0;
  }

  _rect(latN, lonW, latS, lonE, color, dash, label) {
    const a = this.project(latN, lonW), b = this.project(latS, lonE), ctx = this.ctx;
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash(dash);
    if (this.on3d) {
      // en el globo el rectangulo lat/lon se dibuja siguiendo sus cuatro lados sobre el relieve
      const n = 10, pts = [];
      for (let i = 0; i <= n; i++) pts.push([latN, lonW + ((lonE - lonW) * i) / n]);
      for (let i = 1; i <= n; i++) pts.push([latN + ((latS - latN) * i) / n, lonE]);
      for (let i = 1; i <= n; i++) pts.push([latS, lonE + ((lonW - lonE) * i) / n]);
      for (let i = 1; i <= n; i++) pts.push([latS + ((latN - latS) * i) / n, lonW]);
      ctx.beginPath();
      pts.forEach(([la, lo]) => { const q = this.project(la, lo); ctx.lineTo(q.x, q.y); });
      ctx.stroke(); ctx.setLineDash([]);
      if (label && !Number.isNaN(a.x)) this._label(label, a.x + 2, a.y - 4, color, false, 12, 20);
      return;
    }
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.setLineDash([]);
    if (label && b.x - a.x > 4) this._label(label, a.x + 2, a.y - 4, color, false, 12, 20);
  }

  _kmToPx(km) { return (km * 1000 / M_PER_DEG) * this.view.s; }

  // Traza un circulo geografico: arco simple en el mapa plano; en el globo, el circulo real sobre la esfera
  _ring(p, r, lat, lon, km) {
    const ctx = this.ctx;
    ctx.beginPath();
    if (!this.on3d || !km || r < 8) { ctx.arc(p.x, p.y, r, 0, 7); return; }
    const d = (km * 1000) / MARS_GEO.R_mean, p1 = lat * D2R, N = 56;
    let all = true;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * 2 * Math.PI;
      const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th));
      const l2 = lon * D2R + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
      const q = this.project(p2 / D2R, l2 / D2R);
      if (Number.isNaN(q.x)) { all = false; continue; }
      ctx.lineTo(q.x, q.y);
    }
    if (all) ctx.closePath();
  }

  // Rotulos de la reticula en 3D: sobre el meridiano y el paralelo que pasan por el centro de la vista
  _gratLabels3d(step) {
    const ctx = this.ctx, v = this.view;
    const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    const span = Math.min(90, (Math.max(this.W, this.H) / v.s) * 0.75);
    ctx.font = "600 11px Rajdhani, sans-serif"; ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.shadowColor = "#000"; ctx.shadowBlur = 3;
    const lat0 = Math.round(v.lat / step) * step, lon0 = Math.round(v.lon / step) * step;
    for (let la = Math.max(-90, Math.ceil((v.lat - span) / step) * step); la <= Math.min(90, v.lat + span) + 1e-9; la += step) {
      const q = this.project(la, lon0);
      if (!Number.isNaN(q.x)) ctx.fillText(`${Math.abs(la).toFixed(dec)}°${la < -1e-9 ? "S" : la > 1e-9 ? "N" : ""}`, q.x + 4, q.y - 3);
    }
    const lspan = Math.min(180, span / Math.max(0.2, Math.cos(v.lat * D2R)));
    for (let lo = Math.ceil((v.lon - lspan) / step) * step; lo <= v.lon + lspan + 1e-9; lo += step) {
      const q = this.project(lat0, lo);
      if (!Number.isNaN(q.x)) ctx.fillText(`${wrapLon(lo).toFixed(dec)}°E`, q.x + 4, q.y + 12);
    }
    ctx.shadowBlur = 0;
  }

  _features() {
    const ctx = this.ctx, v = this.view, cats = this.feat.categories;
    for (const f of this.feat.features) {
      if (!this.show[f.cat]) continue;
      const p = this.project(f.lat, f.lon);
      if (Number.isNaN(p.x) || p.x < -400 || p.x > this.W + 400 || p.y < -400 || p.y > this.H + 400) continue;
      const col = cats[f.cat].color, sel = this.selected && this.selected.f === f;
      const rpx = f.d_km ? this._kmToPx(f.d_km / 2) : 0;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = sel ? 2.5 : 1.5;
      let r = 6, show = true;
      if (f.cat === "lander") {
        ctx.beginPath(); ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x + 7, p.y); ctx.lineTo(p.x, p.y + 7); ctx.lineTo(p.x - 7, p.y); ctx.closePath();
        ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = "#000"; ctx.stroke();
        show = v.s > 9 || sel;
      } else if (f.cat === "volcano") {
        const s = Math.max(7, Math.min(40, rpx * 0.25));
        ctx.beginPath(); ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x + s, p.y + s * 0.7); ctx.lineTo(p.x - s, p.y + s * 0.7); ctx.closePath(); ctx.stroke();
        if (rpx > 30) { ctx.setLineDash([3, 4]); this._ring(p, rpx, f.lat, f.lon, f.d_km / 2); ctx.stroke(); ctx.setLineDash([]); }
        r = s;
      } else if (f.cat === "crater" || f.cat === "polar") {
        r = Math.max(5, rpx);
        this._ring(p, r, f.lat, f.lon, f.d_km / 2); ctx.stroke();
        if (rpx < 5) { ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 7); ctx.fill(); }
      } else {
        r = Math.max(5, rpx);
        if (rpx > 12) { ctx.setLineDash([2, 6]); ctx.globalAlpha = 0.6; this._ring(p, rpx, f.lat, f.lon, f.d_km / 2); ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]); }
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fill();
        r = 8;
      }
      this.hits.push({ x: p.x, y: p.y, r: Math.max(9, Math.min(r, 30)), item: { kind: "feature", f } });
      // a poca escala solo se rotulan los rasgos grandes, para no saturar el mapa
      if (f.cat !== "lander") show = sel || rpx > 16 || v.s > 14;
      // prioridad: lo seleccionado, luego los rasgos que mas ocupan en pantalla (los grandes mandan sobre los pequenos)
      const prio = sel ? 95 : f.cat === "lander" ? 58 : 40 + Math.min(25, rpx / 12);
      if (show && (rpx < this.W * 0.9)) this._label(t(f.name), p.x + Math.min(r, 60) * 0.72 + 4, p.y - Math.min(r, 60) * 0.72, col, f.cat === "region" || f.cat === "canyon", rpx > 80 ? 15 : 13, prio);
    }
  }

  // Los rotulos no se pintan al momento: se encolan con una prioridad y al final del fotograma se colocan de
  // mayor a menor prioridad sin solaparse (probando a la derecha, debajo, a la izquierda y encima del simbolo).
  // Los que no caben se omiten; los de prioridad >= 90 (tu posicion, lo seleccionado, la regla) salen siempre.
  _label(text, x, y, color = "#fff", italic = false, size = 13, prio = 50) {
    if (!text || Number.isNaN(x) || Number.isNaN(y)) return;
    this._lq.push({ text, x, y, color, italic, size, prio });
  }
  _flushLabels() {
    const ctx = this.ctx, boxes = [];
    this._lq.sort((a, b) => b.prio - a.prio);
    const free = (bx, by, bw, bh) => {
      for (const o of boxes) if (bx < o[0] + o[2] && bx + bw > o[0] && by < o[1] + o[3] && by + bh > o[1]) return false;
      return true;
    };
    ctx.lineJoin = "round"; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    for (const l of this._lq) {
      ctx.font = `${l.italic ? "italic " : ""}600 ${l.size}px Rajdhani, sans-serif`;
      const w = ctx.measureText(l.text).width, h = l.size + 4;
      // posiciones candidatas respecto al ancla original (que ya esta a la derecha del simbolo)
      const cand = [[l.x, l.y], [l.x, l.y + h + 4], [l.x - w - 22, l.y], [l.x, l.y - h - 2], [l.x - w - 22, l.y + h + 4]];
      let pos = null;
      for (const [cx, cy] of cand) { if (free(cx - 3, cy - l.size, w + 6, h)) { pos = [cx, cy]; break; } }
      if (!pos) { if (l.prio < 90) continue; pos = cand[0]; }
      if (pos[0] > this.W || pos[0] + w < 0 || pos[1] < 0 || pos[1] - l.size > this.H) continue;
      boxes.push([pos[0] - 3, pos[1] - l.size, w + 6, h]);
      ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(10,6,6,.85)"; ctx.strokeText(l.text, pos[0], pos[1]);
      ctx.fillStyle = l.color; ctx.fillText(l.text, pos[0], pos[1]);
    }
    ctx.lineJoin = "miter";
    this._lq.length = 0;
  }

  _phenomena() {
    const ctx = this.ctx;
    this.feat.phenomena.forEach((ph, idx) => {
      const sel = this.selected && this.selected.ph === ph;
      ph.zones.forEach((z) => {
        const p = this.project(z.lat, z.lon), r = Math.max(10, this._kmToPx(z.r_km));
        if (Number.isNaN(p.x) || p.x + r < 0 || p.x - r > this.W || p.y + r < 0 || p.y - r > this.H) return;
        ctx.globalAlpha = sel ? 0.24 : 0.06; ctx.fillStyle = ph.color;
        this._ring(p, r, z.lat, z.lon, z.r_km); ctx.fill();
        ctx.globalAlpha = sel ? 1 : 0.5; ctx.strokeStyle = ph.color; ctx.lineWidth = sel ? 2.5 : 1.1; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        // insignia numerada en el borde de la zona
        const bx = p.x + r * 0.7, by = p.y - r * 0.7;
        ctx.fillStyle = ph.color; ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(bx, by, 10, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#111"; ctx.font = "700 12px Rajdhani, sans-serif"; ctx.textAlign = "center"; ctx.fillText(String(idx + 1), bx, by + 4); ctx.textAlign = "left";
        this.hits.push({ x: bx, y: by, r: 12, item: { kind: "phenomenon", ph, zone: z } });
        if (sel || this.view.s > 6) this._label(t(z.label), bx + 13, by + 4, ph.color, false, 12, sel ? 94 : 30);
      });
    });
  }

  _mslTraverse() {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(255,210,80,.85)"; ctx.lineWidth = this.view.s > 3000 ? 2.5 : 1.6; ctx.beginPath();
    this.trav.forEach(([lat, lon], i) => { const p = this.project(lat, lon); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    ctx.stroke();
    if (this.view.s < 3000) {
      const last = this.trav[this.trav.length - 1], p = this.project(last[0], last[1]);
      this._label(`Curiosity · sol ${last[3]}`, p.x + 6, p.y + 14, "#ffd250", false, 12, 45);
    }
  }

  _drills() {
    const ctx = this.ctx;
    for (const d of this.drills) {
      const p = this.project(d.lat, d.lon);
      if (p.x < -50 || p.x > this.W + 50 || p.y < -50 || p.y > this.H + 50) continue;
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.fill(); ctx.stroke();
      this.hits.push({ x: p.x, y: p.y, r: 8, item: { kind: "drill", d } });
      if (this.view.s > 9000) this._label(`${d.name} · sol ${d.sol}`, p.x + 6, p.y - 5, "#fff", false, 12, 35);
    }
  }

  // Estructuras del mapa (public/layers/structures.json): rombo ambar con el icono de su tipo
  _structs() {
    const list = (this.data.structures && this.data.structures.structures) || [];
    const ctx = this.ctx, v = this.view;
    for (const e of list) {
      const ll = this.geo.toLatLon(e.x, e.z), p = this.project(ll.lat, ll.lon);
      if (p.x < -20 || p.y < -20 || p.x > this.W + 20 || p.y > this.H + 20) continue;
      const sel = this.selected && this.selected.kind === "struct" && this.selected.e === e;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = sel ? "#ffb02e" : "rgba(20,14,8,.85)"; ctx.strokeStyle = "#ffb02e"; ctx.lineWidth = 1.6;
      ctx.fillRect(-6.5, -6.5, 13, 13); ctx.strokeRect(-6.5, -6.5, 13, 13);
      ctx.restore();
      ctx.fillStyle = sel ? "#120e10" : "#ffb02e"; ctx.font = "700 9px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(typeIcon(e), p.x, p.y + 0.5);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      this.hits.push({ x: p.x, y: p.y, r: 10, item: { kind: "struct", e, ll } });
      if (v.s > 9000) this._label(t(e.name), p.x + 11, p.y + 4, "#ffcf7a", false, 12, sel ? 95 : 42);
    }
  }

  _objectives() {
    const ctx = this.ctx, tg = this.game.target;
    // objetivos de la campana + el destino propio del modo libre, si existe
    const cu = this.game.objectives.custom;
    for (const o of cu ? [...this.data.objectives.objectives, cu] : this.data.objectives.objectives) {
      const p = this.project(o.latlon[0], o.latlon[1]);
      const isT = tg && tg.id === o.id;
      ctx.lineWidth = 2.5; ctx.strokeStyle = isT ? "#3DDC97" : o.type === "science" ? "#fff" : "#3DDC97";
      if (o.type === "science") { ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, 7); ctx.stroke(); }
      else ctx.strokeRect(p.x - 7, p.y - 7, 14, 14);
      if (isT) { ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, 7); ctx.stroke(); }
      this.hits.push({ x: p.x, y: p.y, r: 11, item: { kind: "objective", o } });
      if (this.view.s > 2500) this._label(t(o.name), p.x + 12, p.y + 4, isT ? "#3DDC97" : "#fff", false, 13, isT ? 92 : 70);
    }
  }

  _track() {
    const tr = this.game.s.track;
    if (!tr || tr.length < 2) return;
    const ctx = this.ctx;
    ctx.strokeStyle = "#7FD1FF"; ctx.lineWidth = 3; ctx.setLineDash([]); ctx.beginPath();
    tr.forEach((q, i) => { const ll = this.geo.toLatLon(q[1], q[2]), p = this.project(ll.lat, ll.lon); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    ctx.stroke();
  }

  _player() {
    const ll = this.playerLL(), p = this.project(ll.lat, ll.lon), ctx = this.ctx, s = this.game.s;
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.fillStyle = "rgba(127,209,255,.25)"; ctx.beginPath(); ctx.arc(0, 0, 16, 0, 7); ctx.fill();
    ctx.rotate(-s.heading);
    ctx.fillStyle = "#7FD1FF"; ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    this._label(t(L("Tú", "You")) + ` · ${this.game.bio.p.name}`, p.x + 14, p.y + 18, "#7FD1FF", false, 13, 100);
    this.hits.push({ x: p.x, y: p.y, r: 12, item: { kind: "player" } });
  }

  _measure() {
    const m = this.measure;
    if (!m || !m.a) return;
    const ctx = this.ctx, pts = [];
    const b = m.b || this.hover;
    if (b) for (let i = 0; i <= 64; i++) pts.push(gcInterpolate(m.a.lat, m.a.lon, b.lat, b.lon, i / 64));
    else pts.push(m.a);
    ctx.strokeStyle = "#FFC23D"; ctx.lineWidth = 2.5; ctx.setLineDash([8, 5]); ctx.beginPath();
    let prev = null;
    for (const q of pts) {
      const p = this.project(q.lat, q.lon);
      if (prev && Math.abs(p.x - prev.x) > this.W / 2) ctx.moveTo(p.x, p.y); else if (prev) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      prev = p;
    }
    ctx.stroke(); ctx.setLineDash([]);
    for (const q of [m.a, m.b].filter(Boolean)) {
      const p = this.project(q.lat, q.lon);
      ctx.fillStyle = "#FFC23D"; ctx.strokeStyle = "#000"; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 7); ctx.fill(); ctx.stroke();
    }
    if (b) {
      const p = this.project(b.lat, b.lon), lang = getLang();
      this._label(`${fmtDist(gcDistance(m.a.lat, m.a.lon, b.lat, b.lon), lang)} · ${num(gcBearing(m.a.lat, m.a.lon, b.lat, b.lon), 1, lang)}°`, p.x + 10, p.y - 10, "#FFC23D", false, 14, 98);
    }
  }

  _scaleBar() {
    const ctx = this.ctx, v = this.view;
    const mPerPx = (M_PER_DEG / v.s) * (this.on3d ? 1 : Math.cos(v.lat * D2R));
    const target = 120 * mPerPx;
    const nice = [1, 2, 5].flatMap((k) => [1, 10, 100, 1000, 1e4, 1e5, 1e6].map((p) => k * p)).sort((a, b) => a - b);
    const len = nice.reduce((best, n) => (n <= target ? n : best), nice[0]);
    const px = len / mPerPx, x = this.W - px - 20, y = this.H - 18;
    ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(x - 8, y - 22, px + 16, 30);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 6); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "600 12px Rajdhani, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(fmtDist(len, getLang()) + t(L(" (en el centro)", " (at center)")), x + px / 2, y - 9); ctx.textAlign = "left";
  }

  // ---- interaccion -------------------------------------------------------------------
  _click(p, shift) {
    const ll = this.unproject(p.x, p.y);
    if (this.svPick) {
      if (ll && this.geo.contains(ll.lat, ll.lon)) {
        this.svPick = false; this._syncStreetUi(); this._hint();
        const heading = this.on3d ? this.g3.cam.heading : 0;
        if (this.onStreetView) this.onStreetView(ll, heading);
      } else $("atlasHint").textContent = t(L("La vista de suelo usa el DTM de 6 m: haz clic dentro de la zona EVA (recuadro azul).", "Street View uses the 6 m DTM: click inside the EVA zone (blue box)."));
      return;
    }
    if ((this.measuring || shift) && ll) {
      if (!this.measure || this.measure.b) this.measure = { a: ll, b: null };
      else { this.measure.b = ll; this.profileMode = "measure"; this._profile(); }
      this._hint(); this.dirty = true;
      return;
    }
    let best = null, bd = Infinity;
    for (const h of this.hits) { const d = Math.hypot(h.x - p.x, h.y - p.y); if (d < h.r && d < bd) { bd = d; best = h; } }
    if (best) {
      const it = best.item;
      this.selected = it.kind === "feature" ? { f: it.f } : it.kind === "phenomenon" ? { ph: it.ph, zone: it.zone } : it;
    } else this.selected = ll ? { kind: "point", ll } : null;
    this._info();
    // pantalla pequena: tocar un simbolo abre su ficha; tocar el mapa vacio cierra los paneles
    if (this.compact) this.drawer(best ? "info" : null, true);
    this.dirty = true;
  }

  // Diseno compacto (movil, ventanas pequenas): el mapa ocupa todo y los paneles se abren encima
  get compact() { return window.matchMedia("(max-width: 900px), (max-height: 560px)").matches; }
  // which: "side" | "info" | "prof" | null; force = abrir (o cerrar con null) sin alternar
  drawer(which, force = false) {
    const wrap = document.querySelector("#scrAtlas .atlas-wrap");
    const cur = ["side", "info", "prof"].find((k) => wrap.classList.contains("show-" + k)) || null;
    const next = force ? which : cur === which ? null : which;
    for (const k of ["side", "info", "prof"]) wrap.classList.toggle("show-" + k, k === next);
    document.querySelectorAll("#scrAtlas [data-drawer]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.drawer === next)));
    if (next === "prof") this._profile();               // el lienzo del perfil tenia tamano 0 mientras estaba oculto
    if (next === "info") this._info();
  }

  _hint() {
    const m = this.measure;
    if (this.svPick) { $("atlasHint").textContent = t(L("Vista de suelo: haz clic en un punto de la zona EVA (recuadro azul)", "Street View: click a point in the EVA zone (blue box)")); return; }
    $("atlasHint").textContent = this.measuring
      ? t(!m || m.b ? L("Regla: haz clic en el punto de inicio", "Ruler: click the start point") : L("Regla: haz clic en el punto final", "Ruler: click the end point"))
      : this.is3d
        ? t(L("Arrastra para girar el globo · rueda para acercar · botón derecho o Ctrl+arrastrar para inclinar y rotar · clic en un símbolo para ver datos · Mayús+clic para medir", "Drag to spin the globe · wheel to zoom · right button or Ctrl+drag to tilt and rotate · click a symbol for data · Shift+click to measure"))
        : t(L("Arrastra para mover · rueda o doble clic para acercar · clic en un punto para ver datos y fijar marcadores · Mayús+clic para medir", "Drag to pan · wheel or double-click to zoom · click a point for data and pins · Shift+click to measure"));
  }

  _pointBlock(lat, lon) {
    const lang = getLang(), e = this.elevAt(lat, lon), me = this.playerLL();
    if (!e) return "";
    const P = pressureAt(e.elev), bp = boilingPointC(P);
    const d = gcDistance(me.lat, me.lon, lat, lon), brg = gcBearing(me.lat, me.lon, lat, lon);
    let extra = "";
    if (e.local) {
      const W = this.world, x = e.local.x, z = e.local.z;
      extra = `<tr><td>${t(L("Pendiente", "Slope"))}</td><td>${num(W.slope(x, z), 1, lang)}°</td></tr>
        <tr><td>${t(L("Dosis GCR", "GCR dose"))}</td><td>${num(W.radiation(x, z), 2, lang)} µGy/h</td></tr>
        <tr><td>${t(L("T. suelo (ahora)", "Ground T (now)"))}</td><td>${num(this.game.tempAt(x, z, this.game.hour), 0, lang)} °C</td></tr>
        <tr><td>${t(L("Mineral (CRISM)", "Mineral (CRISM)"))}</td><td>${t(this.data.layers.layers.spectral.classes[W.spectral(x, z)])}</td></tr>`;
    }
    return `<table class="kv">
      <tr><td>${t(L("Latitud", "Latitude"))}</td><td>${fmtLat(lat)} <span class="muted">${fmtDMS(lat, "N", "S")}</span></td></tr>
      <tr><td>${t(L("Longitud", "Longitude"))}</td><td>${fmtLon(lon)} <span class="muted">${fmtDMS(wrapLon(lon), "E", "E")}</span></td></tr>
      <tr><td>${t(L("Elevación", "Elevation"))}</td><td>${num(e.elev, 0, lang)} m <span class="muted">${t(e.src)}</span></td></tr>
      <tr><td>${t(L("Presión (modelo)", "Pressure (model)"))}</td><td>${num(P, 0, lang)} Pa</td></tr>
      <tr><td>${t(L("Columna de aire", "Air column"))}</td><td>${num(columnMass(P), 1, lang)} g/cm²</td></tr>
      <tr><td>${t(L("Agua líquida", "Liquid water"))}</td><td>${bp == null ? t(L("imposible (P < 611,7 Pa)", "impossible (P < 611.7 Pa)")) : t(L("metaestable, hierve a ", "metastable, boils at ")) + num(bp, 1, lang) + " °C"}</td></tr>
      ${extra}
      <tr><td>${t(L("Desde tu posición", "From your position"))}</td><td>${fmtDist(d, lang)} · ${t(L("rumbo", "bearing"))} ${num(brg, 1, lang)}°</td></tr>
    </table>`;
  }

  _info() {
    const box = $("atlasInfo"), sel = this.selected, lang = getLang();
    if (!sel) {
      box.innerHTML = `<div class="eyebrow">${t(L("Atlas de Marte", "Mars atlas"))}</div>
        <p class="small muted">${t(L("Elevación real de MOLA (Mars Global Surveyor, NASA PDS) en todo el planeta, MOLA de 64 px/° en Gale y el DTM HiRISE+CTX del juego en la zona EVA. Coordenadas planetocéntricas, longitud Este (IAU/USGS).", "Real MOLA elevation (Mars Global Surveyor, NASA PDS) for the whole planet, 64 px/° MOLA over Gale and the game's HiRISE+CTX DTM in the EVA zone. Planetocentric coordinates, East longitude (IAU/USGS)."))}</p>
        <h3>${t(L("Tu posición", "Your position"))}</h3>${this._pointBlock(this.playerLL().lat, this.playerLL().lon)}
        ${this._pinList()}
        <h3>${t(L("Cómo explorar", "How to explore"))}</h3>
        <ul class="small muted">
          <li>${t(L("Clic en cualquier punto: sus coordenadas y datos. Desde ahí puedes fijar un marcador o copiar las coordenadas.", "Click anywhere: its coordinates and data. From there you can drop a pin or copy the coordinates."))}</li>
          <li>${t(L("Doble clic: acercar. Flechas: mover. Inicio: tu posición. / : buscar.", "Double-click: zoom in. Arrows: pan. Home: your position. / : search."))}</li>
        </ul>`;
      this._bindPinList();
      return;
    }
    if (sel.kind === "pin") {
      const pin = sel.pin;
      box.innerHTML = `<div class="eyebrow" style="color:#FF8A3D">${t(L("Tu marcador", "Your pin"))}</div>
        <input class="pin-name" id="atlasPinName" maxlength="40" value="${pin.name.replace(/"/g, "&quot;")}" aria-label="${t(L("Nombre del marcador", "Pin name"))}">
        ${this._pointBlock(pin.lat, pin.lon)}
        <div class="pt-actions"><button class="btn sm" id="atlasPtGo">${t(L("Centrar", "Center"))}</button><button class="btn sm" id="atlasPtCopy">${t(L("Copiar coordenadas", "Copy coordinates"))}</button><button class="btn sm" id="atlasPinDel">${t(L("Borrar", "Delete"))}</button></div>
        ${this._pinList()}`;
      const nm = $("atlasPinName");
      nm.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") nm.blur(); };
      nm.onchange = () => { pin.name = nm.value.trim() || pin.name; this._savePins(); this.dirty = true; this._info(); };
      $("atlasPinDel").onclick = () => this.removePin(pin.id);
      this._bindPoint(pin.lat, pin.lon);
      this._bindPinList();
      return;
    }
    if (sel.f) {
      const f = sel.f, cat = this.feat.categories[f.cat];
      const dims = [f.d_km ? `${t(L("Diámetro", "Diameter"))}: ${num(f.d_km, 0, lang)} km` : "", f.h_km ? `${t(L("Altura", "Height"))}: ${num(f.h_km, 1, lang)} km` : "", f.h_km_rel ? `${t(L("Relieve", "Relief"))}: ${num(f.h_km_rel, 1, lang)} km` : "", f.year ? `${t(L("Año", "Year"))}: ${f.year}` : ""].filter(Boolean).join(" · ");
      box.innerHTML = `<div class="eyebrow" style="color:${cat.color}">${t(cat)}</div><h2>${t(f.name)}</h2>
        <p class="small muted">${dims}</p><p class="fact">${t(f.text)}</p>${this._pointBlock(f.lat, f.lon)}
        <p class="small muted">${t(L("Fuente", "Source"))}: ${f.src}</p>
        <div class="btnrow"><button class="btn" id="atlasGoSel">${t(L("Acercar", "Zoom in"))}</button></div>`;
      $("atlasGoSel").onclick = () => this.flyTo(f.lat, f.lon, Math.max(this.view.s, Math.min(this.W, this.H) / ((f.d_km || 60) * 2.2 * 1000 / M_PER_DEG)));
      return;
    }
    if (sel.ph) {
      const ph = sel.ph, idx = this.feat.phenomena.indexOf(ph) + 1;
      box.innerHTML = `<div class="eyebrow" style="color:${ph.color}"><span class="phn" style="background:${ph.color}">${idx}</span>${t(L("Fenómeno natural", "Natural phenomenon"))}${ph.global ? " · " + t(L("en todo el planeta", "planet-wide")) : ""}</div>
        <h2>${t(ph.name)}</h2>
        <h3>${t(L("Qué es", "What it is"))}</h3><p class="fact">${t(ph.what)}</p>
        <h3>${t(L("Cuándo", "When"))}</h3><p class="fact">${t(ph.when)}</p>
        <h3 style="color:var(--danger)">${t(L("Riesgo para la EVA", "Risk to the EVA"))}</h3><p class="fact">${t(ph.risk)}</p>
        <h3 style="color:var(--safe)">${t(L("Cómo protegerte", "How to protect yourself"))}</h3><ul class="protect">${t(ph.protect).map((x) => `<li>${x}</li>`).join("")}</ul>
        <h3>${t(L("Dónde (zonas en el mapa)", "Where (zones on the map)"))}</h3>
        <ul class="zones">${ph.zones.map((z, i) => `<li><button data-z="${i}">${t(z.label)} · ${fmtLat(z.lat, 2)}, ${fmtLon(z.lon, 2)}</button></li>`).join("")}</ul>
        <p class="small muted">${t(L("Datos", "Data"))}: ${t(ph.data)}</p>`;
      box.querySelectorAll("[data-z]").forEach((b) => { b.onclick = () => { const z = ph.zones[+b.dataset.z]; this.flyTo(z.lat, z.lon, Math.min(this.W, this.H) / (z.r_km * 3 * 1000 / M_PER_DEG)); }; });
      return;
    }
    if (sel.kind === "drill") {
      const d = sel.d;
      box.innerHTML = `<div class="eyebrow" style="color:#ffd250">${t(L("Perforación de Curiosity", "Curiosity drill hole"))}</div><h2>${d.name}</h2>
        <p class="fact">${d.unit} · sol ${d.sol}. ${t(L("Posición = parada real del rover en el sol", "Position = rover's actual stop on sol"))} ${d.waypoint_sol} (NASA/JPL MMGIS).</p>
        <table class="kv"><tr><td>${t(L("Elevación medida por el rover", "Elevation measured by the rover"))}</td><td>${num(d.elev_m, 1, lang)} m</td></tr></table>${this._pointBlock(d.lat, d.lon)}`;
      return;
    }
    if (sel.kind === "struct") {
      const e = sel.e;
      box.innerHTML = `<div class="eyebrow" style="color:#ffb02e">${typeIcon(e)} ${typeName(e)}</div><h2>${t(e.name)}</h2>
        <p class="fact">${t(e.info)}</p>
        <table class="kv">${pointFacts(e).map(([k, v, src]) => `<tr><td>${k}</td><td>${v} <span class="muted">· ${src}</span></td></tr>`).join("")}</table>
        <p class="small muted">${t(L("Fuente", "Source"))}: ${e.source || "NASA"}</p>${this._pointBlock(sel.ll.lat, sel.ll.lon)}`;
      return;
    }
    if (sel.kind === "objective") {
      const o = sel.o;
      box.innerHTML = `<div class="eyebrow ok">${t(L("Objetivo de la misión", "Mission objective"))}</div><h2>${t(o.name)}</h2>
        <p class="fact">${o.science || o.notes || ""}</p>${o.analog ? `<p class="small muted">${o.analog}</p>` : ""}${this._pointBlock(o.latlon[0], o.latlon[1])}`;
      return;
    }
    if (sel.kind === "player") { this.selected = null; this._info(); return; }
    if (sel.kind === "point") {
      box.innerHTML = `<div class="eyebrow">${t(L("Punto", "Point"))}</div>${this._pointBlock(sel.ll.lat, sel.ll.lon)}
        <div class="pt-actions"><button class="btn sm primary" id="atlasPtPin">${t(L("Fijar marcador", "Drop a pin"))}</button><button class="btn sm" id="atlasPtCopy">${t(L("Copiar coordenadas", "Copy coordinates"))}</button><button class="btn sm" id="atlasPtGo">${t(L("Centrar", "Center"))}</button><button class="btn sm" id="atlasPtRule">${t(L("Medir desde aquí", "Measure from here"))}</button></div>
        ${this._pinList()}`;
      $("atlasPtPin").onclick = () => this.addPin(sel.ll.lat, sel.ll.lon);
      $("atlasPtRule").onclick = () => { this.measuring = true; this.measure = { a: sel.ll, b: null }; $("atlasMeasure").setAttribute("aria-pressed", "true"); this._hint(); this.dirty = true; };
      this._bindPoint(sel.ll.lat, sel.ll.lon);
      this._bindPinList();
    }
  }

  // botones comunes de un punto: centrar la vista y copiar "lat, lon" al portapapeles
  _bindPoint(lat, lon) {
    $("atlasPtGo").onclick = () => this.flyTo(lat, lon, this.view.s);
    const b = $("atlasPtCopy");
    b.onclick = async () => {
      const txt = `${lat.toFixed(5)}, ${wrapLon(lon).toFixed(5)}`;
      let ok = false;
      try { await navigator.clipboard.writeText(txt); ok = true; } catch (e) { /* sin permiso de portapapeles */ }
      b.textContent = ok ? t(L("Copiado ✓", "Copied ✓")) : txt;
      setTimeout(() => { if (b.isConnected) b.textContent = t(L("Copiar coordenadas", "Copy coordinates")); }, 1800);
    };
  }
  _pinList() {
    if (!this.pins.length) return "";
    return `<h3>${t(L("Mis marcadores", "My pins"))}</h3><ul class="pins">${this.pins.map((p) => `<li><button class="go" data-pin="${p.id}" title="${fmtLat(p.lat, 4)}, ${fmtLon(p.lon, 4)}">📍 ${p.name.replace(/</g, "&lt;")}</button><button class="del" data-del="${p.id}" aria-label="${t(L("Borrar", "Delete"))}">×</button></li>`).join("")}</ul>`;
  }
  _bindPinList() {
    const box = $("atlasInfo");
    box.querySelectorAll("[data-pin]").forEach((b) => { b.onclick = () => { const pin = this.pins.find((p) => p.id === b.dataset.pin); if (!pin) return; this.selected = { kind: "pin", pin }; this.flyTo(pin.lat, pin.lon, this.view.s); this._info(); this.dirty = true; }; });
    box.querySelectorAll("[data-del]").forEach((b) => { b.onclick = () => this.removePin(b.dataset.del); });
  }

  _readout() {
    const h = this.hover, lang = getLang(), el = $("atlasReadout");
    if (!h) { el.innerHTML = `<span class="muted">${t(L("Pasa el cursor por el mapa para leer coordenadas y elevación", "Hover the map to read coordinates and elevation"))}</span>`; return; }
    const e = this.elevAt(h.lat, h.lon);
    if (!e) return;
    const P = pressureAt(e.elev), bp = boilingPointC(P);
    el.innerHTML = `<b>${fmtLat(h.lat, 4)}</b> <b>${fmtLon(h.lon, 4)}</b>
      <span>${t(L("Elev.", "Elev."))} <b>${num(e.elev, 0, lang)} m</b> <i class="muted">${t(e.src)}</i></span>
      <span>P <b>${num(P, 0, lang)} Pa</b></span><span>${t(L("Columna", "Column"))} <b>${num(columnMass(P), 1, lang)} g/cm²</b></span>
      <span>H₂O ${bp == null ? `<b class="bad">${t(L("no líquida", "not liquid"))}</b>` : `<b>${t(L("hierve a", "boils at"))} ${num(bp, 1, lang)} °C</b>`}</span>
      <span class="muted">${this.on3d
        ? `${t(L("altura de la vista", "view altitude"))} ${fmtDist(this.g3.cam.alt * MARS_GEO.R_mean, lang)} · ${t(L("inclinación", "tilt"))} ${Math.round(this.g3.cam.tilt)}° · ${t(L("relieve", "relief"))} ×${num(this.g3.exag, 1, lang)}`
        : `${t(L("zoom", "zoom"))} ${num(this.view.s, this.view.s < 10 ? 1 : 0, lang)} px/°`}</span>`;
  }

  _legend() {
    const el = $("atlasLegend"), P = this.mode === "pressure", lang = getLang();
    const stops = RAMPS[P ? "pressure" : this.mode];
    const lo = P ? Math.log(60) : -8200, hi = P ? Math.log(1250) : 21200;
    const pos = (v) => (((P ? Math.log(v) : v) - lo) / (hi - lo)) * 100;
    const grad = stops.map(([v, c]) => `${c} ${pos(v).toFixed(1)}%`).join(",");
    const ticks = P ? [60, 150, 300, 611.657, 1250] : [-8000, -4000, 0, 4000, 10000, 21000];
    el.innerHTML = `<div class="lg-t">${t(MODES[this.mode])}${P ? ` · P = 610·e<sup>−h/11,1 km</sup>` : ""}</div><div class="lg-bar" style="background:linear-gradient(90deg,${grad})"></div>
      <div class="lg-ticks">${ticks.map((v) => `<span style="left:${pos(v)}%">${P ? (v === 611.657 ? "611,7" : v) : num(v / 1000, 0, lang) + " km"}</span>`).join("")}</div>
      ${P ? `<div class="small muted">${t(L("Línea blanca: punto triple del agua (611,7 Pa). Por debajo, el agua no puede ser líquida.", "White line: water triple point (611.7 Pa). Below it, water cannot be liquid."))}</div>` : ""}`;
  }

  _buildSide() {
    const cats = this.feat.categories;
    const tog = (k, label, color) => `<label class="tg"><input type="checkbox" data-show="${k}" ${this.show[k] ? "checked" : ""}><span class="sw" style="background:${color}"></span>${label}</label>`;
    $("atlasLayers").innerHTML = `<div class="eyebrow">${t(L("Capas", "Layers"))}</div>
      ${Object.entries(cats).map(([k, c]) => tog(k, t(c), c.color)).join("")}
      ${tog("phenomena", t(L("Fenómenos naturales", "Natural phenomena")), "#E0A060")}
      ${tog("msl", t(L("Traza de Curiosity (2012-hoy)", "Curiosity traverse (2012-now)")), "#ffd250")}
      ${tog("drills", t(L("Perforaciones de Curiosity", "Curiosity drill holes")), "#ffffff")}
      ${tog("objectives", t(L("Objetivos y refugios", "Objectives and shelters")), "#3DDC97")}
      ${tog("structs", t(L("Estructuras de la base y ciencia", "Base and science structures")), "#ffb02e")}
      ${tog("track", t(L("Tu traza (tracking)", "Your track")), "#7FD1FF")}
      ${tog("overlay", t(L("Capa activa del HUD (1-4)", "Active HUD layer (1-4)")), "#FF4D4D")}
      ${tog("grid", t(L("Retícula lat/lon", "Lat/lon grid")), "#888")}
      <div class="eyebrow" style="margin-top:14px">${t(L("Fenómenos y protección", "Phenomena and protection"))}</div>
      <ol class="phlist">${this.feat.phenomena.map((ph, i) => `<li><button data-ph="${i}"><span class="phn" style="background:${ph.color}">${i + 1}</span>${t(ph.name)}</button></li>`).join("")}</ol>`;
    $("atlasLayers").querySelectorAll("[data-show]").forEach((c) => { c.onchange = () => { this.show[c.dataset.show] = c.checked; this.dirty = true; }; });
    $("atlasLayers").querySelectorAll("[data-ph]").forEach((b) => {
      b.onclick = () => {
        const ph = this.feat.phenomena[+b.dataset.ph];
        this.selected = { ph }; this.show.phenomena = true;
        const z = ph.zones[0];
        this.flyTo(z.lat, z.lon, Math.min(this.W, this.H) / (Math.max(z.r_km * 3, 1500) * 1000 / M_PER_DEG));
        this._info();
      };
    });
    const ex = $("atlasExag"), cur = ex.value || "auto";
    ex.innerHTML = [["auto", L("Relieve: auto", "Relief: auto")], ["1", L("Relieve ×1 (real)", "Relief ×1 (true)")], ["3", L("Relieve ×3", "Relief ×3")], ["10", L("Relieve ×10", "Relief ×10")], ["25", L("Relieve ×25", "Relief ×25")]]
      .map(([v, n]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${t(n)}</option>`).join("");
    $("atlas3d").title = t(L("Globo 3D / mapa plano", "3D globe / flat map"));
    $("atlasMode").innerHTML = Object.entries(MODES).map(([k, v]) => `<option value="${k}" ${k === this.mode ? "selected" : ""}>${t(v)}</option>`).join("");
  }
  applyLang() { this._syncStreetUi(); this._buildSearch(); if (this.feat) { this._buildSide(); this._legend(); this._info(); this._hint(); this._profile(); this.dirty = true; } }

  // ---- perfil de elevacion --------------------------------------------------------------
  _profileData() {
    if (this.profileMode === "measure" && this.measure && this.measure.b) {
      const { a, b } = this.measure, D = gcDistance(a.lat, a.lon, b.lat, b.lon), n = 240, pts = [];
      for (let i = 0; i <= n; i++) { const q = gcInterpolate(a.lat, a.lon, b.lat, b.lon, i / n), e = this.elevAt(q.lat, q.lon); pts.push([(D * i) / n, e ? e.elev : 0]); }
      return { pts, title: L("Perfil de la regla (círculo máximo)", "Ruler profile (great circle)") };
    }
    const tr = this.game.s.track || [];
    let d = 0;
    const pts = tr.map((q, i) => { if (i) d += Math.hypot(q[1] - tr[i - 1][1], q[2] - tr[i - 1][2]); return [d, q[3]]; });
    return { pts, title: L("Perfil de tu recorrido", "Your traverse profile") };
  }
  _profile() {
    const cv = this.pcv; if (!cv || !this.isOpen) return;
    document.querySelectorAll("#scrAtlas [data-prof]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.prof === this.profileMode)));
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const ctx = cv.getContext("2d"), W = r.width, H = r.height, lang = getLang();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const { pts, title } = this._profileData();
    ctx.fillStyle = "#bfafa3"; ctx.font = "600 12px Rajdhani, sans-serif";
    if (pts.length < 2) {
      ctx.fillText(t(this.profileMode === "measure" ? L("Usa la regla (Mayús+clic en dos puntos) para ver el perfil del terreno entre ellos.", "Use the ruler (Shift+click two points) to see the terrain profile between them.") : L("Camina para registrar tu traza: se guarda un punto cada 12 m.", "Walk to record your track: a point is stored every 12 m.")), 12, H / 2);
      $("atlasStats").textContent = "";
      return;
    }
    let mn = Infinity, mx = -Infinity, up = 0, down = 0, maxG = 0;
    pts.forEach(([d, e], i) => {
      mn = Math.min(mn, e); mx = Math.max(mx, e);
      if (i) { const de = e - pts[i - 1][1], dd = d - pts[i - 1][0]; if (de > 0) up += de; else down -= de; if (dd > 5) maxG = Math.max(maxG, Math.abs(Math.atan2(de, dd)) / D2R); }
    });
    const pad = Math.max(5, (mx - mn) * 0.1), y0 = mn - pad, y1 = mx + pad, D = pts[pts.length - 1][0];
    const L0 = 52, R0 = 10, T0 = 18, B0 = 20;
    const X = (d) => L0 + (d / D) * (W - L0 - R0), Y = (e) => T0 + (1 - (e - y0) / (y1 - y0)) * (H - T0 - B0);
    ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const e = y0 + ((y1 - y0) * i) / 3, y = Y(e); ctx.beginPath(); ctx.moveTo(L0, y); ctx.lineTo(W - R0, y); ctx.stroke(); ctx.fillText(num(e, 0, lang) + " m", 4, y + 4); }
    ctx.fillText(t(title), L0, 12);
    ctx.fillText("0", L0, H - 5); ctx.textAlign = "right"; ctx.fillText(fmtDist(D, lang), W - R0, H - 5); ctx.textAlign = "left";
    const grd = ctx.createLinearGradient(0, T0, 0, H - B0); grd.addColorStop(0, "rgba(222,160,112,.55)"); grd.addColorStop(1, "rgba(222,160,112,.05)");
    ctx.beginPath(); ctx.moveTo(X(0), H - B0); pts.forEach(([d, e]) => ctx.lineTo(X(d), Y(e))); ctx.lineTo(X(D), H - B0); ctx.closePath(); ctx.fillStyle = grd; ctx.fill();
    ctx.beginPath(); pts.forEach(([d, e], i) => (i ? ctx.lineTo(X(d), Y(e)) : ctx.moveTo(X(d), Y(e)))); ctx.strokeStyle = "#DEA070"; ctx.lineWidth = 2; ctx.stroke();
    $("atlasStats").innerHTML = `${t(L("Distancia", "Distance"))} <b>${fmtDist(D, lang)}</b> · ${t(L("Desnivel", "Gain"))} <b>+${num(up, 0, lang)} m / −${num(down, 0, lang)} m</b> · ${t(L("Mín–máx", "Min–max"))} <b>${num(mn, 0, lang)} … ${num(mx, 0, lang)} m</b> · ${t(L("Pendiente máx.", "Max grade"))} <b>${num(maxG, 1, lang)}°</b>`;
  }

  // ---- exportar la traza -----------------------------------------------------------------
  exportCSV() {
    const tr = this.game.s.track || [], h0 = this.game.rules.time.start_local_time_h;
    const rows = ["t_mars_s,lmst,lat_deg,lon_east_deg,elev_m,x_east_m,z_south_m,metabolic_w,o2_pct"];
    for (const q of tr) {
      const ll = this.geo.toLatLon(q[1], q[2]), h = (h0 + q[0] / 3600) % 24;
      rows.push([q[0], `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`, ll.lat.toFixed(6), ll.lon.toFixed(6), q[3], q[1], q[2], q[4], q[5]].join(","));
    }
    const blob = new Blob([`# Marsift Survival Map - traza EVA (${this.game.bio.p.name}). Planetocentrico, lon Este, elevacion sobre el areoide MOLA.\n` + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "traza_eva_marte.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}
