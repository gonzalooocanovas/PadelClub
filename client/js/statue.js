// The owner's own character. Three files live in client/models/source and none of them is ever modified:
//   output_mesh_pbr.glb                   the original static mesh (no skeleton)
//   output_mesh_pbr_rigged_weighted.glb   the automatic rig (joints do not sit on the mesh's anatomy, weights are slabs)
//   output_mesh_pbr_rigged_fixed.glb      NEW: the same mesh with the joints moved onto the anatomy and rebuilt weights (tools/fix-rig.mjs)
// The game loads the fixed file, checks it, and drives its real skeleton with the pose maths of scene.js (no clips exist in any of
// the files). If anything is wrong the procedural athletes stay in use and the reason is logged and shown in the debug panel.
import * as THREE from 'three';
import { GLTFLoader } from '/vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from '/vendor/three/examples/jsm/utils/SkeletonUtils.js';
import { adoptBones, skinFollow, REQUIRED_BONES } from './skin.js';
import { buildRacket } from './characters.js';
import { RACKETS, ARCHETYPES } from '/shared/looks.js';

export const MODEL_URL = '/models/source/output_mesh_pbr_rigged_game.glb'; // 16k triangles, 1024 px WebP textures, 0.9 MB: the lightweight copy of the fixed rig (the full one stays beside it)
const HEIGHT = 1.82; // metres: the model is 1.90 m tall; one uniform scale, set once and never changed
let source = null, pending = null, loadError = null, report = null;

/** Check that a loaded file really is a usable rig. Returns a report; `ok` is false when the character must not be used. */
export function validateRig(scene) {
  const r = { ok: false, skinnedMesh: false, bones: 0, missing: [], badWeights: 0, vertices: 0, problems: [] };
  let sm = null; const names = new Set();
  scene.traverse((o) => { if (o.isSkinnedMesh && !sm) sm = o; if (o.isBone) { names.add(o.name); r.bones++; } });
  r.skinnedMesh = !!sm;
  if (!sm) { r.problems.push('no SkinnedMesh'); return r; }
  r.missing = REQUIRED_BONES.filter((n) => !names.has(n));
  if (r.missing.length) r.problems.push('missing bones: ' + r.missing.join(', '));
  const g = sm.geometry, ji = g.attributes.skinIndex, jw = g.attributes.skinWeight;
  if (!ji || !jw) { r.problems.push('no skin attributes'); return r; }
  r.vertices = ji.count;
  const nb = sm.skeleton.bones.length;
  for (let i = 0; i < ji.count; i++) {
    let sum = 0, bad = false;
    for (let k = 0; k < 4; k++) { const w = jw.getComponent(i, k), j = ji.getComponent(i, k); if (!Number.isFinite(w) || w < 0 || (w > 0 && j >= nb)) bad = true; sum += w; }
    if (bad || Math.abs(sum - 1) > 0.01) r.badWeights++;
  }
  if (r.badWeights) r.problems.push(r.badWeights + ' vertices with invalid weights');
  sm.updateMatrixWorld(true);
  if (!sm.skeleton.boneInverses?.length) r.problems.push('no inverse bind matrices');
  r.ok = r.problems.length === 0;
  return r;
}

/** Load the rigged file once. Resolves true when it is usable; failures are logged and the procedural athletes stay in use. */
export function loadStatues() {
  if (pending) return pending;
  pending = new Promise((res) => {
    new GLTFLoader().load(MODEL_URL, (g) => {
      report = validateRig(g.scene);
      if (!report.ok) { loadError = report.problems.join('; '); console.error('[player model] rejected', MODEL_URL, loadError); res(false); return; }
      source = g.scene; res(true);
    }, undefined, (e) => { loadError = String(e?.message || e); console.error('[player model] failed to load', MODEL_URL, loadError); res(false); });
  });
  return pending;
}

export const statueReady = () => !!source;
export const statueError = () => loadError;
export const statueReport = () => report;
/** The owner's character is used for every player; the archetype only changes its height (one uniform scale, never stretched). */
export const statueKind = () => 'c';

const ring = { geo: null };

export function buildStatue(look, team, shadowBlob) {
  const scene = cloneSkinned(source); // own skeleton per player, shared geometry and materials
  let mesh = null; scene.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
  mesh.castShadow = true; mesh.frustumCulled = false; mesh.name = 'player_mesh';
  const { bones, list } = adoptBones(scene);
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  const k = (HEIGHT * ((ARCHETYPES[look.arch] || ARCHETYPES[0]).height / ARCHETYPES[0].height)) / (box.max.y - box.min.y);
  const model = new THREE.Group(); model.add(scene);
  model.scale.setScalar(k); // uniform scale, set once
  model.position.y = -box.min.y * k; // feet on the floor
  const root = new THREE.Group(); root.name = `player_c_team${team}`; root.add(model);

  // the racket is a child of the racket-hand bone: it moves with the hand and never exists in the gameplay collision logic
  const racketMesh = buildRacket(RACKETS[look.racket % RACKETS.length]);
  racketMesh.scale.setScalar(1 / k); racketMesh.position.set(0, -0.045, 0.012);
  bones.rk.add(racketMesh);

  if (!ring.geo) ring.geo = new THREE.RingGeometry(0.42, 0.52, 40);
  const mark = new THREE.Mesh(ring.geo, new THREE.MeshBasicMaterial({ color: team === 0 ? 0x3f8cff : 0xff4a4a, transparent: true, opacity: 0.85, depthWrite: false }));
  mark.rotation.x = -Math.PI / 2; mark.position.y = 0.025; root.add(mark);
  const blob = new THREE.Mesh(shadowBlob.geo, shadowBlob.mat);
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.02; root.add(blob);

  const g = () => new THREE.Group();
  const arm = () => ({ sh: g(), elbow: g(), hand: g() });
  const legP = () => ({ thigh: g(), knee: g(), foot: g() });
  const A = arm(), B = arm();
  A.sh.add(A.elbow); B.sh.add(B.elbow);
  const hips = g(), spine = g(), head = g(), racket = g();
  for (const j of [A.sh, A.elbow, B.sh, B.elbow]) j.rotation.order = 'YXZ';
  hips.add(spine); root.add(hips); B.elbow.add(racket); spine.add(A.sh, B.sh);
  return {
    root, blob, hips, spine, head, legL: legP(), legR: legP(), armL: A, armR: B, racket,
    statue: true, skin: { bones, unit: 1 / k, keepArms: false, scale: k, boneCount: list.length, racketMesh, file: 'rigged_fixed' }, team, look,
    phase: Math.random() * 6, idlePh: Math.random() * 6, yaw: team === 0 ? 0 : Math.PI, split: 0, lastY: 0, markMat: mark.material,
  };
}

/** Copy the pose that scene.js computed onto the skeleton. */
export const statueFollow = skinFollow;
