// Procedural skinning for the scanned player models. The models are single rigid meshes captured in ONE pose each, so a skeleton is
// built in code from joint positions measured on each model (JOINTS, in model units, y up, +z forward, +x the player's left), every
// vertex is weighted to the nearest bones (then smoothed along the mesh), and the mesh is re-posed into the neutral ready stance the
// animation starts from. scene.js keeps animating a set of placeholder joints with its usual pose maths; skinFollow() converts the
// difference between that pose and the ready stance into bone rotations, so the model can take any pose the animation can.
import * as THREE from 'three';

const V = (a) => new THREE.Vector3(...a);

export const JOINTS = {
  // model b: ready stance (the lady). Hands hold the racket in front of the hips.
  b: {
    pelvis: [0, 0.5, -0.22], neck: [0, 0.8, 0.05], headC: [0, 0.9, 0.15], headTop: [0, 1.0, 0.13],
    shR: [-0.165, 0.72, -0.04], elR: [-0.195, 0.575, 0.03], wrR: [-0.145, 0.47, 0.08], racket: [-0.2, 0.52, 0.27],
    shL: [0.165, 0.72, -0.04], elL: [0.13, 0.6, 0.02], wrL: [0.04, 0.48, 0.1],
    hipR: [-0.1, 0.48, -0.22], knR: [-0.215, 0.31, -0.03], anR: [-0.335, 0.07, -0.12], toR: [-0.34, 0.02, 0.03],
    hipL: [0.1, 0.48, -0.22], knL: [0.19, 0.33, -0.03], anL: [0.33, 0.07, -0.12], toL: [0.34, 0.02, 0.03], upR: [0, 1, 0.1], upL: [0, 1, 0.1],
    torsoR: 0.17, handL: [-0.1, 0.46, 0.1], spread: 0.03,
    // her hands touch the racket and her belly and the scan is one closed surface there: triangles that join her left hand to those
    // parts are dropped (the hand is a closed shell on its own), otherwise they stretch into skin sheets when the arms move
    cutHands: true,
  },
  // model a: the man, caught mid-stride in a forehand lunge (right leg forward, left leg trailing and lifted).
  a: {
    pelvis: [0.03, 0.38, 0.05], neck: [0, 0.66, 0.2], headC: [0, 0.73, 0.27], headTop: [0, 0.81, 0.26],
    shR: [-0.12, 0.62, 0.1], elR: [-0.15, 0.5, 0.2], wrR: [-0.14, 0.41, 0.36], racket: [-0.21, 0.36, 0.47],
    shL: [0.12, 0.64, 0.1], elL: [0.19, 0.6, -0.1], wrL: [0.24, 0.54, -0.06],
    hipR: [-0.04, 0.36, 0.08], knR: [-0.055, 0.28, 0.25], anR: [-0.04, 0.08, 0.35], toR: [-0.04, 0.03, 0.44],
    hipL: [0.07, 0.36, 0.0], knL: [0.15, 0.25, -0.1], anL: [0.16, 0.2, -0.38], toL: [0.17, 0.1, -0.46], upR: [0, 1, 0.15], upL: [0, 0.6, 0.8],
    torsoR: 0.15, spread: 0.04,
  },
};

// bone name, parent, pivot joint. Three-part spine, neck, shoulder girdles, a left hand and per-leg chains.
const TREE = [
  ['pelvis', null, 'pelvis'],
  ['spine', 'pelvis', 'spinePivot'],
  ['chest', 'spine', 'chestPivot'],
  ['neck', 'chest', 'neck'],
  ['head', 'neck', 'headPivot'],
  ['clR', 'chest', 'clPivR'], ['shR', 'clR', 'shR'], ['elR', 'shR', 'elR'], ['rk', 'elR', 'wrR'],
  ['clL', 'chest', 'clPivL'], ['shL', 'clL', 'shL'], ['elL', 'shL', 'elL'], ['haL', 'elL', 'wrL'],
  ['thR', 'pelvis', 'hipR'], ['knR', 'thR', 'knR'], ['ftR', 'knR', 'anR'],
  ['thL', 'pelvis', 'hipL'], ['knL', 'thL', 'knL'], ['ftL', 'knL', 'anL'],
];

