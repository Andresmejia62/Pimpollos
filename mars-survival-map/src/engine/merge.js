import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Fusion de geometria estatica: cada estructura esta hecha de cientos de primitivas (cajas, cilindros...) y cada
// una era una llamada de dibujo, tambien en el mapa de sombras. Aqui se juntan, dentro de cada estructura, todas
// las mallas que comparten material (y modo de sombra), en una sola malla por material.
//  - Las mallas originales se quedan donde estaban pero en la capa PROXY_LAYER: no se dibujan ni dan sombra,
//    y siguen sirviendo para que la camara no atraviese paredes (controls.js lanza el rayo tambien a esa capa).
//  - Lo que se anima (antenas que giran, el dron...) se marca con userData.dynamic y no se toca.
//  - Los materiales se comparten: los parpadeos y luces que cambian el material siguen funcionando.
export const PROXY_LAYER = 31;

const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4();

function mergeable(o) {
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return false;
  if (Array.isArray(o.material) || !o.material) return false;
  const g = o.geometry;
  if (!g || !g.attributes.position || Object.keys(g.morphAttributes || {}).length) return false;
  // (los grupos de una BoxGeometry -uno por cara- no importan con un solo material)
  if (o.layers.mask !== 1 || !o.visible) return false;
  return true;
}

function signature(g) { return Object.keys(g.attributes).filter((k) => k === "position" || k === "normal" || k === "uv").sort().join(","); }

// Copia de la geometria en el espacio de `root`, con solo posicion/normal/uv e indexada
function prepared(o, rootInv, local = null) {
  const src = o.geometry;
  const g = new THREE.BufferGeometry();
  for (const k of ["position", "normal", "uv"]) if (src.attributes[k]) g.setAttribute(k, src.attributes[k].clone());
  if (src.index) g.setIndex(src.index.clone());
  else {
    const n = src.attributes.position.count, idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  if (local) _m.copy(local); else _m.multiplyMatrices(rootInv, o.matrixWorld);
  g.applyMatrix4(_m);
  // una escala negativa invierte el orden de los vertices: se corrige para que las caras sigan mirando fuera
  if (_m.determinant() < 0) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
  }
  return g;
}

// Devuelve { before, after }: mallas dibujables antes y despues
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const buckets = new Map();
  let before = 0;
  const visit = (o, dyn) => {
    if (o.userData.dynamic) dyn = true;
    if (o.isMesh && o.visible) before++;
    if (!dyn && mergeable(o)) {
      const raycastable = !Object.prototype.hasOwnProperty.call(o, "raycast");
      const key = [o.material.uuid, o.castShadow, o.receiveShadow, raycastable, o.renderOrder, o.frustumCulled, signature(o.geometry)].join("|");
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { mat: o.material, list: [], o }));
      b.list.push(o);
    }
    for (const c of o.children) visit(c, dyn);
  };
  visit(root, false);
  let removed = 0, added = 0;
  for (const b of buckets.values()) {
    if (b.list.length < 2) continue;
    const geos = b.list.map((o) => prepared(o, _inv));
    let merged = null;
    try { merged = mergeGeometries(geos, false); } catch (e) { merged = null; }
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.o.castShadow; mesh.receiveShadow = b.o.receiveShadow;
    mesh.renderOrder = b.o.renderOrder; mesh.frustumCulled = b.o.frustumCulled;
    mesh.raycast = () => {};                      // los rayos de la camara usan las mallas originales (proxies)
    mesh.userData.merged = true;
    root.add(mesh);
    added++;
    for (const o of b.list) { o.layers.set(PROXY_LAYER); o.userData.proxy = true; o.matrixAutoUpdate = false; removed++; }
  }
  return { before, after: before - removed + added };
}

// Objetos animados (rover, astronautas): se detecta que nodos cambian de transformacion ejecutando su animacion
// unos fotogramas (step(i)); esos nodos se marcan userData.animated.
export function markAnimated(root, step, frames = 8) {
  const nodes = [];
  root.traverse((o) => nodes.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  for (let i = 0; i < frames; i++) step(i);
  for (const [o, p, q, sc] of nodes) {
    if (o === root) continue;
    if (p.distanceToSquared(o.position) > 1e-10 || Math.abs(q.dot(o.quaternion)) < 1 - 1e-7 || sc.distanceToSquared(o.scale) > 1e-10) o.userData.animated = true;
  }
}

// Fusiona, dentro de cada nodo, los hijos directos que no se mueven respecto a el (mismo material). Sirve para
// objetos animados: las piezas que se mueven juntas pasan a ser una llamada de dibujo. Ademas, las piezas
// pequenas (< minShadow m) dejan de proyectar sombra: en el mapa de sombras no se distinguen.
export function mergeChildren(root, { minShadow = 0.14 } = {}) {
  root.updateMatrixWorld(true);
  let before = 0, removed = 0, added = 0;
  const parents = [];
  root.traverse((o) => { if (o.isMesh && o.visible) before++; if (o.children.length) parents.push(o); });
  for (const P of parents) {
    const buckets = new Map();
    for (const c of P.children) {
      if (c.userData.animated || c.userData.dynamic || !mergeable(c)) continue;
      const raycastable = !Object.prototype.hasOwnProperty.call(c, "raycast");
      const key = [c.material.uuid, c.castShadow, c.receiveShadow, raycastable, c.renderOrder, c.frustumCulled, signature(c.geometry)].join("|");
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { list: [], o: c }));
      b.list.push(c);
    }
    for (const b of buckets.values()) {
      if (b.list.length < 2) continue;
      const geos = b.list.map((c) => { c.updateMatrix(); return prepared(c, null, c.matrix); });
      let merged = null;
      try { merged = mergeGeometries(geos, false); } catch (e) { merged = null; }
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.o.material);
      mesh.castShadow = b.o.castShadow; mesh.receiveShadow = b.o.receiveShadow; mesh.renderOrder = b.o.renderOrder;
      mesh.userData.merged = true;
      P.add(mesh);
      added++;
      for (const c of b.list) { c.layers.set(PROXY_LAYER); c.userData.proxy = true; removed++; }
    }
  }
  // sombras solo de las piezas grandes
  const sc = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.castShadow || o.layers.mask !== 1) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    o.getWorldScale(sc);
    if (o.geometry.boundingSphere.radius * Math.max(sc.x, sc.y, sc.z) < minShadow) o.castShadow = false;
  });
  return { before, after: before - removed + added };
}
