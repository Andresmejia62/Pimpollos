import { t, ui, getLang } from "../i18n.js";
import { assetUrl } from "../data.js";
import { gcDistance, gcBearing, pressureAt, fmtLat, fmtLon, fmtDist as fmtD, num } from "../geo.js";

// Factor de calidad medio de la radiacion en la superficie (RAD: 0,64 mSv/dia / 0,21 mGy/dia; Hassler et al. 2014)
const Q_RAD = 3.05;

const $ = (id) => document.getElementById(id);
const SPEAKER_ICON = { antenna: "i-antenna", helmet: "i-helmet", earth: "i-earth" };
const SEV_ICON = { info: "i-info", caution: "i-warn", danger: "i-octagon" };
const SEV_LABEL = { info: { es: "Info", en: "Info" }, caution: { es: "Precaución", en: "Caution" }, danger: { es: "Peligro", en: "Danger" } };

const LEGENDS = {
  slope: { name: { es: "Pendiente", en: "Slope" }, items: [["safe", { es: "Menos de 12°: camino fácil", en: "Under 12°: easy going" }], ["caution", { es: "12–25°: lento, gasta O₂", en: "12–25°: slow, uses O₂" }], ["danger", { es: "Más de 25°: bloqueado", en: "Over 25°: blocked" }]] },
  radiation: { name: { es: "Radiación (µGy/h)", en: "Radiation (µGy/h)" }, items: [["safe", { es: "< 8,3: el terreno te protege", en: "< 8.3: terrain shields you" }], ["caution", { es: "8,3–8,7: normal", en: "8.3–8.7: normal" }], ["danger", { es: "> 8,7: zona expuesta", en: "> 8.7: exposed" }]] },
  thermal: { name: { es: "Temperatura del suelo", en: "Ground temperature" }, items: [["safe", { es: "Más de −25 °C", en: "Above −25 °C" }], ["caution", { es: "−25 a −45 °C", en: "−25 to −45 °C" }], ["danger", { es: "Menos de −45 °C: +energía", en: "Below −45 °C: +power use" }]] },
  spectral: { name: { es: "Minerales (CRISM)", en: "Minerals (CRISM)" }, items: [["clay", { es: "Arcillas", en: "Clays" }], ["sulfate", { es: "Sulfatos", en: "Sulfates" }], ["boxwork", { es: "Vetas boxwork", en: "Boxwork veins" }], ["dunes", { es: "Arena basáltica", en: "Basaltic sand" }]] },
};

const GUIDE = [
  ["slope", "1", { es: "Rayas = más de 25°: no se puede pasar. Puntos = lento y gasta más O₂.", en: "Stripes = over 25°: impassable. Dots = slow, uses more O₂." }, { es: "DTM HiRISE + CTX", en: "HiRISE + CTX DTM" }],
  ["radiation", "2", { es: "Liso = el terreno tapa parte del cielo. Rayas = zona expuesta. Importa sobre todo en una tormenta solar.", en: "Smooth = terrain blocks part of the sky. Stripes = exposed. Matters most during a solar storm." }, { es: "RAD (Curiosity)", en: "RAD (Curiosity)" }],
  ["thermal", "3", { es: "Rayas = suelo bajo −45 °C: la calefacción gasta energía extra. Busca laderas al sol.", en: "Stripes = ground below −45 °C: heating uses extra power. Seek sunny slopes." }, { es: "REMS + THEMIS", en: "REMS + THEMIS" }],
  ["spectral", "4", { es: "Cian arcillas · lila sulfatos · blanco boxwork · azul arena. Tus objetivos están sobre su mineral.", en: "Cyan clays · lilac sulfates · white boxwork · blue sand. Your targets sit on their mineral." }, { es: "CRISM (MRO)", en: "CRISM (MRO)" }],
];

export class Hud {
  constructor(game, world, data, geo) {
    this.geo = geo;
    this._telemT = 0;
    this.game = game;
    this.world = world;
    this.data = data;
    this.dialogQueue = [];
    this.dialogUntil = 0;
    this.alertEls = [];
    this.speakers = data.dialogs.speakers;
    this.severity = data.alerts.severity_style;
    this.minimap = new Minimap($("minimap"), world, game, data);
    this._buildCompass();
    game.on("dialog", (d) => d && this.dialogQueue.push(d));
  }

  applyLang() {
    document.querySelectorAll("[data-ui]").forEach((el) => { el.textContent = ui(el.dataset.ui); });
    $("campaignName").textContent = t(this.data.missions.campaign.title);
    const names = t({ es: "N NE E SE S SO O NO", en: "N NE E SE S SW W NW" }).split(" ");
    this.ticks.forEach((el, i) => { el.textContent = names[i]; });
    this.setLayer(this.game.s.layer);
    this.renderGuide();
  }

