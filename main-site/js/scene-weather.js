// The weather made visible, for the outdoor worlds: a sky that greys over
// under a deck of dark rain cloud, rain falling and slanting with the
// wind, every drop splashing where it lands and rippling the puddles, a
// bigger splash wherever a ball, an arrow or a diving keeper hits the wet
// ground, lightning, and at night, when the sky is clear, the stars.
//
// It only draws. Whether it rains is the match's (js/sim-shared.js
// weatherFor), and when it flashes is js/weather.js's, so a replay shows
// the same storm.
//
// Rain the way stack-game draws it (its js/rain.js): every drop a streak
// as long as it falls in the moment the eye takes it in, thin and faint,
// gone the instant it lands, where its splash takes over. Each drop's
// whole life is a function of the clock in the vertex shader, so
// thousands cost almost nothing. Drawn to scale:
//   - light rain is drops of about a millimetre falling at about 4 m/s; a
//     thunderstorm's are two to three millimetres, at about 7 m/s
//   - a drop is carried sideways with the air it falls through, so it
//     moves at the wind's speed across and its own speed down, and the
//     rain slants by the angle between them: hardly at all in a breeze,
//     past forty degrees in a gale
//   - where it lands it throws up a crown of droplets for a fifth of a
//     second (a drop hitting water at 5 to 7 m/s does), and on water it
//     sends out rings at about a quarter of a metre a second, the slowest
//     a ripple on water can travel (about 23 cm/s, where surface tension
//     and gravity balance): strong in a puddle, faint on the wet film
//     everywhere else
//   - something heavier, a ball bouncing or a body landing, throws up a
//     spray of droplets on ballistic arcs and sends out larger rings,
//     which travel faster, as longer water waves do (about 0.5 m/s at a
//     wavelength of 15 to 20 cm)
// Low graphics draws the drops but not the splashes and ripples.
//
// Lightning the way stack-game draws it: a jagged bolt made by halving its
// line again and again and pushing each middle sideways, less each time,
// with now and then a fork; a white-hot core in a blue glow, far brighter
// than white, so High's bloom spreads it across the sky.

import { THREE, v3, isHigh, drawingHeight } from "./scene.js";
import { flashAt } from "./weather.js";
import { playSplash } from "./audio.js";

const KINDS = {
  dry: { level: 0, fall: 4, amount: 0 },
  rain: { level: 0.65, fall: 4.2, amount: 0.42 },
  storm: { level: 1, fall: 7, amount: 1 },
};
const DROPS = { high: 5200, low: 1800 };
// Seconds a splash, its crown and its rings, lasts.
const SPLASH = 0.75;
const CROWN = 0.18;
// The streak: as far as the drop falls in this many seconds.
const STREAK_S = 0.04;
// A rain drop is 1 to 3 mm; its streak, drawn, a little wider.
const WIDTH = 0.004;
const RIPPLE_SPEED = 0.24;
const POOLS = 16;

// Overcast skies, day and dusk, for light rain and for a storm, and the
// rain cloud under them, darker than the sky it hangs in.
const OVERCAST = {
  day: { rain: new THREE.Color(0xa7b3bd), storm: new THREE.Color(0x6d7984) },
  dusk: { rain: new THREE.Color(0x27304a), storm: new THREE.Color(0x181d2c) },
};
const RAIN_CLOUD = {
  day: { rain: new THREE.Color(0x77828d), storm: new THREE.Color(0x48525c) },
  dusk: { rain: new THREE.Color(0x1d2334), storm: new THREE.Color(0x10141f) },
};
const FLASH_SKY = new THREE.Color(0xe4e9ff);
const RAIN_GREY = new THREE.Color(0.62, 0.68, 0.76);
const WHITE = new THREE.Color(1, 1, 1);

function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// How wide a pixel is a metre in front of this camera, and the scale that
// turns a size in metres at a depth into pixels.
function pixelsOf(camera) {
  const h = drawingHeight() || 1;
  const t = Math.tan(((camera.fov ?? 50) * Math.PI) / 360);
  return { pixel: (2 * t) / h, scale: h / (2 * t) };
}

/* ---- the drops and their splashes, on the GPU ---- */

const DROP_GLSL = `
  uniform float uTime;
  uniform vec3 uCentre;
  uniform vec3 uHalf;
  uniform float uSpeed;
  uniform vec2 uWind;
  uniform float uAmount;
  attribute vec4 aSeed;
  const float SPLASH = ${SPLASH.toFixed(3)};

  // A drop's life this time round: where it lands (in the box), where it
  // set off from (upwind of that, as far as the wind carries it on the
  // way down), seconds since it set off, and seconds to land.
  void dropState(out vec2 land, out vec2 start, out float age, out float fallT) {
    float top = uCentre.y + uHalf.y;
    fallT = top / uSpeed;
    float period = fallT + SPLASH;
    float local = uTime + aSeed.z * period;
    float cycle = floor(local / period);
    age = local - cycle * period;
    vec2 r = fract(aSeed.xy + cycle * vec2(0.6180340, 0.7548777));
    land = uCentre.xz + (r * 2.0 - 1.0) * uHalf.xz;
    start = land - uWind * fallT;
  }
`;

