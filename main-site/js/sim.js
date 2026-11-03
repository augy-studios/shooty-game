// A match as data: a seed, the settings, and what the people playing it did
// with their hands. Everything else (the wind on every shot, the bot's
// shots, every flight, every score) is worked out from those by this file
// and the game it is running (js/sim-<game>.js).
//
// Pure, no DOM, no clock and no randomness of its own: the page, the replay
// and the API all run matches through it, and the same inputs always make
// the same match. That is what lets the API check a score without trusting
// the browser, and lets a replay link be a few hundred bytes.
//
// A match is a list of turns. Each turn is one shot by one player:
//
//   start      the turn begins: the camera moves, the wind is read out
//   aimStart   the shooter can aim; a human's input times count from here
//   release    the shot leaves
//   impact     it lands, sticks, drops through or is saved
//   end        the next turn starts
//
// all in game ms. A human's input is one entry in the record's `shots`; a
// bot's turn draws its shot from the seed, so the record holds only what
// people did.

import {
  RULES_VERSION, READABLE_RULES, INTRO_MS, INTRO_SAME_MS, INTRO_PASS_MS, SETTLE_MS, CLOCK_GRACE_MS, MAX_SHOTS, MAX_GAME_MS,
  cleanGame, cleanDifficulty, cleanLength, cleanClock, cleanMode,
  shotPoints, matchScore, nerveFactor, heartRate,
} from "./rules.js";
import { cleanSeed, seedNumber } from "./seed.js";
import { PI, atan2 } from "./fmath.js";
import { windFor, sway, fatigue, pressureOf, weatherFor } from "./sim-shared.js";
import { archery } from "./sim-archery.js";
import { darts } from "./sim-darts.js";
import { hoops } from "./sim-hoops.js";
import { kicks } from "./sim-kicks.js";

export const GAMES = { archery, darts, hoops, kicks };

/* ---- what every game shares, from js/sim-shared.js ---- */

export { windFor, sway, fatigue, pressureOf, weatherFor };

// Conditions every turn carries, on top of the game's own.
function baseConditions(game, wind, pressure, weather) {
  return {
    weather,
    wet: weather.wet,
    wind,
    windRatio: wind.ratio,
    pressure,
    nerves: nerveFactor(pressure),
    bpm: heartRate(pressure),
    game,
  };
}

/* ---- the match ---- */

export function newMatch(seed, settings) {
  const clean = cleanSeed(seed);
  if (!clean) throw new Error("bad seed");
  const s = {
    game: cleanGame(settings.game),
    mode: cleanMode(settings.mode),
    difficulty: cleanDifficulty(settings.difficulty),
    length: cleanLength(settings.length),
    clock: cleanClock(settings.clock),
    // A record says which rules it was played by; a new match plays by
    // the newest.
    rules: READABLE_RULES.includes(settings.v) ? settings.v : RULES_VERSION,
  };
  const seedNum = seedNumber(clean);
  const weather = weatherFor(seedNum, s.game, s.difficulty, s.rules);
  const mod = GAMES[s.game];
  return {
    seed: clean,
    seedNum,
    settings: s,
    weather,
    // Who plays: player 0 is always a person; player 1 is the bot only
    // in bot mode.
    humans: [true, s.mode !== "bot"],
    g: mod.setup(s, seedNum),
    turns: [],
    next: null,
    t: 0,
    points: [0, 0],
    used: 0,
    over: null,
  };
}

const modOf = (state) => GAMES[state.settings.game];

function ctxOf(state, i) {
  const weather = state.weather;
  return {
    seedNum: state.seedNum,
    i,
    settings: state.settings,
    humans: state.humans,
    weather,
    windFor,
    sway,
    // The rain's tension rides on every shot's pressure.
    pressureOf: (o) => pressureOf({ ...o, tension: weather.tension }),
    base: (game, wind, pressure) => baseConditions(game, wind, pressure, weather),
  };
}

// The turn after the last one, set up once: who shoots, what the wind is,
// how much it matters. Null once the match is over.
export function pending(state) {
  if (state.over) return null;
  if (state.next) return state.next;
  const mod = modOf(state);
  const desc = mod.nextTurn(state.g, state.settings);
  if (!desc) {
    end(state, "done", state.t);
    return null;
  }
  const i = state.turns.length;
  const prev = state.turns[i - 1];
  const shooter = mod.inputOf(desc, state.humans) === "keep" ? desc.keeper : desc.player;
  const before = prev ? (prev.input === "keep" ? prev.keeper : prev.player) : shooter;
  const intro = prev && desc.sameGo ? INTRO_SAME_MS : state.settings.mode === "local" && prev && shooter !== before ? INTRO_PASS_MS : INTRO_MS;
  const ctx = ctxOf(state, i);
  const cond = mod.conditions(state.g, desc, ctx);
  state.next = {
    i,
    ...desc,
    cond,
    // What a person has to do on this turn, or null for the bot's turn.
    input: mod.inputOf(desc, state.humans),
    start: state.t,
    aimStart: state.t + intro,
  };
  return state.next;
}

