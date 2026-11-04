// The archery range: grass and lane lines out to the target, a wooden boss
// with a 122 cm face on it that moves further back each round, trees and
// hills behind, a flag that shows the wind, and the bow in the shooter's
// hand. The camera is the archer's eye through a sight: zoomed so the face
// stays a size that can be aimed at, at any distance. After each arrow it
// closes in on where it struck.

import { THREE, mesh, mat, outline, v3, lights, motes, canvasTexture, ease, smooth, project } from "./scene.js";
import { weather } from "./scene-weather.js";
import { tree, hedge, hills, clouds, flag, scenery } from "./scene-props.js";
import { pathAt } from "./physics.js";
import { FACE_R, FACE_Y, BOSS, archery } from "./sim-archery.js";
import { INTRO_MS } from "./rules.js";

const RING_COLOURS = ["#f4f6f1", "#f4f6f1", "#2f3b46", "#2f3b46", "#3aa7e2", "#3aa7e2", "#ec4a54", "#ec4a54", "#ffd33f", "#ffd33f"];
const PLAYER = [0xe2464f, 0x1f8fd6];
const EYE = { x: 0, y: 1.5, z: 0 };

function faceTexture() {
  return canvasTexture(1024, 1024, (g, w) => {
    const c = w / 2;
    for (let i = 0; i < 10; i++) {
      const r = (c * (10 - i)) / 10;
      g.beginPath();
      g.arc(c, c, r, 0, Math.PI * 2);
      g.fillStyle = RING_COLOURS[i];
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = i === 2 || i === 3 ? "#8a96a0" : "#1e2a23";
      g.stroke();
    }
    g.beginPath();
    g.arc(c, c, c / 20, 0, Math.PI * 2);
    g.lineWidth = 2;
    g.strokeStyle = "#b8901a";
    g.stroke();
    g.beginPath();
    g.moveTo(c - 8, c);
    g.lineTo(c + 8, c);
    g.moveTo(c, c - 8);
    g.lineTo(c, c + 8);
    g.stroke();
  });
}

function bossTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    const planks = 7;
    for (let i = 0; i < planks; i++) {
      g.fillStyle = i % 2 ? "#a65f3c" : "#b86c45";
      g.fillRect((i * w) / planks, 0, w / planks + 1, h);
      g.fillStyle = "rgba(0,0,0,0.12)";
      g.fillRect(((i + 1) * w) / planks - 2, 0, 2, h);
    }
  });
}

// One arrow: shaft, three vanes in the player's colour, a nock. Points
// along +z from its origin, which is the point.
function arrowMesh(color) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.78, 6), mat(0xd9a066));
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -0.39;
  g.add(shaft);
  const vane = new THREE.BufferGeometry();
  vane.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -0.62, 0, 0.05, -0.74, 0, 0.05, -0.78, 0, 0, -0.78], 3));
  vane.setIndex([0, 1, 2, 0, 2, 3]);
  vane.computeVertexNormals();
  for (let k = 0; k < 3; k++) {
    const v = new THREE.Mesh(vane, mat(color, { side: THREE.DoubleSide }));
    v.rotation.z = (k * Math.PI * 2) / 3;
    g.add(v);
  }
  const nock = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6), mat(0x333333));
  nock.rotation.x = Math.PI / 2;
  nock.position.z = -0.79;
  g.add(nock);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

