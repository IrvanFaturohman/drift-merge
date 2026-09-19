import { CONFIG } from './config.js';
import { Track } from './Track.js';
import { renderTrackLayer } from './TrackRenderer.js';

const FADE_OUT = 0.42; // checkered wipe in
const FADE_IN = 0.55; // wipe out (new circuit revealed)

/**
 * Owns the circuit list, the active Track, its baked background layer and the
 * transition timing used when the circuit is upgraded (Game draws the wipe).
 */
export class TrackManager {
  constructor() {
    this.tracks = new Map();
    this.level = 0;
    this.track = this.getTrack(0);
    this.layer = document.createElement('canvas');
    this.layerDirty = true;
    this.transition = null;
  }

  getTrack(level) {
    if (!this.tracks.has(level)) this.tracks.set(level, new Track(CONFIG.circuits[level]));
    return this.tracks.get(level);
  }

  get circuit() {
    return CONFIG.circuits[this.level];
  }

  get theme() {
    return CONFIG.themes[this.circuit.theme];
  }

  get multiplier() {
    return this.circuit.multiplier;
  }

  get nextCircuit() {
    return CONFIG.circuits[this.level + 1] ?? null;
  }

  get isTransitioning() {
    return this.transition !== null;
  }

  setLevel(level) {
    this.level = Math.max(0, Math.min(level, CONFIG.circuits.length - 1));
    this.track = this.getTrack(this.level);
    this.layerDirty = true;
  }

  invalidate() {
    this.layerDirty = true;
  }

  ensureLayer(view) {
    if (!this.layerDirty) return;
    renderTrackLayer(this.layer, this.track, this.circuit, this.level, view);
    this.layerDirty = false;
  }

  /** Fade out -> onSwap() (change track, reposition cars) -> fade in. */
  startTransition(onSwap) {
    if (this.transition) return false;
    this.transition = { phase: 'out', t: 0, onSwap };
    return true;
  }

  update(dt) {
    const tr = this.transition;
    if (!tr) return;
    tr.t += dt / (tr.phase === 'out' ? FADE_OUT : FADE_IN);
    if (tr.t >= 1) {
      if (tr.phase === 'out') {
        tr.onSwap();
        tr.phase = 'in';
        tr.t = 0;
      } else {
        this.transition = null;
      }
    }
  }
}
