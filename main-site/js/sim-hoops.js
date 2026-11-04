// Hoops: five spots round the arc each round, further out every round, a
// shot each from every spot, turn about.
//
// A regulation hoop: the rim 3.05 m up, 45.7 cm across inside, its middle
// 38 cm out from a 1.83 by 1.07 m backboard; a size 7 ball, 24 cm across
// and 0.62 kg. The ball comes off the rim and the board, and a make is the
// ball's middle dropping down through the ring. One that touches nothing
// on the way is a swish and worth a point more. Inside the 6.75 m line a
// basket is two, beyond it three.
//
// A basketball is big and slow for its weight, so it feels the wind more
// than anything else in this game: a crosswind of a couple of metres a
// second moves a long shot by most of the rim's width. The hoop stays
// still; only records played before rules 3 have it drift side to side on
// Hard, and they still play that way.
//
// In the rain (cond.wet, js/sim-shared.js weatherFor) a rubber ball is
// slick in the hand, so the aim and the pull wander more, and it skids
// instead of gripping: off a wet rim and glass it keeps more of its speed
// along them, and off a wet court it comes up lower and slides on.
//
// Shot, as recorded: [press ms, release ms, aim centidegrees, power
// permille]: when the pull began and was let go, from the start of the
// aim; the aim left or right of straight at the hoop; the pull's length.
// The sway is added to both from the seed.

import { body, newPath, record, step, reflect, DT, SAMPLE_MS } from "./physics.js";
import { gauss, unit, SALT } from "./seed.js";
import { hypot, sin, cos, deg, TAU, PI, atan2 } from "./fmath.js";
import { MAX_AIM_MS } from "./rules.js";
import { fatigue } from "./sim-shared.js";

export const RIM_Y = 3.05;
export const RIM_R = 0.2286;
const TUBE = 0.009;
export const BALL = 0.12;
export const BOARD_Z = 0.381;
export const BOARD = { half: 0.915, bottom: 2.9, top: 3.97 };
const RELEASE_Y = 2.2;
// Elevation of every shot. Power picks the distance.
export const ELEVATION = deg(52);
// The full pull covers the speeds a shot from the arc needs, so a little
// more pull is a little more speed.
export const MIN_SPEED = 6;
export const MAX_SPEED = 10;
const K = 0.016;
export const THREE = 6.75;
export const SPOT_ANGLES = [-70, -35, 0, 35, 70];
const NEAR = 4.4;
const FAR = 7.6;

// Spreads are a standard deviation: the bot's aim in degrees and its speed
// as a share of the speed. A shot from 4.4 m goes in from about 1.4 degrees
// either side and 1% either way on speed, less from further out.
const TUNING = {
  easy: { wind: 1.2, yaw: 0.3, power: 4, botYaw: 0.7, botPower: 0.007, botComp: 0.45, drift: 0 },
  medium: { wind: 2.4, yaw: 0.45, power: 6, botYaw: 0.5, botPower: 0.005, botComp: 0.75, drift: 0 },
  hard: { wind: 3.4, yaw: 0.6, power: 8, botYaw: 0.35, botPower: 0.0035, botComp: 0.92, drift: 0.5 },
};
const DRIFT_PERIOD = 4200;

// What the ball does off each surface: the share of its speed into the
// surface that comes back, and of its speed along it that stays. Wet, the
// grip goes towards 1, which is no friction at all.
const DRY_SURFACES = { board: [0.62, 0.85], rim: [0.58, 0.82], floor: [0.72, 0.9] };
function surfaces(wet) {
  if (!wet) return DRY_SURFACES;
  return {
    board: [0.62, 0.85 + 0.1 * wet],
    rim: [0.58 - 0.02 * wet, 0.82 + 0.1 * wet],
    floor: [0.72 - 0.06 * wet, 0.9 + 0.06 * wet],
  };
}
// How much more a wet ball's aim and pull wander, in the hand.
const slipOf = (wet) => (wet ? 1 + 0.08 * wet : 1);

const int = (v) => Number.isInteger(v);
export const speedOf = (power) => MIN_SPEED + ((MAX_SPEED - MIN_SPEED) * power) / 1000;
export const powerOf = (speed) => ((speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)) * 1000;

// Where the rim's middle is, side to side, `ms` into the aim.
export function rimX(cond, ms) {
  return cond.drift ? cond.drift * sin((TAU * ms) / DRIFT_PERIOD + cond.driftPhase) : 0;
}

