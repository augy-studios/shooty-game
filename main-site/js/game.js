// The game screen: picking a game and its settings, playing a match, the
// result, the replay, submitting, sharing, and shared replays.
//
// A match runs on game time, which only moves while the match is on
// screen and not paused. js/sim.js says what happens when; this file
// turns the hands into shots at the right moments, and draws the match at
// whatever moment is showing, live or in the replay.

import { GAMES, DIFFICULTIES, LENGTHS, CLOCKS, RULES_VERSION, cleanGame } from "./rules.js";
import { newMatch, advance, feed, preview, runRecord, scoreOf, resultFor, boardAt, pointsAt, turnAt, windDegrees } from "./sim.js";
import { sway } from "./sim-shared.js";
import { cleanSeed, newSeed } from "./seed.js";
import { packRecord } from "./record.js";
import { pathMs } from "./physics.js";
import { initStage, useWorld, render, setQuality, setMode } from "./scene.js";
import { createControls, shareable, cleanShared } from "./controls.js";
import { createReplay } from "./replay.js";
import { api } from "./api.js";
import { getSettings, saveSettings, saveGameSettings, onSettings } from "./settings.js";
import { openLeaderboard } from "./leaderboard.js";
import { getStoredMode } from "./theme.js";
import { copyText, escapeHtml, hydrateIcons, store } from "./ui.js";
import { play, twang, heartbeat, setWind, setRain, thunder, unlockAudio, buzz, setMuted } from "./audio.js";
import { thunderBetween } from "./weather.js";

const BEST_KEY = "uwushooty.best";
// How long a ticket may take before the match starts unscored.
const TICKET_MS = 3000;
// The camera's look at the end before the replay starts by itself.
const OVERVIEW_MS = 1200;

const $ = (id) => document.getElementById(id);

const S = {
  game: "archery",
  screen: "menu",
  match: null,
  record: null,
  t: 0,
  paused: false,
  world: null,
  controls: null,
  ticket: null,
  unscored: null,
  names: ["You", "Bot"],
  // Which players this device plays: both on one device, one each over
  // the network.
  mine: [true, false],
  ownTurn: -1,
  announced: { release: -1, impact: -1 },
  keepPreview: null,
  submitted: false,
  finishing: null,
  shared: null,
  lastFrame: 0,
  lastBeat: 0,
  callout: 0,
  party: null,
  remoteLive: null,
  starting: false,
};

const replay = createReplay({
  describe: {
    turn: (state, turn, t) => describeTurn(state, turn, t),
    end: (state) => endLine(state),
  },
});

/* ---- small helpers ---- */

function show(id, on) {
  $(id).classList.toggle("hidden", !on);
}

let toastTimer = null;
export function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

function sheets(which) {
  for (const id of ["menu", "setup", "friend", "party", "result"]) show(id, id === which);
}

const fmt = (n) => Number(n).toLocaleString("en");

function bests() {
  return store.getJSON(BEST_KEY) ?? {};
}

function saveBest(game, score) {
  const all = bests();
  if (score <= (all[game] ?? 0)) return false;
  all[game] = score;
  store.set(BEST_KEY, all);
  return true;
}

function pick(groupId, attr, value) {
  document.querySelectorAll(`#${groupId} [data-${attr}]`).forEach((el) => {
    el.setAttribute("aria-checked", String(el.dataset[attr] === String(value)));
  });
}

export const currentGame = () => S.game;

/* ---- the menu and a game's settings ---- */

function renderMenu() {
  const all = bests();
  document.querySelectorAll("[data-best]").forEach((el) => {
    const b = all[el.dataset.best];
    el.textContent = b ? `Best ${fmt(b)}` : "";
  });
}

export function showMenu() {
  leaveMatch();
  S.screen = "menu";
  sheets("menu");
  show("hud", false);
  show("playControls", false);
  show("tapHint", false);
  renderMenu();
}

function lengthLabel(game, length) {
  const n = GAMES[game].lengths[length];
  const unit = GAMES[game].lengthUnit;
  return unit ? `${n} ${unit.split(" ")[0]}` : String(n);
}

function renderSetup() {
  const game = S.game;
  const g = getSettings().games[game];
  $("setupTitle").textContent = GAMES[game].label;
  $("setupLead").textContent = GAMES[game].lead;
  pick("difficultyPick", "difficulty", g.difficulty);
  pick("lengthPick", "length", g.length);
  pick("clockPick", "clock", g.clock);
  document.querySelectorAll("#lengthPick [data-length]").forEach((el) => {
    el.textContent = lengthLabel(game, el.dataset.length);
  });
  $("lengthLabel").textContent = game === "darts" ? "Starting score" : "Match length";
  const pct = Math.round((DIFFICULTIES[g.difficulty].percent * LENGTHS[g.length].percent * CLOCKS[g.clock].percent) / 10000);
  $("scoreNote").textContent = `Scores ${pct}% on every shot, more in stronger wind and on the shots that decide it, and a quarter more for beating the bot.`;
  seedNote();
}

function seedNote() {
  const raw = $("seedInput").value.trim();
  const seed = cleanSeed(raw);
  $("seedNote").textContent = !raw
    ? ""
    : seed
      ? "That seed's match: the same wind, the same bot. Matches on a chosen seed are not added to the leaderboard."
      : "A seed is eight letters and numbers, like BXK4-M9TR.";
}

