// Ajustes graficos que el jugador puede cambiar (menu de pausa -> Sonido y graficos). Se guardan en el navegador.
//  bloom: resplandor de las luces (faros, ventanas, sol) con post-proceso; cuesta algo de GPU
//  env:   reflejos del cielo de Marte en metal y vidrio (mapa de entorno filtrado, PMREM)
import { TOUCH } from "./device.js";
const KEY = "msm-gfx";
// preset movil: sin resplandor por defecto (es el post-proceso mas caro); se puede activar en la pausa
export const GFX = { bloom: !TOUCH, env: true };
// densidad maxima de pixeles y tamano del mapa de sombras (en movil, menos: GPU y memoria mas justas)
export const MAX_DPR = TOUCH ? 1.25 : 1.75;
export const SHADOW_SIZE = TOUCH ? 1024 : 2048;
try { Object.assign(GFX, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { /* sin almacenamiento */ }
const fns = [];
export function onGfx(fn) { fns.push(fn); }
export function setGfx(k, v) {
  GFX[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(GFX)); } catch { /* sin almacenamiento */ }
  fns.forEach((f) => f(GFX));
}