export function create({ renderer }) {
  const scene = new THREE.Scene();
  const rand = scenery(11);
  const sky = new THREE.Color(0x9fe3f5);
  scene.background = sky;
  scene.fog = new THREE.Fog(0x9fe3f5, 120, 320);
  const light = lights(scene, { sun: [-12, 22, 4], target: [0, 0, 30], span: 45 });

  // The grass, darker the further it goes, in bands.
  const ground = mesh(new THREE.PlaneGeometry(260, 360), 0x76c84f);
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = 140;
  ground.castShadow = false;
  scene.add(ground);
  for (let z = 10; z < 120; z += 20) {
    const band = new THREE.Mesh(new THREE.PlaneGeometry(260, 10), mat(0x6dbf48));
    band.rotation.x = -Math.PI / 2;
    band.position.set(0, 0.003, z);
    band.receiveShadow = true;
    scene.add(band);
  }
  // Lane lines and the shooting line, and a post every ten metres.
  const white = mat(0xffffff);
  for (const x of [-2.2, 2.2]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 110), white);
    line.rotation.x = -Math.PI / 2;
    line.position.copy(v3(x, 0.006, 55));
    scene.add(line);
  }
  const shootLine = new THREE.Mesh(new THREE.PlaneGeometry(8, 0.1), white);
  shootLine.rotation.x = -Math.PI / 2;
  shootLine.position.set(0, 0.006, 0.4);
  scene.add(shootLine);
  for (let z = 10; z <= 90; z += 10) {
    for (const x of [-2.2, 2.2]) {
      const post = mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), 0xffffff);
      post.position.copy(v3(x, 0.25, z));
      scene.add(post);
    }
  }

  // The target: legs, the wooden boss, the face on its front at z = d.
  const target = new THREE.Group();
  const bossMat = mat(0xffffff, { map: bossTexture() });
  const boss = mesh(new THREE.BoxGeometry(BOSS * 2, BOSS * 2, 0.32), bossMat);
  boss.position.set(0, FACE_Y, 0.16);
  outline(boss, 0.03);
  target.add(boss);
  for (const x of [-0.55, 0.55]) {
    const leg = mesh(new THREE.BoxGeometry(0.12, FACE_Y - BOSS + 0.2, 0.12), 0x9b5a3c);
    leg.position.set(x, (FACE_Y - BOSS + 0.2) / 2, 0.05);
    target.add(leg);
    const back = mesh(new THREE.BoxGeometry(0.1, 2.0, 0.1), 0x8a4e33);
    back.position.set(x * 0.8, 0.95, 0.75);
    back.rotation.x = -0.45;
    target.add(back);
  }
  // The face sits a hair in front of the boss. At 90 m that hair is finer
  // than the depth buffer can tell apart, and the boss broke through it in
  // wedges and speckles; the polygon offset always draws the face in front.
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(FACE_R, 64),
    new THREE.MeshBasicMaterial({ map: faceTexture(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
  );
  face.position.set(0, FACE_Y, -0.005);
  face.rotation.y = Math.PI;
  target.add(face);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.008, 0.4);
  target.add(shadow);
  scene.add(target);

  // The world round the range.
  for (let i = 0; i < 16; i++) {
    const side = i % 2 ? 1 : -1;
    tree(scene, side * (7 + rand() * 14), 8 + i * 7 + rand() * 4, 1 + rand() * 0.5, rand);
  }
  for (let i = 0; i < 12; i++) tree(scene, -40 + i * 7 + rand() * 3, 100 + rand() * 20, 1.4 + rand() * 0.6, rand);
  hedge(scene, -30, 30, 92, rand);
  hills(scene, 190, undefined, rand);
  const sky2 = clouds(scene, { z: 160, y: 40 }, rand);
  const windFlag = flag(scene, 3.3, 20, { height: 4.5 });
  const windFlag2 = flag(scene, -3.3, 45, { height: 5, color: 0xffd33f });
  const air = motes(scene, { box: [10, 4, 60], centre: [0, 2.2, 30], count: 140 });
  // The archer looks down the range through a narrow view, so the rain
  // falls along the whole lane to the target.
  const rain = weather(scene, {
    light,
    clouds: sky2,
    box: [8, 7, 80],
    centre: [0, 3.5, 48],
    // Through the sight's long lens a drop a few metres off would be a
    // blur across the target; near the archer they fade out.
    near: 15,
    ground: { w: 260, d: 360, x: 0, z: 140 },
    pools: { w: 6, d: 70, x: 0, z: 40 },
    puddles: 14,
    bolt: { z: 128, y: 40, spread: 13, width: 0.3 },
    rand,
  });

  // Arrows, one for every arrow a round can hold, and the one in flight.
  const pool = [[], []];
  for (let p = 0; p < 2; p++) {
    for (let k = 0; k < 4; k++) {
      const a = arrowMesh(PLAYER[p]);
      a.visible = false;
      scene.add(a);
      pool[p].push(a);
    }
  }

  // Nothing the sight sees is within a metre of the eye (the rain fades
  // out by 15 m, the bow has its own camera), and the further out the near
  // plane, the finer the depth buffer at the target.
  const camera = new THREE.PerspectiveCamera(12, 1, 1, 600);
  camera.position.copy(v3(EYE.x, EYE.y, EYE.z));

  // The bow, drawn over everything from its own camera.
  const overlay = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(50, 1, 0.01, 10) };
  overlay.scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa88, 2.2));
  const bow = new THREE.Group();
  // Seen from the side, the way the archer holds it out at the left: the
  // grip towards the target, in the middle of the screen, and the string
  // nearer the edge, drawn back towards it.
  const limb = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.02, -0.62, 0),
    new THREE.Vector3(0.08, -0.32, 0),
    new THREE.Vector3(0.1, 0, 0),
    new THREE.Vector3(0.08, 0.32, 0),
    new THREE.Vector3(-0.02, 0.62, 0),
  ]);
  const bowColor = mat(0x2fb6e8);
  const limbMesh = new THREE.Mesh(new THREE.TubeGeometry(limb, 40, 0.026, 8, false), bowColor);
  outline(limbMesh, 0.012);
  bow.add(limbMesh);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8), mat(0x9b5a3c));
  grip.position.x = 0.1;
  bow.add(grip);
  const stringGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.02, -0.62, 0), new THREE.Vector3(-0.02, 0, 0), new THREE.Vector3(-0.02, 0.62, 0)]);
  const string = new THREE.Line(stringGeo, new THREE.LineBasicMaterial({ color: 0x333333 }));
  bow.add(string);
  // One nocked arrow per player, in their colour.
  const nockedArrows = PLAYER.map((c) => {
    const a = arrowMesh(c);
    a.scale.setScalar(0.55);
    bow.add(a);
    return a;
  });
  bow.position.set(-0.42, -0.1, -1.1);
  bow.rotation.set(0, 0.25, 0.08);
  overlay.scene.add(bow);

  const bowBase = { x: -0.42, scale: 1 };
  let lastD = 18;
  let prevFov = 12;
  let lastT = 0;
  let dusk = false;

  function setMode(isDusk) {
    dusk = isDusk;
    const c = isDusk ? 0x283a5c : 0x9fe3f5;
    sky.set(c);
    scene.fog.color.set(c);
    sky2.material.color.set(isDusk ? 0x5b6a8c : 0xffffff);
    light.set(isDusk);
    rain.setMode(isDusk);
  }

  // The half height of the view at the target: the sight's zoom. Wide
  // enough on a phone held upright that the face fills about half the
  // width, with the range round it.
  let aspect = 1;
  const halfView = (d) => Math.max(1.7, d * 0.045, 1.35 / aspect);
  const fovFor = (half, d) => (2 * Math.atan(half / d) * 180) / Math.PI;

  function placeArrow(a, pos, dir) {
    a.visible = true;
    a.position.copy(v3(pos.x, pos.y, pos.z));
    const to = v3(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z);
    a.lookAt(to);
  }

  function update(info) {
    const { state, t, turn } = info;
    const dt = Math.min(0.1, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    const cond = turn?.cond;
    const wind = cond?.wind ?? { x: 0, z: 0, speed: 0 };

    // The target walks back between rounds.
    let d = cond?.distance ?? lastD;
    if (turn && info.phase === "intro") {
      const prev = state.turns[turn.i - 1]?.cond.distance ?? d;
      d = prev + (d - prev) * smooth(info.since / INTRO_MS);
    }
    target.position.z = d;
    lastD = cond?.distance ?? lastD;

    // The camera: the sight, then closing in on the strike.
    let fov = fovFor(halfView(d), d);
    let look = { x: 0, y: FACE_Y, z: d };
    if (turn && turn.result && (info.phase === "settle" || info.phase === "flight") && !turn.result.none) {
      const hit = turn.result.hit;
      const u = info.phase === "settle" ? ease(info.since / 500) : 0;
      if (u > 0 && turn.result.stuck !== "ground") {
        fov = fov + (fovFor(0.75, d) - fov) * u;
        look = { x: hit.x * u, y: FACE_Y + (hit.y - FACE_Y) * u, z: d };
      }
    }
    if (info.phase === "intro") fov = prevFov + (fov - prevFov) * ease(info.since / 600);
    else prevFov = fov;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.lookAt(v3(look.x, look.y, look.z));

    // Arrows: this round's, where they stuck, and the one in the air.
    const used = [0, 0];
    for (const a of pool[0].concat(pool[1])) a.visible = false;
    if (turn) {
      for (const done of state.turns) {
        if (done.round !== turn.round || done.release > t || done.result.none) continue;
        const p = done.player;
        const a = pool[p][used[p]++ % 4];
        if (t < done.impact) {
          const ms = t - done.release;
          const now = pathAt(done.result.path, ms);
          const next = pathAt(done.result.path, ms + 16);
          if (now && next) placeArrow(a, now, { x: next.x - now.x, y: next.y - now.y, z: next.z - now.z });
        } else {
          const hit = done.result.hit;
          const dir = done.result.dir;
          // Buried a few centimetres into the boss or the grass.
          const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
          const sink = done.result.stuck === "ground" ? 0.25 : 0.06;
          placeArrow(a, { x: hit.x + (dir.x / len) * sink, y: hit.y + (dir.y / len) * sink, z: hit.z + (dir.z / len) * sink }, dir);
        }
      }
    }

    // The bow: up while aiming, drawn while the string is back.
    const p = turn?.player ?? 0;
    const aiming = info.phase === "aim";
    const drawn = aiming && info.aim?.drawn;
    bow.visible = info.phase !== "settle" || info.since < 300;
    const pull = drawn ? Math.min(1, info.aim.hold / 350) : 0;
    const pos = stringGeo.attributes.position;
    pos.setX(1, -0.02 - pull * 0.32);
    if (!drawn && info.phase === "flight") pos.setX(1, -0.02 + Math.sin(info.since * 0.12) * 0.02 * Math.max(0, 1 - info.since / 400));
    pos.needsUpdate = true;
    nockedArrows.forEach((a, k) => {
      a.visible = k === p && (drawn || (aiming && !info.aim?.none));
      // Point towards the target, its nock on the string.
      a.position.set(-0.02 - pull * 0.32 + 0.78 * 0.55, 0, 0);
      a.rotation.set(0, Math.PI / 2, 0);
    });
    bow.position.y = (-0.1 - (aiming ? 0 : 0.15)) * bowBase.scale;
    bow.position.x = bowBase.x - pull * 0.04 * bowBase.scale;

    windFlag.update(dt, wind);
    windFlag2.update(dt, wind);
    sky2.update(dt, wind);
    air.update(dt, wind, t);
    // An arrow that buries itself in the wet grass splashes, a little.
    if (turn?.result && !turn.result.none && t >= turn.release) {
      const res = turn.result;
      rain.track(`a${turn.i}`, () => (res.stuck === "ground" ? [{ ms: res.flightMs, x: res.hit.x, z: res.hit.z, strength: 0.35 }] : []), t - turn.release);
    }
    rain.update(info, dt, wind, camera);
  }

  function resize(w, h) {
    aspect = w / h;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    overlay.camera.aspect = aspect;
    overlay.camera.updateProjectionMatrix();
    // The bow at the left edge, sized to the screen: what the overlay
    // camera sees at the bow's distance.
    const halfH = Math.tan((overlay.camera.fov * Math.PI) / 360) * 1.1;
    const halfW = halfH * aspect;
    bowBase.scale = Math.min(1, (0.9 * halfH) / 0.62, (0.55 * halfW) / 0.5);
    bowBase.x = -halfW + 0.22 * bowBase.scale;
    bow.scale.setScalar(bowBase.scale);
  }

  // The aiming layer: the reticle where the arrow would go in still air,
  // a ring round it that fills as the draw is held and turns red when the
  // arm tires, and on Easy a faint dot where the wind would take it.
  function ink(g, info) {
    const { turn } = info;
    if (!turn || info.phase !== "aim" || !info.aim || info.aim.none) return;
    const d = turn.cond.distance;
    const a = info.aim;
    const s = project(a.x, FACE_Y + a.y, d);
    if (!s) return;
    const r = 22;
    g.lineWidth = 2.5;
    g.strokeStyle = a.drawn ? "#ff5a5a" : "rgba(255,90,90,0.75)";
    g.beginPath();
    g.moveTo(s.x - r, s.y);
    g.lineTo(s.x - 6, s.y);
    g.moveTo(s.x + 6, s.y);
    g.lineTo(s.x + r, s.y);
    g.moveTo(s.x, s.y - r);
    g.lineTo(s.x, s.y - 6);
    g.moveTo(s.x, s.y + 6);
    g.lineTo(s.x, s.y + r);
    g.stroke();
    if (a.drawn) {
      // The hold: full at four seconds, when the arm starts to tire.
      const u = Math.min(1, a.hold / 4000);
      g.lineWidth = 4;
      g.strokeStyle = "rgba(255,255,255,0.55)";
      g.beginPath();
      g.arc(s.x, s.y, 34, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = a.hold > 4000 ? "#ff5a5a" : "#ffffff";
      g.beginPath();
      g.arc(s.x, s.y, 34, -Math.PI / 2, -Math.PI / 2 + u * Math.PI * 2);
      g.stroke();
    }
    if (a.guide) {
      const q = project(a.guide.x, a.guide.y, d);
      if (q) {
        g.setLineDash([3, 4]);
        g.lineWidth = 2;
        g.strokeStyle = "rgba(255,255,255,0.9)";
        g.beginPath();
        g.arc(q.x, q.y, 7, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.lineTo(q.x, q.y);
        g.stroke();
        g.setLineDash([]);
      }
    }
    return true;
  }

  // Metres on the face per pixel of drag, for the controls.
  const aimScale = (h, d) => ((2 * halfView(d)) / h) * 0.6;

  return { scene, camera, overlay, update, resize, setMode, bloomBoost: rain.bloomBoost, weather: rain, ink, aimScale, module: archery };
}
