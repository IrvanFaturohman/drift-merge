import { CONFIG } from './config.js';

/** Particle kinds. SMOKE renders below cars, everything else above. */
export const P = {
  SMOKE: 0,
  NOS: 1,
  SPARK: 2,
  RING: 3,
  SPEED: 4,
  CONFETTI: 5,
  STAR: 6,
  DUST: 7,
};

/**
 * Fixed-size pooled particle system. Expired particles are swap-removed, so
 * the active list never grows past `max` and nothing is allocated per frame.
 */
export class ParticleSystem {
  constructor(max = CONFIG.particles.max) {
    this.max = max;
    this.items = [];
    for (let i = 0; i < max; i++) this.items.push({});
    this.count = 0;
  }

  spawn(type, x, y, o = {}) {
    if (this.count >= this.max) return null;
    const p = this.items[this.count++];
    p.type = type;
    p.x = x;
    p.y = y;
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.life = o.life ?? 0.5;
    p.age = 0;
    p.size = o.size ?? 3;
    p.endSize = o.endSize ?? p.size;
    p.alpha = o.alpha ?? 1;
    p.color = o.color ?? '#FFFFFF';
    p.drag = o.drag ?? 0;
    p.angle = o.angle ?? 0;
    p.width = o.width ?? 2;
    p.gravity = o.gravity ?? 0;
    p.rot = o.rot ?? Math.random() * Math.PI * 2;
    p.spin = o.spin ?? 0;
    return p;
  }

  update(dt) {
    const items = this.items;
    for (let i = 0; i < this.count; ) {
      const p = items[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.count--;
        items[i] = items[this.count];
        items[this.count] = p;
        continue;
      }
      if (p.drag) {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      i++;
    }
  }

  clear() {
    this.count = 0;
  }

  /**
   * layer 0 = under cars (smoke, dust), layer 1 = over cars.
   * `view` = { k, ox, oy }: the world transform in device pixels (confetti rotate in place).
   */
  draw(ctx, layer, view) {
    const items = this.items;
    for (let i = 0; i < this.count; i++) {
      const p = items[i];
      const isSmoke = p.type === P.SMOKE || p.type === P.DUST;
      if ((layer === 0) !== isSmoke) continue;
      const t = p.age / p.life;
      const size = p.size + (p.endSize - p.size) * t;
      switch (p.type) {
        case P.DUST:
        case P.SMOKE: {
          // quick fade-in, then fade out
          const a = p.alpha * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
          ctx.globalAlpha = a;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case P.NOS:
        case P.SPARK: {
          ctx.globalAlpha = p.alpha * (1 - t * t);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.3, size), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case P.RING: {
          ctx.globalAlpha = p.alpha * (1 - t) * (1 - t);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.width * (1 - t * 0.6);
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.5, size), 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case P.CONFETTI: {
          ctx.globalAlpha = p.alpha * (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
          ctx.fillStyle = p.color;
          // fake 3D flip: width oscillates with the spin
          const w = size * Math.abs(Math.cos(p.rot * 1.7)) + 0.4;
          const c = Math.cos(p.rot);
          const s = Math.sin(p.rot);
          ctx.setTransform(view.k * c, view.k * s, -view.k * s, view.k * c, view.ox + view.k * p.x, view.oy + view.k * p.y);
          ctx.fillRect(-w / 2, -size * 0.3, w, size * 0.6);
          ctx.setTransform(view.k, 0, 0, view.k, view.ox, view.oy);
          break;
        }
        case P.STAR: {
          // 4-point sparkle that pops then shrinks
          const k = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7;
          const r = size * (0.4 + 0.6 * k);
          ctx.globalAlpha = p.alpha * Math.min(1, k * 1.5);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - r);
          ctx.quadraticCurveTo(p.x, p.y, p.x + r, p.y);
          ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + r);
          ctx.quadraticCurveTo(p.x, p.y, p.x - r, p.y);
          ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - r);
          ctx.fill();
          break;
        }
        case P.SPEED: {
          const a = p.alpha * (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8);
          ctx.globalAlpha = a;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.width;
          ctx.lineCap = 'round';
          const dx = Math.cos(p.angle) * size * 0.5;
          const dy = Math.sin(p.angle) * size * 0.5;
          ctx.beginPath();
          ctx.moveTo(p.x - dx, p.y - dy);
          ctx.lineTo(p.x + dx, p.y + dy);
          ctx.stroke();
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}
