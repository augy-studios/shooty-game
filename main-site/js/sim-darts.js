// Darts: count down from 101, 301 or 501, three darts a visit, turn about.
// The last dart has to land the exact score; going under zero is a bust,
// which ends the visit and puts the score back where the visit started.
//
// The board is a regulation one: the twenty numbers in their usual order,
// a bull 12.7 mm across, the outer bull 31.8 mm, the treble ring 8 mm wide
// at 99 to 107 mm out and the double ring at 162 to 170 mm, the face hung
// with its middle 1.73 m up and 2.37 m from the oche.
//
// Aiming is two sweeps: a marker runs side to side until a tap stops it,
// then one runs up and down until a second tap. The sweeps are not quite
// steady (the hand's tremor rides on them, more so under pressure) and the
// throw itself adds a little more of the same. Then there is the air: a
// dart is light and slow next to an arrow, so even a breeze through an
// open window moves it a few millimetres, and a stiff one a few
// centimetres.
//
// Shot, as recorded: [stop side to side ms, stop up and down ms], both from
// the start of the aim. Where the markers were then is worked out from the
// seed, so the record cannot claim a spot the sweeps were not at.

import { body, newPath, record, toPlane, solveLaunch, DT } from "./physics.js";
import { gauss, unit, SALT } from "./seed.js";
import { hypot, atan2, sin, cos, PI, TAU } from "./fmath.js";
import { MAX_AIM_MS } from "./rules.js";

export const BOARD_Z = 2.37;
export const BOARD_Y = 1.73;
export const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
export const RADII = { bull: 0.00635, outer: 0.0159, trebleIn: 0.099, trebleOut: 0.107, doubleIn: 0.162, doubleOut: 0.17, edge: 0.2255 };
// How far either way the sweeps run.
export const SWEEP = 0.235;
const HAND = { x: 0.04, y: 1.62, z: 0.55 };
const SPEED = 6.6;
const K = 0.05;
const VISITS = 30;

const TUNING = {
  easy: { period: 2600, wind: 0.7, tremor: 0.003, release: 0.003, botSd: 0.036, botComp: 0.3 },
  medium: { period: 2000, wind: 1.6, tremor: 0.005, release: 0.004, botSd: 0.026, botComp: 0.6 },
  hard: { period: 1500, wind: 2.6, tremor: 0.007, release: 0.005, botSd: 0.016, botComp: 0.85 },
};

const int = (v) => Number.isInteger(v);

// -1 to 1 and back, once a period.
const tri = (u) => {
  const f = u + 0.25 - Math.floor(u + 0.25);
  return 1 - 4 * Math.abs(f - 0.5);
};

// What a dart scores where it lands, x and y from the middle of the board.
export function scoreAt(x, y) {
  const r = hypot(x, y);
  if (r <= RADII.bull) return { value: 50, label: "Bull", ring: "bull" };
  if (r <= RADII.outer) return { value: 25, label: "25", ring: "outer" };
  if (r > RADII.doubleOut) return { value: 0, label: r > RADII.edge ? "Off the board" : "Outside the doubles", ring: "miss" };
  let a = atan2(x, y);
  if (a < 0) a += TAU;
  const n = ORDER[Math.floor((a + PI / 20) / (PI / 10)) % 20];
  if (r >= RADII.trebleIn && r <= RADII.trebleOut) return { value: n * 3, label: `T${n}`, ring: "treble", n };
  if (r >= RADII.doubleIn) return { value: n * 2, label: `D${n}`, ring: "double", n };
  return { value: n, label: `${n}`, ring: "single", n };
}

// The middle of a bed: a number's treble, double or single, as x, y.
export function bedPoint(n, ring) {
  const k = ORDER.indexOf(n);
  const a = (k * PI) / 10;
  const r = ring === "treble" ? 0.103 : ring === "double" ? 0.166 : ring === "inner" ? 0.06 : 0.135;
  return { x: r * sin(a), y: r * cos(a) };
}

// Can one dart finish from `rem`?
export function oneDartOut(rem) {
  if (rem <= 0) return false;
  return rem <= 20 || (rem <= 40 && rem % 2 === 0) || (rem <= 60 && rem % 3 === 0) || rem === 25 || rem === 50;
}

