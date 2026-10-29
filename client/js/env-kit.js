// Shared building blocks of the art-directed environments (Night Arena, Mediterranean Club): procedural PBR textures, seating tiers,
// spectators, vegetation, floodlights and furniture. Everything repeated is merged into one geometry or drawn with an InstancedMesh,
// and everything is created inside the environment group so it is disposed with it. No gameplay geometry lives here.
// The geometry builders do not touch the DOM (they are unit-tested in Node); only the texture helpers need a canvas.
import * as THREE from 'three';
import { mergeGeometries } from '/vendor/three/examples/jsm/utils/BufferGeometryUtils.js';

/** Small seeded generator: the same environment looks the same every time. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const std = (color, rough = 0.85, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });

// ------------------------------------------------------------------ textures (canvas, 256-512 px, tiled with variation)

export function tex(w, h, draw, { repeat, srgb = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
const noise = (g, w, h, n, a, dark = true) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${dark ? '40,30,20' : '255,250,240'},${Math.random() * a})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); } };

/** Plaster / stucco: soft blotches, fine grain, faint vertical weathering. */
export function plasterTex(base = '#eee5d3', repeat = [3, 3]) {
  return tex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${120 + Math.random() * 60 | 0},${100 + Math.random() * 40 | 0},${70 + Math.random() * 30 | 0},${0.025 + Math.random() * 0.04})`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 50, 14 + Math.random() * 40, 0, 0, 6.3); g.fill(); }
    for (let i = 0; i < 18; i++) { const x = Math.random() * w; const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(90,70,50,0)'); gr.addColorStop(0.6, `rgba(90,70,50,${0.02 + Math.random() * 0.03})`); gr.addColorStop(1, 'rgba(90,70,50,0)'); g.fillStyle = gr; g.fillRect(x, 0, 2 + Math.random() * 5, h); }
    noise(g, w, h, 1400, 0.1);
  }, { repeat });
}
/** Limestone blocks with joints and per-block tone. */
export function limestoneTex(repeat = [4, 2]) {
  return tex(512, 256, (g, w, h) => {
    const bh = 32;
    for (let r = 0; r * bh < h; r++) {
      const bw = 64 + (r % 3) * 16;
      for (let x = -((r % 2) * bw / 2); x < w; x += bw) {
        const t = Math.random(); g.fillStyle = `rgb(${214 + t * 22 | 0},${200 + t * 22 | 0},${170 + t * 24 | 0})`; g.fillRect(x, r * bh, bw, bh);
        for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(110,90,60,${Math.random() * 0.07})`; g.fillRect(x + Math.random() * bw, r * bh + Math.random() * bh, 1 + Math.random() * 3, 1); }
      }
      g.fillStyle = 'rgba(80,66,46,.55)'; g.fillRect(0, r * bh, w, 2);
    }
    g.fillStyle = 'rgba(80,66,46,.45)'; for (let r = 0; r * bh < h; r++) { const bw = 64 + (r % 3) * 16; for (let x = -((r % 2) * bw / 2); x < w; x += bw) g.fillRect(x, r * bh, 2, bh); }
  }, { repeat });
}
/** Timber: planks with grain lines, knots and a warm tone. */
export function timberTex(base = [150, 104, 62], horizontal = true, repeat = [2, 2]) {
  return tex(256, 256, (g, w, h) => {
    const n = 8, pw = (horizontal ? h : w) / n;
    for (let i = 0; i < n; i++) {
      const t = 0.88 + Math.random() * 0.2; g.fillStyle = `rgb(${base[0] * t | 0},${base[1] * t | 0},${base[2] * t | 0})`;
      if (horizontal) g.fillRect(0, i * pw, w, pw); else g.fillRect(i * pw, 0, pw, h);
      for (let k = 0; k < 26; k++) { g.strokeStyle = `rgba(60,38,20,${0.05 + Math.random() * 0.12})`; g.lineWidth = 0.6 + Math.random(); g.beginPath(); const o = i * pw + Math.random() * pw; if (horizontal) { g.moveTo(0, o); g.bezierCurveTo(w * 0.3, o + Math.random() * 3 - 1.5, w * 0.7, o + Math.random() * 3 - 1.5, w, o); } else { g.moveTo(o, 0); g.bezierCurveTo(o + Math.random() * 3 - 1.5, h * 0.3, o + Math.random() * 3 - 1.5, h * 0.7, o, h); } g.stroke(); }
      g.fillStyle = 'rgba(35,22,12,.55)'; if (horizontal) g.fillRect(0, i * pw, w, 1.5); else g.fillRect(i * pw, 0, 1.5, h);
    }
  }, { repeat });
}
/** Concrete with panel joints and fine speckle. */
export function concreteTex(base = '#8a8d92', repeat = [4, 4]) {
  return tex(256, 256, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); noise(g, w, h, 2600, 0.14); noise(g, w, h, 800, 0.08, false); g.fillStyle = 'rgba(30,32,36,.45)'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h); }, { repeat });
}
/** Large stone paving slabs, warm and slightly irregular. */
export function pavingTex(repeat = [10, 10]) {
  return tex(512, 512, (g, w, h) => {
    const s = 128;
    for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) { const t = Math.random(); g.fillStyle = `rgb(${206 + t * 20 | 0},${190 + t * 20 | 0},${158 + t * 22 | 0})`; g.fillRect(x, y, s, s); for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(120,96,64,${Math.random() * 0.07})`; g.fillRect(x + Math.random() * s, y + Math.random() * s, 1 + Math.random() * 4, 1 + Math.random() * 2); } }
    g.fillStyle = 'rgba(96,78,54,.6)'; for (let i = 0; i <= w; i += s) { g.fillRect(i, 0, 3, h); g.fillRect(0, i, w, 3); }
  }, { repeat });
}
/** Vertical gradient for skies. */
export function gradientTex(stops, h = 256) {
  return tex(4, h, (g, w, hh) => { const gr = g.createLinearGradient(0, 0, 0, hh); stops.forEach(([p, c]) => gr.addColorStop(p, c)); g.fillStyle = gr; g.fillRect(0, 0, w, hh); }, { aniso: 1 });
}
/** A soft round glow (floodlight glare, sun). */
export function glowTex(inner = 'rgba(255,248,230,1)', outer = 'rgba(255,248,230,0)') {
  return tex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, inner); gr.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.45)')); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, { aniso: 1 });
}

// ------------------------------------------------------------------ geometry helpers

const T = (g, x = 0, y = 0, z = 0) => g.translate(x, y, z);
/** Merge a list of geometries (all converted to the same attributes) into one. */
export function merge(list) { return mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false); }
/** Paint a whole geometry with one colour (vertex colours, used with vertexColors materials / instance colours). */
export function paint(g, color) {
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}
/** Remove the uv attribute (so geometries painted and unpainted can be merged). */
const strip = (g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g; };
const prep = (g, color) => { strip(g); if (!g.attributes.normal) g.computeVertexNormals(); return paint(g, color); };

// ------------------------------------------------------------------ seating and spectators

/** One stadium seat: pan and tilted backrest (about 0.45 m wide). */
export function seatGeometry() {
  const pan = new THREE.BoxGeometry(0.44, 0.05, 0.4); T(pan, 0, 0.42, 0);
  const back = new THREE.BoxGeometry(0.44, 0.38, 0.05); back.rotateX(-0.12); T(back, 0, 0.64, 0.19);
  const g = merge([prep(pan, 0xffffff), prep(back, 0xffffff)]);
  return g;
}

/**
 * A straight bank of seating tiers. `o` is the front-left corner at floor level, `along` runs the length of the bank, `up` is the
 * direction the tiers climb away from the court (both unit vectors on the ground). Returns the structure meshes added to `group`
 * and the seat positions (x, y, z, facing angle) so spectators can be placed on them.
 */
export function seatingBank(group, cfg) {
  const { origin, along, away, rows = 7, length = 24, rise = 0.42, run = 0.85, seatStep = 0.52, concrete, dark, aisle = 6, seatColors, rand = rng(7) } = cfg;
  const seats = [];
  const meshes = [];
  const alongV = new THREE.Vector3(...along), awayV = new THREE.Vector3(...away), o = new THREE.Vector3(...origin);
  const yaw = Math.atan2(awayV.x, awayV.z); // the backrest (local +z) points away from the court, so the seat faces it
  const basis = (a, b) => new THREE.Matrix4().makeBasis(alongV, new THREE.Vector3(0, 1, 0), awayV).setPosition(o.clone().addScaledVector(alongV, a).addScaledVector(awayV, b));
  // tiers: one slab per row (merged), a front fascia and dark support frames under the bank
  const steps = [];
  for (let r = 0; r < rows; r++) {
    const h = rise * (r + 1), g = new THREE.BoxGeometry(length, h, run); g.translate(length / 2, h / 2, r * run + run / 2); steps.push(prep(g, 0xffffff));
  }
  const stepMesh = new THREE.Mesh(merge(steps), concrete); stepMesh.applyMatrix4(new THREE.Matrix4().makeBasis(alongV, new THREE.Vector3(0, 1, 0), awayV).setPosition(o)); stepMesh.receiveShadow = true; group.add(stepMesh); meshes.push(stepMesh);
  const frames = [];
  for (let a = 0; a <= length; a += 4) { const g = new THREE.BoxGeometry(0.14, rise * rows, 0.14); g.translate(a, rise * rows / 2, rows * run + 0.1); frames.push(prep(g, 0xffffff)); }
  const rail = new THREE.BoxGeometry(length, 0.1, 0.1); rail.translate(length / 2, rise * rows - 0.05, rows * run + 0.1); frames.push(prep(rail, 0xffffff));
  const lowRail = new THREE.BoxGeometry(length, 0.9, 0.04); lowRail.translate(length / 2, rise + 0.45, -0.08); frames.push(prep(lowRail, 0xffffff)); // balustrade at the front
  const frameMesh = new THREE.Mesh(merge(frames), dark); frameMesh.applyMatrix4(new THREE.Matrix4().makeBasis(alongV, new THREE.Vector3(0, 1, 0), awayV).setPosition(o)); group.add(frameMesh); meshes.push(frameMesh);
  // seats: instanced, with aisles every `aisle` seats and a few colour sections
  const pos = [];
  for (let r = 0; r < rows; r++) {
    const y = rise * (r + 1), b = r * run + run * 0.55;
    let k = 0;
    for (let a = seatStep / 2 + 0.3; a < length - 0.3; a += seatStep, k++) {
      if (k % (aisle * 2 + 1) === aisle * 2) continue; // aisle
      pos.push([a, y, b]);
    }
  }
  const sg = seatGeometry();
  const seatMat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05, vertexColors: true });
  const im = new THREE.InstancedMesh(sg, seatMat, pos.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  const cols = seatColors || [0x1c2a4a];
  pos.forEach(([a, y, b], i) => {
    m4.copy(basis(a, b)); m4.setPosition(o.clone().addScaledVector(alongV, a).addScaledVector(awayV, b).setY(y));
    const rot = new THREE.Matrix4().makeRotationY(yaw); const p = new THREE.Vector3().setFromMatrixPosition(m4);
    m4.copy(rot).setPosition(p); im.setMatrixAt(i, m4);
    im.setColorAt(i, col.setHex(cols[Math.floor((a / length) * cols.length) % cols.length]).multiplyScalar(0.8 + rand() * 0.35));
    seats.push([p.x, p.y, p.z, yaw]);
  });
  im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = false; im.receiveShadow = false; group.add(im); meshes.push(im);
  return { seats, meshes };
}

/**
 * Seated spectators on the given seats: one instanced torso+arms mesh and one instanced head mesh (two draw calls for the whole
 * crowd). Clothing from a muted palette, six skin tones, a few hairstyles, mixed sizes. `ctx.crowds` receives the entry so the
 * existing cheering animation keeps working. occupancy 0..1.
 */
export function spectators(ctx, group, seats, { occupancy = 0.7, palette, rand = rng(21) } = {}) {
  const pal = palette || [0x1c2433, 0x2c3a52, 0x55606e, 0xb8bcc4, 0xe8e6e0, 0x6b2a2a, 0x2a4a46, 0x3d3a55, 0x8f7a58, 0x161a22, 0x9c3a34, 0xd9c37a];
  const skins = [0xf0c8a6, 0xd9a47c, 0xb97d56, 0x8d5a3c, 0x6a4129, 0xf6d9c0];
  const hair = [0x15110d, 0x2a1d12, 0x4a3320, 0x6b4a2a, 0xa88858, 0xb8b8b8, 0x0b0b0b];
  const torso = new THREE.CapsuleGeometry(0.17, 0.2, 2, 6); T(torso, 0, 0.78, 0); torso.scale(1, 1, 0.78);
  const armL = new THREE.CapsuleGeometry(0.05, 0.28, 1, 4); T(armL, -0.22, 0.72, 0.03);
  const armR = armL.clone(); armR.translate(0.44, 0, 0);
  const body = merge([prep(torso, 0xffffff), prep(armL, 0xffffff), prep(armR, 0xffffff)]);
  const hg = new THREE.SphereGeometry(0.105, 8, 6); hg.scale(0.92, 1.08, 1); T(hg, 0, 1.2, 0);
  const cap = new THREE.SphereGeometry(0.112, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.5); cap.scale(0.95, 1, 1.02); T(cap, 0, 1.22, -0.005);
  const head = merge([prep(hg, 0xffffff), prep(cap, 0xffffff)]);
  const chosen = seats.filter(() => rand() < occupancy);
  const mk = (geo, n) => new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true }), n);
  const bm = mk(body, chosen.length), hm = mk(head, chosen.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color(), people = [], phase = [], scales = [];
  chosen.forEach(([x, y, z, ry], i) => {
    const s = 0.9 + rand() * 0.2, j = (rand() - 0.5) * 0.06;
    m4.makeRotationY(ry + (rand() - 0.5) * 0.35).scale(new THREE.Vector3(s, s * (0.95 + rand() * 0.12), s)).setPosition(x + j, y, z + j);
    bm.setMatrixAt(i, m4); hm.setMatrixAt(i, m4);
    bm.setColorAt(i, col.setHex(pal[Math.floor(rand() * pal.length)]));
    // head colour = skin, the hair cap is painted by the second colour channel through the geometry colour: use skin for the whole head
    hm.setColorAt(i, col.setHex(skins[Math.floor(rand() * skins.length)]).lerp(new THREE.Color(hair[Math.floor(rand() * hair.length)]), rand() < 0.35 ? 0.0 : 0.0));
    people.push([x + j, y, z + j, ry]); scales.push(s); phase.push(rand() * 6);
  });
  bm.instanceMatrix.needsUpdate = hm.instanceMatrix.needsUpdate = true;
  group.add(bm, hm);
  // the cheering animation in scene.js (updateCrowd) hops these instances; heads are already modelled above the bodies (headOffset 0)
  ctx.crowds.push({ bm, hm, people, phase, scales, headOffset: 0 });
  return { count: chosen.length, bodies: bm, heads: hm };
}

// ------------------------------------------------------------------ vegetation (merged, instanced)

/** A leafy puff: a low-poly flattened ellipsoid with jittered vertices, tinted by vertex colour. */
function puff(r, color, rand, squash = 0.7) {
  const g = new THREE.IcosahedronGeometry(r, 1); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 1 + (rand() - 0.5) * 0.28; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * squash, p.getZ(i) * k); }
  g.computeVertexNormals();
  return prep(g, color);
}
function branch(from, to, r0, r1, color, seg = 5) {
  const dir = new THREE.Vector3().subVectors(to, from), len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1); g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())); g.translate(from.x, from.y, from.z);
  return prep(g, color);
}

/** Olive tree variant: a short twisted trunk splitting into 3-4 limbs, a wide irregular silvery crown of leaf puffs. */
export function oliveGeometry(seed = 1) {
  const rand = rng(seed), parts = [];
  const bark = 0x5a4a3a, leaves = [0x8f9d7a, 0x7d8d6c, 0xa3af90, 0x6f7f60];
  const base = new THREE.Vector3(0, 0, 0), fork = new THREE.Vector3((rand() - 0.5) * 0.25, 1.0 + rand() * 0.3, (rand() - 0.5) * 0.25);
  parts.push(branch(base, fork, 0.3, 0.22, bark, 7));
  const limbs = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + rand() * 0.8, out = 0.9 + rand() * 0.9, tip = new THREE.Vector3(fork.x + Math.cos(a) * out, 2.0 + rand() * 0.9, fork.z + Math.sin(a) * out);
    parts.push(branch(fork, tip, 0.17, 0.07, bark, 5));
    const mid = fork.clone().lerp(tip, 0.55);
    for (let k = 0; k < 5; k++) { const c = tip.clone().add(new THREE.Vector3((rand() - 0.5) * 1.1, (rand() - 0.2) * 0.7, (rand() - 0.5) * 1.1)); const p = puff(0.42 + rand() * 0.34, leaves[Math.floor(rand() * leaves.length)], rand); p.translate(c.x, c.y, c.z); parts.push(p); }
    const p2 = puff(0.5 + rand() * 0.2, leaves[Math.floor(rand() * leaves.length)], rand); p2.translate(mid.x + Math.cos(a) * 0.2, mid.y + 0.4, mid.z + Math.sin(a) * 0.2); parts.push(p2);
  }
  return merge(parts);
}
/** Italian cypress: tall narrow flame made of stacked irregular puffs on a short trunk. */
export function cypressGeometry(seed = 1, height = 7) {
  const rand = rng(seed), parts = [], cols = [0x23402a, 0x2b4a31, 0x1c3623];
  parts.push(branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.8, 0), 0.14, 0.1, 0x4a3c30, 5));
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), r = (0.62 * Math.sin(Math.PI * Math.min(1, 0.18 + t * 0.95)) + 0.1) * (1 - t * 0.35), y = 0.7 + t * (height - 1.2);
    for (let k = 0; k < 2; k++) { const p = puff(r * (0.8 + rand() * 0.3), cols[Math.floor(rand() * cols.length)], rand, 1.5); p.translate((rand() - 0.5) * 0.18, y + k * 0.3, (rand() - 0.5) * 0.18); parts.push(p); }
  }
  const top = puff(0.2, cols[0], rand, 2.2); top.translate(0, height - 0.2, 0); parts.push(top);
  return merge(parts);
}
/** Low Mediterranean shrub: a mound of leaf puffs in grey-greens. */
export function shrubGeometry(seed = 1, radius = 0.8) {
  const rand = rng(seed), parts = [], cols = [0x7c8c6a, 0x6a7c5a, 0x8d9a78, 0x5f7254];
  for (let i = 0; i < 9; i++) { const a = rand() * Math.PI * 2, d = rand() * radius * 0.8; const p = puff(radius * (0.32 + rand() * 0.3), cols[Math.floor(rand() * cols.length)], rand, 0.8); p.translate(Math.cos(a) * d, radius * 0.3 + rand() * radius * 0.3, Math.sin(a) * d); parts.push(p); }
  return merge(parts);
}
/** A clump of lavender: many thin stems topped with purple spikes. */
export function lavenderGeometry(seed = 1) {
  const rand = rng(seed), parts = [];
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2, d = rand() * 0.22, lean = 0.2 + rand() * 0.25, h = 0.45 + rand() * 0.2;
    const base = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), tip = new THREE.Vector3(base.x + Math.cos(a) * lean * 0.5, h, base.z + Math.sin(a) * lean * 0.5);
    parts.push(branch(base, tip, 0.012, 0.008, 0x6f8a5a, 3));
    const spike = new THREE.ConeGeometry(0.03, 0.16, 5); spike.translate(0, 0.08, 0); spike.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip.clone().sub(base).normalize())); spike.translate(tip.x, tip.y - 0.02, tip.z);
    parts.push(prep(spike, rand() < 0.5 ? 0x8a6cc2 : 0x7a5eb0));
  }
  return merge(parts);
}
/** Ornamental grass: a fountain of thin arching blades. */
export function grassGeometry(seed = 1) {
  const rand = rng(seed), parts = [];
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2, h = 0.55 + rand() * 0.45, out = 0.2 + rand() * 0.35;
    const g = new THREE.PlaneGeometry(0.035, h, 1, 3); const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const t = (p.getY(k) + h / 2) / h; p.setX(k, p.getX(k) + out * t * t * 0.9); p.setZ(k, 0); p.setY(k, p.getY(k) + h / 2); }
    g.rotateY(a); parts.push(prep(g, rand() < 0.5 ? 0xb9b56a : 0x9aa760));
  }
  return merge(parts);
}
/** A fan palm (kept to a few specimens): curved trunk, drooping fronds. */
export function palmGeometry(seed = 1, h = 7) {
  const rand = rng(seed), parts = [];
  let y = 0, cx = 0, ang = 0;
  for (let i = 0; i < 6; i++) { const seg = h / 6, a = new THREE.Vector3(cx, y, 0); cx += Math.sin(ang) * seg; y += Math.cos(ang) * seg; ang += 0.04 + rand() * 0.03; parts.push(branch(a, new THREE.Vector3(cx, y, 0), 0.22 - i * 0.015, 0.2 - i * 0.015, 0x8a6e52, 8)); }
  for (let i = 0; i < 12; i++) {
    const g = new THREE.PlaneGeometry(0.5, 3.0, 2, 6), p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const t = (p.getY(k) + 1.5) / 3; p.setZ(k, -t * t * 1.5); p.setX(k, p.getX(k) * (1 - t * 0.85)); p.setY(k, p.getY(k) + 1.5); }
    g.rotateX(Math.PI / 2 - 0.35 - rand() * 0.3); g.rotateY((i / 12) * Math.PI * 2 + rand() * 0.2); g.translate(cx, y, 0);
    parts.push(prep(g, rand() < 0.5 ? 0x4b7a3a : 0x5a8a44));
  }
  return merge(parts);
}

/** Scatter `list` = [[x, z, scale, rotationY, tint?]] as one InstancedMesh of `geo` (vertex colours multiplied by the instance tint). */
export function instance(group, geo, list, { roughness = 0.9, shadow = true, side = THREE.FrontSide, y = 0 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness, vertexColors: true, side });
  const im = new THREE.InstancedMesh(geo, mat, list.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), col = new THREE.Color();
  list.forEach(([x, z, sc = 1, ry = 0, tint = 0xffffff, sy = sc], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry); s.set(sc, sy, sc); m4.compose(new THREE.Vector3(x, y, z), q, s); im.setMatrixAt(i, m4); im.setColorAt(i, col.setHex(tint));
  });
  im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = shadow; im.receiveShadow = false; group.add(im);
  return im;
}

// ------------------------------------------------------------------ floodlights

/**
 * A floodlight mast: a tapered steel pole, a service platform and a head frame carrying `cols` x `rows` lamp units (housing, reflector
 * ring, emissive lens). The head is aimed at `target`. Lenses are returned so one InstancedMesh can render all of them.
 */
export function floodlightMast(group, { x, z, height = 19, target = [0, 0, 0], cols = 4, rows = 3, steel, dark, lensMat, glow }) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, height, 10), steel); pole.position.set(x, height / 2, z); pole.castShadow = false; group.add(pole);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.5, 10), dark); base.position.set(x, 0.25, z); group.add(base);
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.1, 12), dark); plat.position.set(x, height - 1.2, z); group.add(plat);
  const head = new THREE.Group(); head.position.set(x, height, z); head.lookAt(new THREE.Vector3(...target));
  const w = cols * 0.82 + 0.2, h = rows * 0.72 + 0.2;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.22), dark); head.add(frame);
  const housing = [], rings = [];
  const lensPos = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const px = (c - (cols - 1) / 2) * 0.82, py = (r - (rows - 1) / 2) * 0.72;
    const hg = new THREE.BoxGeometry(0.7, 0.6, 0.4); hg.translate(px, py, 0.3); housing.push(prep(hg, 0xffffff));
    const rg = new THREE.TorusGeometry(0.26, 0.035, 6, 16); rg.translate(px, py, 0.5); rings.push(prep(rg, 0xffffff));
    lensPos.push([px, py, 0.5]);
  }
  head.add(new THREE.Mesh(merge(housing), dark), new THREE.Mesh(merge(rings), steel));
  // a support yoke back to the pole
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.1), steel); arm.position.set(0, 0, -0.55); head.add(arm);
  group.add(head);
  head.updateMatrixWorld(true);
  const lenses = lensPos.map((p) => new THREE.Vector3(...p).applyMatrix4(head.matrixWorld));
  const dir = new THREE.Vector3(...target).sub(head.position).normalize();
  let sprite = null;
  if (glow) { sprite = new THREE.Sprite(glow); sprite.position.copy(head.position).addScaledVector(dir, 0.9); sprite.scale.set(7, 5, 1); group.add(sprite); }
  return { head, lenses, dir, sprite };
}
/** All lenses of all masts in one instanced mesh (emissive discs facing their mast's aim). */
export function lensMesh(group, masts, mat) {
  const total = masts.reduce((n, m) => n + m.lenses.length, 0);
  const im = new THREE.InstancedMesh(new THREE.CircleGeometry(0.24, 14), mat, total), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  let i = 0;
  for (const m of masts) { q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), m.dir); for (const p of m.lenses) { m4.compose(p, q, new THREE.Vector3(1, 1, 1)); im.setMatrixAt(i++, m4); } }
  im.instanceMatrix.needsUpdate = true; group.add(im); return im;
}

/** Free everything an environment group owns (geometries, materials, textures, instanced buffers). Safe to call twice. */
export function disposeGroup(group) {
  const seen = new Set();
  group.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    for (const m of [].concat(o.material || [])) if (m && !seen.has(m)) { seen.add(m); for (const k of ['map', 'normalMap', 'roughnessMap', 'bumpMap', 'emissiveMap', 'alphaMap']) m[k]?.dispose?.(); m.dispose(); }
    if (o.isInstancedMesh) o.dispose();
  });
}