function end(state, by, at) {
  const out = modOf(state).outcome(state.g);
  state.over = { by, at, winner: by === "quit" ? null : out.winner, detail: out.detail ?? null };
  state.next = null;
}

// Plays a turn with `shot`, a person's input, or the bot's if null.
function play(state, turn, shot) {
  const mod = modOf(state);
  const ctx = ctxOf(state, turn.i);
  const input = shot ?? mod.botShot(state.g, turn, ctx);
  const result = mod.resolve(state.g, turn, input, ctx);
  const release = turn.aimStart + result.releaseMs;
  const impact = release + result.flightMs;
  const finish = impact + (result.settleMs ?? SETTLE_MS);
  mod.apply(state.g, turn, result);
  const points = [0, 1].map((p) =>
    shotPoints(result.raw[p] ?? 0, { round: turn.round, clock: state.settings.clock, windRatio: turn.cond.windRatio, pressure: turn.cond.pressure })
  );
  state.points[0] += points[0];
  state.points[1] += points[1];
  const done = { ...turn, shot: input, human: shot !== null, result, release, impact, end: finish, points, board: mod.board(state.g) };
  state.turns.push(done);
  state.t = finish;
  state.next = null;
  return done;
}

// Plays every bot turn up to the next one a person has to play, or to the
// end of the match.
export function advance(state) {
  for (;;) {
    const turn = pending(state);
    if (!turn || turn.input) return turn;
    play(state, turn, null);
  }
}

// A person's input for the turn waiting on one. Returns the played turn,
// or an error code if the input does not fit the turn.
export function feed(state, raw) {
  const turn = advance(state);
  if (!turn) return { error: "over" };
  const mod = modOf(state);
  const shot = mod.cleanShot(turn.input, raw);
  if (!shot) return { error: "bad_shot" };
  const clock = state.settings.clock;
  if (clock && turn.input !== "keep" && mod.releaseMs(turn.input, shot, turn.cond) > clock * 1000 + CLOCK_GRACE_MS) {
    return { error: "late" };
  }
  state.used += 1;
  const done = play(state, turn, shot);
  advance(state);
  return { turn: done };
}

// What a turn would come to with this input, without playing it: the live
// keeper's view, which redraws whenever the player taps.
export function preview(state, raw) {
  const turn = pending(state);
  if (!turn || !turn.input) return null;
  const mod = modOf(state);
  const shot = mod.cleanShot(turn.input, raw);
  if (!shot) return null;
  return mod.resolve(state.g, turn, shot, ctxOf(state, turn.i));
}

export function quit(state, at) {
  if (state.over) return;
  end(state, "quit", Math.max(at, state.turns.at(-1)?.end ?? 0));
}

/* ---- reading a match ---- */

// The result for player p: win, lose or draw, or null if it did not end.
export function resultFor(state, p = 0) {
  if (!state.over || state.over.by !== "done") return null;
  if (state.over.winner === null) return "draw";
  return state.over.winner === p ? "win" : "lose";
}

// Player p's score: the points from every shot, scaled by the difficulty
// and length, with the bonus for winning.
export function scoreOf(state, p = 0) {
  return matchScore(state.points[p], {
    difficulty: state.settings.difficulty,
    length: state.settings.length,
    result: resultFor(state, p),
  });
}

// The turn showing at game time t: the last one started by then.
export function turnAt(state, t) {
  const list = state.turns;
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

// The scoreboard as it stood at game time t: after the last shot landed.
export function boardAt(state, t) {
  for (let k = state.turns.length - 1; k >= 0; k--) {
    if (state.turns[k].impact <= t) return state.turns[k].board;
  }
  return modOf(state).board(modOf(state).setup(state.settings, state.seedNum));
}

// Points each player had at game time t.
export function pointsAt(state, t) {
  const out = [0, 0];
  for (const turn of state.turns) {
    if (turn.impact > t) break;
    out[0] += turn.points[0];
    out[1] += turn.points[1];
  }
  return out;
}

// A whole record, played through. Returns { state } or { error }.
// `partial` allows a record that stops before the match ends: a party
// guest's view of a match still going.
export function runRecord(record, { partial = false } = {}) {
  let state;
  try {
    state = newMatch(record.seed, record);
  } catch {
    return { error: "bad_seed" };
  }
  if (record.shots.length > MAX_SHOTS) return { error: "too_long" };
  for (const shot of record.shots) {
    const out = feed(state, shot);
    if (out.error) return { error: out.error };
  }
  advance(state);
  if (record.quit) {
    if (state.over) return { error: "quit_after_end" };
    quit(state, record.end ?? state.t);
  }
  if (!state.over && !partial) return { error: "unfinished" };
  if (state.over && state.over.at > MAX_GAME_MS) return { error: "too_long" };
  return { state };
}

// Direction a wind blows to, as screen degrees for the arrow on the wind
// chip: 0 points up the screen (away down the range), 90 to the right.
export const windDegrees = (wind) => Math.round((atan2(wind.x, wind.z) * 180) / PI);
