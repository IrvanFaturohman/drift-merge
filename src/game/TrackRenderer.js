import { CONFIG } from './config.js';
import { mulberry32, shade } from './utils.js';

/**
 * Bakes the static part of a circuit (ground, decoration, asphalt, curbs)
 * into an offscreen canvas. Re-rendered only on resize or circuit change.
 */
export function renderTrackLayer(layer, track, circuit, circuitIndex, view) {
  const theme = CONFIG.themes[circuit.theme];
  const T = CONFIG.track;
  if (layer.width !== view.pw || layer.height !== view.ph) {
    layer.width = view.pw;
    layer.height = view.ph;
  }
  const ctx = layer.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, view.pw, view.ph);

  const k = view.dpr * view.scale;
  ctx.setTransform(k, 0, 0, k, view.dpr * view.ox, view.dpr * view.oy);
  const vis = {
    x0: -view.ox / view.scale,
    y0: -view.oy / view.scale,
    x1: (view.cw - view.ox) / view.scale,
    y1: (view.ch - view.oy) / view.scale,
  };

  drawGroundStripes(ctx, theme, vis);
  const decor = buildDecor(track, theme, circuitIndex, vis);
  for (const d of decor) if (d.kind === 'lake') drawLake(ctx, d, theme);
  drawTrackSurface(ctx, track, theme, T);
  drawCurbs(ctx, track, theme, T);
  for (const d of decor) if (d.kind !== 'lake') drawDecor(ctx, d, theme);
  drawTireStacks(ctx, track, T);
}

function drawGroundStripes(ctx, theme, vis) {
  ctx.save();
  ctx.fillStyle = theme.stripe;
  const cx = (vis.x0 + vis.x1) / 2;
  const cy = (vis.y0 + vis.y1) / 2;
  ctx.translate(cx, cy);
  ctx.rotate(-0.42);
  const reach = Math.hypot(vis.x1 - vis.x0, vis.y1 - vis.y0);
  const band = 34;
  for (let x = -reach; x < reach; x += band * 2) ctx.fillRect(x, -reach, band, reach * 2);
  ctx.restore();
}

function centerlinePath(track) {
  const p = new Path2D();
  p.moveTo(track.xs[0], track.ys[0]);
  for (let i = 1; i < track.count; i++) p.lineTo(track.xs[i], track.ys[i]);
  p.closePath();
  return p;
}