const STREAK_VERTEX = `
  ${DROP_GLSL}
  uniform float uLength;
  uniform float uWidth;
  uniform float uPixel;
  uniform float uNear;
  varying float vAcross;
  varying float vAlong;
  varying float vAlpha;
  void main() {
    vec2 land, start;
    float age, fallT;
    dropState(land, start, age, fallT);
    vec3 vel = vec3(uWind.x, -uSpeed, uWind.y);
    vec3 dir = normalize(vel);
    float top = uCentre.y + uHalf.y;
    vec2 xz = start + uWind * age;
    vec3 head = vec3(xz.x, top - uSpeed * age, xz.y);
    vec3 tail = head - dir * uLength;
    // Cut off at the ground: the tail follows the head in and is gone.
    head.y = max(head.y, 0.0);
    tail.y = max(tail.y, 0.0);
    vec3 mid = mix(head, tail, position.y);
    vec3 toCam = cameraPosition - mid;
    float dist = length(toCam);
    // Across the streak, facing the camera; for a drop falling straight
    // at the lens there is no across, and normalising nothing would give
    // NaN, which the bloom would smear into a glowing blot.
    vec3 c = cross(dir, toCam);
    float cl = length(c);
    vec3 side = cl > 1e-5 ? c / cl : vec3(1.0, 0.0, 0.0);
    // Never thinner than a pixel and a bit; past that it fades instead,
    // as a far drop does.
    float w = max(uWidth, dist * uPixel * 1.4);
    float shown = step(aSeed.w, uAmount);
    vec2 off = abs(xz - uCentre.xz) / uHalf.xz;
    float edge = 1.0 - smoothstep(0.75, 1.0, max(off.x, off.y));
    float near = smoothstep(uNear * 0.4, uNear, dist);
    vAlpha = shown * edge * near * (uWidth / w) * (0.7 + 0.6 * fract(aSeed.w * 31.7));
    vAcross = position.x * 2.0;
    vAlong = position.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(mid + side * position.x * w, 1.0);
  }
`;

const STREAK_FRAGMENT = `
  uniform vec3 uColour;
  uniform float uOpacity;
  uniform float uFlash;
  varying float vAcross;
  varying float vAlong;
  varying float vAlpha;
  void main() {
    float a = clamp((1.0 - vAcross * vAcross) * (1.0 - 0.75 * vAlong) * vAlpha * uOpacity, 0.0, 1.0);
    if (!(a > 0.002)) discard;
    // Lit up by a flash, but never past white: only the bolt blooms.
    gl_FragColor = vec4(min(uColour * (1.0 + uFlash * 0.8), vec3(0.95)), a);
  }
`;

