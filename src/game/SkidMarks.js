import { CONFIG } from './config.js';

const BUCKETS = 8;

/**
 * Ring buffer of short skid segments laid behind the rear wheels while
 * drifting. Segments fade over `lifetime`; the oldest are overwritten when the
 * buffer is full. Drawing batches segments into a few alpha buckets so the
 * whole layer costs ~8 strokes per frame.
 */
export class SkidMarks {
  constructor(capacity = CONFIG.skid.maxSegments) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * 6); // x1 y1 x2 y2 born intensity
    this.head = 0;
    this.count = 0;
    this.bucketIdx = [];
    this.bucketLen = new Uint16Array(BUCKETS);
    for (let b = 0; b < BUCKETS; b++) this.bucketIdx.push(new Uint16Array(capacity));
  }

  add(x1, y1, x2, y2, intensity, time) {
    const o = this.head * 6;
    const d = this.data;
    d[o] = x1;
    d[o + 1] = y1;
    d[o + 2] = x2;
    d[o + 3] = y2;
    d[o + 4] = time;
    d[o + 5] = intensity;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  clear() {
    this.head = 0;
    this.count = 0;
  }

  /** Number of segments still visible (for the debug panel). */
  activeCount(time) {
    const life = CONFIG.skid.lifetime;
    let n = 0;
    for (let i = 0; i < this.count; i++) if (time - this.data[i * 6 + 4] < life) n++;
    return n;
  }

  draw(ctx, time) {
    if (!this.count) return;
    const S = CONFIG.skid;
    const d = this.data;
    const lens = this.bucketLen;
    lens.fill(0);
    for (let i = 0; i < this.count; i++) {
      const o = i * 6;
      const age = time - d[o + 4];
      if (age >= S.lifetime || age < 0) continue;
      const fade = 1 - age / S.lifetime;
      const a = fade * d[o + 5]; // 0..1
      const b = Math.min(BUCKETS - 1, Math.floor(a * BUCKETS));
      this.bucketIdx[b][lens[b]++] = i;
    }
    ctx.lineCap = 'butt'; // round caps would overlap into dark beads between alpha buckets
    ctx.lineWidth = S.width;
    for (let b = 0; b < BUCKETS; b++) {
      const len = lens[b];
      if (!len) continue;
      ctx.strokeStyle = `rgba(${S.color}, ${(S.alpha * (b + 0.5)) / BUCKETS})`;
      ctx.beginPath();
      const idx = this.bucketIdx[b];
      for (let k = 0; k < len; k++) {
        const o = idx[k] * 6;
        ctx.moveTo(d[o], d[o + 1]);
        ctx.lineTo(d[o + 2], d[o + 3]);
      }
      ctx.stroke();
    }
  }
}
