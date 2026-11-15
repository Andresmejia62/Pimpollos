// Topografia real del crater Gale (MGS MOLA, 64 pix/grado ~ 925 m/px) para el terreno lejano en 3D.
// Lee public/atlas/mola_gale.z (el mismo fichero del atlas; formato en data/scripts/build_atlas.mjs)
// y lo lleva al sistema del juego: x = Este, z = Sur (m desde el centro del recorte), y = elevacion - y_ref.
// Todo a escala 1:1, con la curvatura del planeta: a una distancia d el suelo "cae" d^2 / (2 R).

export const MARS_RADIUS_M = 3389500;       // radio medio de Marte
const D2R = Math.PI / 180;

// Desempaqueta la elevacion: dos planos de bytes (alto y bajo) con la diferencia en zigzag respecto al pixel de la izquierda
export function unpackElevation(bytes, w, h, q, offset) {
  const n = w * h;
  if (bytes.length < 2 * n) throw new Error("mola: datos incompletos");
  const elev = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    let prev = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const z = (bytes[i] << 8) | bytes[n + i];
      prev += z & 1 ? -((z + 1) >> 1) : z >> 1;
      elev[i] = prev * q - offset;
    }
  }
  return elev;
}

export class MolaGrid {
  // meta: una entrada de atlas.json -> rasters; region: region.json; yRef: layers.dem.y_ref_m
  constructor(meta, elev, region, yRef) {
    this.w = meta.w; this.h = meta.h; this.ppd = meta.ppd;
    this.latN = meta.lat_north; this.lonW = meta.lon_west;
    this.elev = elev;
    this.lat0 = region.center.lat; this.lon0 = region.center.lon_east;
    this.R = region.mars_radius_m;                      // esfera de la proyeccion del recorte
    this.cos0 = Math.cos(this.lat0 * D2R);
    this.half = region.size_m / 2;
    this.yRef = yRef;
  }

  // centro del pixel (col, fila) en coordenadas del mundo
  colX(c) { return (this.lonW + (c + 0.5) / this.ppd - this.lon0) * D2R * this.R * this.cos0; }
  rowZ(r) { return -(this.latN - (r + 0.5) / this.ppd - this.lat0) * D2R * this.R; }

  // elevacion MOLA (m sobre el areoide), bilineal
  elevationAt(x, z) {
    const c = (this.lon0 + x / (this.R * this.cos0) / D2R - this.lonW) * this.ppd - 0.5;
    const r = (this.latN - (this.lat0 - z / this.R / D2R)) * this.ppd - 0.5;
    const c0 = Math.min(this.w - 2, Math.max(0, Math.floor(c))), r0 = Math.min(this.h - 2, Math.max(0, Math.floor(r)));
    const fc = Math.min(1, Math.max(0, c - c0)), fr = Math.min(1, Math.max(0, r - r0));
    const i = r0 * this.w + c0, e = this.elev;
    return (e[i] * (1 - fc) + e[i + 1] * fc) * (1 - fr) + (e[i + this.w] * (1 - fc) + e[i + this.w + 1] * fc) * fr;
  }

  // metros que el suelo queda por debajo del plano del mapa por la curvatura de Marte (0 dentro del recorte)
  curvatureDrop(x, z) {
    const ox = Math.max(0, Math.abs(x) - this.half), oz = Math.max(0, Math.abs(z) - this.half);
    return (ox * ox + oz * oz) / (2 * MARS_RADIUS_M);
  }

  // altura en el mundo (y) del terreno lejano, con curvatura
  worldY(x, z) { return this.elevationAt(x, z) - this.yRef - this.curvatureDrop(x, z); }

  // Malla del crater completo: posiciones (x, y, z) e indices. No genera los triangulos que quedan por
  // entero bajo el faldon cercano (|x| y |z| < hole), que ya dibuja la escena principal.
  buildMesh(hole = 0) {
    const { w, h } = this;
    const pos = new Float32Array(w * h * 3);
    const xs = new Float64Array(w), zs = new Float64Array(h);
    for (let c = 0; c < w; c++) xs[c] = this.colX(c);
    for (let r = 0; r < h; r++) zs[r] = this.rowZ(r);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const i = (r * w + c) * 3, x = xs[c], z = zs[r];
      pos[i] = x; pos[i + 1] = this.elev[r * w + c] - this.yRef - this.curvatureDrop(x, z); pos[i + 2] = z;
    }
    const idx = [];
    const inHole = (c, r) => Math.abs(xs[c]) < hole && Math.abs(zs[r]) < hole;
    for (let r = 0; r < h - 1; r++) for (let c = 0; c < w - 1; c++) {
      if (hole && inHole(c, r) && inHole(c + 1, r) && inHole(c, r + 1) && inHole(c + 1, r + 1)) continue;
      const a = r * w + c, b = a + w, d = a + 1, e = b + 1;      // fila + 1 = sur (+z), columna + 1 = este (+x)
      idx.push(a, b, d, b, e, d);
    }
    return { positions: pos, indices: new Uint32Array(idx), radius: Math.max(Math.abs(xs[0]), Math.abs(xs[w - 1]), Math.abs(zs[0]), Math.abs(zs[h - 1])) };
  }
}

// Descarga y decodifica el recorte de Gale. `fetchUrl(p)` devuelve la URL de un fichero de public/.
export async function loadMolaGale(fetchUrl, region, yRef) {
  const meta = await fetch(fetchUrl("atlas/atlas.json")).then((r) => { if (!r.ok) throw new Error("atlas.json: " + r.status); return r.json(); });
  const raster = meta.rasters.find((x) => x.id === "gale");
  const res = await fetch(fetchUrl("atlas/" + raster.file));
  if (!res.ok) throw new Error(raster.file + ": " + res.status);
  const bytes = new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  return new MolaGrid(raster, unpackElevation(bytes, raster.w, raster.h, raster.q, meta.offset_m), region, yRef);
}
