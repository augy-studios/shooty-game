// Playing a friend: on one device passed between you, or on two devices on
// the same network, per docs/STUN-p2p-spec.md over js/net.js.
//
// Over the network, one device hosts with a six character code, a link or
// a QR code, and one other joins. The host's device is the referee: it
// plays every shot through js/sim.js, its own and the guest's, and sends
// the guest the whole record so far and where its clock is, 20 times a
// second, which is also how the guest knows the link is alive. The guest
// plays the record through the same sim, so both screens show the same
// match, and sends its shots, and its hands while it aims, to the host.
// The match is the host's game with the host's settings; the seed is new
// for every match.
//
// Messages, all small and all checked on arrival:
//   guest to host   hello { v, name }, shot { i, shot }, live { i, live },
//                   bye
//   host to guest   state { v, phase, match, names, settings, seed, snap },
//                   full, old

import { Host, Guest, generateCode, normaliseCode, isValidCode, CODE_LENGTH, PROTOCOL_VERSION } from "./net.js";
import { qrToSvg } from "./qr.js";
import { newSeed, cleanSeed } from "./seed.js";
import { GAMES, DIFFICULTIES, cleanGame, cleanDifficulty, cleanLength, cleanClock } from "./rules.js";
import { cleanRecord } from "./record.js";
import { getSettings, saveSettings } from "./settings.js";
import { copyText, escapeHtml, store } from "./ui.js";
import { startMatch, startNetworkMatch, remoteShot, remoteLive, snapshot, applySnapshot, myLive, showSetup, currentGame, busy, toast } from "./game.js";

const HOST_CODE_KEY = "uwushooty.hostCode";
const LAST_CODE_KEY = "uwushooty.lastCode";
const STALE_MS = 2000;

const $ = (id) => document.getElementById(id);

const P = {
  role: null, // null | host | guest
  host: null,
  guest: null,
  code: "",
  status: "idle",
  message: "",
  guestName: null,
  guestId: null,
  phase: "lobby", // lobby | playing | done
  match: 0, // which match this is, counting up
  joined: 0, // guest: the match this device is in
  settings: null,
  seed: null,
  names: ["", ""],
  lastState: 0,
  retriedTaken: false,
};

let beat = null;
let wakeLock = null;

function cleanName(value, fallback) {
  if (typeof value !== "string") return fallback;
  const name = Array.from(value.normalize("NFKC").replace(/[\p{C}]/gu, "").replace(/\s+/gu, " ").trim()).slice(0, 20).join("");
  return name || fallback;
}

const myName = () => getSettings().name ?? (P.role === "guest" ? "Guest" : "Host");

function show(id, on) {
  $(id).classList.toggle("hidden", !on);
}

/* ---- the lobby ---- */

function describe(settings) {
  if (!settings) return "";
  const g = GAMES[settings.game];
  const len = g.lengths[settings.length];
  return `${g.label}, ${DIFFICULTIES[settings.difficulty].label}, ${len}${g.lengthUnit ? ` ${g.lengthUnit}` : ""}${settings.clock ? `, ${settings.clock} s a shot` : ""}.`;
}

function statusText() {
  if (P.message) return P.message;
  switch (P.status) {
    case "connecting":
      return P.role === "host" ? "Getting a code." : "Connecting.";
    case "waiting":
      return "Waiting for the other device to join.";
    case "connected":
      if (P.role === "host") return P.phase === "playing" ? "Match under way." : `${P.guestName ?? "Your friend"} has joined. Start when you are both ready.`;
      if (P.phase === "playing" && P.joined !== P.match) return "A match is under way. You are in the next one.";
      return P.phase === "done" ? "Match over. Waiting for the host to start the next one." : "Connected. Waiting for the host to start.";
    case "dropped":
      return "The connection to the host dropped.";
    case "unreachable":
      return "Could not reach the other device. Both have to be on the same network: join the same wifi, or turn on a hotspot on one and join it from the other. Check the code is still the one on screen.";
    case "stale":
      return "The connection looks stale. Waiting to hear from the host.";
    default:
      return "";
  }
}