export function showSetup(game = S.game) {
  leaveMatch();
  S.game = cleanGame(game);
  S.screen = "setup";
  sheets("setup");
  show("hud", false);
  show("playControls", false);
  show("tapHint", false);
  renderSetup();
  useWorld(S.game).then((w) => {
    if (!w) return;
    S.world = w;
  });
}

function setupSettings() {
  const g = getSettings().games[S.game];
  return { game: S.game, difficulty: g.difficulty, length: g.length, clock: g.clock };
}

/* ---- starting a match ---- */

// A start ticket from the API, which is what lets a match go on the
// leaderboard, and its seed. Null, with the reason, if it does not come.
async function askForTicket(settings) {
  try {
    const t = await Promise.race([
      api.start(settings),
      new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), TICKET_MS)),
    ]);
    return { ticket: { id: t.game_id, seed: t.seed }, reason: null };
  } catch (err) {
    const reason = err.code === "not_configured" ? "The leaderboard is not set up on this copy of the site." : err.code === "offline" ? "Started offline." : "The leaderboard could not be reached when it started.";
    return { ticket: null, reason };
  }
}

export async function startMatch({ mode = "bot", names = null, seed = null, settings = setupSettings(), party = null, mine = null } = {}) {
  if (S.starting) return;
  S.starting = true;
  unlockAudio();
  leaveMatch();
  S.game = settings.game;
  const world = await useWorld(S.game);
  if (!world) {
    S.starting = false;
    show("noWebgl", true);
    return;
  }
  S.world = world;
  S.controls = createControls(S.game, world);

  let chosen = cleanSeed(seed);
  S.chosenSeed = Boolean(chosen) && mode === "bot";
  S.ticket = null;
  S.unscored = null;
  if (mode !== "bot") S.unscored = "Matches with a friend are not added to the leaderboard.";
  else if (chosen) S.unscored = "Matches on a chosen seed are not added to the leaderboard.";
  else {
    $("playBotBtn").disabled = true;
    const out = await askForTicket(settings);
    $("playBotBtn").disabled = false;
    S.ticket = out.ticket;
    chosen = out.ticket?.seed ?? null;
    S.unscored = out.reason;
  }
  const matchSeed = chosen ?? newSeed();

  S.party = party;
  S.mine = mine ?? (mode === "local" ? [true, true] : [true, false]);
  S.names = names ?? (mode === "bot" ? [getSettings().name ?? "You", "Bot"] : ["Player 1", "Player 2"]);
  S.match = newMatch(matchSeed, { ...settings, mode });
  advance(S.match);
  S.record = { v: RULES_VERSION, game: S.game, mode, seed: matchSeed, difficulty: settings.difficulty, length: settings.length, clock: settings.clock, shots: [] };
  if (mode !== "bot") S.record.names = [...S.names];
  S.t = 0;
  S.paused = false;
  S.ownTurn = -1;
  S.announced = { release: -1, impact: -1 };
  S.keepPreview = null;
  S.submitted = false;
  S.finishing = null;
  S.shared = null;
  S.remoteLive = null;
  S.screen = "playing";
  replay.clear();
  sheets(null);
  show("hud", true);
  show("playControls", true);
  show("pauseVeil", false);
  $("restartBtn").classList.toggle("hidden", mode === "party");
  S.starting = false;
}

// A network match, started by js/party.js with the host's seed and
// settings. `me` is this device's player.
export function startNetworkMatch({ seed, settings, names, me, hooks }) {
  return startMatch({ mode: "party", seed, settings, names, party: hooks, mine: [me === 0, me === 1] });
}

function leaveMatch() {
  if (S.screen === "playing" && S.match && !S.match.over && S.party) S.party.leave?.();
  S.match = S.screen === "playing" ? null : S.match;
  S.paused = false;
  show("pauseVeil", false);
  show("callout", false);
  setWind(0);
  setRain(0);
}

/* ---- the turn showing ---- */

// The turn on screen at game time t, and how far through it.
function frameOf(state, t) {
  const pend = state.next;
  let turn = null;
  if (pend && t >= pend.start) turn = pend;
  else {
    const k = turnAt(state, t);
    turn = k >= 0 ? state.turns[k] : pend;
  }
  if (!turn) return { turn: null, phase: "over", since: 0 };
  if (t < turn.aimStart) return { turn, phase: "intro", since: t - turn.start };
  if (turn.release === undefined) {
    // The keeper's turn: the bot's kick flies before the dive is sent.
    if (turn.input === "keep" && S.keepPreview && t >= turn.aimStart + turn.cond.kickMs) {
      return { turn, phase: "flight", since: t - turn.aimStart - turn.cond.kickMs };
    }
    return { turn, phase: "aim", since: t - turn.aimStart };
  }
  if (t < turn.release) return { turn, phase: "aim", since: t - turn.aimStart };
  if (t < turn.impact) return { turn, phase: "flight", since: t - turn.release };
  return { turn, phase: "settle", since: t - turn.impact };
}

const ctxFor = (state, turn) => ({ seedNum: state.seedNum, i: turn.i, settings: state.settings, sway });

function ownsPending(turn) {
  if (!turn || turn !== S.match?.next || !turn.input) return false;
  const who = turn.input === "keep" ? turn.keeper : turn.player;
  return S.mine[who];
}

/* ---- playing a shot ---- */

