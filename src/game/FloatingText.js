import { CONFIG } from './config.js';
import { easeOutCubic, popScale } from './utils.js';

const FONT = 'Fredoka, "Trebuchet MS", system-ui, sans-serif';

/** Pooled floating labels: "+$12", "TIER 3!", circuit banners. */
export class FloatingTextSystem {
  constructor(max = CONFIG.floatingText.max) {
    this.max = max;
    this.items = [];
  }

  spawn(text, x, y, o = {}) {
    if (this.items.length >= this.max) this.items.shift(); // drop the oldest
    this.items.push({
      text,
      x,
      y,
      age: 0,
      life: o.life ?? CONFIG.floatingText.lifetime,
      rise: o.rise ?? CONFIG.floatingText.rise,
      size: o.size ?? CONFIG.floatingText.moneySize,
      color: o.color ?? CONFIG.floatingText.moneyColor,
      sub: o.sub ?? null,
      pill: o.pill ?? null, // background colour -> readable label on any ground
      pop: o.pop ?? 1.25,
      delay: o.delay ?? 0,
      font: `700 ${o.size ?? CONFIG.floatingText.moneySize}px ${FONT}`,
    });
  }

  clear() {
    this.items.length = 0;
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      if (it.age >= it.life + it.delay) this.items.splice(i, 1);
    }
  }

  draw(ctx) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const it of this.items) {
      const age = it.age - it.delay;
      if (age < 0) continue;
      const t = age / it.life;
      const y = it.y - it.rise * easeOutCubic(t);
      const s = popScale(Math.min(1, age / 0.22), it.pop);
      const alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(it.x, y);
      ctx.scale(s, s);
      ctx.font = it.font;
      if (it.pill) {
        const w = ctx.measureText(it.text).width + it.size * 0.9;
        const h = it.size * 1.3;
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        roundRect(ctx, -w / 2, -h / 2 + 2, w, h, h / 2);
        ctx.fill();
        ctx.fillStyle = it.pill;
        roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
        ctx.fill();
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, 0, 1);
      } else {
        ctx.lineWidth = Math.max(2.5, it.size * 0.2);
        ctx.strokeStyle = 'rgba(22, 26, 34, 0.6)';
        ctx.strokeText(it.text, 0, 0);
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, 0, 0);
      }
      if (it.sub) {
        const subSize = Math.round(it.size * 0.45);
        ctx.font = `600 ${subSize}px ${FONT}`;
        const sy = it.size * (it.pill ? 1.05 : 0.8);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(22, 26, 34, 0.6)';
        ctx.strokeText(it.sub, 0, sy);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(it.sub, 0, sy);
      }
      ctx.restore();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
