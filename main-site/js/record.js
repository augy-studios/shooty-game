// A match as it is kept, sent and shared: what js/sim.js needs to play it
// again, and nothing it can work out for itself.
//
// {
//   v: 1,                          the rules it was played by
//                                  (js/rules.js's RULES_VERSION)
//   game: "archery" | "darts" | "hoops" | "kicks",
//   mode: "bot" | "local" | "party",
//   seed: "BXK4-M9TR",
//   difficulty: "easy" | "medium" | "hard",
//   length: "short" | "standard" | "long",
//   clock: 0 | 10 | 5 | 3,         seconds a shot may take, 0 for no limit
//   shots: [[...], ...],           every person's input, in turn order; each
//                                  game's file says what one holds
//   quit: true, end: ms,           present when it was stopped part way
//   names: ["Ana", "Ben"],         present for a match between two people
// }
//
// The score is never part of it. Whoever reads a record works the score out
// again, so a record cannot claim points its shots do not add up to. It
// can still be made up, which is why the leaderboard only takes matches
// the API started, and checks how they were played.
//
// Shared as one URL-safe token, packRecord():
//
//   <v>.<game><mode><difficulty><length>.<clock>.<seed>.<shots>[.q<end>][.n<names>]
//
// with the settings as one letter each, the shots as zigzag varints, each
// shot led by its length, in base64url; end in base 36; names base64url
// UTF-8. A whole match is a few hundred characters.

import {
  RULES_VERSION, GAME_IDS, MODES, DIFFICULTIES, LENGTHS, CLOCKS, MAX_SHOTS, MAX_GAME_MS,
} from "./rules.js";
import { cleanSeed } from "./seed.js";

export const RECORD_VERSION = RULES_VERSION;
const READABLE = [1];

const LETTER = {
  game: { archery: "a", darts: "d", hoops: "h", kicks: "k" },
  mode: { bot: "b", local: "l", party: "p" },
  difficulty: { easy: "e", medium: "m", hard: "h" },
  length: { short: "s", standard: "m", long: "l" },
};
const FROM = Object.fromEntries(Object.entries(LETTER).map(([k, m]) => [k, Object.fromEntries(Object.entries(m).map(([a, b]) => [b, a]))]));

const BIG = 2 ** 31;

function cleanName(value) {
  if (typeof value !== "string") return null;
  const name = Array.from(value.normalize("NFKC").replace(/[\p{C}]/gu, "").replace(/\s+/gu, " ").trim()).slice(0, 20).join("").trim();
  return name || null;
}

// A record from anywhere, a request or a link, checked and in canonical
// form, or null if it is not one.
export function cleanRecord(value) {
  if (!value || typeof value !== "object") return null;
  if (!READABLE.includes(value.v)) return null;
  if (!GAME_IDS.includes(value.game) || !MODES.includes(value.mode)) return null;
  const seed = cleanSeed(value.seed);
  if (!seed) return null;
  if (!Object.hasOwn(DIFFICULTIES, value.difficulty) || !Object.hasOwn(LENGTHS, value.length)) return null;
  if (!Object.hasOwn(CLOCKS, String(value.clock))) return null;
  if (!Array.isArray(value.shots) || value.shots.length > MAX_SHOTS) return null;
  const shots = [];
  for (const s of value.shots) {
    if (!Array.isArray(s) || s.length < 2 || s.length > 6) return null;
    if (!s.every((n) => Number.isInteger(n) && Math.abs(n) < BIG)) return null;
    shots.push([...s]);
  }
  const out = {
    v: value.v,
    game: value.game,
    mode: value.mode,
    seed,
    difficulty: value.difficulty,
    length: value.length,
    clock: Number(value.clock),
    shots,
  };
  if (value.quit === true) {
    if (!Number.isInteger(value.end) || value.end < 0 || value.end > MAX_GAME_MS) return null;
    out.quit = true;
    out.end = value.end;
  }
  if (value.mode !== "bot" && Array.isArray(value.names)) {
    const names = value.names.slice(0, 2).map(cleanName);
    if (names.length === 2 && names.every(Boolean)) out.names = names;
  }
  return out;
}

/* ---- the token ---- */

function toBase64Url(bytes) {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("bad base64");
  const plain = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(plain + "===".slice((plain.length + 3) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// Seven bits to a byte, the high bit set on all but the last byte of each.
function pushVarint(bytes, n) {
  let v = n;
  while (v >= 0x80) {
    bytes.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  bytes.push(v);
}

const zig = (n) => (n >= 0 ? n * 2 : -n * 2 - 1);
const unzig = (n) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

function packShots(shots) {
  const bytes = [];
  for (const s of shots) {
    pushVarint(bytes, s.length);
    for (const n of s) pushVarint(bytes, zig(n));
  }
  return toBase64Url(bytes);
}

function unpackShots(text) {
  const bytes = fromBase64Url(text);
  const out = [];
  let i = 0;
  const read = () => {
    let v = 0;
    let scale = 1;
    for (;;) {
      if (i >= bytes.length) throw new Error("short");
      const b = bytes[i++];
      v += (b & 0x7f) * scale;
      if (!(b & 0x80)) return v;
      scale *= 0x80;
      if (scale > 2 ** 35) throw new Error("long");
    }
  };
  while (i < bytes.length) {
    const len = read();
    if (len < 2 || len > 6) throw new Error("bad shot");
    const s = [];
    for (let k = 0; k < len; k++) s.push(unzig(read()));
    out.push(s);
    if (out.length > MAX_SHOTS) throw new Error("too many");
  }
  return out;
}

const utf8 = (text) => new TextEncoder().encode(text);
const fromUtf8 = (bytes) => new TextDecoder().decode(bytes);

export function packRecord(record) {
  const parts = [
    record.v,
    LETTER.game[record.game] + LETTER.mode[record.mode] + LETTER.difficulty[record.difficulty] + LETTER.length[record.length],
    record.clock,
    record.seed.replace("-", ""),
    packShots(record.shots),
  ];
  if (record.quit) parts.push(`q${record.end.toString(36)}`);
  if (record.names) parts.push(`n${toBase64Url(utf8(record.names.join("\n")))}`);
  return parts.join(".");
}

// A token back into a record, or null.
export function unpackRecord(token) {
  try {
    const parts = String(token ?? "").trim().split(".");
    if (parts.length < 5 || parts.length > 7) return null;
    const [v, letters, clock, seed, shots, ...extra] = parts;
    if (letters.length !== 4 || !/^\d{1,2}$/.test(clock)) return null;
    const record = {
      v: Number(v),
      game: FROM.game[letters[0]],
      mode: FROM.mode[letters[1]],
      difficulty: FROM.difficulty[letters[2]],
      length: FROM.length[letters[3]],
      clock: Number(clock),
      seed,
      shots: unpackShots(shots),
    };
    for (const part of extra) {
      if (part[0] === "q" && /^q[0-9a-z]{1,8}$/.test(part)) {
        record.quit = true;
        record.end = parseInt(part.slice(1), 36);
      } else if (part[0] === "n") {
        record.names = fromUtf8(fromBase64Url(part.slice(1))).split("\n");
      } else return null;
    }
    return cleanRecord(record);
  } catch {
    return null;
  }
}