function points(J) {
  const p = {}; for (const k in J) if (Array.isArray(J[k])) p[k] = V(J[k]);
  for (const k of ['upR', 'upL']) p[k].normalize();
  p.spinePivot = p.pelvis.clone().lerp(p.neck, 0.2);
  p.chestPivot = p.pelvis.clone().lerp(p.neck, 0.55);
  p.headPivot = p.neck.clone().lerp(p.headC, 0.5);
  p.clPivR = p.neck.clone().lerp(p.shR, 0.3); p.clPivL = p.neck.clone().lerp(p.shL, 0.3);
  if (!p.handL) p.handL = p.wrL.clone().addScaledVector(p.wrL.clone().sub(p.elL), 0.4);
  return p;
}

// capsules that claim vertices for each bone: [bone, from, to, radius]
function capsules(J, p) {
  const t = J.torsoR, L = (a, b, f) => a.clone().lerp(b, f);
  return [
    ['pelvis', p.pelvis, L(p.pelvis, p.neck, 0.2), t * 0.95],
    ['spine', L(p.pelvis, p.neck, 0.2), L(p.pelvis, p.neck, 0.55), t],
    ['chest', L(p.pelvis, p.neck, 0.55), L(p.pelvis, p.neck, 0.95), t],
    ['neck', p.neck, L(p.neck, p.headC, 0.5), 0.06],
    ['head', L(p.neck, p.headC, 0.55), p.headTop, 0.11],
    ['clR', p.clPivR, p.shR, 0.05], ['shR', p.shR, p.elR, 0.055], ['elR', p.elR, p.wrR, 0.048], ['rk', p.wrR, p.racket, 0.14],
    ['clL', p.clPivL, p.shL, 0.05], ['shL', p.shL, p.elL, 0.055], ['elL', p.elL, p.wrL, 0.048], ['haL', p.wrL, p.handL, 0.05],
    ['thR', p.hipR, p.knR, 0.1], ['knR', p.knR, p.anR, 0.065], ['ftR', p.anR, p.toR, 0.06],
    ['thL', p.hipL, p.knL, 0.1], ['knL', p.knL, p.anL, 0.065], ['ftL', p.anL, p.toL, 0.06],
  ];
}

const seg = (p, a, b) => {
  const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
};

const skinned = {}; // kind -> geometry carrying skinIndex / skinWeight

/**
 * Add bone weights to the geometry of a loaded model (once per kind): nearest-capsule weights, then smoothed along the mesh edges so
 * the transitions are soft and isolated mistakes disappear. Vertices at the same position (texture seams) share their weights.
 */
