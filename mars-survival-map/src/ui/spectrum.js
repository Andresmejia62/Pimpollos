// Tarea de la tarjeta de escaneo: identificar el mineral por su espectro infrarrojo, como hace el equipo de
// CRISM. Curvas esquematicas de reflectancia (1,0-2,6 µm) con las bandas de absorcion diagnosticas:
//  - arcillas Fe/Mg (esmectitas): 1,41 · 1,91 · 2,30 µm (agua en la estructura + enlace metal-OH)
//  - sulfatos polihidratados: 1,44 · 1,94 µm y caida hacia 2,4 µm (agua de hidratacion + SO4)
//  - basalto (piroxeno/olivino): bandas anchas del hierro en ~1,0 y ~2,0 µm, sin agua
import { t } from "../i18n.js";

const L = (es, en) => ({ es, en });
export const MINERALS = {
  clay: { name: L("Arcillas (filosilicatos)", "Clays (phyllosilicates)"), color: "#4FC3F7",
    bands: [[1.41, 0.022, 0.035], [1.91, 0.035, 0.07], [2.30, 0.025, 0.06]],
    why: L("Las bandas estrechas en 1,4 y 1,9 µm son agua dentro del mineral, y la de 2,3 µm es el enlace Fe/Mg-OH típico de las arcillas.", "The narrow bands at 1.4 and 1.9 µm are water inside the mineral, and the 2.3 µm band is the Fe/Mg-OH bond typical of clays.") },
  sulfate: { name: L("Sulfatos hidratados", "Hydrated sulfates"), color: "#C792EA",
    bands: [[1.44, 0.03, 0.04], [1.94, 0.045, 0.09], [2.42, 0.06, 0.07]],
    why: L("Bandas anchas de agua en 1,4 y 1,9 µm y una caída hacia 2,4 µm: así se ven los sulfatos polihidratados, sales que dejó el agua al evaporarse.", "Broad water bands at 1.4 and 1.9 µm and a drop towards 2.4 µm: that is how polyhydrated sulfates look, salts left behind as water evaporated.") },
  basalt: { name: L("Basalto (sin agua)", "Basalt (no water)"), color: "#bfa38a",
    bands: [[1.0, 0.16, 0.1], [2.0, 0.28, 0.07]],
    why: L("Solo dos bandas muy anchas del hierro en 1 y 2 µm, sin las bandas estrechas del agua: roca volcánica que no se alteró con agua.", "Only two very broad iron bands at 1 and 2 µm, without the narrow water bands: volcanic rock never altered by water.") },
};

const refl = (lam, m) => {
  let r = 0.28 + 0.05 * (lam - 1.0);
  for (const [c, w, d] of MINERALS[m].bands) r -= d * Math.exp(-(((lam - c) / w) ** 2));
  return r;
};

// Pinta el espectro de `m` en el lienzo (con el eje en µm y las bandas marcadas tras responder)
export function drawSpectrum(cv, m, reveal = false) {
  const rc = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  const W = rc.width || 360, H = rc.height || 130;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const x = cv.getContext("2d");
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  const X = (l) => 30 + ((l - 1.0) / 1.6) * (W - 40), Y = (r) => 10 + (1 - (r - 0.12) / 0.26) * (H - 30);
  x.font = "600 11px Rajdhani, sans-serif"; x.fillStyle = "#bfafa3"; x.strokeStyle = "rgba(255,255,255,.1)";
  for (const l of [1.0, 1.4, 1.8, 2.2, 2.6]) { x.beginPath(); x.moveTo(X(l), 8); x.lineTo(X(l), H - 20); x.stroke(); x.fillText(`${l.toFixed(1)} µm`, X(l) - 14, H - 6); }
  x.save(); x.translate(10, H / 2 + 24); x.rotate(-Math.PI / 2); x.fillText(t(L("reflectancia", "reflectance")), 0, 0); x.restore();
  if (reveal) for (const [c] of MINERALS[m].bands) { x.fillStyle = "rgba(255,211,77,.18)"; x.fillRect(X(c) - 5, 8, 10, H - 28); }
  x.beginPath();
  for (let l = 1.0; l <= 2.6; l += 0.005) { const px = X(l), py = Y(refl(l, m)); l === 1.0 ? x.moveTo(px, py) : x.lineTo(px, py); }
  x.strokeStyle = "#ffd34d"; x.lineWidth = 2; x.stroke();
}
