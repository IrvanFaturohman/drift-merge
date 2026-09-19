# Drift Merge (prototype)

A 2D top-down idle racing game. Your cars drive themselves around a race circuit and drift through the corners. Each time a car crosses a reward line it earns money. Tap or click to fire NOS, then spend what you earn to add cars, merge them into better cars, add reward lines and upgrade the circuit.

It's built with Vite, vanilla JavaScript, HTML5 Canvas and CSS. It has no game engine and no framework.

**▶ Play it in your browser (phone or desktop): https://irvanfaturohman.github.io/drift-merge/**

```bash
npm install
npm run dev      # then open the printed localhost URL (add --host to open it from a phone on the same Wi-Fi)
npm run build    # production build into dist/
npm run deploy   # build and publish dist/ to the gh-pages branch (GitHub Pages)
```

## How to play

| Input | Action |
| --- | --- |
| Tap or click anywhere on the race area | Fire NOS: cars speed up slightly (1.22x at most), and it fades out smoothly when you stop |
| Space (desktop) | Same as a tap |
| **MERGE** | Merges cars of the lowest tier that has enough of them into one car of the next tier. T1→T2 takes 2 cars, T2→T3 and T3→T4 take 3, and T4 and up take 2 (`merge.carsNeeded`). When no merge is ready, the button shows progress, e.g. `T2 2/3` |
| **ADD CAR** | Buys a Tier 1 car (8 cars at most). Price = 10 × 1.6^purchases |
| **ADD REWARD LINE** | Adds a checkpoint gantry at 0.25, 0.50 or 0.75 of the lap (4 lines at most). A gantry is poles, a beam and a checkered banner, and cars drive under it. The start/finish line (line 1) is a checkered line painted on the asphalt with no gantry. The line or banner flashes when a car earns money |
| **UPGRADE CIRCUIT** | Unlocks the next circuit (x1.5, then x2.25 income) |
| **D**, or 5 quick taps on the CIRCUIT chip | Opens or closes the debug panel (FPS, state, +money, spawn car, next circuit, reset save) |

Progress is saved to `localStorage` every 2 seconds, after every purchase, and when the tab is hidden or closed.

## Project structure

```
index.html              HUD, play area and button markup
src/main.js             entry point (waits for the font, then starts the Game)
src/styles/main.css     portrait layout, HUD, buttons, debug panel
src/game/
  config.js             ALL tuning values (economy, cars, drift, NOS, skid, smoke, circuits, themes)
  Game.js               wires the systems together: game loop, input, actions, rendering order
  Track.js              closed-path math: arc-length samples, position, tangent, curvature, corner strength
  TrackRenderer.js      draws ground, asphalt, curbs, tyre barriers and decoration into an offscreen layer
  TrackManager.js       holds the current circuit, the cached track layer and the fade transition
  Car.js                one car: follows the track, speed, drift, skid, smoke and NOS effects
  CarRenderer.js        procedural top-down car art (6 tier silhouettes), shadow, NOS flame, merge ghost
  CarManager.js         spawning and spacing, merge logic, per-frame updates, reward-line crossings
  Economy.js            money and every price formula
  RewardLine.js         checkpoints and crossing detection (handles the wrap from 0.99 back to 0.00)
  ParticleSystem.js     pooled particles (smoke, NOS, sparks, rings, speed lines)
  SkidMarks.js          ring buffer of fading skid segments, drawn in alpha buckets
  FloatingText.js       pooled "+$12" / "TIER 3!" / circuit banner text
  BoostSystem.js        NOS meter: tap → boost → decay → smoothed speed multiplier
  SaveSystem.js         validated save and load in localStorage
  utils.js              math and formatting helpers
src/ui/
  UI.js                 DOM HUD: money pop, NOS meter, button states and press feedback
  DebugUI.js            debug panel (FPS, state, +money, spawn car, next circuit, 2-step reset)
tools/
  track-check.mjs       node tools/track-check.mjs → checks circuit length, clearance and corner mix
  economy-sim.mjs       node tools/economy-sim.mjs [tapMult] [minutes] ['{json overrides}'] → pacing sim
```

## How the key systems work

**Track path.** Each circuit is a rounded polygon: `[x, y, cornerRadius]` for every corner. That gives true straights, and a small radius on a big turn makes a drift corner. The loop is sampled, resampled evenly by arc length, and box-filtered so curvature eases into and out of each corner. Cars and reward lines use normalized progress (`t` from 0 to 1, wrapping back to 0).

**Drift.** Each frame a car compares the track tangent a little *behind* it with the tangent `lookAhead` units *ahead*. The angle difference, normalized, is `cornerStrength` (0 = straight, 1 = hairpin). Above `drift.threshold`, a target oversteer angle is set, with a bonus for very sharp corners and a small bonus under NOS. The **body** angle eases toward `heading + oversteer` using separate enter and exit rates, and a hard limit on how fast it can turn. The **movement** always follows the track. The rear slides slightly outward, the front wheels countersteer, and skid marks and smoke come off the rear wheels.

**NOS.** Each tap adds `tapBoostAmount` to a 0–1 meter. After a short delay the meter drains in proportion to its level. Speed = `1 + boost × maxBoostBonus`, and the actual multiplier eases toward that value so it never jumps. NOS affects only speed and visuals, never the income formula directly. It gives about 1.1–1.15x with casual tapping and 1.22x at most with heavy tapping.

