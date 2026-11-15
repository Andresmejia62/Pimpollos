import * as THREE from "three";
import { MARS } from "./physics.js";
import { UP, std, glow, at, box, cyl, ball, castAll } from "./props.js";

// Rover marciano conducible, inspirado en la arquitectura de Curiosity/Perseverance (NASA/JPL):
//  - 6 ruedas de aluminio con garras (grousers) y radios flexibles; las 4 de las esquinas giran.
//  - Suspension rocker-bogie: cada rueda sigue el terreno y las barras se reacomodan en tiempo real.
//  - Mastil de teledeteccion (camara tipo SuperCam + par de camaras estereo tipo Mastcam-Z y navcams).
//  - Brazo robotico de 5 articulaciones plegado al frente, con torreta de taladro.
//  - Generador termoelectrico de radioisotopos (MMRTG) con aletas en la parte trasera.
//  - Antena de alta ganancia hexagonal y antena UHF.
// Escala ampliada para llevar a un astronauta (~3,9 m de largo); convencion de props.js: mira hacia -Z.
export const MARS_ROVER = { wheelR: 0.42, track: 1.25, axles: [-1.45, 0.05, 1.45] };

const M = {
  white: std("#e9e7e2", 0.62, 0.05),
  white2: std("#cfccc5", 0.7, 0.1),
  frame: std("#3c3f45", 0.55, 0.6),
  dark: std("#1f2125", 0.8, 0.3),
  alu: std("#a9adb3", 0.38, 0.85),
  grouser: std("#8d9197", 0.45, 0.8),
  copper: std("#b8642e", 0.5, 0.45),
  gold: std("#c9a24a", 0.35, 0.8),
  fin: std("#2c2e33", 0.6, 0.5),
  lens: std("#0c1116", 0.08, 0.6, { emissive: "#0d2533", emissiveIntensity: 0.6 }),
  lensRim: std("#6c7078", 0.35, 0.9),
  hubIn: std("#5d6167", 0.5, 0.7),
};

// Rueda tipo Perseverance: llanta de aluminio con 48 garras curvas y radios flexibles de titanio
function roverWheel(r, w) {
  const root = new THREE.Group(), steer = new THREE.Group(), spin = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 32, 1, true), M.alu);
  rim.rotation.z = Math.PI / 2;
  rim.material.side = THREE.DoubleSide;
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.95, w * 0.98, 24), M.hubIn);
  inner.rotation.z = Math.PI / 2;
  spin.add(rim, inner);
  // garras: dos medias garras inclinadas forman un chevron
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    for (const s of [-1, 1]) {
      const g = box(w * 0.52, r * 0.07, r * 0.045, M.grouser, s * w * 0.24, Math.cos(a) * r * 1.02, Math.sin(a) * r * 1.02);
      g.rotation.x = a;
      g.rotation.y = s * 0.28;
      spin.add(g);
    }
  }
  // cara exterior: buje y radios curvos
  const face = new THREE.Group();
  face.position.x = w * 0.5;
  face.add(cyl(r * 0.24, r * 0.24, 0.05, M.frame, 0, 0, 0, 16).rotateZ(Math.PI / 2));
  const lip = new THREE.Mesh(new THREE.TorusGeometry(r * 0.97, 0.018, 6, 32), M.alu);
  lip.rotation.y = Math.PI / 2;
  face.add(lip);
  face.add(cyl(r * 0.1, r * 0.1, 0.09, M.alu, 0, 0, 0, 10).rotateZ(Math.PI / 2));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    for (const [f, len, off] of [[0.42, r * 0.42, 0.18], [0.75, r * 0.34, -0.25]]) {
      const sp = box(0.03, len, 0.035, M.alu, 0, Math.cos(a + off) * r * f, Math.sin(a + off) * r * f);
      sp.rotation.x = -(a + off);
      face.add(sp);
    }
  }
  spin.add(face);
  const face2 = face.clone();
  face2.position.x = -w * 0.5;
  spin.add(face2);
  steer.add(spin);
  root.add(steer);
  return { root, steer, spin };
}

// Cilindro de longitud 1 orientado entre dos puntos (barras de la suspension)
const segGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
function strut(radius, mat) { const m = new THREE.Mesh(segGeo, mat); m.scale.set(radius, 1, radius); m.castShadow = true; return m; }
const _d = new THREE.Vector3();
function placeStrut(m, a, b) {
  _d.subVectors(b, a);
  const len = _d.length();
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, _d.divideScalar(len || 1));
  m.scale.y = len;
}

