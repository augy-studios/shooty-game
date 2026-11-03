// The three.js stage every game draws on: one renderer and one canvas,
// and a world per game, made the first time it is needed.
//
// The look is the uwuapps one in three dimensions: flat colours, toon
// shading in three steps, and a dark ink outline round the things that
// matter (the target, the board, the ball, the keeper), the way the app
// icon draws them. Light mode is a bright day; dark mode the same place
// at dusk, under lights.
//
// The games' own coordinates (js/physics.js) have x to the shooter's
// right with the camera looking down +z; three.js puts the camera's right
// at -x when it looks that way, so v3() flips x on the way in.

import * as THREE from "three";

export { THREE };

const WORLDS = {
  archery: () => import("./scene-archery.js"),
  darts: () => import("./scene-darts.js"),
  hoops: () => import("./scene-hoops.js"),
  kicks: () => import("./scene-kicks.js"),
};

let renderer = null;
let canvas = null;
let quality = "high";
let mode = "light";
const worlds = {};
let current = null;
let width = 1;
let height = 1;

export const v3 = (x, y, z, out = new THREE.Vector3()) => out.set(-x, y, z);

/* ---- materials ---- */

let toonRamp = null;
function ramp() {
  if (toonRamp) return toonRamp;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  toonRamp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  toonRamp.minFilter = THREE.NearestFilter;
  toonRamp.magFilter = THREE.NearestFilter;
  toonRamp.needsUpdate = true;
  return toonRamp;
}

const cache = new Map();

// A flat toon material in one colour. Shared, so a hundred trees cost one.
export function mat(color, { side = THREE.FrontSide, map = null, transparent = false, opacity = 1 } = {}) {
  const key = `${color}|${side}|${map?.uuid ?? ""}|${transparent}|${opacity}`;
  if (!cache.has(key)) {
    cache.set(key, new THREE.MeshToonMaterial({ color, gradientMap: ramp(), side, map, transparent, opacity }));
  }
  return cache.get(key);
}

export const INK = 0x1e2a23;
const inkMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

// The ink outline: the same shape again, a little larger, drawn from the
// inside in the outline colour. Good on the rounded and boxy shapes the
// games are built from.
export function outline(mesh, width = 0.04) {
  const hull = new THREE.Mesh(mesh.geometry, inkMat);
  const box = new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
  const size = box.getSize(new THREE.Vector3());
  hull.scale.set(1 + (2 * width) / Math.max(size.x, 1e-3), 1 + (2 * width) / Math.max(size.y, 1e-3), 1 + (2 * width) / Math.max(size.z, 1e-3));
  hull.castShadow = false;
  hull.receiveShadow = false;
  hull.userData.outline = true;
  mesh.add(hull);
  return mesh;
}

export function mesh(geometry, color, opts) {
  const m = new THREE.Mesh(geometry, typeof color === "number" || typeof color === "string" ? mat(color, opts) : color);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// A canvas drawn once into a texture: the target face, the dartboard, the
// court's lines.
export function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ---- the sky and the light ---- */

// The light rig every world shares, with day and dusk settings.
export function lights(scene, { sun = [8, 14, -6], target = [0, 0, 20], span = 30 } = {}) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8fbf7a, 1.4);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 2.2);
  dir.position.set(...sun);
  dir.target.position.set(...target);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  const cam = dir.shadow.camera;
  cam.left = -span;
  cam.right = span;
  cam.top = span;
  cam.bottom = -span;
  cam.near = 0.5;
  cam.far = 200;
  dir.shadow.bias = -0.0005;
  scene.add(dir, dir.target);
  return {
    hemi,
    dir,
    set(dusk) {
      hemi.intensity = dusk ? 0.75 : 1.4;
      hemi.color.set(dusk ? 0x9fb0ff : 0xffffff);
      hemi.groundColor.set(dusk ? 0x2b3a33 : 0x8fbf7a);
      dir.intensity = dusk ? 1.1 : 2.2;
      dir.color.set(dusk ? 0xffd2a6 : 0xffffff);
    },
  };
}

/* ---- the wind made visible ---- */

