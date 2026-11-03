// The darts room: a striped wall with a dartboard hung on it at the
// regulation height, a wooden floor, and an open window whose curtain
// shows the breeze that moves the darts. The camera stands at the oche.
// Under the board runs the side to side sweep and beside it the up and
// down one; the dart waits in hand at the bottom.

import { THREE, mesh, mat, outline, v3, lights, motes, canvasTexture, project } from "./scene.js";
import { pathAt } from "./physics.js";
import { BOARD_Z, BOARD_Y, ORDER, RADII, SWEEP, darts } from "./sim-darts.js";

const PLAYER = [0xe2464f, 0x1f8fd6];
const PLAYER_CSS = ["#e2464f", "#1f8fd6"];
// The surround the numbers sit on, past the scoring edge.
const SURROUND = 0.29;

function boardTexture() {
  return canvasTexture(1024, 1024, (g, w) => {
    const c = w / 2;
    const k = c / SURROUND;
    // The black surround and its numbers.
    g.fillStyle = "#141414";
    g.beginPath();
    g.arc(c, c, c, 0, Math.PI * 2);
    g.fill();
    const seg = (r0, r1, a0, a1, color) => {
      g.beginPath();
      g.arc(c, c, r1 * k, a0, a1);
      g.arc(c, c, r0 * k, a1, a0, true);
      g.closePath();
      g.fillStyle = color;
      g.fill();
    };
    for (let i = 0; i < 20; i++) {
      // Canvas angles run clockwise from the right; the 20 sits at the top.
      const mid = -Math.PI / 2 + (i * Math.PI) / 10;
      const a0 = mid - Math.PI / 20;
      const a1 = mid + Math.PI / 20;
      const dark = i % 2 === 0;
      seg(RADII.outer, RADII.trebleIn, a0, a1, dark ? "#1a1a1a" : "#f6efd9");
      seg(RADII.trebleIn, RADII.trebleOut, a0, a1, dark ? "#e2343f" : "#119a45");
      seg(RADII.trebleOut, RADII.doubleIn, a0, a1, dark ? "#1a1a1a" : "#f6efd9");
      seg(RADII.doubleIn, RADII.doubleOut, a0, a1, dark ? "#e2343f" : "#119a45");
      g.save();
      g.translate(c + Math.cos(mid) * 0.255 * k, c + Math.sin(mid) * 0.255 * k);
      g.fillStyle = "#ffffff";
      g.font = `bold ${Math.round(0.042 * k)}px Jua, "Segoe UI", sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(ORDER[i]), 0, 0);
      g.restore();
    }
    // Wires between the beds.
    g.strokeStyle = "#bfc3c7";
    g.lineWidth = 2;
    for (let i = 0; i < 20; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 10 - Math.PI / 20;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * RADII.outer * k, c + Math.sin(a) * RADII.outer * k);
      g.lineTo(c + Math.cos(a) * RADII.doubleOut * k, c + Math.sin(a) * RADII.doubleOut * k);
      g.stroke();
    }
    for (const r of [RADII.outer, RADII.trebleIn, RADII.trebleOut, RADII.doubleIn, RADII.doubleOut]) {
      g.beginPath();
      g.arc(c, c, r * k, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = "#119a45";
    g.beginPath();
    g.arc(c, c, RADII.outer * k, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#e2343f";
    g.beginPath();
    g.arc(c, c, RADII.bull * k, 0, Math.PI * 2);
    g.fill();
  });
}

function wallTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    const n = 8;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? "#2f7d86" : "#368a93";
      g.fillRect((i * w) / n, 0, w / n + 1, h);
    }
  });
}

function floorTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    const n = 8;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? "#8c5a3a" : "#9a6542";
      g.fillRect((i * w) / n, 0, w / n + 1, h);
      g.fillStyle = "rgba(0,0,0,0.18)";
      g.fillRect(((i + 1) * w) / n - 2, 0, 2, h);
    }
  });
}

// A dart: point, barrel, shaft and three flights in the player's colour.
// Points along +z from its origin, which is the tip.
function dartMesh(color) {
  const g = new THREE.Group();
  const add = (geo, colour, z) => {
    const m = new THREE.Mesh(geo, mat(colour));
    m.rotation.x = Math.PI / 2;
    m.position.z = z;
    m.castShadow = true;
    g.add(m);
  };
  add(new THREE.ConeGeometry(0.0025, 0.03, 6), 0xd8d8d8, -0.015);
  add(new THREE.CylinderGeometry(0.0045, 0.0055, 0.05, 10), color, -0.055);
  add(new THREE.CylinderGeometry(0.003, 0.003, 0.04, 6), 0xf2f2f2, -0.1);
  const flight = new THREE.BufferGeometry();
  flight.setAttribute("position", new THREE.Float32BufferAttribute([0, 0.003, -0.105, 0, 0.022, -0.125, 0, 0.022, -0.15, 0, 0.003, -0.15], 3));
  flight.setIndex([0, 1, 2, 0, 2, 3]);
  flight.computeVertexNormals();
  for (let k = 0; k < 3; k++) {
    const f = new THREE.Mesh(flight, mat(color, { side: THREE.DoubleSide }));
    f.rotation.z = (k * Math.PI * 2) / 3;
    g.add(f);
  }
  return g;
}

export function create() {
  const scene = new THREE.Scene();
  const bg = new THREE.Color(0x2f7d86);
  scene.background = bg;
  const light = lights(scene, { sun: [-1.5, 3.5, -1], target: [0, 1.5, 2.4], span: 4 });
  const lamp = new THREE.PointLight(0xfff1d6, 0, 6);
  lamp.position.set(0, 2.6, 1.6);
  scene.add(lamp);

  const wall = mesh(new THREE.PlaneGeometry(9, 4.5), mat(0xffffff, { map: wallTexture() }));
  wall.material.map.wrapS = THREE.RepeatWrapping;
  wall.material.map.repeat.set(2, 1);
  wall.rotation.y = Math.PI;
  wall.position.set(0, 2.25, BOARD_Z + 0.05);
  wall.castShadow = false;
  scene.add(wall);
  const skirting = mesh(new THREE.BoxGeometry(9, 0.18, 0.04), 0x245f66);
  skirting.position.set(0, 0.09, BOARD_Z + 0.03);
  scene.add(skirting);
  const floor = mesh(new THREE.PlaneGeometry(9, 6), mat(0xffffff, { map: floorTexture() }));
  floor.material.map.wrapS = THREE.RepeatWrapping;
  floor.material.map.repeat.set(2, 1);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 0);
  scene.add(floor);
  const oche = mesh(new THREE.BoxGeometry(0.9, 0.02, 0.05), 0xf2f2f2);
  oche.position.set(0, 0.01, 0);
  scene.add(oche);

  // The window, off to one side, its curtain in the breeze.
  const win = new THREE.Group();
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.3), new THREE.MeshBasicMaterial({ color: 0xbfeaf7 }));
  pane.rotation.y = Math.PI;
  win.add(pane);
  for (const [w, h, x, y] of [[1.32, 0.08, 0, 0.69], [1.32, 0.08, 0, -0.69], [0.08, 1.4, 0.64, 0], [0.08, 1.4, -0.64, 0], [0.05, 1.3, 0, 0]]) {
    const bar = mesh(new THREE.BoxGeometry(w, h, 0.06), 0xf4f4f4);
    bar.position.set(x, y, -0.02);
    win.add(bar);
  }
  win.position.copy(v3(-2.6, 2.0, BOARD_Z + 0.03));
  scene.add(win);
  const curtainGeo = new THREE.PlaneGeometry(0.7, 1.5, 6, 10);
  const curtainBase = curtainGeo.attributes.position.array.slice();
  const curtain = new THREE.Mesh(curtainGeo, mat(0xffd33f, { side: THREE.DoubleSide }));
  curtain.position.copy(v3(-2.15, 1.95, BOARD_Z - 0.05));
  scene.add(curtain);

  // The board.
  const board = new THREE.Group();
  const body = mesh(new THREE.CylinderGeometry(SURROUND, SURROUND, 0.04, 64), 0x141414);
  body.rotation.x = Math.PI / 2;
  outline(body, 0.008);
  board.add(body);
  const face = new THREE.Mesh(new THREE.CircleGeometry(SURROUND - 0.002, 96), new THREE.MeshToonMaterial({ map: boardTexture() }));
  face.rotation.y = Math.PI;
  face.position.z = -0.0205;
  board.add(face);
  board.position.set(0, BOARD_Y, BOARD_Z + 0.02);
  scene.add(board);
  const shade = new THREE.Mesh(new THREE.CircleGeometry(SURROUND * 1.05, 48), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 }));
  shade.rotation.y = Math.PI;
  shade.position.copy(v3(-0.04, BOARD_Y - 0.05, BOARD_Z + 0.045));
  scene.add(shade);

  const air = motes(scene, { box: [3, 2.2, 2.4], centre: [0, 1.6, 1.3], count: 70, size: 0.012 });

  // Three darts a player can have in the board, and one in flight.
  const pool = [0, 1].map((p) => [0, 1, 2].map(() => {
    const d = dartMesh(PLAYER[p]);
    d.visible = false;
    scene.add(d);
    return d;
  }));

  const camera = new THREE.PerspectiveCamera(38, 1, 0.02, 30);
  camera.position.set(0, 1.62, 0);

  // The dart in hand.
  const overlay = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(40, 1, 0.01, 5) };
  overlay.scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.4));
  const held = PLAYER.map((c) => {
    const d = dartMesh(c);
    d.scale.setScalar(3.2);
    d.rotation.x = -Math.PI / 2 + 0.25;
    overlay.scene.add(d);
    return d;
  });

  let lastT = 0;
  let aspect = 1;

  function setMode(dusk) {
    bg.set(dusk ? 0x1d4f55 : 0x2f7d86);
    pane.material.color.set(dusk ? 0x2b3c66 : 0xbfeaf7);
    light.set(dusk);
    lamp.intensity = dusk ? 3 : 0;
  }

  function place(d, pos, dir) {
    d.visible = true;
    d.position.copy(v3(pos.x, pos.y, pos.z));
    d.lookAt(v3(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z));
  }

  function update(info) {
    const { state, t, turn } = info;
    const dt = Math.min(0.1, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    const wind = turn?.cond.wind ?? { x: 0, z: 0, speed: 0 };

    // Frame the board, the sweeps and the dart in hand on any screen.
    const halfW = 0.4;
    const halfH = 0.62;
    const vFov = Math.max(2 * Math.atan(halfH / BOARD_Z), 2 * Math.atan(halfW / aspect / BOARD_Z));
    camera.fov = (vFov * 180) / Math.PI;
    camera.updateProjectionMatrix();
    camera.lookAt(0, BOARD_Y - 0.12, BOARD_Z);

    for (const list of pool) for (const d of list) d.visible = false;
    if (turn) {
      // This visit's darts stay in the board; the next visit pulls them.
      const used = [0, 0];
      for (const done of state.turns) {
        if (done.player !== turn.player || done.round !== turn.round || done.release > t) continue;
        const d = pool[done.player][used[done.player]++ % 3];
        const r = done.result;
        if (t < done.impact) {
          const now = pathAt(r.path, t - done.release);
          const next = pathAt(r.path, t - done.release + 16);
          if (now && next) place(d, now, { x: next.x - now.x, y: next.y - now.y, z: next.z - now.z });
        } else {
          const tip = { x: r.hit.x, y: BOARD_Y + r.hit.y, z: BOARD_Z + 0.008 };
          place(d, tip, r.dir);
        }
      }
    }

    // The dart waits in hand while aiming, and goes with the throw.
    const p = turn?.player ?? 0;
    const showHeld = info.phase === "aim" || info.phase === "intro";
    held.forEach((d, k) => {
      d.visible = showHeld && k === p;
      const lift = info.aim?.stopped ? 0.03 : 0;
      d.position.set(0, -0.22 + lift, -1.1);
    });

    // The curtain lifts into the room with the breeze.
    const a = curtainGeo.attributes.position.array;
    const s = Math.min(1, wind.speed / 2.6);
    for (let i = 0; i < a.length; i += 3) {
      const down = (0.75 - curtainBase[i + 1]) / 1.5;
      a[i] = curtainBase[i] + Math.sin(t * 0.004 + down * 4) * 0.03 * s * down;
      a[i + 2] = curtainBase[i + 2] - (0.08 + Math.sin(t * 0.003 + down * 3) * 0.06) * s * down;
    }
    curtainGeo.attributes.position.needsUpdate = true;
    curtainGeo.computeVertexNormals();
    air.update(dt, wind, t);
  }

  function resize(w, h) {
    aspect = w / h;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    overlay.camera.aspect = aspect;
    overlay.camera.updateProjectionMatrix();
  }

  // The sweeps: a bar under the board for side to side and one beside it
  // for up and down, each with its marker, and a dot on the board where
  // the two meet.
  function ink(g, info) {
    const { turn } = info;
    if (!turn || info.phase !== "aim" || !info.aim) return;
    const a = info.aim;
    const left = project(-SWEEP, BOARD_Y - SURROUND - 0.05, BOARD_Z);
    const right = project(SWEEP, BOARD_Y - SURROUND - 0.05, BOARD_Z);
    const top = project(-SURROUND - 0.06, BOARD_Y + SWEEP, BOARD_Z);
    const bottom = project(-SURROUND - 0.06, BOARD_Y - SWEEP, BOARD_Z);
    if (!left || !right || !top || !bottom) return;
    const colour = PLAYER_CSS[turn.player];
    const bar = (x0, y0, x1, y1, on) => {
      g.lineCap = "round";
      g.lineWidth = 12;
      g.strokeStyle = on ? "rgba(20,26,22,0.82)" : "rgba(255,255,255,0.35)";
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    };
    const tick = (x, y, horizontal) => {
      g.lineCap = "round";
      g.lineWidth = 4;
      g.strokeStyle = "#ffffff";
      g.beginPath();
      if (horizontal) {
        g.moveTo(x, y - 14);
        g.lineTo(x, y + 14);
      } else {
        g.moveTo(x - 14, y);
        g.lineTo(x + 14, y);
      }
      g.stroke();
    };
    bar(left.x, left.y, right.x, right.y, !a.stopped);
    bar(top.x, top.y, bottom.x, bottom.y, a.stopped && !a.thrown);
    const mx = left.x + ((a.x + SWEEP) / (2 * SWEEP)) * (right.x - left.x);
    tick(mx, left.y, true);
    if (a.y !== null && a.y !== undefined) {
      const my = top.y + ((SWEEP - a.y) / (2 * SWEEP)) * (bottom.y - top.y);
      tick(top.x, my, false);
    }
    const dot = project(a.x, BOARD_Y + (a.y ?? 0), BOARD_Z);
    if (dot && !a.thrown) {
      g.fillStyle = colour;
      g.globalAlpha = 0.6;
      g.beginPath();
      g.arc(dot.x, dot.y, 9, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.lineWidth = 2;
      g.strokeStyle = "#ffffff";
      g.stroke();
    }
    return true;
  }

  return { scene, camera, overlay, update, resize, setMode, ink, module: darts };
}
