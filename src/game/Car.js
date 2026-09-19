import { CONFIG, tierDef } from './config.js';
import { clamp, damp, invLerp, lerp, popScale, rand, randSign, smoothstep, TAU } from './utils.js';
import { rearWheelLocal } from './CarRenderer.js';
import { P } from './ParticleSystem.js';

const C = CONFIG.cars;
const D = CONFIG.drift;
const N = CONFIG.nos;
const SM = CONFIG.smoke;
const SK = CONFIG.skid;
const J = CONFIG.juice;

let nextId = 1;
const tmpPoint = {};
const tmpCorner = {};

/**
 * One auto-driving car. Movement follows the track centerline (plus a lane
 * offset); the *body* angle is allowed to diverge from the travel direction
 * to show oversteer when the upcoming curvature is strong enough.
 */
export class Car {
  constructor(tier, lane = 0) {
    this.id = nextId++;
    this.lane = lane;
    this.laneOffset = C.laneOffsets[lane] ?? 0;
    this.setTier(tier);

    this.dist = 0;
    this.t = 0;
    this.prevT = 0;
    this.x = 0;
    this.y = 0;
    this.heading = 0;
    this.bodyAngle = 0;
    this.speed = 0;
    this.cornerFactor = 1;
    this.drift = 0; // signed oversteer angle (rad)
    this.driftAmount = 0; // 0..~1.3 normalized drift intensity
    this.steer = 0;

    this.spawnAge = 0;
    this.spawnDuration = C.spawnAnimDuration;
    this.spawnOvershoot = C.spawnOvershoot;
    this.flash = 0;
    this.alpha = 1;
    this.dropping = false; // falling onto the track (spawn / circuit change)
    this.dropAge = 0;
    this.dropDelay = 0;
    this.height = 0; // 0 = on the ground, 1 = top of the drop (drives shadow offset)
    this.sq = 0; // squash & stretch spring (+ = stretched along travel)
    this.sqVel = 0;
    this.trail = new Float32Array(J.trailLength * 2);
    this.trailHead = 0;
    this.trailCount = 0;
    this.renderScale = 1;
    this.stretchX = 1;
    this.stretchY = 1;
    this.jitterX = 0;
    this.jitterY = 0;
    this.nosVisual = 0;
    this.nosKick = 0;
    this.phase = Math.random() * TAU;

    this.smokeAcc = 0;
    this.nosAcc = 0;
    this.lineAcc = 0;
    this.skidL = { x: 0, y: 0 };
    this.skidR = { x: 0, y: 0 };
    this.skidLive = false;
  }

  setTier(tier) {
    this.tier = tier;
    this.def = tierDef(tier);
    this.rearWheel = rearWheelLocal(tier);
  }

  /** Place on the track at normalized position t without triggering reward crossings. */
  place(track, t) {
    this.t = ((t % 1) + 1) % 1;
    this.prevT = this.t;
    this.dist = this.t * track.length;
    const p = track.sample(this.dist, tmpPoint);
    this.heading = p.angle;
    this.bodyAngle = p.angle;
    this.drift = 0;
    this.skidLive = false;
    this.trailCount = 0;
    this.applyPose(track, p);
  }

  playSpawn(overshoot = C.spawnOvershoot, flash = 0.8) {
    this.spawnAge = 0;
    this.spawnOvershoot = overshoot;
    this.flash = flash;
  }

  /** Fall onto the track from above, landing after `delay + dropDuration`. */
  playDrop(delay = 0) {
    this.dropping = true;
    this.dropAge = 0;
    this.dropDelay = delay;
    this.height = 1;
    this.alpha = 0;
    this.renderScale = 0;
    this.spawnAge = 999;
  }

  /** Squash & stretch impulse (+ stretches along the travel direction). */
  kick(impulse) {
    this.sqVel += impulse;
  }

