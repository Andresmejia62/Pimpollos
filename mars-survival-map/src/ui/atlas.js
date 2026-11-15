// Atlas de Marte: mapa grande con tres niveles de datos reales y una sola proyeccion (equirectangular, lat/lon E):
//   1. Global  - MOLA (MGS) 8 pix/grado (~7,4 km/px)
//   2. Gale    - MOLA 64 pix/grado (~925 m/px)
//   3. Zona EVA - DTM HiRISE+CTX del juego (6 m/px) y ortoimagen CTX
// Incluye crateres, volcanes, misiones, fenomenos naturales con medidas de proteccion, traza de Curiosity,
// tu traza (tracking), regla de distancia de circulo maximo y perfil de elevacion.
import { t, getLang } from "../i18n.js";
import { assetUrl } from "../data.js";
import { MARS_GEO, wrapLon, gcDistance, gcBearing, gcInterpolate, pressureAt, columnMass, boilingPointC, fmtLat, fmtLon, fmtDMS, fmtDist, num } from "../geo.js";

const $ = (id) => document.getElementById(id);
const D2R = Math.PI / 180;
const M_PER_DEG = MARS_GEO.R_mean * D2R;
const L = (es, en) => ({ es, en });

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
    this.mode = "hypso";
    this.show = { grid: true, crater: true, volcano: true, region: true, canyon: true, polar: true, lander: true, phenomena: true, msl: true, drills: true, track: true, objectives: true, overlay: true };
    this.view = { lon: 137.8, lat: -5.0, s: 4 };
    this.measure = null;     // { a: {lat,lon}, b: {lat,lon} }
    this.measuring = false;
    this.selected = null;
    this.hover = null;
    this.hits = [];
    this.profileMode = "track";
    this.ready = this._load();
    this._bindDom();
  }

  async _load() {
    const J = (p) => fetch(assetUrl(p)).then((r) => r.json());
    const [meta, feat, trav, drills] = await Promise.all([J("atlas/atlas.json"), J("atlas/features.json"), J("atlas/msl_traverse.json"), J("atlas/msl_drills.json")]);
    this.meta = meta; this.feat = feat; this.trav = trav.points; this.drills = drills.drills;
    const [g, gale] = await Promise.all(meta.rasters.map((m) => loadRaster(m, meta.offset_m)));
    this.rGlobal = g; this.rGale = gale;
    this.optical = new Image(); this.optical.src = assetUrl("layers/optical.png");
    this.overlays = {};
    ["slope", "radiation", "thermal", "spectral"].forEach((k) => { const im = new Image(); im.src = assetUrl(`layers/${k}_overlay.png`); this.overlays[k] = im; });
    this.optical.onload = () => this.dirty = true;
    this._shade(this.rGlobal, 18);
    this._shade(this.rGale, 4);
    this._paint();
    this._buildSide();
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
        const s = P ? 0.55 + 0.45 * shade[i] : this.mode === "mars" ? 0.2 + 0.85 * shade[i] : 0.35 + 0.7 * shade[i];
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
    this._legend();
    this.dirty = true;
  }

  // ---- DOM y controles ------------------------------------------------------------
  _bindDom() {
    this.cv = $("atlasCanvas");
    this.ctx = this.cv.getContext("2d");
    this.pcv = $("atlasProfile");
    const cv = this.cv;
    let drag = null, moved = 0;
    const touches = new Map();
    let pinch = 0;
    cv.addEventListener("pointerdown", (e) => {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      drag = [e.clientX, e.clientY]; moved = 0; pinch = 0; cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("pointercancel", (e) => { touches.delete(e.pointerId); drag = null; });
    cv.addEventListener("pointermove", (e) => {
      const p = this._evt(e);
      this.hover = this.unproject(p.x, p.y);
      if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
      // pellizco con dos dedos: zoom alrededor del punto medio
      if (touches.size === 2) {
        const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const r = this.cv.getBoundingClientRect();
        if (pinch) this.zoomAt((a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top, d / pinch);
        pinch = d; moved = 99; drag = null;
        return;
      }
      if (drag) {
        const dx = e.clientX - drag[0], dy = e.clientY - drag[1];
        moved += Math.abs(dx) + Math.abs(dy);
        this.view.lon -= dx / this.view.s; this.view.lat += dy / this.view.s;
        this._clampView();
        drag = [e.clientX, e.clientY];
      }
      this._readout();
      this.dirty = true;
    });
    cv.addEventListener("pointerup", (e) => {
      touches.delete(e.pointerId);
      if (drag && moved < 5) this._click(this._evt(e), e.shiftKey);
      drag = null;
    });
    $("atlasZoomIn").onclick = () => this.zoomAt(this.W / 2, this.H / 2, 1.8);
    $("atlasZoomOut").onclick = () => this.zoomAt(this.W / 2, this.H / 2, 1 / 1.8);
    cv.addEventListener("pointerleave", () => { this.hover = null; this._readout(); });
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
      if (e.key === "+" || e.key === "=") this.zoomAt(this.W / 2, this.H / 2, 1.5);
      if (e.key === "-") this.zoomAt(this.W / 2, this.H / 2, 1 / 1.5);
    });
  }

  _evt(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  _resize() {
    const r = this.cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = r.width; this.H = r.height; this.dpr = dpr;
    this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
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
    const v = this.view;
    let dl = lon - v.lon;
    if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
    return { x: this.W / 2 + dl * v.s, y: this.H / 2 - (lat - v.lat) * v.s };
  }
  unproject(x, y) {
    const v = this.view;
    const lat = v.lat - (y - this.H / 2) / v.s;
    if (lat > 90 || lat < -90) return null;
    return { lat, lon: wrapLon(v.lon + (x - this.W / 2) / v.s) };
  }
  zoomAt(x, y, k) {
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
  flyTo(lat, lon, s) {
    const a = { ...this.view }, t0 = performance.now(), dur = 900;
    let dl = lon - a.lon; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
    const step = (now) => {
      const u = Math.min(1, (now - t0) / dur), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      this.view.lon = a.lon + dl * e; this.view.lat = a.lat + (lat - a.lat) * e;
      this.view.s = Math.exp(Math.log(a.s) + (Math.log(s) - Math.log(a.s)) * e);
      this._clampView(); this.dirty = true;
      if (u < 1 && this.isOpen) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  go(where) {
    const me = this.playerLL();
    const fit = (km) => Math.min(this.W, this.H) / (km * 1000 / M_PER_DEG);
    if (where === "global") this.flyTo(0, me.lon, this.minS);
    else if (where === "gale") this.flyTo(-5.2, 137.6, fit(260));
    else if (where === "eva") { const b = this.geo.bounds; this.flyTo((b.north_lat + b.south_lat) / 2, (b.west_lon_east + b.east_lon_east) / 2, fit(7)); }
    else if (where === "me") this.flyTo(me.lat, me.lon, Math.max(this.view.s, fit(1.5)));
  }

  open(where = "eva") {
    this.isOpen = true;
    $("scrAtlas").hidden = false;
    this._resize();
    this.ready.then(() => {
      if (!this._opened) { this._opened = true; const b = this.geo.bounds; this.view = { lat: (b.north_lat + b.south_lat) / 2, lon: (b.west_lon_east + b.east_lon_east) / 2, s: 4 }; this._resize(); }
      this.go(where);
      this._profile();
      this._info();
      this._readout();
    });
    this._hint();
    const loop = () => { if (!this.isOpen) return; if (this.dirty) this.render(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  close() { this.isOpen = false; $("scrAtlas").hidden = true; this.onClose && this.onClose(); }
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

  render() {
    this.dirty = false;
    const ctx = this.ctx, W = this.W, H = this.H, v = this.view;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#0b0809"; ctx.fillRect(0, 0, W, H);
    if (!this.rGlobal) { ctx.fillStyle = "#bfafa3"; ctx.font = "16px Inter, sans-serif"; ctx.fillText(t(L("Cargando MOLA…", "Loading MOLA…")), 20, 30); return; }
    this.hits = [];
    ctx.imageSmoothingEnabled = v.s < 40;
    const G = this.rGlobal, R = this.rGale;
    this._drawGeoImage(G.canvas, 0, 90, 360, 180, G.w, G.h);
    ctx.imageSmoothingEnabled = true;
    if (v.s > 30) this._drawGeoImage(R.canvas, R.lon_west, R.lat_north, R.w / R.ppd, R.h / R.ppd, R.w, R.h, Math.min(1, (v.s - 30) / 30));
    const b = this.geo.bounds;
    if (v.s > 1500 && this.optical.complete) {
      const a = Math.min(1, (v.s - 1500) / 1500);
      this._drawGeoImage(this.optical, b.west_lon_east, b.north_lat, b.east_lon_east - b.west_lon_east, b.north_lat - b.south_lat, this.optical.naturalWidth, this.optical.naturalHeight, a);
      const ov = this.show.overlay && this.game.s.layer && this.overlays[this.game.s.layer];
      if (ov && ov.complete) this._drawGeoImage(ov, b.west_lon_east, b.north_lat, b.east_lon_east - b.west_lon_east, b.north_lat - b.south_lat, ov.naturalWidth, ov.naturalHeight, a * 0.9);
    }
    if (this.show.grid) this._graticule();
    this._rect(R.lat_north, R.lon_west, R.lat_north - R.h / R.ppd, R.lon_west + R.w / R.ppd, "rgba(255,255,255,.25)", [4, 4], v.s > 8 && v.s < 400 ? "MOLA 64 px/°" : null);
    this._rect(b.north_lat, b.west_lon_east, b.south_lat, b.east_lon_east, "#7FD1FF", [6, 4], v.s < 6000 ? t(L("Zona EVA (6 m/px)", "EVA zone (6 m/px)")) : null);
    if (this.show.phenomena) this._phenomena();
    this._features();
    if (this.show.msl && v.s > 150) this._mslTraverse();
    if (this.show.drills && v.s > 2500) this._drills();
    if (this.show.objectives && v.s > 1500) this._objectives();
    if (this.show.track) this._track();
    this._player();
    this._measure();
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
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.setLineDash([]);
    if (label && b.x - a.x > 4) { ctx.fillStyle = color; ctx.font = "600 12px Rajdhani, sans-serif"; ctx.shadowColor = "#000"; ctx.shadowBlur = 3; ctx.fillText(label, a.x + 2, a.y - 4); ctx.shadowBlur = 0; }
  }

  _kmToPx(km) { return (km * 1000 / M_PER_DEG) * this.view.s; }

  _features() {
    const ctx = this.ctx, v = this.view, cats = this.feat.categories;
    for (const f of this.feat.features) {
      if (!this.show[f.cat]) continue;
      const p = this.project(f.lat, f.lon);
      if (p.x < -400 || p.x > this.W + 400 || p.y < -400 || p.y > this.H + 400) continue;
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
        if (rpx > 30) { ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(p.x, p.y, rpx, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
        r = s;
      } else if (f.cat === "crater" || f.cat === "polar") {
        r = Math.max(5, rpx);
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke();
        if (rpx < 5) { ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 7); ctx.fill(); }
      } else {
        r = Math.max(5, rpx);
        if (rpx > 12) { ctx.setLineDash([2, 6]); ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(p.x, p.y, rpx, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]); }
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fill();
        r = 8;
      }
      this.hits.push({ x: p.x, y: p.y, r: Math.max(9, Math.min(r, 30)), item: { kind: "feature", f } });
      // a poca escala solo se rotulan los rasgos grandes, para no saturar el mapa
      if (f.cat !== "lander") show = sel || rpx > 16 || v.s > 14;
      if (show && (rpx < this.W * 0.9)) this._label(t(f.name), p.x + Math.min(r, 60) * 0.72 + 4, p.y - Math.min(r, 60) * 0.72, col, f.cat === "region" || f.cat === "canyon");
    }
  }

  _label(text, x, y, color = "#fff", italic = false, size = 13) {
    const ctx = this.ctx;
    ctx.font = `${italic ? "italic " : ""}600 ${size}px Rajdhani, sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  _phenomena() {
    const ctx = this.ctx;
    this.feat.phenomena.forEach((ph, idx) => {
      const sel = this.selected && this.selected.ph === ph;
      ph.zones.forEach((z) => {
        const p = this.project(z.lat, z.lon), r = Math.max(10, this._kmToPx(z.r_km));
        if (p.x + r < 0 || p.x - r > this.W || p.y + r < 0 || p.y - r > this.H) return;
        ctx.globalAlpha = sel ? 0.28 : 0.13; ctx.fillStyle = ph.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
        ctx.globalAlpha = sel ? 1 : 0.7; ctx.strokeStyle = ph.color; ctx.lineWidth = sel ? 2.5 : 1.2; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        // insignia numerada en el borde de la zona
        const bx = p.x + r * 0.7, by = p.y - r * 0.7;
        ctx.fillStyle = ph.color; ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(bx, by, 10, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#111"; ctx.font = "700 12px Rajdhani, sans-serif"; ctx.textAlign = "center"; ctx.fillText(String(idx + 1), bx, by + 4); ctx.textAlign = "left";
        this.hits.push({ x: bx, y: by, r: 12, item: { kind: "phenomenon", ph, zone: z } });
        if (sel || this.view.s > 6) this._label(t(z.label), bx + 13, by + 4, ph.color, false, 12);
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
      this._label(`Curiosity · sol ${last[3]}`, p.x + 6, p.y + 14, "#ffd250", false, 12);
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
      if (this.view.s > 9000) this._label(`${d.name} · sol ${d.sol}`, p.x + 6, p.y - 5, "#fff", false, 12);
    }
  }

  _objectives() {
    const ctx = this.ctx, tg = this.game.target;
    for (const o of this.data.objectives.objectives) {
      const p = this.project(o.latlon[0], o.latlon[1]);
      const isT = tg && tg.id === o.id;
      ctx.lineWidth = 2.5; ctx.strokeStyle = isT ? "#3DDC97" : o.type === "science" ? "#fff" : "#3DDC97";
      if (o.type === "science") { ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, 7); ctx.stroke(); }
      else ctx.strokeRect(p.x - 7, p.y - 7, 14, 14);
      if (isT) { ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, 7); ctx.stroke(); }
      this.hits.push({ x: p.x, y: p.y, r: 11, item: { kind: "objective", o } });
      if (this.view.s > 2500) this._label(t(o.name), p.x + 12, p.y + 4, isT ? "#3DDC97" : "#fff");
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
    this._label(t(L("Tú", "You")) + ` · ${this.game.bio.p.name}`, p.x + 14, p.y + 18, "#7FD1FF");
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
      this._label(`${fmtDist(gcDistance(m.a.lat, m.a.lon, b.lat, b.lon), lang)} · ${num(gcBearing(m.a.lat, m.a.lon, b.lat, b.lon), 1, lang)}°`, p.x + 10, p.y - 10, "#FFC23D", false, 14);
    }
  }

  _scaleBar() {
    const ctx = this.ctx, v = this.view;
    const mPerPx = M_PER_DEG / v.s * Math.cos(v.lat * D2R);
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
    this.dirty = true;
  }

  _hint() {
    const m = this.measure;
    $("atlasHint").textContent = this.measuring
      ? t(!m || m.b ? L("Regla: haz clic en el punto de inicio", "Ruler: click the start point") : L("Regla: haz clic en el punto final", "Ruler: click the end point"))
      : t(L("Arrastra para mover · rueda para acercar · clic en un símbolo para ver datos · Mayús+clic para medir", "Drag to pan · wheel to zoom · click a symbol for data · Shift+click to measure"));
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
        <tr><td>${t(L("T. suelo (ahora)", "Ground T (now)"))}</td><td>${num(W.temperature(x, z, this.game.hour), 0, lang)} °C</td></tr>
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
        <h3>${t(L("Tu posición", "Your position"))}</h3>${this._pointBlock(this.playerLL().lat, this.playerLL().lon)}`;
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
    if (sel.kind === "objective") {
      const o = sel.o;
      box.innerHTML = `<div class="eyebrow ok">${t(L("Objetivo de la misión", "Mission objective"))}</div><h2>${t(o.name)}</h2>
        <p class="fact">${o.science || o.notes || ""}</p>${o.analog ? `<p class="small muted">${o.analog}</p>` : ""}${this._pointBlock(o.latlon[0], o.latlon[1])}`;
      return;
    }
    if (sel.kind === "player") { this.selected = null; this._info(); return; }
    if (sel.kind === "point") box.innerHTML = `<div class="eyebrow">${t(L("Punto", "Point"))}</div>${this._pointBlock(sel.ll.lat, sel.ll.lon)}`;
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
      <span class="muted">${t(L("zoom", "zoom"))} ${num(this.view.s, this.view.s < 10 ? 1 : 0, lang)} px/°</span>`;
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
    $("atlasMode").innerHTML = Object.entries(MODES).map(([k, v]) => `<option value="${k}" ${k === this.mode ? "selected" : ""}>${t(v)}</option>`).join("");
  }
  applyLang() { if (this.feat) { this._buildSide(); this._legend(); this._info(); this._hint(); this._profile(); this.dirty = true; } }

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
    const blob = new Blob([`# Mars Survival Map - traza EVA (${this.game.bio.p.name}). Planetocentrico, lon Este, elevacion sobre el areoide MOLA.\n` + rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "traza_eva_marte.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}