  // ---- recursos --------------------------------------------------------------
  update(now) {
    const s = this.game.s;
    this._bar("O2", s.oxygen);
    this._bar("En", s.energy);
    this._bar("In", s.integrity);
    const env = this.game.env;
    if (env) {
      $("envLine").innerHTML =
        `<span>∠ <b>${env.slope.toFixed(0)}°</b></span><span>☢ <b>${env.dose.toFixed(2)}</b> µGy/h${s.spe && s.spe.phase === "active" ? " ×40" : ""}</span><span>🌡 <b>${env.temp.toFixed(0)} °C</b></span>`;
    }
    const h = this.game.hour % 24;
    $("clock").textContent = `${ui("localTime")} ${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")} · Sol 212 · ${ui("gravity")}`;

    // mision y objetivo
    const m = this.game.mission;
    const tg = this.game.target;
    const d = tg ? this.game.distTo(tg) : 0;
    $("missionLbl").textContent = `${ui("mission")} ${m.order}/${this.game.missions.length}`;
    $("missionTitle").textContent = t(m.title);
    $("missionObj").textContent = `${t(tg.name)} · ${fmtDist(d)}`;

    // tutorial
    const tut = this.game.tutorialText();
    $("tutorial").hidden = !tut;
    if (tut) $("tutorial").textContent = t(tut);

    // escaneo
    const scanT = this.game.rules.science.scan_time_s;
    const showScan = s.scanProgress > 0 && !s.scanned;
    $("scanring").hidden = !showScan;
    if (showScan) {
      const p = Math.min(1, s.scanProgress / scanT);
      $("scanRingFill").style.background = `conic-gradient(var(--safe) 0 ${p * 100}%, rgba(255,255,255,.15) ${p * 100}% 100%)`;
      $("scanLbl").textContent = `${ui("scanning")} ${Math.round(p * 100)}%`;
    }

    // tormenta
    const sp = s.spe;
    const cd = $("countdown");
    $("stormTint").hidden = !(sp && sp.phase !== "ended");
    if (sp && sp.phase !== "ended") {
      cd.hidden = false;
      const secs = Math.max(0, Math.ceil(sp.t));
      $("countN").textContent = `00:${String(secs).padStart(2, "0")}`;
      const safe = sp.phase === "active" && s.inShelter;
      cd.classList.toggle("safe", !!safe);
      $("countL").textContent = sp.phase === "warning" ? ui("stormIn") : safe ? ui("safeShelter") : ui("stormActive");
    } else cd.hidden = true;

    // alertas con cuenta regresiva en vivo ({s})
    if (sp && sp.phase === "warning") {
      document.querySelectorAll("#alerts [data-tpl]").forEach((el) => {
        const tx = el.querySelector(".tx");
        if (tx) tx.textContent = el.dataset.tpl.replace("{s}", Math.max(0, Math.ceil(sp.t)));
      });
    }

    // Rover: aviso para subir o bajar
    const canBoard = this.game.nearVehicle;
    $("carPrompt").hidden = !(s.phase === "playing" && (canBoard || (s.driving && !s.moving)));
    $("carPromptText").textContent = ui(s.driving ? "exitCar" : "boardCar");

    this._compass(tg);
    if (now - this._telemT > 0.2 && !$("telem").hidden) { this._telemT = now; this._telemetry(tg); }
    this.minimap.draw(tg);
    this._dialogs(now);
    $("lockHint").textContent = this._lockHint || "";
  }

