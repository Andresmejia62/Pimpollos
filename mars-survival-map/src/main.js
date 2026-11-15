import { loadAll, assetUrl } from "./data.js";
import { t, ui, getLang, setLang } from "./i18n.js";
import { World } from "./engine/world.js";
import { MarsScene } from "./engine/scene.js";
import { Astronaut, EMOTES } from "./engine/astronaut.js";
import { buildHabitat, buildRover, buildShelter } from "./engine/props.js";
import { buildMarsRover } from "./engine/marsrover.js";
import { buildStructures } from "./engine/structures.js";
import { Controls } from "./engine/controls.js";
import { Game } from "./gameplay/game.js";
import { AlertSystem } from "./gameplay/alerts.js";
import { Pathfinder } from "./gameplay/pathfinding.js";
import { Hud } from "./ui/hud.js";
import { initAudio, sfx, setWind } from "./audio.js";
import { GeoFrame } from "./geo.js";
import { Atlas } from "./ui/atlas.js";
import { ProfileScreen } from "./ui/profile.js";
import { loadProfile } from "./engine/physiology.js";
import { LoadingScreen, PauseMenu } from "./ui/screens.js";
import { SkyPlanets } from "./engine/planets.js";
import { Planner } from "./ui/planner.js";
import { SimPanel } from "./ui/sim.js";
import { Companion } from "./gameplay/companion.js";
import { IntroCinematic } from "./ui/intro.js";
import { loadSpaceWeather, REFERENCE_EVENT, LEVEL_TEXT, LEVEL_COLOR } from "./spaceweather.js";
import { Vector3 as THREE_V } from "three";

const $ = (id) => document.getElementById(id);
const DEBUG = new URLSearchParams(location.search).has("debug");
const show = (id, on = true) => { $(id).hidden = !on; };

