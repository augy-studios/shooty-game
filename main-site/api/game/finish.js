// POST /api/game/finish  { game_id, client_key, record } -> { elapsed_ms }
// Sent by the page the moment a match ends, so the server's clock stops
// then and not whenever somebody gets round to submitting, and so the
// match is kept for a checked replay link. The record is checked as it
// would be on submit; a match that would be refused there is refused here.

import { endpoint, HttpError, clientKey, gameId, limit } from "../_lib/http.js";
import { rest, rpc } from "../_lib/supabase.js";
import { readRecord, check } from "../_lib/verify.js";

const REFUSALS = {
  not_found: [404, "That match does not exist."],
  expired: [410, "That match started more than 12 hours ago."],
  not_yours: [403, "That match was started in a different browser."],
  mismatch: [409, "That match already ended with other shots."],
};

export default endpoint("POST", async ({ req, body }) => {
  const id = gameId(body.game_id);
  const key = clientKey(body.client_key);
  const record = readRecord(body.record);

  await limit(req, "finish", 600, 120);

  const [game] = (await rest(`uwushooty_games?id=eq.${id}&select=*`)) ?? [];
  if (!game) throw new HttpError(404, "not_found", REFUSALS.not_found[1]);
  check(game, record, Date.now() - Date.parse(game.created_at));

  const [row] = (await rpc("uwushooty_finish", { p_game_id: id, p_client_key: key, p_record: record })) ?? [];
  if (row?.status !== "ok") {
    const [status, message] = REFUSALS[row?.status] ?? [500, "Could not record the end of the match."];
    throw new HttpError(status, row?.status ?? "server", message);
  }
  return { elapsed_ms: Date.parse(row.finished_at) - Date.parse(row.created_at) };
});
