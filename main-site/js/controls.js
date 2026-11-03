// How each game is played with the hands, and how a turn's aim looked.
//
// Every game is played on the stage, which takes all touches
// (touch-action: none, pointer capture, and preventDefault on the touch
// and pointer events), so a drag to aim can never scroll the page, pull
// it down to refresh, or swipe back a page.
//
// For each game:
//   begin(turn)            a person's turn starts: clear the hands
//   down/move/up(p, ms)    a pointer, in CSS pixels, at `ms` into the aim;
//                          up and down return the shot when one is made
//   key(e, ms)             the same from the keyboard, where it fits
//   timeout(ms)            the shot when the clock runs out
//   view(turn, ms, ctx)    what the aim looked like at `ms`: from the hands
//                          now for a turn being played, or worked out from
//                          its shot for a bot's turn or a replay
//
// `ctx` is the match's: { seedNum, i, settings, sway }.

import { archery, landing } from "./sim-archery.js";
import { darts } from "./sim-darts.js";
import { hoops, powerOf } from "./sim-hoops.js";
import { kicks, GOAL_Z, HALF_W, BAR, KEEPER_Z } from "./sim-kicks.js";
import { stageSize, unproject, project } from "./scene.js";
import { getSettings } from "./settings.js";
import { creak } from "./audio.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const helps = (state) => state.settings.difficulty === "easy" && getSettings().aim_help;

/* ---- archery: press, drag the reticle, let go ---- */

function archeryControls(world) {
  let live = null;
  return {
    begin() {
      live = { drawing: false, draw: -1, x: 0, y: 0, base: null };
    },
    get live() {
      return live;
    },
    down(p, ms) {
      if (!live || live.drawing) return null;
      live.drawing = true;
      live.draw = ms;
      live.base = { px: p.x, py: p.y, x: live.x, y: live.y };
      creak();
      return null;
    },
    move(p, ms, turn) {
      if (!live?.drawing) return;
      const k = world.aimScale(stageSize().height, turn.cond.distance);
      live.x = clamp(live.base.x + (p.x - live.base.px) * k, -3, 3);
      live.y = clamp(live.base.y - (p.y - live.base.py) * k, -2, 2.5);
    },
    up(p, ms, turn) {
      if (!live?.drawing) return null;
      this.move(p, ms, turn);
      live.drawing = false;
      return [live.draw, ms, Math.round(live.x * 1000), Math.round(live.y * 1000)];
    },
    cancel() {
      if (live) live.drawing = false;
    },
    // Hold Space to draw, the arrow keys to aim, let go to loose.
    key(e, ms, turn) {
      if (!live) return null;
      const step = world.aimScale(stageSize().height, turn.cond.distance) * (e.shiftKey ? 2 : 8);
      if (e.type === "keydown") {
        if (e.key === "ArrowLeft") live.x -= step;
        else if (e.key === "ArrowRight") live.x += step;
        else if (e.key === "ArrowUp") live.y += step;
        else if (e.key === "ArrowDown") live.y -= step;
        else if ((e.key === " " || e.key === "Enter") && !live.drawing && !e.repeat) {
          live.drawing = true;
          live.draw = ms;
          creak();
        } else return null;
        e.preventDefault();
        return null;
      }
      if ((e.key === " " || e.key === "Enter") && live.drawing) {
        live.drawing = false;
        return [live.draw, ms, Math.round(live.x * 1000), Math.round(live.y * 1000)];
      }
      return null;
    },
    // Loosed where it is if drawn, else no shot at all.
    timeout(ms, hands = live) {
      return hands?.drawing ? [hands.draw, ms, Math.round(hands.x * 1000), Math.round(hands.y * 1000)] : [-1, ms, 0, 0];
    },
    view(turn, ms, ctx, state, own, other = null) {
      // The hands to draw: this device's own, or the other player's as sent
      // over the network.
      const hands = other ?? (own ? live : null);
      const cond = turn.cond;
      let draw;
      let fx;
      let fy;
      if (hands) {
        draw = hands.drawing ? hands.draw : -1;
        fx = hands.x;
        fy = hands.y;
      } else {
        const s = turn.shot;
        if (!s) return null;
        if (s[0] < 0) return { none: true };
        draw = ms >= s[0] ? s[0] : -1;
        // Drawn to the aim over most of the hold.
        const u = draw < 0 ? 0 : smooth((ms - s[0]) / Math.max(1, (s[1] - s[0]) * 0.65));
        fx = (s[2] / 1000) * u;
        fy = (s[3] / 1000) * u;
      }
      const r = archery.reticle(cond, ctx, draw, ms, fx, fy);
      const out = { x: r.x, y: r.y, drawn: draw >= 0, hold: draw >= 0 ? ms - draw : 0 };
      if (own && hands && helps(state)) out.guide = landing(cond, r.x, r.y);
      return out;
    },
    hint: "Press and hold to draw, drag to aim, let go to shoot",
  };
}