function offsetPath(track, offset, from = 0, to = track.count, closed = true) {
  const p = new Path2D();
  const n = track.count;
  for (let k = from; k <= to; k++) {
    const i = ((k % n) + n) % n;
    const a = track.angles[i];
    const x = track.xs[i] - Math.sin(a) * offset;
    const y = track.ys[i] + Math.cos(a) * offset;
    if (k === from) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  if (closed) p.closePath();
  return p;
}

function drawTrackSurface(ctx, track, theme, T) {
  const path = centerlinePath(track);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // soft darker rim so the track pops off the ground (flat, no gradient)
  ctx.strokeStyle = 'rgba(0,0,0,0.07)';
  ctx.lineWidth = T.width + T.shoulderWidth * 2 + 6;
  ctx.stroke(path);
  ctx.strokeStyle = theme.shoulder;
  ctx.lineWidth = T.width + T.shoulderWidth * 2;
  ctx.stroke(path);
  ctx.strokeStyle = theme.asphalt;
  ctx.lineWidth = T.width;
  ctx.stroke(path);

  // painted edge lines
  const off = T.width / 2 - T.edgeLineInset;
  ctx.strokeStyle = theme.edgeLine;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = T.edgeLineWidth;
  ctx.stroke(offsetPath(track, off));
  ctx.stroke(offsetPath(track, -off));
  ctx.globalAlpha = 1;
}

/** Contiguous index runs where `test(i)` holds (handles wrap-around). */
function findRuns(n, test) {
  const runs = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (test(i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) {
    if (runs.length && runs[0][0] === 0) runs[0][0] = start - n;
    else runs.push([start, n - 1]);
  }
  return runs;
}

function drawCurbs(ctx, track, theme, T) {
  const runs = findRuns(track.count, (i) => track.strength[i] > T.curbThreshold);
  const off = T.width / 2 + T.curbWidth / 2 - 0.5;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.lineWidth = T.curbWidth;
  for (const [a, b] of runs) {
    if (b - a < 6) continue;
    for (const side of [1, -1]) {
      const p = offsetPath(track, off * side, a, b, false);
      ctx.setLineDash([]);
      ctx.strokeStyle = theme.curbB;
      ctx.stroke(p);
      ctx.setLineDash([T.curbDash, T.curbDash]);
      ctx.strokeStyle = theme.curbA;
      ctx.stroke(p);
    }
  }
  ctx.setLineDash([]);
}

/** Small tyre barriers on the outside of the sharpest corners - signals "drift zone". */
function drawTireStacks(ctx, track, T) {
  const runs = findRuns(track.count, (i) => track.strength[i] >= T.tireStackThreshold);
  const n = track.count;
  const clearance = T.width / 2 + T.shoulderWidth + 9;
  const dist = T.width / 2 + T.shoulderWidth + 10;
  const tireR = 3.6;
  for (const [a, b] of runs) {
    if (b - a < 4) continue;
    const mid = Math.round((a + b) / 2);
    // follow the outside of the corner around its apex
    const spots = [];
    const span = Math.min(14, Math.floor((b - a) / 2) + 4);
    const dir = track.turnDir[((mid % n) + n) % n] || 1;
    let last = null;
    for (let k = -span; k <= span; k++) {
      const i = (((mid + k) % n) + n) % n;
      const ang = track.angles[i];
      const x = track.xs[i] + Math.sin(ang) * dir * dist;
      const y = track.ys[i] - Math.cos(ang) * dir * dist;
      if (last && Math.hypot(x - last.x, y - last.y) < tireR * 2.1) continue;
      last = { x, y };
      spots.push({ x, y, ok: track.distanceTo(x, y) >= clearance });
    }
    if (spots.filter((s) => s.ok).length < spots.length * 0.7) continue;
    spots.forEach((s, j) => {
      if (!s.ok) return;
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath();
      ctx.arc(s.x + 0.8, s.y + 1.4, tireR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2A2D33';
      ctx.beginPath();
      ctx.arc(s.x, s.y, tireR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = j % 2 === 0 ? '#E5483F' : '#F2F2F2';
      ctx.beginPath();
      ctx.arc(s.x, s.y, tireR * 0.48, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

// ------------------------------------------------------------ decoration

function buildDecor(track, theme, circuitIndex, vis) {
  const rng = mulberry32(1337 + circuitIndex * 7919);
  const T = CONFIG.track;
  const edge = T.width / 2 + T.shoulderWidth;
  const items = [];
  const pad = 10;
  const x0 = vis.x0 - pad, x1 = vis.x1 + pad, y0 = vis.y0 - pad, y1 = vis.y1 + pad;

  const fits = (x, y, r, gap = 3) => {
    if (track.distanceTo(x, y) < edge + r + 5) return false;
    for (const o of items) {
      const min = r + o.r + gap;
      if ((o.x - x) ** 2 + (o.y - y) ** 2 < min * min) return false;
    }
    return true;
  };

  if (theme.decor === 'lake') {
    // put a lake in the emptiest spot of the infield/outfield
    let best = null;
    for (let y = vis.y0 + 40; y < vis.y1 - 40; y += 8) {
      for (let x = vis.x0 + 40; x < vis.x1 - 40; x += 8) {
        const d = track.distanceTo(x, y);
        if (!best || d > best.d) best = { x, y, d };
      }
    }
    if (best && best.d > edge + 30) {
      const r = Math.min(best.d - edge - 12, 70);
      const pts = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const rr = r * (0.82 + rng() * 0.2);
        pts.push([best.x + Math.cos(a) * rr * 1.1, best.y + Math.sin(a) * rr * 0.9]);
      }
      items.push({ kind: 'lake', x: best.x, y: best.y, r: r * 1.1, pts });
    }
  }

  const want = theme.decor === 'rocks' ? { big: 16, small: 26 } : { big: 30, small: 22 };
  let tries = 0;
  let big = 0, small = 0;
  while ((big < want.big || small < want.small) && tries++ < 1400) {
    const x = x0 + rng() * (x1 - x0);
    const y = y0 + rng() * (y1 - y0);
    const isBig = big < want.big && (small >= want.small || rng() < 0.55);
    if (theme.decor === 'rocks') {
      const r = isBig ? 6 + rng() * 7 : 3 + rng() * 3;
      if (!fits(x, y, r)) continue;
      if (isBig) {
        const pts = [];
        const sides = 7;
        for (let i = 0; i < sides; i++) {
          const a = (i / sides) * Math.PI * 2 + rng() * 0.4;
          const rr = r * (0.75 + rng() * 0.3);
          pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
        }
        items.push({ kind: 'rock', x, y, r, pts });
        big++;
      } else {
        items.push({ kind: rng() < 0.5 ? 'cactus' : 'bush', x, y, r });
        small++;
      }
    } else {
      const r = isBig ? 8 + rng() * 7 : 4 + rng() * 3;
      if (!fits(x, y, r)) continue;
      items.push({ kind: isBig ? 'tree' : 'bush', x, y, r });
      if (isBig) big++;
      else small++;
    }
  }
  // draw top-to-bottom so lower trees overlap higher ones naturally
  items.sort((a, b) => a.y - b.y);
  return items;
}

function drawLake(ctx, d, theme) {
  const blob = (scale, dx = 0, dy = 0) => {
    ctx.beginPath();
    const p = d.pts;
    const n = p.length;
    const sx = (i) => d.x + (p[i][0] - d.x) * scale + dx;
    const sy = (i) => d.y + (p[i][1] - d.y) * scale + dy;
    ctx.moveTo((sx(n - 1) + sx(0)) / 2, (sy(n - 1) + sy(0)) / 2);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      ctx.quadraticCurveTo(sx(i), sy(i), (sx(i) + sx(j)) / 2, (sy(i) + sy(j)) / 2);
    }
    ctx.closePath();
  };
  ctx.fillStyle = shade(theme.ground, 0.25);
  blob(1.08);
  ctx.fill();
  ctx.fillStyle = theme.water;
  blob(1);
  ctx.fill();
  ctx.fillStyle = theme.waterLight;
  blob(0.62, -d.r * 0.12, -d.r * 0.12);
  ctx.fill();
}

function drawDecor(ctx, d, theme) {
  if (d.kind === 'tree') {
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    ctx.beginPath();
    ctx.arc(d.x + d.r * 0.25, d.y + d.r * 0.35, d.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.treeDark;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.treeLight;
    ctx.beginPath();
    ctx.arc(d.x - d.r * 0.22, d.y - d.r * 0.24, d.r * 0.62, 0, Math.PI * 2);
    ctx.fill();
  } else if (d.kind === 'bush') {
    ctx.fillStyle = theme.bush;
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + d.x;
      ctx.beginPath();
      ctx.arc(d.x + Math.cos(a) * d.r * 0.5, d.y + Math.sin(a) * d.r * 0.5, d.r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (d.kind === 'rock') {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    polygon(ctx, d.x + 1.5, d.y + 2, d.pts, 1);
    ctx.fill();
    ctx.fillStyle = theme.rock;
    polygon(ctx, d.x, d.y, d.pts, 1);
    ctx.fill();
    ctx.fillStyle = theme.rockLight;
    polygon(ctx, d.x - d.r * 0.18, d.y - d.r * 0.2, d.pts, 0.55);
    ctx.fill();
  } else if (d.kind === 'cactus') {
    ctx.fillStyle = theme.treeDark;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = theme.treeLight;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(d.x - d.r * 0.6, d.y);
    ctx.lineTo(d.x + d.r * 0.6, d.y);
    ctx.moveTo(d.x, d.y - d.r * 0.6);
    ctx.lineTo(d.x, d.y + d.r * 0.6);
    ctx.stroke();
  }
}

function polygon(ctx, x, y, pts, s) {
  ctx.beginPath();
  ctx.moveTo(x + pts[0][0] * s, y + pts[0][1] * s);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(x + pts[i][0] * s, y + pts[i][1] * s);
  ctx.closePath();
}
