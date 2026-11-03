// GET /api/leaderboard?game=archery|darts|hoops|kicks&board=best|total
//   best  (default) -> { game, board, entries: [{ rank, name, score, result, difficulty, length, clock }] }
//   total           -> { game, board, entries: [{ rank, name, total, matches, wins }] }
// Public, no login, one row per name and game, cached briefly at the edge.

import { endpoint, HttpError } from "../_lib/http.js";
import { rest } from "../_lib/supabase.js";
import { GAME_IDS } from "../../js/rules.js";

const LIMIT = 100;

const BOARDS = {
  best: {
    query: (game) =>
      `uwushooty_leaderboard_best?game=eq.${game}&select=name,score,result,difficulty,length,clock&order=score.desc,created_at.asc&limit=${LIMIT}`,
    row: (r) => ({ name: r.name, score: r.score, result: r.result, difficulty: r.difficulty, length: r.length, clock: r.clock }),
  },
  total: {
    query: (game) =>
      `uwushooty_leaderboard_total?game=eq.${game}&select=name,total,matches,wins&order=total.desc,matches.asc,last_at.asc&limit=${LIMIT}`,
    // bigint sums arrive as numbers well within range for this game.
    row: (r) => ({ name: r.name, total: Number(r.total), matches: r.matches, wins: r.wins }),
  },
};

export default endpoint("GET", async ({ req, res }) => {
  const game = req.query?.game ?? "archery";
  if (!GAME_IDS.includes(game)) throw new HttpError(400, "bad_game", "game is archery, darts, hoops or kicks.");
  const board = req.query?.board ?? "best";
  const spec = BOARDS[board];
  if (!spec) throw new HttpError(400, "bad_board", "board is best or total.");

  const rows = await rest(spec.query(game));
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=60");
  return { game, board, entries: (rows ?? []).map((r, i) => ({ rank: i + 1, ...spec.row(r) })) };
});