**Reward crossings.** Each car stores `prevT` and `t` every frame. A line at position `p` pays out when `p` is in `(prevT, t]`, or in the wrapped range when the car passes 1.0 → 0.0. Consecutive frame intervals never overlap, so each real crossing pays exactly once. Moving a car (on spawn, merge or circuit change) sets `prevT = t`, so it can never pay out by accident.

## Game feel and audio

All the tuning values live in `juice` and `audio` in `config.js`.

- **Sound effects** are generated in code with Web Audio (`src/game/AudioSystem.js`); there are no audio files.
  - **Continuous:** an engine hum that revs up with NOS, and a tyre squeal that follows how hard cars are drifting.
  - **One-shots:** NOS "pssh", a coin "ding" that rises in pitch when coins come in quick succession, a car landing thud, a merge chord, a reward-line chime, a circuit-upgrade fanfare, and button click and "denied" sounds.
  - The speaker button in the top-right corner mutes sound and vibration. Audio starts on the first tap, which is how mobile browsers require it.
- **Haptics:** light vibration on taps, landings, merges and purchases, on phones that support `navigator.vibrate` (Android).
- **Money:** each reward crossing sends a coin flying into the counter. The counter rolls up to the new value, flashes gold and pops, and the coin icon spins. Money you spend shows as a red "-$X" next to the counter.
- **Cars:** new cars drop onto the track and land with dust, a ring, a small screen shake and a squash. After a circuit upgrade, every car lands one after another.
- **NOS tap:** the feedback stays local. Screen-wide effects are left out because players tap constantly.
  - **At the finger:** a crisp cyan and white "pow" (a ring plus radial streaks), and an energy orb that flies into the NOS meter, which flashes when it lands.
  - **On every car:** a long flame spurt, a backfire ring at the exhaust, speed streaks, a small forward lurch and a brief speed surge (capped at 1.26x). The engine blips its throttle on each tap.
  - **Screen:** a small smooth shake on each tap, and "anime" speed lines that streak out at the screen edges. Both stay out of the middle of the track.
  - **While boosted:** cars leave cyan light trails, the screen edges glow softly, speed lines stream continuously, the view rumbles slightly, and the meter glows and shivers when it's full. Shake is turned off when the device has "reduce motion" enabled.
  - **Off by default:** a separate tap sound, tap vibration, zoom punch and screen flash. See *Tap feedback* below.
- **Merge:** a brief slow-motion moment (hit-stop), a shockwave ring, confetti, sparkles, a tier-coloured "TIER N!" label and a screen shake that gets stronger at higher tiers.
- **Circuit upgrade:** a checkered-flag wipe, a banner, falling confetti and cars landing on the new track.
- **Buttons:** a shine sweeps across the buttons you can afford, and MERGE wiggles when a pair is ready. A button bounces and flashes when you buy something, and shakes with a buzz when you tap it without enough money.

## Balance notes

The balance aims for lots of cars on track and frequent buying and merging. **Cars are cheap and get more expensive slowly. Progression is paced by income instead.**

- **Add car:** $3 × 1.1ⁿ, giving $3, 4, 5, 7, 9, 13, 17, 22, 30, 39… for every third purchase.
- **Tier rewards:** 1 / 2 / 6 / 18 / 36 / 72. Each tier pays exactly what the cars merged into it paid (T2 = 2×T1, T3 = 3×T2, T4 = 3×T3, T5 = 2×T4, T6 = 2×T5), so a merge never lowers income. It frees slots under the 8-car cap and adds a little speed.
- **Reward lines:** 40 / 120 / 320. **Circuits:** 150 (x1.5) and 750 (x2.25).

Measured with `node tools/economy-sim.mjs greedy 16`, a player who buys whatever is affordable:

| Milestone | Time |
| --- | --- |
| First car purchase | ~0:15 |
| First Tier 3 / Tier 4 / Tier 5 | ~0:50 / ~2:00 / ~4:00 |
| Circuit 2 / Circuit 3 | ~5:00 / ~8:30 |
| First Tier 6 | ~12:30 |
| Car purchases per minute | 6–12 in minutes 1–4, 4–7 in minutes 5–8, 2–4 in minutes 9–12 |

A player who saves up for lines and circuits reaches Circuit 3 at about 4 minutes. The `smart` policy in the sim models that.

## Tuning quick reference (`src/game/config.js`)

- **Feel of the drift:** `drift.threshold`, `maxDriftAngle`, `strongCornerMultiplier`, `enterSpeed`, `exitSpeed`, `slideOut`
- **NOS:** `nos.tapBoostAmount`, `maxBoostBonus`, `decayRate`, `decayDelay`, `flameMaxLength`, `visualIntensity`
- **Skid and smoke:** `skid.lifetime`, `skid.alpha`, `smoke.rate`, `smoke.lifetime`
- **Economy:** `economy.startingMoney`, `addCar.*`, `rewardLines.prices`, `circuits[i].cost / multiplier`, `cars.tiers[i].reward`, `merge.carsNeeded`
- **Tap feedback:** `nos.rippleSize / tapBurstLines / tapOrb / flameKickLength / exhaustPop / tapSpeedLines / tapSurge`, `juice.tapStretch`, `audio.tapRevPitch / tapRevVolume`. `juice.shakeTap / boostRumble / edgeLines`. These are off by default: `nos.screenPulse`, `juice.tapPunch / tapSparks`, `audio.tapSound / tapHaptic`
- **Cars:** `cars.baseSpeed`, `cornerSlowdown`, `laneOffsets`, `maxCars`, and the per-tier `speed / length / width / body / accent`
- **Circuits:** edit `circuits[i].points`, then run `node tools/track-check.mjs` to check that the track doesn't overlap itself