function commit(shot) {
  const state = S.match;
  const turn = state.next;
  if (!turn || !shot) return;
  // Over the network the host plays every shot; a guest sends its own.
  if (S.party?.role === "guest") {
    S.party.sendShot(turn.i, shot);
    S.controls.begin(turn);
    S.ownTurn = turn.i;
    S.sentShot = turn.i;
    return;
  }
  const out = feed(state, shot);
  if (out.error) {
    S.controls.begin(turn);
    return;
  }
  S.record.shots.push(shot);
  S.keepPreview = null;
  S.party?.changed?.();
}

// A shot from the other device, for the host to play.
export function remoteShot(i, shot) {
  const turn = S.match?.next;
  if (!turn || turn.i !== i || ownsPending(turn)) return;
  const out = feed(S.match, shot);
  if (out.error) return;
  S.record.shots.push(shot);
  S.remoteLive = null;
  S.party?.changed?.();
}

export function remoteLive(i, live) {
  const turn = S.match?.next;
  if (!turn || turn.i !== i) return;
  S.remoteLive = cleanShared(S.game, live);
}

// What the host sends: the whole record so far, and where its clock is.
export function snapshot() {
  if (!S.record) return null;
  const turn = S.match?.next;
  const live = turn && ownsPending(turn) ? shareable(S.game, S.controls?.live) : null;
  return { record: S.record, t: Math.round(S.t), live, i: turn?.i ?? -1, over: Boolean(S.match?.over) };
}

// What a guest does with it.
export function applySnapshot(snap, ageMs = 0) {
  if (!S.match || !snap?.record) return;
  if (snap.record.shots.length !== S.record.shots.length) {
    const run = runRecord(snap.record, { partial: true });
    if (run.error) return;
    S.match = run.state;
    S.record = snap.record;
    if (S.sentShot !== undefined && S.match.turns[S.sentShot]) S.sentShot = undefined;
  }
  // Follow the host's clock, smoothing small differences away.
  const target = snap.t + ageMs;
  const gap = target - S.t;
  S.t += Math.abs(gap) > 400 ? gap : gap * 0.2;
  S.remoteLive = snap.live && snap.i === S.match.next?.i ? cleanShared(S.game, snap.live) : null;
}

export function myLive() {
  const turn = S.match?.next;
  return turn && ownsPending(turn) ? { i: turn.i, live: shareable(S.game, S.controls?.live) } : null;
}

/* ---- the pointer and the keys ---- */

function pointOf(e) {
  return { x: e.clientX, y: e.clientY };
}

function aimMsNow() {
  const turn = S.match?.next;
  return turn ? Math.round(S.t - turn.aimStart) : -1;
}

function canAim() {
  if (S.screen !== "playing" || S.paused || !S.match || S.match.over) return false;
  const turn = S.match.next;
  if (!ownsPending(turn) || S.sentShot === turn.i) return false;
  return S.t >= turn.aimStart;
}

function onDown(e) {
  unlockAudio();
  if (!canAim()) return;
  e.preventDefault();
  try {
    e.target.setPointerCapture(e.pointerId);
  } catch {
    // Some pointers cannot be captured; the game still plays.
  }
  const shot = S.controls.down(pointOf(e), aimMsNow(), S.match.next);
  if (shot) commit(shot);
}

function onMove(e) {
  if (!canAim()) return;
  e.preventDefault();
  S.controls.move(pointOf(e), aimMsNow(), S.match.next);
}

function onUp(e) {
  if (!canAim()) return;
  e.preventDefault();
  const shot = S.controls.up(pointOf(e), aimMsNow(), S.match.next);
  if (shot) commit(shot);
}

function onKey(e) {
  if (e.target.closest?.("input, textarea") || document.querySelector(".modal-backdrop:not(.hidden)")) return;
  if (S.screen === "result" || S.screen === "shared") {
    if (e.type !== "keydown") return;
    if (e.key === " ") {
      e.preventDefault();
      replay.toggle();
    } else if (e.key === "ArrowLeft") replay.stepBack();
    else if (e.key === "ArrowRight") replay.stepForward();
    return;
  }
  if (S.screen !== "playing") return;
  if (e.type === "keydown" && (e.key === "p" || e.key === "P") && !S.party) {
    setPaused(!S.paused);
    return;
  }
  if (!canAim()) return;
  const shot = S.controls.key(e, aimMsNow(), S.match.next);
  if (shot) commit(shot);
}

function setPaused(on) {
  if (S.party) return;
  S.paused = on;
  show("pauseVeil", on);
  if (on) S.controls?.cancel();
}

/* ---- the frame ---- */

function nameOf(p) {
  return S.names[p] ?? `Player ${p + 1}`;
}

const possessive = (name) => (name === "You" ? "Your" : /s$/i.test(name) ? `${name}'` : `${name}'s`);

function describeTurn(state, turn, t) {
  const who = nameOf(turn.player);
  if (!turn.result || t < turn.impact) {
    const wet = turn.cond.wet ? ` ${turn.cond.weather.label}, slippery.` : "";
    return `${who}: ${turn.label}. Wind ${turn.cond.wind.speed.toFixed(1)} m/s, heart ${turn.cond.bpm} a minute.${wet}`;
  }
  return `${who}: ${turn.result.label}.`;
}

function endLine(state) {
  const r = resultFor(state, 0);
  const board = state.turns.at(-1)?.board;
  const scores = board ? `${board.scores[0]} to ${board.scores[1]}` : "";
  if (state.over?.by === "quit") return "Stopped part way.";
  if (r === "draw") return `A draw, ${scores}.`;
  const winner = nameOf(state.over.winner);
  return `${winner} won, ${scores}${state.over.detail ? `, ${state.over.detail}` : ""}.`;
}

