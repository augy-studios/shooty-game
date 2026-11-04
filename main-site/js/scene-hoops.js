// The court: an outdoor half court with its lines painted on, a hoop on a
// pole with a glass backboard and a net, five spots round the arc, a fence
// and trees behind, and a flag that shows the wind. The camera stands
// behind the shooter at each spot in turn; the ball is in their hands at
// the bottom of the screen until it goes.

import { THREE, mesh, mat, outline, v3, lights, motes, canvasTexture, project, smooth, shadowsOn } from "./scene.js";
import { weather, groundHits } from "./scene-weather.js";
import { tree, hills, clouds, flag, scenery } from "./scene-props.js";
import { pathAt, SAMPLE_MS } from "./physics.js";
import { RIM_Y, RIM_R, BALL, BOARD_Z, BOARD, THREE as THREE_LINE, SPOT_ANGLES, hoops, rimX } from "./sim-hoops.js";
import { INTRO_MS } from "./rules.js";

const PLAYER_CSS = ["#e2464f", "#1f8fd6"];
const BASELINE = BOARD_Z + 1.2;

function courtTexture() {
  // 16 m across (x) by 12 m deep (z, from the baseline out), 64 px a metre.
  const W = 16;
  const D = 12;
  const k = 64;
  return canvasTexture(W * k, D * k, (g) => {
    g.fillStyle = "#3d72a8";
    g.fillRect(0, 0, W * k, D * k);
    g.fillStyle = "#e2784a";
    // The key, in a warmer colour.
    const cx = (W / 2) * k;
    // From the baseline to the board, then to the middle of the rim.
    const hoopY = 1.2 * k;
    g.fillRect(cx - 2.45 * k, 0, 4.9 * k, 5.8 * k);
    g.strokeStyle = "#ffffff";
    g.lineWidth = 0.05 * k;
    g.strokeRect(cx - 2.45 * k, 0, 4.9 * k, 5.8 * k);
    g.beginPath();
    g.arc(cx, 5.8 * k, 1.8 * k, 0, Math.PI);
    g.stroke();
    // The three point line: straight in the corners, then the arc.
    const hoop = hoopY + BOARD_Z * k;
    const r = THREE_LINE * k;
    const corner = 6.6 * k;
    const meet = Math.sqrt(r * r - corner * corner);
    g.beginPath();
    g.moveTo(cx - corner, 0);
    g.lineTo(cx - corner, hoop + meet);
    g.arc(cx, hoop, r, Math.PI - Math.asin(meet / r), Math.asin(meet / r), true);
    g.lineTo(cx + corner, 0);
    g.stroke();
    // The baseline.
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, W * k, 0.06 * k);
  });
}

function ballTexture() {
  return canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = "#f07a2a";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#2a1a10";
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    for (const x of [w / 4, (3 * w) / 4]) {
      g.moveTo(x, 0);
      g.lineTo(x, h);
    }
    g.stroke();
    g.beginPath();
    g.ellipse(w / 2, h / 2, w * 0.18, h * 0.5, 0, 0, Math.PI * 2);
    g.stroke();
  });
}

function boardTexture() {
  return canvasTexture(366, 214, (g, w, h) => {
    g.fillStyle = "#f7fbff";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#e2464f";
    g.lineWidth = 8;
    g.strokeRect(4, 4, w - 8, h - 8);
    // The shooter's square over the rim, 59 by 45 cm.
    g.strokeRect(w / 2 - 59, h - 15 - 90, 118, 90);
  });
}