// The bed the bot goes for from `rem`.
function botTarget(rem) {
  if (rem > 60) return { x: bedPoint(20, "treble").x, y: bedPoint(20, "treble").y };
  if (rem <= 20) return bedPoint(rem, "single");
  if (rem === 50) return { x: 0, y: 0 };
  if (rem === 25) return { x: 0, y: 0.011 };
  if (rem <= 40 && rem % 2 === 0) return bedPoint(rem / 2, "double");
  if (rem % 3 === 0) return bedPoint(rem / 3, "treble");
  // Leave twenty, or forty, which are the easiest outs.
  const leave = rem - 20 <= 20 ? 20 : 40;
  return bedPoint(Math.min(20, Math.max(1, rem - leave)), "single");
}

export const darts = {
  id: "darts",

  setup(settings) {
    const start = { short: 101, standard: 301, long: 501 }[settings.length];
    return {
      start,
      rem: [start, start],
      visitFrom: [start, start],
      visits: [0, 0],
      player: 0,
      dart: 0,
      done: false,
      winner: null,
      // Every visit's darts, per player: [label, value, bust].
      log: [[], []],
      t: TUNING[settings.difficulty],
    };
  },

  nextTurn(g) {
    if (g.done) return null;
    const p = g.player;
    return {
      player: p,
      round: g.visits[p],
      dart: g.dart,
      sameGo: g.dart > 0,
      label: `Visit ${g.visits[p] + 1}, dart ${g.dart + 1}`,
    };
  },

  conditions(g, desc, ctx) {
    const p = desc.player;
    const wind = ctx.windFor(ctx.seedNum, ctx.i, g.t.wind, Math.min(1, g.visits[p] / 8));
    const mine = g.rem[p];
    const theirs = g.rem[1 - p];
    const pressure = ctx.pressureOf({
      progress: 1 - mine / g.start,
      close: theirs <= 60 ? 1 : Math.max(0, 1 - Math.abs(mine - theirs) / g.start),
      decisive: oneDartOut(mine) ? 1 : mine <= 100 ? 0.3 : 0,
      clock: ctx.settings.clock,
    });
    const base = ctx.base("darts", wind, pressure);
    return {
      ...base,
      period: g.t.period,
      tremor: g.t.tremor * base.nerves,
      release: g.t.release * base.nerves,
      // Where each sweep starts, so no two darts sweep alike.
      phaseX: unit(ctx.seedNum, ctx.i, SALT.drift, 0),
      phaseY: unit(ctx.seedNum, ctx.i, SALT.drift, 1),
      remaining: mine,
    };
  },

  inputOf(desc, humans) {
    return humans[desc.player] ? "shot" : null;
  },

  cleanShot(kind, s) {
    if (kind !== "shot" || !Array.isArray(s) || s.length !== 2 || !s.every(int)) return null;
    const [a, b] = s;
    if (a < 0 || b < a || b > MAX_AIM_MS) return null;
    return [a, b];
  },

  // The dart leaves a moment after the second tap, with the throw.
  releaseMs: (kind, s) => s[1] + 140,

  timeout(kind, live, clockMs) {
    const stopX = live?.stopX ?? clockMs - 140;
    return [Math.min(stopX, clockMs - 140), clockMs - 140];
  },

  // The markers at `ms` into the aim. Before the first tap only the side
  // to side one runs; after it, the up and down one.
  markers(cond, ctx, ms, stopX = null) {
    const xAt = stopX ?? ms;
    const sx = ctx.sway(ctx.seedNum, ctx.i, xAt, cond.tremor, cond.bpm);
    const x = SWEEP * tri(xAt / cond.period + cond.phaseX) + sx.x;
    if (stopX === null) return { x, y: null };
    const yMs = Math.max(0, ms - stopX);
    const sy = ctx.sway(ctx.seedNum, ctx.i, ms, cond.tremor, cond.bpm);
    const y = SWEEP * tri(yMs / (cond.period * 0.9) + cond.phaseY) + sy.y;
    return { x, y };
  },

  botShot(g, turn, ctx) {
    const cond = turn.cond;
    const target = botTarget(g.rem[turn.player]);
    // The breeze, read and allowed for in part.
    const drift = throwAt(cond, 0, 0, null);
    const ax = target.x - drift.x * g.t.botComp + gauss(ctx.seedNum, ctx.i, SALT.botAim, 0) * g.t.botSd * cond.nerves;
    const ay = target.y - (drift.y - BOARD_Y) * g.t.botComp + gauss(ctx.seedNum, ctx.i, SALT.botAim, 1) * g.t.botSd * cond.nerves;
    const stopX = 350 + Math.floor(500 * unit(ctx.seedNum, ctx.i, SALT.botTime, 0));
    const stopY = stopX + 300 + Math.floor(400 * unit(ctx.seedNum, ctx.i, SALT.botTime, 1));
    // The bot's darts are not stopped on a sweep: it puts them where it
    // means to, and its spread stands in for the sweeps. Marked as such.
    return [stopX, stopY, Math.round(ax * 10000), Math.round(ay * 10000)];
  },

  resolve(g, turn, shot, ctx) {
    const cond = turn.cond;
    let aim;
    if (shot.length === 4) aim = { x: shot[2] / 10000, y: shot[3] / 10000 };
    else aim = this.markers(cond, ctx, shot[1], shot[0]);
    const ex = gauss(ctx.seedNum, ctx.i, SALT.release, 0) * cond.release;
    const ey = gauss(ctx.seedNum, ctx.i, SALT.release, 1) * cond.release;
    const path = newPath();
    const hit = throwAt(cond, aim.x + ex, aim.y + ey, path);
    const x = hit.x;
    const y = hit.y - BOARD_Y;
    const s = scoreAt(x, y);
    const p = turn.player;
    const left = g.rem[p] - s.value;
    const bust = left < 0;
    const out = left === 0;
    const raw = [0, 0];
    raw[p] = bust ? 0 : s.value + (out ? 50 : 0);
    return {
      releaseMs: this.releaseMs("shot", shot),
      flightMs: Math.round(hit.t * 1000),
      settleMs: out ? 1900 : bust ? 1400 : turn.dart === 2 ? 1100 : 450,
      aim,
      hit: { x, y },
      value: s.value,
      bed: s,
      bust,
      out,
      raw,
      path: path.pts,
      dir: hit.dir,
      label: bust ? `${s.label}, bust` : out ? `${s.label}, game shot` : s.label,
    };
  },

  apply(g, turn, r) {
    const p = turn.player;
    g.log[p].push([r.bed.label, r.value, r.bust]);
    if (r.bust) g.rem[p] = g.visitFrom[p];
    else g.rem[p] -= r.value;
    g.dart += 1;
    if (r.out) {
      g.done = true;
      g.winner = p;
      return;
    }
    if (r.bust || g.dart === 3) {
      g.visits[p] += 1;
      g.dart = 0;
      g.player = 1 - p;
      g.visitFrom[g.player] = g.rem[g.player];
      if (g.visits[0] >= VISITS && g.visits[1] >= VISITS) g.done = true;
    }
  },

  board(g) {
    return { scores: [...g.rem], start: g.start, visits: [...g.visits] };
  },

  outcome(g) {
    if (g.winner !== null) return { winner: g.winner };
    if (g.rem[0] !== g.rem[1]) return { winner: g.rem[0] < g.rem[1] ? 0 : 1, detail: "nearest zero after thirty visits" };
    return { winner: null };
  },
};

// Throws a dart at (x, y) on the board, still air sighted, and flies it
// with the breeze to the board's face.
function throwAt(cond, x, y, path) {
  const steps = Math.ceil(2 / DT);
  const target = { x, y: BOARD_Y + y, z: BOARD_Z };
  const v = solveLaunch(HAND, target, SPEED, { k: K }, steps);
  const b = body(HAND.x, HAND.y, HAND.z, v.x, v.y, v.z);
  if (path) record(path, b, true);
  const hit = toPlane(b, { wx: cond.wind.x, wz: cond.wind.z, k: K, spin: 0 }, BOARD_Z, steps, path, 0);
  if (path) record(path, b, true);
  return { ...hit, dir: { x: b.vx, y: b.vy, z: b.vz } };
}