// The big word for a shot that has just landed.
function calloutFor(turn) {
  const r = turn.result;
  switch (S.game) {
    case "archery":
      return r.none ? ["Out of time", false] : r.x ? ["X", true] : r.ring ? [String(r.ring), r.ring >= 9] : ["Miss", false];
    case "darts":
      return r.bust ? ["Bust", false] : r.out ? ["Game shot", true] : [r.bed.label === "Off the board" ? "Miss" : r.bed.label, r.value >= 40];
    case "hoops":
      return r.none ? ["Out of time", false] : r.made ? [r.swish ? "Swish" : "Good", true] : ["Miss", false];
    case "kicks":
      return [r.label, r.goal];
  }
  return ["", false];
}

function soundsAt(turn, t, from) {
  if (turn.release !== undefined && from < turn.release && t >= turn.release && !turn.result?.none) {
    if (S.game === "archery") {
      twang(1);
      play("arrowWhoosh", { volume: 0.7, delay: 0.05 });
    } else if (S.game === "darts") play("whoosh", { volume: 0.5, rate: 1.4 });
    else if (S.game === "hoops") play("whoosh", { volume: 0.35 });
    else if (S.game === "kicks") play("kick", { volume: 0.9 });
    if (ownsPending(turn) || S.mine[turn.player]) buzz(12);
  }
  if (turn.impact !== undefined && from < turn.impact && t >= turn.impact) {
    const r = turn.result;
    if (S.game === "archery" && !r.none) {
      play("arrowHit", { volume: r.stuck === "ground" ? 0.4 : 1, rate: r.stuck === "ground" ? 0.8 : 1 });
      if (r.ring >= 9) play("cheer", { volume: 0.35 });
    } else if (S.game === "darts") {
      play("dartHit", { volume: 0.9 });
      if (r.out) play("cheer", { volume: 0.6, delay: 0.1 });
      else if (r.bust) play("aww", { volume: 0.5 });
    } else if (S.game === "hoops" && !r.none) {
      if (r.made) play("swish", { volume: 0.9 });
      if (r.rims) play("rim", { volume: 0.8 });
      if (r.made && r.points >= 3) play("cheer", { volume: 0.45, delay: 0.15 });
      else if (!r.made) play("aww", { volume: 0.35, delay: 0.2 });
    } else if (S.game === "kicks") {
      if (r.post) play("post", { volume: 0.9 });
      if (r.goal) play("goalCheer", { volume: 0.7 });
      else if (r.saved) play("aww", { volume: 0.5 });
      else play("aww", { volume: 0.4 });
    }
    buzz(r.goal || r.made || r.out || r.ring >= 9 ? [20, 40, 20] : 25);
    const [text, good] = calloutFor(turn);
    if (text) {
      const el = $("callout");
      el.textContent = text;
      el.classList.toggle("good", good);
      el.classList.remove("hidden");
      el.style.animation = "none";
      void el.offsetWidth;
      el.style.animation = "";
      S.callout = performance.now() + 1100;
    }
  }
  // A bounce on the court for a missed shot coming down.
  if (S.game === "hoops" && turn.result && !turn.result.none && from < turn.impact + 350 && t >= turn.impact + 350 && !turn.result.made) {
    play("bounce", { volume: 0.5 });
  }
  if (S.game === "kicks" && turn.input === "keep" && turn.release !== undefined && from < turn.aimStart + 200 && t >= turn.aimStart + 200) {
    play("whistle", { volume: 0.5 });
  }
}

function hudText(id, text) {
  const el = $(id);
  if (el.textContent !== text) el.textContent = text;
}

function updateHud(state, frame, t) {
  const board = boardAt(state, t);
  const { turn, phase } = frame;
  hudText("sbMode", `${DIFFICULTIES[state.settings.difficulty].label}, ${lengthLabel(S.game, state.settings.length)}`);
  hudText("sbName0", nameOf(0));
  hudText("sbName1", nameOf(1));
  hudText("sbScore0", String(board.scores[0]));
  hudText("sbScore1", String(board.scores[1]));
  $("sbLeft").classList.toggle("up", turn?.player === 0 && phase !== "over");
  $("sbRight").classList.toggle("up", turn?.player === 1 && phase !== "over");

  let banner = "";
  if (turn && phase !== "over" && !(state.over && t >= state.over.at)) {
    const live = S.screen === "playing";
    const local = state.settings.mode === "local";
    const keeping = turn.input === "keep";
    const who = keeping ? turn.keeper : turn.player;
    const mine = live && !local && S.mine[who];
    if (keeping) banner = mine ? "You in goal" : `${nameOf(who)} in goal`;
    else if (live && local && phase === "intro") banner = `${nameOf(who)} to shoot`;
    else banner = mine ? "Your turn" : `${possessive(nameOf(who))} turn`;
  }
  hudText("turnBanner", banner);

  const cond = turn?.cond;
  if (cond) {
    hudText("windText", `Wind ${cond.wind.speed.toFixed(1)} m/s`);
    $("windArrow").style.setProperty("--wind-deg", `${windDegrees(cond.wind)}deg`);
    hudText("nerveText", `${cond.bpm} bpm`);
    $("nerveChip").style.setProperty("--bpm", String(cond.bpm));
    $("nerveChip").classList.toggle("high", cond.pressure >= 0.6);
    $("windChip").classList.remove("hidden");
    $("nerveChip").classList.remove("hidden");
    hudText("roundChip", turn.label);
    // The rain, and what it does: the surfaces are slippery.
    const w = cond.weather;
    const wet = Boolean(cond.wet);
    $("weatherChip").classList.toggle("hidden", !wet);
    if (wet) {
      const storm = w.kind === "storm";
      hudText("weatherText", storm ? "Storm, slippery" : "Rain, slippery");
      $("weatherChip").classList.toggle("storm", storm);
      const icon = $("weatherIcon");
      if (icon.getAttribute("data-icon") !== (storm ? "storm" : "rain")) {
        icon.setAttribute("data-icon", storm ? "storm" : "rain");
        hydrateIcons($("weatherChip"));
      }
      $("weatherChip").title = `${w.label}: the ball skids, hands slip and nerves rise`;
    }
  } else {
    $("windChip").classList.add("hidden");
    $("nerveChip").classList.add("hidden");
    $("weatherChip").classList.add("hidden");
    hudText("roundChip", "");
  }

  // The shot clock, counting down through a person's aim.
  const clock = state.settings.clock;
  let clockText = "";
  if (clock && turn && turn.input && turn.input !== "keep" && phase === "aim" && turn.release === undefined) {
    const left = Math.max(0, clock * 1000 - (t - turn.aimStart));
    clockText = `${(left / 1000).toFixed(1)} s`;
    $("clockChip").classList.toggle("warn", left < 1500);
  } else $("clockChip").classList.remove("warn");
  hudText("clockChip", clockText);

  renderTally(state, turn, t);
}

