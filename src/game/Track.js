import { CONFIG } from './config.js';
import { angleDiff, clamp } from './utils.js';

/**
 * A closed race circuit baked into an evenly spaced centerline.
 *
 * Built from a rounded polygon (each corner is a circular fillet with its own
 * radius, so straights are truly straight and corner sharpness is explicit),
 * then resampled by arc length and lightly smoothed so curvature eases in and
 * out of each corner. Everything is addressable by distance (0..length) or
 * normalized position t (0..1, wrapping back to 0).
 */
export class Track {
  constructor(circuitDef, trackCfg = CONFIG.track, world = CONFIG.world) {
    this.def = circuitDef;
    this.width = trackCfg.width;
    this.halfWidth = trackCfg.width / 2;

    let pts = buildRoundedLoop(circuitDef.points);
    let res = resampleClosed(pts, trackCfg.sampleSpacing);
    for (let i = 0; i < trackCfg.smoothingPasses; i++) {
      res = resampleClosed(smoothClosed(res.points, trackCfg.smoothingWindow), trackCfg.sampleSpacing);
    }
    pts = res.points;
    centerPoints(pts, world.width / 2, world.height / 2);

    const n = pts.length;
    this.count = n;
    this.step = res.step;
    this.length = res.total;
    this.xs = new Float32Array(n);
    this.ys = new Float32Array(n);
    this.angles = new Float32Array(n);
    this.curvature = new Float32Array(n);
    this.strength = new Float32Array(n); // cached cornerStrength (for curbs / decoration)
    this.turnDir = new Int8Array(n);

    for (let i = 0; i < n; i++) {
      this.xs[i] = pts[i].x;
      this.ys[i] = pts[i].y;
    }
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      this.angles[i] = Math.atan2(this.ys[b] - this.ys[a], this.xs[b] - this.xs[a]);
    }
    for (let i = 0; i < n; i++) {
      const a = this.angles[(i - 1 + n) % n];
      const b = this.angles[(i + 1) % n];
      this.curvature[i] = angleDiff(a, b) / (2 * this.step);
    }
    const info = { strength: 0, dir: 0, delta: 0 };
    for (let i = 0; i < n; i++) {
      this.cornerInfo(i * this.step, info);
      this.strength[i] = info.strength;
      this.turnDir[i] = info.dir;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, this.xs[i]);
      maxX = Math.max(maxX, this.xs[i]);
      minY = Math.min(minY, this.ys[i]);
      maxY = Math.max(maxY, this.ys[i]);
    }
    this.bounds = { minX, minY, maxX, maxY };
  }

  wrap(dist) {
    const L = this.length;
    dist %= L;
    return dist < 0 ? dist + L : dist;
  }

  /** Position + tangent angle + curvature at a path distance. Writes into `out`. */
  sample(dist, out = {}) {
    const d = this.wrap(dist);
    const f = d / this.step;
    const i = Math.floor(f) % this.count;
    const j = (i + 1) % this.count;
    const t = f - Math.floor(f);
    out.x = this.xs[i] + (this.xs[j] - this.xs[i]) * t;
    out.y = this.ys[i] + (this.ys[j] - this.ys[i]) * t;
    out.angle = this.angles[i] + angleDiff(this.angles[i], this.angles[j]) * t;
    out.curvature = this.curvature[i] + (this.curvature[j] - this.curvature[i]) * t;
    return out;
  }

  /** Same as sample() but addressed with normalized t (0..1). */
  sampleT(t, out = {}) {
    return this.sample(t * this.length, out);
  }

  angleAt(dist) {
    const d = this.wrap(dist);
    const f = d / this.step;
    const i = Math.floor(f) % this.count;
    const j = (i + 1) % this.count;
    return this.angles[i] + angleDiff(this.angles[i], this.angles[j]) * (f - Math.floor(f));
  }

  /**
   * Upcoming corner estimate: compare the tangent slightly behind with the
   * tangent slightly ahead. strength 0 = straight, 1 = very sharp corner.
   * dir = +1 turning clockwise on screen (right), -1 turning left.
   */
  cornerInfo(dist, out = {}, drift = CONFIG.drift) {
    const a0 = this.angleAt(dist - drift.lookBehind);
    const a1 = this.angleAt(dist + drift.lookAhead);
    const delta = angleDiff(a0, a1);
    out.delta = delta;
    out.strength = clamp(Math.abs(delta) / drift.cornerAngleForMax, 0, 1);
    out.dir = delta > 0 ? 1 : delta < 0 ? -1 : 0;
    return out;
  }

  /** Index of the nearest baked sample to a distance. */
  indexAt(dist) {
    return Math.round(this.wrap(dist) / this.step) % this.count;
  }

  /** Minimum distance from a world point to the centerline (brute force, used for layout only). */
  distanceTo(x, y, skipFrom = -1, skipTo = -1) {
    let best = Infinity;
    for (let i = 0; i < this.count; i++) {
      if (skipFrom >= 0 && inRangeWrapped(i, skipFrom, skipTo, this.count)) continue;
      const dx = this.xs[i] - x;
      const dy = this.ys[i] - y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
}

function inRangeWrapped(i, from, to, n) {
  from = ((from % n) + n) % n;
  to = ((to % n) + n) % n;
  return from <= to ? i >= from && i <= to : i >= from || i <= to;
}

/** Rounded polygon -> dense closed polyline. Starts halfway along edge 0 -> 1. */
function buildRoundedLoop(points) {
  const n = points.length;
  const corners = [];
  for (let i = 0; i < n; i++) {
    const p = points[(i - 1 + n) % n];
    const v = points[i];
    const q = points[(i + 1) % n];
    let d1x = v[0] - p[0], d1y = v[1] - p[1];
    let d2x = q[0] - v[0], d2y = q[1] - v[1];
    const l1 = Math.hypot(d1x, d1y);
    const l2 = Math.hypot(d2x, d2y);
    d1x /= l1; d1y /= l1; d2x /= l2; d2y /= l2;
    const turn = Math.atan2(d1x * d2y - d1y * d2x, d1x * d2x + d1y * d2y);
    const tanHalf = Math.tan(Math.abs(turn) / 2);
    let r = v[2] ?? 40;
    let tLen = r * tanHalf;
    const maxT = Math.min(l1, l2) * 0.5;
    if (tLen > maxT) {
      tLen = maxT;
      r = tanHalf > 1e-6 ? tLen / tanHalf : r;
    }
    corners.push({ x: v[0], y: v[1], d1x, d1y, d2x, d2y, turn, r, tLen });
  }

  const out = [];
  const start = { x: (points[0][0] + points[1][0]) / 2, y: (points[0][1] + points[1][1]) / 2 };
  out.push(start);
  for (let k = 1; k <= n; k++) {
    const c = corners[k % n];
    const ax = c.x - c.d1x * c.tLen;
    const ay = c.y - c.d1y * c.tLen;
    out.push({ x: ax, y: ay });
    if (Math.abs(c.turn) > 1e-4) {
      const s = Math.sign(c.turn);
      const cx = ax + -c.d1y * s * c.r;
      const cy = ay + c.d1x * s * c.r;
      const a0 = Math.atan2(ay - cy, ax - cx);
      const steps = Math.max(4, Math.ceil((Math.abs(c.turn) * c.r) / 1.5));
      for (let j = 1; j <= steps; j++) {
        const a = a0 + (c.turn * j) / steps;
        out.push({ x: cx + Math.cos(a) * c.r, y: cy + Math.sin(a) * c.r });
      }
    }
  }
  return out;
}

/** Resample a closed polyline to (almost exactly) uniform arc-length spacing. */
function resampleClosed(pts, spacing) {
  const n = pts.length;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const total = cum[n];
  const count = Math.max(16, Math.round(total / spacing));
  const step = total / count;
  const points = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const d = k * step;
    while (seg < n - 1 && cum[seg + 1] < d) seg++;
    const a = pts[seg];
    const b = pts[(seg + 1) % n];
    const segLen = cum[seg + 1] - cum[seg];
    const t = segLen > 1e-9 ? (d - cum[seg]) / segLen : 0;
    points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return { points, step, total };
}

/** Closed box filter: eases curvature in/out of corners. */
function smoothClosed(pts, w) {
  const n = pts.length;
  const out = new Array(n);
  const k = 2 * w + 1;
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0;
    for (let j = -w; j <= w; j++) {
      const p = pts[(i + j + n) % n];
      sx += p.x;
      sy += p.y;
    }
    out[i] = { x: sx / k, y: sy / k };
  }
  return out;
}

function centerPoints(pts, cx, cy) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const dx = cx - (minX + maxX) / 2;
  const dy = cy - (minY + maxY) / 2;
  for (const p of pts) {
    p.x += dx;
    p.y += dy;
  }
}
