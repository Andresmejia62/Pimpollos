import { loadAll } from "./data.js";
import { t, ui, getLang, setLang } from "./i18n.js";
import { World } from "./engine/world.js";
import { MarsScene } from "./engine/scene.js";
import { Astronaut } from "./engine/astronaut.js";
import { buildHabitat, buildRover, buildShelter } from "./engine/props.js";
import { Controls } from "./engine/controls.js";
import { Game } from "./gameplay/game.js";
import { AlertSystem } from "./gameplay/alerts.js";
import { Pathfinder } from "./gameplay/pathfinding.js";
import { Hud } from "./ui/hud.js";
import { initAudio, sfx, setWind } from "./audio.js";

const $ = (id) => document.getElementById(id);
const DEBUG = new URLSearchParams(location.search).has("debug");
const show = (id, on = true) => { $(id).hidden = !on; };

async function boot() {
  setLang(getLang());
  $("loadText").textContent = ui("loading");
  const data = await loadAll((p) => { $("loadBar").style.width = Math.round(p * 70) + "%"; });
  const world = new World(data);
  const canvas = $("view");
  const scene = new MarsScene(canvas, world, data);
  await scene.init((p) => { $("loadBar").style.width = Math.round(70 + p * 30) + "%"; });

  const astro = new Astronaut(scene.scene);
  astro.tryLoadModel();
  const game = new Game(data, world, (x, z) => scene.heightAt(x, z));
  const path = new Pathfinder(world);
  const alerts = new AlertSystem(data.alerts, game);
  const hud = new Hud(game, world, data);
  const controls = new Controls(canvas);

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
  const toggleLang = () => { setLang(getLang() === "es" ? "en" : "es"); hud.applyLang(); if (game.s.phase === "briefing") showBriefing(); };
  hud.applyLang();
  show("scrLoading", false);
  show("scrTitle");

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
  game.on("scanComplete", ({ mission, objective, fact }) => {
    sfx.success();
    controls.unlock();
    $("cardPts").textContent = "+" + mission.points;
    $("cardTitle").textContent = t(objective.name);
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
  $("btnStart").onclick = () => {
    initAudio();
    show("scrTitle", false);
    controls.enabled = true;
    game.startMission(0);
  };
  $("btnBegin").onclick = () => {
    show("scrBriefing", false);
    game.beginMission();
    canvas.focus();
  };
  $("btnCardContinue").onclick = () => { show("scrCard", false); game.continueAfterCard(); };
  $("btnLang").onclick = toggleLang;
  $("btnPauseLang").onclick = toggleLang;
  $("btnGuide").onclick = () => show("scrGuide");
  $("btnPauseGuide").onclick = () => show("scrGuide");
  $("btnGuideClose").onclick = () => show("scrGuide", false);
  let paused = false;
  const setPaused = (p) => { paused = p; show("scrPause", p); };
  $("btnResume").onclick = () => setPaused(false);
  document.querySelectorAll("#layerbar button").forEach((b) => {
    b.onclick = () => (b.dataset.layer === "route" ? game.setRoute() : game.setLayer(b.dataset.layer));
  });

  let wasLocked = false;
  controls.on("lock", (locked) => {
    if (wasLocked && !locked && game.s.phase === "playing") setPaused(true);
    wasLocked = locked;
  });
  controls.on("key", (k, e) => {
    if (game.s.phase !== "playing") return;
    if (k === "escape") { setPaused(!paused); return; }
    if (paused) return;
    const map = { 1: "slope", 2: "radiation", 3: "thermal", 4: "spectral" };
    if (map[k]) game.setLayer(map[k]);
    if (k === "r") game.setRoute();
    if (k === "h") show("scrGuide", $("scrGuide").hidden);
    if (k === "m") $("minimapPanel").classList.toggle("big");
    if (DEBUG) {
      if (k === "t") game.triggerStorm();
      if (k === "n") { const o = game.target; game.s.x = o.world.x + 25; game.s.z = o.world.z + 25; }
      if (k === "k") { game.s.oxygen = 100; game.s.energy = 100; game.s.integrity = 100; }
    }
  });
  if (DEBUG) show("fps");

  // ---- bucle ------------------------------------------------------------------------
  let last = performance.now(), acc = 0, lastRoute = -99, frames = 0, fpsT = 0;
  const titleCenter = game.objectives.habitat.world;
  function frame(nowMs) {
    const dt = Math.min(0.1, (nowMs - last) / 1000);
    last = nowMs;
    const now = nowMs / 1000;
    const s = game.s;

    if (s.phase === "title") {
      // vista lenta del Monte Sharp desde el habitat
      const a = now * 0.03;
      const cx = titleCenter.x + Math.sin(a) * 140, cz = titleCenter.z - 60 + Math.cos(a) * 40;
      scene.camera.position.set(cx, scene.heightAt(cx, cz) + 45, cz);
      scene.camera.lookAt(titleCenter.x + 200, titleCenter.y + 120, titleCenter.z + 2500);
      scene.setTimeOfDay(9.5);
      scene.setFocus(cx, scene.heightAt(cx, cz), cz);
    } else {
      if (s.phase === "playing" && !paused && $("scrGuide").hidden) {
        game.update(dt, controls.moveVector());
        acc += dt;
        if (acc > 0.25) { acc = 0; alerts.check(now); }
      }
      const y = scene.heightAt(s.x, s.z);
      astro.update(dt, s.speed, s.x, y, s.z, s.heading);
      controls.updateCamera(scene.camera, { x: s.x, y, z: s.z }, (x, z) => scene.heightAt(x, z));
      hud.camYaw = controls.yaw;
      scene.setTimeOfDay(game.hour);
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
    scene.render(now, dt);
    if (DEBUG) {
      frames++; fpsT += dt;
      if (fpsT > 0.5) { $("fps").textContent = `${Math.round(frames / fpsT)} fps · x ${s.x.toFixed(0)} z ${s.z.toFixed(0)}`; frames = 0; fpsT = 0; }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__msm = { game, scene, world, path, controls }; // para depurar desde la consola
}

boot().catch((e) => {
  console.error(e);
  $("loadText").textContent = "Error: " + e.message;
});
