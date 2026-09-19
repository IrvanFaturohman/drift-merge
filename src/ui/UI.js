import { CONFIG } from '../game/config.js';
import { damp, formatMoney } from '../game/utils.js';
import { UIFx } from './UIFx.js';

const BUTTONS = ['merge', 'addCar', 'addLine', 'upgrade'];
const BUTTON_COLORS = { merge: '#A78BFA', addCar: '#5CB3F5', addLine: '#FFC93C', upgrade: '#4ED486' };

/**
 * DOM HUD: rolling money counter, circuit chip, NOS meter, car count, sound
 * toggle and the four upgrade buttons. Only touches the DOM when a displayed
 * value actually changes. Screen-space juice lives in UIFx (overlay canvas).
 */
export class UI {
  constructor(root, handlers, hooks = {}) {
    this.root = root;
    this.hooks = hooks; // { press(name), deny(name), toggleSound() }
    const $ = (sel) => root.querySelector(sel);
    this.el = {
      money: $('#money'),
      moneyValue: $('#money-value'),
      coin: $('#money .coin'),
      circuitLevel: $('#circuit-level'),
      circuitMult: $('#circuit-mult'),
      carCount: $('#car-count'),
      nos: $('#nos'),
      nosFill: $('#nos-fill'),
      nosMult: $('#nos-mult'),
      hint: $('#tap-hint'),
      sound: $('#sound-btn'),
    };
    this.fx = new UIFx(root);
    this.fx.onCoinArrive = (amount) => this.onCoinArrive(amount);
    this.fx.onOrbArrive = () => {
      this.nosPop = 1;
      this.restartAnimation(this.el.nos, 'charge');
    };

    this.buttons = {};
    for (const name of BUTTONS) {
      const btn = $(`[data-action="${name}"]`);
      this.buttons[name] = {
        btn,
        sub: btn.querySelector('.btn-sub'),
        badge: btn.querySelector('.btn-badge'),
        enabled: null,
        text: null,
        badgeText: null,
      };
      this.bindButton(name, btn, handlers[name]);
    }

    this.el.sound.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.sound.addEventListener('click', (e) => {
      e.stopPropagation();
      this.el.sound.blur();
      this.hooks.toggleSound?.();
    });

    this.cache = {};
    this.moneyShown = null;
    this.moneyPop = 0;
    this.moneyScale = 1;
    this.nosPop = 0;
    this.nosScale = 1;
    this.coinSpinAt = 0;
  }

