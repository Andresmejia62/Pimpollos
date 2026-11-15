// Movil, fase 1: la API tactil de engine/controls.js (la que usan los controles en pantalla de ui/touch.js).
// Comprueba que el joystick, los botones y la camara llegan al juego por el mismo camino que el teclado,
// con sus limites, y que el teclado tiene prioridad y no cambia.
import { ok, summary } from "./helpers.mjs";

// entorno minimo de navegador para construir Controls en Node
const listeners = {};
globalThis.window = { addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, location: { search: "" } };
globalThis.document = { addEventListener() {}, pointerLockElement: null };
const canvas = { addEventListener() {}, requestPointerLock: null };
const { Controls } = await import("../src/engine/controls.js");

const c = new Controls(canvas);
c.yaw = Math.PI;                         // mirando al sur (+z)
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// joystick: vector analogico, el modulo (velocidad) se conserva
c.touchMove = [0, 0.5];
let v = c.moveVector();
ok(v && near(v[0], 0, 1e-12) && near(v[1], 0.5), "joystick adelante a media carrera -> andar al 50 % hacia donde mira la camara", JSON.stringify(v));
c.touchMove = [1, 0];
v = c.moveVector();
ok(v && near(Math.hypot(...v), 1) && v[0] < -0.99, "joystick a la derecha -> derecha de la camara (al mirar al sur, el oeste)", JSON.stringify(v.map((x) => +x.toFixed(3))));
c.touchMove = [0.0001, 0];
ok(c.moveVector() === null, "un joystick casi en reposo no mueve");
// el teclado manda sobre el joystick y sigue dando un vector unitario
c.touchMove = [0, 0.3];
c.keys.add("w");
v = c.moveVector();
ok(v && near(Math.hypot(...v), 1), "con W pulsada se usa el teclado (vector unitario), no el joystick", JSON.stringify(v.map((x) => +x.toFixed(3))));
c.keys.delete("w");

// saltar mantenido
c.touchJump = true;
ok(c.jumpHeld(), "boton de saltar mantenido -> jumpHeld()");
c.touchJump = false;
ok(!c.jumpHeld(), "soltar el boton -> sin salto");

// mantener F (ayudar a EVA-2) usa el mismo estado que el teclado
c.hold("f", true);
ok(c.keys.has("f"), "mantener F en pantalla -> keys.has('f') como con el teclado");
// soltar todo (blur, pausa, cancelacion)
c.touchMove = [0, 1]; c.touchJump = true;
c.releaseTouch();
ok(c.touchMove === null && !c.touchJump && !c.keys.has("f"), "releaseTouch() suelta joystick, salto y F");

// botones discretos: mismo manejador que keydown, solo con los controles activos
const got = [];
c.on("key", (k) => got.push(k));
c.press("e");
ok(got.length === 0, "con los controles desactivados (menus) un boton no hace nada");
c.enabled = true;
c.press("e"); c.press("escape");
ok(got.join(",") === "e,escape", "con la partida activa, cada boton llama al manejador de teclas", got.join(","));

// camara: inclinacion y distancia limitadas
for (let i = 0; i < 100; i++) c.look(0, 500);
ok(near(c.pitch, -1.1), "arrastrar hacia abajo sin fin: inclinacion limitada a -1,1 rad", c.pitch.toFixed(3));
for (let i = 0; i < 100; i++) c.look(0, -500);
ok(near(c.pitch, 0.45), "arrastrar hacia arriba sin fin: inclinacion limitada a 0,45 rad", c.pitch.toFixed(3));
for (let i = 0; i < 50; i++) c.zoomBy(0.5);
ok(c.dist === 3, "pellizcar sin fin: distancia minima 3 m", String(c.dist));
for (let i = 0; i < 50; i++) c.zoomBy(2);
ok(c.dist === 120, "abrir sin fin: distancia maxima 120 m", String(c.dist));
summary("test_touch_input");