export function buildMarsRover(ms) {
  const { wheelR: R, track: TX, axles: AZ } = MARS_ROVER;
  const root = new THREE.Group();          // posicion, rumbo e inclinacion media del terreno
  const body = new THREE.Group();          // caja electronica (WEB) y todo lo que va encima
  root.add(body);

  // ---- caja electronica caliente (WEB) y cubierta ----------------------------------
  body.add(box(1.86, 0.62, 2.7, M.white, 0, 1.38, 0.05));
  body.add(box(1.9, 0.06, 2.76, M.white2, 0, 1.72, 0.05));                    // cubierta
  body.add(box(1.7, 0.08, 0.5, M.dark, 0, 1.06, -0.9), box(1.7, 0.08, 0.5, M.dark, 0, 1.06, 0.9)); // vientre
  // franjas laterales oscuras, mantas termicas doradas y frente inclinado
  for (const sx of [-1, 1]) {
    body.add(box(0.02, 0.14, 2.6, M.frame, sx * 0.94, 1.15, 0.05), box(0.02, 0.22, 0.6, M.gold, sx * 0.94, 1.45, 0.75));
    for (const dz of [-0.9, -0.3, 0.3]) body.add(box(0.025, 0.3, 0.025, M.white2, sx * 0.94, 1.45, dz));
  }
  const brow = box(1.86, 0.2, 0.32, M.white, 0, 1.63, -1.36);
  brow.rotation.x = -0.6;
  body.add(brow);
  // bandas oscuras y paneles de la cara frontal (hazcams y tapas)
  body.add(box(1.88, 0.08, 0.04, M.dark, 0, 1.22, -1.31));
  for (const sx of [-0.55, -0.35, 0.35, 0.55]) {
    body.add(box(0.13, 0.08, 0.05, M.frame, sx, 1.14, -1.32), ball(0.032, M.lens, sx, 1.14, -1.35, 8));
  }
  body.add(box(0.5, 0.18, 0.04, M.white2, -0.2, 1.48, -1.32), box(0.3, 0.1, 0.03, M.gold, 0.45, 1.5, -1.32));
  // instrumentos y cajas sobre la cubierta (sistema de muestras, MEDA, MOXIE)
  body.add(box(0.7, 0.24, 0.55, M.white2, -0.42, 1.87, -0.25), box(0.4, 0.3, 0.4, M.gold, 0.35, 1.9, -0.05));
  body.add(box(0.55, 0.16, 0.7, M.frame, 0.05, 1.83, 0.55), cyl(0.12, 0.12, 0.5, M.white, -0.55, 1.88, 0.45, 12).rotateX(Math.PI / 2));
  for (let i = 0; i < 5; i++) body.add(box(1.5, 0.03, 0.03, M.frame, 0, 1.79, -0.95 + i * 0.12));  // cableado (tren de tubos)
  // barra diferencial que une los dos balancines por encima de la cubierta
  body.add(box(1.95, 0.07, 0.09, M.frame, 0, 1.8, -0.25));
  for (const sx of [-1, 1]) body.add(cyl(0.035, 0.035, 0.32, M.frame, sx * 0.95, 1.63, -0.25, 8));

  // ---- MMRTG con aletas en la parte trasera -----------------------------------------
  const rtg = new THREE.Group();
  rtg.position.set(0, 1.62, 1.55);
  rtg.rotation.x = -0.7;
  rtg.add(cyl(0.24, 0.24, 0.72, M.fin, 0, 0, 0, 16));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const f = box(0.04, 0.68, 0.22, M.fin, Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32);
    f.rotation.y = -a;
    rtg.add(f);
  }
  rtg.add(cyl(0.26, 0.26, 0.05, M.dark, 0, 0.37, 0, 16), cyl(0.26, 0.26, 0.05, M.dark, 0, -0.37, 0, 16));
  body.add(rtg, box(0.6, 0.1, 0.35, M.frame, 0, 1.5, 1.4));

  // ---- antenas: alta ganancia (hexagonal, orientable) y UHF ---------------------------
  const hgaBase = new THREE.Group();
  hgaBase.position.set(0.62, 1.9, 0.95);
  hgaBase.add(cyl(0.04, 0.05, 0.25, M.frame, 0, 0.0, 0, 8));
  const hga = new THREE.Group();
  hga.position.y = 0.2;
  hga.add(cyl(0.34, 0.34, 0.04, M.white2, 0, 0, 0, 6).rotateX(Math.PI / 2 - 0.5), box(0.12, 0.12, 0.1, M.frame, 0, -0.05, 0.05));
  hgaBase.add(hga);
  body.add(hgaBase);
  body.add(cyl(0.06, 0.06, 0.35, M.white2, -0.65, 1.95, 1.0, 10), ball(0.07, M.white2, -0.65, 2.13, 1.0, 10));

  // ---- mastil de teledeteccion (lado derecho delantero) -------------------------------
  const mastBase = new THREE.Group();
  mastBase.position.set(0.62, 1.75, -1.0);
  mastBase.add(cyl(0.085, 0.1, 1.35, M.white, 0, 0.67, 0, 12), cyl(0.12, 0.12, 0.14, M.copper, 0, 0.15, 0, 12), cyl(0.11, 0.11, 0.12, M.copper, 0, 1.2, 0, 12));
  mastBase.add(box(0.08, 0.5, 0.06, M.frame, 0.1, 0.75, 0.05), cyl(0.04, 0.04, 0.4, M.white2, -0.12, 0.9, 0, 8).rotateZ(Math.PI / 2)); // cables y brazo de MEDA
  const head = new THREE.Group();            // gira en azimut (pan)
  head.position.y = 1.4;
  head.scale.setScalar(1.3);
  const tilt = new THREE.Group();            // y en elevacion (tilt)
  tilt.position.y = 0.12;
  // camara grande tipo SuperCam: caja blanca con un lente redondo grande
  tilt.add(box(0.46, 0.3, 0.5, M.white, 0, 0.17, 0.02));
  tilt.add(cyl(0.11, 0.11, 0.04, M.lensRim, 0, 0.17, -0.24, 20).rotateX(Math.PI / 2), cyl(0.085, 0.085, 0.05, M.lens, 0, 0.17, -0.25, 20).rotateX(Math.PI / 2));
  // par estereo tipo Mastcam-Z y navcams, debajo
  tilt.add(box(0.62, 0.13, 0.16, M.frame, 0, -0.05, -0.12));
  for (const sx of [-0.2, 0.2]) tilt.add(box(0.13, 0.11, 0.14, M.dark, sx, -0.05, -0.17), cyl(0.035, 0.035, 0.05, M.lens, sx, -0.05, -0.25, 12).rotateX(Math.PI / 2));
  for (const sx of [-0.29, 0.29]) tilt.add(box(0.06, 0.06, 0.08, M.dark, sx, 0.05, -0.17), ball(0.02, M.lens, sx, 0.05, -0.22, 8));
  const statusLed = glow("#ff4d4d", 1.5);
  tilt.add(ball(0.025, statusLed, 0.2, 0.34, 0.15, 8));
  head.add(cyl(0.07, 0.07, 0.14, M.copper, 0, 0.0, 0, 12), tilt);
  mastBase.add(head);
  body.add(mastBase);

  // ---- brazo robotico plegado al frente con torreta de taladro --------------------------
  const arm = { shoulder: new THREE.Vector3(-0.62, 1.32, -1.42), elbow: new THREE.Vector3(-0.78, 0.72, -1.9), wrist: new THREE.Vector3(-0.6, 1.95, -2.02) };
  const upper = strut(0.065, M.white2), fore = strut(0.06, M.white2);
  placeStrut(upper, arm.shoulder, arm.elbow); placeStrut(fore, arm.elbow, arm.wrist);
  body.add(upper, fore);
  for (const p of [arm.shoulder, arm.elbow, arm.wrist]) body.add(at(cyl(0.11, 0.11, 0.16, M.copper, 0, 0, 0, 14).rotateZ(Math.PI / 2), p.x, p.y, p.z));
  for (const [a, b] of [[arm.shoulder, arm.elbow], [arm.elbow, arm.wrist]]) {
    const band = strut(0.07, M.copper);
    const mid = a.clone().lerp(b, 0.45), mid2 = a.clone().lerp(b, 0.62);
    placeStrut(band, mid, mid2);
    body.add(band);
  }
  const turret = new THREE.Group();
  turret.position.copy(arm.wrist).add(new THREE.Vector3(0.05, 0.2, -0.05));
  turret.scale.setScalar(1.25);
  turret.add(box(0.34, 0.34, 0.34, M.frame, 0, 0, 0), box(0.26, 0.24, 0.18, M.white, 0.24, 0.05, 0));                 // cuerpo y camara WATSON/PIXL
  turret.add(cyl(0.05, 0.05, 0.42, M.alu, 0, 0, -0.34, 10).rotateX(Math.PI / 2), cyl(0.02, 0.02, 0.18, M.dark, 0, 0, -0.62, 8).rotateX(Math.PI / 2)); // taladro
  turret.add(cyl(0.08, 0.08, 0.2, M.dark, -0.26, 0, 0, 12).rotateZ(Math.PI / 2), cyl(0.06, 0.06, 0.16, M.dark, 0, -0.27, 0, 12));
  for (const [x, y] of [[0.1, 0.1], [-0.1, 0.1], [0.1, -0.1], [-0.1, -0.1]]) turret.add(cyl(0.015, 0.015, 0.16, M.alu, x, y, -0.24, 6).rotateX(Math.PI / 2));
  body.add(turret);

  // ---- ruedas y suspension rocker-bogie ---------------------------------------------
  const wheels = [];
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
    const wh = roverWheel(R, 0.34);
    wh.side = sx; wh.i = i; wh.steerable = i !== 1; wh.off = 0;
    wh.root.position.set(sx * TX, R, AZ[i]);
    if (sx < 0) wh.root.rotation.y = Math.PI;               // la cara con radios hacia fuera en ambos lados
    root.add(wh.root);
    // carcasa del actuador de direccion encima de cada rueda
    wh.cap = cyl(0.09, 0.09, 0.2, M.frame, 0, 0, 0, 10);
    root.add(wh.cap);
    wheels.push(wh);
  }
  const legs = [];
  const P = { knee: [], hub: [], diff: [], bogie: [] };
  for (const sx of [-1, 1]) {
    const L = { sx, rockerF: strut(0.055, M.frame), rockerB: strut(0.055, M.frame), bogieF: strut(0.05, M.frame), bogieB: strut(0.05, M.frame), drops: [0, 1, 2].map(() => strut(0.045, M.frame)) };
    root.add(L.rockerF, L.rockerB, L.bogieF, L.bogieB, ...L.drops);
    L.diffJoint = cyl(0.1, 0.1, 0.16, M.copper, 0, 0, 0, 12).rotateZ(Math.PI / 2);
    L.bogieJoint = cyl(0.08, 0.08, 0.14, M.frame, 0, 0, 0, 12).rotateZ(Math.PI / 2);
    root.add(L.diffJoint, L.bogieJoint);
    legs.push(L);
  }
  const V = () => new THREE.Vector3();
  const tmp = { hub: [V(), V(), V()], knee: [V(), V(), V()], diff: V(), bogie: V() };

  castAll(root);
  ms.scene.add(root);

  // ---- estela de polvo (particulas recicladas) ----------------------------------------
  const N = 72;
  const dPos = new Float32Array(N * 3), dAge = new Float32Array(N).fill(1), dVel = new Float32Array(N * 3);
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));
  dGeo.setAttribute("aAge", new THREE.BufferAttribute(dAge, 1));
  const dMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uScale: ms.dustMat.uniforms.uScale, uColor: { value: ms.fogColor } },
    vertexShader: /* glsl */ `
      uniform float uScale; attribute float aAge; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (0.7 + 2.6 * aAge) / max(-mv.z, 0.5);
        vA = aAge >= 1.0 ? 0.0 : (1.0 - aAge) * smoothstep(0.0, 0.08, aAge);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying float vA;
      void main() {
        float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * vA * 0.4;
        gl_FragColor = vec4(uColor * 0.82, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dust = new THREE.Points(dGeo, dMat);
  dust.frustumCulled = false;
  dust.renderOrder = 4;
  ms.scene.add(dust);

  const st = { yaw: 0, init: false, spin: 0, steer: 0, n: new THREE.Vector3(0, 1, 0), next: 0, emit: 0, x: 0, z: 0, air: false, dip: 0, dipV: 0, vy: 0, y: 0, pan: 0 };
  const nTmp = new THREE.Vector3(), q = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), rear = new THREE.Vector3(), wp = new THREE.Vector3();
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  // Suspension: cada rueda busca el suelo bajo ella (relativo al plano medio) y las barras se recolocan
  function suspension(dt, flying) {
    root.updateMatrixWorld(true);
    for (const wh of wheels) {
      let target = 0;
      if (!flying) {
        wp.set(wh.side * TX, 0, AZ[wh.i]);
        root.localToWorld(wp);
        target = Math.max(-0.28, Math.min(0.28, ms.heightAt(wp.x, wp.z) - wp.y));
      }
      wh.off += (target - wh.off) * Math.min(1, dt * 12);
      wh.root.position.y = R + wh.off;
    }
    for (const L of legs) {
      const ws = wheels.filter((w) => w.side === L.sx);
      for (let i = 0; i < 3; i++) {
        const y = ws[i].root.position.y;
        tmp.hub[i].set(L.sx * TX, y, AZ[i]);
        tmp.knee[i].set(L.sx * (TX - 0.08), y + 0.42, AZ[i]);
        ws[i].cap.position.set(L.sx * TX, y + 0.3, AZ[i]);
        placeStrut(L.drops[i], tmp.hub[i], tmp.knee[i]);
      }
      // pivote del diferencial fijo en el costado de la caja; pivote del bogie entre las ruedas central y trasera
      tmp.diff.set(L.sx * 1.0, 1.32 + body.position.y, -0.25);
      tmp.bogie.set(L.sx * 1.12, (tmp.knee[1].y + tmp.knee[2].y) / 2 + 0.18, (AZ[1] + AZ[2]) / 2);
      placeStrut(L.rockerF, tmp.knee[0], tmp.diff);
      placeStrut(L.rockerB, tmp.diff, tmp.bogie);
      placeStrut(L.bogieF, tmp.bogie, tmp.knee[1]);
      placeStrut(L.bogieB, tmp.bogie, tmp.knee[2]);
      L.diffJoint.position.copy(tmp.diff);
      L.bogieJoint.position.copy(tmp.bogie);
    }
  }

  // y: altura de las ruedas (null = apoyado en el terreno); air: metros sobre el suelo
  function update(dt, x, z, heading, speed, time, y = null, air = 0) {
    const jumped = !st.init || Math.hypot(x - st.x, z - st.z) > 6;
    const ground = ms.heightAt(x, z);
    if (y == null) y = ground;
    const flying = air > 0.05;
    st.x = x; st.z = z;
    ms.normalAt(x, z, nTmp);
    const dh = wrap(heading - st.yaw);
    if (jumped) { st.yaw = heading; st.n.copy(nTmp); st.init = true; st.dip = st.dipV = 0; st.y = y; }
    else {
      st.yaw += dh * Math.min(1, dt * 6);
      if (!flying) st.n.lerp(nTmp, Math.min(1, dt * 6)).normalize();
    }
    const vy = dt > 0 ? (y - st.y) / dt : 0;
    if (st.air && !flying) st.dipV += Math.min(2.2, Math.max(0, -st.vy) * 0.35);
    st.air = flying; st.vy = vy; st.y = y;
    st.dipV += (-st.dip * 90 - st.dipV * 9) * dt;
    st.dip = Math.max(-0.05, Math.min(0.2, st.dip + st.dipV * dt));
    root.position.set(x, y, z);
    root.quaternion.copy(q.setFromUnitVectors(UP, st.n)).multiply(qYaw.setFromAxisAngle(UP, st.yaw));

    // ruedas: rodadura y direccion; las 4 esquinas giran en sentidos opuestos (giro de radio corto)
    const k = Math.min(1, speed / 8);
    st.spin -= ((speed * dt) / R) * (flying ? 0.4 : 1);
    st.steer += ((speed > 0.3 ? Math.max(-0.5, Math.min(0.5, dh * 1.6)) : 0) - st.steer) * Math.min(1, dt * 9);
    for (const wh of wheels) {
      wh.spin.rotation.x = wh.side < 0 ? -st.spin : st.spin;
      if (wh.steerable) wh.steer.rotation.y = (wh.i === 0 ? 1 : -1) * st.steer;
    }
    body.position.y = Math.sin(time * 9) * 0.008 * k - st.dip + (flying ? 0.05 : 0);
    body.rotation.z = -st.steer * 0.05 * k;
    suspension(dt, flying);

    // el mastil "mira" el terreno: barrido lento en reposo, al frente al conducir
    const panT = speed > 0.3 ? st.steer * 0.8 : Math.sin(time * 0.35) * 0.9;
    st.pan += (panT - st.pan) * Math.min(1, dt * 2);
    head.rotation.y = st.pan;
    tilt.rotation.x = speed > 0.3 ? -0.12 : -0.2 + Math.sin(time * 0.5) * 0.12;
    hga.rotation.y = Math.sin(time * 0.1) * 0.6;
    statusLed.emissiveIntensity = Math.sin(time * 4) > 0.7 ? 3 : 0.3;

    // polvo detras de las ruedas traseras
    st.emit += speed * dt;
    if (speed > 1.5 && st.emit > 0.8 && !flying) {
      st.emit = 0;
      for (const sx of [-TX, TX]) {
        const i = (st.next = (st.next + 1) % N);
        rear.set(sx, 0.12, AZ[2] + 0.35).applyQuaternion(root.quaternion).add(root.position);
        dPos[i * 3] = rear.x; dPos[i * 3 + 1] = rear.y; dPos[i * 3 + 2] = rear.z;
        dVel[i * 3] = (Math.random() - 0.5) * 1.2; dVel[i * 3 + 1] = 0.9 + Math.random() * 0.8; dVel[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
        dAge[i] = 0;
      }
    }
    for (let i = 0; i < N; i++) {
      if (dAge[i] >= 1) continue;
      dAge[i] = Math.min(1, dAge[i] + dt / 2.2);
      // polvo fino: como DustFX, tiende a la velocidad del viento y cae despacio
      const kk = Math.min(1, dt * 2.5);
      dVel[i * 3] += (2.2 - dVel[i * 3]) * kk; dVel[i * 3 + 2] += (0.9 - dVel[i * 3 + 2]) * kk; dVel[i * 3 + 1] += (-0.3 - dVel[i * 3 + 1]) * kk;
      dPos[i * 3] += dVel[i * 3] * dt; dPos[i * 3 + 1] += dVel[i * 3 + 1] * dt; dPos[i * 3 + 2] += dVel[i * 3 + 2] * dt;
    }
    dGeo.attributes.position.needsUpdate = true;
    dGeo.attributes.aAge.needsUpdate = true;
  }

  // ---- faros de navegacion nocturna (LED) ----------------------------------------------------
  // dos focos bajo la visera y una luz de trabajo; con luz de dia estan apagados. El numero de luces es fijo
  // (solo cambia la intensidad) para no recompilar los shaders al anochecer.
  const lampMat = new THREE.MeshStandardMaterial({ color: "#d9e6ff", emissive: "#cfe0ff", emissiveIntensity: 0, roughness: 0.3 });
  for (const sx of [-0.62, 0.62]) {
    body.add(box(0.26, 0.1, 0.06, M.frame, sx, 1.33, -1.34));
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.045, 12), lampMat);
    for (const dx of [-0.07, 0, 0.07]) { const c = l.clone(); c.position.set(sx + dx, 1.33, -1.375); c.rotation.y = Math.PI; body.add(c); }
  }
  const spot = new THREE.SpotLight("#e6eeff", 0, 70, 0.55, 0.55, 1.4);
  spot.position.set(0, 1.4, -1.4);
  spot.target.position.set(0, -1.2, -16);
  body.add(spot, spot.target);
  const workLight = new THREE.PointLight("#ffd9b0", 0, 9, 2);       // luz de trabajo alrededor del rover
  workLight.position.set(0, 2.4, 0.2);
  body.add(workLight);
  let lightsOn = 0;
  // night: 0 (dia) .. 1 (noche cerrada); dust: opacidad de la tormenta (tambien los enciende)
  function setLights(dt, night, dust = 0) {
    const want = Math.max(night > 0.35 ? 1 : 0, dust > 0.35 ? 0.8 : 0);
    lightsOn += (want - lightsOn) * Math.min(1, dt * 3);
    spot.intensity = 26 * lightsOn;
    workLight.intensity = 3 * lightsOn;
    lampMat.emissiveIntensity = 0.2 + 3.5 * lightsOn;
    spot.getWorldPosition(lampOut.pos);
    spot.target.getWorldPosition(lampOut.dir);
    lampOut.dir.sub(lampOut.pos).normalize();
    lampOut.k = lightsOn;
    return lampOut;
  }
  const lampOut = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), k: 0 };

  return { group: root, update, setLights };
}
