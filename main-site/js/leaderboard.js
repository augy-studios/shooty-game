// The leaderboard window: for each game, each name's best match and every
// match under a name added up, after MRT Station Guesser's.

import { api } from "./api.js";
import { GAMES, DIFFICULTIES, LENGTHS } from "./rules.js";
import { escapeHtml, openModal } from "./ui.js";

const RESULTS = { win: "Won", lose: "Lost", draw: "Drew" };

const BOARDS = {
  best: {
    head: ["#", "Name", "Score", "Mode", "Result"],
    row: (e) => [e.rank, e.name, e.score, `${DIFFICULTIES[e.difficulty]?.label ?? ""}, ${LENGTHS[e.length]?.label ?? ""}`, RESULTS[e.result] ?? ""],
    about: (game) => `Each name's single best ${GAMES[game].label} match. Harder bots, longer matches, tighter shot clocks and stronger winds score more.`,
  },
  total: {
    head: ["#", "Name", "Total", "Matches", "Won"],
    row: (e) => [e.rank, e.name, e.total, e.matches, e.wins],
    about: (game) => `Every ${GAMES[game].label} match added under a name, scores added up.`,
  },
};

let game = "archery";
let board = "best";
let loading = 0;

function setTabs() {
  document.querySelectorAll("#boardGames [data-game]").forEach((el) => {
    const on = el.dataset.game === game;
    el.classList.toggle("active", on);
    el.setAttribute("aria-selected", String(on));
  });
  document.querySelectorAll("#boardTabs [data-board]").forEach((el) => {
    const on = el.dataset.board === board;
    el.classList.toggle("active", on);
    el.setAttribute("aria-selected", String(on));
  });
}

async function load() {
  const body = document.getElementById("boardBody");
  const note = document.getElementById("boardNote");
  const ticket = ++loading;
  const spec = BOARDS[board];
  body.setAttribute("aria-busy", "true");
  note.textContent = spec.about(game);

  try {
    const data = await api.leaderboard(game, board);
    if (ticket !== loading) return;
    const entries = data.entries ?? [];
    body.innerHTML = entries.length
      ? `<table class="board-table">
          <thead><tr>${spec.head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead>
          <tbody>${entries
            .map((e) => `<tr>${spec.row(e).map((v) => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`)
            .join("")}</tbody>
        </table>`
      : `<p class="board-empty">No scores yet. Beat the bot and add yours.</p>`;
  } catch (err) {
    if (ticket !== loading) return;
    body.innerHTML = `<p class="board-empty">${
      err.code === "offline" ? "The leaderboard needs a connection." : "The leaderboard did not load. Try again in a moment."
    }</p>`;
  } finally {
    if (ticket === loading) body.removeAttribute("aria-busy");
  }
}

export function openLeaderboard(which = game, kind = board) {
  game = which;
  board = kind;
  setTabs();
  openModal("boardModal");
  load();
}

export function initLeaderboard({ currentGame }) {
  document.getElementById("boardBtn").addEventListener("click", () => openLeaderboard(currentGame() ?? game));
  document.getElementById("boardGames").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-game]");
    if (!tab || tab.dataset.game === game) return;
    game = tab.dataset.game;
    setTabs();
    load();
  });
  document.getElementById("boardTabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-board]");
    if (!tab || tab.dataset.board === board) return;
    board = tab.dataset.board;
    setTabs();
    load();
  });
}
