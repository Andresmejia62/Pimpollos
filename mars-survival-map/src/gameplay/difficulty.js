// Dificultad de la campana. No cambia la fisica ni los datos de la NASA: solo los margenes del traje y lo a menudo
// que llegan las tormentas de polvo.
//  o2K      capacidad de O2 del traje (x)
//  drainK   gasto de bateria (x)
//  damageK  dano por golpes, caidas, radiacion y abrasion (x)
//  stormK   intervalo entre tormentas de polvo (x; < 1 = mas frecuentes)
const L = (es, en) => ({ es, en });
export const DIFFS = {
  easy: { id: "easy", name: L("Fácil", "Easy"), o2K: 1.3, drainK: 0.8, damageK: 0.6, stormK: 1.6,
    desc: L("Traje con un 30 % más de O₂, batería más eficiente y menos daño. Tormentas de polvo poco frecuentes.", "Suit with 30 % more O₂, more efficient battery and less damage. Rare dust storms.") },
  normal: { id: "normal", name: L("Normal", "Normal"), o2K: 1, drainK: 1, damageK: 1, stormK: 1,
    desc: L("Valores de referencia: traje de 8 h (xEMU), consumo según Pandolf y tormentas cada ~8-12 min reales.", "Reference values: 8 h suit (xEMU), Pandolf consumption and storms every ~8-12 real min.") },
  hard: { id: "hard", name: L("Difícil", "Hard"), o2K: 0.85, drainK: 1.2, damageK: 1.4, stormK: 0.7,
    desc: L("Traje con un 15 % menos de O₂, más gasto de batería, más daño y tormentas más seguidas.", "Suit with 15 % less O₂, higher battery drain, more damage and more frequent storms.") },
};
const KEY = "msm-difficulty";
export function loadDiff() {
  try { const k = localStorage.getItem(KEY); if (DIFFS[k]) return DIFFS[k]; } catch { /* sin almacenamiento */ }
  return DIFFS.normal;
}
export function saveDiff(id) { try { localStorage.setItem(KEY, id); } catch { /* sin almacenamiento */ } }
