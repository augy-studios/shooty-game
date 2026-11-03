// What every game's turns share: the weather, the wind, the sway of a hand that is never
// quite still, the arm tiring, and how much a shot matters. Pure, no DOM;
// js/sim.js and every js/sim-<game>.js use it.

import { unit, mix, SALT } from "./seed.js";
import { sin, TAU, PI } from "./fmath.js";

// The wind for turn i: a direction anywhere round the compass and a speed
// up to `max`, stronger as the match goes on (`growth`, 0 to 1).
export function windFor(seedNum, i, max, growth) {
  const dir = TAU * unit(seedNum, i, SALT.windDir);
  const u = unit(seedNum, i, SALT.windSpeed);
  const speed = Math.round(max * (0.12 + 0.88 * u) * (0.65 + 0.35 * growth) * 10) / 10;
  // dir is where it blows to, 0 straight down the range, clockwise from
  // above, so pi / 2 blows to the right.
  return { speed, dir, x: speed * sin(dir), z: speed * sin(dir + PI / 2), ratio: max > 0 ? speed / max : 0 };
}

const smooth = (u) => u * u * (3 - 2 * u);

// A steady hand is never still. The sway is three slow and fast wobbles on
// each axis (the body's drift, breathing, and the hand's tremor), at
// frequencies and phases the seed gives each turn, plus a small kick on
// every heartbeat, which comes faster the more the shot matters. It eases
// in over the first 0.6 s of the aim. Its size is `amp`, in whatever units
// the game aims in, and it is about that much either way at its widest.
export function sway(seedNum, i, ms, amp, bpm = 72) {
  if (amp <= 0 || ms <= 0) return { x: 0, y: 0 };
  const t = ms / 1000;
  const f = (k, base) => base * (0.85 + 0.3 * unit(seedNum, i, SALT.swayFreq, k));
  const ph = (k) => TAU * unit(seedNum, i, SALT.swayPhase, k);
  let x = 0.55 * sin(TAU * f(0, 0.31) * t + ph(0)) + 0.32 * sin(TAU * f(1, 0.93) * t + ph(1)) + 0.13 * sin(TAU * f(2, 3.3) * t + ph(2));
  let y = 0.5 * sin(TAU * f(3, 0.26) * t + ph(3)) + 0.32 * sin(TAU * f(4, 1.07) * t + ph(4)) + 0.13 * sin(TAU * f(5, 2.9) * t + ph(5));
  const beat = (t * bpm) / 60;
  const frac = beat - Math.floor(beat);
  if (frac < 0.14) y += 0.22 * sin((PI * frac) / 0.14);
  const ramp = smooth(Math.min(1, ms / 600));
  x *= amp * ramp;
  y *= amp * ramp;
  return { x, y };
}

// Holding an aim too long tires the arm: from 4 s on the sway grows, to
// double by 10 s.
export const fatigue = (holdMs) => 1 + Math.min(1, Math.max(0, (holdMs - 4000) / 6000));

// The pressure on a shot, 0 to 1, from what the game says about it.
// Rain adds to it (`tension`, from the weather): wet hands, a slippery
// footing and thunder overhead keep a player on edge.
export function pressureOf({ progress = 0, close = 0, decisive = 0, clock = 0, tension = 0 }) {
  const tight = clock === 3 ? 0.1 : clock === 5 ? 0.05 : 0;
  const p = 0.15 * progress + 0.45 * close * (0.4 + 0.6 * progress) + 0.35 * decisive + tight + tension;
  return Math.round(Math.min(1, Math.max(0, p)) * 100) / 100;
}

/* ---- the weather ---- */

// The games played outdoors. Darts is in a room, so it never rains on it.
export const OUTDOOR = { archery: true, darts: false, hoops: true, kicks: true };

// Dry: what every match was before rules 2, and every indoor one.
export const DRY = Object.freeze({ kind: "dry", wet: 0, tension: 0, label: "Dry" });

// The whole match's weather, from the seed. Outdoors, one match in five is
// played in light rain with the odd roll of distant thunder; on Hard three
// in five are, and that rain is a thunderstorm: heavier, with lightning
// close enough to see and thunder close behind it.
//
//   wet       0 to 1, how slippery the ball, the hands and every surface
//             are; each game's file says what it does
//   tension   added to every shot's pressure (js/sim-shared.js pressureOf)
//
// Rules 1 had no weather, so its records play out as they always did.
export function weatherFor(seedNum, game, difficulty, rules) {
  if (rules < 2 || !OUTDOOR[game]) return DRY;
  const hard = difficulty === "hard";
  // Fifths, so the odds are exact: 1 in 5, or 3 in 5 on Hard.
  const fifth = mix(mix(seedNum, 0x5eed), SALT.weather) % 5;
  if (fifth >= (hard ? 3 : 1)) return DRY;
  return hard
    ? Object.freeze({ kind: "storm", wet: 1, tension: 0.08, label: "Thunderstorm" })
    : Object.freeze({ kind: "rain", wet: 0.6, tension: 0.05, label: "Light rain" });
}
