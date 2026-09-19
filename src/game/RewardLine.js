import { CONFIG } from './config.js';
import { popScale } from './utils.js';

const R = CONFIG.rewardLines;
const tmp = {};
const tmpG = {};

/** One checkpoint across the road at a normalized track position. */
export class RewardLine {
  constructor(index, t) {
    this.index = index;
    this.t = t;
    this.flash = 0;
    this.appearAge = 999;
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

  onTrackChanged(track) {
    this.track = track;
  }

  update(dt) {
    for (const line of this.lines) {
      line.flash = Math.max(0, line.flash - dt / R.flashDuration);
      line.appearAge += dt;
    }
  }

  /**
   * Ground layer (under cars). Only the start/finish (line 0) gets a checkered
   * line painted on the asphalt; the other reward lines are just gantries.
   * Also draws every gantry's shadow and the next-line preview.
   */
  drawGround(ctx, track, time) {
    if (R.showNextGhost && this.lines.length < R.max) {
      this.drawGhost(ctx, track, R.positions[this.lines.length], time);
    }
    const G = R.gantry;
    const half = track.halfWidth;
    for (const line of this.lines) {
      if (line.index === 0) this.drawFinishPaint(ctx, track, line);
      // the gantry is elevated: its shadow falls further away than a car's
      const gp = this.gantryPose(track, line);
      ctx.save();
      ctx.translate(gp.x + G.shadowOffset.x, gp.y + G.shadowOffset.y);
      ctx.rotate(gp.angle);
      this.gantryShape(ctx, line, half, true);
      ctx.restore();
    }
  }

  drawFinishPaint(ctx, track, line) {
    const P = R.paint;
    const half = track.halfWidth;
    const f = line.flash;
    const p = track.sampleT(line.t, tmp);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    const cells = Math.max(4, Math.round((half * 2) / P.cell));
    const cell = (half * 2) / cells;
    for (let r = 0; r < P.rows; r++) {
      for (let c = 0; c < cells; c++) {
        ctx.fillStyle = (r + c) % 2 ? P.dark : P.light;
        ctx.fillRect((r - P.rows / 2) * cell, -half + c * cell, cell + 0.05, cell + 0.05);
      }
    }
    if (f > 0.01) {
      ctx.globalAlpha = f * 0.7;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect((-P.rows / 2) * cell - 1, -half, P.rows * cell + 2, half * 2);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** Overhead layer (above cars): the gantry itself, so cars drive underneath. */
  drawOverhead(ctx, track) {
    for (const line of this.lines) {
      const gp = this.gantryPose(track, line);
      ctx.save();
      ctx.translate(gp.x, gp.y);
      ctx.rotate(gp.angle);
      this.gantryShape(ctx, line, track.halfWidth, false);
      ctx.restore();
    }
  }

  /**
   * The start/finish gantry stands just past its painted line so both stay
   * visible; the other gantries stand exactly on their payout point.
   */
  gantryPose(track, line) {
    const offset = line.index === 0 ? R.gantry.finishOffset : 0;
    return track.sample(line.t * track.length + offset, tmpG);
  }

  /** Local space: x along the track, y across it. Two poles, a beam, a checkered banner with green ends. */
  gantryShape(ctx, line, half, shadow) {
    const G = R.gantry;
    const C = G.colors;
    const appear = Math.min(1, line.appearAge / 0.5);
    const reach = popScale(appear, 1.12); // unfolds from the middle when bought
    if (reach <= 0.01) return;
    const f = line.flash;
    const span = (half + G.poleInset) * reach;
    const o = G.outline;
    const fill = (color) => (ctx.fillStyle = shadow ? G.shadowColor : color);

    // beam
    const bw = G.beamWidth;
    fill(C.outline);
    roundRect(ctx, -bw / 2 - o, -span, bw + o * 2, span * 2, (bw + o * 2) / 2);
    ctx.fill();
    if (!shadow) {
      fill(C.beam);
      roundRect(ctx, -bw / 2, -span, bw, span * 2, bw / 2);
      ctx.fill();
    }

    // poles
    for (const side of [-1, 1]) {
      fill(C.outline);
      ctx.beginPath();
      ctx.arc(0, side * span, G.poleRadius + o, 0, Math.PI * 2);
      ctx.fill();
      if (!shadow) {
        fill(C.pole);
        ctx.beginPath();
        ctx.arc(0, side * span, G.poleRadius, 0, Math.PI * 2);
        ctx.fill();
        fill(C.poleLight);
        ctx.beginPath();
        ctx.arc(-G.poleRadius * 0.3, side * span - G.poleRadius * 0.3, G.poleRadius * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // banner (pops when a car crosses)
    const pop = 1 + f * f * 0.22;
    const bl = G.bannerLength * reach * pop;
    const bt = G.bannerWidth * pop;
    fill(C.outline);
    roundRect(ctx, -bt / 2 - o, -bl / 2 - o, bt + o * 2, bl + o * 2, bt / 2 + o);
    ctx.fill();
    if (shadow) return;
    fill(C.cap);
    roundRect(ctx, -bt / 2, -bl / 2, bt, bl, bt / 2);
    ctx.fill();
    // checkered middle between the green end caps
    const cap = G.capLength * pop;
    const inner = bl - cap * 2;
    const cell = bt / 2;
    const cols = Math.max(2, Math.round(inner / cell));
    const cw = inner / cols;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = (r + c) % 2 ? C.checkDark : C.checkLight;
        ctx.fillRect(-bt / 2 + r * cell, -bl / 2 + cap + c * cw, cell, cw + 0.05);
      }
    }
    if (f > 0.01) {
      ctx.globalAlpha = f * 0.75;
      ctx.fillStyle = '#FFFFFF';
      roundRect(ctx, -bt / 2, -bl / 2, bt, bl, bt / 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** Faint dashed preview of the next reward gantry to buy. */
  drawGhost(ctx, track, t, time) {
    const G = R.gantry;
    const span = track.halfWidth + G.poleInset;
    const p = track.sampleT(t, tmp);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.globalAlpha = 0.3 + 0.1 * Math.sin(time * 3);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, -span);
    ctx.lineTo(0, span);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(0, side * span, G.poleRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
