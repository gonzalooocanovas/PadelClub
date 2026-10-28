// Physics calibration scenarios. Pure functions over shared/physics.js: used by tools/calibrate.mjs (report) and
// test/calibration.test.js (assertions). Units: metres, seconds, metres/second, radians are not used (spin is in the game's
// own spin units, see docs/CALIBRATION.md).
import { stepBall, makeBall } from '../../shared/physics.js';
import { COURT, PHYS } from '../../shared/constants.js';
import { COURTS } from '../../shared/looks.js';

const R = COURT.BALL_R;

/** Run a ball until `until(b, events)` returns true or maxT elapses. Returns the trace of events with times. */
export function run(ball, { dt = 1 / 60, maxT = 6, until = null } = {}) {
  const b = ball;
  const log = [];
  let t = 0;
  for (; t < maxT; t += dt) {
    const ev = [];
    stepBall(b, dt, ev);
    for (const e of ev) log.push({ ...e, t: t + dt });
    if (until && until(b, ev, t)) break;
  }
  return { ball: b, log, t };
}

/** Official-style drop test: from 2.54 m onto a rigid floor. Returns the rebound height in metres. */
export function dropRebound(fe, height = 2.54) {
  const b = { ...makeBall(), x: 0, y: height, z: 0, vx: 0, vy: 0, vz: 0, fe, ff: PHYS.FLOOR_FRIC };
  let bounced = false, peak = 0;
  const dt = 1 / 600; // fine step: the test is about the model, not the integrator
  for (let t = 0; t < 4; t += dt) {
    const ev = [];
    stepBall(b, dt, ev);
    if (ev.some((e) => e.type === 'floor')) bounced = true;
    else if (bounced) { peak = Math.max(peak, b.y); if (b.vy < 0) break; }
  }
  return peak - R; // height of the ball centre above the floor, referred to the ball's bottom like the standard
}

/** Same launch integrated with two different step sizes: how much does the answer depend on dt? */
export function stepConvergence(launch, dtA = 1 / 60, dtB = 1 / 600) {
  const land = (dt) => {
    const b = { ...makeBall(), ...launch, fe: PHYS.FLOOR_E };
    const r = run(b, { dt, maxT: 3, until: (_, ev) => ev.some((e) => e.type === 'floor') });
    const f = r.log.find((e) => e.type === 'floor');
    return f ? { x: f.x, z: f.z, t: f.t } : null;
  };
  return { coarse: land(dtA), fine: land(dtB) };
}

/** A ball hits a side wall or back wall: returns incoming/outgoing velocity and the angle of reflection. */
export function wallImpact({ speed, angleDeg, material = 'glass', spin = 0 }) {
  const a = (angleDeg * Math.PI) / 180; // angle between the path and the wall surface (90 = head-on)
  const vn = speed * Math.sin(a), vt = speed * Math.cos(a);
  const z = material === 'glass' ? 8 : 4; // side wall: glass in the back 4 m, fence in the middle
  const b = { ...makeBall(), x: 4.5, y: 1.2, z, vx: vn, vy: 0, vz: vt, sb: spin, ss: 0 };
  const r = run(b, { maxT: 1, until: (_, ev) => ev.some((e) => e.type === 'wall') });
  const w = r.log.find((e) => e.type === 'wall');
  return {
    hit: !!w, mesh: w?.mesh, in: { vn, vt },
    out: { vn: -b.vx, vt: b.vz, vy: b.vy },
    eNormal: w ? -b.vx / vn : null,
    outAngleDeg: w ? (Math.atan2(-b.vx, Math.abs(b.vz)) * 180) / Math.PI : null,
  };
}

/** Bounce on each court surface from a given drop height and horizontal speed. */
export function surfaceBounce(courtId, { height = 2.0, vx = 8 } = {}) {
  const s = COURTS[courtId].surface;
  const b = { ...makeBall(), x: -4, y: height, z: 0, vx: vx / 2, vy: 0, vz: 0, fe: s.floorE, ff: s.floorFric };
  const r = run(b, { maxT: 3, until: (bb, ev) => ev.some((e) => e.type === 'floor') });
  const f = r.log.find((e) => e.type === 'floor');
  const vyIn = f ? f.speed : 0;
  const vxIn = vx / 2; // measured against the launch speed: drag over a 0.6 s drop is small
  const vxAfter = b.vx; // measured right after the bounce, before the ball reaches any wall
  let peak = 0;
  for (let i = 0; i < 300; i++) { const ev = []; stepBall(b, 1 / 120, ev); peak = Math.max(peak, b.y); if (b.vy < 0) break; }
  return { vyIn, vyOut: b.vy > 0 ? b.vy : null, rebound: peak - R, vxKept: vxAfter / vxIn, e: s.floorE, fric: s.floorFric };
}

/** A ball crossing the net plane at a given height: passes, hits the band, or clips the tape. */
export function netCrossing(heightAtNet, vz = 14) {
  const b = { ...makeBall(), x: 0, y: heightAtNet, z: -0.6, vx: 0, vy: 0, vz };
  const r = run(b, { maxT: 0.3, dt: 1 / 240, until: (bb) => bb.z > 0.5 });
  const kinds = r.log.map((e) => e.type);
  return { kinds, crossed: b.z > 0.3, z: b.z };
}

/** Energy per unit mass (J/kg) of the ball: kinetic + potential. */
export const energy = (b) => 0.5 * (b.vx * b.vx + b.vy * b.vy + b.vz * b.vz) + PHYS.G * b.y;

/** A fast shot with several collisions in a row (floor, back wall, side wall, floor...). Returns the trace. */
export function multiBounce(launch, maxT = 4) {
  const b = { ...makeBall(), ...launch, fe: PHYS.FLOOR_E };
  const states = [];
  const events = [];
  for (let t = 0; t < maxT; t += 1 / 60) {
    const ev = [];
    stepBall(b, 1 / 60, ev);
    for (const e of ev) events.push({ ...e, t });
    states.push({ x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, E: energy(b), events: ev.map((e) => e.type) });
  }
  return { states, events, ball: b };
}

/** Deterministic pseudo-random numbers for generated scenarios. */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
