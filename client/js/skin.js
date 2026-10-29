// Skeleton control for the owner's rigged character (output_mesh_pbr_rigged_fixed.glb). scene.js keeps animating a set of placeholder
// joints with its usual pose maths; skinFollow() converts the difference between that pose and the neutral standing pose into bone
// rotations of the real skeleton, so the mesh deforms through its skin weights. The neutral pose is computed from the bind positions
// of the file's own bones. Model units are metres, y up, +z forward, +x the player's left.
import * as THREE from 'three';

const V = (a) => new THREE.Vector3(...a);

export const JOINTS = {
  // model c: the owner's own character (output_mesh_pbr.glb), standing in an A-pose, 1.90 m, empty hands
  c: {
    pelvis: [0, 0.0, -0.02], neck: [0, 0.63, 0.0], headC: [0, 0.82, 0.02], headTop: [0, 0.95, 0.0],
    shR: [-0.2, 0.55, 0], elR: [-0.27, 0.31, -0.01], wrR: [-0.375, 0.085, 0.0], racket: [-0.41, -0.14, 0.0], handL: [0.425, -0.14, 0.0],
    shL: [0.2, 0.55, 0], elL: [0.28, 0.31, -0.01], wrL: [0.39, 0.07, 0.0],
    hipR: [-0.105, -0.08, -0.02], knR: [-0.13, -0.43, 0.03], anR: [-0.155, -0.8, -0.02], toR: [-0.16, -0.94, 0.2],
    hipL: [0.105, -0.08, -0.02], knL: [0.13, -0.43, 0.03], anL: [0.15, -0.8, -0.02], toL: [0.16, -0.94, 0.2],
    upR: [0, 1, 0.1], upL: [0, 1, 0.1],
    torsoR: 0.17, rs: 0.85, spread: 0.05, armAbduct: 0.12, floorAnkle: -0.8,
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
const Z = new THREE.Vector3(0, 0, 1);
const dirOf = (...qs) => { const o = DOWN.clone(); for (let i = qs.length - 1; i >= 0; i--) o.applyQuaternion(qs[i]); return o; };

// bone -> [from joint, to joint, target direction in the body's frame]
function targets(spread = 0, abduct = 0) {
  const S = E(...REST_E.spine), lean = UP.clone().applyQuaternion(S);
  const { shR, elR, shL, elL, knR, knL } = REST;
  const thR = E(...REST_E.thR.slice(0, 2), REST_E.thR[2] - spread), thL = E(...REST_E.thL.slice(0, 2), REST_E.thL[2] + spread);
  return {
    spine: ['spinePivot', 'neck', lean], neck: ['neck', 'headTop', lean],
    shR: ['shR', 'elR', dirOf(S, shR).applyAxisAngle(Z, -abduct)], elR: ['elR', 'wrR', dirOf(S, shR, elR).applyAxisAngle(Z, -abduct)], rk: ['wrR', 'racket', dirOf(S, shR, elR).applyAxisAngle(Z, -abduct)],
    shL: ['shL', 'elL', dirOf(S, shL).applyAxisAngle(Z, abduct)], elL: ['elL', 'wrL', dirOf(S, shL, elL).applyAxisAngle(Z, abduct)],
    thR: ['hipR', 'knR', dirOf(thR)], knR: ['knR', 'anR', dirOf(thR, knR)], ftR: ['anR', 'toR', FWD.clone(), 'upR'],
    thL: ['hipL', 'knL', dirOf(thL)], knL: ['knL', 'anL', dirOf(thL, knL)], ftL: ['anL', 'toL', FWD.clone(), 'upL'],
  };
}

/** Rotation of every bone into the neutral stance, and the pelvis offset that puts both feet on the floor under the body. */
function bakeBase(p, spread, keepArms, abduct, floorAnkle) {
  const T = targets(spread, abduct);
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
  return { base, baseWorld: Wd.rk, offset: new THREE.Vector3(-mid.x, floorAnkle - mid.y, -mid.z) };
}

// Bones of the rigged file (Mixamo-style names) in the order the controller uses them. The file's "Left" side is at -x, which is the
// character's right hand (the model faces +z): the racket side.
const GLB = { pelvis: 'Hips', spine: 'Spine1', chest: 'Chest', neck: 'Neck', head: 'Head', clR: 'LeftShoulder', shR: 'LeftArm', elR: 'LeftForeArm', rk: 'LeftHand',
  clL: 'RightShoulder', shL: 'RightArm', elL: 'RightForeArm', haL: 'RightHand', thR: 'LeftUpLeg', knR: 'LeftLeg', ftR: 'LeftFoot',
  thL: 'RightUpLeg', knL: 'RightLeg', ftL: 'RightFoot' };
export const REQUIRED_BONES = Object.values(GLB).concat(['Spine', 'LeftToeBase', 'RightToeBase']);

/**
 * Use the skeleton of a cloned copy of the rigged file. Reads the bind positions from the file's own bones, computes the neutral-pose
 * rotation of every bone, and returns the bones under the names skinFollow() uses. Throws if a required bone is missing.
 */
export function adoptBones(scene) {
  const byName = {};
  scene.traverse((o) => { if (o.isBone) byName[o.name] = o; });
  const missing = REQUIRED_BONES.filter((n) => !byName[n]);
  if (missing.length) throw new Error('rig is missing bones: ' + missing.join(', '));
  scene.updateMatrixWorld(true);
  const wp = (n) => byName[n].getWorldPosition(new THREE.Vector3());
  const J = JOINTS.c;
  const p = {
    pelvis: wp('Hips'), spinePivot: wp('Spine1'), neck: wp('Neck'), headTop: V(J.headTop),
    shR: wp('LeftArm'), elR: wp('LeftForeArm'), wrR: wp('LeftHand'), racket: V(J.racket),
    shL: wp('RightArm'), elL: wp('RightForeArm'), wrL: wp('RightHand'),
    hipR: wp('LeftUpLeg'), knR: wp('LeftLeg'), anR: wp('LeftFoot'), toR: V(J.toR),
    hipL: wp('RightUpLeg'), knL: wp('RightLeg'), anL: wp('RightFoot'), toL: V(J.toL),
    upR: V(J.upR).normalize(), upL: V(J.upL).normalize(),
  };
  const bones = {}, list = [];
  for (const [name, glb] of Object.entries(GLB)) { bones[name] = byName[glb]; bones[name].userData.bind = wp(glb); list.push(byName[glb]); }
  const { base, offset, baseWorld } = bakeBase(p, J.spread || 0, false, J.armAbduct || 0, J.floorAnkle);
  for (const n in base) bones[n].userData.base = base[n];
  bones.pelvis.userData.offset = offset;
  bones.rk.userData.baseWorld = baseWorld;
  return { bones, list, root: byName.Hips };
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
    const dSh = part(delta(arm.sh, REST['sh' + S]), damp[S]), dCl = part(dSh, 0.4);
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
