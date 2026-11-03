// The settings a match can be played under, the timing every turn shares,
// and how a match is scored. Each game's own numbers (distances, speeds,
// how far the wind blows things, how good the bot is) live in its
// js/sim-<game>.js.
//
// Pure, no DOM. The API imports this file, so a change here changes how
// submitted matches are scored: bump RULES_VERSION for anything that alters
// how a recorded match plays or scores.

export const RULES_VERSION = 1;

export const GAME_IDS = ["archery", "darts", "hoops", "kicks"];

// `lengths` is what Short, Standard and Long mean in each game.
export const GAMES = {
  archery: {
    label: "Archery",
    lead: "Press, drag to aim and let go. Mind the wind, and hold steady when it counts. The most points after the last round wins.",
    lengths: { short: 3, standard: 5, long: 7 },
    lengthUnit: "rounds",
  },
  darts: {
    label: "Darts",
    lead: "Tap to stop the side to side sweep, tap again to stop the up and down one. Count down to zero; the last dart has to land the exact score.",
    lengths: { short: 101, standard: 301, long: 501 },
    lengthUnit: "",
  },
  hoops: {
    label: "Hoops",
    lead: "Press, pull back and let go. Shoot from five spots round the arc, further out every round. A clean swish is worth one more.",
    lengths: { short: 2, standard: 3, long: 4 },
    lengthUnit: "rounds",
  },
  kicks: {
    label: "Kicks",
    lead: "Drag from the ball to where you want it and flick: a faster flick hits harder, a curved drag bends it. Then pick a side and dive.",
    lengths: { short: 3, standard: 5, long: 7 },
    lengthUnit: "kicks each",
  },
};

export const DIFFICULTIES = {
  easy: { label: "Easy", percent: 75 },
  medium: { label: "Medium", percent: 100 },
  hard: { label: "Hard", percent: 150 },
};

export const LENGTHS = {
  short: { label: "Short", percent: 100 },
  standard: { label: "Standard", percent: 115 },
  long: { label: "Long", percent: 130 },
};

// Seconds a shot may take, 0 for no limit, and what each counts on every
// shot.
export const CLOCKS = {
  0: { label: "Off", percent: 100 },
  10: { label: "10 s", percent: 110 },
  5: { label: "5 s", percent: 125 },
  3: { label: "3 s", percent: 150 },
};

// bot: against the computer, and the only mode the leaderboard takes.
// local: two people passing one device. party: two devices on one network.
export const MODES = ["bot", "local", "party"];

export const cleanGame = (v) => (GAME_IDS.includes(v) ? v : "archery");
export const cleanDifficulty = (v) => (Object.hasOwn(DIFFICULTIES, v) ? v : "medium");
export const cleanLength = (v) => (Object.hasOwn(LENGTHS, v) ? v : "standard");
export const cleanClock = (v) => (Object.hasOwn(CLOCKS, String(v)) ? Number(v) : 0);
export const cleanMode = (v) => (MODES.includes(v) ? v : "bot");

/* ---- timing ---- */

// A turn: the intro (the camera settles, the wind is read out), the aim
// (the player's own time, or the bot's), the flight, and a moment to see
// where it went. Game time, in ms.
export const INTRO_MS = 1100;
// Between two shots by the same player in the same go, such as the second
// and third dart of a visit.
export const INTRO_SAME_MS = 350;
// Two people on one device: time to hand it over when the shooter changes.
export const INTRO_PASS_MS = 2600;
export const SETTLE_MS = 1500;
// A shot clock gives this much more than it says, for the frame the release
// lands in.
export const CLOCK_GRACE_MS = 50;

// Bounds on what a record can hold.
export const MAX_SHOTS = 600;
export const MAX_AIM_MS = 120000;
export const MAX_GAME_MS = 4 * 60 * 60 * 1000;

/* ---- nerves ---- */

// How much a player's hands shake, as a multiple of the steady amount, at
// a given pressure (0 calm to 1 the shot that decides the match). Real
// archers' and darts players' tremor roughly doubles to triples under
// competition stress; this goes to 2.6x.
export const nerveFactor = (pressure) => 1 + 1.6 * pressure;

// Heart rate the nerves chip shows, beats a minute.
export const heartRate = (pressure) => Math.round(72 + 70 * pressure);

/* ---- scoring ---- */

export const WIN_PERCENT = 25;
export const DRAW_PERCENT = 10;

// One shot's points. `raw` is the game's own value of the shot (a ring, a
// treble, a basket, a goal), already in whole points. Then, as percentages:
//   the round, 8% more for each round after the first, so a match's score
//     grows as it goes on
//   the shot clock
//   the wind, up to 40% more at the strongest wind this difficulty blows
//   the pressure, up to 30% more on the shot that decides the match
// Integers throughout, floored once at the end.
export function shotPoints(raw, { round, clock, windRatio, pressure }) {
  if (raw <= 0) return 0;
  const roundPct = 100 + 8 * round;
  const clockPct = CLOCKS[clock]?.percent ?? 100;
  const windPct = 100 + Math.floor(40 * Math.min(1, Math.max(0, windRatio)));
  const pressurePct = 100 + Math.floor(30 * Math.min(1, Math.max(0, pressure)));
  return Math.floor((raw * roundPct * clockPct * windPct * pressurePct) / 100000000);
}

// A match's score from its shots' points: the difficulty and the length,
// then a bonus for beating the bot (or drawing).
export function matchScore(sum, { difficulty, length, result }) {
  const base = Math.floor((sum * DIFFICULTIES[difficulty].percent * LENGTHS[length].percent) / 10000);
  const bonus = result === "win" ? WIN_PERCENT : result === "draw" ? DRAW_PERCENT : 0;
  return base + Math.floor((base * bonus) / 100);
}
