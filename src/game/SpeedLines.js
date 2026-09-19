import { CONFIG } from './config.js';
import { rand } from './utils.js';

/**
 * Screen-edge speed lines ("anime" wind streaks). Screen-space, CSS px of the
 * play area. They only spawn in the outer ring of the screen and shoot
 * outward from the centre, so the track in the middle stays readable.
 */
export class SpeedLines {
  constructor() {
    this.items = [];
    this.acc = 0;
  }

  clear() {
    this.items.length = 0;
  }

  spawn(w, h) {
    const E = CONFIG.juice.edgeLines;
    if (this.items.length >= E.max) return;
    const hw = w / 2;
    const hh = h / 2;
    // pick a point in the outer elliptical band of the screen
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 12; tries++) {
      x = rand(-hw, hw);
      y = rand(-hh, hh);
      if (Math.hypot(x / hw, y / hh) > E.innerRadius) break;
    }
    const len = Math.hypot(x, y) || 1;
    const dx = x / len;
    const dy = y / len;
    this.items.push({
      x: hw + x,
      y: hh + y,
      dx,
      dy,
      speed: rand(E.speed[0], E.speed[1]),
      len: rand(E.length[0], E.length[1]),
      width: rand(E.width[0], E.width[1]),
      age: 0,
      life: rand(0.14, 0.26),
      cyan: Math.random() < E.cyanShare,
    });
  }

  burst(count, w, h) {
    for (let i = 0; i < count; i++) this.spawn(w, h);
  }

  /** `boost` 0..1 drives the continuous stream. */
  update(dt, boost, w, h) {
    const E = CONFIG.juice.edgeLines;
    if (boost > E.minBoost) {
      const k = (boost - E.minBoost) / (1 - E.minBoost);
      this.acc += dt * E.rate * k * k;
      while (this.acc >= 1) {
        this.acc -= 1;
        this.spawn(w, h);
      }
    } else {
      this.acc = 0;
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.items.splice(i, 1);
        continue;
      }
      p.x += p.dx * p.speed * dt;
      p.y += p.dy * p.speed * dt;
    }
  }

  draw(ctx) {
    if (!this.items.length) return;
    const E = CONFIG.juice.edgeLines;
    ctx.lineCap = 'round';
    for (const p of this.items) {
      const t = p.age / p.life;
      ctx.globalAlpha = E.alpha * (t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75);
      ctx.strokeStyle = p.cyan ? CONFIG.nos.colors.mid : '#FFFFFF';
      ctx.lineWidth = p.width;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.dx * p.len, p.y - p.dy * p.len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
