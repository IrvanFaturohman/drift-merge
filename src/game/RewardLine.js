import { CONFIG } from './config.js';
import { easeOutCubic, popScale } from './utils.js';

const R = CONFIG.rewardLines;
const tmp = {};

/** One checkpoint across the road at a normalized track position. */
export class RewardLine {
  constructor(index, t) {
    this.index = index;
    this.t = t;
    this.flash = 0;
    this.appearAge = 999;
    this.badgeSide = 1;
  }

  /**
   * True when a car moved across this line between two normalized positions.
   * Handles the 0.99 -> 0.00 wrap, and never fires twice for one crossing
   * because the (prevT, t] intervals of consecutive frames don't overlap.
   */
  crossedBy(prevT, t) {
    if (prevT === t) return false;
    if (t > prevT) return this.t > prevT && this.t <= t;
    return this.t > prevT || this.t <= t;
  }
}

export class RewardLineManager {
  constructor() {
    this.lines = [];
    this.track = null;
    this.setCount(R.startCount, false);
  }

  get count() {
    return this.lines.length;
  }

  setCount(n, animate = true) {
    n = Math.max(1, Math.min(n, R.max));
    while (this.lines.length < n) {
      const i = this.lines.length;
      const line = new RewardLine(i, R.positions[i] ?? i / R.max);
      if (animate) line.appearAge = 0;
      this.lines.push(line);
    }
    this.lines.length = n;
    if (this.track) this.onTrackChanged(this.track);
  }

  /** Lines live in normalized space, so a new circuit only needs badge placement. */
  onTrackChanged(track) {
    this.track = track;
    for (const line of this.lines) line.badgeSide = this.pickBadgeSide(track, line.t);
  }

  pickBadgeSide(track, t) {
    const p = track.sampleT(t, tmp);
    const nx = -Math.sin(p.angle);
    const ny = Math.cos(p.angle);
    const off = track.halfWidth + 13;
    const skipA = track.indexAt(t * track.length) - 30;
    const skipB = skipA + 60;
    const dPos = track.distanceTo(p.x + nx * off, p.y + ny * off, skipA, skipB);
    const dNeg = track.distanceTo(p.x - nx * off, p.y - ny * off, skipA, skipB);
    return dPos >= dNeg ? 1 : -1;
  }

  update(dt) {
    for (const line of this.lines) {
      line.flash = Math.max(0, line.flash - dt / R.flashDuration);
      line.appearAge += dt;
    }
  }

  draw(ctx, track, time) {
    if (R.showNextGhost && this.lines.length < R.max) {
      this.drawGhost(ctx, track, R.positions[this.lines.length], time);
    }
    for (const line of this.lines) this.drawLine(ctx, track, line);
  }

  drawGhost(ctx, track, t, time) {
    const p = track.sampleT(t, tmp);
    const half = track.halfWidth - 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.globalAlpha = 0.28 + 0.08 * Math.sin(time * 3);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, -half);
    ctx.lineTo(0, half);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawLine(ctx, track, line) {
    const p = track.sampleT(line.t, tmp);
    const half = track.halfWidth;
    const appear = Math.min(1, line.appearAge / 0.45);
    const grow = easeOutCubic(appear);
    const f = line.flash;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);

    const thick = 5 + f * 2.5;
    if (line.index === 0) {
      // checkered start / finish
      const cells = 8;
      const cell = (half * 2) / cells;
      const rows = 2;
      const ch = thick / rows + 0.6;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cells; c++) {
          ctx.fillStyle = (r + c) % 2 ? '#1F2328' : '#F7F7F7';
          ctx.fillRect(-thick / 2 + r * ch, -half + c * cell, ch, cell);
        }
      }
    } else {
      ctx.fillStyle = '#FFC93C';
      ctx.fillRect(-thick / 2, -half * grow, thick, half * 2 * grow);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(-0.6, -half * grow, 1.2, half * 2 * grow);
    }
    if (f > 0) {
      ctx.globalAlpha = f * 0.85;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(-thick / 2 - 1, -half, thick + 2, half * 2);
      ctx.globalAlpha = 1;
    }

    // coin badge beside the track
    const side = line.badgeSide;
    const by = side * (half + 12);
    const bs = popScale(appear, 1.3) * (1 + f * 0.25);
    ctx.translate(0, by);
    ctx.rotate(-p.angle);
    ctx.scale(bs, bs);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.arc(0.8, 1.6, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#F2A41F';
    ctx.beginPath();
    ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = f > 0.3 ? '#FFF2B8' : '#FFD24A';
    ctx.beginPath();
    ctx.arc(0, -0.6, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9A5B00';
    ctx.font = '700 9px Fredoka, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', 0, -0.2);
    ctx.restore();
  }
}
