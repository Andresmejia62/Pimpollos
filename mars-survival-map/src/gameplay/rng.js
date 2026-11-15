// Generador pseudoaleatorio con semilla (mulberry32) para todo lo que decide la evolucion de la simulacion:
// tormentas de polvo, remolinos, rafagas y eventos. Su estado cabe en un objeto JSON pequeno, asi que se guarda
// en el punto de control y al reintentar la secuencia de eventos se repite igual con las mismas entradas.
// El azar puramente visual (forma de un remolino, particulas) usa Math.random y no toca este generador.
export class Rng {
  constructor(seed = (Math.random() * 4294967296) >>> 0) { this.setState({ seed, s: seed >>> 0 }); }
  // [0, 1)
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  getState() { return { seed: this.seed, s: this.s }; }
  setState(st) { this.seed = st.seed >>> 0; this.s = st.s >>> 0; }
  clone() { const r = new Rng(0); r.setState(this.getState()); return r; }
}
