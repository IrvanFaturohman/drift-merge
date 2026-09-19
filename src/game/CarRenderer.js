import { CONFIG, tierDef } from './config.js';
import { shade } from './utils.js';

/**
 * Procedural top-down car art. Local space: +x = nose, +y = right side.
 * Shapes are normalized (x: -1 tail .. 1 nose, y: 0 centre .. 1 side) and
 * scaled by each tier's length / width, so silhouettes differ per tier
 * instead of just scaling one rectangle.
 */
const SHAPES = {
  // Tier 1 - small boxy hatchback, big glasshouse
  hatch: {
    profile: [[1, 0.74], [0.93, 0.94], [0.72, 1], [-0.8, 1], [-0.96, 0.96], [-1, 0.84]],
    windshield: [0.46, 0.16, 0.72, 0.84],
    roof: [0.16, -0.56, 0.84, 0.82],
    rearWindow: [-0.56, -0.78, 0.8, 0.7],
    axles: [0.56, -0.58],
    stripes: null,
    spoiler: null,
    headlights: [0.9, 0.58],
    taillights: [-0.95, 0.64],
  },
  // Tier 2 - compact tuner: hood vent, centre stripe, small spoiler
  tuner: {
    profile: [[1, 0.68], [0.92, 0.9], [0.66, 1], [-0.82, 1], [-0.96, 0.95], [-1, 0.8]],
    windshield: [0.36, 0.08, 0.72, 0.84],
    roof: [0.08, -0.5, 0.84, 0.8],
    rearWindow: [-0.5, -0.7, 0.78, 0.68],
    axles: [0.58, -0.6],
    stripes: { count: 1, width: 0.22, gap: 0 },
    spoiler: { x: -0.9, depth: 0.1, span: 0.92, plates: false },
    hoodVent: [0.72, 0.52, 0.36],
    headlights: [0.9, 0.56],
    taillights: [-0.95, 0.62],
  },
  // Tier 3 - sport coupe: longer tapered nose, cabin set back, twin stripes
  coupe: {
    profile: [[1, 0.56], [0.9, 0.84], [0.62, 0.97], [0.2, 0.92], [-0.4, 1], [-0.9, 0.97], [-1, 0.8]],
    windshield: [0.24, -0.04, 0.68, 0.8],
    roof: [-0.04, -0.44, 0.8, 0.76],
    rearWindow: [-0.44, -0.64, 0.74, 0.6],
    axles: [0.6, -0.6],
    stripes: { count: 2, width: 0.12, gap: 0.12 },
    spoiler: { x: -0.93, depth: 0.07, span: 0.82, plates: false },
    headlights: [0.88, 0.5],
    taillights: [-0.95, 0.62],
  },
  // Tier 4 - performance car: wide rear fenders, side intakes, wing
  sports: {
    profile: [[1, 0.5], [0.88, 0.8], [0.55, 0.96], [0.15, 0.86], [-0.35, 1], [-0.88, 1], [-1, 0.86]],
    windshield: [0.2, -0.1, 0.64, 0.78],
    roof: [-0.1, -0.4, 0.78, 0.72],
    rearWindow: [-0.4, -0.58, 0.68, 0.54],
    axles: [0.6, -0.6],
    stripes: { count: 2, width: 0.1, gap: 0.1 },
    spoiler: { x: -0.9, depth: 0.1, span: 1.04, plates: true },
    sideIntakes: [-0.14, -0.36],
    headlights: [0.86, 0.44],
    taillights: [-0.95, 0.7],
  },
  // Tier 5 - supercar wedge: cab-forward, engine cover vents, big wing
  super: {
    profile: [[1, 0.42], [0.9, 0.7], [0.6, 0.88], [0.25, 0.84], [-0.2, 1], [-0.86, 1], [-1, 0.9]],
    windshield: [0.34, 0.02, 0.58, 0.74],
    roof: [0.02, -0.22, 0.74, 0.7],
    rearWindow: null,
    engineVents: [-0.3, -0.74, 0.5],
    axles: [0.62, -0.6],
    stripes: { count: 1, width: 0.08, gap: 0 },
    spoiler: { x: -0.9, depth: 0.12, span: 1.08, plates: true },
    sideIntakes: [-0.1, -0.34],
    headlights: [0.84, 0.36],
    taillights: [-0.96, 0.74],
  },
  // Tier 6 - hypercar: needle nose, central fin, huge wing
  hyper: {
    profile: [[1, 0.34], [0.9, 0.62], [0.62, 0.84], [0.3, 0.8], [-0.15, 1], [-0.84, 1], [-1, 0.94]],
    windshield: [0.36, 0.06, 0.52, 0.68],
    roof: [0.06, -0.18, 0.68, 0.62],
    rearWindow: null,
    engineVents: [-0.26, -0.72, 0.44],
    fin: [-0.18, -0.9],
    axles: [0.62, -0.6],
    stripes: { count: 2, width: 0.08, gap: 0.14 },
    spoiler: { x: -0.9, depth: 0.12, span: 1.12, plates: true },
    sideIntakes: [-0.06, -0.3],
    headlights: [0.82, 0.3],
    taillights: [-0.96, 0.78],
  },
};

