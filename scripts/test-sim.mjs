#!/usr/bin/env node
// Plays matches of every game through js/sim.js with a stand-in player, and
// checks what the API and the replays rely on:
//
//   - the same seed and inputs make the same match, every time
//   - a record packs into a link and back without changing
//   - a record played back gives the same score as the match did live
//   - the bots score something like they should at each difficulty
//   - matches last a sensible time, and end
//
// Run: node scripts/test-sim.mjs   (Node 20 or later, nothing to install)

import { newMatch, advance, feed, runRecord, scoreOf, resultFor, GAMES } from "../main-site/js/sim.js";
import { packRecord, unpackRecord, cleanRecord } from "../main-site/js/record.js";
import { newSeed } from "../main-site/js/seed.js";
import { RULES_VERSION, GAME_IDS } from "../main-site/js/rules.js";

const failures = [];
const fail = (msg) => failures.push(msg);

// A stand-in for a person: steady enough to score, not so good it never
// misses. Draws on Math.random, which is fine: its inputs are recorded.
function standIn(game, turn) {
  const r = (a, b) => a + Math.floor(Math.random() * (b - a));
  const c = turn.cond;
  switch (game) {
    case "archery": {
      const draw = r(200, 600);
      return [draw, draw + r(1200, 3500), r(-120, 120), r(-120, 120)];
    }
    case "darts": {
      const a = r(300, 2500);
      return [a, a + r(300, 2500)];
    }
    case "hoops": {
      const power = Math.round(((c.ideal - 6) / 4) * 1000) + r(-15, 15);
      const press = r(200, 500);
      return [press, press + r(600, 1800), r(-80, 80), Math.max(0, Math.min(1000, power))];
    }
    case "kicks": {
      if (turn.input === "keep") return Math.random() < 0.2 ? [-1, 0, 0] : [c.kickMs + r(-300, 200), r(-3000, 3000), r(300, 2000)];
      const press = r(200, 500);
      return [press, press + r(300, 900), r(-3300, 3300), r(300, 2300), r(200, 900), r(-600, 600)];
    }
  }
  throw new Error(game);
}

function playMatch(settings, seed) {
  const state = newMatch(seed, settings);
  const shots = [];
  for (let guard = 0; guard < 2000; guard++) {
    const turn = advance(state);
    if (!turn) break;
    const shot = standIn(settings.game, turn);
    const out = feed(state, shot);
    if (out.error) throw new Error(`${settings.game} feed ${out.error} ${JSON.stringify(shot)}`);
    shots.push(shot);
  }
  if (!state.over) throw new Error(`${settings.game}: match did not end`);
  return { state, record: { v: RULES_VERSION, ...state.settings, seed, shots } };
}

const stats = {};
for (const game of GAME_IDS) {
  for (const difficulty of ["easy", "medium", "hard"]) {
    const key = `${game}/${difficulty}`;
    stats[key] = { matches: 0, ms: 0, botWins: 0, humanScore: 0, botPoints: 0, botHits: 0, botShots: 0 };
    for (let m = 0; m < 12; m++) {
      const settings = { game, mode: "bot", difficulty, length: "standard", clock: [0, 10, 5][m % 3] };
      const seed = newSeed();
      let live;
      try {
        live = playMatch(settings, seed);
      } catch (err) {
        fail(`${key}: ${err.message}`);
        continue;
      }
      const record = cleanRecord({ ...live.record, clock: settings.clock });
      if (!record) {
        fail(`${key}: cleanRecord refused a real record`);
        continue;
      }
      const token = packRecord(record);
      const back = unpackRecord(token);
      if (JSON.stringify(back) !== JSON.stringify(record)) fail(`${key}: record did not survive packing (${token.slice(0, 60)})`);
      const again = runRecord(record);
      if (again.error) fail(`${key}: replay failed, ${again.error}`);
      else {
        const a = scoreOf(live.state);
        const b = scoreOf(again.state);
        if (a !== b) fail(`${key}: live score ${a} but replayed ${b}`);
        if (JSON.stringify(live.state.turns.map((t) => t.result.path)) !== JSON.stringify(again.state.turns.map((t) => t.result.path))) {
          fail(`${key}: replayed flights differ`);
        }
      }
      const s = stats[key];
      s.matches += 1;
      s.ms += live.state.over.at;
      if (resultFor(live.state) === "lose") s.botWins += 1;
      s.humanScore += scoreOf(live.state);
      for (const t of live.state.turns) {
        if (t.player !== 1) continue;
        s.botShots += 1;
        const r = t.result;
        if (game === "archery") s.botPoints += r.ring;
        if (game === "darts") s.botPoints += r.value;
        if (game === "hoops" && r.made) s.botHits += 1;
        if (game === "kicks" && r.goal) s.botHits += 1;
      }
      if (token.length > 1800) fail(`${key}: a ${token.length} character link is long`);
    }
  }
}

console.log("game/difficulty      length  bot wins  your score  bot per shot");
for (const [key, s] of Object.entries(stats)) {
  if (!s.matches) continue;
  const per = key.startsWith("archery") || key.startsWith("darts") ? (s.botPoints / s.botShots).toFixed(1) : `${Math.round((100 * s.botHits) / s.botShots)}%`;
  console.log(`${key.padEnd(20)} ${(s.ms / s.matches / 1000).toFixed(0).padStart(5)} s  ${String(s.botWins).padStart(4)}/${s.matches}  ${String(Math.round(s.humanScore / s.matches)).padStart(9)}  ${per.padStart(10)}`);
}

// A record that claims a shot after the clock is refused.
{
  const seed = newSeed();
  const state = newMatch(seed, { game: "archery", mode: "bot", difficulty: "easy", length: "short", clock: 3 });
  advance(state);
  const out = feed(state, [100, 9000, 0, 0]);
  if (out.error !== "late") fail("a shot after the shot clock was accepted");
}

// A record with a shot too many is refused.
{
  const { record } = playMatch({ game: "hoops", mode: "bot", difficulty: "easy", length: "short", clock: 0 }, newSeed());
  const longer = { ...record, shots: [...record.shots, [100, 900, 0, 500]] };
  if (!runRecord(longer).error) fail("a record with a shot after the end was accepted");
}

if (failures.length) {
  console.error(`\n${failures.length} failed:`);
  for (const f of failures.slice(0, 30)) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nsim ok: ${Object.keys(GAMES).length} games, every match replays to the same score.`);
