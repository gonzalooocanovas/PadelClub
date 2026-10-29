import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const DIR = new URL('../client/models/source/', import.meta.url);
const read = (n) => fs.readFileSync(new URL(n, DIR));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function parse(buf) {
  const jl = buf.readUInt32LE(12), json = JSON.parse(buf.slice(20, 20 + jl).toString()), bin = buf.slice(20 + jl + 8);
  return { json, bin };
}
function accessor({ json, bin }, i, comps) {
  const a = json.accessors[i], bv = json.bufferViews[a.bufferView], off = bv.byteOffset + (a.byteOffset || 0);
  const size = { 5121: 1, 5123: 2, 5126: 4 }[a.componentType], stride = bv.byteStride || comps * size;
  const out = new Float64Array(a.count * comps);
  for (let n = 0; n < a.count; n++) for (let c = 0; c < comps; c++) {
    const o = off + n * stride + c * size;
    out[n * comps + c] = a.componentType === 5126 ? bin.readFloatLE(o) : a.componentType === 5123 ? bin.readUInt16LE(o) : bin.readUInt8(o);
  }
  return out;
}

test('the three source files are kept untouched (the originals were never rewritten)', () => {
  assert.equal(sha(read('output_mesh_pbr.glb')), 'f58412402e04d708d1e7e49b2c29a0bdbeddaedddba28a009e3e4fbde48c5a02');
  assert.equal(sha(read('output_mesh_pbr_rigged_weighted.glb')), '3628abc021f1d73ecee32f1e48dafee015db84769e53ec3a8263484f6eaddd6b');
});

test('the original mesh has no skeleton and the automatic rig has 22 joints', () => {
  const o = parse(read('output_mesh_pbr.glb')).json, w = parse(read('output_mesh_pbr_rigged_weighted.glb')).json;
  assert.equal(o.skins, undefined);
  assert.equal(w.skins[0].joints.length, 22);
});

test('the fixed file: valid skeleton, bind pose that matches the joints, finite normalised weights, same mesh', () => {
  const f = parse(read('output_mesh_pbr_rigged_fixed.glb')), w = parse(read('output_mesh_pbr_rigged_weighted.glb'));
  assert.equal(f.json.skins[0].joints.length, 22);
  assert.equal(f.json.animations?.length || 0, 0, 'no clips in any of the files');
  const prim = f.json.meshes[0].primitives[0], wp = w.json.meshes[0].primitives[0];
  // same geometry as the automatic rig (only joints and weights were rebuilt)
  assert.equal(f.json.accessors[prim.attributes.POSITION].count, w.json.accessors[wp.attributes.POSITION].count);
  assert.deepEqual(accessor(f, prim.attributes.POSITION, 3).slice(0, 300), accessor(w, wp.attributes.POSITION, 3).slice(0, 300));
  // weights
  const J = accessor(f, prim.attributes.JOINTS_0, 4), W = accessor(f, prim.attributes.WEIGHTS_0, 4);
  let bad = 0;
  for (let i = 0; i < W.length / 4; i++) {
    let s = 0; for (let k = 0; k < 4; k++) { const x = W[i * 4 + k]; if (!Number.isFinite(x) || x < 0) bad++; s += x; if (x > 0 && J[i * 4 + k] > 21) bad++; }
    if (Math.abs(s - 1) > 1e-3) bad++;
  }
  assert.equal(bad, 0);
  // inverse bind matrices are the inverse of the joints' world translations (all bind rotations are identity)
  const ibm = accessor(f, f.json.skins[0].inverseBindMatrices, 16), nodes = f.json.nodes, parent = {};
  nodes.forEach((n, i) => (n.children || []).forEach((c) => { parent[c] = i; }));
  const world = (i) => { const t = nodes[i].translation || [0, 0, 0], p = parent[i] === undefined ? [0, 0, 0] : world(parent[i]); return [p[0] + t[0], p[1] + t[1], p[2] + t[2]]; };
  f.json.skins[0].joints.forEach((nj, k) => {
    const wp3 = world(nj);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(ibm[k * 16 + 12 + c] + wp3[c]) < 1e-5, `${nodes[nj].name} bind translation`);
    assert.ok(!nodes[nj].rotation || nodes[nj].rotation.slice(0, 3).every((v) => v === 0), `${nodes[nj].name} bind rotation is identity`);
  });
});

test('the joints sit on the anatomy: shoulders, elbows, knees and ankles are where the mesh has them', () => {
  const f = parse(read('output_mesh_pbr_rigged_fixed.glb')), nodes = f.json.nodes, parent = {};
  nodes.forEach((n, i) => (n.children || []).forEach((c) => { parent[c] = i; }));
  const world = (i) => { const t = nodes[i].translation || [0, 0, 0], p = parent[i] === undefined ? [0, 0, 0] : world(parent[i]); return [p[0] + t[0], p[1] + t[1], p[2] + t[2]]; };
  const at = (name) => world(nodes.findIndex((n) => n.name === name));
  assert.ok(Math.abs(at('LeftArm')[1] - 0.55) < 0.02, 'shoulder height');
  assert.ok(Math.abs(at('LeftForeArm')[1] - 0.31) < 0.02, 'elbow height');
  assert.ok(Math.abs(at('LeftLeg')[1] - -0.43) < 0.02, 'knee height');
  assert.ok(Math.abs(at('LeftFoot')[1] - -0.8) < 0.02, 'ankle height');
  assert.ok(at('LeftArm')[0] < 0 && at('RightArm')[0] > 0, 'the file\'s Left side is at -x (the racket side of the game)');
});

test('the lightweight game copy keeps the skin (22 joints, normalised weights) and is much smaller than the fixed file', () => {
  const g = parse(read('output_mesh_pbr_rigged_game.glb'));
  assert.equal(g.json.skins[0].joints.length, 22);
  const prim = g.json.meshes[0].primitives[0];
  assert.ok(g.json.accessors[prim.indices].count / 3 < 20000, 'triangles');
  const J = accessor(g, prim.attributes.JOINTS_0, 4), W = accessor(g, prim.attributes.WEIGHTS_0, 4);
  let bad = 0;
  for (let i = 0; i < W.length / 4; i++) { let s = 0; for (let k = 0; k < 4; k++) { const x = W[i * 4 + k]; if (!Number.isFinite(x) || x < 0) bad++; s += x; if (x > 0 && J[i * 4 + k] > 21) bad++; } if (Math.abs(s - 1) > 0.01) bad++; }
  assert.equal(bad, 0);
  assert.ok(read('output_mesh_pbr_rigged_game.glb').length < 1.5e6);
});
