// Perfil del dispositivo: "desktop" | "tablet" | "mobile". Combina la entrada (tactil o raton), el ancho de la
// ventana y su relacion de aspecto, y se recalcula al cambiar el tamano o la orientacion.
//
//  desktop  raton/teclado como entrada principal (pointer: fine). Es el diseno de siempre: nada cambia.
//  mobile   tactil y pantalla compacta: ancho < 768 px o, en horizontal, lado corto < 600 px (telefono girado)
//  tablet   tactil y pantalla mayor (768-1180 px; una tableta tactil mas ancha tambien, porque sin raton no se
//           puede jugar con los controles de escritorio)
//
// El perfil activo se refleja en <html> como clase (device-desktop | device-tablet | device-mobile) y en
// data-orientation (portrait | landscape), para que el CSS se adapte sin tocar el diseno de escritorio.
// Para probar: ?device=mobile|tablet|desktop fuerza el perfil; ?touch=1 / ?touch=0 fuerza la entrada tactil.

const hasWin = typeof window !== "undefined";
const params = hasWin && window.location ? new URLSearchParams(window.location.search || "") : null;
const forcedTouch = params && params.has("touch") ? params.get("touch") !== "0" : null;
const forcedKind = params && ["desktop", "tablet", "mobile"].includes(params.get("device")) ? params.get("device") : null;
const mq = (q) => hasWin && typeof window.matchMedia === "function" && window.matchMedia(q).matches;

export const MOBILE_MAX_W = 768;       // por debajo: telefono
export const MOBILE_SHORT_SIDE = 600;  // telefono en horizontal: el lado corto sigue siendo pequeno
export const TABLET_MAX_W = 1180;      // referencia de tableta (iPad Air horizontal = 1180 px)

// Limite de densidad de pixeles del renderer 3D por perfil. Las pantallas de 3x de los telefonos multiplican
// por 6-9 los pixeles a dibujar: con 1,25 se ve nitido y la GPU no se satura. En escritorio se mantiene el 1,75
// de siempre (dentro del maximo de 2): asi el rendimiento en ordenador no cambia.
export const DPR_CAP = { mobile: 1.25, tablet: 1.5, desktop: 1.75 };
// Area minima de toque (px) de los botones
export const TOUCH_TARGET = { mobile: 48, tablet: 44, desktop: 0 };

// Entrada tactil como principal (la misma regla que usaba device.js: un portatil tactil con raton es "desktop")
function detectTouch() {
  if (forcedTouch != null) return forcedTouch;
  const touchPoints = hasWin && typeof navigator !== "undefined" ? navigator.maxTouchPoints || 0 : 0;
  return mq("(pointer: coarse)") && touchPoints > 0;
}

export function classify(w, h, touch) {
  if (forcedKind) return forcedKind;
  if (!touch) return "desktop";
  const short = Math.min(w, h);
  if (w < MOBILE_MAX_W || short < MOBILE_SHORT_SIDE) return "mobile";
  return "tablet";
}

const touch = detectTouch();
const size = () => (hasWin && window.innerWidth ? [window.innerWidth, window.innerHeight] : [1366, 768]);
const listeners = new Set();
let last = null;

export const device = {
  touch,
  // se calcula al leerlo: siempre corresponde al tamano actual de la ventana
  get kind() { const [w, h] = size(); return classify(w, h, touch); },
  get orientation() { const [w, h] = size(); return w >= h ? "landscape" : "portrait"; },
  get isTouchUI() { return this.kind !== "desktop"; },
  get dprCap() { return DPR_CAP[this.kind]; },
  get touchTarget() { return TOUCH_TARGET[this.kind]; },
};

// fn({ kind, orientation, touch }) cuando cambia el perfil o la orientacion; devuelve la funcion para quitarlo
export function onDeviceChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function apply() {
  const kind = device.kind, orientation = device.orientation;
  if (typeof document !== "undefined" && document.documentElement) {
    const cl = document.documentElement.classList;
    for (const k of ["desktop", "tablet", "mobile"]) cl.toggle("device-" + k, k === kind);
    document.documentElement.dataset.orientation = orientation;
    cl.toggle("input-touch", touch);
  }
  const key = kind + "/" + orientation;
  if (key !== last) {
    const first = last == null;
    last = key;
    if (!first) for (const fn of listeners) { try { fn({ kind, orientation, touch }); } catch (e) { console.error(e); } }
  }
}

if (hasWin && typeof window.addEventListener === "function") {
  let raf = 0;
  const later = () => { if (raf) return; raf = (window.requestAnimationFrame || setTimeout)(() => { raf = 0; apply(); }); };
  window.addEventListener("resize", later);
  window.addEventListener("orientationchange", () => { apply(); later(); });
  // la entrada principal puede cambiar (tableta con teclado y raton conectados)
  if (typeof window.matchMedia === "function") {
    const m = window.matchMedia("(pointer: coarse)");
    if (m && m.addEventListener) m.addEventListener("change", later);
  }
  apply();
}
