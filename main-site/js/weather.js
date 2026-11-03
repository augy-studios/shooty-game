// When the lightning flashes and the thunder rolls, in a match the seed
// made wet (js/sim-shared.js weatherFor). It changes nothing in the match,
// but it is worked out from the seed and the game clock, never
// Math.random, so a replay flashes and rumbles exactly where the match did.
//
// Pure, no DOM: js/scene-weather.js draws it and js/game.js plays it.
//
// The numbers are the real ones:
//   - sound covers a kilometre in about 2.9 s (343 m/s at 20 C), so the
//     thunder comes that long after the flash for every kilometre away;
//     light arrives at once
//   - thunder is seldom heard beyond about 20 km
//   - a flash to the ground is usually three or four return strokes, about
//     60 ms apart, which is the flicker
// Light rain: a far off storm, a low rumble every minute or so, 6 to 15 km
// away, its flashes no more than a glow on the clouds. A thunderstorm on
// Hard: a strike every ten seconds or so, under 6 km, the bolt in sight
// and the crack close behind it.

import { mix } from "./seed.js";

export const SPEED_OF_SOUND = 343;
export const MS_PER_KM = 1e6 / SPEED_OF_SOUND;

const PLANS = {
  rain: { slot: 32000, chance: 0.6, near: 6, far: 15 },
  storm: { slot: 11000, chance: 0.85, near: 0.8, far: 6 },
};

// The longest a thunderclap can come after its flash in any weather.
export const MAX_DELAY_MS = PLANS.rain.far * MS_PER_KM;

const u = (seedNum, k, j) => mix(mix(mix(seedNum, 0x7a11), k), j) / 4294967296;

// The strike in time slot k, or null if that slot has none.
function strike(plan, seedNum, k) {
  if (k < 0 || u(seedNum, k, 0) >= plan.chance) return null;
  // Not in the first moment of a match.
  const t = k * plan.slot + plan.slot * (0.15 + 0.8 * u(seedNum, k, 1));
  // Anywhere from near to far: the storm is overhead, so close strikes
  // are as likely as distant ones.
  const km = plan.near + (plan.far - plan.near) * u(seedNum, k, 2);
  // Two to five return strokes, about 60 ms apart (40 to 100).
  const n = 2 + Math.floor(u(seedNum, k, 3) * 4);
  const strokes = [0];
  for (let s = 1; s < n; s++) strokes.push(strokes[s - 1] + 40 + 60 * u(seedNum, k, 10 + s));
  return {
    k,
    t,
    km,
    strokes,
    // Where in the sky: -1 far left to 1 far right of the view.
    bearing: u(seedNum, k, 4) * 2 - 1,
    // A number for the bolt's own shape.
    shape: mix(seedNum, k),
    thunderAt: t + km * MS_PER_KM,
  };
}

// Every strike whose flash falls between t0 and t1, game ms.
export function strikesBetween(weather, seedNum, t0, t1) {
  const plan = PLANS[weather?.kind];
  if (!plan || t1 < t0) return [];
  const out = [];
  for (let k = Math.max(0, Math.floor(t0 / plan.slot) - 1); k <= Math.floor(t1 / plan.slot); k++) {
    const s = strike(plan, seedNum, k);
    if (s && s.t >= t0 && s.t <= t1) out.push(s);
  }
  return out;
}

// Thunderclaps that land between t0 (not included) and t1, game ms.
export function thunderBetween(weather, seedNum, t0, t1) {
  return strikesBetween(weather, seedNum, t0 - MAX_DELAY_MS, t1).filter((s) => s.thunderAt > t0 && s.thunderAt <= t1);
}

// How bright the flash is at t, 0 to 1, and the strike making it. Each
// stroke lights up at once and fades over about 80 ms; the strokes after
// the first are a little weaker.
export function flashAt(weather, seedNum, t) {
  const plan = PLANS[weather?.kind];
  if (!plan) return { flash: 0, strike: null };
  let best = { flash: 0, strike: null };
  for (const s of strikesBetween(weather, seedNum, t - 700, t)) {
    let f = 0;
    s.strokes.forEach((at, i) => {
      const age = t - s.t - at;
      if (age >= 0 && age < 160) f = Math.max(f, (i === 0 ? 1 : 0.75) * Math.exp(-age / 55));
    });
    // Further away, dimmer: a far one only lights the clouds.
    f *= Math.min(1, 1.6 / (0.6 + s.km));
    if (f > best.flash) best = { flash: f, strike: s };
  }
  return best;
}
