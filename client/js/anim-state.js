// Animation state of one player, derived only from what the game already sends (velocity, swing time, shot kind, jump).
// Pure and DOM-free (unit-tested in Node). It never drives movement, scoring or physics: scene.js reads it for the pose blending
// and the diagnostics panel. A state is held for a minimum time so that jitter in the input cannot make it flicker.

export const STATES = ['idle', 'walk', 'run', 'backward', 'lateral', 'turn', 'jump', 'prep', 'swing', 'follow', 'recovery'];

// shot kinds the pose system has keyframes for, and the label used for them in the controller
export const SHOT_LABEL = {
  forehand: 'forehand', backhand: 'backhand', volley: 'volley', smash: 'overhead', serve: 'serve', lob: 'lob', bandeja: 'bandeja',
  vibora: 'vibora', slice: 'slice', chiquita: 'chiquita', drop: 'drop', block: 'block',
};
export const HOLD = 0.12;      // seconds a locomotion state is kept before it may change
export const RECOVERY = 0.35;  // seconds of recovery after a swing, easing back to the ready pose

export function newAnim() {
  return { state: 'idle', shot: null, since: 0, t: 0, swingEnd: -1, cand: 'idle', candSince: 0, prevSpeed: 0, pvx: 0, pvz: 0, changes: 0, blend: 1 };
}

/**
 * Advance the state. `v` = {vx, vz, swingT, kindName, jumpT, serving}, `yaw` = the body's facing (radians, 0 = +z).
 * Returns the same object (mutated) so callers can keep one per player.
 */
export function stepAnim(a, v, yaw, dt) {
  a.t += dt;
  const speed = Math.hypot(v.vx, v.vz);
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const vf = v.vx * sy + v.vz * cy, vl = v.vx * cy - v.vz * sy; // forward / sideways speed in the body's frame
  let next = a.state, shot = a.shot;
  if (v.jumpT > 0) next = 'jump';
  else if (v.swingT >= 0) {
    shot = SHOT_LABEL[v.kindName] || v.kindName || 'forehand';
    next = v.swingT < 0.075 ? 'prep' : v.swingT < 0.17 ? 'swing' : 'follow';
    a.swingEnd = a.t;
  } else if (a.swingEnd >= 0 && a.t - a.swingEnd < RECOVERY) {
    next = 'recovery';
  } else {
    const turning = speed > 2 && a.prevSpeed > 2 && (v.vx * a.pvx + v.vz * a.pvz) < -0.25 * speed * a.prevSpeed;
    let loco;
    if (turning) loco = 'turn';
    else if (speed < 0.3) loco = 'idle';
    else if (Math.abs(vl) > Math.abs(vf) * 1.2 && Math.abs(vl) > 0.6) loco = 'lateral';
    else if (vf < -0.8) loco = 'backward';
    else loco = speed < 2.2 ? 'walk' : 'run';
    // a locomotion state changes only after the new one has been asked for continuously for HOLD seconds (no flicker from noisy input)
    const isLoco = ['idle', 'walk', 'run', 'backward', 'lateral', 'turn'].includes(a.state);
    if (loco !== a.cand) { a.cand = loco; a.candSince = a.t; }
    next = isLoco && loco !== a.state && a.t - a.candSince < HOLD && loco !== 'turn' ? a.state : loco;
    if (next !== 'swing' && next !== 'prep' && next !== 'follow') shot = null;
  }
  if (next !== a.state) { a.state = next; a.since = a.t; a.changes++; }
  a.shot = shot;
  a.prevSpeed = speed; a.pvx = v.vx; a.pvz = v.vz;
  return a;
}

/** Human-readable label used by the debug panel, for example "swing:overhead". */
export const animLabel = (a) => (a.shot && (a.state === 'prep' || a.state === 'swing' || a.state === 'follow') ? `${a.state}:${a.shot}` : a.state);
