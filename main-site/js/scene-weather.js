// The weather made visible, for the outdoor worlds: a grey sky, rain
// falling and blowing with the wind, drops splashing on the ground, the
// ground darkened and puddled where it is wet, and lightning.
//
// It only draws. Whether it rains is the match's (js/sim-shared.js
// weatherFor), and when it flashes is js/weather.js's, so a replay shows
// the same storm.
//
// The rain is drawn to scale. Light rain is drops of about a millimetre,
// which fall at about 4 m/s; a thunderstorm's are two or three
// millimetres, falling at 6 to 8. Every drop drifts with the wind, which
// is moving the air it falls through, so the rain slants as hard as the
// wind blows. Each is a streak about as long as it falls in a fiftieth of
// a second, which is how a falling drop looks to the eye.

import { THREE, v3 } from "./scene.js";
import { flashAt } from "./weather.js";

const KINDS = {
  dry: { level: 0, fall: 0, density: 0 },
  rain: { level: 0.65, fall: 4.2, density: 0.45 },
  storm: { level: 1, fall: 7, density: 1 },
};
const STREAK_S = 0.05;
const SPLASHES = 90;
const SPLASH_S = 0.28;

// Overcast skies, day and dusk, for light rain and for a storm.
const OVERCAST = {
  day: { rain: new THREE.Color(0xa7b3bd), storm: new THREE.Color(0x6d7984) },
  dusk: { rain: new THREE.Color(0x27304a), storm: new THREE.Color(0x181d2c) },
};
const FLASH_SKY = new THREE.Color(0xe4e9ff);
const WET_CLOUD = { day: new THREE.Color(0x8a959f), dusk: new THREE.Color(0x3a4258) };

