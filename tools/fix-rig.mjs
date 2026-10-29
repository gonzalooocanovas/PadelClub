// Development tool: corrects the joint positions and the skin weights of output_mesh_pbr_rigged_weighted.glb and writes a NEW file,
// client/models/source/output_mesh_pbr_rigged_fixed.glb. The original files are only read.
//   GLTF_TRANSFORM_DIR=<folder whose node_modules has @gltf-transform/core> node tools/fix-rig.mjs
// (gltf-transform is a dev-only tool and is not a dependency of the game.)
import { createRequire } from 'node:module';
import fs from 'node:fs';

const dir = process.env.GLTF_TRANSFORM_DIR || 'C:/Users/gonza/AppData/Local/Temp/gt';
const require = createRequire(dir + '/package.json');
const { NodeIO } = require('@gltf-transform/core');
const { KHRMaterialsVolume } = (() => { try { return require('@gltf-transform/extensions'); } catch { return {}; } })();

const SRC = 'client/models/source/output_mesh_pbr_rigged_weighted.glb';
const OUT = 'client/models/source/output_mesh_pbr_rigged_fixed.glb';

// Joint positions measured on the mesh (front and side renders with a grid). The rig names are Mixamo-style, but its "Left" side is at
// -x, which is the character's right hand (the model faces +z), so Left* is the racket side. x signs below follow the file.
const P = {
  Hips: [0, -0.02, -0.02], Spine: [0, 0.1, -0.015], Spine1: [0, 0.25, -0.01], Chest: [0, 0.4, -0.005],
  Neck: [0, 0.63, 0.0], Head: [0, 0.72, 0.01],
  LeftShoulder: [-0.06, 0.61, 0.0], LeftArm: [-0.2, 0.55, 0.0], LeftForeArm: [-0.27, 0.31, -0.01], LeftHand: [-0.375, 0.085, 0.0],
  RightShoulder: [0.06, 0.61, 0.0], RightArm: [0.2, 0.55, 0.0], RightForeArm: [0.28, 0.31, -0.01], RightHand: [0.39, 0.07, 0.0],
  LeftUpLeg: [-0.105, -0.08, -0.02], LeftLeg: [-0.13, -0.43, 0.03], LeftFoot: [-0.155, -0.8, -0.02], LeftToeBase: [-0.16, -0.93, 0.12],
  RightUpLeg: [0.105, -0.08, -0.02], RightLeg: [0.13, -0.43, 0.03], RightFoot: [0.15, -0.8, -0.02], RightToeBase: [0.16, -0.93, 0.12],
};
const ENDS = { Head: [0, 0.95, 0.0], LeftHand: [-0.425, -0.14, 0], RightHand: [0.425, -0.14, 0], LeftToeBase: [-0.16, -0.94, 0.2], RightToeBase: [0.16, -0.94, 0.2] };
// capsule radius per bone (metres)
const R = { Hips: 0.16, Spine: 0.17, Spine1: 0.17, Chest: 0.17, Neck: 0.05, Head: 0.095, LeftShoulder: 0.043, RightShoulder: 0.043, LeftArm: 0.047, RightArm: 0.047,
  LeftForeArm: 0.041, RightForeArm: 0.041, LeftHand: 0.055, RightHand: 0.055, LeftUpLeg: 0.085, RightUpLeg: 0.085, LeftLeg: 0.055, RightLeg: 0.055,
  LeftFoot: 0.05, RightFoot: 0.05, LeftToeBase: 0.045, RightToeBase: 0.045 };
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const io = new NodeIO();
const doc = await io.read(SRC);
const skin = doc.getRoot().listSkins()[0];
const joints = skin.listJoints();
const names = joints.map((j) => j.getName());
const idx = Object.fromEntries(names.map((n, i) => [n, i]));
for (const n of Object.keys(P)) if (!(n in idx)) throw new Error('joint missing in the file: ' + n);

// 1. positions: every bone keeps identity rotation and scale; its translation is the offset from its parent
const parentOf = (node) => { const p = node.getParentNode(); return p && joints.includes(p) ? p : null; };
for (const j of joints) {
  const p = parentOf(j), w = P[j.getName()], pw = p ? P[p.getName()] : [0, 0, 0];
  j.setTranslation([w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]]);
  j.setRotation([0, 0, 0, 1]); j.setScale([1, 1, 1]);
}
const ibm = new Float32Array(joints.length * 16);
joints.forEach((j, i) => { const w = P[j.getName()]; ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -w[0], -w[1], -w[2], 1], i * 16); });
skin.getInverseBindMatrices().setArray(ibm);

