// Comprobaciones de los mosaicos procedurales sin navegador.
import { pixels164, meanLuma164, TEX_SIZE } from "../../src/ui/tex164.js";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "OK  " : "FALLA"} ${name}${detail ? "  ->  " + detail : ""}`);
  if (!ok) failed++;
};

for (const kind of ["regolith", "bedrock"]) {
  const data = pixels164(kind), S = TEX_SIZE, n = S * S;
  check(`${kind}: longitud RGBA`, S === 164 && data instanceof Uint8ClampedArray && data.length === 164 * 164 * 4);
  let alpha = true, sum = 0, square = 0;
  const lum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    alpha &&= data[i * 4 + 3] === 255;
    const v = data[i * 4] * 0.2126 + data[i * 4 + 1] * 0.7152 + data[i * 4 + 2] * 0.0722;
    lum[i] = v; sum += v; square += v * v;
  }
  const mean = sum / n, sd = Math.sqrt(Math.max(0, square / n - mean * mean));
  check(`${kind}: alfa 255`, alpha);
  check(`${kind}: luminancia media [205,240]`, mean >= 205 && mean <= 240, mean.toFixed(2));
  check(`${kind}: desviacion tipica > 12`, sd > 12, sd.toFixed(2));
  check(`${kind}: amplitud minima de dibujo`, sd >= (kind === "regolith" ? 14 : 18), sd.toFixed(2));
  check(`${kind}: media normalizada coincide`, Math.abs(meanLuma164(kind) - mean / 255) <= 0.01, meanLuma164(kind).toFixed(6));
  const centered = pixels164(kind, true);
  let centeredSum = 0, saturated = 0;
  for (let i = 0; i < centered.length; i += 4) {
    centeredSum += centered[i] * 0.2126 + centered[i + 1] * 0.7152 + centered[i + 2] * 0.0722;
    if ([0, 1, 2].some((c) => centered[i + c] === 0 || centered[i + c] === 255)) saturated++;
  }
  const centeredMean = centeredSum / n;
  check(`${kind}: media centrada [118,138]`, centeredMean >= 118 && centeredMean <= 138, centeredMean.toFixed(2));
  check(`${kind}: pixeles centrados saturados <= 1%`, saturated / n <= 0.01, `${(100 * saturated / n).toFixed(3)}%`);
  for (const axis of ["columnas", "filas"]) {
    let seam = 0, inside = 0;
    const at = (a, b) => axis === "columnas" ? lum[b * S + a] : lum[a * S + b];
    for (let b = 0; b < S; b++) {
      seam += Math.abs(at(S - 1, b) - at(0, b));
      for (let a = 1; a < S; a++) inside += Math.abs(at(a, b) - at(a - 1, b));
    }
    seam /= S; inside /= S * (S - 1);
    check(`${kind}: continuidad entre ${axis}`, seam <= 2.5 * inside, `borde ${seam.toFixed(3)}, interior ${inside.toFixed(3)}`);
  }
}

console.log(failed ? `\n${failed} comprobaciones fallidas` : "\nTodo correcto");
process.exit(failed ? 1 : 0);
