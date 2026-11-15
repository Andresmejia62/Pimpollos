// Pantalla de perfil fisico del astronauta: masa, estatura, edad, sexo, condicion fisica (VO2max) y traje.
// Muestra en vivo lo que cambia en Marte: peso, velocidad maxima de marcha (Froude), gasto metabolico,
// consumo de O2 y autonomia estimada del traje.
import { t, getLang } from "../i18n.js";
import { Physiology, REF, REF_FLAT_W, SUITS, PRESETS, LIMITS, NASA_HEIGHT, loadProfile, saveProfile, sanitize } from "../engine/physiology.js";
import { num } from "../geo.js";
import * as THREE from "three";
import { Astronaut, LOOK_OPTIONS } from "../engine/astronaut.js";
import { DIFFS, loadDiff, saveDiff } from "../gameplay/difficulty.js";

const $ = (id) => document.getElementById(id);
const L = (es, en) => ({ es, en });
const D2R = Math.PI / 180;

const FIELDS = [
  ["mass", L("Masa corporal", "Body mass"), "kg", 1],
  ["height", L("Estatura", "Height"), "cm", 1],
  ["age", L("Edad", "Age"), L("años", "years"), 1],
  ["vo2max", L("Condición física (VO₂max)", "Fitness (VO₂max)"), "ml/kg/min", 1],
];
const PRESET_NAMES = {
  ref: L("Referencia (75 kg, 175 cm)", "Reference (75 kg, 175 cm)"),
  small: L("Astronauta bajita (56 kg, 160 cm)", "Short astronaut (56 kg, 160 cm)"),
  tall: L("Astronauta alto (92 kg, 190 cm)", "Tall astronaut (92 kg, 190 cm)"),
  athlete: L("Atleta (VO₂max 58)", "Athlete (VO₂max 58)"),
  apollo: L("Estilo Apollo (traje A7LB)", "Apollo-style (A7LB suit)"),
};

const LOOK_LABELS = {
  suit: L("Color del traje", "Suit color"), accent: L("Franjas de misión", "Mission stripes"),
  visor: L("Visera", "Visor"), skin: L("Tono de piel", "Skin tone"),
  lamps: L("Lámparas del casco", "Helmet lamps"), antenna: L("Antena", "Antenna"), crest: L("Cresta del casco", "Helmet crest"),
};

export class ProfileScreen {
  constructor(o2CapacityG) {
    this.diff = loadDiff();
    this.capBase = o2CapacityG / this.diff.o2K;   // capacidad del traje sin el ajuste de dificultad
    this.capG = o2CapacityG;
    this.p = loadProfile();
    this.onConfirm = null;
    $("btnProfileGo").onclick = () => { saveProfile(this.p); this._close(); this.onConfirm && this.onConfirm(this.p); };
    $("btnProfileBack").onclick = () => { this._close(); this.onBack && this.onBack(); };
  }

  open() { $("scrProfile").hidden = false; this.render(); this._startPreview(); }
  _close() { $("scrProfile").hidden = true; this._stopPreview(); }

  // ---- apariencia ------------------------------------------------------------------------
  _lookHtml() {
    const l = this.p.look, O = LOOK_OPTIONS;
    const sw = (k, withName = true) => `<div class="pf-row"><span>${t(LOOK_LABELS[k])}</span><div class="swatches">${Object.entries(O[k]).map(([id, o]) =>
      `<button type="button" class="sw${o.clear ? " clear" : ""}" data-look="${k}" data-v="${id}" aria-pressed="${l[k] === id}" style="--c:${o.hex}" title="${withName && o.name ? t(o.name) : ""}" aria-label="${withName && o.name ? t(o.name) : id}"></button>`).join("")}</div></div>`;
    const tg = (k) => `<label class="tog"><input type="checkbox" data-flag="${k}" ${l[k] ? "checked" : ""}> ${t(LOOK_LABELS[k])}</label>`;
    return `<div class="pf-look">
      <div class="kv-h">${t(L("Apariencia", "Appearance"))}</div>
      <div class="pf-look-grid">
        <canvas id="pfAvatar" aria-label="${t(L("Vista previa del astronauta", "Astronaut preview"))}"></canvas>
        <div>
          ${sw("suit")}${sw("accent")}${sw("visor")}
          ${O.visor[l.visor].clear ? sw("skin", false) : ""}
          <div class="pf-row"><span>${t(L("Accesorios", "Accessories"))}</span><div class="togs">${tg("lamps")}${tg("antenna")}${tg("crest")}</div></div>
          <p class="small muted">${t(L("Arrastra la vista previa para girarla. La apariencia no cambia la fisiología.", "Drag the preview to rotate it. Appearance does not change physiology."))}</p>
        </div>
      </div></div>`;
  }