export function skinGeometry(kind, geo) {
  if (skinned[kind]) return skinned[kind];
  const J = JOINTS[kind], p = points(J), caps = capsules(J, p);
  const names = TREE.map((t) => t[0]), B = names.length, idx = Object.fromEntries(names.map((n, i) => [n, i]));
  const pos = geo.attributes.position, n = pos.count;
  const canon = new Int32Array(n), seen = new Map();
  for (let i = 0; i < n; i++) {
    const key = Math.round(pos.getX(i) * 2e4) + ',' + Math.round(pos.getY(i) * 2e4) + ',' + Math.round(pos.getZ(i) * 2e4);
    const c = seen.get(key);
    if (c === undefined) { seen.set(key, i); canon[i] = i; } else canon[i] = c;
  }
  let W = new Float32Array(n * B);
  const v = new THREE.Vector3(), score = new Float32Array(B), K = 3.2;
  for (let i = 0; i < n; i++) {
    if (canon[i] !== i) continue;
    v.fromBufferAttribute(pos, i); score.fill(Infinity);
    for (const [b, a, c, r] of caps) { const d = seg(v, a, c) / r; if (d < score[idx[b]]) score[idx[b]] = d; }
    let min = Infinity; for (const x of score) if (x < min) min = x;
    let sum = 0; for (let j = 0; j < B; j++) { const e = Math.exp(-K * (score[j] - min)); W[i * B + j] = e; sum += e; }
    for (let j = 0; j < B; j++) W[i * B + j] /= sum;
  }
  // mesh adjacency on the welded vertices
  const adj = Array.from({ length: n }, () => new Set()), ix = geo.index, tri = (ix ? ix.count : n) / 3;
  const vi = (k) => canon[ix ? ix.getX(k) : k];
  for (let t = 0; t < tri; t++) {
    const a = vi(t * 3), b = vi(t * 3 + 1), c = vi(t * 3 + 2);
    adj[a].add(b).add(c); adj[b].add(a).add(c); adj[c].add(a).add(b);
  }
  for (let it = 0; it < 6; it++) {
    const N = new Float32Array(n * B);
    for (let i = 0; i < n; i++) {
      if (canon[i] !== i) continue;
      const nb = adj[i];
      for (let j = 0; j < B; j++) {
        if (!nb.size) { N[i * B + j] = W[i * B + j]; continue; }
        let m = 0; for (const o of nb) m += W[o * B + j];
        N[i * B + j] = 0.5 * W[i * B + j] + 0.5 * (m / nb.size);
      }
    }
    W = N;
  }
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = canon[i], order = Array.from({ length: B }, (_, j) => j).sort((x, y) => W[c * B + y] - W[c * B + x]).slice(0, 4);
    let sum = 0; for (const j of order) sum += W[c * B + j];
    for (let k = 0; k < 4; k++) { si[i * 4 + k] = order[k]; sw[i * 4 + k] = W[c * B + order[k]] / sum; }
  }
  const g = geo.clone();
  if (J.cutHands && ix) {
    const dom = (k) => si[canon[ix.getX(k)] * 4], hand = new Set([idx.haL]), own = new Set([idx.haL, idx.elL, idx.shL]);
    const keep = [];
    for (let t = 0; t < tri; t++) {
      const d = [dom(t * 3), dom(t * 3 + 1), dom(t * 3 + 2)];
      if (d.some((x) => hand.has(x)) && d.some((x) => !own.has(x))) continue;
      keep.push(ix.getX(t * 3), ix.getX(t * 3 + 1), ix.getX(t * 3 + 2));
    }
    g.setIndex(keep);
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return (skinned[kind] = g);
}

const E = (x, y, z, o = 'XYZ') => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, o));
// the neutral pose: standing straight, arms hanging, legs straight. Every pose scene.js computes (ready stance, swings, run) is a rotation away from it
const REST_E = {
  spine: [0, 0, 0], head: [0, 0, 0],
  shR: [0, 0, 0], elR: [0, 0, 0], shL: [0, 0, 0], elL: [0, 0, 0],
  thR: [0, 0, 0], thL: [0, 0, 0], knR: [0, 0, 0], knL: [0, 0, 0], ftR: [0, 0, 0], ftL: [0, 0, 0],
};
const REST = Object.fromEntries(Object.entries(REST_E).map(([k, v]) => [k, E(...v, k.startsWith('sh') ? 'YXZ' : 'XYZ')]));
const REST_HIP_Y = 0.98; // standing with straight legs

// Each model was scanned in ONE pose (a lunge, a crouch). To let it take any pose, the mesh is first re-posed into the ready stance
// the animation maths starts from: every segment is rotated so that it points where the procedural rig's segment points.
const DOWN = new THREE.Vector3(0, -1, 0), UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, -0.03, 1);
const FLOOR_ANKLE_Y = 0.07;
const dirOf = (...qs) => { const o = DOWN.clone(); for (let i = qs.length - 1; i >= 0; i--) o.applyQuaternion(qs[i]); return o; };

