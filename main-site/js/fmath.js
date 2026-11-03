// Maths that gives the same answer in every JavaScript engine.
//
// Pure, no DOM. The browser, the replay and the API all fly every shot
// through js/physics.js, and a score only checks out on the server if the
// server's flight lands exactly where the browser's did. +, -, *, / and
// Math.sqrt are exactly rounded by the language, so they agree everywhere;
// Math.sin, Math.cos, Math.atan2, Math.exp and Math.hypot are not, and can
// differ in the last bit between engines, which over a few hundred physics
// steps is enough to move a dart from a treble to a single. So the game
// uses these instead, built from the exact operations only.

export const PI = 3.141592653589793;
export const TAU = 2 * PI;
const HALF_PI = PI / 2;

// sin on [-pi/2, pi/2]: Taylor to the x^19 term, error under 1e-15.
function sinCore(x) {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n <= 9; n++) {
    term *= -x2 / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sum;
}

export function sin(x) {
  // Into [-pi, pi], then folded into [-pi/2, pi/2].
  let a = x - TAU * Math.round(x / TAU);
  if (a > HALF_PI) a = PI - a;
  else if (a < -HALF_PI) a = -PI - a;
  return sinCore(a);
}

export function cos(x) {
  return sin(x + HALF_PI);
}

// atan for |z| <= 1, halving the angle until the series converges fast.
function atanCore(z) {
  // atan(z) = 2 atan(z / (1 + sqrt(1 + z^2))), twice, brings |z| under 0.2.
  let k = 1;
  for (let i = 0; i < 2; i++) {
    z = z / (1 + Math.sqrt(1 + z * z));
    k *= 2;
  }
  const z2 = z * z;
  let term = z;
  let sum = z;
  for (let n = 1; n <= 12; n++) {
    term *= -z2;
    sum += term / (2 * n + 1);
  }
  return k * sum;
}

export function atan2(y, x) {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  let a = ay <= ax ? atanCore(ay / ax) : HALF_PI - atanCore(ax / ay);
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}

export const hypot = (x, y) => Math.sqrt(x * x + y * y);
export const hypot3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const deg = (d) => (d * PI) / 180;