export function create() {
  const scene = new THREE.Scene();
  const rand = scenery(5);
  const sky = new THREE.Color(0xa4e4f6);
  scene.background = sky;
  scene.fog = new THREE.Fog(0xa4e4f6, 60, 200);
  const light = lights(scene, { sun: [6, 18, -8], target: [0, 0, -2], span: 16 });

  const grass = mesh(new THREE.PlaneGeometry(120, 120), 0x6ec04f);
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.01;
  grass.castShadow = false;
  scene.add(grass);
  const court = mesh(new THREE.PlaneGeometry(16, 12), mat(0xffffff, { map: courtTexture() }));
  court.rotation.x = -Math.PI / 2;
  // The texture's top edge is the baseline, behind the hoop.
  court.rotation.z = Math.PI;
  court.position.copy(v3(0, 0, BASELINE - 6));
  court.castShadow = false;
  scene.add(court);
  const apron = mesh(new THREE.PlaneGeometry(19, 15), 0x7d8f99);
  apron.rotation.x = -Math.PI / 2;
  apron.position.copy(v3(0, -0.005, BASELINE - 6));
  apron.castShadow = false;
  scene.add(apron);

  // The hoop: pole, arm, board, rim and net, all of which move together
  // in the old Hard matches (before rules 3) that had it drift.
  const hoop = new THREE.Group();
  const pole = mesh(new THREE.CylinderGeometry(0.09, 0.11, 3.6, 12), 0x30414d);
  pole.position.set(0, 1.8, BASELINE + 0.4);
  hoop.add(pole);
  const arm = mesh(new THREE.BoxGeometry(0.12, 0.12, BASELINE + 0.4 - BOARD_Z), 0x30414d);
  arm.position.set(0, 3.45, (BASELINE + 0.4 + BOARD_Z) / 2);
  hoop.add(arm);
  const glass = mesh(new THREE.BoxGeometry(BOARD.half * 2, BOARD.top - BOARD.bottom, 0.05), mat(0xffffff, { map: boardTexture() }));
  glass.position.set(0, (BOARD.top + BOARD.bottom) / 2, BOARD_Z + 0.025);
  outline(glass, 0.02);
  hoop.add(glass);
  const rim = mesh(new THREE.TorusGeometry(RIM_R + 0.009, 0.011, 8, 40), 0xff6a1f);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, RIM_Y, 0);
  hoop.add(rim);
  const bracket = mesh(new THREE.BoxGeometry(0.12, 0.06, 0.16), 0xff6a1f);
  bracket.position.set(0, RIM_Y - 0.02, BOARD_Z - 0.07);
  hoop.add(bracket);
  // The net: rings and strands, narrowing down 45 cm.
  const RINGS = 5;
  const STRANDS = 16;
  const netPts = [];
  for (let r = 0; r <= RINGS; r++) {
    for (let s = 0; s < STRANDS; s++) netPts.push(0, 0, 0);
  }
  const netIdx = [];
  for (let r = 0; r <= RINGS; r++) {
    for (let s = 0; s < STRANDS; s++) {
      const a = r * STRANDS + s;
      if (r < RINGS) netIdx.push(a, (r + 1) * STRANDS + ((s + 1) % STRANDS), a, (r + 1) * STRANDS + ((s + STRANDS - 1) % STRANDS));
    }
  }
  const netGeo = new THREE.BufferGeometry();
  netGeo.setAttribute("position", new THREE.Float32BufferAttribute(netPts, 3));
  netGeo.setIndex(netIdx);
  const net = new THREE.LineSegments(netGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
  hoop.add(net);
  scene.add(hoop);

  // The spots round the arc.
  const spotMarks = SPOT_ANGLES.map(() => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), mat(0xffffff));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.012;
    scene.add(m);
    return m;
  });
  const here = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.34, 32), new THREE.MeshBasicMaterial({ color: 0xffd33f }));
  here.rotation.x = -Math.PI / 2;
  here.position.y = 0.013;
  scene.add(here);

  // Round the court.
  const fence = new THREE.Mesh(new THREE.PlaneGeometry(22, 3.2), new THREE.MeshBasicMaterial({ color: 0x3a4a52, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  fence.position.copy(v3(0, 1.6, BASELINE + 2.6));
  scene.add(fence);
  for (let x = -11; x <= 11; x += 2.75) {
    const post = mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 6), 0x3a4a52);
    post.position.copy(v3(x, 1.6, BASELINE + 2.6));
    scene.add(post);
  }
  for (let i = 0; i < 12; i++) tree(scene, -26 + i * 4.6 + rand() * 2, BASELINE + 7 + rand() * 6, 1.2 + rand() * 0.6, rand);
  for (let i = 0; i < 8; i++) tree(scene, (i % 2 ? 1 : -1) * (12 + rand() * 6), -10 + i * 2.5, 1 + rand() * 0.5, rand);
  hills(scene, 90, undefined, rand);
  const sky2 = clouds(scene, { z: 110, y: 36 }, rand);
  const windFlag = flag(scene, 7.6, BASELINE + 1.8, { height: 5, color: 0xffd33f });
  const air = motes(scene, { box: [14, 5, 14], centre: [0, 2.5, -2], count: 110 });
  const rain = weather(scene, {
    light,
    clouds: sky2,
    box: [18, 9, 20],
    centre: [0, 4.5, -3],
    ground: { w: 120, d: 120, x: 0, z: 0 },
    pools: { w: 17, d: 13, x: 0, z: BASELINE - 7 },
    paved: { w: 19, d: 15, x: 0, z: BASELINE - 6 },
    bolt: { z: 90, y: 75, spread: 40 },
    rand,
  });

  const ball = mesh(new THREE.SphereGeometry(BALL, 24, 16), mat(0xffffff, { map: ballTexture() }));
  outline(ball, 0.006);
  scene.add(ball);
  // A soft dark disc under the ball, for Low graphics only: on High the
  // light casts the ball's real shadow, and the two together made two.
  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(BALL, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
  ballShadow.rotation.x = -Math.PI / 2;
  scene.add(ballShadow);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 400);
  let lastT = 0;
  let aspect = 1;
  let prevCam = null;

  function setMode(dusk) {
    const c = dusk ? 0x283a5c : 0xa4e4f6;
    sky.set(c);
    scene.fog.color.set(c);
    sky2.material.color.set(dusk ? 0x5b6a8c : 0xffffff);
    light.set(dusk);
    rain.setMode(dusk);
  }

  // Where the camera stands for a turn: behind and above the shooter.
  function camFor(cond) {
    const back = 2.4;
    return {
      x: cond.feet.x - cond.toward.x * back,
      y: 2.35,
      z: cond.feet.z - cond.toward.z * back,
    };
  }

  function setNet(hx, ballPos, made) {
    const a = netGeo.attributes.position.array;
    for (let r = 0; r <= RINGS; r++) {
      const depth = (r / RINGS) * 0.45;
      let radius = RIM_R + (0.13 - RIM_R) * (r / RINGS);
      let sx = 0;
      let sz = 0;
      if (ballPos && made) {
        const dy = RIM_Y - depth - ballPos.y;
        // Only a ball in the hoop, over the rim, pushes the net out. Going
        // by height alone, a made shot still rising past rim height metres
        // out dragged the whole net out towards it, and the basket seemed
        // to swell as the ball went up.
        const across = Math.hypot(ballPos.x - hx, ballPos.z);
        const inHoop = Math.max(0, 1 - across / (RIM_R + BALL));
        const near = Math.max(0, 1 - Math.abs(dy) / 0.25) * inHoop;
        radius = Math.max(radius, (BALL + 0.02) * near + radius * (1 - near));
        sx = (ballPos.x - hx) * near * 0.6;
        sz = ballPos.z * near * 0.6;
      }
      for (let s = 0; s < STRANDS; s++) {
        const ang = (s / STRANDS) * Math.PI * 2 + (r % 2 ? Math.PI / STRANDS : 0);
        const k = (r * STRANDS + s) * 3;
        a[k] = -(Math.cos(ang) * radius + sx);
        a[k + 1] = RIM_Y - depth;
        a[k + 2] = Math.sin(ang) * radius + sz;
      }
    }
    netGeo.attributes.position.needsUpdate = true;
  }

  function update(info) {
    const { state, t, turn } = info;
    const dt = Math.min(0.1, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    const cond = turn?.cond;
    const wind = cond?.wind ?? { x: 0, z: 0, speed: 0 };

    // The hoop: still, but for a replay of an old Hard match that drifts.
    const hx = cond ? rimX(cond, t - turn.aimStart) : 0;
    hoop.position.x = -hx;

    // The spots of this round.
    if (cond) {
      const growth = state.g.rounds > 1 ? turn.round / (state.g.rounds - 1) : 1;
      const radius = 4.4 + 3.2 * growth;
      spotMarks.forEach((m, k) => {
        const ang = (SPOT_ANGLES[k] * Math.PI) / 180;
        m.position.x = -radius * Math.sin(ang);
        m.position.z = -radius * Math.cos(ang);
      });
      spotMarks[turn.spot].position.x = -cond.feet.x;
      spotMarks[turn.spot].position.z = cond.feet.z;
      here.position.x = -cond.feet.x;
      here.position.z = cond.feet.z;
    }

    // The camera, moving between spots in the intro.
    if (cond) {
      const to = camFor(cond);
      let at = to;
      if (info.phase === "intro" && prevCam) {
        const u = smooth(info.since / INTRO_MS);
        at = { x: prevCam.x + (to.x - prevCam.x) * u, y: to.y, z: prevCam.z + (to.z - prevCam.z) * u };
      } else if (info.phase !== "intro") prevCam = to;
      camera.position.copy(v3(at.x, at.y, at.z));
      camera.lookAt(v3(hx * 0.5, RIM_Y - 0.55, 0));
    } else {
      camera.position.set(0, 2.4, -7.5);
      camera.lookAt(0, RIM_Y - 0.6, 0);
    }

    // The ball: in hand, then in the air.
    let pos = null;
    let made = false;
    if (turn) {
      if (turn.result && t >= turn.release && !turn.result.none) {
        pos = pathAt(turn.result.path, t - turn.release);
        // Each bounce on the wet court splashes.
        const path = turn.result.path;
        rain.track(`h${turn.i}`, () => groundHits(path, BALL, SAMPLE_MS), t - turn.release);
        made = turn.result.made;
        ball.rotation.x -= dt * 9;
      } else if (cond) {
        const pull = info.aim?.pulling ? (info.aim.power ?? 0) / 1000 : 0;
        const f = cond.from;
        pos = { x: f.x - cond.toward.x * (0.2 + pull * 0.25), y: f.y - 0.55 - pull * 0.25, z: f.z - cond.toward.z * (0.2 + pull * 0.25) };
      }
    }
    ball.visible = Boolean(pos) && !(info.phase === "settle" && info.since > turn.result?.settleMs - 250);
    if (pos) {
      ball.position.copy(v3(pos.x, pos.y, pos.z));
      ballShadow.position.copy(v3(pos.x, 0.012, pos.z));
      ballShadow.scale.setScalar(1 + pos.y * 0.15);
      ballShadow.material.opacity = Math.max(0.05, 0.3 - pos.y * 0.05);
    }
    ballShadow.visible = ball.visible && !shadowsOn();
    setNet(hx, pos, made);

    windFlag.update(dt, wind);
    sky2.update(dt, wind);
    air.update(dt, wind, t);
    rain.update(info, dt, wind, camera);
  }

  function resize(w, h) {
    aspect = w / h;
    camera.aspect = aspect;
    camera.fov = aspect < 0.8 ? 62 : 48;
    camera.updateProjectionMatrix();
  }

  // The aim: an arrow from the ball the way it is pointed, and a power
  // meter beside it; on Easy, the band where a still air shot drops in.
  function ink(g, info) {
    const { turn } = info;
    if (!turn || info.phase !== "aim" || !info.aim || info.aim.none) return;
    const a = info.aim;
    const cond = turn.cond;
    const f = cond.from;
    const b = project(f.x - cond.toward.x * 0.2, f.y - 0.55, f.z - cond.toward.z * 0.2);
    if (!b) return;
    const W = g.canvas.clientWidth || window.innerWidth;
    const H = g.canvas.clientHeight || window.innerHeight;
    const colour = PLAYER_CSS[turn.player];

    // The direction: an arrow up from the ball, leaning with the aim.
    const lean = (a.yaw * Math.PI) / 180;
    const len = 70 + (a.power / 1000) * 90;
    const tx = b.x + Math.sin(lean * 3) * len;
    const ty = b.y - Math.cos(lean * 3) * len;
    if (a.pulling) {
      g.lineCap = "round";
      g.lineWidth = 6;
      g.strokeStyle = "rgba(255,255,255,0.9)";
      g.beginPath();
      g.moveTo(b.x, b.y - 18);
      g.lineTo(tx, ty);
      g.stroke();
      const ang = Math.atan2(ty - b.y, tx - b.x);
      g.fillStyle = "#ffffff";
      g.beginPath();
      g.moveTo(tx + Math.cos(ang) * 14, ty + Math.sin(ang) * 14);
      g.lineTo(tx + Math.cos(ang + 2.4) * 12, ty + Math.sin(ang + 2.4) * 12);
      g.lineTo(tx + Math.cos(ang - 2.4) * 12, ty + Math.sin(ang - 2.4) * 12);
      g.fill();
    }

    // The power meter, on the right, clear of the tray's foot.
    const mx = W - 34;
    const my0 = H * 0.36;
    const my1 = H * 0.78;
    g.lineCap = "round";
    g.lineWidth = 14;
    g.strokeStyle = "rgba(20,26,22,0.6)";
    g.beginPath();
    g.moveTo(mx, my0);
    g.lineTo(mx, my1);
    g.stroke();
    if (a.ideal !== undefined) {
      const band = 18;
      const iy = my1 - ((a.ideal) / 1000) * (my1 - my0);
      g.lineWidth = 14;
      g.strokeStyle = "rgba(120,230,140,0.85)";
      g.beginPath();
      g.moveTo(mx, iy - (band / 1000) * (my1 - my0));
      g.lineTo(mx, iy + (band / 1000) * (my1 - my0));
      g.stroke();
    }
    const py = my1 - (a.power / 1000) * (my1 - my0);
    g.lineWidth = 4;
    g.strokeStyle = colour;
    g.beginPath();
    g.moveTo(mx - 14, py);
    g.lineTo(mx + 14, py);
    g.stroke();
    g.fillStyle = "#ffffff";
    g.font = '12px Jua, "Segoe UI", sans-serif';
    g.textAlign = "center";
    g.fillText("Power", mx, my1 + 22);
    return true;
  }

  return { scene, camera, update, resize, setMode, bloomBoost: rain.bloomBoost, weather: rain, ink, module: hoops };
}