const SPLASH_VERTEX = `
  ${DROP_GLSL}
  uniform vec4 uPools[${POOLS}];
  uniform vec4 uPaved;
  uniform vec2 uPoolTurn[${POOLS}];
  attribute float aPart;
  attribute vec2 aCorner;
  varying vec2 vUv;
  varying float vS;
  varying float vPart;
  varying float vRand;
  varying float vPool;
  void main() {
    vec2 land, start;
    float age, fallT;
    dropState(land, start, age, fallT);
    float t = age - fallT;
    float s = t / SPLASH;
    float on = step(0.0, s) * step(s, 1.0) * step(aSeed.w, uAmount);
    // In a puddle, or on the wet film over everything else?
    float pool = 0.0;
    for (int i = 0; i < ${POOLS}; i++) {
      vec4 p = uPools[i];
      if (p.z <= 0.0) continue;
      vec2 d = land - p.xy;
      vec2 r = vec2(d.x * uPoolTurn[i].x + d.y * uPoolTurn[i].y, -d.x * uPoolTurn[i].y + d.y * uPoolTurn[i].x);
      if (dot(r / p.zw, r / p.zw) < 1.0) pool = 1.0;
    }
    // Paved ground holds a film of water that ripples faintly; grass soaks
    // it up, so off the puddles a drop on grass only splashes.
    vec2 pv = abs(land - uPaved.xy) - uPaved.zw;
    float paved = max(pv.x, pv.y) < 0.0 ? 0.3 : 0.0;
    pool = max(pool, paved);
    float size = 0.7 + 0.6 * fract(aSeed.w * 13.7);
    vec3 pos;
    if (aPart < 0.5) {
      on *= step(0.01, pool);
      // The rings, spreading at a ripple's speed.
      float r = (0.012 + ${RIPPLE_SPEED.toFixed(3)} * t) * size * 1.25;
      pos = vec3(land.x + aCorner.x * r, 0.022, land.y + aCorner.y * r);
    } else {
      // The crown, stood up to face the camera.
      on *= step(t, ${CROWN.toFixed(3)});
      vec3 base = vec3(land.x, 0.0, land.y);
      vec2 h = normalize(cameraPosition.xz - base.xz + 1e-4);
      vec3 side = vec3(-h.y, 0.0, h.x);
      pos = base + side * aCorner.x * 0.045 * size + vec3(0.0, aCorner.y * 0.06 * size, 0.0);
    }
    vUv = aCorner;
    vS = s;
    vPart = aPart;
    vRand = aSeed.w;
    vPool = pool;
    gl_Position = on > 0.5 ? projectionMatrix * viewMatrix * vec4(pos, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const SPLASH_FRAGMENT = `
  uniform vec3 uColour;
  uniform float uOpacity;
  uniform float uFlash;
  varying vec2 vUv;
  varying float vS;
  varying float vPart;
  varying float vRand;
  varying float vPool;
  float rnd(float x) {
    return fract(sin(x * 12.9898 + vRand * 78.233) * 43758.5453);
  }
  void main() {
    float a = 0.0;
    if (vPart < 0.5) {
      // A ring, and a fainter one inside it once it has spread.
      float d = length(vUv);
      float ro = (d - 0.8) * 9.0;
      float ri = (d - 0.42) * 12.0;
      float ring = exp(-ro * ro);
      float inner = exp(-ri * ri) * smoothstep(0.25, 0.6, vS) * 0.6;
      a = (ring + inner) * (1.0 - vS) * (1.0 - vS) * 0.62 * vPool;
    } else {
      // Droplets thrown up and out on arcs off the crown's rim, falling
      // back as they go, and the drop's own rebound, a little column.
      float k = clamp(vS * ${(SPLASH / CROWN).toFixed(3)}, 0.0, 1.0);
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float r = rnd(fi + 1.0);
        float out_ = (fi - 2.0) * 0.5 * (0.55 + 0.4 * r);
        float up = 0.7 + 0.3 * rnd(fi + 7.0);
        vec2 c = vec2(out_ * k * 0.9, up * 2.2 * k - 2.0 * k * k);
        float rad = 0.11 * (1.0 - 0.45 * k);
        a = max(a, 1.0 - smoothstep(rad * 0.5, rad, length((vUv - c) * vec2(1.0, 1.4))));
      }
      float column = (1.0 - smoothstep(0.03, 0.12, abs(vUv.x))) * (1.0 - smoothstep(0.0, 0.08, vUv.y - 2.0 * k * (1.0 - k)));
      a = max(a, column * (1.0 - k));
      a *= (1.0 - k) * 0.8;
    }
    a = clamp(a * uOpacity, 0.0, 1.0);
    if (!(a > 0.003)) discard;
    gl_FragColor = vec4(min(uColour * (1.0 + uFlash * 0.5), vec3(0.95)), a);
  }
`;

/* ---- lightning ---- */

const BOLT_VERTEX = `
  attribute float aAcross;
  attribute float aLevel;
  varying float vAcross;
  varying float vLevel;
  void main() {
    vAcross = aAcross;
    vLevel = aLevel;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The core is about a fifth of the ribbon; the rest is glow. Up to four
// and a half times brighter than white, which is what the bloom catches.
const BOLT_FRAGMENT = `
  uniform vec3 uCore;
  uniform vec3 uGlow;
  uniform float uBright;
  varying float vAcross;
  varying float vLevel;
  void main() {
    float x = abs(vAcross);
    float core = exp(-x * x * 60.0);
    float glow = exp(-x * x * 4.0);
    vec3 c = (uCore * core * 4.5 + uGlow * glow * 0.45) * vLevel * min(uBright, 1.0);
    gl_FragColor = vec4(c, 1.0);
  }
`;

// A bolt from the clouds at `height` down to 0, in its own x and y.
function boltGeometry(seed, height) {
  const rand = lcg(seed);
  let segs = [{ a: [(rand() - 0.5) * height * 0.12, height], b: [(rand() - 0.5) * height * 0.3, 0], level: 1, width: 1 }];
  let offset = height * 0.16;
  for (let gen = 0; gen < 8; gen++) {
    const next = [];
    for (const s of segs) {
      const dx = s.b[0] - s.a[0];
      const dy = s.b[1] - s.a[1];
      const len = Math.hypot(dx, dy) || 1;
      const push = (rand() * 2 - 1) * offset * Math.sqrt(s.width);
      const mid = [(s.a[0] + s.b[0]) / 2 + (-dy / len) * push, (s.a[1] + s.b[1]) / 2 + (dx / len) * push];
      next.push({ ...s, b: mid }, { ...s, a: mid });
      // Now and then a fork, off at an angle, dimmer and thinner.
      if (gen >= 1 && gen < 6 && rand() < 0.2 * s.width) {
        const turn = (rand() < 0.5 ? -1 : 1) * (0.35 + rand() * 0.55);
        const mx = mid[0] - s.a[0];
        const my = mid[1] - s.a[1];
        const k = 0.8 + rand() * 0.9;
        next.push({ a: mid, b: [mid[0] + (mx * Math.cos(turn) - my * Math.sin(turn)) * k, mid[1] + (mx * Math.sin(turn) + my * Math.cos(turn)) * k], level: s.level * 0.45, width: s.width * 0.5 });
      }
    }
    segs = next;
    offset *= 0.55;
  }
  const core = height * 0.0035;
  const positions = [];
  const across = [];
  const levels = [];
  const index = [];
  for (const s of segs) {
    const dx = s.b[0] - s.a[0];
    const dy = s.b[1] - s.a[1];
    const len = Math.hypot(dx, dy) || 1;
    const half = core * 6 * Math.max(0.45, s.width);
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    const ex = (dx / len) * half * 0.15;
    const ey = (dy / len) * half * 0.15;
    const i = positions.length / 3;
    positions.push(s.a[0] - ex + nx, s.a[1] - ey + ny, 0, s.a[0] - ex - nx, s.a[1] - ey - ny, 0, s.b[0] + ex + nx, s.b[1] + ey + ny, 0, s.b[0] + ex - nx, s.b[1] + ey - ny, 0);
    across.push(1, -1, 1, -1);
    levels.push(s.level, s.level, s.level, s.level);
    index.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("aAcross", new THREE.Float32BufferAttribute(across, 1));
  geo.setAttribute("aLevel", new THREE.Float32BufferAttribute(levels, 1));
  geo.setIndex(index);
  return geo;
}

/* ---- stars ---- */

const STAR_VERTEX = `
  uniform float uTime;
  uniform float uScale;
  attribute float aSize;
  attribute float aPhase;
  varying float vTwinkle;
  void main() {
    // Twinkling: the air between bends a star's light this way and that,
    // more near the horizon, where there is more air to come through.
    float low = 1.0 - clamp(position.y * 3.0, 0.0, 1.0);
    vTwinkle = 1.0 - (0.2 + 0.45 * low) * (0.5 + 0.5 * sin(uTime * (1.3 + aPhase * 4.0) + aPhase * 40.0));
    gl_PointSize = aSize * uScale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const STAR_FRAGMENT = `
  uniform float uOpacity;
  varying float vTwinkle;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.15, 1.0, d)) * vTwinkle * uOpacity;
    if (!(a > 0.01)) discard;
    gl_FragColor = vec4(vec3(1.0, 0.98, 0.94) * (1.0 + 0.4 * (1.0 - d)), a);
  }