function renderTally(state, turn, t) {
  const el = $("tally");
  if (!turn) {
    if (el.innerHTML) el.innerHTML = "";
    return;
  }
  const items = [];
  for (const done of state.turns) {
    if (done.impact > t) break;
    const same = S.game === "darts" ? done.round === turn.round && done.player === turn.player : S.game === "kicks" ? true : done.round === turn.round;
    if (!same) continue;
    const r = done.result;
    let text;
    if (S.game === "archery") text = r.none ? "-" : r.x ? "X" : r.ring ? String(r.ring) : "M";
    else if (S.game === "darts") text = r.bust ? "Bust" : r.bed.label === "Off the board" || r.bed.ring === "miss" ? "0" : r.bed.label;
    else if (S.game === "hoops") text = r.made ? String(r.points) : "0";
    else text = r.goal ? "Goal" : r.saved ? "Saved" : "Miss";
    items.push(`<li class="p${done.player}">${escapeHtml(text)}</li>`);
  }
  const html = (S.game === "kicks" ? items.slice(-10) : items).join("");
  if (el.innerHTML !== html) el.innerHTML = html;
}

function hint(state, frame) {
  const { turn, phase } = frame;
  if (S.screen !== "playing" || !turn || turn !== state.next || !ownsPending(turn) || phase !== "aim") return "";
  if (S.sentShot === turn.i) return "";
  if (turn.input === "keep") return S.controls.keepHint;
  // Only until the first shot of the match.
  return state.turns.some((d) => S.mine[d.player] && d.human) ? "" : S.controls.hint;
}

// The ink canvas follows the window, at the device's pixel density.
const ink = $("ink");
const inkCtx = ink.getContext("2d");
let inkShown = true;
function setInk(on) {
  if (on === inkShown) return;
  inkShown = on;
  ink.style.visibility = on ? "visible" : "hidden";
}

function sizeInk() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ink.width = Math.round(window.innerWidth * dpr);
  ink.height = Math.round(window.innerHeight * dpr);
  inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(100, Math.max(0, now - (S.lastFrame || now)));
  S.lastFrame = now;
  if (performance.now() > S.callout) show("callout", false);

  let state = S.match;
  let t = 0;
  let from = 0;
  if (S.screen === "playing" && state) {
    from = S.t;
    if (!S.paused) S.t += dt;
    t = S.t;
    driveLive(state);
    state = S.match;
  } else if ((S.screen === "result" || S.screen === "shared") && replay.state) {
    state = replay.state;
    const wasPlaying = replay.playing;
    const tick = replay.tick(dt);
    t = tick.to;
    if (wasPlaying && !replay.playing && t >= (state.over?.at ?? 0)) setFolded(false);
    from = tick.jump ? t : tick.from;
  } else {
    inkCtx.clearRect(0, 0, ink.width, ink.height);
    setInk(false);
    setRain(0);
    if (S.world) render({ state: null, t: now, turn: null, phase: "over", since: 0, aim: null });
    return;
  }

  const fr = frameOf(state, t);
  const turn = fr.turn;
  let aim = null;
  if (turn && (fr.phase === "aim" || fr.phase === "intro")) {
    const own = S.screen === "playing" && turn === state.next && ownsPending(turn);
    const other = S.screen === "playing" && turn === state.next && !own ? S.remoteLive : null;
    aim = S.controls.view(turn, Math.max(0, t - turn.aimStart), ctxFor(state, turn), state, own, other);
  }
  const info = { state, t, turn, phase: fr.phase, since: fr.since, aim, preview: turn === state.next ? S.keepPreview : null, dt };

  // Sounds and callouts as moments pass, played forwards only.
  if (t > from) {
    for (let k = Math.max(0, turnAt(state, from) - 1); k < state.turns.length; k++) {
      const done = state.turns[k];
      if (done.start > t) break;
      soundsAt(done, t, from);
    }
  }
  // The heart, heard when it races on a person's own shot.
  if (S.screen === "playing" && turn && turn === state.next && ownsPending(turn) && fr.phase === "aim" && turn.cond.pressure >= 0.45) {
    if (now - S.lastBeat > 60000 / turn.cond.bpm) {
      S.lastBeat = now;
      heartbeat(Math.min(1, turn.cond.pressure));
    }
  }
  setWind(turn ? turn.cond.windRatio : 0);
  // The rain under it all, and each thunderclap as long after its flash
  // as the sound takes to cover the distance.
  const weather = state.weather;
  setRain(weather?.kind === "storm" ? 1 : weather?.kind === "rain" ? 0.55 : 0);
  if (weather?.wet && t > from && t - from < 1000) {
    for (const s of thunderBetween(weather, state.seedNum, from, t)) thunder(s.km);
  }

  updateHud(state, fr, t);
  const h = hint(state, fr);
  hudText("tapHint", h);
  show("tapHint", Boolean(h));

  render(info);
  inkCtx.clearRect(0, 0, ink.width, ink.height);
  // Hidden when it has nothing on it, which also makes sure the cleared
  // canvas never lingers on screen.
  setInk(Boolean(S.world?.ink?.(inkCtx, info)));

  if (S.screen === "playing" && S.match.over && S.t >= S.match.over.at + 200) endMatch();
}

