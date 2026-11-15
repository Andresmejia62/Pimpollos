import { ELEMENTS, helio } from "../marsclock.js";

// Fobos y Deimos vistos desde Gale, con su mecanica orbital real (orbitas casi circulares y ecuatoriales).
//   Fobos   a = 9 376 km, periodo 7,65 h: da la vuelta mas deprisa de lo que gira Marte, asi que SALE POR EL
//           OESTE y se pone por el este; cruza el cielo en unas 4 h, dos veces por sol. Esta tan cerca
//           (6 000 km sobre el suelo) que su tamano aparente cambia: ~0,14 grados en el horizonte, ~0,2 en el cenit.
//   Deimos  a = 23 463 km, periodo 30,3 h: casi sincrono; sale por el este y tarda ~2,7 soles en ponerse.
//           Mide ~2 minutos de arco: se ve como una estrella brillante.
// Las dos entran en la sombra de Marte (eclipse) buena parte de la noche, y su brillo depende de la fase.
// La posicion inicial en la orbita es aproximada (no se usa una efemeride de precision); el movimiento si es el real.
const D2R = Math.PI / 180;
const R_MARS = 3389.5;                       // km
const SOL_H = 24.6597;                       // horas terrestres de un sol; el reloj del juego cuenta 24 "horas" por sol
const SIDEREAL_H = 24.6229;                  // rotacion de Marte respecto a las estrellas
const SUN_RADIUS_AU = 0.0046524;             // radio del Sol en UA -> radio angular = esto / distancia

export const MOONS = [
  { id: "phobos", name: { es: "Fobos", en: "Phobos" }, a: 9376, periodH: 7.6538, radiusKm: 11.1, lon0: 40, albedo: 0.07 },
  { id: "deimos", name: { es: "Deimos", en: "Deimos" }, a: 23463, periodH: 30.312, radiusKm: 6.2, lon0: 205, albedo: 0.07 },
];

// Radio angular del Sol hoy (rad): Marte esta entre 1,38 y 1,67 UA, asi que el Sol mide de 0,39 a 0,32 grados
export function sunAngularRadius(date = new Date()) {
  const T = (date.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525;
  const r = helio(ELEMENTS.mars, T).r;
  return { radius: SUN_RADIUS_AU / r, distanceAU: r };
}

// Estado de las lunas a una hora solar local (puede pasar de 24: cuenta soles seguidos).
// Devuelve, por luna: dir (x Este, y arriba, z Sur), radio angular (rad), brillo 0..1, eclipse y altura (grados).
export function moonsAt(hour, latDeg = -4.77, out = []) {
  const lat = latDeg * D2R, cl = Math.cos(lat), sl = Math.sin(lat);
  const tH = hour * (SOL_H / 24);                               // horas terrestres transcurridas
  // Sol: angulo horario y direccion (declinacion ~0, suficiente para la fase y la sombra)
  const Hs = (hour - 12) * 15 * D2R;
  const sun = [-Math.sin(Hs), Math.cos(Hs) * cl, Math.cos(Hs) * sl];   // este, arriba, sur (sin recortar bajo el horizonte)
  MOONS.forEach((m, i) => {
    // angulo horario: el meridiano gira con el dia sideral y la luna avanza con su periodo
    const H = (m.lon0 + (360 / SIDEREAL_H - 360 / m.periodH) * tH) * D2R;
    // posicion areocentrica en el sistema local (este, norte, arriba) y paso a topocentrica restando el observador
    const e = -Math.sin(H) * m.a, n = -Math.cos(H) * sl * m.a, u = Math.cos(H) * cl * m.a;
    const tu = u - R_MARS, d = Math.hypot(e, n, tu);
    const dir = [e / d, tu / d, -n / d];
    // sombra de Marte: detras del planeta respecto al Sol y dentro del cilindro de sombra
    const px = e, py = u, pz = -n;                              // misma base que `sun`
    const along = px * sun[0] + py * sun[1] + pz * sun[2];
    const perp = Math.hypot(px - along * sun[0], py - along * sun[1], pz - along * sun[2]);
    const eclipsed = along < 0 && perp < R_MARS;
    // fase: fraccion iluminada del disco que ve el observador
    const lit = (1 - (dir[0] * sun[0] + dir[1] * sun[1] + dir[2] * sun[2])) / 2;
    const o = out[i] || (out[i] = { id: m.id, name: m.name, dir: [0, 1, 0] });
    o.dir[0] = dir[0]; o.dir[1] = dir[1]; o.dir[2] = dir[2];
    o.radius = m.radiusKm / d;
    o.distanceKm = d;
    o.eclipsed = eclipsed;
    o.lit = eclipsed ? 0 : lit;
    o.altDeg = Math.asin(Math.max(-1, Math.min(1, dir[1]))) / D2R;
  });
  return out;
}
