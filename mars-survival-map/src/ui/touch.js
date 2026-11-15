// Controles tactiles (movil y tableta). Solo se crean si device.js -> TOUCH.
//
// Principio: no hay logica de juego nueva. Cada control llama a la misma API que el teclado (engine/controls.js):
//   joystick        -> controls.touchMove (vector analogico; el modulo da la velocidad)
//   arrastrar       -> controls.look()            (mitad derecha de la pantalla; o la izquierda si ya hay joystick)
//   pellizcar       -> controls.zoomBy()          (dos dedos en la zona de camara)
//   botones         -> controls.press(tecla)      (E, V, R, Esc, M, G, O, gestos: el mismo manejador que keydown)
//   mantener        -> controls.hold("f") / touchJump
// Robustez: cada dedo se sigue por su pointerId (joystick y camara a la vez), pointercancel/blur/ocultar la
// pagina sueltan todo, y al salir del juego (pausa, menus, mapa) los controles se ocultan y se reinician.
import { t } from "../i18n.js";

const L = (es, en) => ({ es, en });
const JOY_R = 56;          // radio del joystick (px)
const DEAD = 0.14;         // zona muerta del joystick (fraccion del radio)

export class TouchUI {
  // isActive(): true si la partida esta en marcha sin menus encima. Se consulta en CADA toque (no solo en el
  // bucle), para que un dedo no actue en el instante entre abrir la pausa y el siguiente fotograma.
  constructor(controls, canvas, isActive = () => true) {
    this.c = controls;
    this.canvas = canvas;
    this.isActive = isActive;
    this.active = false;
    this.joy = null;                 // { id, x0, y0 }
    this.looks = new Map();          // pointerId -> { x, y }
    this.pinch = 0;
    document.body.classList.add("touch");
    this._build();
    this._bindCanvas();
    const reset = () => this.reset();
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", () => { if (document.hidden) reset(); });
  }

