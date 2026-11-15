// Pantalla de carga y menu de pausa.
import { t, ui, getLang } from "../i18n.js";
import { marsNow, seasonOf, hhmm } from "../marsclock.js";
import { gcDistance, gcBearing, fmtLat, fmtLon, fmtDist, num } from "../geo.js";
import { SUITS } from "../engine/physiology.js";
import { marsSkyEphemeris, NAKED_EYE, DUST_NOTE } from "../engine/planets.js";
import { REFERENCE_EVENT, LEVEL_TEXT, LEVEL_COLOR } from "../spaceweather.js";

const $ = (id) => document.getElementById(id);
const L = (es, en) => ({ es, en });
const Q_RAD = 3.05;

// Bloque "Marte ahora mismo" (comun a la carga y a la pausa)
function marsNowRows() {
  const m = marsNow(), lang = getLang();
  return [
    [L("Longitud solar (Ls)", "Solar longitude (Ls)"), `${num(m.ls, 1, lang)}° · ${t(seasonOf(m.ls))}`],
    [L("Distancia Tierra–Marte", "Earth–Mars distance"), `${num(m.distKm / 1e6, 1, lang)} M km · ${num(m.distAU, 3, lang)} UA`],
    [L("Retraso de la señal (solo ida)", "Signal delay (one way)"), `${num(m.lightMin, 1, lang)} min`],
    [L("Hora solar local en Gale", "Local solar time in Gale"), `${hhmm(m.lmstGale)} LMST · ${hhmm(m.ltstGale)} LTST`],
    [L("Sol de Curiosity", "Curiosity sol"), `${m.curiositySol} · MSD ${num(m.msd, 2, lang)}`],
    [L("Temporada de tormentas de polvo", "Dust storm season"), m.dustSeason ? t(L("sí (Ls 180°–360°)", "yes (Ls 180°–360°)")) : t(L("no (Ls 0°–180°)", "no (Ls 0°–180°)"))],
  ];
}

const TIPS = [
  L("Desde Marte la Tierra es un punto brillante azulado con la Luna al lado. Como Venus desde aquí, tiene fases y nunca se aleja mucho del Sol.", "From Mars, Earth is a bright bluish point with the Moon beside it. Like Venus seen from here, it shows phases and never strays far from the Sun."),
  L("Desde Marte se ven a simple vista Mercurio, Venus, la Tierra, Júpiter y Saturno. Urano está en el límite; Neptuno necesita telescopio.", "From Mars, Mercury, Venus, Earth, Jupiter and Saturn are visible to the naked eye. Uranus is at the limit; Neptune needs a telescope."),
  L("En Marte pesas el 38 %, pero tu masa es la misma: frenar y girar cuesta igual que en la Tierra y el suelo agarra menos.", "On Mars you weigh 38 %, but your mass is the same: stopping and turning cost as much as on Earth and the ground grips less."),
  L("La presión en Gale es de ~900 Pa, menos del 1 % de la terrestre. Sin traje la sangre herviría a 37 °C.", "Pressure in Gale is ~900 Pa, under 1 % of Earth's. Without a suit your blood would boil at 37 °C."),
  L("RAD, a bordo de Curiosity, mide 0,21 mGy al día en la superficie: unas 20 veces más que en la Tierra.", "RAD, aboard Curiosity, measures 0.21 mGy per day on the surface: about 20 times more than on Earth."),
  L("Un sol (día marciano) dura 24 h 39 min 35 s. El año marciano tiene 668,6 soles.", "A sol (Martian day) lasts 24 h 39 min 35 s. A Martian year has 668.6 sols."),
  L("El suelo de Gale pasa de ~0 °C al mediodía a ~−80 °C de madrugada: la calefacción del traje gasta batería.", "Gale's ground goes from ~0 °C at noon to ~−80 °C before dawn: suit heating drains the battery."),
  L("Perseverance lleva un generador de plutonio-238 (MMRTG): da ~110 W de día y de noche, sin depender del Sol.", "Perseverance carries a plutonium-238 generator (MMRTG): ~110 W day and night, independent of the Sun."),
  L("La suspensión rocker-bogie permite pasar rocas del tamaño de una rueda sin muelles: cada rueda sigue el terreno.", "The rocker-bogie suspension climbs rocks as large as a wheel without springs: each wheel follows the terrain."),
  L("El modelo de terreno de esta EVA coincide con la altura que midió Curiosity con una mediana de −0,25 m.", "This EVA's terrain model matches Curiosity's measured elevation with a median of −0.25 m."),
  L("Una persona alta camina más rápido en Marte: la velocidad máxima de marcha crece con la raíz de la longitud de la pierna.", "A tall person walks faster on Mars: maximum walking speed grows with the square root of leg length."),
];

