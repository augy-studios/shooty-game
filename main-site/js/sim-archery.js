// Archery: three arrows each a round, the target further away every round.
//
// The face is a World Archery 122 cm face: ten scoring rings 6.1 cm wide,
// gold, red, blue, black and white from the middle out, and an inner ten,
// the X, that breaks ties. An arrow touching a line takes the higher ring,
// as in the real rules. Miss the face and hit the boss behind it, and it
// scores nothing.
//
// The bow is sighted for the distance, so in still air an arrow lands
// where the reticle is. The wind is what it is not sighted for: an arrow
// at 58 m/s slows a few per cent on its way down the range, and the air it
// slows against is moving, so a crosswind drifts it sideways by roughly
// the wind speed times how much later it arrives than it would in a
// vacuum. At 70 m in a 9 m/s wind that is most of the face.
//
// Shot, as recorded: [draw ms, release ms, aim x mm, aim y mm], the times
// from the start of the aim and the aim where the player's finger held the
// reticle, before the sway. A draw of -1 is a shot clock that ran out with
// the bow never drawn.

import { body, newPath, record, toPlane, solveLaunch, step, DT } from "./physics.js";
import { gauss, unit, SALT } from "./seed.js";
import { hypot } from "./fmath.js";
import { MAX_AIM_MS } from "./rules.js";
import { fatigue } from "./sim-shared.js";

export const ARROWS = 3;
export const FACE_R = 0.61;
export const RING = 0.061;
export const FACE_Y = 1.3;
// The boss the face is pinned to, a square either side of the middle.
export const BOSS = 0.68;
const SHAFT_R = 0.0028;
export const SPEED = 58;
// Drag per metre. A target arrow loses about 5% of its speed over 50 m.
const K = 0.003;
export const BOW = { x: 0, y: 1.45, z: 0.6 };

// sway and bot spread are angles, radians, so they grow with the distance.
const TUNING = {
  easy: { wind: 3.5, near: 15, far: 30, sway: 0.0011, botSd: 0.0055, botComp: 0.45 },
  medium: { wind: 6, near: 25, far: 50, sway: 0.0014, botSd: 0.003, botComp: 0.75 },
  hard: { wind: 9, near: 40, far: 70, sway: 0.0017, botSd: 0.0014, botComp: 0.92 },
};

const int = (v) => Number.isInteger(v);

// Ring for a distance from the centre, 0 off the face.
export function ringOf(r) {
  const edge = Math.max(0, r - SHAFT_R);
  if (edge >= FACE_R) return 0;
  return 10 - Math.floor(edge / RING);
}