// scene: the world's. light: its rig from scene.js lights(). clouds: from
// scene-props.js clouds(). box, centre: where the rain falls, in game
// coordinates (as for scene.js motes). ground: { w, d, x, z }, the wet
// ground's extent. bolt: { z, y, spread }, where in the sky lightning
// comes down: in front of the clouds, from above the top of the view. count: the most drops at once, in a storm. pools: { w, d,
// x, z }, where puddles lie, placed with `rand` (the world's scenery
// random) so they are in the same places every time.
export function weather(scene, { light, clouds, box, centre, count = 1600, ground, pools = ground, bolt, puddles = 10, rand = Math.random }) {
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);

  /* the rain */
  const pos = new Float32Array(count * 6);
  const drops = new Float32Array(count * 3);
  const half = box.map((b) => b / 2);
  // In three.js coordinates, where x is flipped (see scene.js v3).
  const c3 = [-centre[0], centre[1], centre[2]];
  const respawn = (i, anywhere) => {
    drops[i * 3] = c3[0] + (Math.random() - 0.5) * box[0];
    drops[i * 3 + 1] = anywhere ? c3[1] + (Math.random() - 0.5) * box[1] : c3[1] + half[1] * (0.6 + 0.4 * Math.random());
    drops[i * 3 + 2] = c3[2] + (Math.random() - 0.5) * box[2];
  };
  for (let i = 0; i < count; i++) respawn(i, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0xd4dde8, transparent: true, opacity: 0.55, depthWrite: false });
  const streaks = new THREE.LineSegments(geo, rainMat);
  streaks.frustumCulled = false;
  root.add(streaks);

  /* the splashes: rings that open and fade where drops land */
  const splashMat = new THREE.MeshBasicMaterial({ color: 0xe8eef5, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
  const ringGeo = new THREE.RingGeometry(0.7, 1, 12);
  ringGeo.rotateX(-Math.PI / 2);
  const splashes = new THREE.InstancedMesh(ringGeo, splashMat, SPLASHES);
  splashes.frustumCulled = false;
  const ages = new Float32Array(SPLASHES).fill(SPLASH_S);
  const at = new Float32Array(SPLASHES * 2);
  let nextSplash = 0;
  const m4 = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < SPLASHES; i++) splashes.setMatrixAt(i, hidden);
  root.add(splashes);

  /* the wet ground: darker, with puddles that hold the sky */
  const sheenMat = new THREE.MeshBasicMaterial({ color: 0x14202c, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const sheen = new THREE.Mesh(new THREE.PlaneGeometry(ground.w, ground.d), sheenMat);
  sheen.rotation.x = -Math.PI / 2;
  sheen.position.copy(v3(ground.x, 0.018, ground.z));
  sheen.renderOrder = 1;
  root.add(sheen);
  const puddleMat = new THREE.MeshBasicMaterial({ color: 0xb9c7d6, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const puddleGeo = new THREE.CircleGeometry(1, 20);
  puddleGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < puddles; i++) {
    const p = new THREE.Mesh(puddleGeo, puddleMat);
    const r = 0.18 + rand() * 0.45;
    p.scale.set(r * (1 + rand()), 1, r);
    p.rotation.y = rand() * Math.PI;
    p.position.copy(v3(pools.x + (rand() - 0.5) * pools.w, 0.02, pools.z + (rand() - 0.5) * pools.d));
    p.renderOrder = 2;
    root.add(p);
  }

  /* lightning: a jagged ribbon of quads, far brighter than white so the
     bloom lights the sky round it */
  const boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.3, 4), transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
  const boltGeo = new THREE.BufferGeometry();
  const boltMesh = new THREE.Mesh(boltGeo, boltMat);
  boltMesh.frustumCulled = false;
  boltMesh.visible = false;
  root.add(boltMesh);
  let boltFor = -1;

  function buildBolt(s) {
    let seed = s.shape >>> 0;
    const r = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    // Further strikes a little further back, and thinner; always in front
    // of the clouds, which it comes down out of.
    const z = bolt.z * (0.9 + 0.05 * s.km);
    const top = bolt.y;
    const x0 = -s.bearing * bolt.spread;
    const width = Math.max(0.35, 1.2 - s.km * 0.12) * (z / 200);
    const quads = [];
    const run = (x, y, yEnd, w, steps, branchy) => {
      const dy = (y - yEnd) / steps;
      for (let i = 0; i < steps; i++) {
        const nx = x + (r() - 0.5) * dy * 1.1;
        const ny = y - dy * (0.7 + 0.6 * r());
        quads.push([x, y, nx, ny, w]);
        if (branchy && r() < 0.22 && ny > yEnd + dy * 2) run(nx, ny, ny - (y - yEnd) * (0.15 + 0.2 * r()), w * 0.5, 4, false);
        x = nx;
        y = Math.max(yEnd, ny);
      }
    };
    run(x0, top, 0, width, 14, true);
    const p = new Float32Array(quads.length * 18);
    quads.forEach(([ax, ay, bx, by, w], i) => {
      // A quad across the segment, facing the camera down the range.
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const ox = (-dy / len) * w * 0.5;
      const oy = (dx / len) * w * 0.5;
      const v = [ax - ox, ay - oy, z, ax + ox, ay + oy, z, bx + ox, by + oy, z, ax - ox, ay - oy, z, bx + ox, by + oy, z, bx - ox, by - oy, z];
      p.set(v, i * 18);
    });
    boltGeo.setAttribute("position", new THREE.BufferAttribute(p, 3));
    boltGeo.computeBoundingSphere();
  }

  /* the sky and the light, as the world set them for day or dusk */
  let dusk = false;
  const base = { sky: new THREE.Color(), fog: new THREE.Color(), near: 0, far: 0, cloud: new THREE.Color(), hemi: 0, dir: 0 };
  function setMode(isDusk) {
    dusk = isDusk;
    base.sky.copy(scene.background);
    base.fog.copy(scene.fog.color);
    base.near = scene.fog.near;
    base.far = scene.fog.far;
    base.cloud.copy(clouds.material.color);
    base.hemi = light.hemi.intensity;
    base.dir = light.dir.intensity;
  }
  setMode(false);

  let flashNow = 0;
  const tmp = new THREE.Color();

  function update(info, dt, wind) {
    const w = info.state?.weather ?? info.turn?.cond?.weather;
    const kind = KINDS[w?.kind] ?? KINDS.dry;
    const a = kind.level;
    const { flash, strike } = a ? flashAt(w, info.state.seedNum, info.t) : { flash: 0, strike: null };
    flashNow = flash;

    // The sky greys over, the far distance closes in, the sun goes in.
    const over = OVERCAST[dusk ? "dusk" : "day"][w?.kind === "storm" ? "storm" : "rain"];
    tmp.copy(base.sky).lerp(over, a).lerp(FLASH_SKY, flash * 0.9);
    scene.background.copy(tmp);
    scene.fog.color.copy(base.fog).lerp(over, a).lerp(FLASH_SKY, flash * 0.5);
    scene.fog.near = base.near * (1 - 0.45 * a);
    scene.fog.far = base.far * (1 - 0.4 * a);
    clouds.material.color.copy(base.cloud).lerp(WET_CLOUD[dusk ? "dusk" : "day"], a).lerp(FLASH_SKY, flash * 0.6);
    light.hemi.intensity = base.hemi * (1 - 0.3 * a) + flash * 2.4;
    light.dir.intensity = base.dir * (1 - 0.6 * a);

    root.visible = a > 0;
    if (!root.visible) return;

    sheenMat.opacity = 0.2 * a;
    puddleMat.opacity = 0.2 * a + 0.3 * flash;
    puddleMat.color.copy(over).lerp(FLASH_SKY, flash);

    // The bolt, near enough to see, from the storm only.
    const seen = strike && w.kind === "storm" && strike.km < 5 && flash > 0.04;
    if (seen && boltFor !== strike.k) {
      buildBolt(strike);
      boltFor = strike.k;
    }
    boltMesh.visible = Boolean(seen);
    boltMat.opacity = seen ? Math.min(1, flash * 1.6) : 0;

    // The drops: down at their speed, along with the wind.
    const n = Math.round(count * kind.density);
    const wx = -(wind?.x ?? 0);
    const wz = wind?.z ?? 0;
    const fall = kind.fall;
    const floorY = 0;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      drops[k] += wx * dt;
      drops[k + 1] -= fall * dt;
      drops[k + 2] += wz * dt;
      if (drops[k + 1] < floorY) {
        // A splash where it lands, now and then, nearest the camera most.
        if (Math.random() < 0.5) {
          const s = nextSplash;
          nextSplash = (nextSplash + 1) % SPLASHES;
          ages[s] = 0;
          at[s * 2] = drops[k];
          at[s * 2 + 1] = drops[k + 2];
        }
        respawn(i, false);
      }
      // Blown out of the box: back in on the other side.
      for (const j of [0, 2]) {
        const d = drops[k + j] - c3[j];
        if (d > half[j]) drops[k + j] -= box[j];
        else if (d < -half[j]) drops[k + j] += box[j];
      }
      const p = i * 6;
      pos[p] = drops[k];
      pos[p + 1] = drops[k + 1];
      pos[p + 2] = drops[k + 2];
      pos[p + 3] = drops[k] - wx * STREAK_S;
      pos[p + 4] = drops[k + 1] + fall * STREAK_S;
      pos[p + 5] = drops[k + 2] - wz * STREAK_S;
    }
    geo.setDrawRange(0, n * 2);
    geo.attributes.position.needsUpdate = true;
    rainMat.opacity = (dusk ? 0.4 : 0.55) + flash * 0.4;

    for (let s = 0; s < SPLASHES; s++) {
      if (ages[s] >= SPLASH_S) {
        splashes.setMatrixAt(s, hidden);
        continue;
      }
      ages[s] += dt;
      const u = Math.min(1, ages[s] / SPLASH_S);
      const r = 0.015 + 0.09 * u * (0.6 + 0.4 * kind.density);
      m4.makeScale(r * (1 - u * 0.3), 1, r * (1 - u * 0.3));
      m4.setPosition(at[s * 2], 0.025, at[s * 2 + 1]);
      splashes.setMatrixAt(s, m4);
    }
    splashes.instanceMatrix.needsUpdate = true;
  }

  return { setMode, update, bloomBoost: () => 1 + 2 * flashNow };
}
