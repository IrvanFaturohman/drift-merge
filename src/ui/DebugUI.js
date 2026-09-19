import { CONFIG } from '../game/config.js';
import { formatMoney } from '../game/utils.js';

/** Hidden developer panel. Toggle with the D key, or 5 quick taps on the CIRCUIT chip. */
export class DebugUI {
  constructor(root, game) {
    this.game = game;
    this.panel = root.querySelector('#debug');
    this.stats = root.querySelector('#debug-stats');
    this.resetBtn = root.querySelector('[data-debug="reset"]');
    this.visible = false;
    this.timer = 0;
    this.resetArmed = false;
    this.resetTimeout = null;

    const actions = {
      money100: () => game.debugAddMoney(100),
      money1000: () => game.debugAddMoney(1000),
      money10000: () => game.debugAddMoney(10000),
      spawn: () => game.debugSpawnCar(),
      circuit: () => game.debugNextCircuit(),
      reset: () => this.onReset(),
      close: () => this.toggle(),
    };
    this.panel.addEventListener('pointerdown', (e) => e.stopPropagation());

    // phones have no D key: tap the CIRCUIT chip 5 times quickly to toggle the panel
    let taps = [];
    root.querySelector('#circuit-chip')?.addEventListener('pointerdown', () => {
      const now = performance.now();
      taps = taps.filter((t) => now - t < 1500);
      taps.push(now);
      if (taps.length >= 5) {
        taps = [];
        this.toggle();
      }
    });
    this.panel.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('[data-debug]');
      if (!btn) return;
      btn.blur();
      actions[btn.dataset.debug]?.();
    });
  }

  toggle() {
    this.visible = !this.visible;
    this.panel.hidden = !this.visible;
    this.timer = 1;
  }

  /** Two-step reset: first press arms, second press (within 3s) wipes the save. */
  onReset() {
    if (!this.resetArmed) {
      this.resetArmed = true;
      this.resetBtn.textContent = 'Tap again to confirm';
      this.resetBtn.classList.add('armed');
      clearTimeout(this.resetTimeout);
      this.resetTimeout = setTimeout(() => this.disarm(), 3000);
      return;
    }
    this.disarm();
    this.game.resetSave();
  }

  disarm() {
    this.resetArmed = false;
    this.resetBtn.textContent = 'Reset Save';
    this.resetBtn.classList.remove('armed');
  }

  update(dt) {
    if (!this.visible) return;
    this.timer += dt;
    if (this.timer < 0.25) return;
    this.timer = 0;
    const g = this.game;
    const tiers = g.cars.cars.map((c) => c.tier).sort((a, b) => b - a);
    const lines = [
      `FPS          ${g.fps.toFixed(0)}`,
      `money        ${formatMoney(g.economy.money)}`,
      `cars         ${g.cars.count}/${CONFIG.cars.maxCars}`,
      `tiers        ${tiers.length ? tiers.map((t) => 'T' + t).join(' ') : '-'}`,
      `circuit      ${g.tracks.level + 1} (${g.tracks.circuit.name}) x${g.tracks.multiplier}`,
      `track len    ${g.track.length.toFixed(0)}`,
      `reward lines ${g.lines.count}/${CONFIG.rewardLines.max}`,
      `boost        ${g.boost.boost.toFixed(3)}`,
      `speed mult   ${g.boost.speedMult.toFixed(3)}x`,
      `cars bought  ${g.economy.carsPurchased}`,
      `particles    ${g.particles.count}/${g.particles.max}`,
      `skid marks   ${g.skids.activeCount(g.time)}`,
      `float texts  ${g.texts.items.length}`,
    ];
    this.stats.textContent = lines.join('\n');
  }
}
