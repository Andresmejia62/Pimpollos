// Tipo de dispositivo. TOUCH = pantalla tactil como entrada principal (movil o tableta): se muestran los controles
// en pantalla y se usa el preset grafico ligero. En ordenador (raton) todo sigue igual.
// Forzar para probar: ?touch=1 (o ?touch=0 para desactivarlo en una tableta con raton).
const hasWin = typeof window !== "undefined";
const q = hasWin ? new URLSearchParams(window.location.search) : null;
const forced = q && q.has("touch") ? q.get("touch") !== "0" : null;
const coarse = hasWin && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
const touchPoints = hasWin && typeof navigator !== "undefined" ? navigator.maxTouchPoints || 0 : 0;

export const TOUCH = forced ?? (coarse && touchPoints > 0);