`;

/* ---- bigger splashes: droplets and rings, on the CPU ---- */

const DROPLET_VERTEX = `
  uniform float uScale;
  attribute float aSize;
  attribute float aLife;
  varying float vLife;
  void main() {
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aLife > 0.0 ? max(1.5, aSize * uScale / -mv.z) : 0.0;
    gl_Position = projectionMatrix * mv;
  }
`;
const DROPLET_FRAGMENT = `
  uniform vec3 uColour;
  varying float vLife;
  void main() {
    if (vLife <= 0.0) discard;
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    float a = (1.0 - smoothstep(0.55, 1.0, d)) * min(1.0, vLife * 3.0) * 0.85;
    if (!(a > 0.01)) discard;
    // A bead of water: lit from above, a bright spot near its top.
    float hi = 1.0 - smoothstep(0.0, 0.35, length(p - vec2(-0.12, -0.15)));
    gl_FragColor = vec4(min(uColour * (0.85 + 0.5 * hi), vec3(0.95)), a);
  }
`;
const RING_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
// A crest, and the trough just inside it, darker water, fainter.
const RING_FRAGMENT = `
  uniform vec3 uColour;
  uniform float uFade;
  varying vec2 vUv;
  void main() {
    float d = length(vUv * 2.0 - 1.0);
    float x = (d - 0.86) * 14.0;
    float trough = (d - 0.72) * 18.0;
    float a = (exp(-x * x) + 0.45 * exp(-trough * trough)) * uFade;
    if (!(a > 0.004)) discard;
    gl_FragColor = vec4(uColour, a);
  }
