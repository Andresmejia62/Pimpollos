// Mundo: cuadricula de M3 (region.json) con muestreo de altura y capas.
// Convenciones: x = Este, z = Sur, y = elevacion - y_ref_m. Fila 0 = norte, columna 0 = oeste.
export class World {
  constructor(data) {
    const { region, layers, rules } = data;
    this.rules = rules;
    this.size = region.size_m;
    this.n = region.grid_px;
    this.px = region.pixel_size_m;
    this.half = this.size / 2;
    const L = layers.layers;
    this.yRef = L.dem.y_ref_m;
    this.demRange = L.dem.decode.max - L.dem.decode.min;
    // DEM en metros relativos a y_ref
    const raw = new Uint16Array(data.dem);
    this.h = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) this.h[i] = (raw[i] / 65535) * this.demRange;
    // Capas planas uint8
    const order = L.binary.grid.order;
    const grid = new Uint8Array(data.grid);
    const nn = this.n * this.n;
    this.planes = {};
    order.forEach((k, i) => { this.planes[k] = grid.subarray(i * nn, (i + 1) * nn); });
    const dec = (k) => ({ min: L[k].decode.min, max: L[k].decode.max });
    this.decode = { slope: dec("slope"), radiation: dec("radiation"), thermal: dec("thermal"), thermal_night: dec("thermal_night") };
    this.dayCurve = rules.day_curve.points;
  }

  // ---- coordenadas -------------------------------------------------------
  toGrid(x, z) { return [(z + this.half) / this.px - 0.5, (x + this.half) / this.px - 0.5]; }
  toWorld(r, c) { return [(c + 0.5) * this.px - this.half, (r + 0.5) * this.px - this.half]; }
  inside(x, z, margin = 0) { return Math.abs(x) <= this.half - margin && Math.abs(z) <= this.half - margin; }
  index(x, z) {
    const [r, c] = this.toGrid(x, z);
    const ri = Math.min(this.n - 1, Math.max(0, Math.round(r)));
    const ci = Math.min(this.n - 1, Math.max(0, Math.round(c)));
    return ri * this.n + ci;
  }

  // Altura bilineal sobre el DEM completo (para colocar objetos)
  demHeight(x, z) {
    const [r, c] = this.toGrid(x, z);
    const n = this.n;
    const r0 = Math.min(n - 2, Math.max(0, Math.floor(r)));
    const c0 = Math.min(n - 2, Math.max(0, Math.floor(c)));
    const fr = Math.min(1, Math.max(0, r - r0));
    const fc = Math.min(1, Math.max(0, c - c0));
    const i = r0 * n + c0;
    const h = this.h;
    return (h[i] * (1 - fc) + h[i + 1] * fc) * (1 - fr) + (h[i + n] * (1 - fc) + h[i + n + 1] * fc) * fr;
  }

  // ---- capas ---------------------------------------------------------------
  _scalar(k, x, z) {
    const d = this.decode[k];
    return d.min + (this.planes[k][this.index(x, z)] / 255) * (d.max - d.min);
  }
  slope(x, z) { return this._scalar("slope", x, z); }
  radiation(x, z) { return this._scalar("radiation", x, z); }
  spectral(x, z) { return this.planes.spectral[this.index(x, z)]; }
  // Temperatura del suelo a la hora local (interpola noche <-> 10:00 con day_curve)
  temperature(x, z, hour) {
    const f = this.dayFraction(hour);
    const td = this._scalar("thermal", x, z);
    const tn = this._scalar("thermal_night", x, z);
    return tn + f * (td - tn);
  }
  dayFraction(hour) {
    const p = this.dayCurve;
    const h = ((hour % 24) + 24) % 24;
    for (let i = 0; i < p.length - 1; i++) {
      if (h >= p[i][0] && h <= p[i + 1][0]) {
        const u = (h - p[i][0]) / (p[i + 1][0] - p[i][0]);
        return p[i][1] + u * (p[i + 1][1] - p[i][1]);
      }
    }
    return 0;
  }
  blockedAt(x, z) {
    if (!this.inside(x, z, 3)) return true;
    return this.slope(x, z) > this.rules.hazards.slope.blocked_above_deg;
  }
}
