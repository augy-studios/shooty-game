// Kicks: a penalty shootout. Three, five or seven kicks each, turn about,
// then sudden death; it stops early once one side cannot be caught, as a
// real shootout does. Against the bot you take your kicks and keep goal
// for its; between two people, both kick and the computer keeps goal.
//
// The goal is a regulation one, 7.32 by 2.44 m, 11 m from the spot, with
// posts and a bar the ball comes off. The keeper is a body that dives:
// it starts on the line, reacts, and stretches towards a point, faster to
// a near one than a far one. The ball is a size 5, 22 cm and 0.43 kg.
//
// A kick is aimed by dragging from the ball to a point on the goal. A
// faster flick hits it harder, which gives the keeper less time but
// spreads it more; a drag that bows to one side spins the ball, which
// bends it that way (the Magnus effect) on its way in. The wind moves it
// too, and nerves shake the aim more on the kicks that decide it.
//
// In the rain (cond.wet, js/sim-shared.js weatherFor) the standing foot
// slides as it plants, so a kick spreads more; a wet ball skids on off
// the grass instead of checking; it squirts off a keeper's wet gloves
// rather than sticking; and the keeper, pushing off wet turf, gets across
// a little slower.
//
// Shots, as recorded:
//   a kick  [press ms, release ms, aim x mm, aim y mm, power permille,
//           curl permille], the aim on the goal line before the sway
//   a dive  [tap ms, x mm, y mm], where the keeper was sent and when, from
//           the start of the turn's aim; a tap of -1 never dived

import { body, newPath, record, step, reflect, solveLaunch, segmentPoint, DT, SAMPLE_MS } from "./physics.js";
import { gauss, unit, SALT } from "./seed.js";
import { hypot } from "./fmath.js";
import { MAX_AIM_MS } from "./rules.js";
import { fatigue } from "./sim-shared.js";

export const GOAL_Z = 11;
export const HALF_W = 3.66;
export const BAR = 2.44;
const POST_R = 0.06;
export const BALL = 0.11;
export const NET_DEPTH = 1.8;
export const KEEPER_Z = 10.7;
const KEEPER_R = 0.22;
const K = 0.0133;
export const SPOT = { x: 0, y: BALL, z: 0 };
export const MIN_SPEED = 17;
export const MAX_SPEED = 31;
const EXTRA = 5;
// A person sent diving moves this fast towards the spot they picked.
const HUMAN_DIVE = 4.2;

// The wet versions of everything rain changes; dry, exactly the old ones.
const wetMul = (wet, k) => (wet ? 1 + k * wet : 1);
const DRY_GROUND = [0.55, 0.88];
const DRY_GLOVES = [0.35, 0.55];
const groundOf = (wet) => (wet ? [0.55 - 0.1 * wet, 0.88 + 0.1 * wet] : DRY_GROUND);
const glovesOf = (wet) => (wet ? [0.35 + 0.2 * wet, 0.55 + 0.2 * wet] : DRY_GLOVES);
// A keeper's dive speed and reaction off wet turf.
const diveOf = (wet, speed) => (wet ? speed * (1 - 0.06 * wet) : speed);
const reactOf = (wet, ms) => (wet ? ms + 30 * wet : ms);

const TUNING = {
  easy: { wind: 3, sway: 0.1, err: 0.1, read: 0.3, react: 320, dive: 3.3, botSd: 0.6, adapt: 0.15, botPower: 0.45 },
  medium: { wind: 5, sway: 0.15, err: 0.13, read: 0.45, react: 250, dive: 3.9, botSd: 0.42, adapt: 0.35, botPower: 0.6 },
  hard: { wind: 7, sway: 0.2, err: 0.16, read: 0.6, react: 190, dive: 4.5, botSd: 0.3, adapt: 0.55, botPower: 0.72 },
};

const int = (v) => Number.isInteger(v);
export const speedOf = (power) => MIN_SPEED + ((MAX_SPEED - MIN_SPEED) * power) / 1000;

