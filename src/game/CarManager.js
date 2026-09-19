import { CONFIG, MAX_TIER } from './config.js';
import { Car } from './Car.js';
import { drawCar, drawCarShadow, drawGhost, drawTrail } from './CarRenderer.js';

const C = CONFIG.cars;

/** Cars of `tier` that one merge consumes (see CONFIG.merge.carsNeeded). */
export const carsNeededToMerge = (tier) => CONFIG.merge.carsNeeded[tier - 1] ?? 2;

/** Owns every car: spawning, spacing, merging, per-frame update + crossings. */
export class CarManager {
  constructor() {
    this.cars = [];
    this.ghosts = [];
    this.onCross = null; // (car, line) => void
  }

  get count() {
    return this.cars.length;
  }

  get isFull() {
    return this.cars.length >= C.maxCars;
  }

  clear() {
    this.cars.length = 0;
    this.ghosts.length = 0;
  }

  add(tier, t, lane, track) {
    const car = new Car(tier, lane);
    car.place(track, t);
    car.spawnAge = 999; // no pop unless requested
    this.cars.push(car);
    return car;
  }

  /** Middle of the biggest gap between cars, so new cars never stack. */
  findSpawnT() {
    if (!this.cars.length) return C.startingT;
    const ts = this.cars.map((c) => c.t).sort((a, b) => a - b);
    let bestGap = -1;
    let bestT = 0;
    for (let i = 0; i < ts.length; i++) {
      const a = ts[i];
      const b = i + 1 < ts.length ? ts[i + 1] : ts[0] + 1;
      if (b - a > bestGap) {
        bestGap = b - a;
        bestT = (a + (b - a) / 2) % 1;
      }
    }
    return bestT;
  }

  /** Least-used lane (centre first on ties). */
  pickLane() {
    const counts = C.laneOffsets.map(() => 0);
    for (const car of this.cars) counts[car.lane]++;
    let best = 0;
    for (let i = 1; i < counts.length; i++) if (counts[i] < counts[best]) best = i;
    return best;
  }

  spawnNew(tier, track) {
    if (this.isFull) return null;
    const car = this.add(tier, this.findSpawnT(), this.pickLane(), track);
    car.playDrop(0);
    return car;
  }

  tierCounts() {
    const counts = new Array(MAX_TIER + 1).fill(0);
    for (const car of this.cars) counts[car.tier]++;
    return counts;
  }

  /** Lowest tier with enough cars to merge (and that can still be upgraded), else null. */
  findMergeTier() {
    const counts = this.tierCounts();
    for (let tier = 1; tier < MAX_TIER; tier++) if (counts[tier] >= carsNeededToMerge(tier)) return tier;
    return null;
  }

  /** When nothing can merge: the lowest tier that is part-way there (e.g. 2 of 3 T2s). */
  mergeProgress() {
    const counts = this.tierCounts();
    for (let tier = 1; tier < MAX_TIER; tier++) {
      const need = carsNeededToMerge(tier);
      if (counts[tier] >= 2 && counts[tier] < need) return { tier, have: counts[tier], need };
    }
    return null;
  }

  /**
   * Merge the lowest valid tier. Uses the N cars of that tier that sit closest
   * together along the track; the one furthest ahead becomes the new car and
   * the others fly into it.
   */
  merge(track) {
    const tier = this.findMergeTier();
    if (tier == null) return null;
    const need = carsNeededToMerge(tier);
    const same = this.cars.filter((c) => c.tier === tier).sort((a, b) => a.t - b.t);
    let group = null;
    let bestSpan = Infinity;
    for (let i = 0; i < same.length; i++) {
      const g = [];
      for (let k = 0; k < need; k++) g.push(same[(i + k) % same.length]);
      let span = g[need - 1].t - g[0].t;
      if (span < 0) span += 1;
      if (span < bestSpan) {
        bestSpan = span;
        group = g;
      }
    }
    const keep = group[need - 1];
    const others = group.slice(0, need - 1);

    this.cars = this.cars.filter((c) => !group.includes(c));
    const result = this.add(tier + 1, keep.t, keep.lane, track);
    result.drift = keep.drift;
    result.bodyAngle = keep.bodyAngle;
    result.cornerFactor = keep.cornerFactor;
    result.playSpawn(CONFIG.merge.popOvershoot, 1);
    result.kick(CONFIG.juice.mergeSquash);
    for (const other of others) {
      this.ghosts.push({
        tier,
        x: other.x,
        y: other.y,
        angle: other.bodyAngle,
        fromX: other.x,
        fromY: other.y,
        target: result,
        age: 0,
        life: CONFIG.merge.ghostDuration,
      });
    }
    return { car: result, tier: tier + 1, consumed: group };
  }

  /** Circuit changed: keep each car's normalized progress. */
  onTrackChanged(track) {
    for (const car of this.cars) car.place(track, car.t);
    this.ghosts.length = 0;
  }

  update(dt, env, lines) {
    for (const car of this.cars) {
      car.update(dt, env);
      for (const line of lines) {
        if (line.crossedBy(car.prevT, car.t)) this.onCross?.(car, line);
      }
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.age += dt;
      const k = Math.min(1, g.age / g.life);
      const e = k * k;
      g.x = g.fromX + (g.target.x - g.fromX) * e;
      g.y = g.fromY + (g.target.y - g.fromY) * e;
      if (g.age >= g.life) this.ghosts.splice(i, 1);
    }
  }

  /** NOS light trails sit on the asphalt, under every car. */
  drawTrails(ctx) {
    for (const car of this.cars) drawTrail(ctx, car);
  }

  draw(ctx, time) {
    for (const car of this.cars) drawCarShadow(ctx, car);
    // lower tiers first so the fanciest cars sit on top when overlapping
    const sorted = this.cars.length > 1 ? [...this.cars].sort((a, b) => a.tier - b.tier) : this.cars;
    for (const car of sorted) drawCar(ctx, car, time);
    for (const g of this.ghosts) drawGhost(ctx, g);
  }

  serialize() {
    return this.cars.map((c) => ({ tier: c.tier, t: Number(c.t.toFixed(5)), lane: c.lane }));
  }
}