export const archery = {
  id: "archery",

  setup(settings) {
    const rounds = { short: 3, standard: 5, long: 7 }[settings.length];
    return {
      rounds,
      k: 0,
      totals: [0, 0],
      xs: [0, 0],
      tens: [0, 0],
      // Rings per round, per player.
      ends: [Array.from({ length: rounds }, () => []), Array.from({ length: rounds }, () => [])],
      t: TUNING[settings.difficulty],
    };
  },

  nextTurn(g) {
    if (g.k >= g.rounds * ARROWS * 2) return null;
    const round = Math.floor(g.k / (ARROWS * 2));
    const player = Math.floor((g.k % (ARROWS * 2)) / ARROWS);
    const arrow = g.k % ARROWS;
    return { player, round, arrow, sameGo: arrow > 0, label: `Round ${round + 1} of ${g.rounds}, arrow ${arrow + 1}` };
  },

  conditions(g, desc, ctx) {
    const growth = g.rounds > 1 ? desc.round / (g.rounds - 1) : 1;
    const distance = Math.round(g.t.near + (g.t.far - g.t.near) * growth);
    const wind = ctx.windFor(ctx.seedNum, ctx.i, g.t.wind, growth);

    const p = desc.player;
    const left = (who) => {
      // Arrows still to shoot after this one, this player's and the other's.
      const roundsAfter = g.rounds - desc.round - 1;
      if (who === p) return roundsAfter * ARROWS + (ARROWS - desc.arrow - 1);
      return roundsAfter * ARROWS + (p === 0 ? ARROWS : 0);
    };
    const margin = Math.abs(g.totals[p] - g.totals[1 - p]);
    const still = left(p) + left(1 - p) + 1;
    const close = Math.max(0, 1 - margin / (4 * still + 6));
    const last = left(p) === 0;
    const pressure = ctx.pressureOf({
      progress: g.k / (g.rounds * ARROWS * 2),
      close,
      decisive: last && margin <= 10 ? 1 : desc.round === g.rounds - 1 ? 0.35 : 0,
      clock: ctx.settings.clock,
    });
    const base = ctx.base("archery", wind, pressure);
    return { ...base, distance, swayAmp: g.t.sway * distance * base.nerves };
  },

  inputOf(desc, humans) {
    return humans[desc.player] ? "shot" : null;
  },

  cleanShot(kind, s) {
    if (kind !== "shot" || !Array.isArray(s) || s.length !== 4 || !s.every(int)) return null;
    const [draw, release, x, y] = s;
    if (release < 0 || release > MAX_AIM_MS || Math.abs(x) > 4000 || Math.abs(y) > 4000) return null;
    if (draw !== -1 && (draw < 0 || draw > release)) return null;
    return [draw, release, x, y];
  },

  releaseMs: (kind, s) => s[1],

  // The shot when the clock runs out: loosed where it is if drawn, else none.
  timeout(kind, live, clockMs) {
    return live?.drawing ? [live.draw, clockMs, live.x, live.y] : [-1, clockMs, 0, 0];
  },

  // Where the reticle is at `ms` into the aim, for an aim held at x, y (m),
  // drawn at `draw` ms.
  reticle(cond, ctx, draw, ms, x, y) {
    if (draw < 0) return { x, y };
    const hold = ms - draw;
    const s = ctx.sway(ctx.seedNum, ctx.i, hold, cond.swayAmp * fatigue(hold), cond.bpm);
    return { x: x + s.x, y: y + s.y };
  },

  botShot(g, turn, ctx) {
    const cond = turn.cond;
    const d = cond.distance;
    const clock = ctx.settings.clock;
    let draw = 300 + Math.floor(500 * unit(ctx.seedNum, ctx.i, SALT.botTime, 0));
    let release = draw + 1300 + Math.floor(1100 * unit(ctx.seedNum, ctx.i, SALT.botTime, 1));
    if (clock) {
      release = Math.min(release, clock * 1000 - 250);
      draw = Math.min(draw, Math.max(0, release - 700));
    }
    // What the wind does to an arrow loosed at the middle, which the bot
    // reads and allows for, some of it.
    const drift = fly(cond, 0, 0, d, null);
    const ax = -drift.x * g.t.botComp + gauss(ctx.seedNum, ctx.i, SALT.botAim, 0) * g.t.botSd * d * cond.nerves;
    const ay = -(drift.y - FACE_Y) * g.t.botComp + gauss(ctx.seedNum, ctx.i, SALT.botAim, 1) * g.t.botSd * d * cond.nerves;
    // It holds steady by timing its release, so take off the sway it will
    // have then.
    const s = this.reticle(cond, ctx, draw, release, 0, 0);
    return [draw, release, Math.round((ax - s.x) * 1000), Math.round((ay - s.y) * 1000)];
  },

  resolve(g, turn, shot, ctx) {
    const [draw, release, mx, my] = shot;
    if (draw < 0) {
      return { releaseMs: release, flightMs: 0, settleMs: 900, none: true, ring: 0, x: false, raw: [0, 0], path: [], label: "Out of time" };
    }
    const cond = turn.cond;
    const aim = this.reticle(cond, ctx, draw, release, mx / 1000, my / 1000);
    const path = newPath();
    const hit = fly(cond, aim.x, aim.y, cond.distance, path);
    const onBoss = hit.ok && Math.abs(hit.x) <= BOSS && Math.abs(hit.y - FACE_Y) <= BOSS;
    let ring = 0;
    let x = false;
    let stuck = "boss";
    if (onBoss) {
      const r = hypot(hit.x, hit.y - FACE_Y);
      ring = ringOf(r);
      x = r - SHAFT_R < RING / 2;
      stuck = ring > 0 ? "face" : "boss";
    } else if (!hit.ok) {
      // Short: into the grass in front of the target.
      stuck = "ground";
      hit.body.y = Math.max(hit.body.y, 0.01);
    } else {
      // Past the boss: on until it buries itself in the grass.
      stuck = "ground";
      const b = hit.body;
      for (let n = 0; n < 900 && b.y > 0.02 && b.z < cond.distance + 30; n++) {
        step(b, hit.air);
        path.steps += 1;
        record(path, b);
      }
      hit.t += path.steps * DT - hit.steps * DT;
    }
    record(path, hit.body, true);
    const raw = [0, 0];
    raw[turn.player] = ring * 10 + (x ? 5 : 0);
    return {
      releaseMs: release,
      flightMs: Math.round(hit.t * 1000),
      ring,
      x,
      stuck,
      hit: { x: hit.body.x, y: hit.body.y, z: hit.body.z },
      dir: { x: hit.body.vx, y: hit.body.vy, z: hit.body.vz },
      aim,
      raw,
      path: path.pts,
      label: ring === 0 ? (stuck === "boss" ? "Off the face" : "Missed the target") : x ? "X, inner ten" : `${ring}`,
    };
  },

  apply(g, turn, r) {
    const p = turn.player;
    g.totals[p] += r.ring;
    if (r.x) g.xs[p] += 1;
    if (r.ring === 10) g.tens[p] += 1;
    g.ends[p][turn.round].push(r.ring);
    g.k += 1;
  },

  board(g) {
    return { scores: [...g.totals], ends: g.ends.map((e) => e.map((r) => [...r])), xs: [...g.xs] };
  },

  // Most points; level, most Xs; then most tens.
  outcome(g) {
    const [a, b] = g.totals;
    if (a !== b) return { winner: a > b ? 0 : 1 };
    if (g.xs[0] !== g.xs[1]) return { winner: g.xs[0] > g.xs[1] ? 0 : 1, detail: "on Xs" };
    if (g.tens[0] !== g.tens[1]) return { winner: g.tens[0] > g.tens[1] ? 0 : 1, detail: "on tens" };
    return { winner: null };
  },
};

// Where an arrow loosed at (x, y) on the face would strike it in this
// turn's wind: Easy's aim guide.
export function landing(cond, x, y) {
  const hit = fly(cond, x, y, cond.distance, null);
  return { x: hit.x, y: hit.y };
}

// Looses an arrow at the aim point (x, y) on the face d metres away and
// flies it with the wind to the face's plane. With a path, the flight is
// drawn; without, it is only measured (the bot reading the wind).
function fly(cond, x, y, d, path) {
  const steps = Math.ceil(4 / DT);
  const target = { x, y: FACE_Y + y, z: d };
  const v = solveLaunch(BOW, target, SPEED, { k: K }, steps);
  const b = body(BOW.x, BOW.y, BOW.z, v.x, v.y, v.z);
  if (path) record(path, b, true);
  const air = { wx: cond.wind.x, wz: cond.wind.z, k: K, spin: 0 };
  const hit = toPlane(b, air, d, steps, path, 0);
  return { ...hit, body: b, air, steps: path ? path.steps : 0 };
}
