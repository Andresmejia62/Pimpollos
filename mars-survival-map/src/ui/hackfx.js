// Terminal del recorrido de entrada del atlas: lineas que se escriben solas y una barra de progreso por
// tramo. Solo decoracion: no bloquea el raton y se quita al instante si el usuario toma el control.
import { t } from "../i18n.js";

const $ = (id) => document.getElementById(id);
const L = (es, en) => ({ es, en });

export class HackFx {
  constructor() {
    this.el = $("atlasFx");
    this.el.innerHTML = "";
    const term = document.createElement("div");
    term.className = "fx-term";
    this.term = document.createElement("div");
    this.bar = document.createElement("div");
    this.bar.className = "fx-bar";
    term.append(this.term, this.bar);
    this.el.append(term);
    this.timers = new Set();
    this.run = 0;
  }

  _after(ms, fn) { const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms); this.timers.add(id); }
  _clear() { for (const id of this.timers) clearTimeout(id); this.timers.clear(); }

  start() {
    this._clear();
    this.run++;
    this.term.textContent = "";
    this.bar.textContent = "";
    this.el.hidden = false;
    this.el.classList.remove("out");
    this.line(t(L("MARS-NAV v4.2 // enlace MRO", "MARS-NAV v4.2 // MRO link")), "dim");
  }

  // Escribe una linea caracter a caracter
  line(text, cls = "", speed = 9) {
    const row = document.createElement("div");
    if (cls) row.className = cls;
    row.textContent = "> ";
    this.term.appendChild(row);
    while (this.term.children.length > 5) this.term.firstChild.remove();
    const run = this.run;
    let i = 0;
    const step = () => {
      if (run !== this.run) return;
      i = Math.min(text.length, i + 2);
      row.textContent = "> " + text.slice(0, i) + (i < text.length ? "_" : "");
      if (i < text.length) this._after(speed, step);
    };
    step();
  }

  // Un tramo del recorrido: objetivo, coordenadas, fuente de datos y barra de progreso del vuelo
  leg({ name, lat, lon, src, dur }) {
    this.line(`${t(L("fijando objetivo", "acquiring target"))}: ${name}`);
    this._after(120, () => this.line(`lat ${lat.toFixed(4)}  lon ${lon.toFixed(4)}`, "dim"));
    this._after(240, () => this.line(`${t(L("fuente", "source"))}: ${src}`, "dim"));
    const t0 = performance.now(), run = this.run, N = 14;
    const fill = () => {
      if (run !== this.run) return;
      const k = Math.min(1, (performance.now() - t0) / dur), n = Math.round(k * N);
      this.bar.textContent = `[${"█".repeat(n)}${"░".repeat(N - n)}] ${String(Math.round(k * 100)).padStart(3)}%`;
      if (k < 1) this._after(40, fill);
      else this.line(t(L("objetivo fijado", "target locked")), "ok");
    };
    fill();
  }

  finish() {
    this._after(250, () => this.line(t(L("ENLACE ESTABLE // manual", "LINK STABLE // manual")), "ok"));
    this._after(1100, () => this.el.classList.add("out"));
    this._after(1500, () => { this.run++; this._clear(); this.el.hidden = true; });
  }

  // Corte inmediato (el usuario movio la vista o cerro el atlas)
  stop() {
    this.run++;
    this._clear();
    this.el.classList.add("out");
    this._after(250, () => { this.el.hidden = true; });
  }
}
