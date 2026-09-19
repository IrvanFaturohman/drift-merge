import { CONFIG } from '../game/config.js';
import { easeOutCubic, popScale, rand } from '../game/utils.js';

const FONT = 'Fredoka, "Trebuchet MS", system-ui, sans-serif';

/**
 * Screen-space effects drawn on a transparent canvas over the whole app:
 * coins flying from the track into the money counter, bursts from buttons,
 * "-$16" spend labels. Coordinates are CSS px relative to #app.
 */
export class UIFx {
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector('#fx-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.coinEl = root.querySelector('#money .coin');
    this.nosEl = root.querySelector('#nos .nos-bar');
    this.coins = [];
    this.orbs = []; // NOS energy flying from a tap into the NOS meter
    this.lastOrbAt = 0;
    this.onOrbArrive = null;
    this.parts = [];
    this.texts = [];
    this.inFlight = 0; // money already earned but still flying to the counter
    this.onCoinArrive = null;
    this.dirty = false;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(root);
  }

  resize() {
    const r = this.root.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, CONFIG.loop.maxDevicePixelRatio);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  /** Centre of an element in #app-relative CSS px. */
  centerOf(el) {
    const r = el.getBoundingClientRect();
    const a = this.root.getBoundingClientRect();
    return { x: r.left - a.left + r.width / 2, y: r.top - a.top + r.height / 2 };
  }

  /** Returns false when too many coins are already flying (caller pays out instantly). */
  flyCoin(x, y, amount) {
    const J = CONFIG.juice;
    if (this.coins.length >= J.maxFlyingCoins) return false;
    const side = x < this.w / 2 ? 1 : -1;
    this.coins.push({
      x0: x,
      y0: y,
      cx: x + side * rand(20, 70),
      cy: y - rand(50, 110),
      age: 0,
      dur: rand(J.coinFlyDuration[0], J.coinFlyDuration[1]),
      amount,
      spin: rand(0, 6),
      x,
      y,
    });
    this.inFlight += amount;
    return true;
  }

  /** Energy orb from a tap point into the NOS meter (rate-limited while spamming). */
  flyOrb(x, y) {
    const now = performance.now();
    if (now - this.lastOrbAt < 70 || this.orbs.length >= 10) return;
    this.lastOrbAt = now;
    this.orbs.push({ x0: x, y0: y, x, y, age: 0, dur: 0.32 + Math.random() * 0.08, side: Math.random() < 0.5 ? -1 : 1, trail: [] });
  }

  burst(x, y, color, count = 12, speed = 160) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand(-0.3, 0.3);
      const s = speed * rand(0.4, 1);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, age: 0, life: rand(0.35, 0.6), size: rand(2, 4), color, star: Math.random() < 0.3 });
    }
    this.dirty = true;
  }

  sparkle(x, y, count = 3) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(30, 90);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, age: 0, life: rand(0.3, 0.5), size: rand(3, 6), color: '#FFF3B0', star: true });
    }
  }

  floatText(text, x, y, color, vy = 40) {
    this.texts.push({ text, x, y, vy, age: 0, life: 0.8, color });
    this.dirty = true;
  }

  update(dt) {
    const target = this.coinEl ? this.centerOf(this.coinEl) : { x: this.w / 2, y: 24 };
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.age += dt;
      const t = Math.min(1, c.age / c.dur);
      const u = t * t * (1.4 - 0.4 * t); // hang for a beat, then rush into the counter
      const a = 1 - u;
      c.x = a * a * c.x0 + 2 * a * u * c.cx + u * u * target.x;
      c.y = a * a * c.y0 + 2 * a * u * c.cy + u * u * target.y;
      if (t >= 1) {
        this.coins.splice(i, 1);
        this.inFlight -= c.amount;
        this.sparkle(target.x, target.y, 2);
        this.onCoinArrive?.(c.amount);
      }
    }
    if (this.coins.length === 0) this.inFlight = 0;
    if (this.orbs.length) {
      const nt = this.nosEl ? this.centerOf(this.nosEl) : { x: this.w / 2, y: 60 };
      for (let i = this.orbs.length - 1; i >= 0; i--) {
        const o = this.orbs[i];
        o.age += dt;
        const t = Math.min(1, o.age / o.dur);
        const u = t * t; // accelerate into the meter
        const cx = (o.x0 + nt.x) / 2 + o.side * 60;
        const cy = Math.min(o.y0, nt.y) + (Math.max(o.y0, nt.y) - Math.min(o.y0, nt.y)) * 0.35;
        const a = 1 - u;
        o.trail.push(o.x, o.y);
        if (o.trail.length > 10) o.trail.splice(0, 2);
        o.x = a * a * o.x0 + 2 * a * u * cx + u * u * nt.x;
        o.y = a * a * o.y0 + 2 * a * u * cy + u * u * nt.y;
        if (t >= 1) {
          this.orbs.splice(i, 1);
          this.parts.push({ x: nt.x, y: nt.y, vx: 0, vy: 0, age: 0, life: 0.3, size: 7, color: '#BFF2FF', star: true });
          this.onOrbArrive?.();
        }
      }
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.parts.splice(i, 1);
        continue;
      }
      const k = Math.exp(-4 * dt);
      p.vx *= k;
      p.vy = p.vy * k + 260 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.age += dt;
      t.y += t.vy * dt;
      if (t.age >= t.life) this.texts.splice(i, 1);
    }
  }

  draw() {
    const ctx = this.ctx;
    const active = this.coins.length || this.parts.length || this.texts.length || this.orbs.length;
    if (!active && !this.dirty) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.dirty = !!active;
    if (!active) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    for (const p of this.parts) {
      const t = p.age / p.life;
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = p.color;
      const r = p.size * (p.star ? (t < 0.3 ? 0.5 + t / 0.6 : 1 - (t - 0.3)) : 1 - t * 0.5);
      ctx.beginPath();
      if (p.star) {
        ctx.moveTo(p.x, p.y - r);
        ctx.quadraticCurveTo(p.x, p.y, p.x + r, p.y);
        ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + r);
        ctx.quadraticCurveTo(p.x, p.y, p.x - r, p.y);
        ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - r);
      } else {
        ctx.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const o of this.orbs) {
      // fading tail, then a bright core with a soft halo
      const tr = o.trail;
      for (let i = 0; i < tr.length; i += 2) {
        const k = (i + 2) / (tr.length + 2);
        ctx.globalAlpha = 0.5 * k;
        ctx.fillStyle = '#35C4FF';
        ctx.beginPath();
        ctx.arc(tr[i], tr[i + 1], 1.5 + 2.5 * k, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#35C4FF';
      ctx.beginPath();
      ctx.arc(o.x, o.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#E6FBFF';
      ctx.beginPath();
      ctx.arc(o.x, o.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const c of this.coins) {
      const s = popScale(Math.min(1, c.age / 0.18), 1.35);
      const flip = Math.max(0.25, Math.abs(Math.cos(c.spin + c.age * 13)));
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(s * flip, s);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.arc(0.8, 1.8, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#F2A41F';
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFD24A';
      ctx.beginPath();
      ctx.arc(0, -0.7, 5.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFF2B8';
      ctx.fillRect(-1, -4, 2, 5.5);
      ctx.restore();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 16px ${FONT}`;
    ctx.lineJoin = 'round';
    for (const t of this.texts) {
      const k = t.age / t.life;
      ctx.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      const s = 0.7 + 0.3 * easeOutCubic(Math.min(1, k * 4));
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(s, s);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(20,24,30,0.7)';
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