// bone -> [from joint, to joint, target direction in the body's frame]
function targets(spread = 0) {
  const S = E(...REST_E.spine), lean = UP.clone().applyQuaternion(S);
  const { shR, elR, shL, elL, knR, knL } = REST;
  const thR = E(...REST_E.thR.slice(0, 2), REST_E.thR[2] - spread), thL = E(...REST_E.thL.slice(0, 2), REST_E.thL[2] + spread);
  return {
    spine: ['spinePivot', 'neck', lean], neck: ['neck', 'headTop', lean],
    shR: ['shR', 'elR', dirOf(S, shR)], elR: ['elR', 'wrR', dirOf(S, shR, elR)], rk: ['wrR', 'racket', dirOf(S, shR, elR)],
    shL: ['shL', 'elL', dirOf(S, shL)], elL: ['elL', 'wrL', dirOf(S, shL, elL)],
    thR: ['hipR', 'knR', dirOf(thR)], knR: ['knR', 'anR', dirOf(thR, knR)], ftR: ['anR', 'toR', FWD.clone(), 'upR'],
    thL: ['hipL', 'knL', dirOf(thL)], knL: ['knL', 'anL', dirOf(thL, knL)], ftL: ['anL', 'toL', FWD.clone(), 'upL'],
  };
}

/** Rotation of every bone into the neutral stance, and the pelvis offset that puts both feet on the floor under the body. */
function bakeBase(p, spread, keepArms) {
  const T = targets(spread);
  if (keepArms) for (const k of ['shR', 'elR', 'shL', 'elL']) delete T[k];
  const Wd = {}, base = {}, ident = new THREE.Quaternion();
  for (const [name, parent] of TREE) {
    const Wp = parent ? Wd[parent] : ident, t = T[name];
    if (!t) { Wd[name] = Wp.clone(); base[name] = ident.clone(); continue; }
    const bind = p[t[1]].clone().sub(p[t[0]]).normalize();
    const rot = new THREE.Quaternion().setFromUnitVectors(bind.applyQuaternion(Wp), t[2].clone().normalize());
    if (t[3]) { // feet: also fix the roll so the sole faces the floor
      const axis = t[2].clone().normalize(), tw = rot.clone().multiply(Wp);
      const up = p[t[3]].clone().applyQuaternion(tw), want = UP.clone().addScaledVector(axis, -UP.dot(axis)).normalize();
      up.addScaledVector(axis, -up.dot(axis)).normalize();
      const ang = Math.atan2(axis.dot(up.clone().cross(want)), up.dot(want));
      rot.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, ang));
    }
    Wd[name] = rot.multiply(Wp);
    base[name] = Wp.clone().invert().multiply(Wd[name]);
  }
  const ankle = (s) => p['hip' + s].clone()
    .add(p['kn' + s].clone().sub(p['hip' + s]).applyQuaternion(Wd['th' + s]))
    .add(p['an' + s].clone().sub(p['kn' + s]).applyQuaternion(Wd['kn' + s]));
  const mid = ankle('R').add(ankle('L')).multiplyScalar(0.5);
  return { base, baseWorld: Wd.rk, offset: new THREE.Vector3(-mid.x, FLOOR_ANKLE_Y - mid.y, -mid.z) };
}

/** A fresh skeleton in the bind pose. Returns the bones by name plus the ordered array. */
export function buildBones(kind) {
  const J = JOINTS[kind], p = points(J);
  const bones = {}, list = [];
  for (const [name, parent, joint] of TREE) {
    const b = new THREE.Bone(); b.name = name;
    b.userData.bind = p[joint].clone();
    b.position.copy(p[joint]).sub(parent ? bones[parent].userData.bind : new THREE.Vector3());
    if (parent) bones[parent].add(b);
    bones[name] = b; list.push(b);
  }
  const { base, offset, baseWorld } = bakeBase(p, J.spread || 0, J.keepArms);
  for (const n in base) bones[n].userData.base = base[n];
  bones.pelvis.userData.offset = offset;
  bones.rk.userData.baseWorld = baseWorld;
  return { bones, list, root: bones.pelvis };
}