// 2. weights: nearest capsule per bone, left/right separation, welded vertices, smoothed along the mesh edges
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const pos = prim.getAttribute('POSITION').getArray(), n = pos.length / 3, tri = prim.getIndices().getArray();
const caps = names.map((nm) => {
  const a = P[nm]; const child = joints.find((j) => parentOf(j)?.getName() === nm && !nm.includes('Shoulder') && j.getName() !== 'Spine1' || false);
  let b = ENDS[nm] || null;
  if (!b) { const kids = joints.filter((j) => parentOf(j)?.getName() === nm); const k = nm === 'Hips' ? kids.find((j) => j.getName() === 'Spine') : kids[0]; b = k ? P[k.getName()] : a; }
  if (nm === 'Hips') b = lerp(P.Hips, P.Spine, 0.8);
  if (nm === 'Neck') b = lerp(P.Neck, P.Head, 0.9);
  if (nm === 'LeftShoulder' || nm === 'RightShoulder') return { a: lerp(P.Neck, P[nm.replace('Shoulder', 'Arm')], 0.3), b: P[nm.replace('Shoulder', 'Arm')], r: R[nm] };
  if (nm === 'Chest') b = lerp(P.Chest, P.Neck, 0.95);
  return { a, b, r: R[nm] };
});
const seg = (x, y, z, a, b) => { const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1e-9; let t = ((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - a[0] - ab[0] * t, y - a[1] - ab[1] * t, z - a[2] - ab[2] * t); };
const side = (nm) => (nm.startsWith('Left') ? -1 : nm.startsWith('Right') ? 1 : 0); // file's own convention: Left at -x
const limb = (nm) => /Arm|Hand|UpLeg|Leg|Foot|Toe|Shoulder/.test(nm);
const canon = new Int32Array(n), seen = new Map();
for (let i = 0; i < n; i++) { const k = `${Math.round(pos[i * 3] * 2e4)},${Math.round(pos[i * 3 + 1] * 2e4)},${Math.round(pos[i * 3 + 2] * 2e4)}`; const c = seen.get(k); if (c === undefined) { seen.set(k, i); canon[i] = i; } else canon[i] = c; }
const B = names.length;
let W = new Float32Array(n * B);
for (let i = 0; i < n; i++) {
  if (canon[i] !== i) continue;
  const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], sc = new Float32Array(B);
  let min = Infinity;
  for (let j = 0; j < B; j++) {
    let d = seg(x, y, z, caps[j].a, caps[j].b) / caps[j].r;
    const s = side(names[j]);
    if (limb(names[j]) && s !== 0 && Math.abs(x) > 0.03 && Math.sign(x) !== s) d += 4; // never assign a left vertex to a right limb or vice versa
    sc[j] = d; if (d < min) min = d;
  }
  let sum = 0; for (let j = 0; j < B; j++) { const e = Math.exp(-3.2 * (sc[j] - min)); W[i * B + j] = e; sum += e; }
  for (let j = 0; j < B; j++) W[i * B + j] /= sum;
}
const adj = Array.from({ length: n }, () => new Set());
for (let t = 0; t < tri.length; t += 3) { const a = canon[tri[t]], b = canon[tri[t + 1]], c = canon[tri[t + 2]]; adj[a].add(b).add(c); adj[b].add(a).add(c); adj[c].add(a).add(b); }
for (let it = 0; it < 6; it++) {
  const N = new Float32Array(n * B);
  for (let i = 0; i < n; i++) { if (canon[i] !== i) continue; const nb = adj[i]; for (let j = 0; j < B; j++) { if (!nb.size) { N[i * B + j] = W[i * B + j]; continue; } let m = 0; for (const o of nb) m += W[o * B + j]; N[i * B + j] = 0.5 * W[i * B + j] + 0.5 * (m / nb.size); } }
  W = N;
}
const J0 = new Uint16Array(n * 4), W0 = new Float32Array(n * 4);
let maxInfl = 0;
for (let i = 0; i < n; i++) {
  const c = canon[i], order = Array.from({ length: B }, (_, j) => j).sort((x, y) => W[c * B + y] - W[c * B + x]).slice(0, 4);
  let sum = 0; for (const j of order) sum += W[c * B + j];
  let k = 0; for (; k < 4; k++) { const w = W[c * B + order[k]] / sum; J0[i * 4 + k] = order[k]; W0[i * 4 + k] = w; if (w < 0.01 && k > 0) { W0[i * 4 + k] = 0; } }
  let s2 = 0; for (let q = 0; q < 4; q++) s2 += W0[i * 4 + q]; for (let q = 0; q < 4; q++) W0[i * 4 + q] /= s2;
  maxInfl = Math.max(maxInfl, W0.slice(i * 4, i * 4 + 4).filter((w) => w > 0).length);
}
prim.getAttribute('JOINTS_0').setArray(J0);
prim.getAttribute('WEIGHTS_0').setArray(W0);

await io.write(OUT, doc);
// 3. validate the file that was written
const back = await io.read(OUT);
const p2 = back.getRoot().listMeshes()[0].listPrimitives()[0], j2 = p2.getAttribute('JOINTS_0').getArray(), w2 = p2.getAttribute('WEIGHTS_0').getArray();
let bad = 0, neg = 0, nonfinite = 0, notOne = 0;
for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < 4; k++) { const w = w2[i * 4 + k]; if (!Number.isFinite(w)) nonfinite++; if (w < 0) neg++; s += w; if (w > 0 && j2[i * 4 + k] >= B) bad++; } if (Math.abs(s - 1) > 1e-3) notOne++; }
console.log(JSON.stringify({ written: OUT, bytes: fs.statSync(OUT).size, joints: B, vertices: n, badIndex: bad, negative: neg, nonFinite: nonfinite, notNormalised: notOne, maxInfluencesPerVertex: maxInfl }));
