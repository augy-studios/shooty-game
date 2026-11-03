// POST /api/game/start
//   { client_key, game, difficulty, length, clock } -> { game_id, seed, created_at }
// The start ticket. A match can only go on the leaderboard if it began
// here, which is what gives it a start time no browser can move.
//
// The server picks the seed. It decides every gust and every one of the
// bot's shots, so a match on a seed known ahead could be worked out shot
// by shot before it is played; a match on a seed somebody chose is never
// scored. Matches started offline play the same; they just have no ticket.

import { endpoint, HttpError, clientKey, limit } from "../_lib/http.js";
import { rest, rpc } from "../_lib/supabase.js";
import { newSeed } from "../../js/seed.js";
import { GAME_IDS, DIFFICULTIES, LENGTHS, CLOCKS } from "../../js/rules.js";

export default endpoint("POST", async ({ req, body }) => {
  const key = clientKey(body.client_key);
  if (!GAME_IDS.includes(body.game)) throw new HttpError(400, "bad_game");
  if (!Object.hasOwn(DIFFICULTIES, body.difficulty)) throw new HttpError(400, "bad_difficulty");
  if (!Object.hasOwn(LENGTHS, body.length)) throw new HttpError(400, "bad_length");
  if (!Object.hasOwn(CLOCKS, String(body.clock))) throw new HttpError(400, "bad_clock");

  await limit(req, "start", 600, 120);

  const seed = newSeed();
  const [row] = await rest("uwushooty_games?select=id,created_at", {
    method: "POST",
    prefer: "return=representation",
    body: {
      game: body.game,
      seed,
      difficulty: body.difficulty,
      length: body.length,
      clock: Number(body.clock),
      client_key: key,
    },
  });

  // Now and then, clear out what nobody will submit.
  if (Math.random() < 0.02) rpc("uwushooty_prune", {}).catch(() => {});

  return { game_id: row.id, seed, created_at: row.created_at };
});
