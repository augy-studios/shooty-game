// Seeds, and the random numbers everything in a match draws from.
//
// Pure: no DOM and no clock. The API imports this file too, so a seed means
// the same match on the server as in a browser. Every number comes from
// Math.imul and shifts, never Math.random, so no two JavaScript engines can
// disagree about one.
//
// A seed looks like "BXK4-M9TR". It decides the wind for every shot, the
// bot's every shot, the player's sway and nerves, where Hoops shoots from
// and how far away the Archery target stands.

// Exactly rounded, so the same everywhere.
const SQRT3 = Math.sqrt(3);

const ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ23456789";
const LENGTH = 8;

// A fresh seed. crypto.getRandomValues exists in browsers and in Node 19+.
export function newSeed() {
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < LENGTH) {
    const [byte] = globalThis.crypto.getRandomValues(new Uint8Array(1));
    if (byte < limit) out += ALPHABET[byte % ALPHABET.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

// The canonical form of a typed or linked seed, or null.
export function cleanSeed(value) {
  const raw = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== LENGTH || ![...raw].every((c) => ALPHABET.includes(c))) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

// FNV-1a over the seed's characters: one 32-bit number per seed.
export function seedNumber(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Two numbers in, one well mixed unsigned 32-bit number out (murmur3's
// finaliser over a golden ratio step).
export function mix(a, b) {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// What each draw is for, so two purposes never share a number.
export const SALT = {
  windDir: 1,
  windSpeed: 2,
  swayPhase: 3,
  swayFreq: 4,
  botAim: 5,
  botTime: 6,
  release: 7,
  spot: 8,
  keeper: 9,
  drift: 10,
  look: 11,
};

// 0 to n - 1, the same for the same seed, turn and purpose.
export function draw(seedNum, turn, salt, n) {
  return mix(mix(seedNum, turn), salt) % n;
}

// [0, 1), from the top 32 bits only, so it is exact.
export function unit(seedNum, turn, salt, k = 0) {
  return mix(mix(mix(seedNum, turn), salt), k) / 4294967296;
}

// Roughly normal, mean 0 and spread 1: four uniforms summed (Irwin-Hall),
// which stays within plus or minus 3.5 and needs nothing but adding.
export function gauss(seedNum, turn, salt, k = 0) {
  let s = 0;
  for (let i = 0; i < 4; i++) s += unit(seedNum, turn, salt, k * 4 + i);
  return (s - 2) * SQRT3;
}