  applyPose(track, p) {
    const nx = -Math.sin(p.angle);
    const ny = Math.cos(p.angle);
    // slide slightly to the outside of the corner while drifting (outside = -dir * normal)
    const lateral = this.laneOffset - (this.drift / D.maxDriftAngle) * D.slideOut;
    this.x = p.x + nx * lateral;
    this.y = p.y + ny * lateral;
  }

  update(dt, env) {
    const { track, boost } = env;

    // ---------------------------------------------------------- speed
    const corner = track.cornerInfo(this.dist, tmpCorner);
    const cornerTarget = 1 - C.cornerSlowdown * corner.strength;
    this.cornerFactor = damp(this.cornerFactor, cornerTarget, C.cornerSpeedResponse, dt);
    this.speed = C.baseSpeed * env.circuitSpeed * this.def.speed * boost.drive * this.cornerFactor;

    this.prevT = this.t;
    this.dist += this.speed * dt;
    while (this.dist >= track.length) this.dist -= track.length;
    this.t = this.dist / track.length;

    // ---------------------------------------------------------- drift
    let target = 0;
    if (corner.strength > D.threshold) {
      let angle = D.maxDriftAngle * smoothstep(D.threshold, 1, corner.strength);
      if (corner.strength > D.strongCornerThreshold) {
        angle *= lerp(1, D.strongCornerMultiplier, invLerp(D.strongCornerThreshold, 1, corner.strength));
      }
      angle *= 1 + D.boostAngleBonus * boost.visual;
      target = corner.dir * angle;
    }
    const growing = Math.abs(target) > Math.abs(this.drift) && Math.sign(target) === Math.sign(this.drift || target);
    const speedScale = lerp(1, clamp(this.speed / C.baseSpeed, 0.6, 1.6), D.speedRateScaling);
    const rate = (growing ? D.enterSpeed : D.exitSpeed) * speedScale;
    const next = damp(this.drift, target, rate, dt);
    const maxStep = D.maxBodyTurnRate * dt;
    this.drift += clamp(next - this.drift, -maxStep, maxStep);
    this.driftAmount = Math.abs(this.drift) / D.maxDriftAngle;

    const p = track.sample(this.dist, tmpPoint);
    this.heading = p.angle;
    this.bodyAngle = p.angle + this.drift;
    this.applyPose(track, p);

    // front wheels: steer into the curve, counter-steer while sliding
    const wheelBase = this.def.length * 0.6;
    const steerTarget = clamp(Math.atan(p.curvature * wheelBase) - this.drift * D.frontWheelCounterSteer, -D.maxSteer, D.maxSteer);
    this.steer = damp(this.steer, steerTarget, 12, dt);

    // ---------------------------------------------------------- visuals
    this.spawnAge += dt;
    if (this.dropping) {
      this.dropAge += dt;
      const k = (this.dropAge - this.dropDelay) / J.dropDuration;
      if (k < 0) {
        this.renderScale = 0;
        this.alpha = 0;
      } else if (k < 1) {
        const h = 1 - k * k; // accelerate like it's falling
        this.height = h;
        this.renderScale = 1 + h * J.dropHeight;
        this.alpha = Math.min(1, k * 4);
      } else {
        this.dropping = false;
        this.height = 0;
        this.renderScale = 1;
        this.alpha = 1;
        this.flash = 0.45;
        this.kick(J.landSquash);
        env.onLand?.(this);
      }
    } else {
      this.renderScale = popScale(this.spawnAge / this.spawnDuration, this.spawnOvershoot);
      this.alpha = 1;
    }
    this.flash = Math.max(0, this.flash - dt * 3.2);

    this.sqVel += (-J.squashStiffness * this.sq - J.squashDamping * this.sqVel) * dt;
    this.sq = clamp(this.sq + this.sqVel * dt, -0.3, 0.3);

    this.nosVisual = boost.visual;
    this.nosKick = boost.kick;
    const nos = Math.min(1, boost.visual);
    const squash = D.bodySquash * Math.min(1, this.driftAmount);
    this.stretchX = (1 + N.bodyStretch * nos) * (1 + this.sq);
    this.stretchY = (1 - N.bodyStretch * 0.5 * nos - squash) * (1 - this.sq * 0.8);

    this.recordTrail();
    const vib = N.vibration * nos;
    this.jitterX = vib ? Math.sin(env.time * 71 + this.phase) * vib : 0;
    this.jitterY = vib ? Math.cos(env.time * 63 + this.phase * 2) * vib : 0;

    this.emitDriftEffects(dt, env, corner);
    this.emitNosEffects(dt, env);
  }

