// The penalty box: a striped pitch, the goal with its net, a keeper on the
// line, the crowd behind, and the ball on the spot. The camera stands
// behind the ball. When the bot takes its kick, its player runs up from
// the side, and the person playing keeps goal by tapping where to dive.

import { THREE, mesh, mat, outline, v3, lights, motes, canvasTexture, project, smooth } from "./scene.js";
import { weather, groundHits } from "./scene-weather.js";
import { clouds, flag, scenery } from "./scene-props.js";
import { pathAt, SAMPLE_MS } from "./physics.js";
import { GOAL_Z, HALF_W, BAR, BALL, NET_DEPTH, KEEPER_Z, kicks, keeperAt } from "./sim-kicks.js";

const PLAYER = [0xe2464f, 0x1f8fd6];
const PLAYER_CSS = ["#e2464f", "#1f8fd6"];
const KEEPER_SHIRT = [0x34c759, 0xffb020];

function pitchTexture() {
  // 44 m across by 24 m, from 6 m behind the spot to 7 m behind the goal.
  const W = 44;
  const D = 24;
  const k = 24;
  return canvasTexture(W * k, D * k, (g) => {
    for (let i = 0; i < 12; i++) {
      g.fillStyle = i % 2 ? "#5fb546" : "#69c04f";
      g.fillRect(0, (i * D * k) / 12, W * k, (D * k) / 12 + 1);
    }
    // Canvas y runs from the far end (behind the goal) to the near end.
    const Y = (z) => (GOAL_Z + 7 - z) * k;
    const X = (x) => (W / 2 + x) * k;
    g.strokeStyle = "#ffffff";
    g.lineWidth = 0.12 * k;
    g.beginPath();
    g.moveTo(0, Y(GOAL_Z));
    g.lineTo(W * k, Y(GOAL_Z));
    g.strokeRect(X(-20.16), Y(GOAL_Z), 40.32 * k, (GOAL_Z - (GOAL_Z - 16.5)) * k);
    g.strokeRect(X(-9.16), Y(GOAL_Z), 18.32 * k, 5.5 * k);
    g.stroke();
    // The arc: the part of the circle round the spot outside the box,
    // which on the canvas is below the spot.
    const reach = Math.acos(5.5 / 9.15);
    g.beginPath();
    g.arc(X(0), Y(0), 9.15 * k, Math.PI / 2 - reach, Math.PI / 2 + reach, false);
    g.stroke();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(X(0), Y(0), 0.14 * k, 0, Math.PI * 2);
    g.fill();
  });
}

function ballTexture() {
  return canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = "#fafafa";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#1e2a23";
    for (let i = 0; i < 6; i++) {
      const x = ((i + 0.5) * w) / 6;
      const y = i % 2 ? h * 0.3 : h * 0.7;
      g.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k * Math.PI * 2) / 5 - Math.PI / 2;
        g.lineTo(x + Math.cos(a) * 26, y + Math.sin(a) * 34);
      }
      g.fill();
    }
  });
}

// A person built from boxes and a ball for a head, standing on its origin
// with its height along +y. Arms raised for a keeper.
function person(shirt, { arms = "up" } = {}) {
  const g = new THREE.Group();
  const skin = 0xe8b48a;
  const legs = mesh(new THREE.BoxGeometry(0.34, 0.8, 0.22), 0x2b3440);
  legs.position.y = 0.4;
  const torso = mesh(new THREE.BoxGeometry(0.46, 0.62, 0.26), shirt);
  torso.position.y = 1.12;
  outline(torso, 0.015);
  const head = mesh(new THREE.SphereGeometry(0.13, 14, 10), skin);
  head.position.y = 1.58;
  outline(head, 0.012);
  g.add(legs, torso, head);
  const armGeo = new THREE.BoxGeometry(0.12, 0.6, 0.12);
  armGeo.translate(0, 0.3, 0);
  const left = mesh(armGeo, shirt);
  const right = mesh(armGeo, shirt);
  left.position.set(0.3, 1.38, 0);
  right.position.set(-0.3, 1.38, 0);
  if (arms === "up") {
    left.rotation.z = -0.5;
    right.rotation.z = 0.5;
  } else {
    left.rotation.z = Math.PI - 0.2;
    right.rotation.z = Math.PI + 0.2;
  }
  g.add(left, right);
  const gloves = arms === "up";
  if (gloves) {
    for (const arm of [left, right]) {
      const glove = mesh(new THREE.BoxGeometry(0.16, 0.14, 0.14), 0xffffff);
      glove.position.y = 0.62;
      arm.add(glove);
    }
  }
  g.userData = { legs, torso, head, left, right };
  return g;
}