// The person's turn: the shot clock, the keeper's deadline, and the
// keeper's preview of the bot's kick.
function driveLive(state) {
  const turn = state.next;
  if (!turn || !turn.input) return;
  const own = ownsPending(turn);
  if (own && S.ownTurn !== turn.i) {
    S.ownTurn = turn.i;
    S.controls.begin(turn);
    S.keepPreview = turn.input === "keep" ? preview(state, [-1, 0, 0]) : null;
  }
  if (!own || S.sentShot === turn.i) {
    // The other device's keeper turn still shows the kick coming.
    if (turn.input === "keep" && !S.keepPreview) S.keepPreview = preview(state, [-1, 0, 0]);
    // The host referees a guest who has gone quiet past the shot clock:
    // the shot goes where their hands were last seen.
    const clock = state.settings.clock;
    if (S.party?.role === "host" && !own && clock && S.t - turn.aimStart > clock * 1000 + 2500) {
      const shot = S.controls.timeout(clock * 1000, S.remoteLive);
      const out = shot ? feed(state, shot) : { error: "none" };
      if (!out.error) {
        S.record.shots.push(shot);
        S.party.changed?.();
      }
    }
    return;
  }
  const ms = S.t - turn.aimStart;
  if (ms < 0) return;
  const clock = state.settings.clock;
  if (turn.input === "keep") {
    const live = S.controls.live;
    if (live?.tap >= 0 && (!S.keepPreview || S.keepPreview.tapAt !== live.tap)) {
      S.keepPreview = preview(state, [live.tap, Math.round(live.x * 1000), Math.round(live.y * 1000)]);
      if (S.keepPreview) S.keepPreview.tapAt = live.tap;
    }
    // Nobody dived: the kick goes in, or not, without them.
    const flight = S.keepPreview ? pathMs(S.keepPreview.path) : 1500;
    if (live?.tap < 0 && ms > turn.cond.kickMs + Math.min(flight, 1400)) commit([-1, 0, 0]);
    return;
  }
  if (clock && ms >= clock * 1000) commit(S.controls.timeout(clock * 1000));
}

/* ---- the end of a match ---- */

function scorable() {
  return Boolean(S.ticket) && S.match?.settings.mode === "bot" && S.match.over?.by === "done";
}

function endMatch() {
  const state = S.match;
  S.screen = "result";
  show("playControls", false);
  show("tapHint", false);
  S.controls?.cancel();
  if (S.ticket) S.finishing = api.finish(S.ticket.id, S.record).catch(() => null);
  S.party?.ended?.();
  showResult(state, { live: true });
}

function showResult(state, { live = false, shared = null } = {}) {
  sheets("result");
  show("hud", true);
  const r = resultFor(state, 0);
  const versus = state.settings.mode === "bot";
  const me = S.mine[1] && !S.mine[0] ? 1 : 0;
  const mine = resultFor(state, me);
  let title;
  if (shared) title = "Replay";
  else if (state.over.by === "quit") title = "Stopped";
  else if (state.settings.mode === "local") title = r === "draw" ? "A draw" : `${nameOf(state.over.winner)} wins`;
  else title = mine === "win" ? "You win" : mine === "draw" ? "A draw" : versus ? "The bot wins" : `${nameOf(1 - me)} wins`;
  $("resultTitle").textContent = title;
  $("resultReason").textContent = endLine(state);

  const score = scoreOf(state, me);
  $("resultScore").textContent = `${fmt(score)} points`;
  const best = live && versus && state.over.by === "done" && saveBest(S.game, score);
  show("newBest", Boolean(best));
  renderBreakdown(state, me);
  $("seedCode").textContent = state.seed;
  $("copySeedLabel").textContent = "Copy";
  $("againLabel").textContent = shared ? "Play this game" : "Play again";
  $("shareLabel").textContent = "Share replay";
  renderScoring(shared);

  replay.load(state);
  setFolded(false);
  $("resultTitle").focus({ preventScroll: true });
  if (getSettings().auto_replay || shared) setTimeout(() => replay.state === state && startReplay(), OVERVIEW_MS);

  if (live && scorable() && getSettings().auto_submit && getSettings().name) submit(getSettings().name);
}