const q = new THREE.Quaternion(), r = new THREE.Quaternion();
const delta = (cur, rest) => q.setFromEuler(cur.rotation).multiply(r.copy(rest).invert()).clone();
const part = (d, f) => new THREE.Quaternion().slerp(d, f); // a fraction of a rotation

const JOINT_OF = { spine: (pl) => pl.spine, head: (pl) => pl.head, shR: (pl) => pl.armR.sh, elR: (pl) => pl.armR.elbow, shL: (pl) => pl.armL.sh, elL: (pl) => pl.armL.elbow, thR: (pl) => pl.legR.thigh, knR: (pl) => pl.legR.knee, ftR: (pl) => pl.legR.foot, thL: (pl) => pl.legL.thigh, knL: (pl) => pl.legL.knee, ftL: (pl) => pl.legL.foot };
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
const rootRel = (pl, o, out) => { pl.root.getWorldQuaternion(qa); return out.copy(qa).invert().multiply(o.getWorldQuaternion(qb)); };

/** Put the placeholder joints in the ready stance and remember the racket's orientation there (call after scene.orientRacket). */
export function restPose(pl) {
  for (const k in JOINT_OF) { const e = REST_E[k]; JOINT_OF[k](pl).rotation.set(e[0], e[1], e[2]); }
  pl.hips.rotation.set(0, 0, 0); pl.hips.position.y = REST_HIP_Y; pl.head.rotation.x = REST_E.head[0];
  pl.root.updateMatrixWorld(true);
}
export function captureRest(pl) { pl.skin.restRacket = rootRel(pl, pl.racket, new THREE.Quaternion()); }

/**
 * Copy the pose scene.js computed on the placeholder joints (pl.hips, pl.spine, ...) onto the bones. The spine, neck and shoulder
 * girdle share their rotation between several bones.
 */
export function skinFollow(pl) {
  const B = pl.skin.bones, k = pl.skin.unit, damp = pl.skin.keepArms ? { R: 0.85, L: 0.45 } : { R: 1, L: 1 };
  const put = (bone, d) => { bone.quaternion.copy(d).multiply(bone.userData.base); };
  const dSpine = delta(pl.spine, REST.spine); put(B.spine, part(dSpine, 0.4)); put(B.chest, part(dSpine, 0.6));
  const dHead = delta(pl.head, REST.head); put(B.neck, part(dHead, 0.4)); put(B.head, part(dHead, 0.6));
  for (const S of ['R', 'L']) {
    const arm = S === 'R' ? pl.armR : pl.armL, leg = S === 'R' ? pl.legR : pl.legL;
    const dSh = part(delta(arm.sh, REST['sh' + S]), damp[S]), dCl = part(dSh, 0.25);
    put(B['cl' + S], dCl);
    put(B['sh' + S], dCl.clone().invert().multiply(dSh));
    put(B['el' + S], part(delta(arm.elbow, REST['el' + S]), damp[S]));
    put(B['th' + S], delta(leg.thigh, REST['th' + S])); put(B['kn' + S], delta(leg.knee, REST['kn' + S])); put(B['ft' + S], delta(leg.foot, REST['ft' + S]));
  }
  B.haL.quaternion.copy(B.haL.userData.base);
  // the racket keeps its face square to the net whatever the arm does (orientRacket), so the wrist bone cancels the forearm
  pl.root.updateMatrixWorld(true);
  const want = rootRel(pl, pl.racket, new THREE.Quaternion()).multiply(pl.skin.restRacket.clone().invert());
  B.rk.quaternion.copy(rootRel(pl, B.elR, new THREE.Quaternion()).invert().multiply(want).multiply(B.rk.userData.baseWorld));
  // pelvis: lower with the crouch, turn and lean with the hips
  const o = B.pelvis.userData.offset, bd = B.pelvis.userData.bind;
  B.pelvis.quaternion.setFromEuler(pl.hips.rotation);
  B.pelvis.position.set(bd.x + o.x + pl.hips.position.x * k, bd.y + o.y + (pl.hips.position.y - REST_HIP_Y) * k, bd.z + o.z);
}
