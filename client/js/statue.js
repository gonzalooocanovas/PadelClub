// Scanned player models (client/models/player_*.glb): one rigid mesh each, no skeleton. They cannot swing a racket, so the body is
// moved as a whole (lean, twist, bob, crouch). The rig exposes the same fields as characters.js so scene.js animates it unchanged;
// the jointed bones are empty placeholder groups and statueFollow() copies the useful part of the pose onto the model.
import * as THREE from 'three';
import { skinGeometry, buildBones, skinFollow, JOINTS } from './skin.js';
import { GLTFLoader } from '/vendor/three/examples/jsm/loaders/GLTFLoader.js';

const FILES = { a: '/models/player_a.glb', b: '/models/player_b.glb' };
const HEIGHT = { a: 1.85, b: 1.75 }; // metres, standing-ish; model a is a lunge so this is its full extent
const loaded = {};
let pending = null;

/** Load both models once. Resolves with true when at least one is available. */
export function loadStatues() {
  if (pending) return pending;
  const loader = new GLTFLoader();
  pending = Promise.all(Object.entries(FILES).map(([k, url]) => new Promise((res) => {
    loader.load(url, (g) => { loaded[k] = g.scene; res(true); }, undefined, () => res(false));
  }))).then((r) => r.some(Boolean));
  return pending;
}

export const statueReady = (kind) => !!loaded[kind];
export const statueKind = (look) => (look.arch === 1 || look.arch === 3 ? 'b' : 'a');

const ring = { geo: null };

export function buildStatue(look, team, shadowBlob) {
  const kind = statueKind(look);
  let src; loaded[kind].traverse((o) => { if (o.isMesh && !src) src = o; });
  const model = new THREE.Group();
  const { bones, list, root: boneRoot } = buildBones(kind);
  const mesh = new THREE.SkinnedMesh(skinGeometry(kind, src.geometry), src.material.clone());
  mesh.material.roughness = 0.85; mesh.material.metalness = 0; mesh.material.side = THREE.DoubleSide;
  mesh.castShadow = true; mesh.frustumCulled = false;
  model.add(boneRoot, mesh);
  model.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list), new THREE.Matrix4());
  const box = new THREE.Box3().setFromObject(src);
  const k = HEIGHT[kind] / (box.max.y - box.min.y);
  model.scale.setScalar(k);
  model.position.y = -box.min.y * k;
  const body = new THREE.Group(); body.name = 'statue_body'; body.add(model);
  const root = new THREE.Group(); root.name = `statue_${kind}_team${team}`; root.add(body);

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
    root, blob, body, hips, spine, head, legL: legP(), legR: legP(), armL: A, armR: B, racket,
    statue: true, skin: { bones, unit: 1 / k, keepArms: !!JOINTS[kind].keepArms }, team, look, phase: Math.random() * 6, idlePh: Math.random() * 6, yaw: team === 0 ? 0 : Math.PI,
    split: 0, lastY: 0, markMat: mark.material,
  };
}

/** Copy the pose that scene.js computed onto the skinned model. */
export const statueFollow = skinFollow;
