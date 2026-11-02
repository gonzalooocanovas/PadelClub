// Development tool: builds client/models/source/output_mesh_pbr_rigged_game.glb from output_mesh_pbr_rigged_fixed.glb.
// The mesh is simplified with the SKIN WEIGHTS in the error metric (so vertices that move with different bones are not merged into long
// slivers that flatten into ribbons when an arm is raised), the unused vertices are removed, and the textures are resized to 1024 px WebP.
//   GLTF_TRANSFORM_DIR=<folder whose node_modules has @gltf-transform/core, /extensions, /functions, meshoptimizer, sharp> node tools/make-game-model.mjs
import { createRequire } from 'node:module';
const dir = process.env.GLTF_TRANSFORM_DIR || 'C:/Users/gonza/AppData/Local/Temp/gt';
const require = createRequire(dir + '/package.json');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { prune, textureCompress, dedup } = require('@gltf-transform/functions');
const { MeshoptSimplifier } = require('meshoptimizer');
const sharp = require('sharp');

const RATIO = +(process.env.RATIO || 0.4), ERROR = +(process.env.ERROR || 0.01);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('client/models/source/output_mesh_pbr_rigged_fixed.glb');
await MeshoptSimplifier.ready;
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const pos = prim.getAttribute('POSITION').getArray(), idx = prim.getIndices().getArray(), W = prim.getAttribute('WEIGHTS_0').getArray(), J = prim.getAttribute('JOINTS_0').getArray();
const n = pos.length / 3;
// attributes in the error metric: the four weights AND the dominant joint as a scaled value, so different bones keep their own vertices
const attrs = new Float32Array(n * 5);
for (let i = 0; i < n; i++) { for (let k = 0; k < 4; k++) attrs[i * 5 + k] = W[i * 4 + k]; attrs[i * 5 + 4] = J[i * 4] / 22; }
const target = Math.floor((idx.length * RATIO) / 3) * 3;
const [out, err] = MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(idx), pos, 3, attrs, 5, [2, 2, 2, 2, 2], null, target, ERROR, ['LockBorder']);
const index = prim.getIndices(); index.setArray(idx.constructor === Uint16Array && n < 65536 ? new Uint16Array(out) : new Uint32Array(out));
await doc.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }));
await io.write('client/models/source/output_mesh_pbr_rigged_game.glb', doc);
const p2 = doc.getRoot().listMeshes()[0].listPrimitives()[0];
console.log(JSON.stringify({ trianglesBefore: idx.length / 3, trianglesAfter: p2.getIndices().getCount() / 3, vertices: p2.getAttribute('POSITION').getCount(), error: err, skin: !!p2.getAttribute('JOINTS_0') && !!p2.getAttribute('WEIGHTS_0') }));