// The keeper's body `tau` ms after the kick: a capsule from its feet to its
// outstretched hands, upright on the line until it dives.
export function keeperAt(plan, tau) {
  let fx = 0;
  let fy = 0.1;
  let hx = 0;
  let hy = 2.05;
  if (plan && tau >= plan.t0) {
    const p = Math.min(1, (tau - plan.t0) / plan.dur);
    const e = 1 - (1 - p) * (1 - p);
    hx = plan.x * e;
    hy = 2.05 + (plan.y - 2.05) * e;
    fx = plan.x * 0.45 * e;
    fy = 0.1 + Math.max(0, plan.y - 1.2) * 0.5 * e;
  }
  return { fx, fy, hx, hy };
}

function divePlan(t0, x, y, speed) {
  const cx = Math.max(-3.4, Math.min(3.4, x));
  const cy = Math.max(0.15, Math.min(2.45, y));
  return { t0, x: cx, y: cy, dur: 150 + (1000 * hypot(cx, cy - 1.1)) / speed };
}

export const kicks = {
  id: "kicks",

  setup(settings) {
    return {
      n: { short: 3, standard: 5, long: 7 }[settings.length],
      k: 0,
      kicks: [0, 0],
      goals: [0, 0],
      saves: [0, 0],
      // Per kicker: "g" a goal, "s" saved, "m" missed.
      log: [[], []],
      done: false,
      t: TUNING[settings.difficulty],
    };
  },

  nextTurn(g) {
    if (g.done) return null;
    const player = g.k % 2;
    const pair = Math.floor(g.k / 2);
    const sudden = pair >= g.n;
    return { player, keeper: 1 - player, round: pair, sudden, label: sudden ? `Sudden death, kick ${pair + 1}` : `Kick ${pair + 1} of ${g.n}` };
  },

  conditions(g, desc, ctx) {
    const wind = ctx.windFor(ctx.seedNum, ctx.i, g.t.wind, Math.min(1, desc.round / Math.max(1, g.n - 1)));
    const p = desc.player;
    const o = 1 - p;
    // Kicks still to come in normal time, after this one.
    const leftP = Math.max(0, g.n - g.kicks[p] - 1);
    const leftO = Math.max(0, g.n - g.kicks[o]);
    // Would scoring, or missing, settle it?
    const winsIfScored = g.goals[p] + 1 > g.goals[o] + leftO;
    const losesIfMissed = g.goals[p] + leftP < g.goals[o];
    const pressure = ctx.pressureOf({
      progress: Math.min(1, desc.round / g.n),
      close: Math.max(0, 1 - Math.abs(g.goals[p] - g.goals[o]) / Math.max(1, g.n - desc.round)),
      decisive: desc.sudden || winsIfScored || losesIfMissed ? 1 : 0,
      clock: ctx.settings.clock,
    });
    const base = ctx.base("kicks", wind, pressure);
    return {
      ...base,
      swayAmp: g.t.sway * base.nerves * wetMul(base.wet, 0.15),
      errSd: g.t.err * base.nerves * wetMul(base.wet, 0.35),
      // The bot's run up, when it is the one kicking: when its foot meets
      // the ball, from the start of the aim.
      kickMs: 1500 + Math.floor(800 * unit(ctx.seedNum, ctx.i, SALT.botTime, 0)),
    };
  },

  inputOf(desc, humans) {
    if (humans[desc.player]) return "kick";
    if (humans[desc.keeper]) return "keep";
    return null;
  },

  cleanShot(kind, s) {
    if (!Array.isArray(s) || !s.every(int)) return null;
    if (kind === "kick") {
      if (s.length !== 6) return null;
      const [press, release, x, y, power, curl] = s;
      if (release < 0 || release > MAX_AIM_MS || Math.abs(x) > 9000 || y < -1000 || y > 6000) return null;
      if (power < 0 || power > 1000 || Math.abs(curl) > 1000) return null;
      if (press !== -1 && (press < 0 || press > release)) return null;
      return [press, release, x, y, power, curl];
    }
    if (kind === "keep") {
      if (s.length !== 3) return null;
      const [tap, x, y] = s;
      if (tap !== -1 && (tap < 0 || tap > MAX_AIM_MS)) return null;
      if (Math.abs(x) > 6000 || y < -500 || y > 4000) return null;
      return [tap, x, y];
    }
    return null;
  },

  releaseMs: (kind, s, cond) => (kind === "keep" ? cond.kickMs : s[1]),

  // Out of time with the ball not struck: a soft one straight at the
  // keeper, which is what a rushed kick is.
  timeout(kind, live, clockMs) {
    if (kind !== "kick") return null;
    return live?.pulling ? [live.press, clockMs, live.x, live.y, live.power, live.curl] : [-1, clockMs, 0, 900, 150, 0];
  },

  // The aim marker on the goal at `ms`, for a drag begun at `press` and
  // pointed at x, y (m).
  aimAt(cond, ctx, press, ms, x, y) {
    if (press < 0) return { x, y };
    const hold = ms - press;
    const s = ctx.sway(ctx.seedNum, ctx.i, hold, cond.swayAmp * fatigue(hold), cond.bpm);
    return { x: x + s.x, y: y + s.y };
  },

  // Only ever asked for when nobody is in goal or on the ball, which no
  // mode has; an untouched keeper, to be safe.
  botShot() {
    return [-1, 0, 0];
  },

  resolve(g, turn, shot, ctx) {
    const cond = turn.cond;
    let kick;
    let plan;
    let release;
    if (turn.input === "keep") {
      // The bot kicks; the person dives.
      const [tap, dx, dy] = shot;
      release = cond.kickMs;
      kick = botKick(g, cond, ctx, tap, dx / 1000);
      plan = tap < 0 ? null : divePlan(tap - release, dx / 1000, dy / 1000, diveOf(cond.wet, HUMAN_DIVE));
    } else {
      release = shot[1];
      kick = shot;
      plan = null;
    }
    if (kick[0] < 0 && turn.input !== "keep") {
      kick = [kick[1], kick[1], kick[2], kick[3], kick[4], kick[5]];
    }
    const flight = kickFlight(cond, ctx, kick, (aim) => {
      // A person in goal goes where they were sent, or stays put.
      if (turn.input === "keep") return plan;
      // The computer in goal: it reacts, and either reads the kick or
      // guesses a side.
      const u = unit(ctx.seedNum, ctx.i, SALT.keeper, 0);
      const t = g.t;
      const react = reactOf(cond.wet, t.react);
      const dive = diveOf(cond.wet, t.dive);
      if (u < t.read) {
        return divePlan(react, aim.x + gauss(ctx.seedNum, ctx.i, SALT.keeper, 1) * 0.35, aim.y + gauss(ctx.seedNum, ctx.i, SALT.keeper, 2) * 0.25, dive);
      }
      const side = unit(ctx.seedNum, ctx.i, SALT.keeper, 3) < 0.5 ? -1 : 1;
      return divePlan(react, side * (1.2 + 1.8 * unit(ctx.seedNum, ctx.i, SALT.keeper, 4)), 0.3 + 1.5 * unit(ctx.seedNum, ctx.i, SALT.keeper, 5), dive);
    });
    const raw = [0, 0];
    const top = flight.goal && Math.abs(flight.cross.x) > 2.6 && flight.cross.y > 1.55;
    if (flight.goal) raw[turn.player] = 60 + (top ? 30 : 0);
    if (flight.saved && !flight.goal) raw[turn.keeper] = 60;
    const total = (flight.path.length / 3 - 1) * SAMPLE_MS;
    const flightMs = Math.round(flight.decidedAt * 1000);
    return {
      releaseMs: release,
      flightMs,
      settleMs: Math.max(900, Math.round(total - flightMs) + 500),
      kick,
      plan: flight.plan,
      aim: flight.aim,
      goal: flight.goal,
      saved: flight.saved && !flight.goal,
      post: flight.post,
      top,
      cross: flight.cross,
      raw,
      path: flight.path,
      spin: flight.spin,
      label: flight.goal
        ? flight.post
          ? "In off the post"
          : top
            ? "Top corner"
            : "Goal"
        : flight.saved
          ? "Saved"
          : flight.post
            ? "Off the woodwork"
            : flight.cross && flight.cross.y >= BAR
              ? "Over the bar"
              : "Wide",
    };
  },

  apply(g, turn, r) {
    const p = turn.player;
    g.kicks[p] += 1;
    if (r.goal) g.goals[p] += 1;
    if (r.saved) g.saves[turn.keeper] += 1;
    g.log[p].push(r.goal ? "g" : r.saved ? "s" : "m");
    g.k += 1;
    const [a, b] = g.goals;
    if (g.kicks[0] <= g.n || g.kicks[1] < g.n) {
      // Normal time: over once one side cannot catch the other.
      const leftA = Math.max(0, g.n - g.kicks[0]);
      const leftB = Math.max(0, g.n - g.kicks[1]);
      if (a + leftA < b || b + leftB < a) g.done = true;
      else if (g.kicks[0] === g.n && g.kicks[1] === g.n && a !== b) g.done = true;
    } else if (g.kicks[0] === g.kicks[1]) {
      // Sudden death, after both have kicked.
      if (a !== b || g.kicks[0] >= g.n + EXTRA) g.done = true;
    }
  },

  board(g) {
    return { scores: [...g.goals], kicks: [...g.kicks], log: g.log.map((l) => [...l]), n: g.n };
  },

  outcome(g) {
    const [a, b] = g.goals;
    if (a !== b) return { winner: a > b ? 0 : 1 };
    return { winner: null, detail: "still level after sudden death" };
  },
};

