import * as THREE from "three";
import { ELEMENTS, helio } from "../marsclock.js";

// Planetas vistos desde la superficie de Marte (cielo del juego).
// Posiciones reales para la fecha del ordenador (elementos medios de JPL, Standish) vistas desde Marte;
// se pasan al cielo local de Gale (lat -4,77°) con el polo de Marte de la IAU y la hora solar del juego.
// Brillo: magnitud aparente aproximada m = H + 5 log10(r·Δ) + β·α, mas la extincion del polvo
// (Δm = 1,086 · τ · masa de aire). Se dibujan solo si superan la magnitud limite del ojo (~6) con el cielo oscuro.
const D2R = Math.PI / 180;
const OBL = 23.43928 * D2R;                     // oblicuidad de la ecliptica J2000 (para pasar a ICRF)
const GALE_LAT = -4.77 * D2R;
const AU_KM = 149597870.7;

// H = magnitud absoluta V(1,0); beta = coeficiente de fase (mag/grado), aproximado
export const PLANETS = [
  { id: "mercury", name: { es: "Mercurio", en: "Mercury" }, H: -0.6, beta: 0.038, color: [0.92, 0.86, 0.8] },
  { id: "venus", name: { es: "Venus", en: "Venus" }, H: -4.47, beta: 0.013, color: [1.0, 0.97, 0.88] },
  { id: "earth", name: { es: "Tierra", en: "Earth" }, H: -3.99, beta: 0.025, color: [0.42, 0.66, 1.0] },
  { id: "moon", name: { es: "Luna", en: "Moon" }, H: 0.21, beta: 0.026, color: [0.88, 0.88, 0.86] },
  { id: "jupiter", name: { es: "Júpiter", en: "Jupiter" }, H: -9.4, beta: 0.005, color: [1.0, 0.93, 0.8] },
  { id: "saturn", name: { es: "Saturno", en: "Saturn" }, H: -8.88, beta: 0.044, color: [1.0, 0.88, 0.62] },
  { id: "uranus", name: { es: "Urano", en: "Uranus" }, H: -7.11, beta: 0.002, color: [0.72, 0.94, 1.0] },
  { id: "neptune", name: { es: "Neptuno", en: "Neptune" }, H: -7.0, beta: 0, color: [0.55, 0.65, 1.0] },
];
export const MOON_EXAGGERATION = 3;

// Que se ve a simple vista desde Marte (cielo despejado de polvo)
export const NAKED_EYE = {
  earth: { es: "Punto brillante azulado o blanquecino. La Luna aparece muy cerca y puede distinguirse como otro punto. Desde Marte la Tierra se comporta como Venus desde la Tierra: tiene fases y nunca se aleja mucho del Sol.", en: "A bright bluish-white point. The Moon sits very close and can be told apart as a second point. From Mars, Earth behaves like Venus does from Earth: it shows phases and never strays far from the Sun." },
  venus: { es: "Muy brillante, pero siempre cerca del Sol: al amanecer o al atardecer marciano.", en: "Very bright, but always close to the Sun: at Martian dawn or dusk." },
  mercury: { es: "También cerca del Sol, pero mucho más difícil de ver.", en: "Also close to the Sun, but much harder to see." },
  jupiter: { es: "Visible como un punto luminoso, parecido a una estrella.", en: "Visible as a bright, star-like point." },
  saturn: { es: "Visible como un punto luminoso, parecido a una estrella.", en: "Visible as a bright, star-like point." },
  uranus: { es: "Justo en el límite de la vista humana: requiere condiciones excepcionales.", en: "Right at the limit of human sight: needs exceptional conditions." },
  neptune: { es: "No se ve sin telescopio.", en: "Not visible without a telescope." },
  moon: { es: "Junto a la Tierra, a pocos minutos de arco.", en: "Next to Earth, a few arcminutes away." },
};
export const DUST_NOTE = { es: "La principal dificultad es la atmósfera polvorienta de Marte, que puede reducir mucho la visibilidad: con una tormenta de polvo no se ve casi nada.", en: "The main obstacle is Mars' dusty atmosphere, which can cut visibility a lot: during a dust storm almost nothing can be seen." };            // la Luna esta a ~0,1° de la Tierra: x3 para que se distinga en pantalla

