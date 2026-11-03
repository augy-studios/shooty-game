// Scenery the outdoor worlds share: trees, hills, clouds and a flag that
// shows the wind. Built from boxes and cones in flat colours, so it draws
// fast on a phone and looks like the icon.

import { THREE, mesh, mat, outline, v3 } from "./scene.js";

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// A tree: a trunk and two or three blocky canopies stacked off-centre.
export function tree(scene, x, z, scale = 1, rand = Math.random) {
  const g = new THREE.Group();
  const trunk = mesh(box(0.5 * scale, 2.6 * scale, 0.5 * scale), 0x9b5a3c);
  trunk.position.y = 1.3 * scale;
  g.add(trunk);
  const greens = [0x3fae49, 0x57c25a, 0x2f9a40];
  const n = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const w = (2.2 + rand() * 1.6) * scale;
    const h = (1.4 + rand() * 0.9) * scale;
    const c = mesh(box(w, h, w * 0.8), greens[i % greens.length]);
    c.position.set((rand() - 0.5) * 1.4 * scale, (2.6 + i * 0.9 + h / 2) * scale, (rand() - 0.5) * 0.8 * scale);
    g.add(c);
    // A lighter patch on the front face, the way the icon highlights.
    const patch = new THREE.Mesh(box(w * 0.38, h * 0.32, 0.02), mat(0x8fdc7f));
    patch.position.set(c.position.x - w * 0.15, c.position.y + h * 0.18, c.position.z - (w * 0.8) / 2 - 0.02);
    g.add(patch);
  }
  g.position.copy(v3(x, 0, z));
  g.rotation.y = (rand() - 0.5) * 0.4;
  scene.add(g);
  return g;
}

// A row of bushes: low rounded boxes along a line.
export function hedge(scene, x0, x1, z, rand = Math.random) {
  for (let x = x0; x < x1; x += 1.6 + rand() * 1.2) {
    const s = 0.9 + rand() * 0.8;
    const b = mesh(new THREE.SphereGeometry(s, 10, 8), rand() < 0.5 ? 0x3cae4c : 0x4dbb55);
    b.scale.y = 0.7;
    b.position.copy(v3(x, s * 0.35, z + rand() * 1.5));
    scene.add(b);
  }
}

// Far hills, flat shaded cones, pale with distance.
export function hills(scene, z, colors = [0x9ad7c8, 0x86cdb9, 0xa8e0cf], rand = Math.random) {
  const group = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const r = 18 + rand() * 26;
    const h = 10 + rand() * 18;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5), new THREE.MeshBasicMaterial({ color: colors[i % colors.length] }));
    cone.position.copy(v3(-90 + i * 22 + rand() * 10, h / 2 - 1, z + rand() * 30));
    cone.rotation.y = rand() * Math.PI;
    group.add(cone);
  }
  scene.add(group);
  return group;
}

// Clouds: flattened white boxes in loose clumps, drifting with the wind.
export function clouds(scene, { z = 140, y = 34, spread = 160 } = {}, rand = Math.random) {
  const list = [];
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group();
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const c = new THREE.Mesh(box(6 + rand() * 8, 2 + rand() * 2, 3), white);
      c.position.set(k * 4 - n * 2, rand() * 2, rand() * 2);
      g.add(c);
    }
    g.position.copy(v3((rand() - 0.5) * spread, y + rand() * 10, z + rand() * 60));
    scene.add(g);
    list.push(g);
  }
  return {
    list,
    material: white,
    update(dt, wind) {
      for (const g of list) {
        g.position.x -= (wind?.x ?? 0) * 0.25 * dt;
        if (g.position.x > spread / 2) g.position.x -= spread;
        if (g.position.x < -spread / 2) g.position.x += spread;
      }
    },
  };
}

// A flag on a pole that points where the wind blows and flaps harder the
// harder it blows. Its cloth is a strip of quads moved in a wave.
export function flag(scene, x, z, { height = 4, color = 0xff6b6b, length = 1.3 } = {}) {
  const g = new THREE.Group();
  const pole = mesh(new THREE.CylinderGeometry(0.04, 0.05, height, 8), 0xeeeeee);
  pole.position.y = height / 2;
  outline(pole, 0.015);
  g.add(pole);
  const geo = new THREE.PlaneGeometry(length, length * 0.55, 12, 3);
  geo.translate(length / 2, 0, 0);
  const base = geo.attributes.position.array.slice();
  const cloth = new THREE.Mesh(geo, mat(color, { side: THREE.DoubleSide }));
  cloth.castShadow = true;
  const holder = new THREE.Group();
  holder.position.y = height - length * 0.3;
  holder.add(cloth);
  g.add(holder);
  g.position.copy(v3(x, 0, z));
  scene.add(g);
  let phase = 0;
  return {
    group: g,
    update(dt, wind) {
      const speed = wind?.speed ?? 0;
      // Point it the way the wind blows, in three.js's flipped x.
      const wx = -(wind?.x ?? 0);
      const wz = wind?.z ?? 0;
      if (speed > 0.05) holder.rotation.y = Math.atan2(-wz, wx);
      phase += dt * (3 + speed * 1.6);
      const a = geo.attributes.position.array;
      // Limp in still air, out straight and snapping in a gale.
      const droop = Math.max(0, 1 - speed / 5);
      for (let i = 0; i < a.length; i += 3) {
        const along = base[i] / length;
        a[i] = base[i] * (1 - droop * 0.35);
        a[i + 1] = base[i + 1] - droop * along * along * length * 0.6;
        a[i + 2] = Math.sin(phase - along * 5) * along * (0.06 + speed * 0.025);
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
}

// A seeded random for scenery, so a world looks the same every time it is
// built. Not for the game: the game's numbers come from js/seed.js.
export function scenery(seed = 7) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