// Motes: dust and seed fluff drifting on the wind through a box in front
// of the camera, so the air's speed and direction can be seen as well as
// read off the chip. Purely for show; nothing in the game touches them.
export function motes(scene, { box = [12, 4, 30], centre = [0, 2, 15], count = 160, color = 0xffffff, size = 0.06 } = {}) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = centre[0] + (Math.random() - 0.5) * box[0];
    pos[i * 3 + 1] = centre[1] + (Math.random() - 0.5) * box[1];
    pos[i * 3 + 2] = centre[2] + (Math.random() - 0.5) * box[2];
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const material = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.75, depthWrite: false });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  scene.add(points);
  const half = box.map((b) => b / 2);
  return {
    points,
    // wind in game coordinates, m/s.
    update(dt, wind, t) {
      const a = geo.attributes.position.array;
      const wx = -(wind?.x ?? 0);
      const wz = wind?.z ?? 0;
      for (let i = 0; i < count; i++) {
        const k = i * 3;
        const wob = Math.sin(t * 0.0013 + i) * 0.15;
        a[k] += (wx * 0.9 + wob) * dt;
        a[k + 1] += Math.sin(t * 0.0009 + i * 1.7) * 0.08 * dt;
        a[k + 2] += (wz * 0.9 + wob * 0.5) * dt;
        for (let j = 0; j < 3; j++) {
          const d = a[k + j] - centre[j];
          if (d > half[j]) a[k + j] -= box[j];
          else if (d < -half[j]) a[k + j] += box[j];
        }
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

/* ---- the stage ---- */

export function initStage(el) {
  canvas = el;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === "high", alpha: false, powerPreference: "high-performance" });
  } catch {
    renderer = null;
    return false;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = quality === "high";
  renderer.shadowMap.type = THREE.PCFShadowMap;
  resize();
  window.addEventListener("resize", resize);
  return true;
}

export function setQuality(next) {
  if (next === quality || !renderer) {
    quality = next;
    return;
  }
  quality = next;
  renderer.shadowMap.enabled = quality === "high";
  for (const w of Object.values(worlds)) w.scene.traverse((o) => o.material && (o.material.needsUpdate = true));
  resize();
}

export function setMode(next) {
  mode = next;
  for (const w of Object.values(worlds)) w.setMode?.(mode === "dark");
}

function resize() {
  if (!renderer) return;
  width = window.innerWidth;
  height = window.innerHeight;
  renderer.setPixelRatio(quality === "high" ? Math.min(window.devicePixelRatio || 1, 2) : 1);
  renderer.setSize(width, height, false);
  for (const w of Object.values(worlds)) w.resize(width, height);
}

export const stageSize = () => ({ width, height });

// The world for a game, made once.
export async function useWorld(id) {
  if (!renderer) return null;
  if (!worlds[id]) {
    const module = await WORLDS[id]();
    const w = module.create({ THREE, renderer });
    w.resize(width, height);
    w.setMode?.(mode === "dark");
    worlds[id] = w;
  }
  current = worlds[id];
  return current;
}

export const world = () => current;

// Draws the current world as it is at `info`.
export function render(info) {
  if (!renderer || !current) return;
  current.update(info);
  renderer.autoClear = true;
  renderer.render(current.scene, current.camera);
  // In front of everything: the bow, the dart in hand.
  if (current.overlay) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(current.overlay.scene, current.overlay.camera);
  }
}

// Where a point in game coordinates lands on the screen, in CSS pixels;
// null behind the camera.
const tmp = new THREE.Vector3();
export function project(x, y, z, cam = current?.camera) {
  if (!cam) return null;
  v3(x, y, z, tmp).project(cam);
  if (tmp.z > 1) return null;
  return { x: ((tmp.x + 1) / 2) * width, y: ((1 - tmp.y) / 2) * height };
}

// The point on the plane z = zPlane under a screen point, in game
// coordinates: where a tap on the goal or the board means.
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
export function unproject(sx, sy, zPlane, cam = current?.camera) {
  if (!cam) return null;
  ndc.set((sx / width) * 2 - 1, -(sy / height) * 2 + 1);
  ray.setFromCamera(ndc, cam);
  const o = ray.ray.origin;
  const d = ray.ray.direction;
  if (Math.abs(d.z) < 1e-6) return null;
  const t = (zPlane - o.z) / d.z;
  if (t < 0) return null;
  return { x: -(o.x + d.x * t), y: o.y + d.y * t };
}

// Shared small helpers for the worlds.
export const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 1 - (1 - u) * (1 - u) * (1 - u));
export const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
export const mixColor = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);
