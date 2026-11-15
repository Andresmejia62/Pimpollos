// Logros cientificos: momentos de la EVA que corresponden a observaciones o procedimientos reales
// (medir dentro de una tormenta, acercarse a un remolino, refugiarse a tiempo...). Se comprueban cada fotograma
// con el estado del juego, se guardan en el navegador y aparecen en el resumen final.
const L = (es, en) => ({ es, en });
export const ACHIEVEMENTS = [
  { id: "storm_scan", icon: "◎", name: L("Ciencia en la tormenta", "Science in the storm"), desc: L("Completa un escaneo con opacidad τ > 2,5, como hizo Opportunity midiendo τ durante la tormenta global de 2018.", "Complete a scan at opacity τ > 2.5, like Opportunity measuring τ during the 2018 global storm.") },
  { id: "devil_near", icon: "🌀", name: L("Cazador de remolinos", "Dust devil chaser"), desc: L("Acércate a menos de ~80 m de un remolino de polvo. Curiosity los filma con las Navcams para medir el viento.", "Get within ~80 m of a dust devil. Curiosity films them with its Navcams to measure the wind.") },
  { id: "devil_in", icon: "⚡", name: L("Dentro del remolino", "Inside the devil"), desc: L("Deja que un remolino te atraviese: polvo cargado de estática, como el que registró Perseverance (MEDA).", "Let a devil pass through you: static-charged dust, like the one Perseverance recorded (MEDA).") },
  { id: "storm_shelter", icon: "⌂", name: L("Refugio a tiempo", "Shelter in time"), desc: L("Estar dentro de un refugio cuando el frente de polvo llega.", "Be inside a shelter when the dust front arrives.") },
  { id: "rover_cover", icon: "▣", name: L("A resguardo del rover", "Rover cover"), desc: L("Aguanta una tormenta al volante o pegado al rover, a sotavento.", "Ride out a storm at the wheel or tucked behind the rover, downwind.") },
  { id: "beat_front", icon: "⏱", name: L("Más rápido que el polvo", "Faster than the dust"), desc: L("Recibe el pronóstico y llega a un refugio antes que el frente.", "Get the forecast and reach a shelter before the front.") },
  { id: "colony", icon: "◓", name: L("Visita a la colonia", "Colony visit"), desc: L("Entra caminando en la Colonia Aeolis.", "Walk into Aeolis Colony.") },
  { id: "greenhouse", icon: "❀", name: L("Botánica marciana", "Martian botany"), desc: L("Entra en el invernadero presurizado.", "Enter the pressurized greenhouse.") },
  { id: "habitat_in", icon: "⌂", name: L("Hogar", "Home"), desc: L("Entra en el hábitat Aeolis por su esclusa.", "Enter the Aeolis habitat through its airlock.") },
  { id: "rescue", icon: "✚", name: L("Nadie se queda atrás", "Leave no one behind"), desc: L("Ayuda a EVA-2 cuando se queda atascado.", "Help EVA-2 when they get stuck.") },
  { id: "night_walk", icon: "☾", name: L("Caminante nocturno", "Night walker"), desc: L("Recorre 200 m a pie de noche, con la linterna del casco.", "Walk 200 m at night with the helmet lamp.") },
  { id: "visor", icon: "◐", name: L("Visor limpio", "Clean visor"), desc: L("Limpia un visor muy sucio de polvo (V).", "Wipe a heavily dusted visor (V).") },
  { id: "km", icon: "↗", name: L("Primer kilómetro", "First kilometer"), desc: L("Camina o conduce 1 km en una EVA.", "Walk or drive 1 km in one EVA.") },
  { id: "veteran", icon: "★", name: L("Veterano de Gale", "Gale veteran"), desc: L("Completa la campaña en dificultad Difícil.", "Complete the campaign on Hard.") },
];
const KEY = "msm-achievements";

export class Achievements {
  constructor(onUnlock) {
    this.onUnlock = onUnlock;
    this.ever = new Set();
    try { JSON.parse(localStorage.getItem(KEY) || "[]").forEach((id) => this.ever.add(id)); } catch { /* sin almacenamiento */ }
    this.session = [];                 // desbloqueados en esta EVA, en orden
    this.nightM = 0;
    this.forecastPending = false;
    this.inStormCover = 0;
  }
  has(id) { return this.session.includes(id); }
  unlock(id) {
    if (this.has(id)) return;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    this.session.push(id);
    const first = !this.ever.has(id);
    this.ever.add(id);
    try { localStorage.setItem(KEY, JSON.stringify([...this.ever])); } catch { /* sin almacenamiento */ }
    if (this.onUnlock) this.onUnlock(a, first);
  }

  // ctx: { game, weather, buddy, night, dt }
  update(dt, { game, weather, buddy, night, insideId }) {
    const s = game.s;
    if (s.phase !== "playing") return;
    const L = weather.storm.level, ph = weather.storm.phase;
    if (weather.devilNear > 0.62) this.unlock("devil_near");
    if (insideId === "colony_aeolis") this.unlock("colony");
    if (insideId === "greenhouse_aeolis") this.unlock("greenhouse");
    if (insideId === "habitat_in") this.unlock("habitat_in");
    if (buddy && buddy.st.rescueDone) this.unlock("rescue");
    if (s.movedTotal >= 1000) this.unlock("km");
    // tormenta: refugio al llegar el frente; aguantar al cubierto del rover
    const eta = weather.eta();
    if (eta && eta.inS > 0 && !s.inShelter) this.forecastPending = true;
    if (this.forecastPending && s.inShelter && eta && eta.inS > 0) { this.unlock("beat_front"); this.forecastPending = false; }
    if ((ph === "front" || ph === "peak") && s.inShelter) this.unlock("storm_shelter");
    if (L > 0.5 && weather.cover > 0 && !s.inShelter) { this.inStormCover += dt; if (this.inStormCover > 20) this.unlock("rover_cover"); }
    if (!eta) this.forecastPending = false;
    // noche a pie
    if (night > 0.7 && !s.driving && s.moving) { this.nightM += s.speed * dt; if (this.nightM >= 200) this.unlock("night_walk"); }
  }
  // eventos sueltos
  scanned(weather) { if (weather.storm.tau > 2.5) this.unlock("storm_scan"); }
  devilHit() { this.unlock("devil_in"); }
  wiped(dirt) { if (dirt > 0.4) this.unlock("visor"); }
  finished(diff) { if (diff && diff.id === "hard") this.unlock("veteran"); }
}
