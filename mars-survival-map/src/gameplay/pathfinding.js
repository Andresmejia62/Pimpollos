// Rutas sugeridas sobre la capa de costos de M3 (public/layers/grid.bin, plano "cost").
//
// Interpretacion verificada del plano (layers.json -> layers.binary.grid.decode y build_layers.py):
//   cost === 0  -> celda intransitable (pendiente > 25 grados, mas rocas/crateres y bordes anadidos al generar);
//   cost > 0    -> transitable, costo de recorrido = v / 25 (1 = terreno ideal).
// En los datos actuales, el 100 % de las celdas con pendiente > 25 grados tienen cost 0; cost 0 es el bloqueo
// autoritativo para rutas (superconjunto de world.blockedAt, que solo mira la pendiente).
//
// Estructura:
//  1) A* grueso (512x512, celda de 12 m) para encontrar un corredor global rapido. Regla estricta: una celda
//     gruesa se bloquea si CUALQUIER sub-celda fina lo esta; si asi no hay camino, regla permisiva (>= 50 %).
//  2) A* fino (1024x1024, celda de 6 m) restringido a un corredor alrededor del camino grueso. La cuadricula
//     permisiva solo elige el corredor: el A* fino NUNCA pisa una celda con cost === 0 ni corta esquinas
//     en diagonal entre dos celdas bloqueadas.
//  3) Suavizado validado: cada ajuste se comprueba con un trazado Supercover DDA sobre la cuadricula fina
//     (todas las celdas intersectadas por el segmento, incluyendo las adyacentes en cruces por vertice);
//     si un ajuste atraviesa bloqueo, se conserva el punto valido anterior.
//  4) Extremos: la conexion entre la posicion original y la celda abierta elegida (y entre la ultima celda y el
//     destino) se valida igual; si no existe conexion local sin atravesar bloqueos, find() devuelve null.
//
// Interfaz publica sin cambios: find(x0, z0, x1, z1) -> [[x, z], ...] | null.
export class Pathfinder {
  constructor(world, factor = 2) {
    this.world = world;
    this.f = factor;
    this.N = world.n / factor;
    this.n = world.n;                      // cuadricula fina (1024)
    this.fine = world.planes.cost;         // uint8: 0 = intransitable
    this.px = world.size / world.n;        // tamano de celda fina (6 m)
    const n = world.n, N = this.N, f = factor;
    const fine = this.fine;
    this.strict = new Float32Array(N * N);
    this.loose = new Float32Array(N * N);
    for (let R = 0; R < N; R++) {
      for (let C = 0; C < N; C++) {
        let sum = 0, cnt = 0, blocked = 0;
        for (let r = R * f; r < R * f + f; r++) {
          for (let c = C * f; c < C * f + f; c++) {
            const v = fine[r * n + c];
            if (v === 0) blocked++; else { sum += v; cnt++; }
          }
        }
        const mean = cnt ? sum / cnt / 25 : Infinity;
        this.strict[R * N + C] = blocked ? Infinity : mean;
        this.loose[R * N + C] = blocked * 2 >= f * f ? Infinity : mean;
      }
    }
    this.cost = this.strict;
    this.cell = world.size / N;
    // marcas del corredor fino (generacion para no limpiar 1 M de celdas en cada busqueda)
    this._corr = new Int32Array(n * n);
    this._gen = 0;
    // buffers del A* fino (se reservan al primer uso)
    this._fg = null;
  }

  toCell(x, z) {
    const N = this.N, h = this.world.half;
    return [Math.min(N - 1, Math.max(0, Math.floor((z + h) / this.cell))), Math.min(N - 1, Math.max(0, Math.floor((x + h) / this.cell)))];
  }
  toWorld(R, C) { const h = this.world.half; return [(C + 0.5) * this.cell - h, (R + 0.5) * this.cell - h]; }