`;
const DROPLETS = 480;
const RINGS = 18;

// Where a flight comes down on the ground: every low point of the path at
// the thing's own radius, with how fast it was coming down. pts as
// js/physics.js keeps them, one every sampleMs.
export function groundHits(pts, radius, sampleMs) {
  const out = [];
  const n = pts.length / 3;
  for (let i = 1; i < n; i++) {
    const y = pts[i * 3 + 1];
    const prev = pts[(i - 1) * 3 + 1];
    const next = i + 1 < n ? pts[(i + 1) * 3 + 1] : Infinity;
    if (y <= radius + 0.012 && y <= prev && y < next) {
      const down = ((prev - y) / sampleMs) * 1000;
      if (down > 0.6) out.push({ ms: i * sampleMs, x: pts[i * 3], z: pts[i * 3 + 2], strength: Math.min(1.4, down / 6) });
    }
  }
  return out;
}

// scene: the world's. light: its rig from scene.js lights(). clouds: from
// scene-props.js clouds(). box, centre: where the rain falls, in game
// coordinates (as for scene.js motes). near: how close to the camera a
// drop may show, metres. ground: { w, d, x, z }, the wet ground's extent.
// pools: { w, d, x, z }, where puddles lie, placed with `rand` (the
// world's scenery random) so they are in the same places every time.
// bolt: { z, y, spread, width }, where in the sky lightning comes down: in
// front of the clouds, from above the top of the view; width narrows it
// for a narrow view, such as the archer's sight.
// paved: { w, d, x, z }, hard ground where a film of water ripples, or
// none.
export function weather(scene, { light, clouds, box, centre, near = 1.4, ground, pools = ground, paved = null, bolt, puddles = 10, rand = Math.random }) {
  const half = box.map((b) => b / 2);
  // In three.js coordinates, where x is flipped (see scene.js v3).
  const c3 = new THREE.Vector3(-centre[0], centre[1], centre[2]);

  /* the drops */
  const uniforms = {
    uTime: { value: 0 },
    uCentre: { value: c3 },
    uHalf: { value: new THREE.Vector3(half[0], half[1], half[2]) },
    uSpeed: { value: 4 },
    uWind: { value: new THREE.Vector2() },
    uAmount: { value: 0 },
    uLength: { value: 0.2 },
    uWidth: { value: WIDTH },
    uPixel: { value: 0.001 },
    uNear: { value: near },
    uColour: { value: new THREE.Color(0xdfe8f2) },
    uOpacity: { value: 0.7 },
    uFlash: { value: 0 },
  };
  const poolData = Array.from({ length: POOLS }, () => new THREE.Vector4(0, 0, 0, 0));
  const poolTurn = Array.from({ length: POOLS }, () => new THREE.Vector2(1, 0));
  const splashUniforms = {
    ...uniforms,
    uColour: { value: new THREE.Color(0xeef6ff) },
    uOpacity: { value: 0.7 },
    uPools: { value: poolData },
    uPaved: { value: paved ? new THREE.Vector4(-paved.x, paved.z, paved.w / 2, paved.d / 2) : new THREE.Vector4(0, 0, -1, -1) },
    uPoolTurn: { value: poolTurn },
  };
  const seeds = new Float32Array(DROPS.high * 4);
  const seedRand = lcg(20261103);
  for (let i = 0; i < seeds.length; i++) seeds[i] = seedRand();
  const seedAttr = new THREE.InstancedBufferAttribute(seeds, 4);

  const streakGeo = new THREE.InstancedBufferGeometry();
  streakGeo.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
  streakGeo.setIndex([0, 1, 2, 1, 3, 2]);
  streakGeo.setAttribute("aSeed", seedAttr);
  const streaks = new THREE.Mesh(streakGeo, new THREE.ShaderMaterial({ uniforms, vertexShader: STREAK_VERTEX, fragmentShader: STREAK_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide }));

  const splashGeo = new THREE.InstancedBufferGeometry();
  splashGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Array(24).fill(0), 3));
  splashGeo.setAttribute("aCorner", new THREE.Float32BufferAttribute([-1, -1, 1, -1, -1, 1, 1, 1, -1, 0, 1, 0, -1, 1, 1, 1], 2));
  splashGeo.setAttribute("aPart", new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 1, 1, 1], 1));
  splashGeo.setIndex([0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6]);
  splashGeo.setAttribute("aSeed", seedAttr);
  const splashes = new THREE.Mesh(splashGeo, new THREE.ShaderMaterial({ uniforms: splashUniforms, vertexShader: SPLASH_VERTEX, fragmentShader: SPLASH_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  for (const m of [streaks, splashes]) {
    m.frustumCulled = false;
    m.renderOrder = 4;
    m.visible = false;
    scene.add(m);
  }

  /* the wet ground: darker, with puddles that hold the sky */
  const wet = new THREE.Group();
  wet.visible = false;
  scene.add(wet);
  const sheenMat = new THREE.MeshBasicMaterial({ color: 0x14202c, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const sheen = new THREE.Mesh(new THREE.PlaneGeometry(ground.w, ground.d), sheenMat);
  sheen.rotation.x = -Math.PI / 2;
  sheen.position.copy(v3(ground.x, 0.018, ground.z));
  sheen.renderOrder = 1;
  wet.add(sheen);
  const puddleMat = new THREE.MeshBasicMaterial({ color: 0xb9c7d6, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const puddleGeo = new THREE.CircleGeometry(1, 24);
  puddleGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < Math.min(puddles, POOLS); i++) {
    const p = new THREE.Mesh(puddleGeo, puddleMat);
    const r = 0.18 + rand() * 0.45;
    const sx = r * (1 + rand());
    const turn = rand() * Math.PI;
    p.scale.set(sx, 1, r);
    p.rotation.y = turn;
    p.position.copy(v3(pools.x + (rand() - 0.5) * pools.w, 0.02, pools.z + (rand() - 0.5) * pools.d));
    p.renderOrder = 2;
    wet.add(p);
    // The same ellipse for the shader, in its own frame: a turn about y by
    // `turn` takes local (x, z) to (x cos + z sin, -x sin + z cos).
    poolData[i].set(p.position.x, p.position.z, sx, r);
    poolTurn[i].set(Math.cos(turn), -Math.sin(turn));
  }

  /* the rain cloud: a low deck of dark cloud that comes over with the rain */
  const deckMat = new THREE.MeshBasicMaterial({ color: 0x48525c, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const deck = new THREE.Group();
  const anchor = new THREE.Vector3();
  for (const g of clouds.list) anchor.add(g.position);
  anchor.divideScalar(Math.max(1, clouds.list.length));
  const deckRand = lcg(7177);
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(18 + deckRand() * 30, 3 + deckRand() * 4, 10 + deckRand() * 14), deckMat);
    c.position.set(anchor.x + (deckRand() - 0.5) * 220, anchor.y - 6 + deckRand() * 8, anchor.z - 30 + deckRand() * 80);
    deck.add(c);
  }
  deck.visible = false;
  scene.add(deck);
  // The fair weather clouds stand out against the sky however thick the
  // haze, as clouds do; through the fog they would vanish into it.
  clouds.material.fog = false;
  clouds.material.needsUpdate = true;

  /* the stars */
  const STARS = 1800;
  const starPos = new Float32Array(STARS * 3);
  const starSize = new Float32Array(STARS);
  const starPhase = new Float32Array(STARS);
  const starRand = lcg(424242);
  for (let i = 0; i < STARS; i++) {
    // Evenly over the sky above the horizon.
    const y = 0.03 + 0.97 * starRand();
    const ang = starRand() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    starPos.set([Math.cos(ang) * r, y, Math.sin(ang) * r], i * 3);
    // Most faint, a few bright, as they are.
    starSize[i] = 1.4 + 3 * Math.pow(starRand(), 5);
    starPhase[i] = starRand();
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute("aSize", new THREE.BufferAttribute(starSize, 1));
  starGeo.setAttribute("aPhase", new THREE.BufferAttribute(starPhase, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uOpacity: { value: 0 } },
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  stars.visible = false;
  scene.add(stars);

  /* the bolt */
  const boltMat = new THREE.ShaderMaterial({
    uniforms: { uCore: { value: new THREE.Color(1, 1, 1) }, uGlow: { value: new THREE.Color(0.55, 0.65, 1.0) }, uBright: { value: 0 } },
    vertexShader: BOLT_VERTEX,
    fragmentShader: BOLT_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const boltMesh = new THREE.Mesh(new THREE.BufferGeometry(), boltMat);
  boltMesh.frustumCulled = false;
  boltMesh.renderOrder = 3;
  boltMesh.visible = false;
  scene.add(boltMesh);
  let boltFor = -1;

  /* bigger splashes */
  const dropPos = new Float32Array(DROPLETS * 3);
  const dropVel = new Float32Array(DROPLETS * 3);
  const dropLife = new Float32Array(DROPLETS);
  const dropSize = new Float32Array(DROPLETS);
  const dropGeo = new THREE.BufferGeometry();
  dropGeo.setAttribute("position", new THREE.BufferAttribute(dropPos, 3));
  dropGeo.setAttribute("aLife", new THREE.BufferAttribute(dropLife, 1));
  dropGeo.setAttribute("aSize", new THREE.BufferAttribute(dropSize, 1));
  const dropMat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 500 }, uColour: { value: new THREE.Color(0xe6eef7) } },
    vertexShader: DROPLET_VERTEX,
    fragmentShader: DROPLET_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  const droplets = new THREE.Points(dropGeo, dropMat);
  droplets.frustumCulled = false;
  droplets.renderOrder = 5;
  droplets.visible = false;
  scene.add(droplets);
  let nextDrop = 0;
  let anyDrops = false;
  const ringGeo = new THREE.PlaneGeometry(2, 2);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = Array.from({ length: RINGS }, () => {
    const m = new THREE.Mesh(ringGeo, new THREE.ShaderMaterial({
      uniforms: { uColour: { value: new THREE.Color(0xeef6ff) }, uFade: { value: 0 } },
      vertexShader: RING_VERTEX,
      fragmentShader: RING_FRAGMENT,
      transparent: true,
      depthWrite: false,
    }));
    m.visible = false;
    m.renderOrder = 4;
    m.userData = { age: 0, delay: 0, life: 1, speed: 0.5, r0: 0.05, strength: 1 };
    scene.add(m);
    return m;
  });
  let nextRing = 0;

  /* the sky and the light, as the world set them for day or dusk */
  let dusk = false;
  // The fog's reach is the same by day and at dusk, so it is read once,
  // here, while it is still the world's own. Read again on every change
  // of mode, it was read after the rain had already pulled it in, and the
  // rain pulled that in again: a few quick switches between light and dark
  // in the rain and the fog closed in on the camera until nothing showed.
  const base = { sky: new THREE.Color(), fog: new THREE.Color(), near: scene.fog.near, far: scene.fog.far, cloud: new THREE.Color(), hemi: 0, dir: 0 };
  function setMode(isDusk) {
    dusk = isDusk;
    base.sky.copy(scene.background);
    base.fog.copy(scene.fog.color);
    base.cloud.copy(clouds.material.color);
    base.hemi = light.hemi.intensity;
    base.dir = light.dir.intensity;
  }
  setMode(false);

  let flashNow = 0;
  let level = 0;
  let clock = 0;
  let raining = false;
  let over = OVERCAST.day.rain;
  const windNow = new THREE.Vector2();
  const windWant = new THREE.Vector2();

  // A bigger splash at x, z (game coordinates), strength 0 to about 1.4.
  function impact(x, z, strength = 1, { sound = true } = {}) {
    if (!raining) return;
    const s = Math.max(0.2, strength);
    const px = -x;
    if (isHigh()) {
      // A spray of droplets on ballistic arcs, more and higher for a harder
      // hit: up at 1 to 3 m/s, out at under a metre a second.
      const n = Math.round(14 + 34 * s);
      for (let k = 0; k < n; k++) {
        const i = nextDrop;
        nextDrop = (nextDrop + 1) % DROPLETS;
        const ang = Math.random() * Math.PI * 2;
        const out = (0.35 + Math.random() * 0.9) * (0.6 + 0.5 * s);
        dropPos.set([px + Math.cos(ang) * 0.06, 0.03, z + Math.sin(ang) * 0.06], i * 3);
        dropVel.set([Math.cos(ang) * out, (1.0 + Math.random() * 1.8) * (0.6 + 0.5 * s), Math.sin(ang) * out], i * 3);
        dropLife[i] = 1;
        dropSize[i] = 0.01 + Math.random() * 0.016;
      }
      anyDrops = true;
      // Rings: three, one after another, the first the strongest.
      for (let k = 0; k < 3; k++) {
        const m = rings[nextRing];
        nextRing = (nextRing + 1) % RINGS;
        Object.assign(m.userData, { age: 0, delay: k * 0.16, life: 1.6 + 0.4 * s, speed: 0.42 + 0.12 * s, r0: 0.08 + 0.05 * s, strength: (1 - k * 0.25) * Math.min(1, 0.55 + 0.45 * s) });
        m.position.set(px, 0.024, z);
        m.visible = true;
      }
    }
    if (sound) playSplash(Math.min(1, s));
  }

  // Splashes for a flight as it plays: `key` names the flight (a turn),
  // `hits` gives its landings (from groundHits, or a function returning
  // them), ms is how far in it is. Fires each landing once, as play passes
  // it, and none on a jump.
  let trackKey = null;
  let trackMs = 0;
  let trackHits = [];
  function track(key, hits, ms) {
    if (!raining) return;
    if (key !== trackKey) {
      trackKey = key;
      trackHits = typeof hits === "function" ? hits() : hits;
      trackMs = ms < 250 ? -1 : ms;
    }
    if (ms > trackMs && ms - trackMs < 400) {
      for (const h of trackHits) if (h.ms > trackMs && h.ms <= ms) impact(h.x, h.z, h.strength);
    }
    trackMs = ms;
  }

  // dt is the world's game time step; the rain itself runs on real time,
  // as stack-game's does, so it keeps falling while a replay is paused.
  // Only the lightning keeps to the game clock, so a replay storms the
  // same.
  function update(info, gameDt, wind, camera) {
    const dt = Math.min(0.1, Math.max(0, (info.dt ?? 16) / 1000));
    const w = info.state?.weather ?? info.turn?.cond?.weather;
    const kind = KINDS[w?.kind] ?? KINDS.dry;
    const target = kind.level;
    // Snaps on a new match; eases otherwise.
    level = Math.abs(target - level) > 0.5 ? target : level + (target - level) * Math.min(1, dt * 2);
    const a = level;
    raining = a > 0.01;
    const { flash, strike } = raining && w?.wet ? flashAt(w, info.state.seedNum, info.t) : { flash: 0, strike: null };
    flashNow = flash;
    clock += dt;

    // The sky greys over, the far distance closes in, the sun goes in, and
    // the cloud comes down dark.
    const mode = dusk ? "dusk" : "day";
    const which = w?.kind === "storm" ? "storm" : "rain";
    over = OVERCAST[mode][which];
    scene.background.copy(base.sky).lerp(over, a).lerp(FLASH_SKY, flash * 0.9);
    scene.fog.color.copy(base.fog).lerp(over, a).lerp(FLASH_SKY, flash * 0.5);
    scene.fog.near = base.near * (1 - 0.45 * a);
    scene.fog.far = base.far * (1 - 0.4 * a);
    clouds.material.color.copy(base.cloud).lerp(RAIN_CLOUD[mode][which], Math.min(1, a * 1.2)).lerp(FLASH_SKY, flash * 0.7);
    deck.visible = raining;
    deckMat.opacity = Math.min(1, a * 1.3);
    deckMat.color.copy(RAIN_CLOUD[mode][which]).multiplyScalar(0.92).lerp(FLASH_SKY, flash * 0.6);
    light.hemi.intensity = base.hemi * (1 - 0.3 * a) + flash * 2.4;
    light.dir.intensity = base.dir * (1 - 0.6 * a);

    // The stars, on a clear night; the rain cloud hides them.
    const starsOn = dusk ? Math.max(0, 1 - a * 1.6) : 0;
    stars.visible = starsOn > 0.01 && Boolean(camera);
    if (stars.visible) {
      stars.position.copy(camera.position);
      stars.scale.setScalar(camera.far * 0.85);
      starMat.uniforms.uTime.value = clock;
      starMat.uniforms.uOpacity.value = starsOn;
      starMat.uniforms.uScale.value = isHigh() ? Math.min(2, window.devicePixelRatio || 1) : 1;
    }

    wet.visible = raining;
    streaks.visible = raining;
    splashes.visible = raining && isHigh();

    // The wind the rain falls through: the shot's, in three.js's flipped
    // x, with a slow gust on it, eased so a new shot's wind sweeps in.
    const gust = 1 + 0.22 * Math.sin(clock * 0.9) * Math.sin(clock * 0.37 + 1);
    windWant.set(-(wind?.x ?? 0) * gust, (wind?.z ?? 0) * gust);
    windNow.lerp(windWant, dt > 0 ? 1 - Math.exp(-dt * 2) : 1);

    if (raining) {
      sheenMat.opacity = 0.2 * a;
      puddleMat.opacity = 0.22 * a + 0.3 * flash;
      puddleMat.color.copy(over).lerp(FLASH_SKY, flash);
      const high = isHigh();
      streakGeo.instanceCount = splashGeo.instanceCount = high ? DROPS.high : DROPS.low;
      uniforms.uTime.value = clock;
      uniforms.uAmount.value = kind.amount;
      uniforms.uSpeed.value = kind.fall;
      uniforms.uLength.value = kind.fall * STREAK_S;
      uniforms.uWind.value.copy(windNow);
      uniforms.uFlash.value = flash;
      if (camera) uniforms.uPixel.value = pixelsOf(camera).pixel;
      // A cool grey a shade off the sky's: a drop shows darker against a
      // bright sky and lighter against the trees, as rain does.
      uniforms.uColour.value.copy(over).lerp(RAIN_GREY, 0.5).multiplyScalar(dusk ? 1.6 : 1.05);
      splashUniforms.uColour.value.copy(over).lerp(WHITE, 0.75);
      uniforms.uOpacity.value = high ? 0.7 : 0.95;
    }

    // The bolt, from the storm only, near enough to see.
    const seen = strike && w.kind === "storm" && strike.km < 5 && flash > 0.02;
    boltMesh.visible = Boolean(seen);
    if (seen) {
      if (boltFor !== strike.k) {
        boltFor = strike.k;
        boltMesh.geometry.dispose();
        boltMesh.geometry = boltGeometry(strike.shape, bolt.y);
        boltMesh.position.set(-strike.bearing * bolt.spread, 0, bolt.z * (0.9 + 0.05 * strike.km));
        boltMesh.scale.set(bolt.width ?? 1, 1, 1);
      }
      if (camera) boltMesh.lookAt(camera.position.x, boltMesh.position.y, camera.position.z);
      boltMat.uniforms.uBright.value = flash * (1.4 - 0.15 * strike.km);
    }

    // The bigger splashes' droplets and rings.
    if (anyDrops) {
      let alive = false;
      for (let i = 0; i < DROPLETS; i++) {
        if (dropLife[i] <= 0) continue;
        const k = i * 3;
        dropVel[k + 1] -= 9.81 * dt;
        dropPos[k] += dropVel[k] * dt;
        dropPos[k + 1] += dropVel[k + 1] * dt;
        dropPos[k + 2] += dropVel[k + 2] * dt;
        if (dropPos[k + 1] <= 0) dropLife[i] = 0;
        else {
          dropLife[i] = Math.max(0.001, dropLife[i] - dt * 0.6);
          alive = true;
        }
      }
      anyDrops = alive;
      dropGeo.attributes.position.needsUpdate = true;
      dropGeo.attributes.aLife.needsUpdate = true;
      if (camera) dropMat.uniforms.uScale.value = pixelsOf(camera).scale;
      dropMat.uniforms.uColour.value.copy(over).lerp(WHITE, 0.7).lerp(WHITE, flash);
    }
    droplets.visible = anyDrops;
    for (const m of rings) {
      if (!m.visible) continue;
      const d = m.userData;
      d.age += dt;
      const t = d.age - d.delay;
      if (t > d.life || !raining) {
        m.visible = false;
        continue;
      }
      const u = Math.max(0, t) / d.life;
      const r = d.r0 + d.speed * Math.max(0, t);
      m.scale.set(r, 1, r);
      m.material.uniforms.uFade.value = t < 0 ? 0 : d.strength * Math.pow(1 - u, 1.5);
      m.material.uniforms.uColour.value.copy(over).lerp(WHITE, 0.7);
    }
  }

  return { setMode, update, impact, track, bloomBoost: () => 1 + 2.2 * flashNow };
}