  // ---- telemetria: navegacion (lat/lon/elevacion reales) y fisiologia del astronauta -------------
  _telemetry(tg) {
    const g = this.game, s = g.s, b = s.bio, bio = g.bio, lang = getLang(), W = this.world;
    const ll = this.geo.toLatLon(s.x, s.z);
    const elev = W.demHeight(s.x, s.z) + W.yRef;
    const az = ((-s.heading * 180) / Math.PI + 360) % 360;
    const row = (k, v, cls = "") => `<dt>${k}</dt><dd class="${cls}">${v}</dd>`;
    let tgt = "";
    if (tg) {
      const tl = { lat: tg.latlon[0], lon: tg.latlon[1] };
      const d = gcDistance(ll.lat, ll.lon, tl.lat, tl.lon), brg = gcBearing(ll.lat, ll.lon, tl.lat, tl.lon);
      const dz = tg.elevation_m - elev;
      tgt = row(t({ es: "OBJ", en: "TGT" }), `${fmtD(d, lang)} · ${num(brg, 0, lang)}° · ${dz >= 0 ? "+" : ""}${num(dz, 0, lang)} m`);
    }
    $("tmNav").innerHTML =
      row("LAT", fmtLat(ll.lat, 5)) + row("LON", fmtLon(ll.lon, 5)) +
      row("ELEV", `${num(elev, 1, lang)} m <i>MOLA</i>`) +
      row(t({ es: "PRES", en: "PRES" }), `${num(pressureAt(elev), 0, lang)} Pa`) +
      row(t({ es: "RUMBO", en: "HDG" }), `${num(az, 0, lang).padStart(3, "0")}° · ${num(b.vReal, 2, lang)} m/s · ${b.grade >= 0 ? "+" : ""}${num(b.grade * 100, 0, lang)} %`) + tgt;
    const pct = bio.pctVO2max(b.M);
    const remG = (s.oxygen / 100) * g.o2CapacityG, remH = remG / bio.o2gPerH(b.M);
    $("tmBioTitle").textContent = `BIO · ${bio.p.name} · ${num(bio.p.mass, 0, lang)} kg · ${num(bio.p.height, 0, lang)} cm`;
    $("tmBio").innerHTML =
      row("MET", `${num(b.M, 0, lang)} W · ${num(bio.kcalPerH(b.M), 0, lang)} kcal/h`) +
      row("VO₂", `${num(bio.vo2Lmin(b.M), 2, lang)} L/min · ${Math.round(pct * 100)} %`, pct > 0.75 ? "bad" : pct > 0.55 ? "warn" : "") +
      row(t({ es: "FC", en: "HR" }), `${Math.round(b.hr)} ${t({ es: "lpm", en: "bpm" })}`, b.hr > bio.hrMax * 0.9 ? "bad" : "") +
      row("O₂", `${num(remG, 0, lang)} g · ${num(remH, 1, lang)} h ${t({ es: "a este ritmo", en: "at this rate" })}`, remH < 1 ? "bad" : "") +
      row(t({ es: "GASTO", en: "USED" }), `${num(b.kcal, 0, lang)} kcal · O₂ ${num(b.o2g, 0, lang)} g · CO₂ ${num(b.co2g, 0, lang)} g`) +
      row(t({ es: "DOSIS", en: "DOSE" }), `${num(b.doseUgy, 1, lang)} µGy · ${num(b.doseUgy * Q_RAD, 1, lang)} µSv`) +
      row(t({ es: "TERRENO", en: "TERRAIN" }), `η ${num(b.eta, 1, lang)} ${b.eta >= 2 ? t({ es: "arena suelta", en: "loose sand" }) : b.eta > 1.3 ? t({ es: "crestas", en: "ridges" }) : t({ es: "regolito firme", en: "firm regolith" })}`, b.eta >= 2 ? "warn" : "");
    const f = Math.round(b.fatigue);
    $("tmFat").style.width = f + "%";
    $("tmFat").parentElement.classList.toggle("low", f > 40 && f <= 75);
    $("tmFat").parentElement.classList.toggle("crit", f > 75);
    $("tmFatL").textContent = `${ui("fatigue")} ${f} %`;
  }

  _bar(k, v) {
    const bar = $("bar" + k), pct = $("pct" + k);
    bar.style.width = Math.max(0, Math.min(100, v)) + "%";
    const low = v < 40, crit = v < 15;
    bar.parentElement.classList.toggle("low", low && !crit);
    bar.parentElement.classList.toggle("crit", crit);
    pct.classList.toggle("low", low && !crit);
    pct.classList.toggle("crit", crit);
    pct.textContent = Math.round(Math.max(0, v)) + "%";
  }

  setLockHint(text) { this._lockHint = text; }

  // ---- brujula -----------------------------------------------------------------
  _buildCompass() {
    const strip = $("compassStrip");
    const labels = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
    this.ticks = labels.map((l, i) => {
      const s = document.createElement("span");
      s.textContent = l;
      if (i % 2 === 0) s.className = "card";
      s.dataset.az = i * 45;
      strip.appendChild(s);
      return s;
    });
  }

