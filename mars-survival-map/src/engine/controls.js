import { Raycaster, Vector3 } from "three";
import { TOUCH } from "../device.js";
// Entrada de teclado/raton (y tactil, via ui/touch.js) y camara en tercera persona.
export class Controls {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.yaw = Math.PI;      // mirando al sur (hacia el monte)
    this.pitch = -0.18;
    this.dist = 7;
    this.locked = false;
    this.handlers = {};
    this.enabled = false;
    // entrada tactil (ui/touch.js): joystick analogico [lado, adelante] con modulo <= 1, y salto mantenido
    this.touchMove = null;
    this.touchJump = false;
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      // Espacio = saltar: que no desplace la pagina ni pulse el boton que tenga el foco
      if (this.enabled && k === " " && !(e.target instanceof HTMLButtonElement)) e.preventDefault();
      this.keys.add(k);
      if (this.enabled && this.handlers.key) this.handlers.key(k, e);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
    canvas.addEventListener("click", () => {
      // en pantallas tactiles no hay captura del puntero: la camara se gira arrastrando el dedo
      if (!TOUCH && this.enabled && !this.locked && canvas.requestPointerLock) {
        const p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      }
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.handlers.lock) this.handlers.lock(this.locked);
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0025;
      this.pitch = Math.max(-1.1, Math.min(0.45, this.pitch - e.movementY * 0.0022));
    });
    // sin captura del raton: arrastrar tambien gira la camara
    let drag = null;
    canvas.addEventListener("mousedown", (e) => { if (!this.locked) drag = [e.clientX, e.clientY]; });
    window.addEventListener("mouseup", () => { drag = null; });
    window.addEventListener("mousemove", (e) => {
      if (!drag || this.locked) return;
      this.yaw -= (e.clientX - drag[0]) * 0.004;
      this.pitch = Math.max(-1.1, Math.min(0.45, this.pitch - (e.clientY - drag[1]) * 0.003));
      drag = [e.clientX, e.clientY];
    });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.dist = Math.max(3, Math.min(120, this.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
    }, { passive: false });
  }

  on(evt, fn) { this.handlers[evt] = fn; }

  // ---- API para los controles tactiles: las mismas acciones que el teclado, por el mismo camino --------------
  // pulsar una tecla (accion discreta: E, V, R, Esc...): mismo manejador que keydown
  press(k) { if (this.enabled && this.handlers.key) this.handlers.key(k, { target: null, preventDefault() {} }); }
  // mantener una tecla (F para ayudar a EVA-2): el juego la lee igual que si estuviera pulsada en el teclado
  hold(k, on) { if (on) this.keys.add(k); else this.keys.delete(k); }
  // girar la camara con el dedo (px de desplazamiento)
  look(dx, dy) {
    this.yaw -= dx * 0.0055;
    this.pitch = Math.max(-1.1, Math.min(0.45, this.pitch - dy * 0.0042));
  }
  zoomBy(k) { this.dist = Math.max(3, Math.min(120, this.dist * k)); }
  // suelta todo (al perder el foco, al pausar o si el sistema cancela un toque)
  releaseTouch() { this.touchMove = null; this.touchJump = false; this.keys.delete("f"); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  // Vector de movimiento en el plano (x Este, z Sur) segun WASD/flechas y la orientacion de la camara
  moveVector() {
    const k = this.keys;
    let f = 0, s = 0;
    if (k.has("w") || k.has("arrowup")) f += 1;
    if (k.has("s") || k.has("arrowdown")) f -= 1;
    if (k.has("d") || k.has("arrowright")) s += 1;
    if (k.has("a") || k.has("arrowleft")) s -= 1;
    let mag = 1;
    // joystick tactil: solo si no se usa el teclado; el modulo (0..1) da la velocidad (andar despacio o normal)
    if (!f && !s && this.touchMove) {
      [s, f] = this.touchMove;
      mag = Math.min(1, Math.hypot(s, f));
      if (mag < 1e-3) return null;
    }
    if (!f && !s) return null;
    // yaw = 0 mira al norte (-z); yaw = PI mira al sur (+z)
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let x = fx * f + rx * s, z = fz * f + rz * s;
    const l = Math.hypot(x, z);
    return [(x / l) * mag, (z / l) * mag];
  }

  jumpHeld() { return this.keys.has(" ") || this.touchJump; }

  // Coloca la camara detras del jugador sin atravesar el terreno ni las estructuras.
  // occluders(x, z) -> grupos 3D cercanos: si alguno se interpone entre la cabeza y la camara (un techo, una
  // pared), la camara se acerca hasta justo delante del obstaculo. La distancia se suaviza al alejarse.
  updateCamera(camera, target, groundAt, occluders = null) {
    const cp = Math.cos(this.pitch);
    const dx = Math.sin(this.yaw) * cp, dz = Math.cos(this.yaw) * cp, dy = -Math.sin(this.pitch);
    const head = { x: target.x, y: target.y + 1.7, z: target.z };
    let dist = this.dist;
    const near = occluders ? occluders(target.x, target.z) : null;
    if (near && near.length) {
      const ray = (this._ray ||= new Raycaster());
      ray.layers.enable(31);                       // mallas originales de las estructuras fusionadas (engine/merge.js)
      const o = (this._o ||= new Vector3()), d = (this._d ||= new Vector3());
      o.set(head.x, head.y + 0.3, head.z);
      d.set(dx * this.dist, dy * this.dist + 0.3, dz * this.dist);
      const full = d.length();
      ray.set(o, d.normalize());
      ray.far = full;
      const hit = ray.intersectObjects(near, true).find((h) => h.object.visible && !h.object.userData.noShadow && !h.object.material.transparent);
      if (hit) dist = Math.max(0.6, (hit.distance - 0.35) * (this.dist / full));
    }
    // acercarse de golpe (para no ver a traves), alejarse poco a poco (para que no salte)
    this._camDist = this._camDist == null || dist < this._camDist ? dist : this._camDist + (dist - this._camDist) * 0.08;
    dist = this._camDist;
    let cx = head.x + dx * dist, cy = head.y + dy * dist + 0.6 * Math.min(1, dist / 3), cz = head.z + dz * dist;
    const g = groundAt(cx, cz) + 1.2;
    if (cy < g) cy = g;
    camera.position.set(cx, cy, cz);
    camera.lookAt(head.x, head.y + 0.3, head.z);
  }
}
