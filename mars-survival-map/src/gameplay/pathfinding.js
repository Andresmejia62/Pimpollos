// A* sobre la cuadricula de costos de M3 reducida (factor 2 -> 512x512, celda = 12 m en este recorte).
// Regla estricta: una celda esta bloqueada si CUALQUIERA de sus sub-celdas lo esta (no atraviesa
// escalones angostos). Si asi no hay camino, se usa la regla de cost_256.png (>= 50 % bloqueado).
export class Pathfinder {
  constructor(world, factor = 2) {
    this.world = world;
    this.f = factor;
    this.N = world.n / factor;
    const n = world.n, N = this.N, f = factor;
    const fine = world.planes.cost;
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

  // Devuelve una lista de puntos [x, z] desde (x0,z0) hasta (x1,z1), o null
  find(x0, z0, x1, z1) {
    this.cost = this.strict;
    const r = this._find(x0, z0, x1, z1);
    if (r) return r;
    this.cost = this.loose;
    const r2 = this._find(x0, z0, x1, z1);
    this.cost = this.strict;
    return r2;
  }

  _find(x0, z0, x1, z1) {
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
    const pts = cells.map((i) => this.toWorld((i / N) | 0, i % N));
    pts[0] = [x0, z0];
    pts.push([x1, z1]);
    return this._smooth(pts);
  }

  // Suavizado simple (promedio de vecinos) para que la linea no se vea escalonada
  _smooth(pts) {
    if (pts.length < 4) return pts;
    let p = pts;
    for (let k = 0; k < 2; k++) {
      p = p.map((q, i) => (i === 0 || i === p.length - 1 ? q : [(p[i - 1][0] + 2 * q[0] + p[i + 1][0]) / 4, (p[i - 1][1] + 2 * q[1] + p[i + 1][1]) / 4]));
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