function render() {
  const inLobby = !busy();
  const hosting = P.role === "host";
  show("partyHost", hosting);
  const seats = [];
  if (P.role) {
    seats.push({ name: hosting ? myName() : P.names[0] || "Host", me: hosting, here: true });
    const guestHere = hosting ? P.host?.links.size > 0 : P.status === "connected";
    seats.push({ name: hosting ? P.guestName ?? "Waiting for a player" : myName(), me: !hosting, here: guestHere });
  }
  $("seatList").innerHTML = seats
    .map((s) => `<li class="seat${s.me ? " me" : ""}${s.here ? "" : " out"}"><span class="seat-name">${escapeHtml(s.name)}</span><span class="seat-state">${s.me ? "You" : s.here ? "Here" : ""}</span></li>`)
    .join("");
  show("seatList", Boolean(P.role));
  $("partySettings").textContent = describe(hosting ? hostSettings() : P.settings);
  show("partySettings", Boolean(P.role) && Boolean(hosting ? hostSettings() : P.settings));
  const status = $("partyStatus");
  status.textContent = statusText();
  status.classList.toggle("error", ["error", "unreachable", "dropped"].includes(P.status));
  show("partyStartBtn", hosting && P.status === "connected" && P.phase !== "playing" && inLobby);
  show("newCodeBtn", hosting && P.phase !== "playing");
  show("partyRetryBtn", P.role === "guest" && ["dropped", "unreachable", "error"].includes(P.status));
  $("partyLeaveLabel").textContent = P.role ? "Leave" : "Cancel";
}

/* ---- wake lock: the screen stays on while connected ---- */

async function holdScreen() {
  try {
    if (!wakeLock && "wakeLock" in navigator && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    }
  } catch {
    // Refused or unsupported: the screen may sleep.
  }
}

function releaseScreen() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

/* ---- hosting ---- */

const joinLink = (code) => `${location.origin}/join?id=${code}`;

function hostSettings() {
  const game = currentGame();
  const g = getSettings().games[game];
  return { game, difficulty: g.difficulty, length: g.length, clock: g.clock };
}

async function startHosting() {
  if (P.host) return;
  const stored = store.get(HOST_CODE_KEY);
  const code = isValidCode(stored) ? normaliseCode(stored) : generateCode();
  store.set(HOST_CODE_KEY, code);
  P.role = "host";
  P.code = code;
  P.message = "";
  $("hostCode").textContent = code;
  $("hostQr").innerHTML = qrToSvg(joinLink(code));
  $("copyLinkLabel").textContent = "Copy link";

  const host = new Host({ maxGuests: 1 });
  P.host = host;
  host.addEventListener("status", ({ detail }) => {
    if (host !== P.host) return;
    if (detail.taken && !P.retriedTaken) {
      P.retriedTaken = true;
      newCode();
      return;
    }
    if (detail.status === "waiting") P.retriedTaken = false;
    P.status = detail.status;
    P.message = detail.status === "error" ? detail.message : "";
    render();
  });
  host.addEventListener("join", ({ detail }) => {
    P.guestId = detail.id;
    P.guestName = cleanName(detail.metadata?.name, "Guest");
    render();
  });
  host.addEventListener("leave", () => {
    P.guestId = null;
    render();
  });
  host.addEventListener("message", ({ detail: { message, from } }) => onHostMessage(message, from));
  render();
  holdScreen();
  try {
    await host.start(code);
  } catch {
    P.host = null;
    P.status = "error";
    P.message = "Could not load pairing. Check your connection.";
    render();
  }
  startBeat();
}

function stateMessage() {
  return {
    type: "state",
    v: PROTOCOL_VERSION,
    phase: P.phase,
    match: P.match,
    names: P.names,
    settings: P.settings,
    seed: P.seed,
    snap: P.phase === "lobby" ? null : snapshot(),
    sentAt: Date.now(),
  };
}

function broadcast() {
  if (P.role === "host" && P.host) P.host.send(stateMessage());
}