  rearWheels(outL, outR) {
    const c = Math.cos(this.bodyAngle);
    const s = Math.sin(this.bodyAngle);
    const rx = this.rearWheel.x;
    const ry = this.rearWheel.y;
    outL.x = this.x + c * rx + s * ry;
    outL.y = this.y + s * rx - c * ry;
    outR.x = this.x + c * rx - s * ry;
    outR.y = this.y + s * rx + c * ry;
  }

  /** Rear-centre history for the NOS light trail. */
  recordTrail() {
    const c = Math.cos(this.bodyAngle);
    const s = Math.sin(this.bodyAngle);
    const back = this.def.length / 2 - 2;
    const o = this.trailHead * 2;
    this.trail[o] = this.x - c * back;
    this.trail[o + 1] = this.y - s * back;
    this.trailHead = (this.trailHead + 1) % J.trailLength;
    if (this.trailCount < J.trailLength) this.trailCount++;
  }

  emitDriftEffects(dt, env, corner) {
    const intensity = invLerp(D.effectsThreshold, 1, this.driftAmount);
    if (intensity <= 0 || this.renderScale < 0.5 || this.dropping) {
      this.skidLive = false;
      return;
    }
    const L = (this._l ??= { x: 0, y: 0 });
    const R = (this._r ??= { x: 0, y: 0 });
    this.rearWheels(L, R);

    if (!this.skidLive) {
      this.skidL.x = L.x; this.skidL.y = L.y;
      this.skidR.x = R.x; this.skidR.y = R.y;
      this.skidLive = true;
    } else if ((L.x - this.skidL.x) ** 2 + (L.y - this.skidL.y) ** 2 > SK.minSegmentLength ** 2) {
      const a = 0.45 + 0.55 * intensity;
      env.skids.add(this.skidL.x, this.skidL.y, L.x, L.y, a, env.time);
      env.skids.add(this.skidR.x, this.skidR.y, R.x, R.y, a, env.time);
      this.skidL.x = L.x; this.skidL.y = L.y;
      this.skidR.x = R.x; this.skidR.y = R.y;
    }

    // tyre smoke
    this.smokeAcc += dt * SM.rate * intensity * (0.6 + 0.4 * corner.strength);
    const dir = Math.sign(this.drift) || 1;
    const outX = Math.sin(this.heading) * dir; // outside of the corner = -dir * normal
    const outY = -Math.cos(this.heading) * dir;
    const backX = -Math.cos(this.heading);
    const backY = -Math.sin(this.heading);
    while (this.smokeAcc >= 1) {
      this.smokeAcc -= 1;
      const w = Math.random() < 0.5 ? L : R;
      const out = rand(SM.outwardSpeed[0], SM.outwardSpeed[1]);
      const back = rand(SM.backSpeed[0], SM.backSpeed[1]);
      env.particles.spawn(P.SMOKE, w.x + rand(-1, 1), w.y + rand(-1, 1), {
        vx: outX * out + backX * back + rand(-4, 4),
        vy: outY * out + backY * back + rand(-4, 4),
        life: rand(SM.lifetime[0], SM.lifetime[1]),
        size: rand(SM.startSize[0], SM.startSize[1]),
        endSize: rand(SM.endSize[0], SM.endSize[1]),
        alpha: SM.alpha * (0.6 + 0.4 * intensity),
        color: SM.color,
        drag: 2.2,
      });
    }
  }