export const hoops = {
  id: "hoops",

  setup(settings) {
    const rounds = { short: 2, standard: 3, long: 4 }[settings.length];
    return {
      rounds,
      k: 0,
      totals: [0, 0],
      makes: [0, 0],
      swishes: [0, 0],
      // Per player, per turn: 0 missed, 2 or 3 made, plus 1 for a swish.
      log: [[], []],
      t: TUNING[settings.difficulty],
    };
  },

  nextTurn(g) {
    if (g.k >= g.rounds * 10) return null;
    const round = Math.floor(g.k / 10);
    const spot = Math.floor((g.k % 10) / 2);
    const player = g.k % 2;
    return { player, round, spot, label: `Round ${round + 1} of ${g.rounds}, spot ${spot + 1} of 5` };
  },

  conditions(g, desc, ctx) {
    const growth = g.rounds > 1 ? desc.round / (g.rounds - 1) : 1;
    // Both players shoot from the same spot, so it is drawn for the pair.
    const pair = ctx.i - desc.player;
    const radius = Math.round((NEAR + (FAR - NEAR) * growth + 0.3 * (unit(ctx.seedNum, pair, SALT.spot, 0) - 0.5)) * 100) / 100;
    const angle = deg(SPOT_ANGLES[desc.spot] + 8 * (unit(ctx.seedNum, pair, SALT.spot, 1) - 0.5));
    const feet = { x: radius * sin(angle), z: -radius * cos(angle) };
    const toward = { x: -feet.x / radius, z: -feet.z / radius };
    const from = { x: feet.x + 0.35 * toward.x, y: RELEASE_Y, z: feet.z + 0.35 * toward.z };
    const wind = ctx.windFor(ctx.seedNum, ctx.i, g.t.wind, growth);

    const p = desc.player;
    const left = (who) => (g.rounds * 5 - (desc.round * 5 + desc.spot)) - (who === p ? 1 : p === 0 ? 0 : 1);
    const margin = Math.abs(g.totals[p] - g.totals[1 - p]);
    const still = left(p) + left(1 - p) + 1;
    const pressure = ctx.pressureOf({
      progress: g.k / (g.rounds * 10),
      close: Math.max(0, 1 - margin / (1.5 * still + 3)),
      decisive: left(p) === 0 && margin <= 3 ? 1 : desc.round === g.rounds - 1 ? 0.3 : 0,
      clock: ctx.settings.clock,
    });
    const base = ctx.base("hoops", wind, pressure);
    const slip = slipOf(base.wet);
    const cond = {
      ...base,
      radius,
      angle,
      feet,
      from,
      toward,
      three: radius >= THREE,
      slip,
      yawAmp: g.t.yaw * base.nerves * slip,
      powerAmp: g.t.power * base.nerves * slip,
      // Rules 3 put the hoop still; older records keep the drift they were
      // played with.
      drift: ctx.settings.rules < 3 ? g.t.drift : 0,
      driftPhase: TAU * unit(ctx.seedNum, ctx.i, SALT.drift, 0),
    };
    // The still air speed that drops it in the middle of a still hoop:
    // what the bot starts from, and the band Easy shows on the meter.
    cond.ideal = idealSpeed(cond);
    return cond;
  },

  inputOf(desc, humans) {
    return humans[desc.player] ? "shot" : null;
  },

  cleanShot(kind, s) {
    if (kind !== "shot" || !Array.isArray(s) || s.length !== 4 || !s.every(int)) return null;
    const [press, release, yaw, power] = s;
    if (release < 0 || release > MAX_AIM_MS || Math.abs(yaw) > 3000 || power < 0 || power > 1000) return null;
    if (press !== -1 && (press < 0 || press > release)) return null;
    return [press, release, yaw, power];
  },

  releaseMs: (kind, s) => s[1],

  timeout(kind, live, clockMs) {
    return live?.pulling ? [live.press, clockMs, live.yaw, live.power] : [-1, clockMs, 0, 0];
  },

  // The aim and power at `ms`, for a pull begun at `press` and held at yaw
  // (centidegrees) and power (permille), with the sway on.
  aimAt(cond, ctx, press, ms, yaw, power) {
    if (press < 0) return { yaw: yaw / 100, power };
    const hold = ms - press;
    const s = ctx.sway(ctx.seedNum, ctx.i, hold, fatigue(hold), cond.bpm);
    return { yaw: yaw / 100 + s.x * cond.yawAmp, power: Math.min(1000, Math.max(0, power + s.y * cond.powerAmp)) };
  },

  botShot(g, turn, ctx) {
    const cond = turn.cond;
    const clock = ctx.settings.clock;
    let press = 250 + Math.floor(400 * unit(ctx.seedNum, ctx.i, SALT.botTime, 0));
    let release = press + 900 + Math.floor(900 * unit(ctx.seedNum, ctx.i, SALT.botTime, 1));
    if (clock) {
      release = Math.min(release, clock * 1000 - 250);
      press = Math.min(press, Math.max(0, release - 500));
    }
    const dist = hypot(cond.from.x, cond.from.z);
    // Read the wind, and lead a drifting hoop: shoot the shot in the real
    // air at the real hoop, see where it comes down against the rim, and
    // correct, twice. Then keep only as much of the correction as the bot
    // is good for.
    let yawFix = 0;
    let speedFix = cond.ideal;
    for (let k = 0; k < 2; k++) {
      const test = shoot(cond, yawFix, speedFix, release, null);
      if (!test.cross) break;
      // Long is along the line to the hoop; right is a quarter turn
      // clockwise from it, seen from above.
      const along = test.cross.x * cond.toward.x + test.cross.z * cond.toward.z;
      const across = test.cross.x * cond.toward.z - test.cross.z * cond.toward.x;
      yawFix -= (atan2(across, dist) * 180) / PI;
      speedFix -= (along / dist) * speedFix * 0.5;
    }
    let yaw = yawFix * g.t.botComp;
    let speed = cond.ideal + (speedFix - cond.ideal) * g.t.botComp;
    // The bot's hands are as wet as anyone's.
    yaw += gauss(ctx.seedNum, ctx.i, SALT.botAim, 0) * g.t.botYaw * cond.nerves * cond.slip;
    speed *= 1 + gauss(ctx.seedNum, ctx.i, SALT.botAim, 1) * g.t.botPower * cond.nerves * cond.slip;
    // It times its release against its own sway, so take that off.
    const s = this.aimAt(cond, ctx, press, release, 0, 500);
    const power = Math.round(powerOf(speed) - (s.power - 500));
    return [press, release, Math.round((yaw - s.yaw) * 100), Math.min(1000, Math.max(0, power))];
  },

  resolve(g, turn, shot, ctx) {
    const [press, release, yaw, power] = shot;
    if (press < 0) {
      return { releaseMs: release, flightMs: 0, settleMs: 900, none: true, made: false, raw: [0, 0], path: [], points: 0, label: "Out of time" };
    }
    const cond = turn.cond;
    const aim = this.aimAt(cond, ctx, press, release, yaw, power);
    const path = newPath();
    const out = shoot(cond, aim.yaw, speedOf(aim.power), release, path);
    const points = out.made ? (cond.three ? 3 : 2) + (out.swish ? 1 : 0) : 0;
    const raw = [0, 0];
    raw[turn.player] = points * 25;
    const total = (path.pts.length / 3 - 1) * SAMPLE_MS;
    const flightMs = Math.round(out.decidedAt * 1000);
    return {
      releaseMs: release,
      flightMs,
      settleMs: Math.max(700, Math.round(total - flightMs) + 300),
      aim,
      made: out.made,
      swish: out.swish,
      bank: out.bank,
      rims: out.rims,
      points,
      raw,
      path: path.pts,
      label: out.made ? (out.swish ? "Swish" : out.bank ? "Off the glass" : "Good") : out.rims ? "Rimmed out" : out.board ? "Off the board" : "Missed",
    };
  },

  apply(g, turn, r) {
    const p = turn.player;
    g.totals[p] += r.points;
    if (r.made) g.makes[p] += 1;
    if (r.swish) g.swishes[p] += 1;
    g.log[p].push(r.points);
    g.k += 1;
  },

  board(g) {
    return { scores: [...g.totals], makes: [...g.makes], log: g.log.map((l) => [...l]) };
  },

  outcome(g) {
    const [a, b] = g.totals;
    if (a !== b) return { winner: a > b ? 0 : 1 };
    if (g.swishes[0] !== g.swishes[1]) return { winner: g.swishes[0] > g.swishes[1] ? 0 : 1, detail: "on swishes" };
    return { winner: null };
  },
};

