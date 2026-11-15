// Panel del modo libre (simulacion): el usuario decide el destino, el punto de salida, la hora, las tormentas
// solares y que recursos se gastan. No hay mision ni guion: las reglas (rules.json) y la fisiologia son las mismas.
import { t, getLang } from "../i18n.js";
import { fmtDist, num } from "../geo.js";

const $ = (id) => document.getElementById(id);
const L = (es, en) => ({ es, en });
const hhmm = (h) => { h = ((h % 24) + 24) % 24; return `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`; };

export class SimPanel {
  // hooks: { pickTarget, gotoSite(id), profile, exportCsv, buddy(on), refill }
  constructor(game, hooks) {
    this.game = game;
    this.hooks = hooks;
    this.el = $("simPanel");
    this.log = [];            // mediciones hechas en los destinos propios
    this.buddyOn = true;
    this._t = 0;
    this.render();
  }

  get isOpen() { return !this.el.hidden; }
  show(on) { this.el.hidden = !on; if (on) this.update(0, true); }
  toggle() { this.show(this.el.hidden); }
  reset() { this.log = []; this.buddyOn = true; this.render(); }

  addReading(r) { this.log.unshift(r); this.log.length = Math.min(this.log.length, 12); this._log(); }

  render() {
    const g = this.game, sim = g.s.sim;
    const sites = Object.values(g.objectives).filter((o) => o.id !== "custom");
    const chk = (id, on, label) => `<label><input type="checkbox" id="${id}" ${on ? "checked" : ""}><span>${t(label)}</span></label>`;
    this.el.innerHTML = `
      <div class="th"><span>${t(L("Simulación · modo libre", "Simulation · free mode"))}</span><kbd>O</kbd></div>
      <div class="sim-tgt" id="simTgt"></div>
      <div class="sim-row"><button id="simPick"><kbd>G</kbd>${t(L("Definir destino y ruta", "Set destination and route"))}</button><button id="simClear">${t(L("Quitar", "Clear"))}</button></div>
      <label class="sim-field"><span>${t(L("Ir a", "Go to"))}</span><select id="simGoto"><option value="">${t(L("— teletransporte —", "— teleport —"))}</option>${sites.map((o) => `<option value="${o.id}">${t(o.name)}</option>`).join("")}</select></label>
      <label class="sim-field"><span>${t(L("Hora local", "Local time"))}</span><input type="range" id="simHour" min="0" max="23.75" step="0.25"><b id="simHourV"></b></label>
      <div class="sim-row"><button id="simStorm"></button><button id="simRefill"><kbd>K</kbd>${t(L("Recargar", "Refill"))}</button></div>
      <div class="sim-checks">
        ${chk("simO2", !sim.lockO2, L("Gastar O₂", "Use O₂"))}
        ${chk("simEn", !sim.lockEnergy, L("Gastar batería", "Drain battery"))}
        ${chk("simIn", !sim.lockIntegrity, L("Desgaste del traje", "Suit wear"))}
        ${chk("simBuddy", this.buddyOn, L("EVA-2 acompaña", "EVA-2 follows"))}
      </div>
      <div class="sim-row"><button id="simCar">${t(L("Traer rover", "Bring rover"))}</button><button id="simProfile">${t(L("Perfil", "Profile"))}</button></div>
      <div class="sim-row"><button id="simReset">${t(L("Contadores a cero", "Reset counters"))}</button><button id="simCsv">${t(L("Traza CSV", "Track CSV"))}</button></div>
      <div class="sim-stats" id="simStats"></div>
      <div class="sim-log" id="simLog"></div>`;
    const H = this.hooks;
    $("simPick").onclick = () => H.pickTarget();
    $("simClear").onclick = () => g.clearFreeTarget();
    $("simGoto").onchange = (e) => { if (e.target.value) H.gotoSite(e.target.value); e.target.value = ""; e.target.blur(); };
    $("simHour").oninput = (e) => { g.setHour(+e.target.value); this._hour(true); };
    $("simHour").onchange = (e) => e.target.blur();
    $("simStorm").onclick = () => { const sp = g.s.spe; sp && sp.phase !== "ended" ? g.endStorm() : g.triggerStorm(); this.update(0, true); };
    $("simRefill").onclick = () => H.refill();
    $("simO2").onchange = (e) => { sim.lockO2 = !e.target.checked; };
    $("simEn").onchange = (e) => { sim.lockEnergy = !e.target.checked; };
    $("simIn").onchange = (e) => { sim.lockIntegrity = !e.target.checked; };
    $("simBuddy").onchange = (e) => { this.buddyOn = e.target.checked; H.buddy(this.buddyOn); };
    $("simCar").onclick = () => g.summonVehicle();
    $("simProfile").onclick = () => H.profile();
    $("simReset").onclick = () => { g.resetCounters(); this.update(0, true); };
    $("simCsv").onclick = () => H.exportCsv();
    // que el teclado siga moviendo al astronauta despues de pulsar un boton del panel
    this.el.querySelectorAll("button, input[type=checkbox]").forEach((b) => b.addEventListener("click", () => b.blur()));
    this._log();
    this.update(0, true);
  }

  _hour(fromSlider = false) {
    const h = ((this.game.hour % 24) + 24) % 24;
    $("simHourV").textContent = hhmm(h);
    if (!fromSlider && document.activeElement !== $("simHour")) $("simHour").value = String(Math.round(h * 4) / 4);
  }

  _log() {
    const el = $("simLog"), lang = getLang();
    if (!el) return;
    el.innerHTML = this.log.length
      ? `<div class="h">${t(L("Mediciones", "Readings"))}</div>` + this.log.map((r) =>
        `<div class="li"><b>${r.n}</b> ${num(r.elev, 0, lang)} m · ${num(r.slope, 0, lang)}° · ${num(r.temp, 0, lang)} °C · ${num(r.dose, 2, lang)} µGy/h · ${t(r.mineral)}</div>`).join("")
      : "";
  }

  update(now, force = false) {
    if (this.el.hidden || (!force && now - this._t < 0.25)) return;
    this._t = now;
    const g = this.game, s = g.s, lang = getLang(), tg = g.objectives.custom;
    $("simTgt").innerHTML = tg
      ? `<b>${t(tg.name)}</b> · ${fmtDist(g.distTo(tg), lang)}${s.scanned ? ` · <i>${t(L("medido ✓", "measured ✓"))}</i>` : ""}`
      : `<i>${t(L("Sin destino: explora libremente o define uno", "No destination: roam freely or set one"))}</i>`;
    $("simClear").disabled = !tg;
    const sp = s.spe, storm = sp && sp.phase !== "ended";
    $("simStorm").innerHTML = `<kbd>T</kbd>${t(storm ? L("Terminar tormenta", "End storm") : L("Tormenta solar", "Solar storm"))}`;
    $("simStorm").setAttribute("aria-pressed", String(!!storm));
    $("simCar").disabled = s.driving;
    this._hour();
    const b = s.bio;
    $("simStats").textContent = `${fmtDist(s.movedTotal, lang)} · ${num(b.kcal, 0, lang)} kcal · O₂ ${num(b.o2g, 0, lang)} g · ${num(b.doseUgy, 1, lang)} µGy · ${t(L("mediciones", "readings"))}: ${s.freeDone}`;
  }
}