  _compass(tg) {
    const yaw = this.camYaw ?? Math.PI;
    // rumbo de la camara: yaw 0 = norte, PI = sur; azimut en sentido horario
    const heading = ((-yaw * 180) / Math.PI + 360) % 360;
    const span = 120; // grados visibles en la tira
    const place = (el, az) => {
      let d = ((az - heading + 540) % 360) - 180;
      el.style.display = Math.abs(d) > span / 2 ? "none" : "";
      el.style.left = 50 + (d / span) * 100 + "%";
      return d;
    };
    this.ticks.forEach((el) => place(el, +el.dataset.az));
    if (tg) {
      const s = this.game.s;
      const az = ((Math.atan2(tg.world.x - s.x, -(tg.world.z - s.z)) * 180) / Math.PI + 360) % 360;
      const el = $("compassTgt");
      let d = ((az - heading + 540) % 360) - 180;
      const off = Math.abs(d) > span / 2;
      d = Math.max(-span / 2, Math.min(span / 2, d));
      el.style.left = 50 + (d / span) * 100 + "%";
      el.classList.toggle("off", off);
      $("compassDist").textContent = fmtDist(this.game.distTo(tg));
    }
  }

  // ---- capas -------------------------------------------------------------------
  setLayer(layer) {
    document.querySelectorAll("#layerbar button").forEach((b) => {
      if (b.dataset.layer !== "route") b.setAttribute("aria-pressed", String(b.dataset.layer === layer));
    });
    const lg = $("legend");
    if (!layer) { lg.hidden = true; return; }
    const L = LEGENDS[layer];
    const sw = (k) => (["safe", "caution", "danger"].includes(k) ? `<span class="sw ${k}"></span>` : `<span class="sw" style="background:var(--${k})"></span>`);
    lg.innerHTML = `<div class="h">${t(L.name)}</div>` + L.items.map(([k, txt]) => `<div class="li">${sw(k)}${t(txt)}</div>`).join("");
    lg.hidden = false;
  }
  setRoute(on) { document.querySelector('#layerbar [data-layer="route"]').setAttribute("aria-pressed", String(on)); }

  renderGuide() {
    const lab = { safe: { es: "Liso = seguro", en: "Smooth = safe" }, caution: { es: "Puntos = precaución", en: "Dots = caution" }, danger: { es: "Rayas = peligro", en: "Stripes = danger" } };
    $("gSafe").textContent = t(lab.safe);
    $("gCaution").textContent = t(lab.caution);
    $("gDanger").textContent = t(lab.danger);
    $("guideGrid").innerHTML = GUIDE.map(([k, key, txt, src]) => `
      <div class="layercard">
        <div style="position:relative;background:url(${assetUrl("layers/optical.png")}) 50% 30%/170% auto;border-radius:6px;overflow:hidden;margin-bottom:8px">
          <img src="${assetUrl(`layers/${k}_overlay.png`)}" alt="" style="margin:0;transform:scale(1.7);transform-origin:50% 30%">
        </div>
        <h3><kbd>${key}</kbd>${t(LEGENDS[k].name)}</h3>
        <p>${t(txt)}</p><p class="src">${ui("source")}: ${t(src)}</p>
      </div>`).join("");
  }

  // ---- alertas y dialogos --------------------------------------------------------
  showAlert(a, extra = {}) {
    const box = $("alerts");
    const el = document.createElement("div");
    el.className = `alert ${a.severity}`;
    el.dataset.id = a.id;
    box.querySelectorAll(`[data-id="${a.id}"]`).forEach((x) => x.remove());
    const tpl = t(a.text);
    let txt = tpl;
    if (extra.s != null) txt = tpl.replace("{s}", extra.s);
    if (tpl.includes("{s}")) el.dataset.tpl = tpl;
    el.innerHTML = `<svg><use href="#${SEV_ICON[a.severity]}"/></svg><div><div class="tt">${t(SEV_LABEL[a.severity])}</div><div class="tx">${txt}</div></div>`;
    box.appendChild(el);
    this.alertEls.push(el);
    this.alertEls = this.alertEls.filter((x) => x.isConnected);
    while (this.alertEls.length > 2) {
      // descartar primero la menos grave
      const i = this.alertEls.findIndex((x) => !x.classList.contains("danger"));
      this.alertEls.splice(i >= 0 ? i : 0, 1)[0].remove();
    }
    // las de peligro siguen visibles mientras dure su condicion (ver clearAlert)
    if (a.severity !== "danger") setTimeout(() => this._drop(el), 5000);
    else setTimeout(() => this._drop(el), 120000);
    if (a.dialog) {
      const d = this.game.dialogs[a.dialog];
      if (d) this.dialogQueue.unshift(d);
    }
  }

  _drop(el) { el.remove(); this.alertEls = this.alertEls.filter((x) => x !== el); }
  clearAlert(a) { document.querySelectorAll(`#alerts [data-id="${a.id}"]`).forEach((el) => this._drop(el)); }