  _build() {
    const el = (this.el = document.createElement("div"));
    el.className = "touch-ui";
    el.id = "touchUI";
    el.hidden = true;
    el.innerHTML = `
      <div class="tj-base" id="tjBase" hidden><div class="tj-knob" id="tjKnob"></div></div>
      <div class="tc-top">
        <button class="tbtn" data-k="escape" data-l="pause"><span class="ic">❚❚</span></button>
        <button class="tbtn" data-k="m" data-l="atlas"><span class="ic">◎</span></button>
        <button class="tbtn" data-k="i" data-l="info"><span class="ic">ⓘ</span></button>
        <button class="tbtn free-only" data-k="g" data-l="plan"><span class="ic">⌖</span></button>
        <button class="tbtn free-only" data-k="o" data-l="panel"><span class="ic">☰</span></button>
      </div>
      <!-- fila de acciones abajo a la derecha (de derecha a izquierda): saltar, gestos y, segun el momento,
           el menu de gestos o las acciones de contexto. Todo en la misma fila: nada sube hacia el minimapa -->
      <div class="tc-actions">
        <button class="tbtn big hold" id="tbJump" data-jump="1" data-l="jump"><span class="ic">⤒</span><em></em></button>
        <button class="tbtn sm" id="tbEmote" data-l="emote"><span class="ic">☺</span></button>
        <div class="tc-emotes" id="tcEmotes" hidden>
          <button class="tbtn sm" data-k="z" data-l="wave"><span class="ic">✋</span></button>
          <button class="tbtn sm" data-k="x" data-l="thumbs"><span class="ic">👍</span></button>
          <button class="tbtn sm" data-k="c" data-l="sit"><span class="ic">⌂</span></button>
          <button class="tbtn sm" data-k="j" data-l="dance"><span class="ic">♪</span></button>
          <button class="tbtn sm" data-k="b" data-l="stretch"><span class="ic">⤢</span></button>
        </div>
        <div class="tc-ctx" id="tcCtx">
          <button class="tbtn ctx" id="tbVisor" data-k="v" data-l="visor" hidden><span class="ic">◐</span><em></em></button>
          <button class="tbtn ctx hold" id="tbAssist" data-hold="f" data-l="assist" hidden><span class="ic">✚</span><em></em></button>
          <button class="tbtn ctx" id="tbCar" data-k="e" data-l="car" hidden><span class="ic">⛟</span><em></em></button>
        </div>
      </div>
      <div class="tc-rotate" id="tcRotate" hidden></div>`;
    document.body.appendChild(el);
    this.base = el.querySelector("#tjBase");
    this.knob = el.querySelector("#tjKnob");
    this.emotes = el.querySelector("#tcEmotes");
    this.applyLang();
    // botones: se actua al tocar (sin esperar al "click", que en movil llega con retraso)
    el.querySelectorAll(".tbtn").forEach((b) => {
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!this.isActive()) { this.update({ active: false }); return; }
        if (b.setPointerCapture) try { b.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
        b.classList.add("on");
        if (b.dataset.hold) this.c.hold(b.dataset.hold, true);
        else if (b.dataset.jump) this.c.touchJump = true;
        else if (b.id === "tbEmote") this._emotes(this.emotes.hidden);
        else if (b.dataset.k) {
          if (b.parentElement === this.emotes) this._emotes(false);
          this.c.press(b.dataset.k);
        }
      });
      const up = () => {
        b.classList.remove("on");
        if (b.dataset.hold) this.c.hold(b.dataset.hold, false);
        else if (b.dataset.jump) this.c.touchJump = false;
      };
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      b.addEventListener("lostpointercapture", up);
      b.addEventListener("contextmenu", (e) => e.preventDefault());
    });
  }

  applyLang() {
    const T = {
      pause: L("Pausa", "Pause"), atlas: L("Atlas", "Atlas"), info: L("Telemetría", "Telemetry"), plan: L("Destino y ruta", "Destination and route"), panel: L("Panel de simulación", "Simulation panel"),
      car: L("Rover", "Rover"), assist: L("Ayudar", "Help"), visor: L("Visor", "Visor"), emote: L("Gestos", "Emotes"), jump: L("Saltar", "Jump"),
      wave: L("Saludar", "Wave"), thumbs: L("Pulgar arriba", "Thumbs up"), sit: L("Sentarse", "Sit"), dance: L("Bailar", "Dance"), stretch: L("Estirarse", "Stretch"),
    };
    this.el.querySelectorAll("[data-l]").forEach((b) => {
      const txt = t(T[b.dataset.l]);
      b.setAttribute("aria-label", txt);
      const em = b.querySelector("em");
      if (em) em.textContent = txt;
    });
    this.el.querySelector("#tcRotate").textContent = t(L("Gira el teléfono: se juega en horizontal", "Turn your phone: the game is played in landscape"));
  }

  // ---- dedos sobre la escena: joystick (izquierda) y camara (derecha / segundo dedo) --------------------------
  _bindCanvas() {
    const cv = this.canvas;
    cv.style.touchAction = "none";
    cv.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      if (!this.active || !this.isActive()) { if (this.active) this.update({ active: false }); return; }
      e.preventDefault();
      if (cv.setPointerCapture) try { cv.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
      this._emotes(false);
      if (!this.joy && e.clientX < window.innerWidth * 0.42) {
        this.joy = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
        this.base.hidden = false;
        // la capa tactil empieza dentro de la zona segura (notch): se resta su origen
        const o = this.el.getBoundingClientRect();
        this.base.style.transform = `translate(${e.clientX - o.left - JOY_R}px, ${e.clientY - o.top - JOY_R}px)`;
        this._knob(0, 0);
      } else {
        this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.pinch = this._pinchDist();
      }
    }, { passive: false });
    cv.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse" || !this.active) return;
      if (!this.isActive()) { this.update({ active: false }); return; }
      if (this.joy && e.pointerId === this.joy.id) {
        let dx = e.clientX - this.joy.x0, dy = e.clientY - this.joy.y0;
        const d = Math.hypot(dx, dy);
        if (d > JOY_R) { dx *= JOY_R / d; dy *= JOY_R / d; }       // el mando no sale del circulo
        this._knob(dx, dy);
        const r = Math.min(d, JOY_R), m = r / JOY_R;
        // zona muerta y reescalado: un poco de dedo = andar despacio, todo el radio = velocidad normal
        if (m < DEAD) this.c.touchMove = null;
        else {
          const mag = (m - DEAD) / (1 - DEAD);
          this.c.touchMove = [(dx / r) * mag, (-dy / r) * mag];   // [lado (derecha +), adelante (+)]
        }
        return;
      }
      const p = this.looks.get(e.pointerId);
      if (!p) return;
      if (this.looks.size >= 2) {
        p.x = e.clientX; p.y = e.clientY;
        const nd = this._pinchDist();
        if (this.pinch > 0 && nd > 0) this.c.zoomBy(this.pinch / nd);
        this.pinch = nd;
      } else {
        this.c.look(e.clientX - p.x, e.clientY - p.y);
        p.x = e.clientX; p.y = e.clientY;
      }
    }, { passive: false });
    const end = (e) => {
      if (e.pointerType === "mouse") return;
      if (this.joy && e.pointerId === this.joy.id) this._endJoy();
      if (this.looks.delete(e.pointerId)) this.pinch = this._pinchDist();
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("lostpointercapture", end);
  }
  // menu de gestos: se abre en la fila (ocultando un momento las acciones de contexto) y se cierra solo
  _emotes(open) {
    clearTimeout(this._emoteT);
    this.emotes.hidden = !open;
    this.el.querySelector("#tcCtx").hidden = open;
    this.el.querySelector("#tbEmote").classList.toggle("open", open);
    if (open) this._emoteT = setTimeout(() => this._emotes(false), 5000);
  }
  _pinchDist() {
    if (this.looks.size < 2) return 0;
    const [a, b] = [...this.looks.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  _knob(dx, dy) { this.knob.style.transform = `translate(${dx}px, ${dy}px)`; }
  _endJoy() { this.joy = null; this.c.touchMove = null; this.base.hidden = true; this._knob(0, 0); }

  // suelta todos los dedos y botones (pausa, menus, perder el foco, cancelacion del sistema)
  reset() {
    this._endJoy();
    this.looks.clear();
    this.pinch = 0;
    this.c.releaseTouch();
    this.el.querySelectorAll(".tbtn.on").forEach((b) => b.classList.remove("on"));
    this._emotes(false);
  }

  // st: { active, driving, free, car, assist, visor } (car/assist/visor = los avisos del HUD visibles)
  update(st) {
    if (st.active !== this.active) { this.active = st.active; if (!st.active) this.reset(); }
    this.el.hidden = !st.active;
    if (!st.active) return;
    this.el.classList.toggle("free", !!st.free);
    this.el.querySelector("#tbCar").hidden = !st.car;
    this.el.querySelector("#tbAssist").hidden = !st.assist;
    this.el.querySelector("#tbVisor").hidden = !st.visor;
    this.el.querySelector("#tbJump").hidden = !!st.driving;
    this.el.querySelector("#tbEmote").hidden = !!st.driving;
    if (st.driving && !this.emotes.hidden) this._emotes(false);
    this.el.querySelector("#tcRotate").hidden = window.innerWidth >= window.innerHeight;
    this._layout();
  }

  // Coloca los controles segun el HUD real (no con distancias fijas): los botones de arriba justo debajo del panel
  // de recursos y la fila de acciones justo encima del panel de mision. Asi no se pisan en ningun tamano de pantalla
  // aunque los paneles crezcan (textos con tamano minimo, idioma, zona segura).
  _layout() {
    const box = this.el.getBoundingClientRect();
    const res = document.querySelector("#hud .res"), mis = document.querySelector("#hud .mission");
    const top = this.el.querySelector(".tc-top"), act = this.el.querySelector(".tc-actions");
    const rr = res && res.getBoundingClientRect(), mr = mis && mis.getBoundingClientRect();
    if (rr && rr.height) top.style.top = `${Math.round(rr.bottom - box.top + 8)}px`;
    if (mr && mr.height) act.style.bottom = `${Math.round(box.bottom - mr.top + 10)}px`;
    // el dialogo, justo debajo del tutorial cuando este esta a la vista (si no, su sitio normal)
    const hud = document.getElementById("hud"), tut = document.getElementById("tutorial"), dlg = document.getElementById("dialog");
    if (hud && tut && dlg) {
      const tr = tut.hidden ? null : tut.getBoundingClientRect();
      dlg.style.top = tr && tr.height ? `${Math.round(tr.bottom - hud.getBoundingClientRect().top + 10)}px` : "";
    }
  }
}
