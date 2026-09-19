import { CONFIG, tierDef } from './config.js';
import { TrackManager } from './TrackManager.js';
import { CarManager, carsNeededToMerge } from './CarManager.js';
import { Economy } from './Economy.js';
import { RewardLineManager } from './RewardLine.js';
import { ParticleSystem, P } from './ParticleSystem.js';
import { SkidMarks } from './SkidMarks.js';
import { FloatingTextSystem } from './FloatingText.js';
import { BoostSystem } from './BoostSystem.js';
import { SaveSystem } from './SaveSystem.js';
import { AudioSystem, haptic } from './AudioSystem.js';
import { SpeedLines } from './SpeedLines.js';
import { UI } from '../ui/UI.js';
import { DebugUI } from '../ui/DebugUI.js';
import { clamp, easeInOutQuad, formatMoney, rand, rgba } from './utils.js';

const J = CONFIG.juice;
const tmp = {};
const CONFETTI_COLORS = ['#FFD24A', '#FF6B6B', '#4ECDC4', '#FFFFFF', '#A78BFA', '#5CB3F5'];

/** Wires every system together and runs the fixed-camera render loop. */
export class Game {
  constructor(root) {
    this.root = root;
    this.playArea = root.querySelector('#play-area');
    this.canvas = root.querySelector('#game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.view = { cw: 1, ch: 1, pw: 1, ph: 1, dpr: 1, scale: 1, ox: 0, oy: 0 };
    this.canvasOffset = { x: 0, y: 0 }; // play area position inside #app (for coin flights)

    this.economy = new Economy();
    this.boost = new BoostSystem();
    this.particles = new ParticleSystem();
    this.skids = new SkidMarks();
    this.texts = new FloatingTextSystem();
    this.tracks = new TrackManager();
    this.lines = new RewardLineManager();
    this.cars = new CarManager();
    this.saveSystem = new SaveSystem();
    this.audio = new AudioSystem();
    this.speedLines = new SpeedLines();
    this.reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    this.time = 0; // world time (slows during hit-stop)
    this.realTime = 0;
    this.trauma = 0; // screen shake 0..1
    this.punch = 0; // tap zoom punch 0..1
    this.hitStop = 0;
    this.tapPulse = 0;
    this.autosaveTimer = 0;
    this.hintDone = false;
    this.pendingCircuit = null;
    this.fps = 60;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.vignette = null;

    this.env = {
      track: null,
      boost: this.boost,
      time: 0,
      particles: this.particles,
      skids: this.skids,
      circuitSpeed: 1,
      onLand: (car) => this.onCarLand(car),
    };

    this.ui = new UI(
      root,
      {
        merge: () => this.merge(),
        addCar: () => this.buyCar(),
        addLine: () => this.buyRewardLine(),
        upgrade: () => this.upgradeCircuit(),
      },
      {
        unlock: () => this.audio.unlock(),
        press: () => {
          this.audio.click();
          this.vibrate(6);
        },
        deny: () => {
          this.audio.deny();
          this.vibrate([12, 40, 12]);
        },
        toggleSound: () => this.toggleSound(),
      },
    );
    this.ui.setSound(this.audio.enabled);
    this.debug = new DebugUI(root, this);

    // crossing income arrives by flying coin; everything else pops right away
    this.economy.onEarn = (amount, source) => {
      if (source !== 'coin') this.ui.popMoney(amount);
    };
    this.cars.onCross = (car, line) => this.onCross(car, line);

    this.loadState();
    this.bindInput();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.playArea);

    this.last = performance.now();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  get track() {
    return this.tracks.track;
  }

  // ------------------------------------------------------------ state

  newGame() {
    this.economy.reset();
    this.boost.reset();
    this.tracks.transition = null;
    this.pendingCircuit = null;
    this.tracks.setLevel(0);
    this.lines.setCount(CONFIG.rewardLines.startCount, false);
    this.lines.onTrackChanged(this.track);
    this.cars.clear();
    for (let i = 0; i < CONFIG.cars.startingCount; i++) {
      const t = i === 0 ? CONFIG.cars.startingT : this.cars.findSpawnT();
      this.cars.add(1, t, this.cars.pickLane(), this.track);
    }
    this.skids.clear();
    this.particles.clear();
    this.texts.clear();
  }

  loadState() {
    const data = this.saveSystem.load();
    this.newGame();
    if (!data || !data.cars.length) return;
    this.economy.money = data.money;
    this.economy.carsPurchased = data.carsPurchased;
    this.tracks.setLevel(data.circuit);
    this.lines.setCount(data.rewardLines, false);
    this.lines.onTrackChanged(this.track);
    this.cars.clear();
    for (const c of data.cars) this.cars.add(c.tier, c.t, c.lane, this.track);
    this.hintDone = data.hintDone;
    if (this.hintDone) this.ui.hideHint();
  }

  serialize() {
    return {
      money: this.economy.money,
      carsPurchased: this.economy.carsPurchased,
      rewardLines: this.lines.count,
      circuit: this.pendingCircuit ?? this.tracks.level,
      cars: this.cars.serialize(),
      hintDone: this.hintDone,
    };
  }

  save() {
    this.saveSystem.save(this.serialize());
    this.autosaveTimer = 0;
  }

  resetSave() {
    this.saveSystem.clear();
    this.newGame();
    this.hintDone = false;
    this.ui.showHint();
    this.save();
    this.texts.spawn('SAVE RESET', CONFIG.world.width / 2, CONFIG.world.height / 2, { size: 24, color: '#FFFFFF', life: 1.2 });
  }

  // ------------------------------------------------------------ actions

  buyCar() {
    if (this.cars.isFull) return;
    const price = this.economy.addCarPrice();
    if (!this.economy.spend(price)) return;
    this.economy.carsPurchased++;
    this.cars.spawnNew(1, this.track); // drops in; landing fx in onCarLand
    this.audio.buy();
    this.ui.bought('addCar', price);
    this.vibrate(10);
    this.save();
  }

  onCarLand(car) {
    const tier = tierDef(car.tier);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rand(-0.2, 0.2);
      const s = rand(45, 95);
      this.particles.spawn(P.DUST, car.x + Math.cos(a) * 6, car.y + Math.sin(a) * 6, {
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.4, 0.65),
        size: rand(2.5, 4),
        endSize: rand(8, 11),
        alpha: 0.5,
        color: '#EFEDE4',
        drag: 5,
      });
    }
    this.ring(car.x, car.y, '#FFFFFF', 30, 0.35, 3);
    this.burst(car.x, car.y, tier.body, 8, 70);
    this.addTrauma(J.shakeLand);
    this.audio.land();
    this.vibrate(14);
  }

  merge() {
    const res = this.cars.merge(this.track);
    if (!res) return;
    const M = CONFIG.merge;
    const def = tierDef(res.tier);
    const { x, y } = res.car;
    this.hitStop = J.hitStopMerge;
    this.ring(x, y, def.body, 46, 0.5, 5);
    this.ring(x, y, '#FFFFFF', 26, 0.3, 2.5);
    this.burst(x, y, def.body, M.burstParticles, 110);
    this.confetti(x, y, J.confettiCount, [def.body, def.body, '#FFFFFF', def.accent, '#FFD24A'], 150);
    this.stars(x, y, 6, 45);
    this.texts.spawn(`TIER ${res.tier}!`, x, y - 26, {
      size: M.textSize + Math.min(6, res.tier),
      color: '#FFFFFF',
      pill: def.body,
      rise: 32,
      life: 1.25,
      pop: 1.5,
      sub: def.name.toUpperCase(),
    });
    this.addTrauma(J.shakeMerge + J.shakeMergePerTier * res.tier);
    this.audio.merge(res.tier);
    this.vibrate(res.tier >= 4 ? [25, 30, 45] : 25);
    this.ui.bought('merge');
    this.save();
  }

  buyRewardLine() {
    const price = this.economy.rewardLinePrice(this.lines.count);
    if (price == null || !this.economy.spend(price)) return;
    this.lines.setCount(this.lines.count + 1, true);
    const line = this.lines.lines[this.lines.count - 1];
    const p = this.track.sampleT(line.t, tmp);
    this.burst(p.x, p.y, '#FFC93C', 16, 80);
    this.ring(p.x, p.y, '#FFC93C', 36, 0.45, 4);
    this.confetti(p.x, p.y, 14, ['#FFC93C', '#FFFFFF', '#F2A41F'], 110);
    this.stars(p.x, p.y, 4, 30);
    this.texts.spawn('NEW REWARD LINE', p.x, p.y - 24, { size: 14, color: '#FFFFFF', pill: '#E89B12', life: 1.3 });
    this.addTrauma(0.15);
    this.audio.line();
    this.ui.bought('addLine', price);
    this.vibrate(15);
    this.save();
  }

  upgradeCircuit() {
    if (this.tracks.isTransitioning) return;
    const price = this.economy.circuitPrice(this.tracks.level);
    if (price == null || !this.economy.spend(price)) return;
    this.ui.bought('upgrade', price);
    this.changeCircuit(this.tracks.level + 1);
  }

  changeCircuit(level) {
    this.pendingCircuit = level;
    this.save();
    this.audio.upgrade();
    this.vibrate([20, 40, 30]);
    this.tracks.startTransition(() => {
      this.tracks.setLevel(level);
      this.pendingCircuit = null;
      this.lines.onTrackChanged(this.track);
      this.cars.onTrackChanged(this.track);
      this.skids.clear();
      this.particles.clear();
      this.speedLines.clear();
      // cars rain down onto the new circuit one after another
      this.cars.cars.forEach((car, i) => car.playDrop(0.18 + i * J.dropStagger));
      const W = CONFIG.world.width;
      for (let i = 0; i < 46; i++) {
        this.particles.spawn(P.CONFETTI, rand(0, W), rand(-40, 20), {
          vx: rand(-30, 30),
          vy: rand(90, 190),
          life: rand(1.4, 2.2),
          size: rand(4, 6.5),
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          drag: 0.6,
          gravity: 40,
          spin: rand(-9, 9),
        });
      }
      const c = this.tracks.circuit;
      this.texts.spawn(c.name.toUpperCase(), W / 2, CONFIG.world.height / 2 - 8, {
        size: 28,
        color: '#FFFFFF',
        sub: `CIRCUIT ${level + 1}  -  INCOME x${c.multiplier}`,
        life: 2.1,
        rise: 14,
        pop: 1.3,
      });
      this.addTrauma(J.shakeUpgrade);
      this.save();
    });
  }

  onCross(car, line) {
    const reward = this.economy.rewardFor(car.def.reward, this.tracks.multiplier);
    this.economy.earn(reward, 'coin');
    line.flash = 1;
    this.texts.spawn(`+$${reward}`, car.x + rand(-4, 4), car.y - 12, {
      size: CONFIG.floatingText.moneySize + Math.min(9, Math.log2(reward) * 1.3),
      pop: 1.5,
    });
    for (let i = 0; i < CONFIG.particles.rewardSparks; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(30, 70);
      this.particles.spawn(P.SPARK, car.x, car.y, {
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.25, 0.4),
        size: rand(1.4, 2.2),
        endSize: 0.5,
        color: '#FFD84A',
        drag: 4,
      });
    }
    this.stars(car.x, car.y, 1, 20);
    const p = this.worldToApp(car.x, car.y);
    if (!this.ui.fx.flyCoin(p.x, p.y, reward)) this.ui.popMoney(reward);
    this.audio.coin();
  }

  onTap(clientX, clientY) {
    this.audio.unlock();
    this.boost.tap();
    this.tapPulse = 1;
    this.punch = 1;
    if (J.shakeTap > 0) this.addTrauma(J.shakeTap);
    this.speedLines.burst(J.edgeLines.tapBurst, this.view.cw, this.view.ch);
    this.ui.pulseNos();
    for (const car of this.cars.cars) car.nosBurst(this.particles);
    if (clientX != null) {
      const r = this.canvas.getBoundingClientRect();
      const px = clientX - r.left;
      const py = clientY - r.top;
      if (px >= 0 && py >= 0 && px <= r.width && py <= r.height) {
        const wx = (px - this.view.ox) / this.view.scale;
        const wy = (py - this.view.oy) / this.view.scale;
        this.tapBurst(wx, wy);
      }
      if (CONFIG.nos.tapOrb) {
        const a = this.root.getBoundingClientRect();
        this.ui.fx.flyOrb(clientX - a.left, clientY - a.top);
      }
    }
    if (CONFIG.audio.tapSound) this.audio.nos(this.boost.boost);
    if (CONFIG.audio.tapHaptic) this.vibrate(5);
    if (!this.hintDone && this.boost.totalTaps >= CONFIG.ui.hintTapsToHide) {
      this.hintDone = true;
      this.ui.hideHint();
    }
  }

  /** Crisp, local "pow" where the screen was tapped: ring + radial streaks. */
  tapBurst(x, y) {
    const N = CONFIG.nos;
    if (N.rippleSize > 0) {
      this.ring(x, y, N.colors.outer, N.rippleSize, 0.28, 2.5);
      this.ring(x, y, '#FFFFFF', N.rippleSize * 0.5, 0.18, 2);
    }
    const n = N.tapBurstLines;
    const rot = rand(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      const d = rand(6, 9);
      const s = rand(150, 210);
      this.particles.spawn(P.SPEED, x + Math.cos(a) * d, y + Math.sin(a) * d, {
        angle: a,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        drag: 7,
        life: rand(0.16, 0.24),
        size: rand(7, 11),
        alpha: 0.95,
        color: i % 2 ? '#FFFFFF' : N.colors.outer,
        width: 2.2,
      });
    }
    for (let i = 0; i < J.tapSparks; i++) {
      const a = rand(0, Math.PI * 2);
      this.particles.spawn(P.NOS, x, y, {
        vx: Math.cos(a) * rand(40, 90),
        vy: Math.sin(a) * rand(40, 90),
        life: rand(0.2, 0.35),
        size: rand(1.5, 2.5),
        endSize: 0.3,
        color: i % 2 ? '#FFFFFF' : N.colors.outer,
        drag: 5,
      });
    }
  }

  toggleSound() {
    this.audio.unlock();
    this.audio.setEnabled(!this.audio.enabled);
    this.ui.setSound(this.audio.enabled);
    if (this.audio.enabled) this.audio.click();
  }

  vibrate(pattern) {
    if (this.audio.enabled) haptic(pattern);
  }

  // ------------------------------------------------------------ debug hooks

  debugAddMoney(n) {
    this.economy.earn(n);
  }

  debugSpawnCar() {
    this.cars.spawnNew(1, this.track);
  }

  debugNextCircuit() {
    if (this.tracks.isTransitioning) return;
    const next = (this.tracks.level + 1) % CONFIG.circuits.length;
    this.changeCircuit(next);
  }

  // ------------------------------------------------------------ fx helpers

  burst(x, y, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand(-0.3, 0.3);
      const s = speed * rand(0.5, 1.1);
      this.particles.spawn(P.SPARK, x, y, {
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.35, 0.6),
        size: rand(1.8, 3),
        endSize: 0.5,
        color,
        drag: 3.5,
      });
    }
  }

  confetti(x, y, count, colors, speed) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = speed * rand(0.4, 1);
      this.particles.spawn(P.CONFETTI, x, y, {
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 40,
        life: rand(0.8, 1.25),
        size: rand(3.5, 5.5),
        color: colors[i % colors.length],
        drag: 2.6,
        gravity: 70,
        spin: rand(-12, 12),
      });
    }
  }

  stars(x, y, count, spread) {
    for (let i = 0; i < count; i++) {
      this.particles.spawn(P.STAR, x + rand(-spread, spread), y + rand(-spread, spread) * 0.8, {
        life: rand(0.35, 0.6),
        size: rand(4, 7),
        color: i % 2 ? '#FFF3B0' : '#FFFFFF',
      });
    }
  }

  ring(x, y, color, size, life, width = 2) {
    this.particles.spawn(P.RING, x, y, { size: 2, endSize: size, life, color, width, alpha: 0.9 });
  }

  addTrauma(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** World units -> CSS px inside #app (ignores shake / punch). */
  worldToApp(x, y) {
    const v = this.view;
    return { x: this.canvasOffset.x + v.ox + x * v.scale, y: this.canvasOffset.y + v.oy + y * v.scale };
  }

  // ------------------------------------------------------------ input / layout

  bindInput() {
    // any first gesture unlocks audio (mobile autoplay rules), before buttons stop propagation
    const unlock = () => this.audio.unlock();
    for (const type of ['pointerdown', 'touchend', 'click']) this.root.addEventListener(type, unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });

    this.root.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.no-boost')) return; // buttons, sound toggle & debug panel
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.onTap(e.clientX, e.clientY);
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') {
        this.debug.toggle();
      } else if (e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        this.onTap(null, null);
      }
    });
    document.addEventListener('visibilitychange', () => {
      this.audio.setHidden(document.hidden);
      if (document.hidden) this.save();
    });
    window.addEventListener('pagehide', () => this.save());
  }

  resize() {
    const r = this.playArea.getBoundingClientRect();
    const a = this.root.getBoundingClientRect();
    this.canvasOffset.x = r.left - a.left;
    this.canvasOffset.y = r.top - a.top;
    const cw = Math.max(1, r.width);
    const ch = Math.max(1, r.height);
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.loop.maxDevicePixelRatio);
    const pw = Math.round(cw * dpr);
    const ph = Math.round(ch * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    const W = CONFIG.world.width;
    const H = CONFIG.world.height;
    const pad = CONFIG.world.viewPadding;
    const scale = Math.min((cw - pad * 2) / W, (ch - pad * 2) / H);
    Object.assign(this.view, { cw, ch, pw, ph, dpr, scale, ox: (cw - W * scale) / 2, oy: (ch - H * scale) / 2 });
    this.tracks.invalidate();
    this.vignette = null;
  }

  // ------------------------------------------------------------ loop

  frame(now) {
    requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, CONFIG.loop.maxDeltaTime);

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    this.update(dt);
    this.render();
  }

  update(dt) {
    // hit-stop: the world briefly slows down, UI and effects timing keep running
    const worldDt = this.hitStop > 0 ? dt * J.hitStopScale : dt;
    this.hitStop = Math.max(0, this.hitStop - dt);
    this.time += worldDt;
    this.realTime += dt;

    this.boost.update(dt);
    this.tracks.update(dt);

    const env = this.env;
    env.track = this.track;
    env.time = this.time;
    env.circuitSpeed = this.tracks.circuit.speedScale ?? 1;
    this.cars.update(worldDt, env, this.lines.lines);
    this.lines.update(worldDt);
    this.particles.update(worldDt);
    this.texts.update(worldDt);
    this.speedLines.update(dt, this.boost.visual, this.view.cw, this.view.ch);

    this.trauma = Math.max(0, this.trauma - J.shakeDecay * dt);
    this.punch = Math.max(0, this.punch - dt * 9);
    this.tapPulse = Math.max(0, this.tapPulse - dt * 5);

    let drift = 0;
    for (const car of this.cars.cars) drift += Math.max(0, car.driftAmount - 0.45);
    this.audio.update(dt, {
      speedMult: this.boost.speedMult,
      kick: this.boost.kick,
      carCount: this.cars.count,
      drift: clamp(drift / 0.9, 0, 1),
    });

    this.updateUI(dt);
    this.debug.update(dt);

    this.autosaveTimer += dt;
    if (this.autosaveTimer >= CONFIG.save.autosaveInterval) this.save();
  }

  updateUI(dt) {
    const e = this.economy;
    // coins still flying to the counter aren't spendable-looking yet
    const money = Math.max(0, e.money - this.ui.fx.inFlight);
    const mergeTier = this.cars.findMergeTier();
    let merge;
    if (mergeTier != null) {
      merge = { enabled: true, sub: `${carsNeededToMerge(mergeTier)}× T${mergeTier}` };
    } else {
      const p = this.cars.mergeProgress();
      merge = { enabled: false, sub: p ? `T${p.tier}  ${p.have}/${p.need}` : 'NO PAIR' };
    }
    const carPrice = e.addCarPrice();
    const linePrice = e.rewardLinePrice(this.lines.count);
    const circuitPrice = e.circuitPrice(this.tracks.level);
    const busy = this.tracks.isTransitioning;
    this.ui.update(dt, {
      money,
      boost: this.boost.boost,
      speedMult: this.boost.speedMult,
      circuit: this.tracks.level + 1,
      multiplier: this.tracks.multiplier,
      carCount: this.cars.count,
      maxCars: CONFIG.cars.maxCars,
      merge,
      addCar: this.cars.isFull
        ? { enabled: false, sub: 'MAX', max: true }
        : { enabled: money >= carPrice, sub: formatMoney(carPrice) },
      addLine:
        linePrice == null
          ? { enabled: false, sub: 'MAX', max: true, badge: `${this.lines.count}/${CONFIG.rewardLines.max}` }
          : { enabled: money >= linePrice, sub: formatMoney(linePrice), badge: `${this.lines.count}/${CONFIG.rewardLines.max}` },
      upgrade:
        circuitPrice == null
          ? { enabled: false, sub: 'MAX', max: true }
          : { enabled: money >= circuitPrice && !busy, sub: formatMoney(circuitPrice), badge: `x${CONFIG.circuits[this.tracks.level + 1].multiplier}` },
    });
  }

  render() {
    const ctx = this.ctx;
    const v = this.view;
    this.tracks.ensureLayer(v);

    // smooth trauma-based shake (+ a light rumble while boosted) and an optional zoom punch
    const shake = Math.max(this.trauma, this.boost.visual * J.boostRumble);
    const amp = this.reduceMotion ? 0 : shake * J.shakeMax;
    const rt = this.realTime;
    const sx = amp ? amp * (Math.sin(rt * 61.3) * 0.6 + Math.sin(rt * 97.1) * 0.4) : 0;
    const sy = amp ? amp * (Math.cos(rt * 57.7) * 0.6 + Math.sin(rt * 83.9) * 0.4) : 0;
    const z = 1 + J.tapPunch * this.punch * this.punch;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    if (sx || sy || z !== 1) {
      ctx.fillStyle = this.tracks.theme.ground;
      ctx.fillRect(0, 0, v.pw, v.ph);
    }
    const dw = v.pw * z;
    const dh = v.ph * z;
    ctx.drawImage(this.tracks.layer, (v.pw - dw) / 2 + sx * v.dpr, (v.ph - dh) / 2 + sy * v.dpr, dw, dh);

    const cx = v.cw / 2;
    const cy = v.ch / 2;
    const s = v.scale * z;
    const wv = {
      k: v.dpr * s,
      ox: v.dpr * (cx - (cx - v.ox) * z + sx),
      oy: v.dpr * (cy - (cy - v.oy) * z + sy),
    };
    const worldTransform = () => ctx.setTransform(wv.k, 0, 0, wv.k, wv.ox, wv.oy);
    worldTransform();
    this.skids.draw(ctx, this.time);
    this.lines.drawGround(ctx, this.track, this.time);
    this.cars.drawTrails(ctx);
    this.particles.draw(ctx, 0, wv);
    this.cars.draw(ctx, this.time);
    this.lines.drawOverhead(ctx, this.track);
    this.particles.draw(ctx, 1, wv);

    // screen-space overlays
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    const glow = this.tapPulse * CONFIG.nos.screenPulse + this.boost.visual * J.boostVignette;
    if (glow > 0.005) {
      if (!this.vignette) {
        const g = ctx.createRadialGradient(cx, cy, Math.min(v.cw, v.ch) * 0.38, cx, cy, Math.hypot(cx, cy));
        g.addColorStop(0, rgba(CONFIG.nos.colors.outer, 0));
        g.addColorStop(1, rgba(CONFIG.nos.colors.outer, 1));
        this.vignette = g;
      }
      ctx.globalAlpha = Math.min(0.4, glow);
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, v.cw, v.ch);
      ctx.globalAlpha = 1;
    }
    this.speedLines.draw(ctx);
    this.drawTransition(ctx, v);

    worldTransform();
    this.texts.draw(ctx);
  }

  /** Checkered-flag wipe: covers top -> bottom, swaps the circuit, then reveals top -> bottom. */
  drawTransition(ctx, v) {
    const tr = this.tracks.transition;
    if (!tr) return;
    const e = easeInOutQuad(clamp(tr.t, 0, 1));
    const out = tr.phase === 'out';
    const top = out ? 0 : e * (v.ch + 24);
    const bottom = out ? e * (v.ch + 24) : v.ch + 24;
    ctx.fillStyle = '#1B232C';
    ctx.fillRect(0, top, v.cw, bottom - top);
    const edge = out ? bottom : top;
    const cell = 16;
    for (let row = 0; row < 2; row++) {
      const y = edge - cell + row * cell;
      for (let x = 0, c = 0; x < v.cw; x += cell, c++) {
        ctx.fillStyle = (row + c) % 2 ? '#1F2328' : '#F7F7F7';
        ctx.fillRect(x, y, cell, cell);
      }
    }
  }
}
