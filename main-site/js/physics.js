// Flight, the same in every game: gravity, air resistance and spin, worked
// out in fixed steps so a shot flies the same way live, in the replay, and
// on the server that checks it.
//
// Pure, no DOM, only the exactly rounded operations (see js/fmath.js).
//
// Coordinates are metres, y up, z from the thrower towards the target, x to
// the thrower's right. Wind is air moving sideways and along the range; a
// thing in flight feels drag from its speed through the air, not over the
// ground, which is what makes the wind push it. The push grows with how
// long the thing is in the air and how much it slows down, so a heavy fast
// arrow drifts a little and a slow light ball a lot, as they do outdoors.

export const G = 9.81;
// 240 steps a second. Fine enough that a ball cannot pass through a rim in
// one step at any speed the games throw.
export const DT = 1 / 240;
// A sample every fourth step for the drawing, 60 a second.
export const SAMPLE_EVERY = 4;
export const SAMPLE_MS = (1000 * SAMPLE_EVERY) / 240;

export const body = (x, y, z, vx, vy, vz) => ({ x, y, z, vx, vy, vz });
export const copy = (b) => ({ x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz });

// One step. air: { wx, wz, k, spin }:
//   wx, wz  the wind, m/s
//   k       drag, 0.5 rho Cd A / m, per metre; the acceleration is
//           k |v - w| (v - w)
//   spin    sideways push from spin about the vertical axis, per second;
//           the acceleration is spin x v, which bends the path to the right
//           for a positive spin while the thing moves away from the thrower
export function step(b, air) {
  const rx = b.vx - air.wx;
  const ry = b.vy;
  const rz = b.vz - air.wz;
  const speed = Math.sqrt(rx * rx + ry * ry + rz * rz);
  let ax = -air.k * speed * rx;
  const ay = -G - air.k * speed * ry;
  let az = -air.k * speed * rz;
  if (air.spin) {
    ax += air.spin * b.vz;
    az -= air.spin * b.vx;
  }
  // Semi-implicit Euler: velocity first, then position with the new
  // velocity. Stable at this step size and cheap.
  b.vx += ax * DT;
  b.vy += ay * DT;
  b.vz += az * DT;
  b.x += b.vx * DT;
  b.y += b.vy * DT;
  b.z += b.vz * DT;
}

// A path being written: positions every SAMPLE_EVERY steps, as a flat
// array of x, y, z. Rounded to the millimetre, which is all the drawing
// needs and keeps a replay's memory small.
export function newPath() {
  return { pts: [], steps: 0 };
}

const mm = (v) => Math.round(v * 1000) / 1000;

export function record(path, b, force = false) {
  if (force || path.steps % SAMPLE_EVERY === 0) path.pts.push(mm(b.x), mm(b.y), mm(b.z));
}

// Where a path is at `ms` into it, interpolated between samples.
export function pathAt(pts, ms) {
  const n = pts.length / 3;
  if (n === 0) return null;
  const f = Math.max(0, ms / SAMPLE_MS);
  const i = Math.min(n - 1, Math.floor(f));
  const j = Math.min(n - 1, i + 1);
  const u = Math.min(1, f - i);
  return {
    x: pts[i * 3] + (pts[j * 3] - pts[i * 3]) * u,
    y: pts[i * 3 + 1] + (pts[j * 3 + 1] - pts[i * 3 + 1]) * u,
    z: pts[i * 3 + 2] + (pts[j * 3 + 2] - pts[i * 3 + 2]) * u,
    end: f >= n - 1,
  };
}

export const pathMs = (pts) => Math.max(0, (pts.length / 3 - 1) * SAMPLE_MS);

// Flies b with `air` until it reaches the plane z = zPlane, falls below
// `floor`, or `maxSteps` run out. Returns where it crossed, interpolated
// within the step, and the time it took; ok is false if it never got
// there. b is left where it stopped.
export function toPlane(b, air, zPlane, maxSteps, path = null, floor = -1) {
  for (let n = 1; n <= maxSteps; n++) {
    const px = b.x;
    const py = b.y;
    const pz = b.z;
    step(b, air);
    if (path) {
      path.steps += 1;
      record(path, b);
    }
    if (b.z >= zPlane) {
      const f = (zPlane - pz) / (b.z - pz);
      b.x = px + (b.x - px) * f;
      b.y = py + (b.y - py) * f;
      b.z = zPlane;
      return { x: b.x, y: b.y, t: (n - 1 + f) * DT, ok: true };
    }
    if (b.y < floor) return { x: b.x, y: b.y, t: n * DT, ok: false };
  }
  return { x: b.x, y: b.y, t: maxSteps * DT, ok: false };
}

// The launch velocity, at `speed`, that carries a thing from `from` to the
// point `target` on its z plane in still air: the sight on a bow, the
// thrower's eye. Shoots, sees how far off it landed, aims off by that much,
// and again, which settles within a millimetre in a few goes for anything
// flatter than a lob.
export function solveLaunch(from, target, speed, air, maxSteps) {
  const still = { wx: 0, wz: 0, k: air.k, spin: 0 };
  let ax = target.x;
  let ay = target.y;
  let v = null;
  for (let i = 0; i < 8; i++) {
    const dx = ax - from.x;
    const dy = ay - from.y;
    const dz = target.z - from.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    v = { x: (dx / len) * speed, y: (dy / len) * speed, z: (dz / len) * speed };
    const b = body(from.x, from.y, from.z, v.x, v.y, v.z);
    const hit = toPlane(b, still, target.z, maxSteps);
    const ex = hit.x - target.x;
    const ey = hit.y - target.y;
    if (Math.abs(ex) < 0.0002 && Math.abs(ey) < 0.0002) break;
    ax -= ex;
    ay -= ey;
  }
  return v;
}

// Distance from point p to the segment a-b, and the closest point on it.
export function segmentPoint(px, py, pz, ax, ay, az, bx, by, bz) {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const len2 = ux * ux + uy * uy + uz * uz;
  let t = len2 > 0 ? ((px - ax) * ux + (py - ay) * uy + (pz - az) * uz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + ux * t;
  const cy = ay + uy * t;
  const cz = az + uz * t;
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  return { d: Math.sqrt(dx * dx + dy * dy + dz * dz), cx, cy, cz, t };
}

// Bounces b off a surface with normal n (unit, pointing out of it):
// `bounce` of the speed into it comes back, `grip` of the speed along it
// stays.
export function reflect(b, nx, ny, nz, bounce, grip) {
  const vn = b.vx * nx + b.vy * ny + b.vz * nz;
  if (vn >= 0) return false;
  const tx = b.vx - vn * nx;
  const ty = b.vy - vn * ny;
  const tz = b.vz - vn * nz;
  b.vx = tx * grip - vn * bounce * nx;
  b.vy = ty * grip - vn * bounce * ny;
  b.vz = tz * grip - vn * bounce * nz;
  return true;
}