// The launch velocity for an aim yaw degrees right of straight at the hoop.
function launch(cond, yawDeg, speed) {
  const y = deg(yawDeg);
  const dx = cond.toward.x * cos(y) + cond.toward.z * sin(y);
  const dz = -cond.toward.x * sin(y) + cond.toward.z * cos(y);
  const flat = cos(ELEVATION) * speed;
  return { x: dx * flat, y: sin(ELEVATION) * speed, z: dz * flat };
}

// One shot, ball and hoop and board and floor. `release` is when it leaves,
// from the start of the aim, which is where a drifting hoop is reckoned
// from. With no path, only measured.
function shoot(cond, yawDeg, speed, release, path, still = false) {
  const v = launch(cond, yawDeg, speed);
  const b = body(cond.from.x, cond.from.y, cond.from.z, v.x, v.y, v.z);
  const air = { wx: still ? 0 : cond.wind.x, wz: still ? 0 : cond.wind.z, k: K, spin: 0 };
  const surf = surfaces(cond.wet);
  if (path) record(path, b, true);
  let made = false;
  let madeAt = 0;
  let rims = 0;
  let board = false;
  let cross = null;
  let decidedAt = 0;
  let floor = 0;
  let apex = false;
  const maxSteps = Math.ceil(3.4 / DT);
  for (let n = 1; n <= maxSteps; n++) {
    const t = n * DT;
    const hx = rimX(cond, release + t * 1000);
    const py = b.y;
    step(b, air);

    // The backboard's face.
    if (b.vz > 0 && b.z + BALL > BOARD_Z && b.z < BOARD_Z + 0.05 && Math.abs(b.x - hx) < BOARD.half && b.y > BOARD.bottom - BALL * 0.5 && b.y < BOARD.top) {
      b.z = BOARD_Z - BALL;
      reflect(b, 0, 0, -1, surf.board[0], surf.board[1]);
      board = true;
    }

    // The rim: a ring of tube. The nearest point of the ring to the ball's
    // middle, and push the ball off it if they overlap.
    const dx = b.x - hx;
    const dz = b.z;
    const h = Math.sqrt(dx * dx + dz * dz);
    if (h > 1e-6) {
      const qx = hx + (dx / h) * RIM_R;
      const qz = (dz / h) * RIM_R;
      const ex = b.x - qx;
      const ey = b.y - RIM_Y;
      const ez = b.z - qz;
      const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (d < BALL + TUBE && d > 1e-6) {
        const nx = ex / d;
        const ny = ey / d;
        const nz = ez / d;
        b.x = qx + nx * (BALL + TUBE);
        b.y = RIM_Y + ny * (BALL + TUBE);
        b.z = qz + nz * (BALL + TUBE);
        if (reflect(b, nx, ny, nz, surf.rim[0], surf.rim[1])) rims += 1;
      }
    }

    if (!apex && b.vy < 0) apex = true;
    // Down through the ring.
    if (!made && py >= RIM_Y && b.y < RIM_Y) {
      const r = hypot(b.x - hx, b.z);
      if (!cross) cross = { x: b.x - hx, z: b.z };
      if (r < RIM_R) {
        made = true;
        madeAt = t;
        decidedAt = t;
      }
    }
    // The net, under a make, takes the pace off it.
    if (made && b.y < RIM_Y && b.y > RIM_Y - 0.45 && hypot(b.x - hx, b.z) < RIM_R + 0.02) {
      b.vx *= 0.9;
      b.vz *= 0.9;
      b.vy *= 0.985;
    }

    // The floor.
    if (b.y < BALL) {
      b.y = BALL;
      reflect(b, 0, 1, 0, surf.floor[0], surf.floor[1]);
      floor += 1;
      if (!made && !decidedAt) decidedAt = t;
    }
    // A miss is known when it falls past the rim's height on its way down,
    // well clear of it.
    if (!made && !decidedAt && apex && b.y < RIM_Y - 0.5) decidedAt = t;

    if (path) {
      path.steps += 1;
      record(path, b);
    }
    if (made && t - madeAt > 1.1) break;
    if (!made && floor >= 2) break;
  }
  if (path) record(path, b, true);
  if (!decidedAt) decidedAt = maxSteps * DT;
  return { made, swish: made && rims === 0 && !board, bank: made && board, rims, board, cross, decidedAt };
}

// The still air speed at which a straight shot's middle drops through the
// middle of the rim, by halving the gap between too short and too long.
function idealSpeed(cond) {
  const dist = hypot(cond.from.x, cond.from.z);
  let lo = MIN_SPEED;
  let hi = MAX_SPEED;
  for (let k = 0; k < 22; k++) {
    const mid = (lo + hi) / 2;
    const along = crossingAlong(cond, mid);
    if (along === null || along < dist) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 1000) / 1000;
}

// How far along the line to the hoop a straight shot is when it comes
// down through the rim's height, in still air with nothing in the way;
// null if it never gets that high.
function crossingAlong(cond, speed) {
  const v = launch(cond, 0, speed);
  const b = body(cond.from.x, cond.from.y, cond.from.z, v.x, v.y, v.z);
  const air = { wx: 0, wz: 0, k: K, spin: 0 };
  for (let n = 0; n < 900; n++) {
    const py = b.y;
    step(b, air);
    if (py >= RIM_Y && b.y < RIM_Y && b.vy < 0) {
      return (b.x - cond.from.x) * cond.toward.x + (b.z - cond.from.z) * cond.toward.z;
    }
    if (b.y < 0) return null;
  }
  return null;
}