// The bot's kick, given what the person in goal did before it: a dive made
// well before the kick may be read, and the bot goes the other way.
function botKick(g, cond, ctx, tap, diveX) {
  const t = g.t;
  const sd = t.botSd * wetMul(cond.wet, 0.35);
  const u = (k) => unit(ctx.seedNum, ctx.i, SALT.botAim, k);
  let side = u(0) < 0.5 ? -1 : 1;
  if (tap >= 0 && tap < cond.kickMs - 120 && u(1) < t.adapt && Math.sign(diveX) === side) side = -side;
  const x = side * (1.6 + 1.6 * u(2)) + gauss(ctx.seedNum, ctx.i, SALT.botAim, 3) * sd * cond.nerves;
  const y = 0.3 + 1.7 * u(4) + gauss(ctx.seedNum, ctx.i, SALT.botAim, 4) * sd * 0.6 * cond.nerves;
  const power = Math.round(Math.min(1, Math.max(0, t.botPower + 0.2 * (u(5) - 0.5))) * 1000);
  const curl = Math.round((u(6) - 0.5) * 500);
  return [cond.kickMs - 450, cond.kickMs, Math.round(x * 1000), Math.round(y * 1000), power, curl];
}

// One kick, from the strike until it settles: through the air with its
// spin and the wind, off the posts and bar, into the keeper or past them,
// and into the net. `keeper(aim)` gives the dive, once the aim is known.
function kickFlight(cond, ctx, kick, keeper) {
  const [press, release, mx, my, power, curl] = kick;
  const hold = release - press;
  const p = power / 1000;
  const s = ctx.sway(ctx.seedNum, ctx.i, hold, cond.swayAmp * fatigue(hold), cond.bpm);
  // A harder strike spreads more.
  const spread = cond.errSd * (0.5 + p);
  const aim = {
    x: mx / 1000 + s.x + gauss(ctx.seedNum, ctx.i, SALT.release, 0) * spread,
    y: my / 1000 + s.y + gauss(ctx.seedNum, ctx.i, SALT.release, 1) * spread * 0.7,
  };
  const speed = speedOf(power);
  const steps = Math.ceil(3 / DT);
  const v = solveLaunch(SPOT, { x: aim.x, y: aim.y, z: GOAL_Z }, speed, { k: K }, steps);
  const b = body(SPOT.x, SPOT.y, SPOT.z, v.x, v.y, v.z);
  const spin = 0.24 * (curl / 1000) * (speed / 25);
  const air = { wx: cond.wind.x, wz: cond.wind.z, k: K, spin };
  const plan = keeper(aim);
  const ground = groundOf(cond.wet);
  const gloves = glovesOf(cond.wet);
  const path = newPath();
  record(path, b, true);

  let goal = false;
  let saved = false;
  let post = false;
  let cross = null;
  let decidedAt = 0;
  let stopAt = Infinity;
  let inNet = false;
  for (let n = 1; n <= steps; n++) {
    const t = n * DT;
    const pz = b.z;
    step(b, air);
    // Spin dies away as the ball slows and skids.
    if (air.spin) air.spin *= 0.999;

    // The woodwork.
    for (const [ax, ay, bx, by] of [[-HALF_W, 0, -HALF_W, BAR], [HALF_W, 0, HALF_W, BAR], [-HALF_W, BAR, HALF_W, BAR]]) {
      const c = segmentPoint(b.x, b.y, b.z, ax, ay, GOAL_Z, bx, by, GOAL_Z);
      if (c.d < BALL + POST_R && c.d > 1e-6) {
        const nx = (b.x - c.cx) / c.d;
        const ny = (b.y - c.cy) / c.d;
        const nz = (b.z - c.cz) / c.d;
        b.x = c.cx + nx * (BALL + POST_R);
        b.y = c.cy + ny * (BALL + POST_R);
        b.z = c.cz + nz * (BALL + POST_R);
        if (reflect(b, nx, ny, nz, 0.6, 0.9)) post = true;
      }
    }

    // The keeper.
    if (!goal && b.z > KEEPER_Z - 1.2 && b.z < KEEPER_Z + 0.6) {
      const k = keeperAt(plan, t * 1000);
      const c = segmentPoint(b.x, b.y, b.z, k.fx, k.fy, KEEPER_Z, k.hx, k.hy, KEEPER_Z);
      const reach = c.t > 0.85 ? KEEPER_R + 0.05 : KEEPER_R;
      if (c.d < BALL + reach && c.d > 1e-6) {
        const nx = (b.x - c.cx) / c.d;
        const ny = (b.y - c.cy) / c.d;
        const nz = (b.z - c.cz) / c.d;
        b.x = c.cx + nx * (BALL + reach);
        b.y = c.cy + ny * (BALL + reach);
        b.z = c.cz + nz * (BALL + reach);
        if (reflect(b, nx, ny, nz, gloves[0], gloves[1])) {
          if (!saved) {
            saved = true;
            decidedAt = t;
            stopAt = t + 1.1;
          }
          air.spin = 0;
        }
      }
    }

    // Over the line, all of it, between the posts and under the bar.
    if (!cross && pz < GOAL_Z && b.z >= GOAL_Z) cross = { x: b.x, y: b.y };
    if (!goal && pz < GOAL_Z + BALL && b.z >= GOAL_Z + BALL && Math.abs(b.x) < HALF_W && b.y < BAR) {
      goal = true;
      decidedAt = t;
      stopAt = t + 1.0;
      if (!cross) cross = { x: b.x, y: b.y };
    }
    // Past the line outside the goal: that is a miss, once it is clear.
    if (!goal && !saved && !decidedAt && b.z > GOAL_Z + 0.5) {
      decidedAt = t;
      stopAt = t + 0.6;
    }

    // The net: the back, the sides and the roof hold it.
    if (goal || (b.z > GOAL_Z && Math.abs(b.x) < HALF_W && b.y < BAR)) {
      if (b.z > GOAL_Z + NET_DEPTH - BALL) {
        b.z = GOAL_Z + NET_DEPTH - BALL;
        b.vz = -b.vz * 0.12;
        b.vx *= 0.4;
        b.vy *= 0.6;
        inNet = true;
      }
      if (goal && Math.abs(b.x) > HALF_W - BALL) {
        b.x = Math.sign(b.x) * (HALF_W - BALL);
        b.vx = -b.vx * 0.2;
      }
      if (goal && b.y > BAR - BALL) {
        b.y = BAR - BALL;
        b.vy = -Math.abs(b.vy) * 0.2;
      }
    }
    if (inNet) {
      b.vx *= 0.97;
      b.vz *= 0.97;
    }

    // The ground.
    if (b.y < BALL) {
      b.y = BALL;
      reflect(b, 0, 1, 0, ground[0], ground[1]);
    }

    path.steps += 1;
    record(path, b);
    if (t >= stopAt) break;
    if (b.z > GOAL_Z + 6 || b.z < -3) break;
  }
  record(path, b, true);
  if (!decidedAt) decidedAt = path.steps * DT;
  return { goal, saved, post, cross, decidedAt, path: path.pts, aim, plan, spin };
}