export function create() {
  const scene = new THREE.Scene();
  const rand = scenery(3);
  const sky = new THREE.Color(0x9fdcf3);
  scene.background = sky;
  scene.fog = new THREE.Fog(0x9fdcf3, 60, 220);
  const light = lights(scene, { sun: [-10, 20, 0], target: [0, 0, 8], span: 22 });

  const pitch = mesh(new THREE.PlaneGeometry(44, 24), mat(0xffffff, { map: pitchTexture() }));
  pitch.rotation.x = -Math.PI / 2;
  pitch.rotation.z = Math.PI;
  pitch.position.copy(v3(0, 0, GOAL_Z + 7 - 12));
  pitch.castShadow = false;
  scene.add(pitch);
  const outer = mesh(new THREE.PlaneGeometry(200, 200), 0x5fb546);
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.01;
  outer.castShadow = false;
  scene.add(outer);

  // The goal frame.
  const white = 0xffffff;
  const frame = new THREE.Group();
  for (const x of [-HALF_W, HALF_W]) {
    const post = mesh(new THREE.CylinderGeometry(0.06, 0.06, BAR + 0.06, 12), white);
    post.position.copy(v3(x, (BAR + 0.06) / 2, GOAL_Z));
    outline(post, 0.012);
    frame.add(post);
    const back = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8 * BAR, 8), white);
    back.position.copy(v3(x, 0.4 * BAR, GOAL_Z + NET_DEPTH));
    frame.add(back);
  }
  const bar = mesh(new THREE.CylinderGeometry(0.06, 0.06, HALF_W * 2 + 0.12, 12), white);
  bar.rotation.z = Math.PI / 2;
  bar.position.copy(v3(0, BAR, GOAL_Z));
  outline(bar, 0.012);
  frame.add(bar);
  scene.add(frame);

  // The net: the back as a grid of lines that bulges where the ball hits.
  const NX = 30;
  const NY = 10;
  const netBase = [];
  for (let j = 0; j <= NY; j++) {
    for (let i = 0; i <= NX; i++) {
      const u = i / NX;
      const v = j / NY;
      // The back slopes from the bar down to the ground behind.
      netBase.push(-HALF_W + u * 2 * HALF_W, v * BAR, GOAL_Z + NET_DEPTH * (1 - v * 0.55));
    }
  }
  const netIdx = [];
  for (let j = 0; j <= NY; j++) {
    for (let i = 0; i <= NX; i++) {
      const a = j * (NX + 1) + i;
      if (i < NX) netIdx.push(a, a + 1);
      if (j < NY) netIdx.push(a, a + NX + 1);
    }
  }
  const netGeo = new THREE.BufferGeometry();
  netGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(netBase.length), 3));
  netGeo.setIndex(netIdx);
  const net = new THREE.LineSegments(netGeo, new THREE.LineBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.85 }));
  scene.add(net);
  // The sides and roof, plain and still.
  const sideMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, side: THREE.DoubleSide });
  for (const x of [-HALF_W, HALF_W]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(NET_DEPTH, BAR), sideMat);
    side.rotation.y = Math.PI / 2;
    side.position.copy(v3(x, BAR / 2, GOAL_Z + NET_DEPTH / 2));
    scene.add(side);
  }

  // The crowd, behind the goal, and a plain board in front of it.
  const stand = new THREE.Group();
  const colours = [0xe2464f, 0x1f8fd6, 0xffd33f, 0xffffff, 0x34c759, 0xff8a3d];
  for (let row = 0; row < 7; row++) {
    const step = mesh(new THREE.BoxGeometry(60, 0.8, 1.4), 0x4b5a66);
    step.position.copy(v3(0, 1.2 + row * 0.8, GOAL_Z + 7 + row * 1.4));
    stand.add(step);
    for (let s = 0; s < 46; s++) {
      if (rand() < 0.2) continue;
      const fan = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.7, 0.3), mat(colours[Math.floor(rand() * colours.length)]));
      fan.position.copy(v3(-29 + s * 1.27 + rand() * 0.3, 1.95 + row * 0.8, GOAL_Z + 6.8 + row * 1.4));
      fan.userData.jump = rand() * Math.PI * 2;
      stand.add(fan);
    }
  }
  scene.add(stand);
  const hoarding = mesh(new THREE.BoxGeometry(60, 0.9, 0.12), 0x2f9a40);
  hoarding.position.copy(v3(0, 0.45, GOAL_Z + 5));
  scene.add(hoarding);
  const sky2 = clouds(scene, { z: 120, y: 40 }, rand);
  const cornerFlag = flag(scene, -11, GOAL_Z + 2, { height: 3.2, color: 0xffd33f, length: 0.8 });
  const air = motes(scene, { box: [16, 4, 16], centre: [0, 2, 6], count: 120 });
  const rain = weather(scene, {
    light,
    clouds: sky2,
    box: [16, 8, 20],
    centre: [0, 4, 5],
    ground: { w: 200, d: 200, x: 0, z: 0 },
    pools: { w: 16, d: 14, x: 0, z: 6 },
    bolt: { z: 95, y: 70, spread: 45 },
    rand,
  });

  // The keeper, one shirt per keeper, and the bot's kicker.
  const keepers = KEEPER_SHIRT.map((c) => {
    const k = person(c, { arms: "up" });
    scene.add(k);
    return k;
  });
  const kicker = person(PLAYER[1], { arms: "down" });
  scene.add(kicker);

  const ball = mesh(new THREE.SphereGeometry(BALL, 24, 16), mat(0xffffff, { map: ballTexture() }));
  outline(ball, 0.006);
  scene.add(ball);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.05, 400);
  let lastT = 0;
  let aspect = 1;
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();

  function setMode(dusk) {
    const c = dusk ? 0x22314f : 0x9fdcf3;
    sky.set(c);
    scene.fog.color.set(c);
    sky2.material.color.set(dusk ? 0x5b6a8c : 0xffffff);
    light.set(dusk);
    rain.setMode(dusk);
  }

  // The keeper's body along the line from its feet to its hands.
  function poseKeeper(k, pose, t, celebrate) {
    const feet = v3(pose.fx, pose.fy - 0.1, KEEPER_Z);
    const hands = v3(pose.hx, pose.hy, KEEPER_Z);
    dir.subVectors(hands, feet);
    const len = dir.length();
    dir.normalize();
    q.setFromUnitVectors(up, dir);
    k.quaternion.copy(q);
    k.position.copy(feet);
    k.scale.set(1, len / 2.05, 1);
    // Ready on the toes before the kick: a small side to side shuffle.
    if (Math.abs(pose.hx) < 0.01) k.position.x += Math.sin(t * 0.004) * 0.06;
    const { left, right } = k.userData;
    left.rotation.z = celebrate ? -2.6 : -0.5;
    right.rotation.z = celebrate ? 2.6 : 0.5;
  }

  function setNet(hit) {
    const a = netGeo.attributes.position.array;
    for (let i = 0; i < netBase.length; i += 3) {
      let x = netBase[i];
      const y = netBase[i + 1];
      let z = netBase[i + 2];
      if (hit) {
        const d = Math.hypot(x - hit.x, y - hit.y);
        const push = Math.max(0, 1 - d / 1.4) * hit.depth;
        z += push;
        x += (x - hit.x) * push * 0.1;
      }
      a[i] = -x;
      a[i + 1] = y;
      a[i + 2] = z;
    }
    netGeo.attributes.position.needsUpdate = true;
  }

  function update(info) {
    const { t, turn } = info;
    const dt = Math.min(0.1, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    const cond = turn?.cond;
    const wind = cond?.wind ?? { x: 0, z: 0, speed: 0 };
    const keeping = turn?.input === "keep" || (turn && turn.player === 1 && turn.shot?.length === 3);
    const botKicks = Boolean(turn && keeping);

    // Kicking, from just behind the ball. Keeping, from higher and off to
    // the right, so the bot's kicker runs up beside the shot, not across it.
    if (botKicks) {
      camera.position.copy(v3(1.5, 2.5, -5.6));
      camera.lookAt(v3(0.2, 1.0, GOAL_Z));
    } else {
      camera.position.set(0, 1.55, -3.4);
      camera.lookAt(0, 1.15, GOAL_Z);
    }

    // Who is in goal: the other side's keeper.
    const keeperOf = turn ? turn.keeper ?? 1 - turn.player : 1;
    keepers.forEach((k, i) => (k.visible = i === keeperOf));
    const kp = keepers[keeperOf];

    // The ball and the keeper through the kick.
    // A keeping turn not yet played shows its preview: the kick as it
    // stands with the dive sent so far.
    const r = turn?.result ?? info.preview;
    const release = turn?.release ?? (turn ? turn.aimStart + (cond?.kickMs ?? 0) : 0);
    let pose = keeperAt(null, 0);
    let pos = { x: 0, y: BALL, z: 0 };
    let netHit = null;
    if (turn && r && t >= release) {
      const ms = t - release;
      pose = keeperAt(r.plan, ms);
      const p = pathAt(r.path, ms);
      if (p) pos = p;
      ball.rotation.y += dt * (r.spin || 0) * 40;
      ball.rotation.x += dt * 14;
      if (r.goal && pos.z > GOAL_Z) netHit = { x: pos.x, y: pos.y, depth: Math.max(0, pos.z - (GOAL_Z + NET_DEPTH * 0.6)) * 0.8 + 0.05 };
    } else if (turn && r?.plan && t >= turn.aimStart) {
      // A dive sent before the kick: the keeper is already moving.
      pose = keeperAt(r.plan, t - release);
    }
    poseKeeper(kp, pose, t, false);
    ball.position.copy(v3(pos.x, pos.y, pos.z));
    // In the rain: a splash where the ball comes down on the wet grass, and
    // a big one where the keeper lands from a dive.
    if (turn?.result && t >= release - 400) {
      const res = turn.result;
      rain.track(`k${turn.i}`, () => {
        const hits = groundHits(res.path, BALL, SAMPLE_MS);
        if (res.plan) hits.push({ ms: res.plan.t0 + res.plan.dur + 120, x: res.plan.x * 0.7, z: KEEPER_Z + 0.2, strength: 1.3 });
        return hits.sort((a, b) => a.ms - b.ms);
      }, t - release);
    }
    setNet(netHit);

    // The bot's kicker: runs up from the left and strikes it.
    kicker.visible = botKicks;
    if (botKicks) {
      const kickAt = turn.aimStart + cond.kickMs;
      const u = smooth(Math.min(1, Math.max(0, (t - (kickAt - 1300)) / 1300)));
      const sx = -3.2 + 2.75 * u;
      const sz = -2.6 + 2.1 * u;
      kicker.position.copy(v3(sx, Math.abs(Math.sin(u * 12)) * 0.05 * (1 - u), sz));
      // Facing the way it runs, towards the ball.
      kicker.rotation.y = Math.atan2(-2.75, 2.1);
    }

    // The crowd stands up for a goal.
    const cheering = turn?.result?.goal && t >= turn.impact;
    for (const fan of stand.children) {
      if (fan.userData.jump === undefined) continue;
      fan.position.y = (fan.userData.y ??= fan.position.y) + (cheering ? Math.abs(Math.sin(t * 0.01 + fan.userData.jump)) * 0.25 : 0);
    }

    cornerFlag.update(dt, wind);
    sky2.update(dt, wind);
    air.update(dt, wind, t);
    rain.update(info, dt, wind, camera);
  }

  function resize(w, h) {
    aspect = w / h;
    camera.aspect = aspect;
    // Wide enough to see both posts on a phone held upright.
    camera.fov = aspect < 0.8 ? 2 * Math.atan(Math.tan(((40 / 2) * Math.PI) / 180) / aspect) * (180 / Math.PI) * 0.72 : 46;
    camera.updateProjectionMatrix();
  }

  // The kick: the drag's trail, the aim marker on the goal with its sway,
  // and how hard and how bent it is. Keeping goal: where the dive went.
  function ink(g, info) {
    const { turn } = info;
    if (!turn || info.phase !== "aim" || !info.aim) return;
    const a = info.aim;
    const colour = PLAYER_CSS[turn.player];
    if (a.keep) {
      if (a.tap >= 0) {
        const s = project(a.x, a.y, KEEPER_Z);
        if (s) {
          g.lineWidth = 3;
          g.strokeStyle = PLAYER_CSS[turn.keeper ?? 0];
          g.beginPath();
          g.arc(s.x, s.y, 18, 0, Math.PI * 2);
          g.stroke();
          return true;
        }
      }
      return false;
    }
    if (a.none || (!a.pulling && !a.shown)) return;
    if (a.path && a.path.length > 1) {
      g.lineCap = "round";
      g.lineJoin = "round";
      g.lineWidth = 8;
      g.strokeStyle = "rgba(255,255,255,0.6)";
      g.beginPath();
      a.path.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
    }
    const s = project(a.x, a.y, GOAL_Z);
    if (!s) return;
    g.lineWidth = 2.5;
    g.strokeStyle = colour;
    g.beginPath();
    g.arc(s.x, s.y, 14, 0, Math.PI * 2);
    g.moveTo(s.x - 22, s.y);
    g.lineTo(s.x + 22, s.y);
    g.moveTo(s.x, s.y - 22);
    g.lineTo(s.x, s.y + 22);
    g.stroke();
    // Power as a ring that fills, curl as a little bent arrow beside it.
    g.lineWidth = 4;
    g.strokeStyle = "rgba(255,255,255,0.4)";
    g.beginPath();
    g.arc(s.x, s.y, 28, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = "#ffffff";
    g.beginPath();
    g.arc(s.x, s.y, 28, -Math.PI / 2, -Math.PI / 2 + (a.power / 1000) * Math.PI * 2);
    g.stroke();
    if (Math.abs(a.curl) > 80) {
      const side = Math.sign(a.curl);
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(s.x + side * 40, s.y + 16);
      g.quadraticCurveTo(s.x + side * (40 + Math.abs(a.curl) / 40), s.y, s.x + side * 40, s.y - 16);
      g.stroke();
    }
    return true;
  }

  return { scene, camera, update, resize, setMode, bloomBoost: rain.bloomBoost, weather: rain, ink, module: kicks };
}