  _bindLook() {
    const f = $("pfForm");
    f.querySelectorAll("[data-look]").forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.look, wasClear = LOOK_OPTIONS.visor[this.p.look.visor].clear;
        this.p.look = { ...this.p.look, [k]: b.dataset.v };
        if (k === "visor" && !!LOOK_OPTIONS.visor[b.dataset.v].clear !== !!wasClear) { this.render(); this._startPreview(); return; }
        f.querySelectorAll(`[data-look="${k}"]`).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        this._applyPreview();
      };
    });
    f.querySelectorAll("[data-flag]").forEach((c) => { c.onchange = () => { this.p.look = { ...this.p.look, [c.dataset.flag]: c.checked }; this._applyPreview(); }; });
  }

  _startPreview() {
    const cv = $("pfAvatar");
    if (!cv) return;
    if (!this.pv) {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight("#ffe7d1", "#5a3020", 1.4));
      const sun = new THREE.DirectionalLight("#fff1dc", 2.6); sun.position.set(-2, 4, -3); scene.add(sun);
      const rim = new THREE.DirectionalLight("#ff9a5c", 1.2); rim.position.set(3, 2, 3); scene.add(rim);
      const ground = new THREE.Mesh(new THREE.CircleGeometry(1.1, 40), new THREE.MeshStandardMaterial({ color: "#8a5536", roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; scene.add(ground);
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
      camera.position.set(0, 1.25, -4.4); camera.lookAt(0, 0.95, 0);
      const astro = new Astronaut(scene);
      this.pv = { renderer, scene, camera, astro, yaw: -0.5, drag: null, t: performance.now() };
    }
    const pv = this.pv;
    // el canvas se recrea en cada render(): se reemplaza por el del renderer
    pv.renderer.domElement.id = "pfAvatar";
    pv.renderer.domElement.className = cv.className;
    cv.replaceWith(pv.renderer.domElement);
    const el = pv.renderer.domElement;
    el.onpointerdown = (e) => { pv.drag = e.clientX; el.setPointerCapture(e.pointerId); };
    el.onpointermove = (e) => { if (pv.drag != null) { pv.yaw += (e.clientX - pv.drag) * 0.012; pv.drag = e.clientX; } };
    el.onpointerup = el.onpointercancel = () => { pv.drag = null; };
    this._applyPreview();
    if (!pv.raf) {
      const loop = (now) => {
        pv.raf = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - pv.t) / 1000); pv.t = now;
        const r = el.getBoundingClientRect();
        if (!r.width) return;
        const w = Math.round(r.width), h = Math.round(r.height);
        if (el.width !== Math.round(w * pv.renderer.getPixelRatio()) || el.height !== Math.round(h * pv.renderer.getPixelRatio())) {
          pv.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
          pv.renderer.setSize(w, h, false); pv.camera.aspect = w / h; pv.camera.updateProjectionMatrix();
        }
        if (pv.drag == null) pv.yaw += dt * 0.3;
        pv.astro.update(dt, 0, 0, 0, 0, pv.yaw, 0);
        pv.renderer.render(pv.scene, pv.camera);
      };
      pv.raf = requestAnimationFrame(loop);
    }
  }

  _applyPreview() {
    if (!this.pv) return;
    this.pv.astro.setLook(this.p.look);
    this.pv.astro.setBuild(this.p.mass, this.p.height);
    // encuadre: la camara sigue la estatura para que el astronauta quepa siempre
    const k = this.p.height / 175;
    this.pv.camera.position.set(0, 1.25 * k, -4.4 * k); this.pv.camera.lookAt(0, 0.95 * k, 0);
  }

  _stopPreview() { if (this.pv && this.pv.raf) { cancelAnimationFrame(this.pv.raf); this.pv.raf = 0; } }

  render() {
    const p = this.p;
    const row = ([k, lab, unit, step]) => `<label class="pf-row"><span>${t(lab)}</span>
      <input type="range" min="${LIMITS[k][0]}" max="${LIMITS[k][1]}" step="${step}" value="${p[k]}" data-k="${k}">
      <input type="number" min="${LIMITS[k][0]}" max="${LIMITS[k][1]}" step="${step}" value="${p[k]}" data-k="${k}"><i>${t(unit)}</i></label>`;
    $("pfForm").innerHTML = `
      <div class="pf-row"><span>${t(L("Dificultad", "Difficulty"))}</span>
        <div class="seg">${Object.values(DIFFS).map((d) => `<button type="button" data-diff="${d.id}" aria-pressed="${d.id === this.diff.id}">${t(d.name)}</button>`).join("")}</div></div>
      <p class="small muted pf-diff" id="pfDiffDesc">${t(this.diff.desc)}</p>
      <label class="pf-row"><span>${t(L("Perfil rápido", "Quick profile"))}</span><select id="pfPreset"><option value="">—</option>${Object.keys(PRESETS).map((k) => `<option value="${k}">${t(PRESET_NAMES[k])}</option>`).join("")}</select></label>
      <label class="pf-row"><span>${t(L("Indicativo", "Call sign"))}</span><input type="text" maxlength="16" value="${p.name}" id="pfName"></label>
      ${FIELDS.map(row).join("")}
      <div class="pf-row"><span>${t(L("Sexo (metabolismo basal)", "Sex (basal metabolism)"))}</span>
        <div class="seg"><button type="button" data-sex="f" aria-pressed="${p.sex === "f"}">${t(L("Femenino", "Female"))}</button><button type="button" data-sex="m" aria-pressed="${p.sex === "m"}">${t(L("Masculino", "Male"))}</button></div></div>
      <label class="pf-row"><span>${t(L("Traje", "Suit"))}</span><select id="pfSuit">${Object.entries(SUITS).map(([k, s]) => `<option value="${k}" ${k === p.suit ? "selected" : ""}>${t(s.name)}</option>`).join("")}</select></label>
      ${this._lookHtml()}`;
    const f = $("pfForm");
    f.querySelectorAll("input[data-k]").forEach((inp) => {
      inp.oninput = () => {
        this.p = sanitize({ ...this.p, [inp.dataset.k]: +inp.value });
        f.querySelectorAll(`input[data-k="${inp.dataset.k}"]`).forEach((o) => { if (o !== inp) o.value = this.p[inp.dataset.k]; });
        this._out();
        if (inp.dataset.k === "mass" || inp.dataset.k === "height") this._applyPreview();
      };
    });
    $("pfName").oninput = (e) => { this.p.name = e.target.value || "EVA-1"; };
    $("pfSuit").onchange = (e) => { this.p.suit = e.target.value; this._out(); };
    $("pfPreset").onchange = (e) => { if (PRESETS[e.target.value]) { this.p = { ...PRESETS[e.target.value], name: this.p.name, look: this.p.look }; this.render(); this._startPreview(); } };
    this._bindLook();
    f.querySelectorAll("[data-diff]").forEach((b) => {
      b.onclick = () => {
        const d = DIFFS[b.dataset.diff];
        this.diff = d; saveDiff(d.id);
        this.capG = this.capBase * d.o2K;
        f.querySelectorAll("[data-diff]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        $("pfDiffDesc").textContent = t(d.desc);
        this.onDiff && this.onDiff(d);
        this._out();
      };
    });
    f.querySelectorAll("[data-sex]").forEach((b) => { b.onclick = () => { this.p.sex = b.dataset.sex; f.querySelectorAll("[data-sex]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); this._out(); }; });
    this._out();
  }

  _out() {
    const b = new Physiology(this.p), lang = getLang(), S = b.summary();
    const hrs = (M) => (this.capG / b.o2gPerH(M));
    const pct = (M) => Math.round(b.pctVO2max(M) * 100);
    const cmp = (v, r, d = 0, inv = false) => {
      const k = v / r - 1;
      if (Math.abs(k) < 0.02) return "";
      const bad = inv ? k < 0 : k > 0;
      return `<i class="${bad ? "bad" : "good"}">${k > 0 ? "+" : ""}${Math.round(k * 100)} %</i>`;
    };
    const warn = [];
    if (!b.fitOK) warn.push(t(L(`Fuera del rango de estatura de NASA (${NASA_HEIGHT[0]}–${NASA_HEIGHT[1]} cm): el traje no ajusta bien y el gasto sube un 8 %.`, `Outside NASA's height range (${NASA_HEIGHT[0]}–${NASA_HEIGHT[1]} cm): the suit fits poorly and energy cost rises 8 %.`)));
    if (b.bmi < 18.5 || b.bmi > 30) warn.push(t(L("IMC fuera del rango saludable (18,5–30).", "BMI outside the healthy range (18.5–30).")));
    if (this.p.suit !== "mars") warn.push(t(L(`Traje de ${SUITS[this.p.suit].mass} kg: en Marte pesa ${num(SUITS[this.p.suit].mass * 0.379, 0, lang)} kg-fuerza extra. En la prueba automática de la campaña completa no se terminó ni recargando en los refugios: modo muy difícil. Por eso los trajes para Marte se diseñan más ligeros.`, `${SUITS[this.p.suit].mass} kg suit: on Mars it adds ${num(SUITS[this.p.suit].mass * 0.379, 0, lang)} kg-force. In the automated full-campaign test it could not be finished even with shelter recharges: very hard mode. That's why Mars suits are designed lighter.`)));
    if (pct(S.up10) > 75) warn.push(t(L("Subir pendientes de 10° te lleva a más del 75 % de tu VO₂max: te fatigarás rápido.", "Climbing 10° slopes takes you above 75 % of your VO₂max: you will tire quickly.")));
    $("pfOut").innerHTML = `
      <table class="kv">
        <tr><th colspan="2">${t(L("Cuerpo en Marte (0,379 g)", "Body on Mars (0.379 g)"))}</th></tr>
        <tr><td>${t(L("Masa con traje y equipo", "Mass with suit and kit"))}</td><td>${num(b.total, 0, lang)} kg <span class="muted">(${t(L("inercia igual que en la Tierra", "same inertia as on Earth"))})</span></td></tr>
        <tr><td>${t(L("Peso en Marte", "Weight on Mars"))}</td><td>${num(b.weightMarsN, 0, lang)} N <span class="muted">${t(L("= pesar", "= weighing"))} ${num(b.total * 0.379, 1, lang)} kg ${t(L("en la Tierra", "on Earth"))}</span></td></tr>
        <tr><td>IMC · ${t(L("superficie corporal", "body surface"))}</td><td>${num(b.bmi, 1, lang)} · ${num(b.bsa, 2, lang)} m² ${cmp(b.bsa, REF.bsa)}</td></tr>
        <tr><td>${t(L("Metabolismo basal", "Basal metabolism"))}</td><td>${num(b.bmrKcal, 0, lang)} kcal/${t(L("día", "day"))} (${num(b.bmrW, 0, lang)} W)</td></tr>
        <tr><td>${t(L("Pierna · marcha máx. (Froude 0,5)", "Leg · max walk (Froude 0.5)"))}</td><td>${num(b.leg * 100, 0, lang)} cm · ${num(b.vMaxWalk, 2, lang)} m/s <span class="muted">(${t(L("Tierra", "Earth"))} ${num(b.vEarthMaxWalk, 2, lang)})</span></td></tr>
        <tr><td>${t(L("Velocidad de marcha en el juego", "Walking speed in game"))}</td><td>${num(b.vDesign, 2, lang)} m/s ${cmp(b.vDesign, REF.vDesign, 0, true)}</td></tr>
        <tr><td>${t(L("FC reposo · máx.", "HR rest · max"))}</td><td>${Math.round(b.hrRest)} · ${Math.round(b.hrMax)} ${t(L("lpm", "bpm"))}</td></tr>
        <tr><th colspan="2">${t(L("Gasto en EVA (con traje)", "EVA cost (suited)"))}</th></tr>
        <tr><td>${t(L("De pie / quieto", "Standing still"))}</td><td>${num(S.rest, 0, lang)} W · ${pct(S.rest)} % VO₂max</td></tr>
        <tr><td>${t(L("Caminando en llano", "Walking, flat"))}</td><td>${num(S.flat, 0, lang)} W · ${pct(S.flat)} % ${cmp(S.flat, REF_FLAT_W)}</td></tr>
        <tr><td>${t(L("Subiendo 10°", "Climbing 10°"))}</td><td>${num(S.up10, 0, lang)} W · ${pct(S.up10)} %</td></tr>
        <tr><td>${t(L("Bajando 10°", "Descending 10°"))}</td><td>${num(S.down10, 0, lang)} W · ${pct(S.down10)} %</td></tr>
        <tr><td>${t(L("Arena de duna", "Dune sand"))}</td><td>${num(S.dune, 0, lang)} W · ${pct(S.dune)} %</td></tr>
        <tr><td>${t(L("O₂ caminando en llano", "O₂ walking flat"))}</td><td>${num(b.o2gPerH(S.flat), 0, lang)} g/h · CO₂ ${num(b.co2gPerH(S.flat), 0, lang)} g/h</td></tr>
        <tr><td>${t(L("Autonomía del O₂ (llano · quieto)", "O₂ endurance (flat · still)"))}</td><td><b>${num(hrs(S.flat), 1, lang)} h</b> · ${num(hrs(S.rest), 1, lang)} h</td></tr>
      </table>
      <canvas id="pfChart" height="150"></canvas>
      <p class="small muted">${t(L("Gráfica: potencia metabólica según la pendiente a tu velocidad de marcha (línea discontinua = referencia). Modelo: Pandolf et al. 1977 a 0,379 g, Mifflin-St Jeor, Norcross et al. 2010 (traje). Ver docs/fisiologia.md.", "Chart: metabolic power vs slope at your walking speed (dashed = reference). Model: Pandolf et al. 1977 at 0.379 g, Mifflin-St Jeor, Norcross et al. 2010 (suit). See docs/fisiologia.md."))}</p>
      ${warn.map((w) => `<p class="pf-warn">${w}</p>`).join("")}`;
    this._chart(b);
  }

  _chart(b) {
    const cv = $("pfChart"), r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(150 * dpr);
    const ctx = cv.getContext("2d"), W = r.width, H = 150;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const deg = [];
    for (let d = -20; d <= 25; d += 1) deg.push(d);
    const curve = (bio) => deg.map((d) => bio.metabolic(bio.vDesign * Math.max(0.5, Math.min(1, 1 - (Math.abs(d) - 12) / 26)), Math.tan(d * D2R)));
    const a = curve(b), ref = curve(REF);
    const mx = Math.max(...a, ...ref) * 1.08;
    const L0 = 44, B0 = 18, X = (d) => L0 + ((d + 20) / 45) * (W - L0 - 8), Y = (w) => 8 + (1 - w / mx) * (H - B0 - 8);
    ctx.font = "600 11px Rajdhani, sans-serif"; ctx.fillStyle = "#bfafa3"; ctx.strokeStyle = "rgba(255,255,255,.12)";
    for (let w = 0; w <= mx; w += 200) { ctx.beginPath(); ctx.moveTo(L0, Y(w)); ctx.lineTo(W - 8, Y(w)); ctx.stroke(); ctx.fillText(`${w} W`, 2, Y(w) + 4); }
    for (const d of [-20, -10, 0, 10, 20]) ctx.fillText(`${d}°`, X(d) - 8, H - 4);
    // umbral de fatiga (55 % VO2max)
    const thr = (0.55 * b.p.vo2max * b.W) / 1000 / 60 * 20100;
    ctx.strokeStyle = "rgba(255,77,77,.7)"; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(L0, Y(thr)); ctx.lineTo(W - 8, Y(thr)); ctx.stroke();
    ctx.fillStyle = "#FF4D4D"; ctx.fillText(t(L("umbral de fatiga (55 % VO₂max)", "fatigue threshold (55 % VO₂max)")), L0 + 4, Y(thr) - 4);
    ctx.setLineDash([5, 4]); ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 1.5; ctx.beginPath(); ref.forEach((w, i) => (i ? ctx.lineTo(X(deg[i]), Y(w)) : ctx.moveTo(X(deg[i]), Y(w)))); ctx.stroke();
    ctx.setLineDash([]); ctx.strokeStyle = "#DEA070"; ctx.lineWidth = 2.5; ctx.beginPath(); a.forEach((w, i) => (i ? ctx.lineTo(X(deg[i]), Y(w)) : ctx.moveTo(X(deg[i]), Y(w)))); ctx.stroke();
  }
}
