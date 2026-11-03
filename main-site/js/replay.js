// The instant replay: a finished match played back in its own scene, with
// play and pause, a step back or forward one shot at a time, a timeline,
// and 0.5x, 1x, 2x or 4x, the speeds of the word rain game's replay. The
// speed picked last is remembered in this browser.
//
// It holds nothing but a clock over a finished match; js/game.js draws the
// match at whatever moment the clock says, aim and sway and all, so a
// player can see exactly where a shot went wrong.

import { GAMES } from "./rules.js";
import { hydrateIcons, store } from "./ui.js";

const SPEEDS = [0.5, 1, 2, 4];
const SPEED_KEY = "uwushooty.replaySpeed";
// The replay runs on past the end this long, so the last shot settles.
const TAIL_MS = 800;

const $ = (id) => document.getElementById(id);

export function createReplay({ describe }) {
  let state = null;
  let t = 0;
  let playing = false;
  let speed = 1;
  let end = 0;
  let steps = [];
  let jumped = false;
  let label = "";

  function setPlaying(on) {
    playing = on && state !== null;
    const btn = $("rpPlay");
    btn.setAttribute("aria-label", playing ? "Pause replay" : "Play replay");
    btn.title = playing ? "Pause replay" : "Play replay";
    btn.querySelector("[data-icon]").setAttribute("data-icon", playing ? "pause" : "play");
    hydrateIcons(btn);
  }

  function setSpeed(next, { save = true } = {}) {
    if (!SPEEDS.includes(next)) return;
    speed = next;
    if (save) store.set(SPEED_KEY, String(next));
    document.querySelectorAll("#rpSpeed [data-speed]").forEach((el) => {
      el.setAttribute("aria-checked", String(Number(el.dataset.speed) === speed));
    });
  }

  function syncLabel() {
    if (!state) return;
    const turns = state.turns;
    let i = -1;
    for (let k = turns.length - 1; k >= 0; k--) {
      if (turns[k].start <= t) {
        i = k;
        break;
      }
    }
    let text;
    if (state.over && t >= state.over.at) text = describe.end(state);
    else if (i < 0) text = `${GAMES[state.settings.game].label}: the first shot.`;
    else text = describe.turn(state, turns[i], t);
    if (text !== label) {
      label = text;
      $("rpLabel").textContent = text;
    }
    const scrub = $("rpScrub");
    if (Number(scrub.max) !== end) scrub.max = String(end);
    if (document.activeElement !== scrub) scrub.value = String(Math.round(t));
  }

  function seek(ms) {
    t = Math.max(0, Math.min(end, ms));
    jumped = true;
    syncLabel();
  }

  // Each shot is a step: it lands on the moment the shooter begins to aim,
  // so stepping forward shows the aim, the release and where it went.
  function stepForward() {
    setPlaying(false);
    const next = steps.find((s) => s > t + 1);
    seek(next === undefined ? end : next);
  }

  function stepBack() {
    setPlaying(false);
    let prev = 0;
    for (const s of steps) {
      if (s < t - 1) prev = s;
      else break;
    }
    seek(prev);
  }

  function toggle() {
    if (!state) return;
    if (!playing && t >= end) seek(0);
    setPlaying(!playing);
  }

  // A finished match. It shows its end until play is pressed, or until
  // start() if the replay plays by itself.
  function load(finished) {
    state = finished;
    steps = finished.turns.map((turn) => turn.start);
    end = (finished.over?.at ?? finished.t) + TAIL_MS;
    setPlaying(false);
    seek(end);
  }

  function start() {
    seek(0);
    setPlaying(true);
  }

  function clear() {
    state = null;
    setPlaying(false);
  }

  // Moves the clock on by `ms` of real time. Returns where it is, and
  // whether that was a jump rather than playback.
  function tick(ms) {
    const from = t;
    if (playing) {
      t = Math.min(end, t + ms * speed);
      if (t >= end) setPlaying(false);
      syncLabel();
    }
    const out = { from, to: t, jump: jumped };
    jumped = false;
    return out;
  }

  function init() {
    $("rpPlay").addEventListener("click", toggle);
    $("rpBack").addEventListener("click", stepBack);
    $("rpForward").addEventListener("click", stepForward);
    $("rpSpeed").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-speed]");
      if (btn) setSpeed(Number(btn.dataset.speed));
    });
    $("rpScrub").addEventListener("input", (e) => {
      setPlaying(false);
      seek(Number(e.target.value));
    });
    setSpeed(Number(store.get(SPEED_KEY)) || 1, { save: false });
  }

  return {
    init,
    load,
    start,
    clear,
    tick,
    toggle,
    stepBack,
    stepForward,
    get state() {
      return state;
    },
    get t() {
      return t;
    },
    get playing() {
      return playing;
    },
    get speed() {
      return speed;
    },
  };
}
