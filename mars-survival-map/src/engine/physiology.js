// Fisiologia del astronauta: perfil fisico -> gasto metabolico, oxigeno, calor, ritmo cardiaco y fatiga en Marte.
//
// Modelo (documentado en docs/fisiologia.md):
//  - Metabolismo basal: Mifflin-St Jeor (1990).
//  - Marcha con carga: ecuacion de Pandolf et al. (1977), con la carga (el traje) y el trabajo contra la gravedad
//    escalados a 0,379 g. La parte horizontal de la marcha no baja en proporcion a la gravedad (Farley y McMahon 1992;
//    Griffin et al. 1999): se usa f = 0,4 + 0,6 * g/gT.
//  - Bajadas: correccion simplificada inspirada en Santee et al. (2003): bajar ahorra, pero frenar tambien cuesta.
//  - Traje presurizado: x1,2 en la locomocion por el par de las articulaciones (Norcross et al. 2010, NASA/TP-2010-216139).
//  - Terreno: coeficiente eta de Pandolf (1,2 regolito firme, 1,5 crestas boxwork, 2,1 arena de duna).
//  - O2: 1 L de O2 rinde ~20,1 kJ (equivalente energetico con RQ ~0,85). CO2 = 0,85 * VO2.
//  - Velocidad maxima de marcha: numero de Froude v^2 / (g * L) ~ 0,5 (transicion a correr). En Marte la pierna larga
//    camina mas rapido: L = 0,53 * estatura (Winter, antropometria).
//  - Frecuencia cardiaca: FCmax = 208 - 0,7 * edad (Tanaka et al. 2001); %FC de reserva ~ %VO2 de reserva (Swain 1997).
export const GR = 3.721 / 9.807;          // gravedad de Marte / Tierra
const KJ_PER_L_O2 = 20.1;
const O2_G_PER_L = 1.429, CO2_G_PER_L = 1.977;
const SUBLIMATION_J_PER_KG = 2.83e6;       // agua del sublimador del traje (calor que se expulsa)
const F_LOC = 0.4 + 0.6 * GR;
const K_SUIT = 1.2;

// Trajes (masa total con el sistema de soporte vital portatil, PLSS)
export const SUITS = {
  mars: { mass: 50, name: { es: "Traje marciano ligero (concepto, 50 kg)", en: "Light Mars suit (concept, 50 kg)" } },
  a7lb: { mass: 91, name: { es: "Apollo A7LB + PLSS (91 kg)", en: "Apollo A7LB + PLSS (91 kg)" } },
  xemu: { mass: 145, name: { es: "xEMU de Artemis (~145 kg)", en: "Artemis xEMU (~145 kg)" } },
};

// Rango antropometrico de seleccion de astronautas de NASA (157,5-190,5 cm)
export const NASA_HEIGHT = [157.5, 190.5];
export const LIMITS = { mass: [45, 120], height: [150, 200], age: [25, 60], vo2max: [25, 65] };
export const DEFAULT_PROFILE = { name: "EVA-1", mass: 75, height: 175, age: 38, sex: "m", vo2max: 45, suit: "mars" };
export const PRESETS = {
  ref: { ...DEFAULT_PROFILE },
  small: { name: "EVA-1", mass: 56, height: 160, age: 34, sex: "f", vo2max: 44, suit: "mars" },
  tall: { name: "EVA-1", mass: 92, height: 190, age: 42, sex: "m", vo2max: 42, suit: "mars" },
  athlete: { name: "EVA-1", mass: 70, height: 178, age: 30, sex: "f", vo2max: 58, suit: "mars" },
  apollo: { name: "EVA-1", mass: 76, height: 178, age: 40, sex: "m", vo2max: 40, suit: "a7lb" },
};

// Coeficiente de terreno por clase espectral (layers.json -> spectral.classes)
export const TERRAIN_ETA = { 0: 1.2, 1: 1.2, 2: 1.2, 3: 1.5, 4: 2.1 };

export function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem("msm-profile") || "null");
    if (p && typeof p === "object") return sanitize({ ...DEFAULT_PROFILE, ...p });
  } catch (e) { /* sin almacenamiento */ }
  return { ...DEFAULT_PROFILE };
}
export function saveProfile(p) { try { localStorage.setItem("msm-profile", JSON.stringify(p)); } catch (e) { /* ignorar */ } }
export function sanitize(p) {
  const c = (v, [a, b], d) => (Number.isFinite(+v) ? Math.min(b, Math.max(a, +v)) : d);
  return {
    name: String(p.name || "EVA-1").slice(0, 16),
    mass: c(p.mass, LIMITS.mass, 75), height: c(p.height, LIMITS.height, 175), age: c(p.age, LIMITS.age, 38),
    sex: p.sex === "f" ? "f" : "m", vo2max: c(p.vo2max, LIMITS.vo2max, 45), suit: SUITS[p.suit] ? p.suit : "mars",
  };
}