/* ---- darts: tap, tap ---- */

function dartsControls() {
  let live = null;
  const tap = (ms) => {
    if (!live) return null;
    if (live.stopX === null) {
      live.stopX = ms;
      return null;
    }
    const shot = [live.stopX, Math.max(live.stopX, ms)];
    live = null;
    return shot;
  };
  return {
    begin() {
      live = { stopX: null };
    },
    get live() {
      return live;
    },
    down(p, ms) {
      return tap(ms);
    },
    move() {},
    up() {
      return null;
    },
    cancel() {},
    key(e, ms) {
      if (e.type !== "keydown" || e.repeat || (e.key !== " " && e.key !== "Enter")) return null;
      e.preventDefault();
      return tap(ms);
    },
    timeout(ms, hands = live) {
      return darts.timeout("shot", hands, ms);
    },
    view(turn, ms, ctx, state, own, other = null) {
      // The hands to draw: this device's own, or the other player's as sent
      // over the network.
      const hands = other ?? (own ? live : null);
      const cond = turn.cond;
      if (hands) {
        const m = darts.markers(cond, ctx, ms, hands.stopX ?? null);
        return { x: m.x, y: m.y, stopped: hands.stopX !== null && hands.stopX !== undefined };
      }
      const s = turn.shot;
      if (!s) return null;
      if (s.length === 4) {
        // The bot's: the sweeps run, then settle where it means to throw.
        const m = darts.markers(cond, ctx, Math.min(ms, s[0]), null);
        const x = ms < s[0] ? m.x : s[2] / 10000;
        const y = ms < s[0] ? null : ms < s[1] ? darts.markers(cond, ctx, ms, s[0]).y : s[3] / 10000;
        return { x, y, stopped: ms >= s[0], thrown: ms >= s[1] };
      }
      const m = darts.markers(cond, ctx, Math.min(ms, s[1]), ms >= s[0] ? s[0] : null);
      return { x: m.x, y: m.y, stopped: ms >= s[0], thrown: ms >= s[1] };
    },
    hint: "Tap to stop the side to side sweep, then tap to stop the up and down one",
  };
}

/* ---- hoops: press, pull back, let go ---- */

function hoopsControls() {
  let live = null;
  const read = (p) => {
    const { width, height } = stageSize();
    const dx = p.x - live.sx;
    const dy = p.y - live.sy;
    // Pull down for power; pull to one side to aim the other, as a
    // slingshot does.
    live.power = Math.round(clamp((dy / (0.42 * height)) * 1000, 0, 1000));
    live.yaw = Math.round(clamp((-dx / (0.5 * Math.min(width, 700))) * 2000, -2500, 2500));
  };
  return {
    begin() {
      live = { pulling: false, press: -1, sx: 0, sy: 0, yaw: 0, power: 0 };
    },
    get live() {
      return live;
    },
    down(p, ms) {
      if (!live || live.pulling) return null;
      Object.assign(live, { pulling: true, press: ms, sx: p.x, sy: p.y, yaw: 0, power: 0 });
      return null;
    },
    move(p) {
      if (live?.pulling) read(p);
    },
    up(p, ms) {
      if (!live?.pulling) return null;
      read(p);
      live.pulling = false;
      // Too small a pull to be a shot: let them try again.
      if (live.power < 40) return null;
      return [live.press, ms, live.yaw, live.power];
    },
    cancel() {
      if (live) live.pulling = false;
    },
    key() {
      return null;
    },
    timeout(ms, hands = live) {
      return hoops.timeout("shot", hands, ms);
    },
    view(turn, ms, ctx, state, own, other = null) {
      // The hands to draw: this device's own, or the other player's as sent
      // over the network.
      const hands = other ?? (own ? live : null);
      const cond = turn.cond;
      let press;
      let yaw;
      let power;
      if (hands) {
        press = hands.pulling ? hands.press : -1;
        yaw = hands.yaw;
        power = hands.power;
      } else {
        const s = turn.shot;
        if (!s) return null;
        if (s[0] < 0) return { none: true };
        press = ms >= s[0] ? s[0] : -1;
        const u = press < 0 ? 0 : smooth((ms - s[0]) / Math.max(1, (s[1] - s[0]) * 0.7));
        yaw = s[2] * u;
        power = s[3] * u;
      }
      const a = press < 0 ? { yaw: yaw / 100, power } : hoops.aimAt(cond, ctx, press, ms, yaw, power);
      const out = { yaw: a.yaw, power: a.power, pulling: press >= 0 };
      if (helps(state)) out.ideal = powerOf(cond.ideal);
      return out;
    },
    hint: "Press, pull back and to the side, and let go",
  };
}

