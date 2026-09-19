/**
 * DRIFT MERGE — central tuning file.
 *
 * Almost every gameplay, balance and "feel" number lives here so the prototype
 * can be tuned without touching system code. Angles are written with deg().
 * Distances / sizes are in world units (the world is 400 x 580 and is scaled
 * to fit the portrait play area; on a 390px-wide phone 1 unit ~= 1 CSS px).
 */
import { deg } from './utils.js';

export const CONFIG = {
  world: {
    width: 400,
    height: 580,
    viewPadding: 4, // CSS px kept free around the world when fitting it to the canvas
  },

  loop: {
    maxDeltaTime: 1 / 20, // clamp for frame spikes / returning to a background tab
    maxDevicePixelRatio: 2, // render resolution cap (keeps 3x phones fast)
  },

  // ---------------------------------------------------------------- economy
  economy: {
    startingMoney: 0,
  },

  addCar: {
    // Cars stay cheap so the track fills up fast - buying and merging often is
    // the fun part. Progression is paced by income instead (tier rewards below).
    baseCost: 3, // price of the first purchased car
    growth: 1.1, // price = baseCost * growth ^ carsPurchased (rounded to readable numbers)
  },

  merge: {
    // Cars of the same tier consumed by one merge, indexed by the SOURCE tier:
    // T1->T2 needs 2, T2->T3 needs 3, T3->T4 needs 3, T4->T5 needs 2, T5->T6 needs 2.
    // The lowest mergeable tier is always merged first.
    carsNeeded: [2, 3, 3, 2, 2],
    ghostDuration: 0.24, // the consumed car flies into the result car
    popOvershoot: 1.3,
    burstParticles: 18,
    textSize: 17,
  },

  rewardLines: {
    startCount: 1,
    max: 4,
    positions: [0.0, 0.25, 0.5, 0.75], // normalized track positions (0 = start/finish)
    prices: [40, 120, 320], // price of line #2, #3, #4
    flashDuration: 0.35,
    showNextGhost: true, // faint dashed preview of where the next line will go
  },

  // ---------------------------------------------------------------- cars
  cars: {
    startingCount: 1,
    startingT: 0.93, // first car starts just before the start line -> money almost immediately
    maxCars: 8,
    baseSpeed: 160, // world units / second for a 1.00x car at 1.00x boost (~7.5s lap on circuit 1)
    cornerSlowdown: 0.14, // fraction of speed lost in the sharpest corners (adds weight to drifts)
    cornerSpeedResponse: 3, // how quickly cars brake / accelerate around corners
    laneOffsets: [0, -8, 8], // lateral lanes so several cars don't stack on one line
    spawnAnimDuration: 0.42,
    spawnOvershoot: 1.15, // 0 -> 1.15 -> 1
    spawnParticles: 10,
    shadowOffset: { x: 1.4, y: 2.4 },
    shadowColor: 'rgba(20, 30, 20, 0.22)',
    windowColor: '#2B3747',
    wheelColor: '#1E2227',
    headlightColor: '#FFF4CF',
    taillightColor: '#FF4A4A',

    // Higher tiers: more income, only slightly faster, visibly nicer car.
    // reward = money per reward-line crossing (before the circuit multiplier).
    // Each tier pays what the cars merged into it paid (T3 = 3x T2, T4 = 3x T3,
    // T5 = 2x T4 ...), so merging never lowers income - it frees slots and adds a
    // little speed. Keep this in sync with merge.carsNeeded.
    // Pacing checked with: node tools/economy-sim.mjs greedy 16
    // shape: hatch | tuner | coupe | sports | super | hyper (see CarRenderer.js)
    tiers: [
      { name: 'Hatchback', reward: 1, speed: 1.0, length: 26, width: 14, shape: 'hatch', body: '#5AA9E6', accent: '#FFFFFF', exhausts: 1 },
      { name: 'Tuner', reward: 2, speed: 1.04, length: 27.5, width: 14.5, shape: 'tuner', body: '#6CC24A', accent: '#22303C', exhausts: 1 },
      { name: 'Sport Coupe', reward: 6, speed: 1.08, length: 29, width: 15, shape: 'coupe', body: '#FF9F1C', accent: '#FFFFFF', exhausts: 2 },
      { name: 'Sports Car', reward: 18, speed: 1.12, length: 30, width: 15.5, shape: 'sports', body: '#E84855', accent: '#FFFFFF', exhausts: 2 },
      { name: 'Supercar', reward: 36, speed: 1.16, length: 31, width: 16, shape: 'super', body: '#9B5DE5', accent: '#F3EEFF', exhausts: 2 },
      { name: 'Hypercar', reward: 72, speed: 1.2, length: 32, width: 16.5, shape: 'hyper', body: '#F2C230', accent: '#23262B', exhausts: 2 },
    ],
  },

  // ---------------------------------------------------------------- drift
  drift: {
    // Corner detection: compare the tangent a bit behind the car with the tangent ahead.
    lookAhead: 44,
    lookBehind: 10,
    cornerAngleForMax: deg(70), // angle change inside that window that counts as cornerStrength = 1
    threshold: 0.25, // cornerStrength needed before a car starts to drift
    maxDriftAngle: deg(28), // body oversteer at full drift (before strong-corner bonus)
    strongCornerThreshold: 0.7, // above this, drift angle is boosted further...
    strongCornerMultiplier: 1.3, // ...up to this multiplier at cornerStrength = 1
    enterSpeed: 5.5, // 1/s - how quickly the rear steps out
    exitSpeed: 3.0, // 1/s - how quickly the car straightens again
    maxBodyTurnRate: deg(240), // hard cap on body rotation per second (no single-frame snaps)
    speedRateScaling: 1, // enter/exit rates scale with speed so fast cars still drift cleanly
    boostAngleBonus: 0.12, // up to +12% drift angle at full NOS
    slideOut: 4, // world units the car slides toward the outside of the corner
    bodySquash: 0.05, // subtle width squash at full drift
    frontWheelCounterSteer: 0.85,
    maxSteer: deg(34),
    effectsThreshold: 0.32, // normalized drift amount needed for skid marks + smoke
  },

  skid: {
    lifetime: 3.8, // seconds before a skid mark fully fades
    maxSegments: 2400, // ring buffer size (oldest marks are overwritten)
    minSegmentLength: 3,
    width: 2.4,
    alpha: 0.26,
    color: '18, 20, 24', // rgb triplet
  },

  smoke: {
    rate: 30, // particles / second per car at full drift (split over both rear wheels)
    lifetime: [0.45, 0.75],
    startSize: [2.2, 3.4],
    endSize: [8, 12],
    alpha: 0.42,
    outwardSpeed: [6, 20],
    backSpeed: [4, 14],
    color: '#EEF1F3',
  },

  // ---------------------------------------------------------------- NOS
  nos: {
    tapBoostAmount: 0.14, // boost meter gained per tap/click (meter range 0..1)
    maxBoostBonus: 0.22, // speed multiplier = 1 + boost * maxBoostBonus  (max 1.22x)
    decayDelay: 0.15, // seconds after a tap before the meter starts draining
    decayRate: 0.95, // proportional drain (1/s)
    decayLinear: 0.06, // constant drain so it really reaches zero
    speedResponse: 4.5, // how smoothly the real speed follows the meter
    visualResponse: 14, // how quickly flames follow the meter
    kickDecay: 5.5, // per-tap flame burst fade speed
    visualIntensity: 1, // global multiplier for flame length / particles
    flameMinLength: 0.18, // * car length, at a tiny boost
    flameMaxLength: 0.6, // * car length, at full boost
    flameKickLength: 0.75, // extra flame length right after a tap (the NOS "spurt")
    flameWidth: 0.26, // * car width
    particleRate: 16, // exhaust particles / second per car at full boost
    tapBurstParticles: 2, // exhaust puff per car on every tap
    tapSurge: 0.06, // brief extra speed right after each tap (fades with the flame spurt)
    maxDriveMult: 1.26, // hard cap for NOS speed + tap surge
    exhaustPop: 9, // size of the backfire ring at each exhaust per tap (0 = off)
    tapSpeedLines: 2, // speed streaks beside each car per tap
    speedLineThreshold: 0.55, // boost level where subtle speed lines start
    speedLineRate: 7, // per car per second at full boost
    bodyStretch: 0.035, // tiny stretch along travel direction at full boost
    vibration: 0.35, // world units of engine shake at full boost
    colors: { outer: '#35C4FF', mid: '#9AE8FF', core: '#FFFFFF' },
    screenPulse: 0, // edge flash alpha per tap (0 = off)
    rippleSize: 30, // ring where the screen was tapped (0 = off)
    tapBurstLines: 8, // radial "pow" streaks where the screen was tapped
    tapOrb: true, // an energy orb flies from the tap to the NOS meter
  },

  // ---------------------------------------------------------------- feedback
  particles: {
    max: 800,
    rewardSparks: 3,
  },

  floatingText: {
    max: 40,
    lifetime: 0.95,
    rise: 26,
    moneySize: 15,
    moneyColor: '#FFE45C',
  },

  ui: {
    moneyPopScale: 0.16,
    moneyPopDecay: 9,
    moneyRollSpeed: 16, // how fast the money counter rolls toward its value
    hintTapsToHide: 4,
  },

  // ---------------------------------------------------------------- game feel
  juice: {
    shakeMax: 6, // CSS px of screen shake at trauma 1
    shakeDecay: 2.8, // trauma lost per second
    shakeTap: 0.4, // screen shake per NOS tap (stacks a little while tapping fast)
    boostRumble: 0.17, // continuous light rumble while NOS is active (scaled by boost)
    edgeLines: {
      // "anime" speed lines streaking out at the screen edges
      rate: 85, // per second at full NOS
      minBoost: 0.08, // no continuous lines below this boost level
      tapBurst: 9, // extra lines on every tap
      innerRadius: 0.68, // 0..1 of the screen's half size: lines only appear outside this
      length: [30, 72], // CSS px
      speed: [700, 1100], // CSS px / second, outward
      width: [1.5, 3],
      alpha: 0.7,
      cyanShare: 0.3, // some lines tinted NOS-cyan
      max: 130,
    },
    shakeLand: 0.2,
    shakeMerge: 0.28,
    shakeMergePerTier: 0.06,
    shakeUpgrade: 0.55,
    tapPunch: 0, // quick world zoom-in per tap, e.g. 0.012 = 1.2% (0 = off)
    hitStopMerge: 0.08, // seconds of slow motion when a merge lands
    hitStopScale: 0.15, // world speed during that slow motion
    dropDuration: 0.36, // new cars fall onto the track...
    dropHeight: 0.85, // ...starting this much bigger (height illusion)
    dropStagger: 0.07, // circuit change: cars land one after another
    squashStiffness: 260,
    squashDamping: 12,
    landSquash: -3.4, // impulse when a car lands
    tapStretch: 0.7, // small forward lurch of every car on each NOS tap (0 = off)
    mergeSquash: -4,
    trailLength: 16, // NOS light-trail samples (frames)
    trailWidth: 0.5, // * car width at the head of the trail
    trailAlpha: 0.4,
    coinFlyDuration: [0.42, 0.62],
    maxFlyingCoins: 24,
    confettiCount: 28,
    tapSparks: 0, // little NOS sparks where the screen was tapped
    boostVignette: 0.09, // cyan screen-edge glow at full NOS
  },

  audio: {
    masterVolume: 0.8,
    sfxVolume: 1,
    engineBaseFreq: 72, // Hz; revs up to ~1.75x with full NOS
    engineVolume: 0.02,
    engineBoostVolume: 0.03,
    screechVolume: 0.05,
    tapRevPitch: 0.16, // engine throttle blip on each tap (pitch)...
    tapRevVolume: 0.02, // ...and loudness
    tapSound: false, // an extra "pssh" one-shot on every NOS tap (off: the engine blip is enough)
    tapHaptic: false, // vibrate on every NOS tap
    haptics: true, // navigator.vibrate on supporting phones (follows the sound toggle)
  },

  save: {
    key: 'drift-merge-save-v1',
    autosaveInterval: 2, // seconds
  },

  // ---------------------------------------------------------------- track
  track: {
    width: 42,
    shoulderWidth: 5,
    edgeLineWidth: 1.6,
    edgeLineInset: 2.2,
    sampleSpacing: 2, // arc-length spacing of the baked centerline
    smoothingPasses: 3,
    smoothingWindow: 4, // samples each side (box filter) - softens straight/arc joins
    curbThreshold: 0.42, // cornerStrength where red/white curbs are painted
    curbWidth: 4.5,
    curbDash: 6,
    tireStackThreshold: 0.9, // cornerStrength where tyre barriers are placed on the outside
  },

  /**
   * Circuits are rounded polygons: [x, y, cornerRadius] per corner, driven in
   * order. The start/finish line (t = 0) sits in the middle of the first edge.
   * Small radius + big turn angle = a drift corner.
   */
  circuits: [
    {
      name: 'Greenfield Park',
      multiplier: 1.0,
      cost: 0,
      speedScale: 1.0,
      theme: 'meadow',
      points: [
        [75, 85, 60],
        [325, 85, 60],
        [340, 300, 110],
        [285, 480, 70],
        [62, 525, 26],
        [58, 360, 120],
        [96, 240, 120],
      ],
    },
    {
      name: 'Lakeside Ring',
      multiplier: 1.5,
      cost: 150,
      speedScale: 1.0,
      theme: 'lakeside',
      points: [
        [70, 70, 50],
        [335, 70, 50],
        [335, 525, 45],
        [125, 525, 38],
        [125, 440, 36],
        [245, 440, 36],
        [245, 255, 40],
        [70, 255, 45],
      ],
    },
    {
      name: 'Canyon Circuit',
      multiplier: 2.25,
      cost: 750,
      speedScale: 1.0,
      theme: 'canyon',
      points: [
        [60, 60, 38],
        [340, 60, 40],
        [340, 225, 30],
        [150, 300, 28],
        [340, 450, 34],
        [265, 530, 40],
        [60, 530, 36],
      ],
    },
  ],

  themes: {
    meadow: {
      ground: '#8CCB6E',
      stripe: '#84C366',
      shoulder: '#E4E8DF',
      asphalt: '#4A5059',
      edgeLine: '#F4F6F7',
      curbA: '#E5483F',
      curbB: '#F6F6F6',
      decor: 'trees',
      treeDark: '#4F9A4E',
      treeLight: '#65B15E',
      bush: '#76BD5E',
    },
    lakeside: {
      ground: '#79C28C',
      stripe: '#71BA84',
      shoulder: '#E2E8E4',
      asphalt: '#474D57',
      edgeLine: '#F4F6F7',
      curbA: '#2F7FD6',
      curbB: '#F6F6F6',
      decor: 'lake',
      treeDark: '#3B8662',
      treeLight: '#4F9E73',
      bush: '#66B07D',
      water: '#5CB6E0',
      waterLight: '#83CBEB',
    },
    canyon: {
      ground: '#E6BC80',
      stripe: '#DFB476',
      shoulder: '#F1E4CC',
      asphalt: '#4B4A52',
      edgeLine: '#F7F3EC',
      curbA: '#E5483F',
      curbB: '#F7F3EC',
      decor: 'rocks',
      rock: '#C98F5C',
      rockLight: '#D9A472',
      bush: '#8FA85A',
      treeDark: '#6E9A4E',
      treeLight: '#86B061',
    },
  },
};

/** Convenience accessor for a tier definition (tiers are 1-based in gameplay). */
export const tierDef = (tier) => CONFIG.cars.tiers[Math.min(tier, CONFIG.cars.tiers.length) - 1];

export const MAX_TIER = CONFIG.cars.tiers.length;