export class LoadingScreen {
  constructor() {
    this.steps = [
      { id: "nav", keys: ["region", "layers", "rules", "objectives", "traverse"], label: L("Recorte geográfico y reglas de supervivencia", "Map region and survival rules") },
      { id: "dem", keys: ["dem"], label: L("Modelo de elevación HiRISE + CTX (6 m/px)", "HiRISE + CTX elevation model (6 m/px)") },
      { id: "grid", keys: ["grid"], label: L("Capas: pendiente · radiación RAD · THEMIS · CRISM", "Layers: slope · RAD radiation · THEMIS · CRISM") },
      { id: "story", keys: ["missions", "dialogs", "alerts", "facts"], label: L("Misiones, diálogos y alertas", "Missions, dialogues and alerts") },
      { id: "scene", keys: [], label: L("Terreno 3D, rover y estructuras", "3D terrain, rover and structures") },
    ];
    this.loaded = new Set();
    this.p = 0;
    $("loadSteps").innerHTML = this.steps.map((s) => `<li data-step="${s.id}"><i></i><span>${t(s.label)}</span></li>`).join("");
    document.querySelector(".load-title span").textContent = t(L("Aeolis Mons · cráter Gale", "Aeolis Mons · Gale crater"));
    document.querySelector(".globe-lbl").innerHTML = `4,59° S · 137,44° E<br><b>${t(L("CRÁTER GALE", "GALE CRATER"))}</b>`;
    $("loadNow").innerHTML = `<div class="ln-h">${t(L("Marte ahora mismo", "Mars right now"))}</div><dl>${marsNowRows().slice(0, 4).map(([k, v]) => `<dt>${t(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
    this.tip = Math.floor(Math.random() * TIPS.length);
    this._tip();
    this.timer = setInterval(() => this._tip(), 5000);
    this._mark();
  }
  _tip() {
    const el = $("loadTip");
    el.classList.remove("in");
    void el.offsetWidth;
    el.innerHTML = `<b>${t(L("¿Sabías que?", "Did you know?"))}</b> ${t(TIPS[this.tip++ % TIPS.length])}`;
    el.classList.add("in");
  }
  _mark() {
    let current = null;
    for (const s of this.steps) {
      const done = s.id === "scene" ? this.sceneDone : s.keys.every((k) => this.loaded.has(k));
      const li = document.querySelector(`[data-step="${s.id}"]`);
      li.classList.toggle("done", !!done);
      li.classList.remove("active");
      if (!done && !current) { current = s; li.classList.add("active"); }
    }
    $("loadText").textContent = current ? t(current.label) : t(L("Listo", "Ready"));
  }
  setPct(p) {
    this.p = Math.max(this.p, p);
    $("loadBar").style.width = (this.p * 100).toFixed(1) + "%";
    $("loadPct").textContent = Math.round(this.p * 100);
  }
  data(p, key) { if (key) this.loaded.add(key); this.setPct(p * 0.7); this._mark(); }
  scene(p) { this.setPct(0.7 + p * 0.3); if (p >= 1) this.sceneDone = true; this._mark(); }
  done() { clearInterval(this.timer); this.sceneDone = true; this.setPct(1); this._mark(); }
}

export class PauseMenu {
  constructor({ game, geo, world, onResume, onAtlas, onGuide, onProfile, onLang, onRetry, onMenu }) {
    Object.assign(this, { game, geo, world });
    this.tab = "status";
    $("btnResume").onclick = onResume;
    $("btnPauseAtlas").onclick = onAtlas;
    $("btnPauseGuide").onclick = onGuide;
    $("btnPauseProfile").onclick = onProfile;
    $("btnPauseLang").onclick = () => { onLang(); this.render(); };
    // acciones que pierden avance: piden un segundo clic
    const twoStep = (id, fn) => {
      const b = $(id);
      b.onclick = () => {
        if (b.dataset.armed) { delete b.dataset.armed; b.textContent = b.dataset.label; fn(); return; }
        b.dataset.armed = "1";
        b.dataset.label = b.textContent;
        b.textContent = t(L("¿Seguro? Clic otra vez", "Sure? Click again"));
        setTimeout(() => { if (b.dataset.armed) { delete b.dataset.armed; b.textContent = b.dataset.label; } }, 3500);
      };
    };
    twoStep("btnPauseRetry", onRetry);
    twoStep("btnPauseMenu", onMenu);
    document.querySelectorAll("#scrPause [data-tab]").forEach((b) => { b.onclick = () => { this.tab = b.dataset.tab; this.render(); }; });
  }

  open() { this.render(); clearInterval(this.iv); this.iv = setInterval(() => { if (!$("scrPause").hidden && this.tab === "mars") this.render(); }, 1000); }
  close() { clearInterval(this.iv); }

  render() {
    const g = this.game, s = g.s, lang = getLang();
    document.querySelectorAll("#scrPause [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === this.tab)));
    $("pauseClock").innerHTML = `<span>${ui("localTime")} (LMST)</span><b>${hhmm(g.hour % 24)}</b><span>${t(L("Duración de la EVA", "EVA duration"))}</span><b>${hhmm(s.gameSeconds / 3600)} h</b><span>${t(L("Tiempo real jugado", "Real time played"))}</span><b>${Math.floor(s.realSeconds / 60)}:${String(Math.floor(s.realSeconds % 60)).padStart(2, "0")}</b>`;
    const body = $("pauseBody");
    body.innerHTML = { status: () => this._status(lang), body: () => this._body(lang), controls: () => this._controls(), mars: () => this._mars() }[this.tab]();
  }

  // invert: la barra es mala cuando sube (fatiga, % VO2max), no cuando baja
  _bar(label, v, color, invert = false) {
    const cls = invert ? (v > 75 ? "crit" : v > 55 ? "low" : "") : v < 15 ? "crit" : v < 40 ? "low" : "";
    return `<div class="pbar"><span>${label}</span><div class="bar ${cls}" style="color:${color}"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div><b>${Math.round(v)} %</b></div>`;
  }

  _status(lang) {
    const g = this.game, s = g.s, m = g.mission, tg = g.target;
    const ll = this.geo.toLatLon(s.x, s.z), elev = this.world.demHeight(s.x, s.z) + this.world.yRef;
    const dots = g.missions.map((mm, i) => `<li class="${i < s.missionIndex ? "done" : i === s.missionIndex ? "now" : ""}"><i></i><span>${t(mm.title)}</span></li>`).join("");
    let tgRow = "";
    if (tg) {
      const d = gcDistance(ll.lat, ll.lon, tg.latlon[0], tg.latlon[1]), b = gcBearing(ll.lat, ll.lon, tg.latlon[0], tg.latlon[1]), dz = tg.elevation_m - elev;
      tgRow = `<tr><td>${t(L("Objetivo", "Target"))}</td><td><b>${t(tg.name)}</b><br>${fmtDist(d, lang)} · ${t(L("rumbo", "bearing"))} ${num(b, 0, lang)}° · ${dz >= 0 ? "+" : ""}${num(dz, 0, lang)} m</td></tr>`;
    }
    const sh = g.nearestShelter();
    const shD = gcDistance(ll.lat, ll.lon, sh.latlon[0], sh.latlon[1]);
    return `<div class="eyebrow">${m.free ? ui("freeMode") : `${ui("mission")} ${m.order} ${ui("of")} ${g.missions.length}`}</div>
      <h2>${t(m.title)}</h2>
      ${m.free ? `<p class="muted small">${ui("freeHint")} · ${t(L("mediciones", "readings"))}: ${s.freeDone}</p>` : `<ol class="mdots">${dots}</ol>`}
      <div class="pbars">${this._bar("O₂", s.oxygen, "var(--o2)")}${this._bar(t(L("Energía", "Power")), s.energy, "var(--energy)")}${this._bar(t(L("Integridad", "Integrity")), s.integrity, "var(--integrity)")}</div>
      <table class="kv">
        ${tgRow}
        <tr><td>${t(L("Refugio más cercano", "Nearest shelter"))}</td><td>${t(sh.name)} · ${fmtDist(shD, lang)}</td></tr>
        <tr><td>${t(L("Posición", "Position"))}</td><td>${fmtLat(ll.lat)} · ${fmtLon(ll.lon)} · ${num(elev, 0, lang)} m</td></tr>
        <tr><td>${t(L("Recorrido", "Distance walked"))}</td><td>${fmtDist(s.movedTotal, lang)} · ${s.track.length} ${t(L("puntos de traza", "track points"))}</td></tr>
        <tr><td>${t(L("Ciencia", "Science"))}</td><td>${s.science} ${t(L("puntos", "points"))}</td></tr>
        <tr><td>${t(L("Vehículo", "Vehicle"))}</td><td>${s.driving ? t(L("a bordo del rover", "aboard the rover")) : t(L("a pie", "on foot"))}</td></tr>
      </table>`;
  }

  _body(lang) {
    const g = this.game, s = g.s, b = s.bio, bio = g.bio, p = bio.p;
    const remG = (s.oxygen / 100) * g.o2CapacityG;
    const rest = bio.metabolic(0), walk = bio.metabolic(bio.vDesign);
    const pct = bio.pctVO2max(b.M);
    return `<div class="eyebrow">${t(L("Perfil fisiológico", "Physiological profile"))}</div>
      <h2>${p.name} · ${num(p.mass, 0, lang)} kg · ${num(p.height, 0, lang)} cm · ${p.age} ${t(L("años", "y"))}</h2>
      <p class="small muted">${t(SUITS[p.suit].name)} · VO₂max ${p.vo2max} ml/kg/min · ${t(L("peso en Marte", "weight on Mars"))} ${num(bio.weightMarsN, 0, lang)} N</p>
      <div class="pbars">${this._bar(t(L("Fatiga", "Fatigue")), b.fatigue, "var(--safe)", true)}${this._bar("% VO₂max", pct * 100, "var(--info)", true)}</div>
      <table class="kv">
        <tr><th colspan="2">${t(L("Ahora", "Now"))}</th></tr>
        <tr><td>${t(L("Gasto metabólico", "Metabolic rate"))}</td><td>${num(b.M, 0, lang)} W · ${num(bio.kcalPerH(b.M), 0, lang)} kcal/h</td></tr>
        <tr><td>VO₂ · ${t(L("frecuencia cardíaca", "heart rate"))}</td><td>${num(bio.vo2Lmin(b.M), 2, lang)} L/min · ${Math.round(b.hr)} ${t(L("lpm", "bpm"))}</td></tr>
        <tr><td>${t(L("O₂ restante", "O₂ left"))}</td><td>${num(remG, 0, lang)} g · ${num(remG / bio.o2gPerH(walk), 1, lang)} h ${t(L("caminando", "walking"))} · ${num(remG / bio.o2gPerH(rest), 1, lang)} h ${t(L("en reposo", "at rest"))}</td></tr>
        <tr><th colspan="2">${t(L("Acumulado en la EVA", "EVA totals"))}</th></tr>
        <tr><td>${t(L("Energía gastada", "Energy spent"))}</td><td>${num(b.kcal, 0, lang)} kcal</td></tr>
        <tr><td>O₂ · CO₂ · ${t(L("agua del sublimador", "sublimator water"))}</td><td>${num(b.o2g, 0, lang)} g · ${num(b.co2g, 0, lang)} g · ${num(b.waterg, 0, lang)} g</td></tr>
        <tr><td>${t(L("Dosis de radiación", "Radiation dose"))}</td><td>${num(b.doseUgy, 1, lang)} µGy · ${num(b.doseUgy * Q_RAD, 1, lang)} µSv</td></tr>
      </table>
      <p class="small muted">${t(L("El perfil se elige al empezar la expedición. Modelo: Pandolf a 0,379 g + Mifflin-St Jeor (docs/fisiologia.md).", "The profile is chosen when the expedition starts. Model: Pandolf at 0.379 g + Mifflin-St Jeor (docs/fisiologia.md)."))}</p>`;
  }

  _spaceWeather(lang) {
    const sw = this.sw || { level: "reference", source: "reference" };
    const src = { live: L("NASA DONKI en vivo", "Live NASA DONKI"), snapshot: L("copia guardada de NASA DONKI", "saved NASA DONKI copy"), reference: L("sin conexión con DONKI", "no DONKI connection") }[sw.source];
    let body = "";
    if (sw.source === "reference") {
      body = `<p class="small">${t(L("No se pudo consultar DONKI (sin red o límite de la clave DEMO_KEY). La tormenta del juego usa este evento real como referencia:", "DONKI could not be reached (offline or DEMO_KEY limit). The in-game storm uses this real event as reference:"))}</p><p class="small"><b>${t(REFERENCE_EVENT.text)}</b> <span class="muted">${REFERENCE_EVENT.src}</span></p>`;
    } else {
      const fl = sw.flares.slice(0, 5).map((f) => `<tr><td>${f.cls}${f.region ? ` · AR ${f.region}` : ""}</td><td>${f.time.replace("T", " ").replace("Z", " UTC")}</td></tr>`).join("");
      const mh = sw.marsHits.slice(-3).map((h) => `<tr><td>${t(L("CME llega a Marte", "CME reaches Mars"))}${h.glancing ? ` (${t(L("roce", "glancing"))})` : ""}</td><td>${h.time.replace("T", " ").replace("Z", " UTC")}</td></tr>`).join("");
      body = `<table class="kv"><tr><th colspan="2">${t(L("Últimos 30 días", "Last 30 days"))}: ${sw.counts.flaresMX} ${t(L("fulguraciones M/X", "M/X flares"))} · ${sw.counts.sep} SEP · ${sw.counts.mars} ${t(L("impactos de CME previstos en Marte", "CME impacts forecast at Mars"))}</th></tr>${fl}${mh}</table>
        <p class="small muted">${t(L("Las tormentas de partículas (SEP) siguen a fulguraciones fuertes y a CME rápidas. En mayo de 2024, una X12 multiplicó por ~39 la dosis diaria en Gale (RAD).", "Particle storms (SEP) follow strong flares and fast CMEs. In May 2024 an X12 flare raised the daily dose in Gale ~39-fold (RAD)."))}</p>`;
    }
    return `<h3 class="sky-h">${t(L("Clima espacial", "Space weather"))} · <span style="color:${LEVEL_COLOR[sw.level]}">${t(LEVEL_TEXT[sw.level])}</span> <span class="small muted">(${t(src)})</span></h3>${body}`;
  }

  _controls() {
    const K = (...k) => k.map((x) => `<kbd>${x}</kbd>`).join("");
    const rows = [
      [K("W", "A", "S", "D"), L("Caminar · conducir el rover", "Walk · drive the rover")],
      [K(t(L("Espacio", "Space"))), L("Saltar (en Marte subes ~1,5 m)", "Jump (on Mars you rise ~1.5 m)")],
      [K("E"), L("Subir o bajar del rover", "Board or leave the rover")],
      [K("F"), L("Mantener para ayudar a EVA-2 si queda atrapado", "Hold to help EVA-2 if they get stuck")],
      [K(t(L("Ratón", "Mouse"))), L("Mirar (clic para capturar)", "Look (click to capture)")],
      [K(t(L("Rueda", "Wheel"))), L("Distancia de la cámara", "Camera distance")],
      [K("1", "2", "3", "4"), L("Capas: pendiente · radiación · temperatura · minerales", "Layers: slope · radiation · temperature · minerals")],
      [K("R"), L("Ruta segura (A*)", "Safe route (A*)")],
      [K("M"), L("Atlas de Marte", "Mars atlas")],
      [K("I"), L("Telemetría NAV / BIO", "NAV / BIO telemetry")],
      [K("H"), L("Cómo leer las capas", "How to read the layers")],
      [K("P"), L("Mostrar u ocultar los nombres de los planetas en el cielo", "Show or hide planet names in the sky")],
      [K("Esc"), L("Pausa", "Pause")],
    ];
    return `<div class="eyebrow">${ui("tabControls")}</div><h2>${t(L("Controles", "Controls"))}</h2>
      <div class="keys">${rows.map(([k, v]) => `<div class="k">${k}</div><div>${t(v)}</div>`).join("")}</div>`;
  }

  _mars() {
    const rows = marsNowRows();
    const lang = getLang(), eph = marsSkyEphemeris();
    const vis = (p) => {
      if (p.mag > 6) return t(L("no (necesita telescopio)", "no (needs a telescope)"));
      if (p.elong < 12) return t(L("no: perdido en el brillo del Sol", "no: lost in the Sun's glare"));
      if (p.mag > 5.5) return t(L("en el límite de la vista", "at the limit of sight"));
      if (p.elong > 120) return t(L("casi toda la noche", "most of the night"));
      return p.evening ? t(L("al anochecer, hacia el oeste", "after sunset, toward the west")) : t(L("al amanecer, hacia el este", "before sunrise, toward the east"));
    };
    const pl = eph.planets.filter((p) => p.id !== "moon");
    const earth = pl.find((p) => p.id === "earth");
    return `<div class="eyebrow">${t(L("Calculado con la fecha de tu ordenador", "Computed from your computer's date"))}</div><h2>${t(L("Marte ahora mismo", "Mars right now"))}</h2>
      <table class="kv">${rows.map(([k, v]) => `<tr><td>${t(k)}</td><td>${v}</td></tr>`).join("")}</table>
      <h3 class="sky-h">${t(L("¿Qué planetas se ven desde la superficie?", "Which planets can be seen from the surface?"))}</h3>
      <table class="kv sky-t"><tr><th>${t(L("Planeta", "Planet"))}</th><th>${t(L("Magnitud", "Magnitude"))}</th><th>${t(L("Del Sol", "From Sun"))}</th><th>${t(L("¿Visible hoy?", "Visible today?"))}</th></tr>
        ${pl.map((p) => `<tr title="${t(NAKED_EYE[p.id])}"><td><b>${t(p.name)}</b><br><span class="small muted">${t(NAKED_EYE[p.id])}</span></td><td>${num(p.mag, 1, lang)}</td><td>${Math.round(p.elong)}°</td><td>${vis(p)}</td></tr>`).join("")}
      </table>
      ${this._spaceWeather(lang)}
      <p class="small">${t(L("Separación Tierra–Luna vista desde Marte hoy", "Earth–Moon separation seen from Mars today"))}: <b>${num(earth.moonSepArcmin, 1, lang)}′</b> (${t(L("el ojo distingue ~1′; en el juego se dibuja ×3", "the eye resolves ~1′; drawn ×3 in the game"))}). ${t(DUST_NOTE)}</p>
      <p class="small muted">${t(L("Magnitud aproximada (m = H + 5 log rΔ + β·α), sin la extinción del polvo. ", "Approximate magnitude (m = H + 5 log rΔ + β·α), before dust extinction. "))}${t(L("Ls y hora: algoritmo Mars24 (Allison y McEwen 2000, NASA GISS). Distancia: elementos orbitales medios de JPL (Standish). La hora del juego es la de la expedición ficticia, no la real.", "Ls and time: Mars24 algorithm (Allison & McEwen 2000, NASA GISS). Distance: JPL mean orbital elements (Standish). The in-game clock belongs to the fictional expedition, not the real one."))}</p>`;
  }
}
