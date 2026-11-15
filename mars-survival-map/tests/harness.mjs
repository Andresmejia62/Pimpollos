// Monta la simulacion real (Game + Weather + Companion + Pathfinder) sin navegador ni WebGL.
// La escena es un objeto minimo: Weather crea sus mallas de Three.js pero nadie las dibuja.
import * as THREE from "three";
import { loadData } from "./helpers.mjs";
import { World } from "../src/engine/world.js";
import { Game } from "../src/gameplay/game.js";
import { Weather } from "../src/gameplay/weather.js";
import { Companion } from "../src/gameplay/companion.js";
import { Pathfinder } from "../src/gameplay/pathfinding.js";

let cached = null;
export function makeSim({ withWeather = true, withBuddy = true } = {}) {
  if (!cached) { const data = loadData(); const world = new World(data); cached = { data, world, path: new Pathfinder(world) }; }
  const { data, world, path } = cached;
  const groundAt = (x, z) => world.demHeight(x, z);
  const game = new Game(data, world, groundAt, null, null);
  const events = [];
  let weather = null, buddy = null;
  if (withWeather) {
    const ms = {
      scene: { add() {}, remove() {} }, camera: null, world,
      heightAt: groundAt, setStorm() {}, fogColor: new THREE.Color(0.7, 0.5, 0.36),
    };
    weather = new Weather(ms, game, { onAlert: (a) => events.push(["alert", a.id, +weather.clock.toFixed(4)]), onStatic: () => events.push(["static", +weather.clock.toFixed(4)]) });
  }
  if (withBuddy) buddy = new Companion(game, world, path, groundAt);
  for (const ev of ["spe", "shelter", "scanComplete", "freeScan", "subFound", "missionComplete", "end", "crash", "land", "cargoUnload"]) {
    game.on(ev, (p) => events.push([ev, p && p.phase ? p.phase : p && p.id ? p.id : null, +game.s.realSeconds.toFixed(4)]));
  }
  if (buddy) for (const ev of ["stuck", "rescued", "reserve", "task", "recovered"]) buddy.on(ev, () => events.push(["buddy:" + ev, +game.s.realSeconds.toFixed(4)]));
  return { data, world, path, game, weather, buddy, events, groundAt };
}

// Un fotograma como el del bucle principal (main.js): partida, clima y compañero
export function frame(sim, dt, move, { assist = false } = {}) {
  const { game, weather, buddy } = sim, s = game.s;
  const running = s.phase === "playing";
  game.update(dt, move, false);
  if (weather) weather.update(dt, { running: s.phase === "playing" || running, x: s.x, z: s.z, hour: game.hour, day: 1, now: s.realSeconds });
  if (buddy && game.s.phase === "playing") buddy.update(dt, assist);
}