/* ---- kicks: drag from the ball and flick, or tap to dive ---- */

function kicksControls() {
  let live = null;
  const target = (p) => {
    const q = unproject(p.x, p.y, GOAL_Z);
    if (!q) return { x: 0, y: 1 };
    return { x: clamp(q.x, -HALF_W - 1.5, HALF_W + 1.5), y: clamp(q.y, 0.1, BAR + 1.2) };
  };
  // How hard: the speed of the last tenth of a second of the drag.
  const flickPower = (path) => {
    const last = path.at(-1);
    let first = last;
    for (let i = path.length - 1; i >= 0 && last.t - path[i].t <= 100; i--) first = path[i];
    const dt = Math.max(16, last.t - first.t);
    const speed = Math.hypot(last.x - first.x, last.y - first.y) / dt;
    return Math.round(clamp(((speed - 0.3) / 2.4) * 1000, 0, 1000));
  };
  // How much the drag bows to one side of the straight line from its
  // start to its end, to the right positive.
  const curlOf = (path) => {
    const a = path[0];
    const b = path.at(-1);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 30) return 0;
    let dev = 0;
    for (const p of path) {
      const d = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len;
      if (Math.abs(d) > Math.abs(dev)) dev = d;
    }
    // Moving up the screen, a point to the right is a negative cross.
    return Math.round(clamp((-dev / len / 0.3) * 1000, -1000, 1000));
  };
  return {
    begin(turn) {
      live = turn.input === "keep" ? { keep: true, tap: -1, x: 0, y: 0 } : { pulling: false, press: -1, path: [], x: 0, y: 1, power: 0, curl: 0 };
    },
    get live() {
      return live;
    },
    down(p, ms) {
      if (!live) return null;
      if (live.keep) {
        if (live.tap >= 0) return null;
        const q = unproject(p.x, p.y, KEEPER_Z);
        live.tap = ms;
        live.x = clamp(q?.x ?? 0, -4, 4);
        live.y = clamp(q?.y ?? 1, 0, 3);
        return [ms, Math.round(live.x * 1000), Math.round(live.y * 1000)];
      }
      if (live.pulling) return null;
      Object.assign(live, { pulling: true, press: ms, path: [{ x: p.x, y: p.y, t: performance.now() }], power: 0, curl: 0 });
      return null;
    },
    move(p) {
      if (!live?.pulling) return;
      live.path.push({ x: p.x, y: p.y, t: performance.now() });
      if (live.path.length > 120) live.path.splice(1, 1);
      const q = target(p);
      live.x = q.x;
      live.y = q.y;
      live.power = flickPower(live.path);
      live.curl = curlOf(live.path);
    },
    up(p, ms) {
      if (!live?.pulling) return null;
      this.move(p);
      live.pulling = false;
      const a = live.path[0];
      if (Math.hypot(p.x - a.x, p.y - a.y) < 40) return null;
      return [live.press, ms, Math.round(live.x * 1000), Math.round(live.y * 1000), live.power, live.curl];
    },
    cancel() {
      if (live) live.pulling = false;
    },
    key() {
      return null;
    },
    timeout(ms, hands = live) {
      if (hands?.keep) return null;
      if (!hands?.pulling) return kicks.timeout("kick", null, ms);
      return [hands.press, ms, Math.round(hands.x * 1000), Math.round(hands.y * 1000), hands.power, hands.curl];
    },
    view(turn, ms, ctx, state, own, other = null) {
      // The hands to draw: this device's own, or the other player's as sent
      // over the network.
      const hands = other ?? (own ? live : null);
      const cond = turn.cond;
      if (turn.input === "keep" || (!own && turn.shot?.length === 3)) {
        const s = hands ? [hands.tap, Math.round(hands.x * 1000), Math.round(hands.y * 1000)] : turn.shot;
        return { keep: true, tap: s ? s[0] : -1, x: s ? s[1] / 1000 : 0, y: s ? s[2] / 1000 : 0 };
      }
      if (hands && !hands.keep) {
        const a = hands.pulling ? kicks.aimAt(cond, ctx, hands.press, ms, hands.x, hands.y) : { x: hands.x, y: hands.y };
        return { pulling: hands.pulling, x: a.x, y: a.y, power: hands.power, curl: hands.curl, path: hands.path ?? null, shown: hands.pulling };
      }
      const s = turn.shot;
      if (!s || s.length !== 6) return null;
      if (s[0] < 0) return { none: true };
      const pulling = ms >= s[0] && ms < s[1];
      const u = ms < s[0] ? 0 : smooth((ms - s[0]) / Math.max(1, s[1] - s[0]));
      const a = ms >= s[0] ? kicks.aimAt(cond, ctx, s[0], Math.min(ms, s[1]), s[2] / 1000, s[3] / 1000) : { x: s[2] / 1000, y: s[3] / 1000 };
      // The drag, as it would have looked: from the ball towards the aim,
      // bowed by its curl.
      const from = project(0, 0.11, 0);
      const to = project(a.x, a.y, GOAL_Z);
      let path = null;
      if (from && to && ms >= s[0]) {
        path = [];
        const n = Math.max(2, Math.round(12 * u));
        for (let k = 0; k <= n; k++) {
          const f = (k / 12) * 0.55;
          const bow = Math.sin(Math.PI * (k / Math.max(1, n))) * (s[5] / 1000) * 40 * u;
          path.push({ x: from.x + (to.x - from.x) * f + bow, y: from.y + (to.y - from.y) * f });
        }
      }
      return { pulling, x: a.x, y: a.y, power: s[4], curl: s[5], path, shown: ms >= s[0] };
    },
    hint: "Drag from the ball to where you want it and flick; bow the drag to curl it",
    keepHint: "Tap the goal where you want to dive",
  };
}