  bindButton(name, btn, action) {
    let pressedAt = 0;
    const release = () => {
      const wait = Math.max(0, 90 - (performance.now() - pressedAt));
      setTimeout(() => btn.classList.remove('pressed'), wait);
    };
    btn.addEventListener('pointerdown', (e) => {
      // UI presses must never reach the NOS tap handler
      e.stopPropagation();
      this.hooks.unlock?.();
      if (btn.classList.contains('is-disabled')) return;
      pressedAt = performance.now();
      btn.classList.add('pressed');
      this.hooks.press?.(name);
    });
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.blur();
      if (btn.classList.contains('is-disabled')) {
        this.deny(btn);
        this.hooks.deny?.(name);
        return;
      }
      action?.();
    });
  }

  restartAnimation(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the CSS animation
    el.classList.add(cls);
  }

  deny(btn) {
    this.restartAnimation(btn, 'deny');
  }

  /** Successful purchase / merge: button bounce + burst + optional "-$X". */
  bought(name, spent = 0) {
    const b = this.buttons[name];
    if (!b) return;
    this.restartAnimation(b.btn, 'bought');
    const c = this.fx.centerOf(b.btn);
    this.fx.burst(c.x, c.y - 6, BUTTON_COLORS[name], 14, 170);
    if (spent > 0) {
      const r = this.el.moneyValue.getBoundingClientRect();
      const m = this.fx.centerOf(this.el.moneyValue);
      this.fx.floatText(`-${formatMoney(spent)}`, m.x + r.width / 2 + 24, m.y + 4, '#FF9B9B', -30);
      this.moneyPop = Math.min(1, this.moneyPop + 0.4);
    }
  }

  onCoinArrive(amount) {
    this.popMoney(amount);
    const now = performance.now();
    if (now - this.coinSpinAt > 120) {
      this.coinSpinAt = now;
      this.restartAnimation(this.el.coin, 'spin');
    }
  }

  popMoney(amount = 1) {
    this.moneyPop = Math.min(1, this.moneyPop + 0.35 + Math.min(0.4, amount / 200));
  }

  pulseNos() {
    this.nosPop = 1;
  }

  setSound(on) {
    this.el.sound.classList.toggle('muted', !on);
    this.el.sound.setAttribute('aria-label', on ? 'Mute sound' : 'Unmute sound');
  }

  hideHint() {
    this.el.hint.classList.add('hidden');
  }

  showHint() {
    this.el.hint.classList.remove('hidden');
  }

  setText(key, el, text) {
    if (this.cache[key] === text) return;
    this.cache[key] = text;
    el.textContent = text;
  }

  setClass(key, el, cls, on) {
    const k = key + cls;
    if (this.cache[k] === on) return;
    this.cache[k] = on;
    el.classList.toggle(cls, on);
  }

  setButton(name, state) {
    const b = this.buttons[name];
    const enabled = !!state.enabled;
    if (b.enabled !== enabled) {
      const becameReady = b.enabled === false && enabled;
      b.enabled = enabled;
      b.btn.classList.toggle('is-disabled', !enabled);
      b.btn.setAttribute('aria-disabled', String(!enabled));
      if (becameReady) this.restartAnimation(b.btn, 'ready');
    }
    this.setClass(name, b.btn, 'is-max', !!state.max);
    if (b.text !== state.sub) {
      b.text = state.sub;
      b.sub.textContent = state.sub;
    }
    if (b.badge && b.badgeText !== (state.badge ?? '')) {
      b.badgeText = state.badge ?? '';
      b.badge.textContent = b.badgeText;
      b.badge.hidden = !b.badgeText;
    }
  }

  update(dt, s) {
    const U = CONFIG.ui;
    // rolling counter
    if (this.moneyShown == null) this.moneyShown = s.money;
    this.moneyShown = damp(this.moneyShown, s.money, U.moneyRollSpeed, dt);
    if (Math.abs(this.moneyShown - s.money) < 0.5) this.moneyShown = s.money;
    this.setText('money', this.el.moneyValue, formatMoney(Math.round(this.moneyShown)));

    this.moneyPop *= Math.exp(-U.moneyPopDecay * dt);
    const ms = 1 + U.moneyPopScale * this.moneyPop;
    if (Math.abs(ms - this.moneyScale) > 0.002) {
      this.moneyScale = ms;
      this.el.money.style.transform = `scale(${ms.toFixed(3)})`;
    }
    this.setClass('money', this.el.money, 'gain', this.moneyPop > 0.25);

    this.setText('circuit', this.el.circuitLevel, String(s.circuit));
    this.setText('mult', this.el.circuitMult, `x${s.multiplier}`);
    this.setText('cars', this.el.carCount, `${s.carCount}/${s.maxCars}`);

    this.el.nosFill.style.transform = `scaleX(${s.boost.toFixed(3)})`;
    this.setText('nosMult', this.el.nosMult, `${s.speedMult.toFixed(2)}x`);
    this.nosPop *= Math.exp(-10 * dt);
    const ns = 1 + 0.14 * this.nosPop;
    if (Math.abs(ns - this.nosScale) > 0.002) {
      this.nosScale = ns;
      this.el.nos.style.transform = `scale(${ns.toFixed(3)})`;
    }
    this.setClass('nos', this.el.nos, 'active', s.boost > 0.02);
    this.setClass('nos', this.el.nos, 'maxed', s.boost > 0.93);

    for (const name of BUTTONS) this.setButton(name, s[name]);
    this.setClass('merge', this.buttons.merge.btn, 'can-merge', !!s.merge.enabled);

    this.fx.update(dt);
    this.fx.draw();
  }
}