  exhaustPoint(out, extra = 2) {
    const c = Math.cos(this.bodyAngle);
    const s = Math.sin(this.bodyAngle);
    const back = this.def.length / 2 + extra;
    out.x = this.x - c * back;
    out.y = this.y - s * back;
    return out;
  }

  emitNosEffects(dt, env) {
    const v = this.nosVisual * N.visualIntensity;
    if (v < 0.05 || this.renderScale < 0.5 || this.dropping) return;
    const ex = (this._e ??= { x: 0, y: 0 });
    this.nosAcc += dt * N.particleRate * v;
    while (this.nosAcc >= 1) {
      this.nosAcc -= 1;
      this.exhaustPoint(ex, 2 + rand(0, this.def.length * 0.3 * v));
      this.spawnNosParticle(env.particles, ex, 1);
    }
    if (v > N.speedLineThreshold) {
      this.lineAcc += dt * N.speedLineRate * invLerp(N.speedLineThreshold, 1, v);
      while (this.lineAcc >= 1) {
        this.lineAcc -= 1;
        const side = randSign() * (this.def.width / 2 + rand(3, 9));
        const nx = -Math.sin(this.heading);
        const ny = Math.cos(this.heading);
        const along = rand(-this.def.length * 0.4, this.def.length * 0.2);
        env.particles.spawn(P.SPEED, this.x + nx * side + Math.cos(this.heading) * along, this.y + ny * side + Math.sin(this.heading) * along, {
          angle: this.heading,
          life: rand(0.18, 0.28),
          size: rand(8, 14),
          alpha: 0.55,
          color: '#FFFFFF',
          width: 1.2,
        });
      }
    }
  }

  spawnNosParticle(particles, at, strength) {
    const back = rand(18, 45) * strength;
    particles.spawn(P.NOS, at.x + rand(-1.5, 1.5), at.y + rand(-1.5, 1.5), {
      vx: -Math.cos(this.bodyAngle) * back + rand(-6, 6),
      vy: -Math.sin(this.bodyAngle) * back + rand(-6, 6),
      life: rand(0.22, 0.4),
      size: rand(1.6, 2.6),
      endSize: 0.4,
      alpha: 0.9,
      color: Math.random() < 0.35 ? N.colors.core : N.colors.outer,
      drag: 3,
    });
  }

  /** NOS fired: backfire pop at the exhaust, puff, speed streaks, small lurch. */
  nosBurst(particles) {
    if (J.tapStretch) this.kick(J.tapStretch);
    if (this.dropping || this.renderScale < 0.5) return;
    const ex = (this._e ??= { x: 0, y: 0 });
    this.exhaustPoint(ex, 1);
    if (N.exhaustPop > 0) {
      particles.spawn(P.RING, ex.x, ex.y, { size: 1, endSize: N.exhaustPop, life: 0.2, color: N.colors.mid, width: 2.2, alpha: 0.95 });
    }
    for (let i = 0; i < N.tapBurstParticles; i++) {
      this.exhaustPoint(ex, 2 + i * 1.5);
      this.spawnNosParticle(particles, ex, 1.6);
    }
    const nx = -Math.sin(this.heading);
    const ny = Math.cos(this.heading);
    const tx = Math.cos(this.heading);
    const ty = Math.sin(this.heading);
    for (let i = 0; i < N.tapSpeedLines; i++) {
      const side = (i % 2 ? 1 : -1) * (this.def.width / 2 + rand(3, 7));
      const along = -this.def.length * rand(0.1, 0.6);
      particles.spawn(P.SPEED, this.x + nx * side + tx * along, this.y + ny * side + ty * along, {
        angle: this.heading,
        vx: -tx * 40,
        vy: -ty * 40,
        life: rand(0.2, 0.3),
        size: rand(10, 16),
        alpha: 0.75,
        color: '#FFFFFF',
        width: 1.4,
      });
    }
  }
}
