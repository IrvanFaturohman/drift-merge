import { CONFIG } from './config.js';
import { clamp } from './utils.js';

const PREF_KEY = 'drift-merge-sound';

/**
 * Procedural sound: everything is synthesized with Web Audio, no audio files.
 *  - continuous: engine drone (revs with NOS) + tyre squeal (follows drifting)
 *  - one-shots: NOS, coin, buy, land, merge, reward line, circuit upgrade, UI
 * The AudioContext is created on the first user gesture (mobile autoplay rules).
 */
export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    try {
      this.enabled = localStorage.getItem(PREF_KEY) !== 'off';
    } catch {
      /* storage blocked */
    }
    this.last = {}; // per-sound rate limiting
    this.coinStreak = 0;
    this.lastCoinAt = 0;
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Call from any user gesture. Safe to call repeatedly. */
  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      try {
        this.ctx = new AC();
      } catch {
        return;
      }
      this.build();
    }
    if (this.ctx.state !== 'running' && this.enabled && !document.hidden) this.ctx.resume().catch(() => {});
  }

  setEnabled(on) {
    this.enabled = on;
    try {
      localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? CONFIG.audio.masterVolume : 0, t, 0.03);
    if (on) this.ctx.resume().catch(() => {});
  }

  /** Pause everything while the tab is in the background. */
  setHidden(hidden) {
    if (!this.ctx) return;
    if (hidden) this.ctx.suspend().catch(() => {});
    else if (this.enabled) this.ctx.resume().catch(() => {});
  }

  build() {
    const ctx = this.ctx;
    const A = CONFIG.audio;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? A.masterVolume : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = A.sfxVolume;
    this.sfx.connect(this.master);

    // shared white noise
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // engine: two detuned buzzy oscillators through a lowpass, with a rumble LFO
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 500;
    this.engFilter.Q.value = 3;
    this.eng1 = ctx.createOscillator();
    this.eng1.type = 'sawtooth';
    this.eng2 = ctx.createOscillator();
    this.eng2.type = 'square';
    this.eng1.frequency.value = A.engineBaseFreq;
    this.eng2.frequency.value = A.engineBaseFreq * 2.01;
    const eng2Gain = ctx.createGain();
    eng2Gain.gain.value = 0.35;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 4;
    lfo.connect(lfoGain);
    lfoGain.connect(this.eng1.frequency);
    this.eng1.connect(this.engFilter);
    this.eng2.connect(eng2Gain);
    eng2Gain.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.master);
    this.eng1.start();
    this.eng2.start();
    lfo.start();

    // tyre squeal: narrow band noise + a wobbling tone
    this.sqGain = ctx.createGain();
    this.sqGain.gain.value = 0;
    this.sqFilter = ctx.createBiquadFilter();
    this.sqFilter.type = 'bandpass';
    this.sqFilter.frequency.value = 1700;
    this.sqFilter.Q.value = 9;
    const sqNoise = ctx.createBufferSource();
    sqNoise.buffer = this.noise;
    sqNoise.loop = true;
    sqNoise.connect(this.sqFilter);
    this.sqTone = ctx.createOscillator();
    this.sqTone.type = 'triangle';
    this.sqTone.frequency.value = 1150;
    const toneGain = ctx.createGain();
    toneGain.gain.value = 0.08;
    this.sqTone.connect(toneGain);
    toneGain.connect(this.sqFilter);
    this.sqFilter.connect(this.sqGain);
    this.sqGain.connect(this.master);
    sqNoise.start();
    this.sqTone.start();
  }

  /** Continuous layers, called every frame. */
  update(dt, s) {
    if (!this.ready) return;
    const A = CONFIG.audio;
    const t = this.ctx.currentTime;
    const boostN = clamp((s.speedMult - 1) / CONFIG.nos.maxBoostBonus, 0, 1);
    const crowd = 0.75 + 0.25 * Math.min(1, s.carCount / 8);
    // each tap blips the throttle: quick pitch + brightness + volume rev on the running engine
    const f = A.engineBaseFreq * (1 + boostN * 0.75) * (1 + s.kick * A.tapRevPitch);
    this.eng1.frequency.setTargetAtTime(f, t, 0.035);
    this.eng2.frequency.setTargetAtTime(f * 2.01, t, 0.035);
    this.engFilter.frequency.setTargetAtTime(420 + boostN * 1300 + s.kick * 1000, t, 0.04);
    this.engGain.gain.setTargetAtTime((A.engineVolume + A.engineBoostVolume * boostN + A.tapRevVolume * s.kick) * crowd, t, 0.05);

    const squeal = clamp(s.drift, 0, 1);
    this.sqGain.gain.setTargetAtTime(A.screechVolume * squeal, t, squeal > 0.05 ? 0.05 : 0.12);
    const wobble = Math.sin(t * 37) * 60 + Math.sin(t * 23) * 40;
    this.sqFilter.frequency.setTargetAtTime(1500 + squeal * 500 + wobble, t, 0.03);
    this.sqTone.frequency.setTargetAtTime(1050 + squeal * 250 + wobble * 1.5, t, 0.03);
  }

  // ------------------------------------------------------------ building blocks

  allow(name, gap) {
    const now = performance.now();
    if (now - (this.last[name] || 0) < gap * 1000) return false;
    this.last[name] = now;
    return true;
  }

  tone(type, f0, f1, dur, vol, delay = 0, attack = 0.005) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noiseBurst(filterType, f0, f1, q, dur, vol, delay = 0, attack = 0.004) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const flt = ctx.createBiquadFilter();
    flt.type = filterType;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt);
    flt.connect(g);
    g.connect(this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  note(semitonesFromA4) {
    return 440 * Math.pow(2, semitonesFromA4 / 12);
  }

  // ------------------------------------------------------------ one-shots

  nos(boost) {
    if (!this.ready || !this.allow('nos', 0.035)) return;
    const up = 1 + boost * 0.6;
    this.noiseBurst('bandpass', 700 * up, 3200 * up, 1.2, 0.22, 0.22);
    this.tone('sine', 150, 60, 0.09, 0.22);
  }

  coin() {
    if (!this.ready || !this.allow('coin', 0.045)) return;
    const now = performance.now();
    this.coinStreak = now - this.lastCoinAt < 700 ? Math.min(this.coinStreak + 1, 8) : 0;
    this.lastCoinAt = now;
    const base = 14 + [0, 2, 4, 5, 7, 9, 11, 12, 14][this.coinStreak];
    this.tone('square', this.note(base), this.note(base), 0.07, 0.05);
    this.tone('sine', this.note(base + 5), this.note(base + 5), 0.22, 0.09, 0.055);
    this.tone('sine', this.note(base + 17), this.note(base + 17), 0.12, 0.025, 0.055);
  }

  buy() {
    if (!this.ready) return;
    this.tone('square', 330, 660, 0.12, 0.06);
    this.noiseBurst('highpass', 3000, 6000, 0.7, 0.12, 0.05, 0.05);
  }

  land() {
    if (!this.ready || !this.allow('land', 0.05)) return;
    this.tone('sine', 140, 50, 0.16, 0.3);
    this.noiseBurst('lowpass', 1400, 300, 0.8, 0.14, 0.16);
    // quick engine blip
    this.tone('sawtooth', 110, 190, 0.18, 0.05, 0.05);
  }

  merge(tier) {
    if (!this.ready) return;
    const root = 3 + tier * 2;
    this.noiseBurst('bandpass', 400, 4000, 1.5, 0.3, 0.12);
    [0, 4, 7, 12].forEach((iv, i) => {
      this.tone('triangle', this.note(root + iv), this.note(root + iv), 0.3, 0.1, 0.04 + i * 0.05);
    });
    this.tone('sine', this.note(root + 24), this.note(root + 24), 0.45, 0.04, 0.24);
    this.tone('sine', 120, 45, 0.25, 0.28);
  }

  line() {
    if (!this.ready) return;
    [0, 5, 9, 12, 17].forEach((iv, i) => this.tone('sine', this.note(15 + iv), this.note(15 + iv), 0.25, 0.08, i * 0.045));
  }

  upgrade() {
    if (!this.ready) return;
    this.noiseBurst('bandpass', 300, 5000, 1, 0.6, 0.12);
    const seq = [0, 4, 7, 12, 7, 12, 16];
    seq.forEach((iv, i) => {
      this.tone('square', this.note(3 + iv), this.note(3 + iv), 0.16, 0.045, 0.08 + i * 0.085);
      this.tone('triangle', this.note(-9 + iv), this.note(-9 + iv), 0.16, 0.07, 0.08 + i * 0.085);
    });
    [0, 4, 7].forEach((iv) => this.tone('triangle', this.note(15 + iv), this.note(15 + iv), 0.9, 0.05, 0.7, 0.02));
  }

  click() {
    if (!this.ready) return;
    this.tone('sine', 900, 1300, 0.05, 0.08);
  }

  deny() {
    if (!this.ready || !this.allow('deny', 0.12)) return;
    this.tone('square', 150, 110, 0.14, 0.07);
    this.tone('square', 150, 110, 0.12, 0.05, 0.1);
  }

  lineCross() {
    if (!this.ready || !this.allow('cross', 0.06)) return;
    this.noiseBurst('highpass', 5000, 8000, 0.5, 0.05, 0.03);
  }
}

/** Short vibration on phones that support it (Android). */
export function haptic(pattern) {
  if (!CONFIG.audio.haptics) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}
