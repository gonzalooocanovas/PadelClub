// Procedural skinning for the scanned player models. The models are single rigid meshes, so a skeleton is built in code from joint
// positions measured on each model (JOINTS, in model units, y up, +z forward, +x the player's left) and every vertex is weighted to
// the nearest bones. scene.js keeps animating a set of placeholder joints with its usual pose maths; skinFollow() converts the
// difference between that pose and the ready stance into bone rotations, so the real mesh bends.
import * as THREE from 'three';

const V = (a) => new THREE.Vector3(...a);

export const JOINTS = {
  // model b: ready stance (the lady). Hands hold the racket in front of the hips.
  b: {
    pelvis: [0, 0.5, -0.22], neck: [0, 0.8, 0.05], headC: [0, 0.9, 0.15], headTop: [0, 1.0, 0.13],
    shR: [-0.165, 0.72, -0.04], elR: [-0.195, 0.575, 0.03], wrR: [-0.145, 0.47, 0.08], racket: [-0.2, 0.52, 0.27],
    shL: [0.165, 0.72, -0.04], elL: [0.13, 0.6, 0.02], wrL: [0.04, 0.48, 0.1],
    hipR: [-0.1, 0.48, -0.22], knR: [-0.215, 0.31, -0.03], anR: [-0.335, 0.07, -0.12], toR: [-0.34, 0.02, 0.03],
    hipL: [0.1, 0.48, -0.22], knL: [0.19, 0.33, -0.03], anL: [0.33, 0.07, -0.12], toL: [0.34, 0.02, 0.03],
    torsoR: 0.17,
  },
  // model a: the man, caught mid-stride in a forehand lunge (right leg forward, left leg trailing and lifted).
  a: {
    pelvis: [0.03, 0.38, 0.05], neck: [0, 0.66, 0.2], headC: [0, 0.73, 0.27], headTop: [0, 0.81, 0.26],
    shR: [-0.12, 0.62, 0.1], elR: [-0.15, 0.5, 0.2], wrR: [-0.14, 0.41, 0.36], racket: [-0.21, 0.36, 0.47],
    shL: [0.12, 0.64, 0.1], elL: [0.19, 0.6, -0.1], wrL: [0.24, 0.54, -0.06],
    hipR: [-0.04, 0.36, 0.08], knR: [-0.055, 0.28, 0.25], anR: [-0.04, 0.08, 0.35], toR: [-0.04, 0.03, 0.44],
    hipL: [0.07, 0.36, 0.0], knL: [0.15, 0.25, -0.1], anL: [0.16, 0.22, -0.38], toL: [0.17, 0.17, -0.48],
    torsoR: 0.15,
  },
};

// bone name -> [parent, joint where the bone pivots]
const TREE = [
  ['pelvis', null, 'pelvis'],
  ['spine', 'pelvis', 'spinePivot'],
  ['head', 'spine', 'neck'],
  ['shR', 'spine', 'shR'], ['elR', 'shR', 'elR'], ['rk', 'elR', 'wrR'],
  ['shL', 'spine', 'shL'], ['elL', 'shL', 'elL'],
  ['thR', 'pelvis', 'hipR'], ['knR', 'thR', 'knR'], ['ftR', 'knR', 'anR'],
  ['thL', 'pelvis', 'hipL'], ['knL', 'thL', 'knL'], ['ftL', 'knL', 'anL'],
];

function points(J) {
  const p = {}; for (const k in J) if (Array.isArray(J[k])) p[k] = V(J[k]);
  p.spinePivot = p.pelvis.clone().lerp(p.neck, 0.3);
  return p;
}

// capsules that claim vertices for each bone: [bone, from, to, radius]
function capsules(J, p) {
  const t = J.torsoR;
  return [
    ['pelvis', p.pelvis, p.pelvis.clone().lerp(p.neck, 0.18), t * 0.95],
    ['spine', p.pelvis.clone().lerp(p.neck, 0.3), p.neck.clone().lerp(p.pelvis, 0.05), t],
    ['head', p.neck.clone().lerp(p.headC, 0.5), p.headTop, 0.11],
    ['shR', p.shR, p.elR, 0.055], ['elR', p.elR, p.wrR, 0.048], ['rk', p.wrR, p.racket, 0.14],
    ['shL', p.shL, p.elL, 0.055], ['elL', p.elL, p.wrL, 0.048],
    ['thR', p.hipR, p.knR, 0.1], ['knR', p.knR, p.anR, 0.065], ['ftR', p.anR, p.toR, 0.06],
    ['thL', p.hipL, p.knL, 0.1], ['knL', p.knL, p.anL, 0.065], ['ftL', p.anL, p.toL, 0.06],
  ];
}

const seg = (p, a, b) => {
  const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
};

const skinned = {}; // kind -> geometry carrying skinIndex / skinWeight

/** Add bone weights to the geometry of a loaded model (once per kind). */
export function skinGeometry(kind, geo) {
  if (skinned[kind]) return skinned[kind];
  const J = JOINTS[kind], p = points(J), caps = capsules(J, p);
  const names = TREE.map((t) => t[0]), idx = Object.fromEntries(names.map((n, i) => [n, i]));
  const pos = geo.attributes.position, n = pos.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const v = new THREE.Vector3(), score = new Float32Array(names.length);
  const K = 3.2;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    score.fill(Infinity);
    for (const [b, a, c, r] of caps) { const d = seg(v, a, c) / r; if (d < score[idx[b]]) score[idx[b]] = d; }
    let min = Infinity; for (const s of score) if (s < min) min = s;
    const order = names.map((_, j) => j).sort((x, y) => score[x] - score[y]).slice(0, 4);
    let sum = 0; const w = order.map((j) => { const e = Math.exp(-K * (score[j] - min)); sum += e; return e; });
    for (let k = 0; k < 4; k++) { si[i * 4 + k] = order[k]; sw[i * 4 + k] = w[k] / sum; }
  }
  const g = geo.clone();
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return (skinned[kind] = g);
}

