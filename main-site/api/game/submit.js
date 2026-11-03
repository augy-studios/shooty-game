// POST /api/game/submit  { game_id, client_key, name, record }
//   -> { name, score, result, elapsed_ms, rank, best_score, total, matches, total_rank }
// The score is worked out here from the record and the server's own times;
// see verify.js for the checks on the match and the SQL function for the
// ones that need the database. Ranks are within the match's game.

import { endpoint, HttpError, clientKey, gameId, limit } from "../_lib/http.js";
import { cleanName } from "../_lib/names.js";
import { rest, rpc } from "../_lib/supabase.js";
import { readRecord, check } from "../_lib/verify.js";

const REFUSALS = {
  not_found: [404, "That match does not exist."],
  expired: [410, "That match started more than 12 hours ago."],
  not_yours: [403, "That match was started in a different browser."],
  already_submitted: [409, "That match is already on the leaderboard."],
  mismatch: [409, "That match already ended with other shots."],
  overlap: [409, "That match was played at the same time as another one already on the leaderboard under this name."],
};

export default endpoint("POST", async ({ req, body }) => {
  const id = gameId(body.game_id);
  const key = clientKey(body.client_key);
  const name = cleanName(body.name);
  const record = readRecord(body.record);

  await limit(req, "submit", 600, 60);

  const [game] = (await rest(`uwushooty_games?id=eq.${id}&select=*`)) ?? [];
  if (!game) throw new HttpError(404, "not_found", REFUSALS.not_found[1]);

  // The match's end as the server saw it: when the page reported it, if
  // that was this record, and otherwise now.
  const same = game.record && JSON.stringify(readRecord(game.record)) === JSON.stringify(record);
  const endedAt = game.finished_at && same ? Date.parse(game.finished_at) : Date.now();
  const elapsed = endedAt - Date.parse(game.created_at);

  const result = check(game, record, elapsed);

  const [row] =
    (await rpc("uwushooty_submit", {
      p_game_id: id,
      p_client_key: key,
      p_name: name,
      p_record: record,
      p_score: result.score,
      p_result: result.result,
    })) ?? [];
  if (row?.status !== "ok") {
    const [status, message] = REFUSALS[row?.status] ?? [500, "Could not submit."];
    throw new HttpError(status, row?.status ?? "server", message);
  }

  return {
    name,
    score: result.score,
    result: result.result,
    elapsed_ms: elapsed,
    rank: Number(row.rank),
    best_score: row.best_score,
    total: Number(row.total),
    matches: row.matches,
    total_rank: Number(row.total_rank),
  };
});
