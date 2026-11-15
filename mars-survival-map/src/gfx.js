// Ajustes graficos que el jugador puede cambiar (menu de pausa -> Sonido y graficos). Se guardan en el navegador.
//  bloom: resplandor de las luces (faros, ventanas, sol) con post-proceso; cuesta algo de GPU
//  env:   reflejos del cielo de Marte en metal y vidrio (mapa de entorno filtrado, PMREM)
const KEY = "msm-gfx";
export const GFX = { bloom: true, env: true };
try { Object.assign(GFX, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { /* sin almacenamiento */ }
const fns = [];
export function onGfx(fn) { fns.push(fn); }
export function setGfx(k, v) {
  GFX[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(GFX)); } catch { /* sin almacenamiento */ }
  fns.forEach((f) => f(GFX));
}
