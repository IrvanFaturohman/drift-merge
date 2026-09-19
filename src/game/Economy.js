import { CONFIG } from './config.js';
import { roundNice } from './utils.js';

/** Money + every price formula. Money is always an integer. */
export class Economy {
  constructor() {
    this.onEarn = null;
    this.reset();
  }

  reset() {
    this.money = CONFIG.economy.startingMoney;
    this.carsPurchased = 0;
  }

  /** `source` lets the UI decide how to show it ('coin' = flies into the counter). */
  earn(amount, source = 'other') {
    amount = Math.floor(amount);
    if (amount <= 0) return;
    this.money += amount;
    this.onEarn?.(amount, source);
  }

  canAfford(price) {
    return price != null && this.money >= price;
  }

  spend(price) {
    if (!this.canAfford(price)) return false;
    this.money -= price;
    return true;
  }

  /** reward = tier reward x circuit multiplier, rounded up to an integer. */
  rewardFor(tierReward, circuitMultiplier) {
    return Math.max(1, Math.ceil(tierReward * circuitMultiplier - 1e-9));
  }

  addCarPrice() {
    const A = CONFIG.addCar;
    return roundNice(A.baseCost * Math.pow(A.growth, this.carsPurchased));
  }

  /** Price of the next reward line, or null at max. */
  rewardLinePrice(currentLines) {
    const R = CONFIG.rewardLines;
    if (currentLines >= R.max) return null;
    return R.prices[currentLines - 1] ?? R.prices[R.prices.length - 1];
  }

  /** Price to unlock the circuit after `level`, or null at max. */
  circuitPrice(level) {
    const next = CONFIG.circuits[level + 1];
    return next ? next.cost : null;
  }
}
