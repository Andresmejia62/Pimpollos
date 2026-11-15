// Vista de planificacion antes de salir: comparar rutas, ver su perfil de elevacion y estimar el consumo.
import { t, ui, getLang } from "../i18n.js";
import { assetUrl } from "../data.js";
import { estimateRoute } from "../gameplay/planner.js";
import { fmtDist, num } from "../geo.js";

const $ = (id) => document.getElementById(id);
const L = (es, en) => ({ es, en });
const hhmm = (h) => { h = ((h % 24) + 24) % 24; return `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`; };

const KINDS = {
  safe: { color: "#3DDC97", name: L("Ruta segura (A*)", "Safe route (A*)"), desc: L("Evita pendientes de más de 25°, campos de bloques, zonas expuestas y frías.", "Avoids slopes over 25°, boulder fields, exposed and cold areas.") },
  direct: { color: "#FF8A65", name: L("Línea recta", "Straight line"), desc: L("La más corta sobre el mapa, sin mirar el terreno.", "Shortest on the map, ignoring terrain.") },
  shelter: { color: "#7FD1FF", name: L("Con escala en un refugio", "With a shelter stop"), desc: L("Pasa por un refugio para recargar O₂ y batería.", "Stops at a shelter to recharge O₂ and battery.") },
  custom: { color: "#FFC23D", name: L("Tu ruta", "Your route"), desc: L("Haz clic en el mapa para añadir puntos de paso.", "Click the map to add waypoints.") },
};
const VERDICT = {
  ok: [L("Viable", "Feasible"), "var(--safe)"],
  risky: [L("Arriesgada", "Risky"), "var(--caution)"],
  fail: [L("No llegas", "You won't make it"), "var(--danger)"],
  blocked: [L("Intransitable", "Impassable"), "var(--danger)"],
};

export class Planner {
  constructor({ game, world, path }) {
    Object.assign(this, { game, world, path });
    this.cv = $("planMap"); this.ctx = this.cv.getContext("2d");
    this.pcv = $("planProfile");
    this.img = new Image(); this.img.src = assetUrl("layers/optical.png");
    this.overlays = {};
    ["slope", "radiation", "thermal", "spectral"].forEach((k) => { const im = new Image(); im.src = assetUrl(`layers/${k}_overlay.png`); this.overlays[k] = im; });
    this.layer = "slope";
    this.waypoints = [];
    this.sel = "safe";
    this.cv.addEventListener("click", (e) => this._click(e));
    $("planLayer").onchange = (e) => { this.layer = e.target.value; this.draw(); };
    $("planClear").onclick = () => { this.waypoints = []; this._custom(); this.render(); };
    $("planBack").onclick = () => this.close();
    $("planUse").onclick = () => {
      const r = this.routes[this.sel];
      if (this.free) {
        // modo libre: se aplica el destino y la salida elegidos; la ruta solo si se puede caminar
        const pts = r && r.est.verdict !== "blocked" ? r.pts : null;
        if (this.goal || this.startMoved) this.onUse && this.onUse(pts, this.sel, { goal: this.goal, start: this.startMoved ? this.start : null });
      } else if (r && r.est.verdict !== "blocked") this.onUse && this.onUse(r.pts, this.sel);
      this.close();
    };
    document.querySelectorAll("#planPick [data-pick]").forEach((b) => { b.onclick = () => { this.pick = b.dataset.pick; this.render(); }; });
    window.addEventListener("resize", () => { if (!$("scrPlan").hidden) this.render(); });
  }