// On a narrow screen the panel would cover the play, so it folds down to
// its title and the replay's controls while the replay runs.
function setFolded(folded) {
  $("result").classList.toggle("folded", folded);
  $("foldBtn").setAttribute("aria-expanded", String(!folded));
  $("foldBtn").setAttribute("aria-label", folded ? "Show the panel" : "Hide the panel");
}

function startReplay() {
  replay.start();
  if (window.innerWidth < 900) setFolded(true);
}

function renderBreakdown(state, p) {
  const pts = pointsAt(state, Infinity)[p];
  const rows = [];
  const mineTurns = state.turns.filter((d) => d.player === p && d.human !== false);
  const s = state.settings;
  rows.push(["Shot points", fmt(pts)]);
  rows.push(["Difficulty", `${DIFFICULTIES[s.difficulty].label}, ${DIFFICULTIES[s.difficulty].percent}%`]);
  rows.push(["Length", `${lengthLabel(S.game, s.length)}, ${LENGTHS[s.length].percent}%`]);
  rows.push(["Shot clock", `${CLOCKS[s.clock].label}, ${CLOCKS[s.clock].percent}%`]);
  const r = resultFor(state, p);
  if (r === "win") rows.push(["Win", "+25%"]);
  if (r === "draw") rows.push(["Draw", "+10%"]);
  const strongest = Math.max(0, ...mineTurns.map((d) => d.cond.wind.speed));
  rows.push(["Strongest wind", `${strongest.toFixed(1)} m/s`]);
  const fastest = Math.max(0, ...mineTurns.map((d) => d.cond.bpm));
  rows.push(["Fastest heart", `${fastest} bpm`]);
  if (state.weather?.wet) rows.push(["Weather", `${state.weather.label}, slippery`]);
  $("breakdown").innerHTML = rows.map(([k, v]) => `<div class="breakdown-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join("");
}

function renderScoring(shared) {
  show("submitted", false);
  $("submitMsg").textContent = "";
  if (shared) {
    show("submitForm", false);
    show("notScored", true);
    $("notScored").textContent = shared.verified
      ? `Checked by the leaderboard${shared.name ? `, played by ${shared.name}` : ""}.`
      : `${shared.name ? `Played by ${shared.name}. ` : ""}Not checked by the leaderboard: the score is worked out from the shots.`;
    return;
  }
  const ok = scorable();
  show("submitForm", ok);
  show("notScored", !ok);
  if (ok) $("nameInput").value = getSettings().name ?? "";
  else $("notScored").textContent = S.match?.over?.by === "quit" ? "Stopped part way, so it is not scored." : S.unscored ?? "Not added to the leaderboard.";
}

async function submit(name) {
  if (S.submitted || !scorable()) return;
  const msg = $("submitMsg");
  $("submitBtn").disabled = true;
  msg.textContent = "Adding...";
  try {
    await S.finishing;
    const out = await api.submit(S.ticket.id, S.record, name);
    S.submitted = true;
    saveSettings({ name: out.name });
    show("submitForm", false);
    show("submitted", true);
    $("submittedText").textContent = `Added as ${out.name}: ${fmt(out.score)} points. Best ${fmt(out.best_score)}, ranked ${out.rank}. Total ${fmt(out.total)} over ${out.matches} matches, ranked ${out.total_rank}.`;
    msg.textContent = "";
  } catch (err) {
    msg.textContent = err.code === "offline" ? "Adding a match needs a connection. Try again once you are back online." : err.message || "That did not go through.";
  } finally {
    $("submitBtn").disabled = false;
  }
}

/* ---- sharing ---- */

function longLink(record) {
  return `${location.origin}/?watch=${packRecord(record)}`;
}

async function shareReplay() {
  const record = replay.state ? S.shared?.record ?? S.record : null;
  if (!record) return;
  const label = $("shareLabel");
  label.textContent = "Making a link...";
  let url = longLink(record);
  try {
    let body;
    if (S.shared?.id) body = null;
    else if (S.ticket && scorable()) {
      await S.finishing;
      body = { game_id: S.ticket.id, name: S.submitted ? getSettings().name : null };
    } else body = { record, name: S.names?.[0] && S.match?.settings.mode === "bot" ? getSettings().name : null, played_at: new Date().toISOString() };
    if (S.shared?.id) url = `${location.origin}/r/${S.shared.id}`;
    else {
      const out = await api.createReplay(body);
      url = `${location.origin}/r/${out.id}`;
    }
  } catch {
    // Offline, or the API would not take it: the long link carries it all.
  }
  const title = `uwuShooty ${GAMES[record.game].label} replay`;
  try {
    if (navigator.share) {
      await navigator.share({ title, url });
      label.textContent = "Share replay";
      return;
    }
  } catch (err) {
    if (err?.name === "AbortError") {
      label.textContent = "Share replay";
      return;
    }
  }
  label.textContent = (await copyText(url)) ? "Link copied" : "Could not copy";
  setTimeout(() => (label.textContent = "Share replay"), 2000);
}

// A replay from a link: the match played back, nothing to submit.
export async function openShared({ record, state, name = null, verified = false, id = null }) {
  leaveMatch();
  S.game = record.game;
  const world = await useWorld(S.game);
  if (!world) {
    show("noWebgl", true);
    return;
  }
  S.world = world;
  S.controls = createControls(S.game, world);
  S.match = state;
  S.record = record;
  S.ticket = null;
  S.names = record.names ?? [name ?? "Player", "Bot"];
  S.mine = [true, false];
  S.shared = { record, name, verified, id };
  S.screen = "shared";
  showResult(state, { shared: S.shared });
}

/* ---- wiring ---- */

// Play the bot from the settings panel, on the typed seed if there is one.
// A seed is used once: the panel forgets it, so the next match is a fresh
// one that can go on the leaderboard.
function startFromSetup() {
  const seed = $("seedInput").value;
  if (seed.trim() && !cleanSeed(seed)) {
    $("seedInput").classList.add("shake");
    setTimeout(() => $("seedInput").classList.remove("shake"), 320);
    return;
  }
  $("seedInput").value = "";
  seedNote();
  startMatch({ mode: "bot", seed });
}

function bindSetup() {
  $("gameGrid").addEventListener("click", (e) => {
    const card = e.target.closest("[data-game]");
    if (card) showSetup(card.dataset.game);
  });
  for (const [group, attr] of [["difficultyPick", "difficulty"], ["lengthPick", "length"], ["clockPick", "clock"]]) {
    $(group).addEventListener("click", (e) => {
      const btn = e.target.closest(`[data-${attr}]`);
      if (!btn) return;
      saveGameSettings(S.game, { [attr]: attr === "clock" ? Number(btn.dataset[attr]) : btn.dataset[attr] });
      renderSetup();
    });
  }
  $("seedInput").addEventListener("input", seedNote);
  $("seedInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") startFromSetup();
  });
  $("playBotBtn").addEventListener("click", startFromSetup);
  $("gamesBtn").addEventListener("click", showMenu);
}

export function initGame({ onFriend }) {
  if (!initStage($("stage"))) show("noWebgl", true);
  setQuality(getSettings().quality);
  setMode(getStoredMode());
  document.addEventListener("uwu:modechange", () => setMode(getStoredMode()));
  onSettings((s) => {
    setQuality(s.quality);
    setMuted(!s.sound);
    syncSound();
  });
  sizeInk();
  window.addEventListener("resize", sizeInk);

  // The stage takes every touch, so aiming never scrolls or refreshes.
  const stage = $("stage");
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", () => S.controls?.cancel());
  for (const type of ["touchstart", "touchmove", "touchend"]) stage.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  stage.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKey);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && S.screen === "playing" && !S.party) setPaused(true);
  });
  $("pauseVeil").addEventListener("click", () => setPaused(false));

  bindSetup();
  replay.init();
  $("playFriendBtn").addEventListener("click", () => onFriend(S.game));
  $("backBtn").addEventListener("click", () => {
    if (S.party) S.party.leave?.();
    showSetup(S.game);
  });
  $("restartBtn").addEventListener("click", () => {
    const s = S.match?.settings;
    if (!s) return;
    const seed = S.chosenSeed ? S.match.seed : null;
    startMatch({ mode: s.mode, names: s.mode === "local" ? S.names : null, seed, settings: { game: s.game, difficulty: s.difficulty, length: s.length, clock: s.clock } });
  });
  $("againBtn").addEventListener("click", () => {
    const st = replay.state;
    if (S.shared && st) {
      startMatch({ mode: "bot", seed: st.seed, settings: { game: st.settings.game, difficulty: st.settings.difficulty, length: st.settings.length, clock: st.settings.clock } });
      return;
    }
    const s = st?.settings ?? setupSettings();
    if (s.mode === "party") {
      S.party?.again?.();
      return;
    }
    startMatch({ mode: s.mode, names: s.mode === "local" ? S.names : null, settings: { game: s.game, difficulty: s.difficulty, length: s.length, clock: s.clock } });
  });
  $("playSeedBtn").addEventListener("click", () => {
    const st = replay.state;
    if (!st) return;
    $("seedInput").value = st.seed;
    S.game = st.settings.game;
    showSetup(S.game);
    seedNote();
  });
  $("copySeedBtn").addEventListener("click", async () => {
    const st = replay.state;
    if (!st) return;
    $("copySeedLabel").textContent = (await copyText(st.seed)) ? "Copied" : "Could not copy";
  });
  $("shareBtn").addEventListener("click", shareReplay);
  $("menuBtn").addEventListener("click", showMenu);
  $("resultBoardBtn").addEventListener("click", () => openLeaderboard(S.game, "best"));
  $("submitForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("nameInput").value.trim();
    if (!name) {
      $("submitMsg").textContent = "Enter a name.";
      return;
    }
    submit(name);
  });
  $("foldBtn").addEventListener("click", () => setFolded(!$("result").classList.contains("folded")));
  $("soundBtn").addEventListener("click", () => {
    unlockAudio();
    saveSettings({ sound: !getSettings().sound });
  });
  syncSound();
  setMuted(!getSettings().sound);
  renderMenu();
  hydrateIcons();
  // The range behind the menu.
  useWorld(S.game).then((w) => {
    if (w && !S.world) S.world = w;
  });
  requestAnimationFrame(frame);
}

function syncSound() {
  const on = getSettings().sound;
  const btn = $("soundBtn");
  btn.setAttribute("aria-pressed", String(on));
  btn.querySelector("[data-icon]").setAttribute("data-icon", on ? "volume" : "volumeOff");
  hydrateIcons(btn);
}

export const busy = () => S.screen === "playing";
