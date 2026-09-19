// Small math / formatting helpers shared by every system.

export const TAU = Math.PI * 2;

export const deg = (d) => (d * Math.PI) / 180;

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export const lerp = (a, b, t) => a + (b - a) * t;

export const invLerp = (a, b, v) => (a === b ? 0 : clamp((v - a) / (b - a), 0, 1));

export const smoothstep = (a, b, v) => {
  const t = invLerp(a, b, v);
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential approach of `current` toward `target`. */
export const damp = (current, target, rate, dt) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

/** Wrap an angle into [-PI, PI). */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed rotation from `from` to `to`. */
export const angleDiff = (from, to) => wrapAngle(to - from);

export const rand = (min, max) => min + Math.random() * (max - min);

export const randSign = () => (Math.random() < 0.5 ? -1 : 1);

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Scale pop curve: 0 -> overshoot -> 1 over t = 0..1. */
export function popScale(t, overshoot = 1.15) {
  if (t >= 1) return 1;
  if (t <= 0) return 0;
  if (t < 0.55) return easeOutCubic(t / 0.55) * overshoot;
  return lerp(overshoot, 1, easeInOutQuad((t - 0.55) / 0.45));
}

/** Deterministic PRNG so procedural decoration stays stable between reloads. */
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONEY_UNITS = ['K', 'M', 'B', 'T', 'Qa', 'Qi'];

export function formatMoney(n) {
  n = Math.floor(n);
  if (n < 100000) return '$' + n.toLocaleString('en-US');
  let unit = -1;
  let v = n;
  while (v >= 1000 && unit < MONEY_UNITS.length - 1) {
    v /= 1000;
    unit++;
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return '$' + v.toFixed(digits) + MONEY_UNITS[unit];
}

/** Round prices to numbers that are easy to read on a button. */
export function roundNice(n) {
  if (n < 100) return Math.round(n);
  if (n < 1000) return Math.round(n / 5) * 5;
  if (n < 10000) return Math.round(n / 10) * 10;
  const step = Math.pow(10, Math.floor(Math.log10(n)) - 2);
  return Math.round(n / step) * step;
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Mix a hex colour toward white (amount > 0) or black (amount < 0). */
export function shade(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  const target = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  const mix = (c) => Math.round(c + (target - c) * k);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

export function rgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