  // free = modo libre: no hay destino fijo; el clic en el mapa define el destino, la salida o un punto de paso
  open(onUse, { free = false } = {}) {
    this.onUse = onUse;
    this.free = free;
    const g = this.game, tg = free ? g.objectives.custom || null : g.target;
    this.start = [g.s.x, g.s.z];
    this.startMoved = false;
    this.goal = tg ? [tg.world.x, tg.world.z] : null;
    this.pick = this.goal ? "way" : "goal";
    this.waypoints = [];
    $("planPick").hidden = !free;
    $("planEyebrow").textContent = free ? t(L("Modo libre · define destino, salida y ruta", "Free mode · set destination, start and route")) : ui("planEyebrow");
    $("planUse").textContent = free ? t(L("Aplicar", "Apply")) : ui("planUse");
    $("planTitle").textContent = tg ? `${t(L("Hacia", "To"))} ${t(tg.name)}` : t(L("Elige tu destino en el mapa", "Pick your destination on the map"));
    $("planLayer").innerHTML = [["slope", L("Pendiente y rocas", "Slope and rocks")], ["radiation", L("Radiación", "Radiation")], ["thermal", L("Temperatura", "Temperature")], ["spectral", L("Minerales", "Minerals")], ["", L("Solo imagen CTX", "CTX image only")]]
      .map(([k, n]) => `<option value="${k}" ${k === this.layer ? "selected" : ""}>${t(n)}</option>`).join("");
    $("scrPlan").hidden = false;
    this._compute();
    this.render();
  }
  close() { $("scrPlan").hidden = true; this.onClose && this.onClose(); }

  _astar(pts) {
    const out = [];
    for (let i = 1; i < pts.length; i++) {
      const r = this.path.find(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      if (!r) return null;
      out.push(...(i > 1 ? r.slice(1) : r));
    }
    out[0] = pts[0]; out.push(pts[pts.length - 1]);
    return out;
  }
  _make(kind, pts, refillAt = null) {
    if (!pts) return null;
    // indice (en la polilinea densificada de 6 m) donde esta la escala
    let refills = [];
    if (refillAt) {
      let acc = 0, idx = 0;
      for (let i = 1; i < pts.length; i++) {
        acc += Math.max(1, Math.ceil(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) / 6));
        if (i === refillAt.k) { idx = acc; break; }
      }
      refills = [{ i: idx, id: refillAt.id }];
    }
    return { kind, pts, est: estimateRoute(this.game, pts, { refills }), stop: refillAt };
  }
  _compute() {
    const g = this.game, S = this.start, G = this.goal;
    this.routes = {};
    if (!G) return;
    this.routes.safe = this._make("safe", this._astar([S, G]));
    this.routes.direct = this._make("direct", [S, G]);
    // mejor refugio intermedio (que no sea donde ya estas)
    let best = null;
    for (const o of Object.values(g.objectives)) {
      if (!o.shelter || Math.hypot(o.world.x - S[0], o.world.z - S[1]) < 60) continue;
      const a = this._astar([S, [o.world.x, o.world.z]]), b = a && this._astar([[o.world.x, o.world.z], G]);
      if (!b) continue;
      const pts = [...a, ...b.slice(1)];
      const r = this._make("shelter", pts, { k: a.length - 1, id: o.id, name: o.name });
      const extra = r.est.dist - (this.routes.safe?.est.dist || 0);
      if (extra < 2500 && (!best || r.est.minO2 > best.est.minO2)) best = r;
    }
    if (best) this.routes.shelter = best;
    this._custom();
  }
  _custom() {
    this.routes.custom = this.goal && this.waypoints.length ? this._make("custom", this._astar([this.start, ...this.waypoints, this.goal])) : null;
    if (this.waypoints.length && this.routes.custom) this.sel = "custom";
    // si la ruta elegida no existe (p. ej. un destino al que A* no llega), se toma la primera disponible
    if (!this.routes[this.sel]) this.sel = ["safe", "shelter", "direct", "custom"].find((k) => this.routes[k]) || "safe";
  }

