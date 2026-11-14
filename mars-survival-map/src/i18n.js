// Idioma de la interfaz. Los textos de historia vienen como {es, en} en public/story/.
let lang = "es";
try {
  const saved = localStorage.getItem("msm-lang");
  if (saved === "es" || saved === "en") lang = saved;
} catch (e) { /* almacenamiento no disponible */ }

export const getLang = () => lang;
export function setLang(l) {
  lang = l;
  try { localStorage.setItem("msm-lang", l); } catch (e) { /* ignorar */ }
  document.documentElement.lang = l;
}

// Texto bilingue {es, en} -> cadena en el idioma actual
export const t = (obj) => (obj == null ? "" : typeof obj === "string" ? obj : obj[lang] ?? obj.es ?? "");

const UI = {
  start: { es: "Comenzar EVA", en: "Start EVA" },
  guide: { es: "Cómo leer las capas", en: "How to read the layers" },
  tagline: { es: "Camina por donde va Curiosity. Lee los datos de NASA. Vuelve con vida.", en: "Walk where Curiosity goes. Read NASA's data. Come back alive." },
  credits: { es: "Datos: NASA/JPL-Caltech (Curiosity: traza, RAD, REMS) · MRO HiRISE, CTX y CRISM · Mars Odyssey THEMIS · USGS Astrogeology", en: "Data: NASA/JPL-Caltech (Curiosity: traverse, RAD, REMS) · MRO HiRISE, CTX and CRISM · Mars Odyssey THEMIS · USGS Astrogeology" },
  loading: { es: "Cargando datos de Marte…", en: "Loading Mars data…" },
  mission: { es: "Misión", en: "Mission" },
  of: { es: "de", en: "of" },
  startMission: { es: "Iniciar misión", en: "Start mission" },
  hazard: { es: "Peligro", en: "Hazard" },
  layerHint: { es: "Capa recomendada", en: "Suggested layer" },
  shelterNear: { es: "Refugio más cercano", en: "Nearest shelter" },
  continue: { es: "Continuar", en: "Continue" },
  completed: { es: "Objetivo completado", en: "Objective complete" },
  fact: { es: "Dato curioso", en: "Did you know?" },
  source: { es: "Fuente", en: "Source" },
  curiosityHere: { es: "Curiosity estuvo aquí en el sol", en: "Curiosity was here on sol" },
  scanning: { es: "Escaneando…", en: "Scanning…" },
  retry: { es: "Reintentar desde el inicio de la misión", en: "Retry from mission start" },
  menu: { es: "Menú", en: "Menu" },
  playAgain: { es: "Jugar de nuevo", en: "Play again" },
  total: { es: "Total", en: "Total" },
  science: { es: "Ciencia", en: "Science" },
  safety: { es: "Bono de seguridad", en: "Safety bonus" },
  time: { es: "Bono de tiempo", en: "Time bonus" },
  storm: { es: "Tormenta en refugio", en: "Storm in shelter" },
  tip: { es: "Consejo", en: "Tip" },
  paused: { es: "Pausa", en: "Paused" },
  resume: { es: "Volver al juego", en: "Resume" },
  controls: { es: "Controles", en: "Controls" },
  controlsList: {
    es: "W A S D: caminar · Ratón: mirar (clic para capturar) · Rueda: alejar cámara · 1–4: capas · R: ruta · H: ayuda · M: minimapa grande · Esc: pausa",
    en: "W A S D: walk · Mouse: look (click to capture) · Wheel: camera distance · 1–4: layers · R: route · H: help · M: large minimap · Esc: pause",
  },
  stormIn: { es: "Tormenta solar · llega en", en: "Solar storm · arrives in" },
  stormActive: { es: "Tormenta solar activa", en: "Solar storm active" },
  safeShelter: { es: "A salvo en el refugio", en: "Safe in shelter" },
  layers: { slope: { es: "Pendiente", en: "Slope" }, radiation: { es: "Radiación", en: "Radiation" }, thermal: { es: "Temp.", en: "Temp." }, spectral: { es: "Espectral", en: "Spectral" }, route: { es: "Ruta", en: "Route" } },
  hazards: {
    slope: { es: "Pendiente y escalones", en: "Slope and ledges" },
    radiation: { es: "Radiación", en: "Radiation" },
    temperature: { es: "Frío", en: "Cold" },
    oxygen: { es: "Oxígeno", en: "Oxygen" },
  },
  clickToLook: { es: "Haz clic para mirar con el ratón", en: "Click to look around with the mouse" },
  localTime: { es: "Hora local", en: "Local time" },
};
export const ui = (key) => {
  const v = key.split(".").reduce((o, k) => (o ? o[k] : undefined), UI);
  return t(v) || key;
};