async function boot() {
  setLang(getLang());
  const loader = new LoadingScreen();
  const data = await loadAll((p, key) => loader.data(p, key));
  const world = new World(data);
  const canvas = $("view");
  const scene = new MarsScene(canvas, world, data);
  await scene.init((p) => loader.scene(p));
  loader.done();

  const astro = new Astronaut(scene.scene);
  const buddyAstro = new Astronaut(scene.scene, { accent: "#2f7de1" });   // EVA-2: franjas azules
  buddyAstro.root.visible = false;
  astro.tryLoadModel();
  const game = new Game(data, world, (x, z) => scene.heightAt(x, z), scene.colliders, scene.dynamics);
  const path = new Pathfinder(world);
  const alerts = new AlertSystem(data.alerts, game);
  const geo = new GeoFrame(data.region);
  const hud = new Hud(game, world, data, geo);
  const atlas = new Atlas({ game, world, geo, data });
  atlas.onClose = () => canvas.focus();
  const applyProfile = (p) => { game.setProfile(p); astro.setLook(p.look); astro.setBuild(p.mass, p.height);
    // EVA-2 siempre se distingue del jugador: si eliges franjas azules, las suyas pasan a naranja
    buddyAstro.opts.accent = p.look.accent === "blue" ? "#d4541c" : "#2f7de1"; buddyAstro.setLook({}); };
  applyProfile(loadProfile());
  const profile = new ProfileScreen(game.o2CapacityG);
  const openAtlas = (where) => { atlas.open(where); controls.unlock(); };
  const planner = new Planner({ game, world, path });
  // clima espacial: se carga en segundo plano (DONKI en vivo -> copia guardada -> evento de referencia)
  let sw = { level: "reference", flares: [], seps: [], marsHits: [], upcoming: [], source: "reference" };
  loadSpaceWeather(assetUrl).then((r) => { sw = r; pause.sw = r; if (game.s.phase === "briefing") showBriefing(); });
  // texto de la alerta de tormenta: el evento real mas fuerte reciente o el de referencia de mayo de 2024
  const stormText = () => {
    const f = sw.flares && sw.flares[0];
    if (sw.source !== "reference" && f) return { es: `Alerta basada en NASA DONKI: fulguración ${f.cls} (${f.time.slice(0, 10)}). Las partículas llegan en minutos u horas. ¡Busca refugio!`, en: `Alert based on NASA DONKI: ${f.cls} flare (${f.time.slice(0, 10)}). Particles arrive within minutes to hours. Find shelter!` };
    return { es: `Tormenta de referencia: ${REFERENCE_EVENT.text.es} ¡Busca refugio!`, en: `Reference storm: ${REFERENCE_EVENT.text.en} Find shelter!` };
  };
  // ruta planificada: la sigue el minimapa y la linea del suelo mientras el objetivo no cambie
  const usePlan = (pts, kind) => {
    game.s.plan = { targetId: game.target.id, pts, kind };
    game.setRoute(true);
    scene.setRoute(pts); hud.minimap.setRoute(pts);
  };
  const controls = new Controls(canvas);
  const car = buildMarsRover(scene);
  // planetas en el cielo: posiciones reales de hoy vistas desde Gale (engine/planets.js). P = etiquetas
  // van en la escena lejana, detras del relieve real del crater (el borde y el monte Sharp los tapan)
  const sky = new SkyPlanets(scene.skyScene, (p, m) => `${t(p.name)}${p.id === "earth" ? " + " + t({ es: "Luna", en: "Moon" }) : ""}  ${m.toFixed(1).replace(".", getLang() === "es" ? "," : ".")}`);
  sky.radius = scene.skyRadius;
  const skyTau = () => 0.6 + 4 * (scene.storm || 0);           // opacidad tipica del polvo en Gale ~0,5-0,8
  // leyenda de la portada: que planetas hay hoy en el cielo de Gale
  const skyCaption = () => {
    const eph = sky.ephemeris(), lang = getLang();
    const vis = eph.planets.filter((p) => ["venus", "earth", "jupiter", "saturn", "mercury"].includes(p.id) && p.mag < 5.5 && p.elong > 12);
    const name = (p) => `<b>${t(p.name)}</b> (m ${p.mag.toFixed(1).replace(".", lang === "es" ? "," : ".")}, ${Math.round(p.elong)}° ${t({ es: "del Sol", en: "from the Sun" })}, ${t(p.evening ? { es: "al anochecer", en: "at dusk" } : { es: "al amanecer", en: "at dawn" })})`;
    $("skyCaption").innerHTML = `<div class="ttl">${t({ es: "Cielo real de hoy desde Gale", en: "Today's real sky from Gale" })}</div>${vis.map(name).join(" · ")}. ${t({ es: "Neptuno no se ve sin telescopio. Pulsa P en la EVA para ocultar las etiquetas.", en: "Neptune needs a telescope. Press P during the EVA to hide the labels." })}`;
  };
  const moonLabel = (m) => `${t(m.name)}  ${(m.radius * 2 * 180 / Math.PI * 60).toFixed(0)}′`;   // nombre y diametro aparente en minutos de arco
  const updateSky = (hour) => {
    sky.update(scene.camera, hour, scene.skyMat.uniforms.uDay.value, skyTau(), innerHeight);
    sky.updateMoons(scene.camera, scene.moons, moonLabel);
  };
  let wasDriving = false, walkDist = controls.dist;

  // ---- marcadores y estructuras ------------------------------------------------
  const beacons = {};
  for (const o of data.objectives.objectives) {
    const { x, z } = o.world;
    if (o.id === "habitat") buildHabitat(scene, x, z);
    else if (o.id === "rover") buildRover(scene, x - 5, z + 2);
    else if (o.type === "shelter") buildShelter(scene, x, z);
    beacons[o.id] = scene.addBeacon(x, z, game.radiusOf(o), o.shelter ? 120 : 380);
  }
  // estructuras del mapa (public/layers/structures.json, generado por data/scripts/build_structures.mjs)
  buildStructures(scene, data.structures);
  const updateBeacons = () => {
    const tg = game.target;
    for (const [id, b] of Object.entries(beacons)) {
      const o = game.objectives[id];
      if (!o) { scene.setBeacon(b, { visible: false, target: false, shelter: false }); continue; }
      const isT = tg && id === tg.id;
      const done = o.type === "science" && game.missions.findIndex((m) => m.objective_id === id) < game.s.missionIndex;
      scene.setBeacon(b, { visible: !!(isT || o.shelter || (!done && o.type === "science")), target: !!isT, shelter: !!o.shelter });
    }
  };

  // ---- idioma y pantallas ----------------------------------------------------------
  const toggleLang = () => { setLang(getLang() === "es" ? "en" : "es"); hud.applyLang(); atlas.applyLang(); skyCaption(); if (game.s.phase === "briefing") showBriefing(); if (game.s.free) sim.render(); };
  hud.applyLang();
  skyCaption();
  // la carga se desvanece sobre la portada
  show("scrTitle");
  $("scrLoading").classList.add("out");
  setTimeout(() => show("scrLoading", false), 700);

  // Foto real de Curiosity (public/pov/pov.json): role = "arrival" (llegada) o "closeup" (de cerca)
  function povFigure(id, oid, role) {
    const fig = $(id), img = data.pov?.images?.[oid]?.[role];
    fig.hidden = !img;
    if (!img) return;
    fig.querySelector("img").src = assetUrl(img.file);
    fig.querySelector("img").alt = t(img.caption);
    fig.querySelector("figcaption").innerHTML =
      `<b>${ui(role === "arrival" ? "povArrival" : "povClose")}:</b> ${t(img.caption)} ` +
      `<span>${ui("povTaken")} · ${img.camera} · sol ${img.sol} · NASA/JPL-Caltech</span>`;
  }

  function showBriefing() {
    const m = game.mission, o = game.objectives[m.objective_id];
    const s = game.s;
    const d = Math.hypot(o.world.x - s.x, o.world.z - s.z);
    const climb = Math.round(o.world.y - scene.heightAt(s.x, s.z));
    const sh = game.nearestShelter(o.world);
    const hazardIcon = { slope: "i-slope", radiation: "i-radiation", temperature: "i-thermo", oxygen: "i-o2" }[m.hazard_main] || "i-warn";
    const keyOf = { slope: "1", radiation: "2", thermal: "3", spectral: "4", route: "R" };
    $("briefNum").textContent = `${ui("mission")} ${m.order} ${ui("of")} ${game.missions.length}`;
    $("briefTitle").textContent = t(m.title);
    $("briefText").textContent = t(m.brief);
    povFigure("briefPov", m.objective_id, "arrival");
    const pl = s.plan && s.plan.targetId === o.id ? s.plan : null;
    $("briefPlanNote").textContent = pl
      ? t({ es: "✓ Ruta planificada lista: la verás en el minimapa y en el suelo.", en: "✓ Planned route ready: you'll see it on the minimap and on the ground." })
      : t({ es: "Antes de salir puedes comparar rutas y estimar cuánto O₂ y batería gastarás.", en: "Before heading out you can compare routes and estimate your O₂ and battery use." });
    $("briefChips").innerHTML = `
      <span class="chip danger"><svg><use href="#${hazardIcon}"/></svg>${ui("hazard")}: ${ui("hazards." + m.hazard_main)}</span>
      <span class="chip"><svg><use href="#i-layers"/></svg>${ui("layerHint")}: <kbd>${keyOf[m.layer_hint] || "R"}</kbd> ${ui("layers." + (m.layer_hint || "route"))}</span>
      <span class="chip"><svg><use href="#i-target"/></svg>${(d / 1000).toFixed(1).replace(".", ",")} km · ${climb >= 0 ? "+" : ""}${climb} m</span>
      <span class="chip safe"><svg><use href="#i-shelter"/></svg>${ui("shelterNear")}: ${t(sh.name)}</span>
      <span class="chip" style="color:${LEVEL_COLOR[sw.level]};border-color:${LEVEL_COLOR[sw.level]}"><svg><use href="#i-radiation"/></svg>${t({ es: "Clima espacial (NASA DONKI)", en: "Space weather (NASA DONKI)" })}: ${t(LEVEL_TEXT[sw.level])}</span>`;
    const stormMission = (m.events || []).some((e) => e.event === "solar_particle_event");
    $("briefPlanNote").textContent += stormMission ? " " + t({ es: "Pronóstico: probable tormenta de partículas solares durante esta misión. Ten un refugio cerca.", en: "Forecast: a solar particle event is likely during this mission. Keep a shelter nearby." }) : "";
    show("scrBriefing");
    show("hud");
    controls.unlock();
  }

  game.on("mission", () => { hud.clearAlerts(); updateBeacons(); showBriefing(); buddy.snapTo(game.s); });

  // ---- EVA-2 -------------------------------------------------------------------------
  // EVA-2 pisa el terreno y, como el jugador, las plataformas bajas que se suben sin saltar
  const buddyGround = (x, z) => { const b = scene.heightAt(x, z); return scene.colliders.groundOn(x, z, b, 0.35, b, false); };
  const buddy = new Companion(game, world, path, buddyGround);
  hud.minimap.buddy = buddy.st;
  data.dialogs.speakers.buddy = { name: { es: "EVA-2 · Compañero", en: "EVA-2 · Partner" }, icon: "helmet", color: "#5aa9ff" };
  const say = (text, dur = 7) => hud.dialogQueue.push({ speaker: "buddy", duration_s: dur, text });
  const n1 = (v, d = 0) => v.toFixed(d).replace(".", getLang() === "es" ? "," : ".");
  buddy.on("task", ({ obj, reading: r }) => say({
    es: `Medición secundaria junto a ${obj.name.es}: suelo ${n1(r.temp)} °C, ${n1(r.dose, 2)} µGy/h, pendiente ${n1(r.slope)}°, ${r.mineral.es.toLowerCase()}. +15 ciencia.`,
    en: `Secondary reading next to ${obj.name.en}: ground ${n1(r.temp)} °C, ${n1(r.dose, 2)} µGy/h, slope ${n1(r.slope)}°, ${r.mineral.en.toLowerCase()}. +15 science.` }, 8));
  buddy.on("stuck", () => {
    sfx.klaxon();
    hud.showAlert({ id: "a_buddy_stuck", severity: "danger", text: { es: "EVA-2 resbaló y tiene una fuga en la rodilla. Llega hasta él y mantén F para ayudarlo.", en: "EVA-2 slipped and has a knee-joint leak. Reach them and hold F to help." } });
    say({ es: "¡Me caí en la ladera del canal! Tengo una fuga, el O₂ baja rápido. ¿Puedes venir?", en: "I fell on the channel slope! I've got a leak, O₂ is dropping fast. Can you come?" }, 6);
  });
  buddy.on("rescued", ({ bonus }) => {
    sfx.success();
    hud.clearAlert({ id: "a_buddy_stuck" });
    hud.showAlert({ id: "a_buddy_ok", severity: "info", text: { es: `Rescate completado: sellaste la fuga y le pasaste O₂ por la manguera de emergencia (−8 % para ti). +${bonus} ciencia.`, en: `Rescue complete: you sealed the leak and shared O₂ through the emergency hose (−8 % for you). +${bonus} science.` } });
    say({ es: "Gracias. Nunca salgas solo: por eso vamos de dos en dos.", en: "Thanks. Never go out alone: that's why we go in pairs." }, 5);
  });
  buddy.on("aborted", () => {
    hud.clearAlert({ id: "a_buddy_stuck" });
    hud.showAlert({ id: "a_buddy_abort", severity: "caution", text: { es: "EVA-2 se quedó sin margen de O₂ y aborta hacia el rover. Sigues tú.", en: "EVA-2 ran out of O₂ margin and is aborting to the rover. You carry on." } });
  });
  buddy.on("rejoined", () => say({ es: "Recargué en el rover. Vuelvo contigo.", en: "Recharged at the rover. Back with you." }, 4));
  // ---- modo libre (simulacion) ---------------------------------------------------------
  // Sin campana: el usuario define destino, salida, hora, tormentas y que recursos se gastan (ui/sim.js).
  let mode = "game", buddyOn = true, softUnlock = false;
  // soltar el raton para usar un panel sin que se abra el menu de pausa
  const freeMouse = () => { if (controls.locked) { softUnlock = true; controls.unlock(); } };
  const refill = () => { const s = game.s; s.oxygen = s.energy = s.integrity = 100; s.bio.fatigue = 0; };
  const toggleStorm = () => { const sp = game.s.spe; sp && sp.phase !== "ended" ? game.endStorm() : game.triggerStorm(); };
  const openFreePlanner = () => {
    if (!game.s.free || game.s.phase !== "playing") return;
    freeMouse();
    planner.open((pts, kind, sel) => {
      if (sel.start) { game.teleport(sel.start[0], sel.start[1]); buddy.snapTo(game.s); }
      const cur = game.objectives.custom;
      if (sel.goal && !(cur && cur.world.x === sel.goal[0] && cur.world.z === sel.goal[1])) {
        const ll = geo.toLatLon(sel.goal[0], sel.goal[1]);
        game.setFreeTarget(sel.goal[0], sel.goal[1], [ll.lat, ll.lon]);
      }
      if (pts && game.target) usePlan(pts, kind);
      else if (game.target) { game.s.plan = null; game.setRoute(true); }
    }, { free: true });
  };
  const sim = new SimPanel(game, {
    pickTarget: openFreePlanner,
    gotoSite: (id) => { const o = game.objectives[id]; if (o) { game.teleport(o.world.x + 18, o.world.z + 14); buddy.snapTo(game.s); lastRoute = -99; } },
    profile: () => { freeMouse(); profile.open(); },
    exportCsv: () => atlas.exportCSV(),
    buddy: (on) => { buddyOn = on; hud.minimap.buddy = on ? buddy.st : null; },
    refill,
  });
  const startFree = () => {
    game.startFree();
    controls.enabled = true;
    show("hud");
    sim.reset();
    buddyOn = true; hud.minimap.buddy = buddy.st;
    $("telem").hidden = true;            // el panel de simulacion ocupa su sitio; I la vuelve a mostrar al lado
    sim.show(true);
    hud.dialogQueue.push({ speaker: "suit", duration_s: 9, text: {
      es: "Modo libre: no hay misión. Pulsa G para definir tu destino y tu ruta en el mapa, y O para abrir o cerrar el panel de simulación.",
      en: "Free mode: there is no mission. Press G to set your destination and route on the map, and O to open or close the simulation panel." } });
    openFreePlanner();
  };
  game.on("free", () => {
    hud.clearAlerts(); hud.clearDialogs();
    show("scrBriefing", false); show("scrCard", false); show("scrEnd", false);
    buddy.reset();
    if (beacons.custom && !game.objectives.custom) { scene.setBeacon(beacons.custom, { visible: false, target: false, shelter: false }); delete beacons.custom; }
    scene.setOverlay(null); hud.setLayer(null); hud.setRoute(false);
    updateBeacons();
    lastRoute = -99;
  });
  game.on("freeTarget", (o) => {
    if (beacons.custom) { scene.setBeacon(beacons.custom, { visible: false, target: false, shelter: false }); delete beacons.custom; }
    if (o) beacons.custom = scene.addBeacon(o.world.x, o.world.z, game.radiusOf(o), 380);
    else { hud.minimap.setRoute(null); if (game.s.routeOn) game.setRoute(false); }
    updateBeacons();
    lastRoute = -99;
    sim.update(0, true);
  });
  game.on("freeScan", ({ objective }) => {
    sfx.success();
    const s = game.s, r = buddy._reading(s.x, s.z), dec = getLang() === "es" ? "," : ".";
    const f = (v, d = 0) => v.toFixed(d).replace(".", dec);
    sim.addReading({ n: objective.n, elev: objective.elevation_m, ...r });
    hud.showAlert({ id: "a_free_scan", severity: "info", text: {
      es: `${objective.name.es} medido: ${f(objective.elevation_m)} m · pendiente ${f(r.slope)}° · suelo ${f(r.temp)} °C · ${f(r.dose, 2)} µGy/h · ${r.mineral.es.toLowerCase()}. Muestra de 1,8 kg recogida.`,
      en: `${objective.name.en} measured: ${f(objective.elevation_m)} m · slope ${f(r.slope)}° · ground ${f(r.temp)} °C · ${f(r.dose, 2)} µGy/h · ${r.mineral.en.toLowerCase()}. 1.8 kg sample collected.` } });
    sim.update(0, true);
  });

  game.on("layer", (l) => { scene.setOverlay(l); hud.setLayer(l); });
  game.on("route", (on) => { scene.setRouteVisible(on); hud.setRoute(on); lastRoute = -99; });
  game.on("suggestLayer", (l) => { if (!game.s.layer && game.s.missionIndex > 0) game.setLayer(l); });
  game.on("shelter", (o) => { const d = game.dialogs[o.id === "rover" ? "d_shelter_rover" : "d_shelter_habitat"]; if (d) hud.dialogQueue.push(d); });
  game.on("spe", (sp) => { if (sp.phase === "warning") { hud.dialogQueue.unshift({ speaker: "base", duration_s: 9, text: stormText() }); sfx.klaxon(); if (game.s.layer !== "radiation") game.setLayer("radiation"); game.setRoute(true); } updateBeacons(); });
  game.on("scanStart", () => sfx.scan());
  game.on("cargoUnload", ({ n, kg, where }) => hud.showAlert({ id: "a_cargo_unload", severity: "info", text: {
    es: `Dejaste ${n} muestra${n > 1 ? "s" : ""} (${kg.toFixed(1).replace(".", ",")} kg) en ${where.name.es}. Caminas más ligero.`,
    en: `You left ${n} sample${n > 1 ? "s" : ""} (${kg.toFixed(1)} kg) at ${where.name.en}. You walk lighter.` } }));
  game.on("jump", () => sfx.step());
  game.on("land", ({ damage, driving }) => {
    sfx.step();
    if (damage > 0) hud.showAlert({ id: "a_hard_landing", severity: "caution", text: driving
      ? { es: "Aterrizaje brusco: el golpe ha dañado el traje. Frena antes de las crestas.", en: "Hard landing: the jolt damaged your suit. Slow down before crests." }
      : { es: "Caída fuerte: el traje ha perdido integridad. En Marte se cae despacio, pero desde muy alto también duele.", en: "Hard fall: your suit lost integrity. You fall slowly on Mars, but from high up it still hurts." } });
  });
  game.on("scanComplete", ({ mission, objective, fact }) => {
    sfx.success();
    controls.unlock();
    $("cardPts").textContent = "+" + mission.points;
    $("cardTitle").textContent = t(objective.name);
    povFigure("cardPov", objective.id, "closeup");
    $("cardFactTitle").textContent = `${ui("fact")} · ${t(fact.title)}`;
    $("cardFact").textContent = t(fact.text);
    $("cardSource").textContent = `${ui("source")}: ${fact.source}`;
    $("cardSol").textContent = objective.msl_sol ? `${ui("curiosityHere")} ${objective.msl_sol}` + (getLang() === "es" && objective.analog ? ` · ${objective.analog}` : "") : "";
    show("scrCard");
  });
  game.on("end", ({ success, score, cause }) => {
    controls.unlock();
    (success ? sfx.success : sfx.fail)();
    const scr = data.missions.end_screens;
    const card = $("endCard");
    if (success) {
      card.style.borderColor = "";
      card.innerHTML = `
        <div class="eyebrow ok">${t(data.missions.campaign.title)}</div>
        <h2>${t(scr.success.title)}</h2>
        <p class="body muted">${t(scr.success.body)}</p>
        <table class="score">
          <tr><td>${ui("science")}</td><td>${score.science}</td></tr>
          <tr><td>${ui("safety")}</td><td>+${score.safety}</td></tr>
          <tr><td>${ui("time")} (${Math.round(score.minutes)} min)</td><td>+${score.time}</td></tr>
          <tr><td>${ui("storm")}</td><td>+${score.storm}</td></tr>
          <tr class="total"><td>${ui("total")}</td><td>${score.total}</td></tr>
        </table>
        <div class="btnrow"><button class="btn primary" id="btnAgain">${ui("playAgain")}</button></div>`;
      $("btnAgain").onclick = () => location.reload();
    } else if (game.s.free) {
      // modo libre: el fallo es un resultado de la simulacion; se puede seguir desde el mismo punto
      const s = scr[cause];
      card.style.borderColor = "var(--danger)";
      card.innerHTML = `
        <div class="eyebrow" style="color:var(--danger)"><svg><use href="#i-octagon"/></svg>${t({ es: "Simulación · límite alcanzado", en: "Simulation · limit reached" })}</div>
        <h2>${t(s.title)}</h2>
        <p class="body">${t(s.body)}</p>
        <div class="btnrow"><button class="btn primary" id="btnFreeGo">${t({ es: "Recargar y seguir aquí", en: "Refill and continue here" })}</button><button class="btn" id="btnRetry">${t({ es: "Reiniciar simulación", en: "Restart simulation" })}</button><button class="btn" id="btnMenu">${ui("menu")}</button></div>`;
      $("btnFreeGo").onclick = () => { show("scrEnd", false); refill(); game.s.failCause = null; game.s.phase = "playing"; canvas.focus(); };
      $("btnRetry").onclick = () => { show("scrEnd", false); game.retry(); };
      $("btnMenu").onclick = () => location.reload();
    } else {
      const s = scr[cause];
      card.style.borderColor = "var(--danger)";
      card.innerHTML = `
        <div class="eyebrow" style="color:var(--danger)"><svg><use href="#i-octagon"/></svg>${t({ es: "Misión fallida", en: "Mission failed" })}</div>
        <h2>${t(s.title)}</h2>
        <p class="body">${t(s.body)}</p>
        <div class="btnrow"><button class="btn primary" id="btnRetry">${ui("retry")}</button><button class="btn" id="btnMenu">${ui("menu")}</button></div>`;
      $("btnRetry").onclick = () => { show("scrEnd", false); hud.clearDialogs(); game.retry(); };
      $("btnMenu").onclick = () => location.reload();
    }
    show("scrEnd");
  });

  alerts.onClear((a) => hud.clearAlert(a));
  alerts.onAlert((a) => {
    const extra = a.id === "a_spe_warning" && game.s.spe ? { s: Math.ceil(game.s.spe.t) } : {};
    hud.showAlert(a, extra);
    const snd = data.alerts.severity_style[a.severity]?.sound;
    if (snd && sfx[snd]) sfx[snd]();
  });

  // ---- botones --------------------------------------------------------------------
  // Comenzar: primero el perfil fisico del astronauta, luego la primera mision
  // Comenzar EVA: cinematica de llegada (cohete -> entrada atmosferica -> impacto en Gale) y luego el perfil
  const intro = new IntroCinematic({ ms: scene, site: game.objectives.habitat.world, geo, getMarsRaster: () => atlas.rGlobal || null });
  // Comenzar EVA = modo juego (campana de 5 misiones)
  $("btnStart").onclick = () => {
    initAudio();
    mode = "game";
    show("scrTitle", false);
    intro.play(() => profile.open());
  };
  // Modo libre = simulacion sin objetivo predefinido (sin cinematica: directo al perfil y al mapa)
  $("btnFree").onclick = () => {
    initAudio();
    mode = "free";
    show("scrTitle", false);
    profile.open();
  };
  profile.onBack = () => { if (!game.s.free) show("scrTitle"); };
  profile.onConfirm = (p) => {
    applyProfile(p);
    if (game.s.free) { sim.update(0, true); return; }       // cambio de perfil en plena simulacion
    if (mode === "free") { startFree(); return; }
    game.reset();
    controls.enabled = true;
    game.startMission(0);
  };
  $("btnAtlas").onclick = () => openAtlas("global");
  $("minimap").onclick = () => openAtlas("eva");
  // Cerrar el atlas con M o Esc funciona siempre, tambien abierto desde la portada o la pausa (antes dependia de
  // los controles del juego, que solo se activan al empezar la EVA). En fase de captura y cortando el evento,
  // para que la misma pulsacion no lo vuelva a abrir ni abra la pausa.
  window.addEventListener("keydown", (e) => {
    if (!atlas.isOpen || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase(), tag = e.target && e.target.tagName;
    // escribiendo en el buscador o en el nombre de un marcador, las teclas son texto (Esc solo sale del campo)
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (k !== "escape" && k !== "m") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    atlas.close();
  }, true);
  $("btnPlan").onclick = () => { show("scrBriefing", false); planner.open(usePlan); };
  planner.onClose = () => { if (game.s.phase === "briefing") showBriefing(); else canvas.focus(); };
  $("btnBegin").onclick = () => {
    show("scrBriefing", false);
    game.beginMission();
    canvas.focus();
  };
  $("btnCardContinue").onclick = () => { show("scrCard", false); game.continueAfterCard(); };
  $("btnLang").onclick = toggleLang;
  $("btnGuide").onclick = () => show("scrGuide");
  $("btnGuideClose").onclick = () => show("scrGuide", false);
  let paused = false;
  const pause = new PauseMenu({
    game, geo, world,
    onResume: () => setPaused(false),
    onAtlas: () => { setPaused(false); openAtlas("eva"); },
    onGuide: () => show("scrGuide"),
    onLang: toggleLang,
    onRetry: () => { setPaused(false); hud.clearDialogs(); game.retry(); },
    onMenu: () => location.reload(),
  });
  const setPaused = (p) => { paused = p; show("scrPause", p); if (p) { controls.unlock(); pause.open(); } else pause.close(); };
  document.querySelectorAll("#layerbar button").forEach((b) => {
    b.onclick = () => (b.dataset.layer === "route" ? game.setRoute() : game.setLayer(b.dataset.layer));
  });

  let wasLocked = false;
  controls.on("lock", (locked) => {
    if (wasLocked && !locked && game.s.phase === "playing" && !atlas.isOpen && !softUnlock) setPaused(true);
    softUnlock = false;
    wasLocked = locked;
  });
  controls.on("key", (k, e) => {
    if (atlas.isOpen) { if (k === "escape" || k === "m") atlas.close(); return; }
    if (!$("scrPlan").hidden) { if (k === "escape") planner.close(); return; }
    if (!$("scrProfile").hidden) return;
    if (game.s.phase !== "playing") return;
    if (k === "escape") { setPaused(!paused); return; }
    if (paused) return;
    const map = { 1: "slope", 2: "radiation", 3: "thermal", 4: "spectral" };
    if (map[k]) game.setLayer(map[k]);
    if (k === "r") game.setRoute();
    if (k === "e" && game.toggleVehicle()) sfx.blip();
    if (k === "h") show("scrGuide", $("scrGuide").hidden);
    if (k === "m") openAtlas("eva");
    if (k === "i") $("telem").hidden = !$("telem").hidden;
    if (k === "p") sky.labelsOn = !sky.labelsOn;
    // gestos del personaje (a pie): Z saludar, X pulgar, C sentarse, V bailar, B estirarse
    const em = !game.s.driving && Object.keys(EMOTES).find((n) => EMOTES[n].key === k);
    if (em && astro.playEmote(em)) {
      sfx.emote();
      // EVA-2 devuelve el saludo si esta cerca
      if (em === "wave" && buddyOn && !buddy.st.riding && Math.hypot(buddy.st.x - game.s.x, buddy.st.z - game.s.z) < 14) setTimeout(() => buddyAstro.playEmote("wave"), 700);
    }
    if (game.s.free) {
      // herramientas del modo libre
      if (k === "g") openFreePlanner();
      if (k === "o") { sim.toggle(); if (sim.isOpen) freeMouse(); }
      if (k === "t") toggleStorm();
      if (k === "k") refill();
    } else if (DEBUG) {
      if (k === "t") game.triggerStorm();
      if (k === "k") { game.s.oxygen = 100; game.s.energy = 100; game.s.integrity = 100; }
    }
    if (DEBUG && k === "n" && game.target) { const o = game.target; game.s.x = o.world.x + 25; game.s.z = o.world.z + 25; game.s.y = null; }
  });
  if (DEBUG) show("fps");

  // ---- bucle ------------------------------------------------------------------------
  let last = performance.now(), acc = 0, lastRoute = -99, frames = 0, fpsT = 0, aurora = 0;
  const titleCenter = game.objectives.habitat.world;
  const TITLE_HOUR = 17.82, titleDir = new THREE_V();
  function frame(nowMs) {
    const dt = Math.min(0.1, (nowMs - last) / 1000);
    last = nowMs;
    const now = nowMs / 1000;
    const s = game.s;

    if (intro.groundActive) {
      // cinematica: la parte de la superficie usa el terreno real del juego
      intro.frameGround(dt);
      updateSky(16.4);
    } else if (s.phase === "title") {
      // portada: crepusculo en Gale con los planetas que se ven HOY desde Marte (la Tierra, Venus, ...)
      const a = now * 0.03;
      const cx = titleCenter.x + Math.sin(a) * 140, cz = titleCenter.z - 60 + Math.cos(a) * 40;
      scene.camera.position.set(cx, scene.heightAt(cx, cz) + 45, cz);
      scene.setTimeOfDay(TITLE_HOUR);
      const e = sky.dirOf("earth", TITLE_HOUR, titleDir);
      if (e.y > 0.05) {
        // mirar un poco a la izquierda de la Tierra para que quede a la derecha del titulo
        const az = Math.atan2(e.x, -e.z) - 0.42, el = Math.min(0.42, Math.max(0.12, Math.asin(e.y) * 0.55));
        scene.camera.lookAt(cx + Math.sin(az) * Math.cos(el) * 1000, scene.camera.position.y + Math.sin(el) * 1000, cz - Math.cos(az) * Math.cos(el) * 1000);
      } else scene.camera.lookAt(titleCenter.x + 200, titleCenter.y + 120, titleCenter.z + 2500);
      scene.setFocus(cx, scene.heightAt(cx, cz), cz);
      updateSky(TITLE_HOUR);
    } else {
      // la simulacion se detiene mientras hay una pantalla encima (pausa, guia, atlas, planificacion, perfil)
      const running = s.phase === "playing" && !paused && $("scrGuide").hidden && !atlas.isOpen && $("scrPlan").hidden && $("scrProfile").hidden;
      if (running) {
        game.update(dt, controls.moveVector(), controls.jumpHeld());
        acc += dt;
        if (acc > 0.25) { acc = 0; alerts.check(now); }
      }
      const y = s.y ?? scene.heightAt(s.x, s.z);
      // al subir al rover se oculta el astronauta y la camara se aleja
      if (s.driving !== wasDriving) {
        wasDriving = s.driving;
        astro.root.visible = !s.driving;
        if (s.driving) { walkDist = controls.dist; controls.dist = Math.max(controls.dist, 13); }
        else controls.dist = walkDist;
      }
      astro.update(dt, s.driving ? 0 : s.speed, s.x, y, s.z, s.heading, s.air);
      // EVA-2
      if (s.phase === "playing" && !paused && $("scrGuide").hidden && !atlas.isOpen && $("scrPlan").hidden && $("scrProfile").hidden && buddyOn) buddy.update(dt, controls.keys.has("f"));
      const bs = buddy.st;
      buddyAstro.root.visible = buddyOn && !bs.riding;
      buddyAstro.update(dt, bs.mode === "stuck" ? 0 : bs.speed, bs.x, buddyGround(bs.x, bs.z), bs.z, bs.heading, 0);
      const dB = Math.hypot(bs.x - s.x, bs.z - s.z);
      $("buddyPrompt").hidden = !(buddyOn && bs.mode === "stuck" && dB < 4.5 && s.phase === "playing");
      if (!$("buddyPrompt").hidden) { $("buddyPromptText").textContent = t({ es: "Mantén F para ayudar a EVA-2", en: "Hold F to help EVA-2" }); $("buddyAssist").style.width = (100 * bs.assist / 3) + "%"; }
      const bl = $("buddyLine");
      bl.hidden = !buddyOn;
      bl.classList.toggle("alert", bs.mode === "stuck");
      bl.innerHTML = `<span>EVA-2</span><div class="bar"><i style="width:${Math.max(0, bs.o2)}%"></i></div><em>${Math.round(bs.o2)} % · ${t(buddy.statusText())}${bs.mode === "stuck" ? " · " + Math.round(dB) + " m" : ""}</em>`;
      controls.updateCamera(scene.camera, { x: s.x, y: y + (s.driving ? 0.6 : 0), z: s.z }, (x, z) => scene.heightAt(x, z));
      hud.camYaw = controls.yaw;
      scene.setTimeOfDay(game.hour);
      updateSky(game.hour);
      scene.setFocus(s.x, y, s.z);
      // tormenta solar: la aurora sube durante el aviso y llega al maximo con la tormenta activa
      const sp = s.spe, auroraTo = sp && sp.phase !== "ended" ? (sp.phase === "active" ? 1 : 0.3) : 0;
      aurora += (auroraTo - aurora) * Math.min(1, dt * 0.8);
      scene.setAurora(aurora);
      // dosimetro: chasquidos al azar, mas seguidos cuanto mas intensa (casi callado a cubierto)
      if (running && hud.stormLevel > 0.02 && Math.random() < dt * (3 + 34 * hud.stormLevel)) sfx.geiger();
      // ruta sugerida (A*) recalculada cada 1,5 s
      if (s.routeOn && now - lastRoute > 1.5) {
        lastRoute = now;
        const tg = game.target;
        let r = null;
        if (tg && s.plan && s.plan.targetId === tg.id) {
          // tramo restante de la ruta planificada, desde el punto mas cercano
          const P = s.plan.pts;
          let bi = 0, bd = Infinity;
          P.forEach(([x, z], i) => { const d = Math.hypot(x - s.x, z - s.z); if (d < bd) { bd = d; bi = i; } });
          r = bd < 60 ? [[s.x, s.z], ...P.slice(bi + 1)] : path.find(s.x, s.z, tg.world.x, tg.world.z);
        } else if (tg) r = path.find(s.x, s.z, tg.world.x, tg.world.z);
        if (r) { scene.setRoute(r); hud.minimap.setRoute(r); }
      }
      scene.setRouteVisible(s.routeOn && !!game.target);
      if (s.free) { if (!game.target && hud.minimap.route) hud.minimap.setRoute(null); sim.update(now); }
      else if (!$("simPanel").hidden) $("simPanel").hidden = true;
      updateBeacons();
      hud.setLockHint(controls.locked || s.phase !== "playing" ? "" : ui("clickToLook"));
      hud.update(now);
      setWind(s.spe && s.spe.phase === "active" ? 0.09 : 0.05);
    }
    car.update(dt, s.car.x, s.car.z, s.car.heading, s.driving ? s.speed : 0, now, s.driving ? s.y : null, s.driving ? s.air : 0);
    scene.render(now, dt);
    if (DEBUG) {
      frames++; fpsT += dt;
      if (fpsT > 0.5) { $("fps").textContent = `${Math.round(frames / fpsT)} fps · x ${s.x.toFixed(0)} z ${s.z.toFixed(0)}`; frames = 0; fpsT = 0; }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__msm = { game, scene, world, path, controls, atlas, geo, car, astro, sky, buddy, planner, intro, sim }; // para depurar desde la consola
}

boot().catch((e) => {
  console.error(e);
  $("loadText").textContent = "Error: " + e.message;
});