// Model a was captured mid-lunge. Its legs are put in a ready stance (feet flat on the floor) by two-bone IK once, and every later
// pose is applied on top of that. target: where each ankle should be; pole: which way the knee points.
const STANCE = { a: { R: { ankle: [-0.1, 0.07, 0.09], pole: [-0.1, 0.1, 1] }, L: { ankle: [0.12, 0.07, -0.08], pole: [0.1, 0.1, 1] } } };
const qFT = (a, b) => new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());

function legBase(p, side, st) {
  const hip = p['hip' + side], kn = p['kn' + side], an = p['an' + side], to = p['to' + side];
  const T = V(st.ankle), pole = V(st.pole);
  const l1 = hip.distanceTo(kn), l2 = kn.distanceTo(an);
  const d = Math.min(Math.max(hip.distanceTo(T), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  const dir = T.clone().sub(hip).normalize();
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const perp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  const knee = hip.clone().addScaledVector(dir, cosA * l1).addScaledVector(perp, sinA * l1);
  const ankle = hip.clone().add(dir.clone().multiplyScalar(d));
  const th = qFT(kn.clone().sub(hip), knee.clone().sub(hip));
  const knW = qFT(an.clone().sub(kn), ankle.clone().sub(knee));
  const ftW = qFT(to.clone().sub(an), new THREE.Vector3(0, -0.03, 1));
  const inv = (q) => q.clone().invert();
  return { th, kn: inv(th).multiply(knW), ft: inv(knW).multiply(inv(th)).multiply(ftW) };
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
  const st = STANCE[kind];
  if (st) for (const side of ['R', 'L']) {
    const b = legBase(p, side, st[side]);
    for (const [bn, q] of [['th' + side, b.th], ['kn' + side, b.kn], ['ft' + side, b.ft]]) { bones[bn].userData.base = q; }
  }
  return { bones, list, root: bones.pelvis };
}

const E = (x, y, z, o = 'XYZ') => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, o));
// the ready stance in the same terms scene.js uses (see READY there): the placeholder joints rest at these rotations
const REST_E = {
  spine: [0.12, 0, 0], head: [0.008, 0, 0],
  shR: [-0.7, -0.45, 0], elR: [-1.7, 0, 0], shL: [-0.5, 0.35, 0.12], elL: [-0.9, 0, 0],
  thR: [-0.32, 0, -0.06], thL: [-0.32, 0, 0.06], knR: [0.64, 0, 0], knL: [0.64, 0, 0], ftR: [-0.288, 0, 0], ftL: [-0.288, 0, 0],
};
const REST = Object.fromEntries(Object.entries(REST_E).map(([k, v]) => [k, E(...v, k.startsWith('sh') ? 'YXZ' : 'XYZ')]));
const REST_HIP_Y = 0.88 * Math.cos(0.32) + 0.1;

const q = new THREE.Quaternion(), r = new THREE.Quaternion();
const delta = (cur, rest) => q.setFromEuler(cur.rotation).multiply(r.copy(rest).invert());

/**
 * Copy the pose scene.js computed on the placeholder joints (pl.hips, pl.spine, ...) onto the bones.
 * `ratio` converts the procedural rig's metres into model units.
 */
export function skinFollow(pl) {
  const B = pl.skin.bones, k = pl.skin.unit;
  const set = (bone, cur, rest) => { bone.quaternion.copy(delta(cur, rest)); if (bone.userData.base) bone.quaternion.multiply(bone.userData.base); };
  set(B.spine, pl.spine, REST.spine);
  set(B.head, pl.head, REST.head);
  set(B.shR, pl.armR.sh, REST.shR); set(B.elR, pl.armR.elbow, REST.elR);
  set(B.shL, pl.armL.sh, REST.shL); set(B.elL, pl.armL.elbow, REST.elL);
  set(B.thR, pl.legR.thigh, REST.thR); set(B.knR, pl.legR.knee, REST.knR); set(B.ftR, pl.legR.foot, REST.ftR);
  set(B.thL, pl.legL.thigh, REST.thL); set(B.knL, pl.legL.knee, REST.knL); set(B.ftL, pl.legL.foot, REST.ftL);
  // the racket keeps its face square to the net whatever the arm does (orientRacket), so the wrist bone cancels the forearm
  pl.root.updateMatrixWorld(true);
  const want = rootRel(pl, pl.racket, new THREE.Quaternion()).multiply(pl.skin.restRacket.clone().invert());
  B.rk.quaternion.copy(rootRel(pl, B.elR, new THREE.Quaternion()).invert().multiply(want));
  // pelvis: lower with the crouch, turn and lean with the hips
  B.pelvis.quaternion.setFromEuler(pl.hips.rotation);
  B.pelvis.position.set(B.pelvis.userData.bind.x + pl.hips.position.x * k, B.pelvis.userData.bind.y + (pl.hips.position.y - REST_HIP_Y) * k, B.pelvis.userData.bind.z);
}

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
