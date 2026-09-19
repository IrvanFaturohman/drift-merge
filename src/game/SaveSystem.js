import { CONFIG, MAX_TIER } from './config.js';

const VERSION = 1;

/** localStorage persistence with validation (a bad save never crashes the game). */
export class SaveSystem {
  constructor(key = CONFIG.save.key) {
    this.key = key;
    this.enabled = true;
  }

  load() {
    let raw;
    try {
      raw = localStorage.getItem(this.key);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      if (!d || d.v !== VERSION) return null;
      const num = (v, min, max, fallback) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
      const cars = Array.isArray(d.cars)
        ? d.cars
            .filter((c) => c && Number.isFinite(c.tier))
            .slice(0, CONFIG.cars.maxCars)
            .map((c) => ({
              tier: Math.round(num(c.tier, 1, MAX_TIER, 1)),
              t: num(c.t, 0, 0.999999, 0),
              lane: Math.round(num(c.lane, 0, CONFIG.cars.laneOffsets.length - 1, 0)),
            }))
        : [];
      return {
        money: Math.floor(num(d.money, 0, Number.MAX_SAFE_INTEGER, 0)),
        carsPurchased: Math.floor(num(d.carsPurchased, 0, 1000, 0)),
        rewardLines: Math.floor(num(d.rewardLines, 1, CONFIG.rewardLines.max, 1)),
        circuit: Math.floor(num(d.circuit, 0, CONFIG.circuits.length - 1, 0)),
        hintDone: !!d.hintDone,
        cars,
      };
    } catch {
      return null;
    }
  }

  save(state) {
    if (!this.enabled) return;
    try {
      localStorage.setItem(this.key, JSON.stringify({ v: VERSION, savedAt: Date.now(), ...state }));
    } catch {
      // storage full / private mode - progress just won't persist
    }
  }

  clear() {
    try {
      localStorage.removeItem(this.key);
    } catch {
      /* ignore */
    }
  }
}