  nearestOpen(R, C) {
    const N = this.N;
    if (this.cost[R * N + C] !== Infinity) return [R, C];
    for (let rad = 1; rad < 12; rad++) {
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
        const r = R + dr, c = C + dc;
        if (r >= 0 && c >= 0 && r < N && c < N && this.cost[r * N + c] !== Infinity) return [r, c];
      }
    }
    return [R, C];
  }

  // ---- cuadricula fina --------------------------------------------------------------------------
  fineCell(x, z) {
    const n = this.n, h = this.world.half;
    return [Math.min(n - 1, Math.max(0, Math.floor((z + h) / this.px))), Math.min(n - 1, Math.max(0, Math.floor((x + h) / this.px)))];
  }
  fineCenter(r, c) { const h = this.world.half; return [(c + 0.5) * this.px - h, (r + 0.5) * this.px - h]; }
  fineBlocked(r, c) {
    if (r < 0 || c < 0 || r >= this.n || c >= this.n) return true;
    return this.fine[r * this.n + c] === 0;
  }

  // Trazado Supercover DDA de (x0,z0) a (x1,z1) sobre la cuadricula fina: visita TODAS las celdas intersectadas
  // por el segmento y, en los cruces exactos por un vertice, tambien las dos celdas laterales (impide el corner
  // cutting diagonal entre dos bloqueos). visit(r, c) -> true corta el recorrido (celda bloqueada encontrada).
  // Devuelve true si algun visit devolvio true.
  supercover(x0, z0, x1, z1, visit) {
    const h = this.world.half, px = this.px;
    // coordenadas continuas de cuadricula: u = columna, w = fila
    let u0 = (x0 + h) / px, w0 = (z0 + h) / px;
    const u1 = (x1 + h) / px, w1 = (z1 + h) / px;
    let c = Math.floor(u0), r = Math.floor(w0);
    const c1 = Math.floor(u1), r1 = Math.floor(w1);
    if (visit(r, c)) return true;
    const du = u1 - u0, dw = w1 - w0;
    const stepC = du > 0 ? 1 : -1, stepR = dw > 0 ? 1 : -1;
    const adu = Math.abs(du), adw = Math.abs(dw);
    // t hasta el proximo borde de columna / fila (parametro del segmento en [0, 1])
    let tMaxC = adu < 1e-12 ? Infinity : ((stepC > 0 ? c + 1 - u0 : u0 - c) / adu);
    let tMaxR = adw < 1e-12 ? Infinity : ((stepR > 0 ? r + 1 - w0 : w0 - r) / adw);
    const tDC = adu < 1e-12 ? Infinity : 1 / adu;
    const tDR = adw < 1e-12 ? Infinity : 1 / adw;
    const EPS = 1e-9;
    let guard = 4 * this.n;
    while ((c !== c1 || r !== r1) && guard-- > 0) {
      if (Math.abs(tMaxC - tMaxR) < EPS) {
        // cruce exacto por un vertice: el segmento toca las dos celdas laterales ademas de la diagonal
        if (visit(r, c + stepC)) return true;
        if (visit(r + stepR, c)) return true;
        c += stepC; r += stepR;
        tMaxC += tDC; tMaxR += tDR;
      } else if (tMaxC < tMaxR) {
        c += stepC; tMaxC += tDC;
      } else {
        r += stepR; tMaxR += tDR;
      }
      if (visit(r, c)) return true;
      if (tMaxC > 1 + EPS && tMaxR > 1 + EPS && (c !== c1 || r !== r1)) break;   // redondeos: ya pasamos el final
    }
    return false;
  }

  // true si el segmento NO atraviesa ninguna celda fina bloqueada (skip: indices fila*n+col a ignorar,
  // p. ej. la celda sobre la que ya esta el jugador)
  segmentClear(x0, z0, x1, z1, skip = null) {
    const n = this.n;
    return !this.supercover(x0, z0, x1, z1, (r, c) => {
      if (r < 0 || c < 0 || r >= n || c >= n) return true;
      if (this.fine[r * n + c] !== 0) return false;
      return !(skip && skip.has(r * n + c));
    });
  }

  // Celda fina abierta mas cercana con conexion local valida desde (x, z) (sin atravesar bloqueos; la celda
  // donde esta el propio punto se tolera). Devuelve [r, c, skipSet] o null.
  _openNear(x, z, maxRad = 24) {
    const n = this.n;
    const [r0, c0] = this.fineCell(x, z);
    const skip = new Set([r0 * n + c0]);
    if (!this.fineBlocked(r0, c0)) return [r0, c0, skip];
    const cand = [];
    for (let rad = 1; rad <= maxRad; rad++) {
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const r = r0 + dr, c = c0 + dc;
        if (this.fineBlocked(r, c)) continue;
        cand.push([dr * dr + dc * dc, r, c]);
      }
      if (cand.length) {
        cand.sort((a, b) => a[0] - b[0]);
        for (const [, r, c] of cand) {
          const [cx, cz] = this.fineCenter(r, c);
          if (this.segmentClear(x, z, cx, cz, skip)) return [r, c, skip];
        }
        cand.length = 0;                       // en este radio ninguna tiene conexion limpia: ampliar
      }
    }
    return null;
  }

  // Devuelve una lista de puntos [x, z] desde (x0,z0) hasta (x1,z1), o null
  find(x0, z0, x1, z1) {
    const a = this._openNear(x0, z0), b = this._openNear(x1, z1);
    if (!a || !b) return null;
    const skip = new Set([...a[2], ...b[2]]);
    // atajo: linea directa sin bloqueos
    if (this.segmentClear(x0, z0, x1, z1, skip)) return [[x0, z0], [x1, z1]];
    this.cost = this.strict;
    const r = this._find(x0, z0, x1, z1, a, b, skip, 4);
    if (r) return r;
    this.cost = this.loose;
    const r2 = this._find(x0, z0, x1, z1, a, b, skip, 10);
    this.cost = this.strict;
    return r2;
  }

  _find(x0, z0, x1, z1, open0, open1, skip, margin) {
    const N = this.N, cost = this.cost;
    const [sr, sc] = this.nearestOpen(...this.toCell(x0, z0));
    const [gr, gc] = this.nearestOpen(...this.toCell(x1, z1));
    const start = sr * N + sc, goal = gr * N + gc;
    const g = new Float32Array(N * N).fill(Infinity);
    const came = new Int32Array(N * N).fill(-1);
    const closed = new Uint8Array(N * N);
    const heap = new MinHeap();
    const hfn = (i) => {
      const r = (i / N) | 0, c = i % N;
      const dr = Math.abs(r - gr), dc = Math.abs(c - gc);
      return (Math.max(dr, dc) + 0.4142 * Math.min(dr, dc)) * 1.0; // octil, costo minimo por celda = 1
    };
    g[start] = 0;
    heap.push(start, hfn(start));
    const D = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, 1.4142], [-1, 1, 1.4142], [1, -1, 1.4142], [1, 1, 1.4142]];
    let found = false, iter = 0;
    while (heap.size && iter++ < 600000) {
      const cur = heap.pop();
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const r = (cur / N) | 0, c = cur % N;
      for (const [dr, dc, w] of D) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= N || nc >= N) continue;
        const ni = nr * N + nc;
        const cc = cost[ni];
        if (cc === Infinity || closed[ni]) continue;
        // no cortar esquinas entre dos celdas bloqueadas
        if (dr && dc && (cost[r * N + nc] === Infinity || cost[nr * N + c] === Infinity)) continue;
        const ng = g[cur] + w * (cost[cur] + cc) * 0.5;
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = cur;
          heap.push(ni, ng + hfn(ni));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = goal; i !== -1; i = came[i]) cells.push(i);
    cells.reverse();
    return this._refine(cells, x0, z0, x1, z1, open0, open1, skip, margin);
  }

  // A* fino dentro de un corredor alrededor del camino grueso: nunca pisa cost === 0 ni corta esquinas.
  _refine(coarseCells, x0, z0, x1, z1, open0, open1, skip, margin) {
    const n = this.n, N = this.N, f = this.f, fine = this.fine;
    const gen = ++this._gen, corr = this._corr;
    const mark = (r, c) => { if (r >= 0 && c >= 0 && r < n && c < n) corr[r * n + c] = gen; };
    for (const i of coarseCells) {
      const R = (i / N) | 0, C = i % N;
      for (let r = R * f - margin; r < (R + 1) * f + margin; r++)
        for (let c = C * f - margin; c < (C + 1) * f + margin; c++) mark(r, c);
    }
    const [sr, sc] = [open0[0], open0[1]], [gr2, gc2] = [open1[0], open1[1]];
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) { mark(sr + dr, sc + dc); mark(gr2 + dr, gc2 + dc); }
    const start = sr * n + sc, goal = gr2 * n + gc2;
    if (!this._fg) { this._fg = new Float32Array(n * n); this._fcame = new Int32Array(n * n); this._fmark = new Int32Array(n * n); this._fclosed = new Int32Array(n * n); }
    const g = this._fg, came = this._fcame, seen = this._fmark, closed = this._fclosed;
    const heap = new MinHeap();
    const hfn = (i) => {
      const r = (i / n) | 0, c = i % n;
      const dr = Math.abs(r - gr2), dc = Math.abs(c - gc2);
      return Math.max(dr, dc) + 0.4142 * Math.min(dr, dc);
    };
    g[start] = 0; seen[start] = gen; came[start] = -1;
    heap.push(start, hfn(start));
    const D = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, 1.4142], [-1, 1, 1.4142], [1, -1, 1.4142], [1, 1, 1.4142]];
    let found = false, iter = 0;
    while (heap.size && iter++ < 400000) {
      const cur = heap.pop();
      if (cur === goal) { found = true; break; }
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      const r = (cur / n) | 0, c = cur % n;
      for (const [dr, dc, w] of D) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
        const ni = nr * n + nc;
        if (corr[ni] !== gen || fine[ni] === 0 || closed[ni] === gen) continue;
        // sin corner cutting: una diagonal exige libres sus dos celdas ortogonales
        if (dr && dc && (fine[r * n + nc] === 0 || fine[nr * n + c] === 0)) continue;
        const ng = g[cur] + w * (fine[cur] / 25 + fine[ni] / 25) * 0.5;
        if (seen[ni] !== gen || ng < g[ni]) {
          g[ni] = ng; seen[ni] = gen; came[ni] = cur;
          heap.push(ni, ng + hfn(ni));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let i = goal; i !== -1; i = came[i]) cells.push(i);
    cells.reverse();
    // celdas -> puntos, comprimiendo tramos colineales (mismas celdas cubiertas: no corta esquinas)
    let pts = [];
    for (let k = 0; k < cells.length; k++) {
      const r = (cells[k] / n) | 0, c = cells[k] % n;
      if (k > 0 && k < cells.length - 1) {
        const pr = (cells[k - 1] / n) | 0, pc = cells[k - 1] % n;
        const nr2 = (cells[k + 1] / n) | 0, nc2 = cells[k + 1] % n;
        if (nr2 - r === r - pr && nc2 - c === c - pc) continue;   // colineal: se omite el punto intermedio
      }
      pts.push(this.fineCenter(r, c));
    }
    // extremos exactos: la conexion ya se valido en _openNear
    if (Math.hypot(pts[0][0] - x0, pts[0][1] - z0) > 0.01) pts.unshift([x0, z0]);
    else pts[0] = [x0, z0];
    const last = pts[pts.length - 1];
    if (Math.hypot(last[0] - x1, last[1] - z1) > 0.01) pts.push([x1, z1]);
    else pts[pts.length - 1] = [x1, z1];
    return this._smooth(pts, skip);
  }

  // Suavizado (promedio de vecinos) validado: si el ajuste de un punto hace que alguno de sus dos tramos
  // atraviese una celda bloqueada, se conserva el punto anterior (valido) tal cual.
  _smooth(pts, skip) {
    if (pts.length < 4) return pts;
    let p = pts.map((q) => [q[0], q[1]]);
    for (let k = 0; k < 2; k++) {
      for (let i = 1; i < p.length - 1; i++) {
        const q = [(p[i - 1][0] + 2 * p[i][0] + p[i + 1][0]) / 4, (p[i - 1][1] + 2 * p[i][1] + p[i + 1][1]) / 4];
        if (this.segmentClear(p[i - 1][0], p[i - 1][1], q[0], q[1], skip) && this.segmentClear(q[0], q[1], p[i + 1][0], p[i + 1][1], skip)) p[i] = q;
      }
    }
    return p;
  }
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    k.push(key); v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= v[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    const top = k[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && v[l] < v[m]) m = l;
        if (r < k.length && v[r] < v[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}
