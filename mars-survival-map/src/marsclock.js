// Reloj de Marte "ahora mismo" a partir de la fecha del ordenador.
//  - Fecha solar marciana (MSD), hora coordinada de Marte (MTC) y longitud solar Ls: Allison y McEwen (2000),
//    algoritmo Mars24 de NASA GISS (sin los terminos de perturbacion, error < 0,1° en Ls).
//  - Distancia Tierra-Marte: elementos orbitales medios de JPL ("Approximate Positions of the Planets",
//    Standish, tabla 1, valida 1800-2050). Error tipico de unos pocos miles de km.
const D2R = Math.PI / 180;
const AU_KM = 149597870.7, C_KMS = 299792.458;
const MSL_SOL0_MSD = 49269;          // aterrizaje de Curiosity (6 ago 2012) = sol 0
const GALE_LON_E = 137.4;

export const ELEMENTS = {
  mercury: { a: [0.38709927, 0.00000037], e: [0.20563593, 0.00001906], I: [7.00497902, -0.00594749], L: [252.2503235, 149472.67411175], w: [77.45779628, 0.16047689], O: [48.33076593, -0.12534081] },
  venus: { a: [0.72333566, 0.0000039], e: [0.00677672, -0.00004107], I: [3.39467605, -0.0007889], L: [181.9790995, 58517.81538729], w: [131.60246718, 0.00268329], O: [76.67984255, -0.27769418] },
  jupiter: { a: [5.202887, -0.00011607], e: [0.04838624, -0.00013253], I: [1.30439695, -0.00183714], L: [34.39644051, 3034.74612775], w: [14.72847983, 0.21252668], O: [100.47390909, 0.20469106] },
  saturn: { a: [9.53667594, -0.0012506], e: [0.05386179, -0.00050991], I: [2.48599187, 0.00193609], L: [49.95424423, 1222.49362201], w: [92.59887831, -0.41897216], O: [113.66242448, -0.28867794] },
  uranus: { a: [19.18916464, -0.00196176], e: [0.04725744, -0.00004397], I: [0.77263783, -0.00242939], L: [313.23810451, 428.48202785], w: [170.9542763, 0.40805281], O: [74.01692503, 0.04240589] },
  neptune: { a: [30.06992276, 0.00026291], e: [0.00859048, 0.00005105], I: [1.77004347, 0.00035372], L: [-55.12002969, 218.45945325], w: [44.96476227, -0.32241464], O: [131.78422574, -0.00508664] },
  earth: { a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], I: [-0.00001531, -0.01294668], L: [100.46457166, 35999.37244981], w: [102.93768193, 0.32327364], O: [0, 0] },
  mars: { a: [1.52371034, 0.00001847], e: [0.0933941, 0.00007882], I: [1.84969142, -0.00813131], L: [-4.55343205, 19140.30268499], w: [-23.94362959, 0.44441088], O: [49.55953891, -0.29257343] },
};

export function helio(el, T) {
  const v = (k) => el[k][0] + el[k][1] * T;
  const a = v("a"), e = v("e"), I = v("I") * D2R, L = v("L"), w = v("w"), O = v("O");
  const om = (w - O) * D2R;
  let M = ((L - w) % 360) * D2R;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 6; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const Or = O * D2R;
  const x = (Math.cos(om) * Math.cos(Or) - Math.sin(om) * Math.sin(Or) * Math.cos(I)) * xp + (-Math.sin(om) * Math.cos(Or) - Math.cos(om) * Math.sin(Or) * Math.cos(I)) * yp;
  const y = (Math.cos(om) * Math.sin(Or) + Math.sin(om) * Math.cos(Or) * Math.cos(I)) * xp + (-Math.sin(om) * Math.sin(Or) + Math.cos(om) * Math.cos(Or) * Math.cos(I)) * yp;
  const z = Math.sin(om) * Math.sin(I) * xp + Math.cos(om) * Math.sin(I) * yp;
  return { x, y, z, r: Math.hypot(x, y, z) };
}

export function marsNow(date = new Date()) {
  const jdUT = date.getTime() / 86400000 + 2440587.5;
  const jdTT = jdUT + 69.184 / 86400;
  const dt = jdTT - 2451545.0;
  // Ls (Allison y McEwen 2000, ec. B-4 a B-15 sin PBS)
  const Mdeg = 19.3871 + 0.52402073 * dt, M = Mdeg * D2R;
  const aFMS = 270.3871 + 0.524038496 * dt;
  const eoc = (10.691 + 3.0e-7 * dt) * Math.sin(M) + 0.623 * Math.sin(2 * M) + 0.05 * Math.sin(3 * M) + 0.005 * Math.sin(4 * M) + 0.0005 * Math.sin(5 * M);
  const ls = (((aFMS + eoc) % 360) + 360) % 360;
  const msd = (jdTT - 2405522.0028779) / 1.0274912517;
  const mtc = (((24 * msd) % 24) + 24) % 24;
  const eot = 2.861 * Math.sin(2 * ls * D2R) - 0.071 * Math.sin(4 * ls * D2R) + 0.002 * Math.sin(6 * ls * D2R) - eoc;   // grados
  const lmst = (((mtc - (360 - GALE_LON_E) / 15) % 24) + 24) % 24;
  const ltst = (((lmst + eot / 15) % 24) + 24) % 24;
  // distancia Tierra-Marte
  const T = (jdTT - 2451545.0) / 36525;
  const E = helio(ELEMENTS.earth, T), Mp = helio(ELEMENTS.mars, T);
  const dAU = Math.hypot(Mp.x - E.x, Mp.y - E.y, Mp.z - E.z);
  const km = dAU * AU_KM;
  return {
    msd, mtc, ls, lmstGale: lmst, ltstGale: ltst,
    curiositySol: Math.floor(msd) - MSL_SOL0_MSD,
    distKm: km, distAU: dAU, lightMin: km / C_KMS / 60, sunMarsAU: Mp.r,
    dustSeason: ls >= 180 && ls < 360,
  };
}

// Estacion por Ls (hemisferio norte / sur)
export function seasonOf(ls) {
  const k = Math.floor(ls / 90);
  return [
    { es: "primavera en el norte · otoño en el sur", en: "northern spring · southern autumn" },
    { es: "verano en el norte · invierno en el sur", en: "northern summer · southern winter" },
    { es: "otoño en el norte · primavera en el sur", en: "northern autumn · southern spring" },
    { es: "invierno en el norte · verano en el sur", en: "northern winter · southern summer" },
  ][k];
}

export const hhmm = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
