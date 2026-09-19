import { CONFIG } from './config.js';
import { damp } from './utils.js';

const N = CONFIG.nos;

/**
 * Global NOS meter.
 *   tap        -> boost += tapBoostAmount (clamped 0..1)
 *   idle       -> boost drains smoothly (proportional + small linear term)
 *   speedMult  -> eases toward 1 + boost * maxBoostBonus (never snaps)
 *   visual     -> faster-following value used for flames / particles
 *   kick       -> short 1 -> 0 impulse after each tap (flame spurt)
 *   drive      -> what cars actually use: speedMult + a small tap surge, capped
 * NOS only affects speed + visuals; it never multiplies income directly.
 */
export class BoostSystem {
  constructor() {
    this.reset();
  }

  reset() {
    this.boost = 0;
    this.speedMult = 1;
    this.drive = 1;
    this.visual = 0;
    this.kick = 0;
    this.sinceTap = Infinity;
    this.totalTaps = 0;
  }

  tap() {
    this.boost = Math.min(1, this.boost + N.tapBoostAmount);
    this.sinceTap = 0;
    this.kick = 1;
    this.totalTaps++;
  }

  get targetMult() {
    return 1 + this.boost * N.maxBoostBonus;
  }

  update(dt) {
    this.sinceTap += dt;
    if (this.sinceTap > N.decayDelay && this.boost > 0) {
      this.boost = Math.max(0, this.boost - (this.boost * N.decayRate + N.decayLinear) * dt);
    }
    this.speedMult = damp(this.speedMult, this.targetMult, N.speedResponse, dt);
    this.visual = damp(this.visual, this.boost, N.visualResponse, dt);
    if (this.visual < 0.002) this.visual = 0;
    this.kick = Math.max(0, this.kick - dt * N.kickDecay);
    this.drive = Math.min(N.maxDriveMult, this.speedMult + this.kick * this.kick * N.tapSurge);
  }
}