// Polo norte de Marte (IAU 2000), en ICRF: alfa0 = 317,68143 - 0,1061 T ; delta0 = 52,88650 - 0,0609 T
function marsFrame(T) {
  const a = (317.68143 - 0.1061 * T) * D2R, d = (52.8865 - 0.0609 * T) * D2R;
  const p = new THREE.Vector3(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
  const x = new THREE.Vector3(0, 0, 1).cross(p).normalize();   // nodo ascendente del ecuador de Marte
  const y = p.clone().cross(x);
  return { p, x, y };
}
const eclToIcrf = (v) => new THREE.Vector3(v.x, v.y * Math.cos(OBL) - v.z * Math.sin(OBL), v.y * Math.sin(OBL) + v.z * Math.cos(OBL));

// Luna geocentrica, baja precision (ecliptica de la fecha ~ J2000): ~0,3° y ~500 km
function moonGeo(d) {
  const L = (218.316 + 13.176396 * d) * D2R, M = (134.963 + 13.064993 * d) * D2R, F = (93.272 + 13.22935 * d) * D2R;
  const lon = L + 6.289 * D2R * Math.sin(M), lat = 5.128 * D2R * Math.sin(F), r = (385001 - 20905 * Math.cos(M)) / AU_KM;
  return { x: r * Math.cos(lat) * Math.cos(lon), y: r * Math.cos(lat) * Math.sin(lon), z: r * Math.sin(lat) };
}

// Efemeride desde Marte: ascension recta y declinacion en el ecuador de Marte, elongacion y magnitud
export function marsSkyEphemeris(date = new Date()) {
  const jd = date.getTime() / 86400000 + 2440587.5 + 69.184 / 86400;
  const T = (jd - 2451545.0) / 36525, d = jd - 2451545.0;
  const mars = helio(ELEMENTS.mars, T);
  const fr = marsFrame(T);
  const earth = helio(ELEMENTS.earth, T), moon = moonGeo(d);
  const pos = { earth, moon: { x: earth.x + moon.x, y: earth.y + moon.y, z: earth.z + moon.z } };
  for (const k of ["mercury", "venus", "jupiter", "saturn", "uranus", "neptune"]) pos[k] = helio(ELEMENTS[k], T);
  const toEq = (v) => {
    const u = eclToIcrf(v).normalize();
    return { ra: Math.atan2(u.dot(fr.y), u.dot(fr.x)), dec: Math.asin(Math.max(-1, Math.min(1, u.dot(fr.p)))) };
  };
  const sunV = { x: -mars.x, y: -mars.y, z: -mars.z };
  const sun = toEq(sunV);
  const out = PLANETS.map((pl) => {
    const P = pos[pl.id];
    const v = { x: P.x - mars.x, y: P.y - mars.y, z: P.z - mars.z };
    const delta = Math.hypot(v.x, v.y, v.z), r = Math.hypot(P.x, P.y, P.z);
    // angulo de fase (Sol-planeta-Marte) y elongacion (Sol-Marte-planeta)
    const cosA = (P.x * (P.x - mars.x) + P.y * (P.y - mars.y) + P.z * (P.z - mars.z)) / (r * delta);
    const alpha = Math.acos(Math.max(-1, Math.min(1, cosA))) / D2R;
    const cosE = (sunV.x * v.x + sunV.y * v.y + sunV.z * v.z) / (Math.hypot(sunV.x, sunV.y, sunV.z) * delta);
    const elong = Math.acos(Math.max(-1, Math.min(1, cosE))) / D2R;
    const rr = pl.id === "moon" ? Math.hypot(pos.moon.x, pos.moon.y, pos.moon.z) : r;
    const mag = pl.H + 5 * Math.log10(rr * delta) + pl.beta * alpha;
    let dRA = (toEq(v).ra - sun.ra) / D2R;
    dRA = ((dRA + 540) % 360) - 180;
    return { ...pl, ...toEq(v), deltaAU: delta, alpha, elong, mag, evening: dRA > 0 };
  });
  // separacion Tierra-Luna vista desde Marte (minutos de arco)
  const e = out.find((p) => p.id === "earth");
  e.moonSepArcmin = (Math.hypot(moon.x, moon.y, moon.z) / e.deltaAU) / D2R * 60;
  return { sun, planets: out, sunDecDeg: sun.dec / D2R };
}

// Direccion en el cielo de Gale (x = Este, y = arriba, z = Sur) para una hora solar local
function horizonDir(ra, dec, sun, hour, out) {
  const Hs = (hour - 12) * 15 * D2R;              // angulo horario del Sol
  const H = Hs - (ra - sun.ra);
  const cd = Math.cos(dec), sd = Math.sin(dec), cl = Math.cos(GALE_LAT), sl = Math.sin(GALE_LAT);
  const east = -cd * Math.sin(H), north = sd * cl - cd * Math.cos(H) * sl, up = sd * sl + cd * Math.cos(H) * cl;
  return out.set(east, up, -north);
}

// Objeto 3D: puntos con brillo segun la magnitud y etiquetas opcionales
export class SkyPlanets {
  constructor(scene, getLabel) {
    this.getLabel = getLabel;
    this.labelsOn = true;
    this.radius = 15000;              // distancia a la que se dibujan (la escena la ajusta a su cielo)
    // cada planeta es un sprite con un brillo radial (tamaño en pixeles, independiente de la distancia)
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.18, "rgba(255,255,255,.95)");
    grd.addColorStop(0.35, "rgba(255,255,255,.35)"); grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const glowTex = new THREE.CanvasTexture(c);
    this.dots = PLANETS.map((p) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(...p.color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false, fog: false }));
      sp.renderOrder = 1;
      sp.visible = false;
      scene.add(sp);
      return sp;
    });
    this.labels = PLANETS.map(() => {
      const c = document.createElement("canvas"); c.width = 256; c.height = 64;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: false, fog: false }));
      sp.scale.set(0.2, 0.05, 1);
      sp.center.set(-0.1, 1.15);
      sp.renderOrder = 2;
      sp.visible = false;
      scene.add(sp);
      return { c, tex, sp, text: "" };
    });
    this.eph = null; this.ephT = 0;
    this.visible = [];
    this._v = new THREE.Vector3();
  }

  ephemeris(now = Date.now()) {
    if (!this.eph || now - this.ephT > 60000) { this.eph = marsSkyEphemeris(new Date(now)); this.ephT = now; }
    return this.eph;
  }

  // Direccion (x Este, y arriba, z Sur) de un planeta a una hora solar local
  dirOf(id, hour, out = new THREE.Vector3()) {
    const { sun, planets } = this.ephemeris();
    const p = planets.find((q) => q.id === id);
    return horizonDir(p.ra, p.dec, sun, hour, out);
  }

  _label(i, text, alpha) {
    const L = this.labels[i];
    if (L.text !== text) {
      const ctx = L.c.getContext("2d");
      ctx.clearRect(0, 0, 256, 64);
      ctx.font = "600 26px Rajdhani, sans-serif";
      ctx.lineWidth = 5; ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.strokeText(text, 6, 40);
      ctx.fillStyle = "#f6ede4"; ctx.fillText(text, 6, 40);
      L.tex.needsUpdate = true;
      L.text = text;
    }
    L.sp.material.opacity = alpha;
  }

  // day: 0 noche ... 1 pleno dia (scene.skyMat uDay); tau: opacidad del polvo
  update(camera, hour, day, tau, viewH) {
    const { sun, planets } = this.ephemeris();
    const v = this._v, R = this.radius;
    const limit = 6.0 - 10 * day;                 // magnitud limite: ~6 de noche, solo objetos muy brillantes al crepusculo
    const earthDir = new THREE.Vector3();
    this.visible = [];
    planets.forEach((p, i) => {
      horizonDir(p.ra, p.dec, sun, hour, v);
      if (p.id === "earth") earthDir.copy(v);
      if (p.id === "moon") v.sub(earthDir).multiplyScalar(MOON_EXAGGERATION).add(earthDir).normalize();
      const sinAlt = v.y;
      const airmass = 1 / (Math.max(sinAlt, 0) + 0.025 * Math.exp(-11 * Math.max(sinAlt, 0)));
      const mEff = p.mag + 1.086 * tau * Math.min(airmass, 40);
      const a = sinAlt > -0.01 ? Math.max(0, Math.min(1, (limit - mEff) / 1.5)) : 0;
      const dot = this.dots[i];
      dot.position.set(camera.position.x + v.x * R, camera.position.y + v.y * R, camera.position.z + v.z * R);
      // tamaño aparente segun la magnitud (en pixeles CSS) -> escala de sprite sin atenuacion
      const px = Math.max(5, Math.min(18, 8 + (1.5 - mEff) * 2.2));
      dot.scale.setScalar((px / viewH) * 2 * Math.tan((camera.fov * Math.PI) / 360));
      dot.material.opacity = a * Math.max(0.5, Math.min(1, 0.8 + (1 - mEff) * 0.1));
      dot.visible = a > 0.01;
      const L = this.labels[i];
      L.sp.position.copy(dot.position);
      const show = this.labelsOn && a > 0.25 && p.id !== "moon";
      L.sp.visible = show;
      if (show) this._label(i, this.getLabel(p, mEff), Math.min(1, a) * 0.9);
      if (a > 0.05) this.visible.push({ ...p, mEff, alt: Math.asin(Math.max(-1, Math.min(1, sinAlt))) / D2R });
    });
  }
}
