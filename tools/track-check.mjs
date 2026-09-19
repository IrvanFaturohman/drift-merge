// Dev helper: validates circuit layouts (length, self-clearance, corner mix).
import { CONFIG } from '../src/game/config.js';
import { Track } from '../src/game/Track.js';

for (const def of CONFIG.circuits) {
  const tr = new Track(def);
  const n = tr.count;
  let minClear = Infinity, where = null;
  const skip = Math.ceil(110 / tr.step);
  for (let i = 0; i < n; i += 2) {
    for (let j = i + skip; j < n; j += 2) {
      const pathD = Math.min(j - i, n - (j - i));
      if (pathD < skip) continue;
      const d = Math.hypot(tr.xs[i] - tr.xs[j], tr.ys[i] - tr.ys[j]);
      if (d < minClear) { minClear = d; where = [i * tr.step | 0, j * tr.step | 0]; }
    }
  }
  const b = tr.bounds;
  let drift = 0, strong = 0;
  for (let i = 0; i < n; i++) { if (tr.strength[i] > CONFIG.drift.threshold) drift++; if (tr.strength[i] > 0.85) strong++; }
  let invSpeed = 0;
  for (let i = 0; i < n; i++) invSpeed += 1 / (1 - CONFIG.cars.cornerSlowdown * tr.strength[i]);
  const avgFactor = n / invSpeed;
  console.log(`${def.name}: length=${tr.length.toFixed(0)} bounds x[${b.minX.toFixed(0)},${b.maxX.toFixed(0)}] y[${b.minY.toFixed(0)},${b.maxY.toFixed(0)}] minClearance=${minClear.toFixed(1)} at ${where} drift%=${(100*drift/n).toFixed(0)} strong%=${(100*strong/n).toFixed(0)} lap@base=${(tr.length/(CONFIG.cars.baseSpeed*avgFactor)).toFixed(2)}s`);
}