export class Physiology {
  constructor(profile) { this.setProfile(profile); }

  setProfile(profile) {
    const p = (this.p = sanitize(profile));
    const h = p.height / 100;
    const W = p.mass, L = SUITS[p.suit].mass;
    this.W = W; this.L = L; this.total = W + L;
    this.bmi = W / (h * h);
    this.bsa = 0.007184 * W ** 0.425 * p.height ** 0.725;                   // DuBois (m^2)
    this.bmrKcal = 10 * W + 6.25 * p.height - 5 * p.age + (p.sex === "f" ? -161 : 5);
    this.bmrW = (this.bmrKcal * 4184) / 86400;
    this.leg = 0.53 * h;
    this.vMaxWalk = Math.sqrt(0.5 * 3.721 * this.leg);                         // Froude 0,5
    this.vDesign = Math.sqrt(0.35 * 3.721 * this.leg);                         // marcha rapida sostenible (Fr 0,35)
    this.vEarthMaxWalk = Math.sqrt(0.5 * 9.807 * this.leg);
    this.weightMarsN = this.total * 3.721;
    this.weightEarthN = this.total * 9.807;
    this.hrMax = 208 - 0.7 * p.age;
    this.hrRest = Math.min(80, Math.max(48, 62 + (45 - p.vo2max) * 0.45));
    this.vo2Rest = 3.5;                                                        // ml/kg/min (1 MET)
    const inRange = p.height >= NASA_HEIGHT[0] && p.height <= NASA_HEIGHT[1];
    this.fitOK = inRange;
    this.kFit = inRange ? 1 : 1.08;                                            // traje mal ajustado: +8 %
    // salto: potencia de piernas ~ masa corporal; tiene que levantar cuerpo + traje
    this.jumpK = Math.min(1.15, Math.max(0.7, Math.sqrt((W / this.total) / 0.6) * Math.sqrt(p.vo2max / 45) ** 0.5));
  }

  // Gasto metabolico (W). v = m/s reales, grade = subida/avance (+ cuesta arriba), eta = terreno
  metabolic(v, grade = 0, eta = 1.2) {
    const { W, L } = this;
    const stand = 1.3 * this.bmrW + 2.0 * (W + L) * (L / W) ** 2 * GR;
    if (v < 0.05) return stand * this.kFit;
    const G = grade * 100;
    const flat = eta * (W + L) * 1.5 * v * v * F_LOC;
    let loc;
    if (G >= 0) loc = flat + eta * (W + L) * 0.35 * v * G * GR * F_LOC;
    else loc = Math.max(0.55 * flat, flat - eta * (W + L) * 0.35 * v * -G * GR * F_LOC * 0.4);
    return (stand + loc * K_SUIT) * this.kFit;
  }

  vo2Lmin(M) { return (M * 60) / (KJ_PER_L_O2 * 1000); }
  vo2Rel(M) { return (this.vo2Lmin(M) * 1000) / this.W; }                    // ml/kg/min
  pctVO2max(M) { return this.vo2Rel(M) / this.p.vo2max; }
  heartRate(M) {
    const r = Math.min(1.05, Math.max(0, (this.vo2Rel(M) - this.vo2Rest) / (this.p.vo2max - this.vo2Rest)));
    return this.hrRest + r * (this.hrMax - this.hrRest);
  }
  o2gPerH(M) { return this.vo2Lmin(M) * 60 * O2_G_PER_L; }
  co2gPerH(M) { return this.vo2Lmin(M) * 60 * 0.85 * CO2_G_PER_L; }
  waterGPerH(M) { return ((M * 0.8 * 3600) / SUBLIMATION_J_PER_KG) * 1000; } // ~80 % del metabolismo sale como calor
  kcalPerH(M) { return (M * 3600) / 4184; }

  // Resumen para la pantalla de perfil (a la velocidad de diseno)
  summary() {
    const v = this.vDesign;
    const rows = { rest: this.metabolic(0), flat: this.metabolic(v), up10: this.metabolic(v * 0.8, Math.tan(10 * Math.PI / 180)), dune: this.metabolic(v * 0.8, 0, 2.1), down10: this.metabolic(v, -Math.tan(10 * Math.PI / 180)) };
    return rows;
  }
}

// Astronauta de referencia: con el se calibraron las reglas del juego (rules.json)
export const REF = new Physiology(DEFAULT_PROFILE);
export const REF_FLAT_W = REF.metabolic(REF.vDesign);