function onHostMessage(message, from) {
  switch (message.type) {
    case "hello":
      if (message.v !== PROTOCOL_VERSION) {
        P.host.send({ type: "old" }, from);
        return;
      }
      P.guestName = cleanName(message.name, P.guestName ?? "Guest");
      P.host.send(stateMessage(), from);
      render();
      break;
    case "shot":
      if (P.phase !== "playing" || !Array.isArray(message.shot) || message.shot.length > 6) return;
      if (!message.shot.every((n) => Number.isInteger(n) && Math.abs(n) < 2 ** 31)) return;
      remoteShot(Number(message.i), message.shot);
      break;
    case "live":
      if (P.phase === "playing") remoteLive(Number(message.i), message.live);
      break;
    case "bye":
      // Single guest: their code is spent, as the spec says.
      P.guestId = null;
      newCode();
      break;
    default:
      break; // Unknown types are ignored, never thrown on.
  }
}

function newCode() {
  stopHosting();
  store.remove(HOST_CODE_KEY);
  startHosting();
}

function stopHosting() {
  P.host?.close();
  P.host = null;
}

function startAsHost() {
  if (P.role !== "host" || P.status !== "connected") {
    toast("Wait for the other device to join.");
    return;
  }
  P.settings = hostSettings();
  P.seed = newSeed();
  P.match += 1;
  P.phase = "playing";
  P.names = [myName(), P.guestName ?? "Guest"];
  startNetworkMatch({ seed: P.seed, settings: P.settings, names: P.names, me: 0, hooks: hostHooks });
  broadcast();
  render();
}

const hostHooks = {
  role: "host",
  changed: broadcast,
  leave: () => leave(),
  ended() {
    P.phase = "done";
    broadcast();
  },
  again: () => startAsHost(),
};

/* ---- joining ---- */

async function join(input) {
  const code = normaliseCode(input);
  if (!isValidCode(code)) {
    P.status = "error";
    P.message = `A code is ${CODE_LENGTH} characters.`;
    render();
    $("joinInput").classList.add("shake");
    setTimeout(() => $("joinInput").classList.remove("shake"), 320);
    return;
  }
  P.guest?.close();
  P.role = "guest";
  P.code = code;
  P.message = "";
  P.phase = "lobby";
  P.settings = null;
  const guest = new Guest();
  P.guest = guest;
  guest.addEventListener("status", ({ detail }) => {
    if (guest !== P.guest) return;
    P.status = detail.status;
    P.message = detail.status === "error" ? detail.message : "";
    if (detail.status === "connected") {
      P.lastState = performance.now();
      guest.send({ type: "hello", v: PROTOCOL_VERSION, name: myName() });
    }
    render();
  });
  guest.addEventListener("message", ({ detail: { message } }) => onGuestMessage(message));
  sheetsParty();
  render();
  holdScreen();
  try {
    await guest.connect(code, { name: myName() });
    store.set(LAST_CODE_KEY, code);
  } catch {
    P.status = "error";
    P.message = "Could not load pairing. Check your connection.";
    render();
  }
  startBeat();
}

function cleanSettings(s) {
  if (!s || typeof s !== "object") return null;
  return { game: cleanGame(s.game), difficulty: cleanDifficulty(s.difficulty), length: cleanLength(s.length), clock: cleanClock(s.clock) };
}

function onGuestMessage(message) {
  if (message.type === "full") {
    P.status = "error";
    P.message = "Someone is already playing this device.";
    P.guest?.close();
    render();
    return;
  }
  if (message.type === "old") {
    P.status = "error";
    P.message = "The host is on a different version. Reload the page on both devices.";
    render();
    return;
  }
  if (message.type !== "state" || message.v !== PROTOCOL_VERSION) return;
  P.lastState = performance.now();
  if (P.status === "stale") P.status = "connected";
  P.phase = ["lobby", "playing", "done"].includes(message.phase) ? message.phase : "lobby";
  P.match = Number.isInteger(message.match) ? message.match : 0;
  P.settings = cleanSettings(message.settings);
  P.seed = cleanSeed(message.seed);
  P.names = Array.isArray(message.names) ? [cleanName(message.names[0], "Host"), cleanName(message.names[1], "Guest")] : P.names;

  // A new match: join it.
  if (P.phase !== "lobby" && P.match !== P.joined && P.seed && P.settings) {
    P.joined = P.match;
    startNetworkMatch({ seed: P.seed, settings: P.settings, names: P.names, me: 1, hooks: guestHooks }).then(() => follow(message));
  } else if (P.joined === P.match) follow(message);
  render();
}

