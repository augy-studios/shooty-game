#!/usr/bin/env node
// The API's check on a submitted match (main-site/api/_lib/verify.js),
// without a database: a match played by a stand-in person passes, and a
// scripted one, one faster than the clock, one on another seed, one
// against a friend and one stopped part way are each refused.
//
// Run: node scripts/test-verify.mjs   (Node 20 or later, nothing to install)

import { check } from "../main-site/api/_lib/verify.js";
import { newMatch, advance, feed, sway } from "../main-site/js/sim.js";
import { archery, landing, FACE_Y } from "../main-site/js/sim-archery.js";
import { newSeed } from "../main-site/js/seed.js";
import { RULES_VERSION } from "../main-site/js/rules.js";

const failures = [];
const r = (a, b) => a + Math.floor(Math.random() * (b - a));

// Plays an archery match: `aim(turn, ctx)` gives each shot.
function play(settings, aim) {
  const seed = newSeed();
  const state = newMatch(seed, settings);
  const shots = [];
  for (;;) {
    const turn = advance(state);
    if (!turn) break;
    const shot = aim(turn, { seedNum: state.seedNum, i: turn.i, settings: state.settings, sway });
    if (feed(state, shot).error) throw new Error("feed");
    shots.push(shot);
  }
  const record = { v: RULES_VERSION, game: settings.game, mode: settings.mode, seed, difficulty: settings.difficulty, length: settings.length, clock: settings.clock, shots };
  const row = { game: settings.game, seed, difficulty: settings.difficulty, length: settings.length, clock: settings.clock };
  return { state, record, row };
}

const settings = { game: "archery", mode: "bot", difficulty: "hard", length: "short", clock: 0 };

// A person: aims near the middle, a bit off, holds a couple of seconds.
const person = (turn) => {
  const draw = r(200, 600);
  return [draw, draw + r(1500, 3500), r(-150, 150), r(-150, 150)];
};

// A script: reads the wind and the sway from the sim and puts every arrow
// dead centre.
const script = (turn, ctx) => {
  const draw = 300;
  const release = 1800;
  let x = 0;
  let y = 0;
  for (let k = 0; k < 6; k++) {
    const ret = archery.reticle(turn.cond, ctx, draw, release, x, y);
    const land = landing(turn.cond, ret.x, ret.y);
    x -= land.x;
    y -= land.y - FACE_Y;
  }
  return [draw, release, Math.round(x * 1000), Math.round(y * 1000)];
};

const expect = (label, fn, code) => {
  try {
    fn();
    if (code) failures.push(`${label}: passed, expected ${code}`);
  } catch (err) {
    if (!code) failures.push(`${label}: refused with ${err.code}`);
    else if (err.code !== code) failures.push(`${label}: refused with ${err.code}, expected ${code}`);
  }
};

{
  const m = play(settings, person);
  expect("a person's match", () => check(m.row, m.record, m.state.over.at + 60000), null);
  expect("faster than the clock", () => check(m.row, m.record, m.state.over.at - 10000), "too_fast");
  expect("another seed", () => check({ ...m.row, seed: newSeed() }, m.record, m.state.over.at + 60000), "not_this_game");
  expect("against a friend", () => check(m.row, { ...m.record, mode: "local" }, m.state.over.at + 60000), "not_this_game");
  expect("stopped part way", () => check(m.row, { ...m.record, shots: m.record.shots.slice(0, 4) }, m.state.over.at + 60000), "unfinished");
}
{
  const m = play(settings, script);
  expect("a script dead centre every time", () => check(m.row, m.record, m.state.over.at + 60000), "inhuman");
}
{
  const m = play(settings, (turn) => [100, 150, 0, 0]);
  expect("shots quicker than a hand", () => check(m.row, m.record, m.state.over.at + 60000), "inhuman");
}

if (failures.length) {
  console.error("verify check failed:");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log("verify ok: a person's match passes; scripted, too fast, wrong seed, friend and unfinished matches are refused.");