// The hands as sent to the other device: only what drawing them needs.
export function shareable(game, live) {
  if (!live) return null;
  switch (game) {
    case "archery":
      return { drawing: live.drawing, draw: live.draw, x: live.x, y: live.y };
    case "darts":
      return { stopX: live.stopX };
    case "hoops":
      return { pulling: live.pulling, press: live.press, yaw: live.yaw, power: live.power };
    case "kicks":
      return live.keep ? null : { pulling: live.pulling, press: live.press, x: live.x, y: live.y, power: live.power, curl: live.curl };
  }
  return null;
}

// The same, checked on arrival: numbers in range or nothing.
export function cleanShared(game, v) {
  if (!v || typeof v !== "object") return null;
  const num = (x, lo, hi) => (typeof x === "number" && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : 0);
  switch (game) {
    case "archery":
      return { drawing: v.drawing === true, draw: num(v.draw, -1, 120000), x: num(v.x, -3, 3), y: num(v.y, -2, 2.5) };
    case "darts":
      return { stopX: v.stopX === null ? null : num(v.stopX, 0, 120000) };
    case "hoops":
      return { pulling: v.pulling === true, press: num(v.press, -1, 120000), yaw: num(v.yaw, -2500, 2500), power: num(v.power, 0, 1000) };
    case "kicks":
      return { pulling: v.pulling === true, press: num(v.press, -1, 120000), x: num(v.x, -6, 6), y: num(v.y, 0, 4), power: num(v.power, 0, 1000), curl: num(v.curl, -1000, 1000) };
  }
  return null;
}

export function createControls(game, world) {
  switch (game) {
    case "archery":
      return archeryControls(world);
    case "darts":
      return dartsControls(world);
    case "hoops":
      return hoopsControls(world);
    case "kicks":
      return kicksControls(world);
  }
  throw new Error(game);
}
