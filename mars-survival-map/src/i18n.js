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
  freeMode: { es: "Modo libre", en: "Free mode" },
  startDesc: { es: "Campaña de 5 misiones con objetivos científicos.", en: "A 5-mission campaign with science targets." },
  freeDesc: { es: "Simulación: tú eliges destino, salida, hora y condiciones.", en: "Simulation: you choose the destination, start, time and conditions." },
  modesLine: { es: "Comenzar EVA = modo juego: campaña de 5 misiones con objetivos científicos. Modo libre = simulación: tú defines el destino, la salida, la hora y las condiciones.", en: "Start EVA = game mode: a 5-mission campaign with science targets. Free mode = simulation: you set the destination, the start point, the time and the conditions." },
  pickGoal: { es: "Destino", en: "Destination" },
  pickStart: { es: "Salida", en: "Start" },
  pickWay: { es: "Punto de paso", en: "Waypoint" },
  freeNoTarget: { es: "Sin destino · G para definirlo", en: "No destination · G to set one" },
  freeHint: { es: "G destino · O panel de simulación", en: "G destination · O simulation panel" },
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
    es: "W A S D: caminar / conducir · Espacio: saltar · E: subir o bajar del rover · Ratón: mirar (clic para capturar) · Rueda: alejar cámara · 1–4: capas · R: ruta · H: ayuda · F: ayudar a EVA-2 · M: atlas de Marte · I: telemetría · P: nombres de los planetas y lunas · Z X C V B: gestos (saludar, pulgar, sentarse, bailar, estirarse) · Esc: pausa",
    en: "W A S D: walk / drive · Space: jump · E: board or leave the rover · Mouse: look (click to capture) · Wheel: camera distance · 1–4: layers · R: route · H: help · F: help EVA-2 · M: Mars atlas · I: telemetry · P: planet and moon names · Z X C V B: emotes (wave, thumbs up, sit, dance, stretch) · Esc: pause",
  },
  stormIn: { es: "Tormenta solar · llega en", en: "Solar storm · arrives in" },
  stormActive: { es: "Tormenta solar activa", en: "Solar storm active" },
  safeShelter: { es: "A salvo en el refugio", en: "Safe in shelter" },
  layers: { slope: { es: "Pendiente/rocas", en: "Slope/rocks" }, radiation: { es: "Radiación", en: "Radiation" }, thermal: { es: "Temp.", en: "Temp." }, spectral: { es: "Espectral", en: "Spectral" }, route: { es: "Ruta", en: "Route" } },
  hazards: {
    slope: { es: "Pendiente, escalones y rocas", en: "Slope, ledges and rocks" },
    radiation: { es: "Radiación", en: "Radiation" },
    temperature: { es: "Frío", en: "Cold" },
    oxygen: { es: "Oxígeno", en: "Oxygen" },
  },
  povArrival: { es: "Al llegar verás", en: "What you will see" },
  povShort: { es: "Destino", en: "Destination" },
  povClose: { es: "De cerca", en: "Up close" },
  povTaken: { es: "Foto real de Curiosity", en: "Real Curiosity photo" },
  clickToLook: { es: "Haz clic para mirar con el ratón", en: "Click to look around with the mouse" },
  boardCar: { es: "Subir al rover", en: "Board the rover" },
  exitCar: { es: "Bajar del rover", en: "Leave the rover" },
  gravity: { es: "Gravedad 0,38 g", en: "Gravity 0.38 g" },
  localTime: { es: "Hora local", en: "Local time" },
  atlas: { es: "Atlas de Marte", en: "Mars atlas" },
  atlasOpen: { es: "Atlas de Marte", en: "Mars atlas" },
  profileEdit: { es: "Perfil y apariencia", en: "Profile and appearance" },
  goGlobal: { es: "Global", en: "Global" },
  goGale: { es: "Cráter Gale", en: "Gale crater" },
  goEva: { es: "Zona EVA", en: "EVA zone" },
  goMe: { es: "Mi posición", en: "My position" },
  ruler: { es: "Regla", en: "Ruler" },
  exportCsv: { es: "Exportar traza CSV", en: "Export track CSV" },
  closeMap: { es: "Cerrar (M)", en: "Close (M)" },
  profTrack: { es: "Mi recorrido", en: "My track" },
  profRuler: { es: "Regla", en: "Ruler" },
  profileEyebrow: { es: "Perfil fisiológico", en: "Physiological profile" },
  profileTitle: { es: "¿Quién sale a la EVA?", en: "Who is going on the EVA?" },
  profileIntro: { es: "Tu cuerpo cambia la misión: la masa y el traje deciden cuánto oxígeno gastas, la estatura cuánto avanzas por paso y tu VO₂max cuánto aguantas las pendientes antes de fatigarte.", en: "Your body changes the mission: mass and suit decide how much oxygen you burn, height how far each stride takes you, and your VO₂max how long you can climb before you tire." },
  profileGo: { es: "Confirmar y comenzar", en: "Confirm and start" },
  back: { es: "Volver", en: "Back" },
  fatigue: { es: "Fatiga", en: "Fatigue" },
  planEva: { es: "Planificar la EVA", en: "Plan the EVA" },
  planEyebrow: { es: "Planificación desde el hábitat · antes de salir", en: "Planning from the habitat · before heading out" },
  planClear: { es: "Borrar puntos", en: "Clear waypoints" },
  planUse: { es: "Usar esta ruta", en: "Use this route" },
  introSkip: { es: "Saltar ⏭", en: "Skip ⏭" },
  introWarn: { es: "ALERTA · PARACAÍDAS NO DESPLEGADO", en: "ALERT · PARACHUTE FAILED TO DEPLOY" },
  tabStatus: { es: "Misión", en: "Mission" },
  tabBody: { es: "Traje y cuerpo", en: "Suit and body" },
  tabControls: { es: "Controles", en: "Controls" },
  tabMars: { es: "Marte ahora", en: "Mars right now" },
  restartMission: { es: "Reiniciar misión", en: "Restart mission" },
  confirmRestart: { es: "¿Reiniciar desde el inicio de esta misión? Perderás el avance desde el último briefing.", en: "Restart from the start of this mission? You will lose progress since the last briefing." },
};
export const ui = (key) => {
  const v = key.split(".").reduce((o, k) => (o ? o[k] : undefined), UI);
  return t(v) || key;
};