  clearAlerts() { $("alerts").innerHTML = ""; this.alertEls = []; }

  _dialogs(now) {
    const box = $("dialog");
    if (now < this.dialogUntil) return;
    const d = this.dialogQueue.shift();
    if (!d) { box.hidden = true; return; }
    const sp = this.speakers[d.speaker] || {};
    $("dialogWho").innerHTML = `<svg><use href="#${SPEAKER_ICON[sp.icon] || "i-antenna"}"/></svg>${t(sp.name)}`;
    $("dialogWho").style.color = sp.color || "var(--info)";
    $("dialogText").textContent = t(d.text);
    box.hidden = false;
    this.dialogUntil = now + Math.max(3, d.duration_s || 5) + 0.6;
  }
  clearDialogs() { this.dialogQueue = []; this.dialogUntil = 0; $("dialog").hidden = true; }
}

function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(2).replace(".", ",") + " km" : Math.round(m) + " m"; }

// ---- minimapa ---------------------------------------------------------------------
class Minimap {
  constructor(canvas, world, game, data) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.world = world;
    this.game = game;
    this.objectives = data.objectives.objectives;
    this.trav = data.traverse.points || [];
    this.base = new Image();
    this.base.src = assetUrl("layers/optical.png");
    this.overlays = {};
    ["slope", "radiation", "thermal", "spectral"].forEach((k) => { const im = new Image(); im.src = assetUrl(`layers/${k}_overlay.png`); this.overlays[k] = im; });
    this.route = null;
  }
  setRoute(pts) { this.route = pts; }
  toPx(x, z) { const S = this.c.width; return [((x + this.world.half) / this.world.size) * S, ((z + this.world.half) / this.world.size) * S]; }

  draw(target) {
    const ctx = this.ctx, S = this.c.width, s = this.game.s;
    ctx.clearRect(0, 0, S, S);
    if (this.base.complete) ctx.drawImage(this.base, 0, 0, S, S);
    const ov = s.layer && this.overlays[s.layer];
    if (ov && ov.complete) { ctx.globalAlpha = 0.95; ctx.drawImage(ov, 0, 0, S, S); ctx.globalAlpha = 1; }
    // traza de Curiosity
    if (this.trav.length) {
      ctx.strokeStyle = "rgba(255,210,80,.6)"; ctx.lineWidth = 2; ctx.beginPath();
      this.trav.forEach((p, i) => { const [px, pz] = this.toPx(p[1], p[2]); i ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz); });
      ctx.stroke();
    }
    // ruta sugerida
    if (s.routeOn && this.route && this.route.length > 1) {
      ctx.strokeStyle = "#3DDC97"; ctx.lineWidth = 5; ctx.setLineDash([12, 8]); ctx.lineCap = "round"; ctx.beginPath();
      this.route.forEach((p, i) => { const [px, pz] = this.toPx(p[0], p[1]); i ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz); });
      ctx.stroke(); ctx.setLineDash([]);
    }
    // objetivos y refugios
    for (const o of this.objectives) {
      const [px, pz] = this.toPx(o.world.x, o.world.z);
      const isT = target && o.id === target.id;
      ctx.lineWidth = 3.5;
      if (o.type === "science") {
        ctx.strokeStyle = isT ? "#3DDC97" : "#fff";
        ctx.beginPath(); ctx.arc(px, pz, isT ? 11 : 8, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.strokeStyle = "#3DDC97";
        ctx.strokeRect(px - 7, pz - 7, 14, 14);
        if (isT) { ctx.beginPath(); ctx.arc(px, pz, 14, 0, Math.PI * 2); ctx.stroke(); }
      }
    }
    // Rover aparcado (rombo naranja)
    if (s.car && !s.driving) {
      const [cx, cz] = this.toPx(s.car.x, s.car.z);
      ctx.fillStyle = "#FF8A3D"; ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cz - 9); ctx.lineTo(cx + 9, cz); ctx.lineTo(cx, cz + 9); ctx.lineTo(cx - 9, cz); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // jugador (triangulo orientado al rumbo)
    const [px, pz] = this.toPx(s.x, s.z);
    ctx.save(); ctx.translate(px, pz); ctx.rotate(-s.heading);
    ctx.fillStyle = "#7FD1FF"; ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(9, 10); ctx.lineTo(-9, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#fff"; ctx.font = "bold 22px Rajdhani, sans-serif"; ctx.shadowColor = "#000"; ctx.shadowBlur = 4;
    ctx.fillText("N ▲", 10, 26); ctx.shadowBlur = 0;
  }
}