const cache = new Map();

function smoothOutline(pts) {
  // pts: closed polygon; draw quadratic curves through edge midpoints
  const p = new Path2D();
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(pts[n - 1], pts[0]);
  p.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const m = mid(cur, pts[(i + 1) % n]);
    p.quadraticCurveTo(cur[0], cur[1], m[0], m[1]);
  }
  p.closePath();
  return p;
}

function quad(hx, hy, [xf, xb, wf, wb], inset = 0) {
  // trapezoid from front edge (xf, half-width wf) to back edge (xb, half-width wb)
  const pts = [
    [xf * hx, -wf * hy + inset],
    [xf * hx, wf * hy - inset],
    [xb * hx, wb * hy - inset],
    [xb * hx, -wb * hy + inset],
  ];
  const p = new Path2D();
  // lightly rounded corners
  const r = Math.min(1.4, Math.abs(xf - xb) * hx * 0.3);
  p.moveTo((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2);
  for (let i = 1; i <= 4; i++) {
    const a = pts[i % 4];
    const b = pts[(i + 1) % 4];
    p.arcTo(a[0], a[1], b[0], b[1], r);
  }
  p.closePath();
  return p;
}

function rect(p, x, y, w, h) {
  p.rect(x, y, w, h);
}

function buildTierArt(tier) {
  const def = tierDef(tier);
  const s = SHAPES[def.shape] ?? SHAPES.hatch;
  const hx = def.length / 2;
  const hy = def.width / 2;
  const C = CONFIG.cars;

  const outline = [];
  for (const [x, y] of s.profile) outline.push([x * hx, y * hy]);
  for (let i = s.profile.length - 1; i >= 0; i--) outline.push([s.profile[i][0] * hx, -s.profile[i][1] * hy]);
  const body = smoothOutline(outline);

  const windshield = quad(hx, hy, s.windshield);
  const roof = quad(hx, hy, [s.roof[0], s.roof[1], s.roof[2], s.roof[3]], 0.4);
  const rearWindow = s.rearWindow ? quad(hx, hy, s.rearWindow) : null;

  // stripes: hood + trunk segments (roof segment drawn over the roof)
  let stripesBody = null;
  let stripesRoof = null;
  if (s.stripes) {
    stripesBody = new Path2D();
    stripesRoof = new Path2D();
    const { count, width, gap } = s.stripes;
    const sw = width * hy;
    const offsets = count === 1 ? [0] : [-(gap * hy) / 2 - sw / 2, (gap * hy) / 2 + sw / 2];
    const noseX = 0.96 * hx;
    const tailX = -0.97 * hx;
    for (const o of offsets) {
      rect(stripesBody, s.windshield[0] * hx, o - sw / 2, noseX - s.windshield[0] * hx, sw);
      const backStart = (s.rearWindow ? s.rearWindow[1] : s.roof[1]) * hx;
      rect(stripesBody, tailX, o - sw / 2, backStart - tailX, sw);
      rect(stripesRoof, s.roof[1] * hx, o - sw / 2, (s.roof[0] - s.roof[1]) * hx, sw);
    }
  }

  const details = new Path2D(); // dark accents: vents, intakes
  if (s.hoodVent) {
    const [xf, xb, w] = s.hoodVent;
    rect(details, xb * hx, -w * hy * 0.5, (xf - xb) * hx, w * hy);
  }
  if (s.sideIntakes) {
    const [xf, xb] = s.sideIntakes;
    for (const side of [-1, 1]) {
      const y0 = side > 0 ? hy * 0.74 : -hy * 0.74 - hy * 0.14;
      rect(details, xb * hx, y0, (xf - xb) * hx, hy * 0.14);
    }
  }
  if (s.engineVents) {
    const [xf, xb, w] = s.engineVents;
    const slats = 4;
    const span = (xf - xb) * hx;
    for (let i = 0; i < slats; i++) {
      rect(details, xb * hx + (span / slats) * i + 0.3, -w * hy, span / slats - 1.1, w * hy * 2);
    }
  }
  let fin = null;
  if (s.fin) {
    fin = new Path2D();
    rect(fin, s.fin[1] * hx, -0.5, (s.fin[0] - s.fin[1]) * hx, 1);
  }

  let spoiler = null;
  if (s.spoiler) {
    spoiler = new Path2D();
    const { x, depth, span, plates } = s.spoiler;
    const sx = x * hx;
    const d = depth * hx;
    rect(spoiler, sx - d / 2, -span * hy, d, span * hy * 2);
    if (plates) {
      rect(spoiler, sx - d, -span * hy - 0.6, d * 2, 1.4);
      rect(spoiler, sx - d, span * hy - 0.8, d * 2, 1.4);
    }
  }

  const lights = new Path2D();
  const tails = new Path2D();
  {
    const [lx, ly] = s.headlights;
    const lw = hx * 0.1;
    const lh = hy * 0.26;
    rect(lights, lx * hx - lw / 2, ly * hy - lh / 2, lw, lh);
    rect(lights, lx * hx - lw / 2, -ly * hy - lh / 2, lw, lh);
    const [tx, ty] = s.taillights;
    const tw = hx * 0.07;
    const th = hy * 0.26;
    rect(tails, tx * hx - tw / 2, ty * hy - th / 2, tw, th);
    rect(tails, tx * hx - tw / 2, -ty * hy - th / 2, tw, th);
  }

  const wheelL = def.length * 0.17;
  const wheelW = def.width * 0.2;
  const wheelY = hy - wheelW * 0.25;

  return {
    def,
    hx,
    hy,
    body,
    windshield,
    roof,
    rearWindow,
    stripesBody,
    stripesRoof,
    details,
    fin,
    spoiler,
    lights,
    tails,
    wheelL,
    wheelW,
    wheelY,
    frontAxle: s.axles[0] * hx,
    rearAxle: s.axles[1] * hx,
    colors: {
      body: def.body,
      roof: shade(def.body, 0.16),
      dark: shade(def.body, -0.42),
      accent: def.accent,
      glass: C.windowColor,
      glassShine: 'rgba(255,255,255,0.16)',
    },
  };
}

export function getTierArt(tier) {
  if (!cache.has(tier)) cache.set(tier, buildTierArt(tier));
  return cache.get(tier);
}

/** Rear axle geometry (local space) for skid marks / smoke. */
export function rearWheelLocal(tier) {
  const art = getTierArt(tier);
  return { x: art.rearAxle, y: art.wheelY };
}

export function drawCarShadow(ctx, car) {
  const art = getTierArt(car.tier);
  const so = CONFIG.cars.shadowOffset;
  const s = car.renderScale;
  if (s <= 0.01 || car.alpha <= 0.01) return;
  // while dropping, the shadow sits further away and fainter (height illusion)
  const lift = 1 + car.height * 6;
  const shadowScale = car.dropping ? 1 : s;
  ctx.save();
  ctx.globalAlpha = car.alpha * (1 - car.height * 0.55);
  ctx.translate(car.x + so.x * lift, car.y + so.y * lift);
  ctx.rotate(car.bodyAngle);
  ctx.scale(shadowScale * car.stretchX, shadowScale * car.stretchY);
  ctx.fillStyle = CONFIG.cars.shadowColor;
  ctx.fill(art.body);
  ctx.restore();
}

const trailPts = []; // x, y, nx, ny, halfWidth per sample (reused every frame)

/** Tapered cyan light ribbon behind a boosted car. */
export function drawTrail(ctx, car) {
  const J = CONFIG.juice;
  const v = Math.min(1, car.nosVisual + car.nosKick * 0.3);
  const n = car.trailCount;
  if (v < 0.06 || n < 4 || car.dropping) return;
  const N = J.trailLength;
  const tr = car.trail;
  const at = (i) => ((car.trailHead - 1 - i + N * 2) % N) * 2; // i = 0 is the newest sample
  const baseW = car.def.width * J.trailWidth * (0.55 + 0.45 * v);
  trailPts.length = 0;
  let nx = 0;
  let ny = 0;
  for (let i = 0; i < n; i++) {
    const o = at(i);
    const a = at(Math.max(0, i - 1));
    const b = at(Math.min(n - 1, i + 1));
    const dx = tr[a] - tr[b];
    const dy = tr[a + 1] - tr[b + 1];
    const len = Math.hypot(dx, dy);
    if (len > 0.001) {
      nx = -dy / len;
      ny = dx / len;
    }
    trailPts.push(tr[o], tr[o + 1], nx, ny, (baseW * (1 - i / (n - 1))) / 2);
  }
  const ribbon = (widthScale) => {
    ctx.beginPath();
    for (let i = 0; i < trailPts.length; i += 5) {
      const w = trailPts[i + 4] * widthScale;
      ctx.lineTo(trailPts[i] + trailPts[i + 2] * w, trailPts[i + 1] + trailPts[i + 3] * w);
    }
    for (let i = trailPts.length - 5; i >= 0; i -= 5) {
      const w = trailPts[i + 4] * widthScale;
      ctx.lineTo(trailPts[i] - trailPts[i + 2] * w, trailPts[i + 1] - trailPts[i + 3] * w);
    }
    ctx.closePath();
    ctx.fill();
  };
  ctx.globalAlpha = J.trailAlpha * v;
  ctx.fillStyle = CONFIG.nos.colors.outer;
  ribbon(1);
  ctx.globalAlpha = Math.min(1, J.trailAlpha * v * 1.4);
  ctx.fillStyle = CONFIG.nos.colors.core;
  ribbon(0.35);
  ctx.globalAlpha = 1;
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

function drawWheel(ctx, x, y, angle, art) {
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  roundRect(ctx, -art.wheelL / 2, -art.wheelW / 2, art.wheelL, art.wheelW, art.wheelW * 0.4);
  ctx.fill();
  ctx.restore();
}

/** NOS flame in car-local space, drawn before the body so it sits under the bumper. */
function drawFlame(ctx, car, art, time) {
  const N = CONFIG.nos;
  const v = car.nosVisual;
  const kick = car.nosKick;
  if (v < 0.03 && kick < 0.05) return;
  const L = art.def.length;
  const flicker = 0.86 + 0.28 * (0.5 + 0.5 * Math.sin(time * 47 + car.phase) * Math.sin(time * 29 + car.phase * 1.7));
  const len =
    (L * (N.flameMinLength + (N.flameMaxLength - N.flameMinLength) * Math.min(v, 1)) + kick * L * N.flameKickLength) *
    flicker *
    N.visualIntensity;
  const dual = art.def.exhausts > 1;
  const baseW = art.def.width * N.flameWidth * (dual ? 0.78 : 1) * (0.75 + 0.35 * Math.min(1, v + kick * 0.5));
  const rx = -art.hx + 1.2;
  const ys = dual ? [-art.hy * 0.42, art.hy * 0.42] : [0];
  const layers = [
    [N.colors.outer, 1, 1, 0.9],
    [N.colors.mid, 0.68, 0.64, 0.95],
    [N.colors.core, 0.36, 0.34, 1],
  ];
  for (const [color, lk, wk, alpha] of layers) {
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    for (const ey of ys) {
      const l = len * lk;
      const w = baseW * wk;
      ctx.beginPath();
      ctx.moveTo(rx, ey - w / 2);
      ctx.quadraticCurveTo(rx - l * 0.55, ey - w * 0.62, rx - l, ey);
      ctx.quadraticCurveTo(rx - l * 0.55, ey + w * 0.62, rx, ey + w / 2);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

export function drawCar(ctx, car, time) {
  const art = getTierArt(car.tier);
  const s = car.renderScale;
  if (s <= 0.01) return;
  const c = art.colors;
  if (car.alpha <= 0.01) return;
  ctx.save();
  if (car.alpha < 1) ctx.globalAlpha = car.alpha;
  ctx.translate(car.x + car.jitterX, car.y + car.jitterY);
  ctx.rotate(car.bodyAngle);
  ctx.scale(s * car.stretchX, s * car.stretchY);

  drawFlame(ctx, car, art, time);

  // wheels (front ones steer / counter-steer)
  ctx.fillStyle = CONFIG.cars.wheelColor;
  drawWheel(ctx, art.rearAxle, art.wheelY, 0, art);
  drawWheel(ctx, art.rearAxle, -art.wheelY, 0, art);
  drawWheel(ctx, art.frontAxle, art.wheelY, car.steer, art);
  drawWheel(ctx, art.frontAxle, -art.wheelY, car.steer, art);

  ctx.fillStyle = c.body;
  ctx.fill(art.body);

  if (art.stripesBody) {
    ctx.fillStyle = c.accent;
    ctx.fill(art.stripesBody);
  }
  ctx.fillStyle = c.dark;
  ctx.fill(art.details);

  ctx.fillStyle = c.glass;
  ctx.fill(art.windshield);
  if (art.rearWindow) ctx.fill(art.rearWindow);
  ctx.fillStyle = c.roof;
  ctx.fill(art.roof);
  if (art.stripesRoof) {
    ctx.fillStyle = c.accent;
    ctx.fill(art.stripesRoof);
  }
  if (art.fin) {
    ctx.fillStyle = c.dark;
    ctx.fill(art.fin);
  }
  if (art.spoiler) {
    ctx.fillStyle = art.def.shape === 'hyper' ? c.accent : c.dark;
    ctx.fill(art.spoiler);
  }
  ctx.fillStyle = CONFIG.cars.headlightColor;
  ctx.fill(art.lights);
  ctx.fillStyle = CONFIG.cars.taillightColor;
  ctx.fill(art.tails);

  if (car.flash > 0.01) {
    ctx.globalAlpha = car.flash * 0.75 * car.alpha;
    ctx.fillStyle = '#FFFFFF';
    ctx.fill(art.body);
  }
  ctx.restore();
}

/** Fading silhouette used when a merged car flies into its partner. */
export function drawGhost(ctx, ghost) {
  const art = getTierArt(ghost.tier);
  const t = Math.min(1, ghost.age / ghost.life);
  const s = 1 - 0.55 * t;
  ctx.save();
  ctx.globalAlpha = (1 - t) * 0.85;
  ctx.translate(ghost.x, ghost.y);
  ctx.rotate(ghost.angle);
  ctx.scale(s, s);
  ctx.fillStyle = art.colors.body;
  ctx.fill(art.body);
  ctx.globalAlpha = (1 - t) * 0.6;
  ctx.fillStyle = '#FFFFFF';
  ctx.fill(art.body);
  ctx.restore();
}
