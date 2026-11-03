// Plays a submitted match again with the same modules the browser plays
// with, and works out what it is worth. Nothing a browser says about a
// match is taken on trust: the score comes from the shots, the shots have
// to make the match the ticket started, the match cannot have run faster
// than the server's own clock, and it has to look like a person played it.
//
// None of this proves who played. It is meant to stop scripted and
// doctored matches, which is as far as a game that runs in the browser
// can go.

import { runRecord, scoreOf, resultFor } from "../../js/sim.js";
import { cleanRecord } from "../../js/record.js";
import { hypot } from "../../js/fmath.js";
import { FACE_Y } from "../../js/sim-archery.js";
import { HttpError } from "./http.js";

// The start ticket's round trip, and a little drift between clocks.
const CLOCK_SLACK_MS = 3000;
// More than this many shots quicker than a hand can make them is a script.
const MAX_QUICK = 2;

export function readRecord(value) {
  const record = cleanRecord(value);
  if (!record) throw new HttpError(400, "bad_record", "That match could not be read.");
  return record;
}

// What a person's hands cannot do, game by game: how quick, and how
// precise, over a whole match. A script aims with the sim open; a person
// fights the sway and guesses the wind.
function inhuman(game, state) {
  const mine = state.turns.filter((t) => t.human && (t.input === "keep" ? t.keeper === 0 : t.player === 0));
  let quick = 0;
  switch (game) {
    case "archery": {
      // A draw and aim takes most people a second or more.
      for (const t of mine) if (t.shot[0] >= 0 && t.shot[1] - t.shot[0] < 250) quick += 1;
      const arrows = mine.filter((t) => !t.result.none && t.result.stuck === "face");
      if (arrows.length >= 9 && state.settings.difficulty !== "easy") {
        const mean = arrows.reduce((s, t) => s + hypot(t.result.hit.x, t.result.hit.y - FACE_Y), 0) / arrows.length;
        // Better than an Olympic group, in wind, with nerves.
        if (mean < 0.015) return true;
      }
      break;
    }
    case "darts": {
      for (const t of mine) if (t.shot[0] < 120 || t.shot[1] - t.shot[0] < 120) quick += 1;
      if (mine.length >= 12) {
        const beds = mine.filter((t) => ["treble", "double", "bull", "outer"].includes(t.result.bed.ring)).length;
        if (beds / mine.length > 0.7) return true;
      }
      break;
    }
    case "hoops": {
      for (const t of mine) if (t.shot[0] >= 0 && t.shot[1] - t.shot[0] < 150) quick += 1;
      const shots = mine.filter((t) => !t.result.none);
      if (shots.length >= 15 && shots.filter((t) => t.result.swish).length / shots.length >= 0.95) return true;
      break;
    }
    case "kicks": {
      for (const t of mine) if (t.input === "kick" && t.shot[0] >= 0 && t.shot[1] - t.shot[0] < 60) quick += 1;
      break;
    }
  }
  return quick > MAX_QUICK;
}

// game: the uwushooty_games row. elapsedMs: the server's time from the
// start ticket to the end of the match.
export function check(game, record, elapsedMs) {
  if (record.mode !== "bot") throw new HttpError(409, "not_this_game", "Only matches against the bot go on the leaderboard.");
  if (
    record.game !== game.game ||
    record.seed !== game.seed ||
    record.difficulty !== game.difficulty ||
    record.length !== game.length ||
    record.clock !== game.clock
  ) {
    throw new HttpError(409, "not_this_game", "That is not the match this ticket started.");
  }

  const run = runRecord(record);
  if (run.error === "unfinished") throw new HttpError(409, "unfinished", "Finish the match to go on the leaderboard.");
  if (run.error) throw new HttpError(409, "bad_record", "Those shots do not make a match.");
  const state = run.state;
  if (state.over.by !== "done") throw new HttpError(409, "unfinished", "Finish the match to go on the leaderboard.");

  // Game time only runs while the match is on screen, so it can fall
  // behind the server's clock but never get ahead of it.
  if (state.over.at > elapsedMs + CLOCK_SLACK_MS) {
    throw new HttpError(409, "too_fast", "That match ran faster than real time.");
  }
  if (inhuman(record.game, state)) {
    throw new HttpError(409, "inhuman", "That match was played faster or more precisely than a person can.");
  }

  return {
    score: scoreOf(state, 0),
    result: resultFor(state, 0),
    durationMs: state.over.at,
  };
}
