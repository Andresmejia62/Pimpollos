import { loadAll, assetUrl } from "./data.js";
import { t, ui, getLang, setLang } from "./i18n.js";
import { World } from "./engine/world.js";
import { MarsScene } from "./engine/scene.js";
import { Astronaut } from "./engine/astronaut.js";
import { buildHabitat, buildRover, buildShelter } from "./engine/props.js";
import { buildMarsRover } from "./engine/marsrover.js";
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
  astro.tryLoadModel();
  const game = new Game(data, world, (x, z) => scene.heightAt(x, z), scene.colliders);
  const path = new Pathfinder(world);
  const alerts = new AlertSystem(data.alerts, game);
  const geo = new GeoFrame(data.region);
  const hud = new Hud(game, world, data, geo);
  const atlas = new Atlas({ game, world, geo, data });
  atlas.onClose = () => canvas.focus();
  const applyProfile = (p) => { game.setProfile(p); astro.root.scale.setScalar(p.height / 175); };
  applyProfile(loadProfile());
  const profile = new ProfileScreen(game.o2CapacityG);
  const openAtlas = (where) => { atlas.open(where); controls.unlock(); };
  const controls = new Controls(canvas);
  const car = buildMarsRover(scene);
  // planetas en el cielo: posiciones reales de hoy vistas desde Gale (engine/planets.js). P = etiquetas
  const sky = new SkyPlanets(scene.scene, (p, m) => `${t(p.name)}${p.id === "earth" ? " + " + t({ es: "Luna", en: "Moon" }) : ""}  ${m.toFixed(1).replace(".", getLang() === "es" ? "," : ".")}`);
  const skyTau = () => 0.6 + 4 * (scene.storm || 0);           // opacidad tipica del polvo en Gale ~0,5-0,8
  // leyenda de la portada: que planetas hay hoy en el cielo de Gale
  const skyCaption = () => {
    const eph = sky.ephemeris(), lang = getLang();
    const vis = eph.planets.filter((p) => ["venus", "earth", "jupiter", "saturn", "mercury"].includes(p.id) && p.mag < 5.5 && p.elong > 12);
    const name = (p) => `<b>${t(p.name)}</b> (m ${p.mag.toFixed(1).replace(".", lang === "es" ? "," : ".")}, ${Math.round(p.elong)}° ${t({ es: "del Sol", en: "from the Sun" })}, ${t(p.evening ? { es: "al anochecer", en: "at dusk" } : { es: "al amanecer", en: "at dawn" })})`;
    $("skyCaption").innerHTML = `<div class="ttl">${t({ es: "Cielo real de hoy desde Gale", en: "Today's real sky from Gale" })}</div>${vis.map(name).join(" · ")}. ${t({ es: "Neptuno no se ve sin telescopio. Pulsa P en la EVA para ocultar las etiquetas.", en: "Neptune needs a telescope. Press P during the EVA to hide the labels." })}`;
  };
  const updateSky = (hour) => sky.update(scene.camera, hour, scene.skyMat.uniforms.uDay.value, skyTau(), innerHeight);
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
  const updateBeacons = () => {
    const tg = game.target;
    for (const [id, b] of Object.entries(beacons)) {
      const o = game.objectives[id];
      const isT = tg && id === tg.id;
      const done = o.type === "science" && game.missions.findIndex((m) => m.objective_id === id) < game.s.missionIndex;
      scene.setBeacon(b, { visible: !!(isT || o.shelter || (!done && o.type === "science")), target: !!isT, shelter: !!o.shelter });
    }
  };

  // ---- idioma y pantallas ----------------------------------------------------------
  const toggleLang = () => { setLang(getLang() === "es" ? "en" : "es"); hud.applyLang(); atlas.applyLang(); skyCaption(); if (game.s.phase === "briefing") showBriefing(); };
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
    $("briefChips").innerHTML = `
      <span class="chip danger"><svg><use href="#${hazardIcon}"/></svg>${ui("hazard")}: ${ui("hazards." + m.hazard_main)}</span>
      <span class="chip"><svg><use href="#i-layers"/></svg>${ui("layerHint")}: <kbd>${keyOf[m.layer_hint] || "R"}</kbd> ${ui("layers." + (m.layer_hint || "route"))}</span>
      <span class="chip"><svg><use href="#i-target"/></svg>${(d / 1000).toFixed(1).replace(".", ",")} km · ${climb >= 0 ? "+" : ""}${climb} m</span>
      <span class="chip safe"><svg><use href="#i-shelter"/></svg>${ui("shelterNear")}: ${t(sh.name)}</span>`;
    show("scrBriefing");
    show("hud");
    controls.unlock();
  }

  game.on("mission", () => { hud.clearAlerts(); updateBeacons(); showBriefing(); });
  game.on("layer", (l) => { scene.setOverlay(l); hud.setLayer(l); });
  game.on("route", (on) => { scene.setRouteVisible(on); hud.setRoute(on); lastRoute = -99; });
  game.on("suggestLayer", (l) => { if (!game.s.layer && game.s.missionIndex > 0) game.setLayer(l); });
  game.on("shelter", (o) => { const d = game.dialogs[o.id === "rover" ? "d_shelter_rover" : "d_shelter_habitat"]; if (d) hud.dialogQueue.push(d); });
  game.on("spe", (sp) => { if (sp.phase === "warning") { sfx.klaxon(); if (game.s.layer !== "radiation") game.setLayer("radiation"); game.setRoute(true); } updateBeacons(); });
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
  $("btnStart").onclick = () => {
    initAudio();
    show("scrTitle", false);
    profile.open();
  };
  profile.onBack = () => show("scrTitle");
  profile.onConfirm = (p) => {
    applyProfile(p);
    game.reset();
    controls.enabled = true;
    game.startMission(0);
  };
  $("btnAtlas").onclick = () => openAtlas("global");
  $("minimap").onclick = () => openAtlas("eva");
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && atlas.isOpen && game.s.phase !== "playing") atlas.close(); });
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
    if (wasLocked && !locked && game.s.phase === "playing" && !atlas.isOpen) setPaused(true);
    wasLocked = locked;
  });
  controls.on("key", (k, e) => {
    if (atlas.isOpen) { if (k === "escape" || k === "m") atlas.close(); return; }
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
    if (DEBUG) {
      if (k === "t") game.triggerStorm();
      if (k === "n") { const o = game.target; game.s.x = o.world.x + 25; game.s.z = o.world.z + 25; game.s.y = null; }
      if (k === "k") { game.s.oxygen = 100; game.s.energy = 100; game.s.integrity = 100; }
    }
  });
  if (DEBUG) show("fps");

  // ---- bucle ------------------------------------------------------------------------
  let last = performance.now(), acc = 0, lastRoute = -99, frames = 0, fpsT = 0;
  const titleCenter = game.objectives.habitat.world;
  const TITLE_HOUR = 17.82, titleDir = new THREE_V();
  function frame(nowMs) {
    const dt = Math.min(0.1, (nowMs - last) / 1000);
    last = nowMs;
    const now = nowMs / 1000;
    const s = game.s;

    if (s.phase === "title") {
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
      if (s.phase === "playing" && !paused && $("scrGuide").hidden && !atlas.isOpen) {
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
      controls.updateCamera(scene.camera, { x: s.x, y: y + (s.driving ? 0.6 : 0), z: s.z }, (x, z) => scene.heightAt(x, z));
      hud.camYaw = controls.yaw;
      scene.setTimeOfDay(game.hour);
      updateSky(game.hour);
      scene.setFocus(s.x, y, s.z);
      // ruta sugerida (A*) recalculada cada 1,5 s
      if (s.routeOn && now - lastRoute > 1.5) {
        lastRoute = now;
        const tg = game.target;
        const r = tg ? path.find(s.x, s.z, tg.world.x, tg.world.z) : null;
        if (r) { scene.setRoute(r); hud.minimap.setRoute(r); }
      }
      scene.setRouteVisible(s.routeOn);
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
  window.__msm = { game, scene, world, path, controls, atlas, geo, car, astro, sky }; // para depurar desde la consola
}

boot().catch((e) => {
  console.error(e);
  $("loadText").textContent = "Error: " + e.message;
});
