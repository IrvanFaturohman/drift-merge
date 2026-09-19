// Dev helper: simulates a player to check progression pacing.
//
// usage: node tools/economy-sim.mjs [policy] [minutes] ['{json overrides}']
//   policy: greedy (buys whatever is affordable: circuit > line > car)
//           smart  (saves for the purchase with the best income gain per $)
//   overrides: deep-merged into CONFIG, plus shortcuts
//              {"rewards":[...], "circuitCosts":[...]}
import { CONFIG } from '../src/game/config.js';
import { Track } from '../src/game/Track.js';
import { roundNice } from '../src/game/utils.js';

const policy = process.argv[2] ?? 'greedy';
const minutes = Number(process.argv[3] ?? 15);
const TAP_MULT = 1.08; // casual tapping
const mergeDeep = (a, b) => {
  for (const k in b) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) mergeDeep(a[k], b[k]);
    else a[k] = b[k];
  }
};
if (process.argv[4]) {
  const o = JSON.parse(process.argv[4]);
  if (o.rewards) o.rewards.forEach((r, i) => (CONFIG.cars.tiers[i].reward = r));
  if (o.circuitCosts) o.circuitCosts.forEach((c, i) => (CONFIG.circuits[i].cost = c));
  delete o.rewards;
  delete o.circuitCosts;
  mergeDeep(CONFIG, o);
}

const C = CONFIG;
const tracks = C.circuits.map((c) => new Track(c));
const need = (t) => C.merge.carsNeeded[t - 1] ?? 2;
let money = C.economy.startingMoney;
let purchases = 0;
let lines = C.rewardLines.startCount;
let level = 0;
let cars = [{ tier: 1, dist: C.cars.startingT * tracks[0].length }];
const events = [];
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const ev = (t, s) => events.push(`${fmt(t).padStart(5)}  ${s}`);
const carPrice = () => roundNice(C.addCar.baseCost * Math.pow(C.addCar.growth, purchases));
const linePrice = () => (lines < C.rewardLines.max ? C.rewardLines.prices[lines - 1] : null);
const circuitPrice = () => C.circuits[level + 1]?.cost ?? null;
const reward = (tier) => Math.ceil(C.cars.tiers[tier - 1].reward * C.circuits[level].multiplier - 1e-9);
const lap = (lvl) => tracks[lvl].length / (C.cars.baseSpeed * TAP_MULT * 0.93);
const incomeRate = (lvl = level, ln = lines, extraT1 = 0) => {
  let per = extraT1 * C.cars.tiers[0].reward;
  for (const c of cars) per += C.cars.tiers[c.tier - 1].reward;
  return (per * ln * C.circuits[lvl].multiplier) / lap(lvl);
};

const dt = 1 / 30;
let seenTier = 1;
const buckets = []; // per minute: purchases, car-count samples
for (let time = 0; time < minutes * 60; time += dt) {
  const m = Math.floor(time / 60);
  buckets[m] ??= { buys: 0, carSum: 0, samples: 0 };
  buckets[m].carSum += cars.length;
  buckets[m].samples++;

  const tr = tracks[level];
  for (const car of cars) {
    const i = Math.round(car.dist / tr.step) % tr.count;
    const sp = C.cars.baseSpeed * C.cars.tiers[car.tier - 1].speed * TAP_MULT * (1 - C.cars.cornerSlowdown * tr.strength[i]);
    const prevT = car.dist / tr.length;
    car.dist = (car.dist + sp * dt) % tr.length;
    const t = car.dist / tr.length;
    for (let k = 0; k < lines; k++) {
      const p = C.rewardLines.positions[k];
      if (t >= prevT ? p > prevT && p <= t : p > prevT || p <= t) money += reward(car.tier);
    }
  }

  // merge whenever possible (the button wiggles, players press it)
  for (;;) {
    const counts = {};
    cars.forEach((c) => (counts[c.tier] = (counts[c.tier] || 0) + 1));
    const tier = Object.keys(counts).map(Number).sort((a, b) => a - b).find((t) => counts[t] >= need(t) && t < C.cars.tiers.length);
    if (!tier) break;
    const group = cars.filter((c) => c.tier === tier).slice(0, need(tier));
    cars = cars.filter((c) => !group.includes(c));
    cars.push({ tier: tier + 1, dist: group[0].dist });
    if (tier + 1 > seenTier) {
      seenTier = tier + 1;
      ev(time, `first T${tier + 1}`);
    }
  }

  const options = [];
  if (circuitPrice() != null) options.push({ kind: 'circuit', price: circuitPrice(), gain: incomeRate(level + 1) - incomeRate() });
  if (linePrice() != null) options.push({ kind: 'line', price: linePrice(), gain: incomeRate(level, lines + 1) - incomeRate() });
  if (cars.length < C.cars.maxCars) options.push({ kind: 'car', price: carPrice(), gain: incomeRate(level, lines, 1) - incomeRate() });
  let pick = null;
  if (policy === 'smart') {
    options.sort((a, b) => b.gain / b.price - a.gain / a.price);
    if (options[0] && money >= options[0].price) pick = options[0];
  } else {
    pick = ['circuit', 'line', 'car'].map((k) => options.find((o) => o.kind === k)).find((o) => o && money >= o.price) ?? null;
  }
  if (pick) {
    money -= pick.price;
    if (pick.kind === 'circuit') {
      level++;
      cars.forEach((c) => (c.dist = (c.dist / tr.length) * tracks[level].length));
      ev(time, `circuit ${level + 1}`);
    } else if (pick.kind === 'line') {
      lines++;
      ev(time, `reward line ${lines}`);
    } else {
      purchases++;
      buckets[m].buys++;
      cars.push({ tier: 1, dist: Math.random() * tracks[level].length });
      if (purchases <= 3) ev(time, `car purchase #${purchases} (next $${carPrice()})`);
    }
  }
}

console.log(`policy=${policy}`);
console.log(events.join('\n'));
console.log('\nmin | buys | avg cars on track');
buckets.forEach((b, i) => console.log(`${String(i + 1).padStart(3)} | ${String(b.buys).padStart(4)} | ${(b.carSum / b.samples).toFixed(1)}`));
console.log(`\nend: money=${money} tiers=${cars.map((c) => c.tier).sort().join(',')} purchases=${purchases} nextCar=$${carPrice()} lines=${lines} circuit=${level + 1}`);