  // ---- mapa ---------------------------------------------------------------------
  _view() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const add = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
    add(...this.start); if (this.goal) add(...this.goal);
    for (const r of Object.values(this.routes)) if (r) for (const [x, z] of r.pts) add(x, z);
    this.waypoints.forEach(([x, z]) => add(x, z));
    const W = this.world;
    let cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    // modo libre: siempre todo el mapa, para poder elegir cualquier punto
    const wide = this.free;
    const span = wide ? W.size : Math.min(W.size, Math.max(400, Math.max(x1 - x0, z1 - z0) * 1.18));
    if (wide) { cx = 0; cz = 0; }
    const r = this.cv.getBoundingClientRect();
    const asp = r.width / r.height;
    const sw = asp >= 1 ? span * asp : span, sh = asp >= 1 ? span : span / asp;
    this.v = { x0: cx - sw / 2, z0: cz - sh / 2, sw, sh, W: r.width, H: r.height };
  }
  toPx(x, z) { const v = this.v; return [((x - v.x0) / v.sw) * v.W, ((z - v.z0) / v.sh) * v.H]; }
  toWorld(px, py) { const v = this.v; return [v.x0 + (px / v.W) * v.sw, v.z0 + (py / v.H) * v.sh]; }

  draw() {
    const cv = this.cv, ctx = this.ctx, dpr = Math.min(2, devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._view();
    const v = this.v, Wd = this.world, S = Wd.size, h = Wd.half;
    ctx.fillStyle = "#1a0f0a"; ctx.fillRect(0, 0, v.W, v.H);
    const drawImg = (im, alpha) => {
      if (!im.complete || !im.naturalWidth) return;
      const k = im.naturalWidth / S;
      ctx.globalAlpha = alpha;
      ctx.drawImage(im, (v.x0 + h) * k, (v.z0 + h) * k, v.sw * k, v.sh * k, 0, 0, v.W, v.H);
      ctx.globalAlpha = 1;
    };
    drawImg(this.img, 1);
    if (this.layer) drawImg(this.overlays[this.layer], 0.85);
    // rutas: las no seleccionadas debajo, finas y discontinuas
    const order = Object.values(this.routes).filter(Boolean).sort((a, b) => (a.kind === this.sel) - (b.kind === this.sel));
    for (const rt of order) {
      const sel = rt.kind === this.sel;
      ctx.strokeStyle = KINDS[rt.kind].color; ctx.lineWidth = sel ? 5 : 2.5; ctx.setLineDash(sel ? [] : [8, 6]); ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.shadowColor = "#000"; ctx.shadowBlur = sel ? 6 : 0;
      ctx.beginPath(); rt.pts.forEach(([x, z], i) => { const [px, py] = this.toPx(x, z); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke();
      ctx.setLineDash([]); ctx.shadowBlur = 0;
    }
    // refugios y objetivos
    for (const o of Object.values(this.game.objectives)) {
      const [px, py] = this.toPx(o.world.x, o.world.z);
      if (px < -20 || py < -20 || px > v.W + 20 || py > v.H + 20) continue;
      ctx.lineWidth = 3; ctx.strokeStyle = o.shelter ? "#3DDC97" : "#fff";
      if (o.shelter) ctx.strokeRect(px - 7, py - 7, 14, 14); else { ctx.beginPath(); ctx.arc(px, py, 7, 0, 7); ctx.stroke(); }
      const tgt = this.game.target;
      this._label(t(o.name), px + 11, py + 4, tgt && o.id === tgt.id ? "#3DDC97" : "#fff");
    }
    if (this.goal) {
      const [gx, gy] = this.toPx(...this.goal);
      ctx.strokeStyle = "#3DDC97"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(gx, gy, 13, 0, 7); ctx.stroke();
      if (this.free) this._label(t(L("Destino", "Destination")), gx + 16, gy - 10, "#3DDC97");
    }
    this.waypoints.forEach(([x, z], i) => {
      const [px, py] = this.toPx(x, z);
      ctx.fillStyle = "#FFC23D"; ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 9, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#111"; ctx.font = "700 12px Rajdhani, sans-serif"; ctx.textAlign = "center"; ctx.fillText(String(i + 1), px, py + 4); ctx.textAlign = "left";
    });
    const [sx, sy] = this.toPx(...this.start);
    ctx.fillStyle = "#7FD1FF"; ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, 8, 0, 7); ctx.fill(); ctx.stroke();
    this._label(t(L("Tú", "You")), sx + 11, sy - 8, "#7FD1FF");
    // escala
    const mPerPx = v.sw / v.W, nice = [50, 100, 200, 500, 1000, 2000];
    const len = nice.reduce((b, n) => (n / mPerPx <= 140 ? n : b), 50), px = len / mPerPx;
    ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(v.W - px - 28, v.H - 34, px + 18, 26);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(v.W - px - 18, v.H - 14); ctx.lineTo(v.W - 18, v.H - 14); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "600 12px Rajdhani, sans-serif"; ctx.fillText(fmtDist(len, getLang()), v.W - px - 18, v.H - 18);
    ctx.fillText("N ▲", 10, 20);
  }
  _label(text, x, y, color) {
    const ctx = this.ctx;
    ctx.font = "600 13px Rajdhani, sans-serif"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  _click(e) {
    const r = this.cv.getBoundingClientRect(), [x, z] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
    const h = this.world.half - 12;
    if (Math.abs(x) > h || Math.abs(z) > h) return;
    if (this.world.blockedAt(x, z)) { $("planHint").textContent = t(L("Ese punto está en una pendiente de más de 25°: elige otro.", "That point is on a slope over 25°: pick another.")); return; }
    if (this.free && (this.pick === "goal" || !this.goal)) {
      // destino nuevo: se recalculan todas las rutas y los siguientes clics son puntos de paso
      this.goal = [x, z]; this.waypoints = []; this.sel = "safe"; this.pick = "way";
      $("planTitle").textContent = t(L("Hacia tu destino", "To your destination"));
      this._compute();
    } else if (this.free && this.pick === "start") {
      this.start = [x, z]; this.startMoved = true; this.pick = "way";
      this._compute();
    } else {
      this.waypoints.push([x, z]);
      this._custom();
    }
    this.render();
  }

  // ---- panel lateral ------------------------------------------------------------------
  // Tormenta pronosticada frente al tiempo de la ruta (segundos reales, los mismos que mide la estimacion)
  _storm(e) {
    const eta = this.game.weather && this.game.weather.eta();
    if (!eta) return null;
    const need = e.realMin * 60;
    return { inS: eta.inS, clearS: eta.clearS, ok: eta.inS > need, margin: eta.inS - need };
  }

  render() {
    const lang = getLang();
    $("planHint").textContent = t(L("Clic en el mapa = punto de paso para «Tu ruta» · las estimaciones usan tu perfil físico y tu carga", "Click the map = waypoint for “Your route” · estimates use your physical profile and load"));
    if (this.free) {
      document.querySelectorAll("#planPick [data-pick]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pick === this.pick)));
      $("planHint").textContent = t({
        goal: L("Clic en el mapa = tu destino (cualquier punto transitable del recorte de 6,1 km)", "Click the map = your destination (any walkable point of the 6.1 km crop)"),
        start: L("Clic en el mapa = punto de salida: el astronauta se coloca ahí al aplicar", "Click the map = start point: the astronaut is placed there when you apply"),
        way: L("Clic en el mapa = punto de paso para «Tu ruta» · las estimaciones usan tu perfil físico y tu carga", "Click the map = waypoint for “Your route” · estimates use your physical profile and load"),
      }[this.pick]);
    }
    if (!this.goal || !this.routes[this.sel]) {
      // modo libre sin destino (o sin ninguna ruta posible): solo el mapa y las instrucciones
      $("planRoutes").innerHTML = `<div class="pr-card empty"><span class="sw" style="background:#3DDC97"></span><div><b>${t(this.goal ? L("No hay ruta hasta ese punto", "No route to that point") : L("Sin destino todavía", "No destination yet"))}</b>
        <p>${t(this.goal ? L("Elige otro destino u otra salida.", "Pick another destination or start point.") : L("Haz clic en el mapa para definirlo. Después verás la ruta segura (A*), la línea recta, la escala en un refugio y tu propia ruta, con su consumo estimado.", "Click the map to set it. You will then see the safe route (A*), the straight line, the shelter stop and your own route, with their estimated cost."))}</p></div></div>`;
      $("planDetail").innerHTML = "";
      $("planUse").disabled = !(this.free && (this.goal || this.startMoved));
      this.draw();
      const pc = this.pcv; pc.getContext("2d").clearRect(0, 0, pc.width, pc.height);
      return;
    }
    $("planRoutes").innerHTML = Object.keys(KINDS).map((k) => {
      const r = this.routes[k], K = KINDS[k];
      if (!r) return k === "custom" ? `<div class="pr-card empty"><span class="sw" style="background:${K.color}"></span><div><b>${t(K.name)}</b><p>${t(K.desc)}</p></div></div>` : "";
      const e = r.est, [vt, vc] = VERDICT[e.verdict];
      const sw = this._storm(e);
      return `<button class="pr-card" data-k="${k}" aria-pressed="${k === this.sel}"><span class="sw" style="background:${K.color}"></span>
        <div><b>${t(K.name)}</b>${r.stop ? `<span class="muted small"> · ${t(r.stop.name)}</span>` : ""}
        <p>${fmtDist(e.dist, lang)} · ${num(e.realMin, 1, lang)} min · O₂ ${t(L("al llegar", "on arrival"))} ${Math.round(e.o2End)} %${sw ? ` · <span style="color:${sw.ok ? "#3DDC97" : "#ffb070"}">${sw.ok ? t(L("antes de la tormenta", "before the storm")) : sw.inS > 0 ? t(L("te alcanza la tormenta", "storm catches you")) : t(L("en plena tormenta", "inside the storm"))}</span>` : ""}</p></div>
        <em style="color:${vc}">${t(vt)}</em></button>`;
    }).join("");
    $("planRoutes").querySelectorAll("[data-k]").forEach((b) => { b.onclick = () => { this.sel = b.dataset.k; this.render(); }; });
    const r = this.routes[this.sel], e = r.est, [vt, vc] = VERDICT[e.verdict];
    const why = [];
    if (e.blockedM >= 1) why.push(t(L(`Cruza ${num(e.blockedM, 0, lang)} m de pendientes de más de 25°: en el juego no se puede pasar.`, `Crosses ${num(e.blockedM, 0, lang)} m of slopes over 25°: impassable in the game.`)));
    if (e.minO2 < 35 && e.blockedM < 1) why.push(t(L(`El O₂ baja hasta ${Math.round(e.minO2)} %: considera una escala en un refugio.`, `O₂ drops to ${Math.round(e.minO2)} %: consider a shelter stop.`)));
    if (e.fatigueEnd > 60) why.push(t(L("Llegarías muy fatigado: la marcha se vuelve más lenta.", "You would arrive very tired: walking slows down.")));
    const sw = this._storm(e);
    if (sw) why.push(sw.ok
      ? t(L(`Llegas ${num(sw.margin / 60, 1, lang)} min antes de que el frente de polvo llegue a tu posición (en ${num(sw.inS / 60, 1, lang)} min).`, `You arrive ${num(sw.margin / 60, 1, lang)} min before the dust front reaches your position (in ${num(sw.inS / 60, 1, lang)} min).`))
      : sw.inS > 0
        ? t(L(`El frente de polvo te alcanza a los ${num(sw.inS / 60, 1, lang)} min de ruta (${Math.round(100 * sw.inS / (e.realMin * 60))} % del camino). Busca un refugio más cercano o espera dentro.`, `The dust front catches you ${num(sw.inS / 60, 1, lang)} min into the route (${Math.round(100 * sw.inS / (e.realMin * 60))} % of the way). Pick a closer shelter or wait inside.`))
        : t(L(`Ya estás dentro de la tormenta: visibilidad baja, polvo en el visor y más gasto. Escampa en unos ${num((sw.clearS || 0) / 60, 1, lang)} min.`, `You are already inside the storm: low visibility, visor dust and higher drain. It clears in about ${num((sw.clearS || 0) / 60, 1, lang)} min.`)));
    if (e.arrivalHour % 24 > 17.5) why.push(t(L("Llegarías cerca del anochecer: el frío dispara el gasto de batería.", "You would arrive near sunset: cold drives up battery use.")));
    const row = (k, v) => `<tr><td>${t(k)}</td><td>${v}</td></tr>`;
    $("planDetail").innerHTML = `
      <div class="pr-verdict" style="border-color:${vc}"><b style="color:${vc}">${t(vt)}</b> · ${t(KINDS[this.sel].desc)}${why.length ? `<ul>${why.map((w) => `<li>${w}</li>`).join("")}</ul>` : ""}</div>
      <table class="kv">
        ${row(L("Distancia · desnivel", "Distance · elevation"), `${fmtDist(e.dist, lang)} · +${num(e.up, 0, lang)} / −${num(e.down, 0, lang)} m`)}
        ${row(L("Tiempo (juego · Marte)", "Time (game · Mars)"), `${num(e.realMin, 1, lang)} min · ${num(e.marsH, 1, lang)} h · ${t(L("llegada", "arrival"))} ${hhmm(e.arrivalHour)} LMST`)}
        ${row(L("O₂ al llegar · mínimo", "O₂ on arrival · minimum"), `${Math.round(e.o2End)} % · ${Math.round(e.minO2)} %`)}
        ${(e.stops || []).map((st) => row(L("Parada de recarga · espera", "Refill stop · wait"), `${num(st.waitMin, 1, lang)} min · O₂ ${t(L("mín.", "min"))} ${Math.round(st.minO2Before)} → ${Math.round(st.minO2After)} %`)).join("")}
        ${row(L("Batería · integridad al llegar", "Battery · integrity on arrival"), `${Math.round(e.energyEnd)} % · ${Math.round(e.integrityEnd)} %`)}
        ${row(L("Fatiga al llegar · energía", "Fatigue on arrival · energy"), `${Math.round(e.fatigueEnd)} % · ${num(e.kcal, 0, lang)} kcal`)}
        ${row(L("Pendiente máx. · T mínima", "Max slope · min T"), `${num(e.maxSlope, 1, lang)}° · ${num(e.coldMin, 0, lang)} °C`)}
        ${row(L("Terreno difícil", "Hard terrain"), `${t(L("rocas", "rocks"))} ${num(e.rockyM, 0, lang)} m · ${t(L("dunas", "dunes"))} ${num(e.duneM, 0, lang)} m · ${t(L("resbaladizo", "slippery"))} ${num(e.slipM, 0, lang)} m`)}
        ${row(L("Dosis de radiación", "Radiation dose"), `${num(e.dose, 1, lang)} µGy`)}
      </table>
      ${this._sources(r, e, lang)}`;
    $("planUse").disabled = !this.free && e.verdict === "blocked";
    this.draw();
    this._profile(r);
  }

  // De donde sale cada coste: que dato de NASA lo mide y cuanto de esta ruta pasa por el
  _sources(r, e, lang) {
    const pf = this.game.rules.pathfinding || {}, m = (v) => `${num(v, 0, lang)} m`;
    const rows = [
      [L("Pendiente", "Slope"), `${t(L("máx.", "max"))} ${num(e.maxSlope, 1, lang)}° · ${t(L("intransitable", "impassable"))} ${m(e.blockedM)}`,
        L("DTM HiRISE (1 m) + CTX (20 m), alineado con las alturas de Curiosity", "HiRISE (1 m) + CTX (20 m) DTMs, aligned to Curiosity's elevations")],
      [L("Rocas y bloques", "Rocks and boulders"), m(e.rockyM),
        L("Rugosidad del DTM HiRISE a 3 m (>0,6 m rocoso, >0,9 m campo de bloques)", "HiRISE DTM roughness at 3 m (>0.6 m rocky, >0.9 m boulder field)")],
      [L("Radiación", "Radiation"), `${num(e.radMean, 2, lang)} µGy/h · ${num(e.dose, 1, lang)} µGy`,
        L("MSL RAD (Curiosity) escalado con el cielo visible del DTM", "MSL RAD (Curiosity) scaled by sky view from the DTM")],
      [L("Frío", "Cold"), `${t(L("mín.", "min"))} ${num(e.coldMin, 0, lang)} °C`,
        L("Inercia térmica THEMIS (Odyssey) + ciclo diario de REMS", "THEMIS thermal inertia (Odyssey) + REMS daily cycle")],
      [L("Minerales", "Minerals"), `${t(L("arcillas", "clays"))} ${m(e.classM[1])} · ${t(L("sulfatos", "sulfates"))} ${m(e.classM[2])} · ${t(L("dunas", "dunes"))} ${m(e.classM[4])}`,
        L("MRO CRISM (D2300, SINDEX2), umbrales validados con Curiosity (~96 %)", "MRO CRISM (D2300, SINDEX2), thresholds validated against Curiosity (~96%)")],
      [L("Gasto del cuerpo", "Body cost"), `${num(e.kcal, 0, lang)} kcal`,
        L("Pandolf et al. 1977 a 0,379 g con tu perfil, traje y carga", "Pandolf et al. 1977 at 0.379 g with your profile, suit and load")],
    ];
    const astar = r.kind === "safe"
      ? `<p class="small muted">${t(L("La ruta segura minimiza", "The safe route minimizes"))}: 1 + ${pf.w_slope}·(${t(L("pendiente", "slope"))}/25)² + ${pf.w_rocks}·${t(L("rocas", "rocks"))} + ${pf.w_radiation}·${t(L("radiación", "radiation"))} + ${pf.w_cold}·${t(L("frío", "cold"))} (rules.json).</p>`
      : "";
    return `<h4 class="pr-src-h">${t(L("De dónde sale cada coste", "Where each cost comes from"))}</h4>
      <table class="kv pr-src">${rows.map(([k, v, src]) => `<tr><td>${t(k)}<small>${t(src)}</small></td><td>${v}</td></tr>`).join("")}</table>${astar}`;
  }

  _profile(r) {
    const cv = this.pcv, rc = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(rc.width * dpr); cv.height = Math.round(rc.height * dpr);
    const ctx = cv.getContext("2d"), W = rc.width, H = rc.height, lang = getLang();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pts = r.est.profile;
    let mn = Infinity, mx = -Infinity; pts.forEach(([, e]) => { mn = Math.min(mn, e); mx = Math.max(mx, e); });
    const pad = Math.max(4, (mx - mn) * 0.12), y0 = mn - pad, y1 = mx + pad, D = pts[pts.length - 1][0] || 1;
    const X = (d) => 46 + (d / D) * (W - 54), Y = (e) => 14 + (1 - (e - y0) / (y1 - y0)) * (H - 32);
    ctx.font = "600 11px Rajdhani, sans-serif"; ctx.fillStyle = "#bfafa3"; ctx.strokeStyle = "rgba(255,255,255,.1)";
    for (let i = 0; i <= 2; i++) { const e = y0 + ((y1 - y0) * i) / 2; ctx.beginPath(); ctx.moveTo(46, Y(e)); ctx.lineTo(W - 8, Y(e)); ctx.stroke(); ctx.fillText(num(e, 0, lang) + " m", 0, Y(e) + 4); }
    ctx.fillText(t(L("Perfil de elevación", "Elevation profile")), 46, 10);
    ctx.fillText(fmtDist(D, lang), W - 50, H - 4);
    const col = KINDS[r.kind].color;
    ctx.beginPath(); ctx.moveTo(X(0), H - 18); pts.forEach(([d, e]) => ctx.lineTo(X(d), Y(e))); ctx.lineTo(X(D), H - 18); ctx.closePath();
    ctx.globalAlpha = 0.25; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); pts.forEach(([d, e], i) => (i ? ctx.lineTo(X(d), Y(e)) : ctx.moveTo(X(d), Y(e)))); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
  }
}
