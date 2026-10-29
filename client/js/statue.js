// The owner's own character model, client/models/source/output_mesh_pbr.glb (never modified: it is loaded as it is).
// That file is one static mesh with no skeleton, so it cannot play animation clips. A skeleton is generated for it in code
// (skin.js: 19 bones, weights from the measured joints, re-posed into a straight standing neutral pose) and driven by the same pose
// maths as the procedural athletes. The rig exposes the same fields as characters.js, so scene.js animates it without changes; the
// jointed groups it returns are placeholders that scene.js writes to and skin.js reads from.
import * as THREE from 'three';
import { skinGeometry, buildBones, skinFollow } from './skin.js';
import { buildRacket } from './characters.js';
import { RACKETS } from '/shared/looks.js';
import { GLTFLoader } from '/vendor/three/examples/jsm/loaders/GLTFLoader.js';

export const MODEL_URL = '/models/source/output_mesh_pbr.glb';
const HEIGHT = 1.82; // metres: the model is 1.90 m tall; one uniform scale, never changed afterwards
let source = null, pending = null, loadError = null;

/** Load the source model once. Resolves true when it is usable; failures are logged and the procedural athletes stay in use. */
export function loadStatues() {
  if (pending) return pending;
  pending = new Promise((res) => {
    new GLTFLoader().load(MODEL_URL, (g) => {
      let mesh = null; g.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
      if (!mesh) { loadError = 'no mesh in ' + MODEL_URL; console.error('[player model]', loadError); res(false); return; }
      source = mesh; res(true);
    }, undefined, (e) => { loadError = String(e?.message || e); console.error('[player model] failed to load', MODEL_URL, loadError); res(false); });
  });
  return pending;
}

export const statueReady = () => !!source;
export const statueError = () => loadError;
/** The model replaces the agile archetype only (the first character); the rest stay procedural until this one is approved. */
export const statueKind = (look) => (look.arch === 0 ? 'c' : null);

const ring = { geo: null };

export function buildStatue(look, team, shadowBlob) {
  const kind = 'c';
  const { bones, list, root: boneRoot } = buildBones(kind);
  const mat = source.material.clone(); // same textures, normal and metal-rough maps as the file; nothing is overridden
  const mesh = new THREE.SkinnedMesh(skinGeometry(kind, source.geometry), mat);
  mesh.castShadow = true; mesh.frustumCulled = false; mesh.name = 'player_mesh';
  const model = new THREE.Group();
  model.add(boneRoot, mesh);
  model.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  mesh.bind(skeleton, new THREE.Matrix4());
  source.geometry.computeBoundingBox();
  const box = source.geometry.boundingBox;
  const k = HEIGHT / (box.max.y - box.min.y);
  model.scale.setScalar(k); // uniform scale, set once
  model.position.y = -box.min.y * k; // feet on the floor
  const root = new THREE.Group(); root.name = `player_c_team${team}`; root.add(model);

  // the racket is a child of the right-hand bone: it moves with the hand and never exists in the gameplay collision logic
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
    statue: true, skin: { bones, unit: 1 / k, keepArms: false, scale: k, boneCount: list.length, racketMesh }, team, look,
    phase: Math.random() * 6, idlePh: Math.random() * 6, yaw: team === 0 ? 0 : Math.PI, split: 0, lastY: 0, markMat: mark.material,
  };
}

/** Copy the pose that scene.js computed onto the skinned model. */
export const statueFollow = skinFollow;