// The host's record and clock, onto this device's match.
function follow(message) {
  const snap = message.snap;
  if (!snap) return;
  const record = cleanRecord(snap.record);
  if (!record) return;
  const age = Math.max(0, Math.min(500, Date.now() - Number(message.sentAt || Date.now())));
  applySnapshot({ record, t: Number(snap.t) || 0, live: snap.live, i: Number(snap.i) }, Number.isFinite(age) ? age : 0);
}

const guestHooks = {
  role: "guest",
  sendShot(i, shot) {
    P.guest?.send({ type: "shot", i, shot });
  },
  leave: () => leave(),
  ended() {},
  again() {
    toast("The host starts the next match.");
  },
};

/* ---- the beat: 20 a second ---- */

function startBeat() {
  if (beat) return;
  beat = setInterval(() => {
    if (P.role === "host") broadcast();
    if (P.role === "guest") {
      const mine = myLive();
      if (mine) P.guest?.send({ type: "live", ...mine });
      if (P.status === "connected" && performance.now() - P.lastState > STALE_MS) {
        P.status = "stale";
        render();
      }
    }
    if (!P.role) {
      clearInterval(beat);
      beat = null;
    }
  }, 50);
}

/* ---- leaving ---- */

function leave() {
  if (P.role === "guest") {
    P.guest?.leave();
    store.remove(LAST_CODE_KEY);
  }
  if (P.role === "host") stopHosting();
  P.guest = null;
  P.role = null;
  P.status = "idle";
  P.message = "";
  P.phase = "lobby";
  P.joined = 0;
  P.guestName = null;
  releaseScreen();
  render();
}

/* ---- the sheets ---- */

function sheets(which) {
  for (const id of ["menu", "setup", "friend", "party", "result"]) $(id).classList.toggle("hidden", id !== which);
}

function sheetsParty() {
  sheets("party");
}

export function openFriend(game = currentGame()) {
  if (busy()) {
    toast("Finish this match first.");
    return;
  }
  if (P.role) {
    sheetsParty();
    render();
    return;
  }
  showSetup(game);
  const s = getSettings();
  $("localName0").value = s.local[0] || s.name || "";
  $("localName1").value = s.local[1] || "";
  $("friendTitle").textContent = `Play a friend at ${GAMES[game].label}`;
  sheets("friend");
}

export function initParty({ joinCode = null } = {}) {
  $("friendBtnTray").addEventListener("click", () => openFriend());
  $("friendBackBtn").addEventListener("click", () => showSetup(currentGame()));
  $("localForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const a = cleanName($("localName0").value, "Player 1");
    const b = cleanName($("localName1").value, "Player 2");
    saveSettings({ local: [a, b] });
    const g = getSettings().games[currentGame()];
    startMatch({ mode: "local", names: [a, b], settings: { game: currentGame(), ...g } });
  });
  $("hostBtn").addEventListener("click", () => {
    sheetsParty();
    startHosting();
  });
  $("joinForm").addEventListener("submit", (e) => {
    e.preventDefault();
    join($("joinInput").value);
  });
  $("partyStartBtn").addEventListener("click", startAsHost);
  $("newCodeBtn").addEventListener("click", newCode);
  $("partyRetryBtn").addEventListener("click", () => join(P.code));
  $("partyLeaveBtn").addEventListener("click", () => {
    leave();
    showSetup(currentGame());
  });
  $("copyLinkBtn").addEventListener("click", async () => {
    $("copyLinkLabel").textContent = (await copyText(joinLink(P.code))) ? "Link copied" : "Could not copy";
  });

  // Back from the background with a channel that died meanwhile.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (P.role) holdScreen();
    if (P.role === "guest" && P.status === "dropped") join(P.code);
  });

  // A join link, or the code this device used last.
  let remembered = "";
  try {
    remembered = localStorage.getItem(LAST_CODE_KEY) || "";
  } catch {
    // Storage blocked: nothing remembered.
  }
  const initial = normaliseCode(joinCode) || "";
  if (initial) {
    $("joinInput").value = initial;
    join(initial);
  } else if (normaliseCode(remembered)) {
    $("joinInput").value = normaliseCode(remembered);
  }
  render();
}
