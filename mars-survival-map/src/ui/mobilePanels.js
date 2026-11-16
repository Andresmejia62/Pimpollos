// Paneles plegables del HUD en movil y tableta (en escritorio no se crea nada visible ni cambia nada).
//  - minimapa: boton de plegar/desplegar en su esquina; en un telefono en vertical empieza plegado
//  - leyenda de la capa: tocarla la pliega a su titulo (su contenido lo reescribe hud.js; el panel se conserva)
// La telemetria ya se pliega con el boton ⓘ y el panel de simulacion se abre como cajon lateral (ver touch.js).
import { t } from "../i18n.js";
import { device, onDeviceChange } from "../utils/deviceProfile.js";

const L = (es, en) => ({ es, en });
const $ = (id) => document.getElementById(id);

export class MobilePanels {
  constructor() {
    this.userMini = null;            // eleccion del jugador (null = la de por defecto segun el perfil)
    const mini = $("minimapPanel");
    const b = (this.miniBtn = document.createElement("button"));
    b.type = "button";
    b.className = "fold-btn";
    b.id = "foldMini";
    b.innerHTML = `<span class="ic" aria-hidden="true"></span>`;
    b.onclick = (e) => { e.stopPropagation(); this.userMini = !this.miniFolded; this.apply(); };
    mini.appendChild(b);
    const lg = $("legend");
    this.userLegend = null;
    lg.addEventListener("click", () => { if (device.isTouchUI) { this.userLegend = !lg.classList.contains("folded"); this.userMini = null; this.apply(); } });
    onDeviceChange(() => this.apply());
    this.apply();
  }
  get miniFolded() { return $("minimapPanel").classList.contains("folded"); }

  apply() {
    const touchUI = device.isTouchUI;
    const mobile = device.kind === "mobile", portrait = device.orientation === "portrait";
    // la leyenda empieza plegada en el telefono (solo el titulo de la capa); en tableta, desplegada
    const lgFolded = touchUI && (this.userLegend ?? mobile);
    $("legend").classList.toggle("folded", lgFolded);
    // minimapa plegado en un telefono en vertical; en horizontal, mientras la leyenda esta desplegada (no caben los dos)
    const def = mobile && (portrait || (!lgFolded && !$("legend").hidden));
    $("minimapPanel").classList.toggle("folded", touchUI && (this.userMini ?? def));
    this._labels();
  }
  _labels() {
    const f = this.miniFolded;
    this.miniBtn.querySelector(".ic").textContent = f ? "▦" : "–";
    const txt = t(f ? L("Desplegar el minimapa", "Show the minimap") : L("Plegar el minimapa", "Fold the minimap"));
    this.miniBtn.title = txt; this.miniBtn.setAttribute("aria-label", txt);
    this.miniBtn.setAttribute("aria-expanded", String(!f));
    const lg = $("legend"), lf = lg.classList.contains("folded");
    lg.title = device.isTouchUI ? t(lf ? L("Toca para ver la leyenda", "Tap to show the legend") : L("Toca para plegar la leyenda", "Tap to fold the legend")) : "";
  }
  applyLang() { this._labels(); }
}
