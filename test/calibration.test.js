import test from 'node:test';
import assert from 'node:assert/strict';
import { dropRebound, stepConvergence, wallImpact, surfaceBounce, netCrossing, multiBounce, run, rng } from '../tools/lib/scenarios.js';
import { stepBall, makeBall, simulateShot } from '../shared/physics.js';
import { PadelGame } from '../shared/game.js';
import { COURT, PHYS } from '../shared/constants.js';
import { COURTS } from '../shared/looks.js';
import { playMatch } from '../tools/lib/match.js';

// Tolerances are documented in docs/CALIBRATION.md.

test('drop test: a rigid-floor restitution exists that meets the official 1.35-1.45 m rebound; the game default is a documented compromise above it', () => {
  let lo = 0.6, hi = 0.95;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (dropRebound(mid) < 1.40) lo = mid; else hi = mid; }
  const eStandard = (lo + hi) / 2;
  assert.ok(eStandard > 0.74 && eStandard < 0.86, `effective restitution for the official rebound is ${eStandard.toFixed(3)} (the drop is in air: drag costs energy)`);
  assert.ok(Math.abs(dropRebound(eStandard) - 1.40) < 0.02);
  // the game turf is livelier than the standard on purpose (owner request: "que bote más"); keep it visible in the tests
  for (const c of Object.values(COURTS)) assert.ok(dropRebound(c.surface.floorE) > 1.45, `${c.id} (${dropRebound(c.surface.floorE).toFixed(2)} m) is a gameplay compromise`);
});

test('integration accuracy: 1/60 s steps land within 0.15 m of a much finer reference over a 10 m flight', () => {
  for (const sb of [0, -10, 12]) {
    const r = stepConvergence({ x: 0, y: 1, z: -6, vx: 1, vy: 2, vz: 25, sb });
    assert.ok(Math.abs(r.coarse.z - r.fine.z) < 0.15, `spin ${sb}: ${Math.abs(r.coarse.z - r.fine.z).toFixed(3)} m`);
    assert.ok(Math.abs(r.coarse.t - r.fine.t) < 0.03);
  }
});

test('glass is lively and keeps the tangential speed, the fence is dead; reflection flattens against the wall', () => {
  for (const v of [4, 8, 14, 20, 30]) {
    const g = wallImpact({ speed: v, angleDeg: 90 });
    assert.ok(g.hit && !g.mesh);
    assert.ok(g.eNormal > 0.6 && g.eNormal < 0.85, `glass e_n at ${v} m/s = ${g.eNormal.toFixed(2)}`);
  }
  for (const a of [60, 30, 15]) {
    const g = wallImpact({ speed: 14, angleDeg: a });
    assert.ok(g.out.vt / g.in.vt > 0.9, 'glass barely grips the ball sideways');
    assert.ok(g.outAngleDeg < a + 1, `reflection (${g.outAngleDeg.toFixed(1)} deg) is flatter than incidence ${a}`);
    const m = wallImpact({ speed: 14, angleDeg: a, material: 'mesh' });
    assert.ok(m.hit && m.mesh && m.eNormal < 0.4, 'fence is dead');
  }
});

test('spin off the glass: vertical speed is monotonic in topspin', () => {
  const vys = [-12, -6, 0, 6, 12].map((sb) => wallImpact({ speed: 14, angleDeg: 90, spin: sb }).out.vy);
  for (let i = 1; i < vys.length; i++) assert.ok(vys[i] < vys[i - 1], 'more backspin, lower rebound');
});

test('every court surface bounces and keeps most of its horizontal speed', () => {
  for (const id of Object.keys(COURTS)) {
    const r = surfaceBounce(id);
    assert.ok(r.rebound > 1.0 && r.rebound < 1.5, `${id} rebound ${r.rebound.toFixed(2)} m from 2 m`);
    assert.ok(r.vxKept > 0.7 && r.vxKept < 1.02, `${id} keeps ${r.vxKept.toFixed(2)} of its speed`);
  }
});

test('net: below the tape is blocked, above passes, the tape can pop the ball over', () => {
  assert.equal(netCrossing(0.7).crossed, false);
  assert.equal(netCrossing(0.85).crossed, false);
  assert.equal(netCrossing(1.0).crossed, true);
  assert.equal(netCrossing(1.1).crossed, true);
  const tape = netCrossing(0.9);
  assert.ok(tape.kinds.includes('cord') || tape.kinds.includes('net') || tape.crossed);
});

test('a 45 m/s corner shot with many collisions stays finite and never gains energy', () => {
  const r = multiBounce({ x: 3, y: 2, z: 5, vx: 30, vy: -5, vz: 34, sb: 0 });
  assert.ok(r.events.length >= 6);
  assert.ok(r.states.every((s) => Number.isFinite(s.x + s.y + s.z + s.vx + s.vy + s.vz)));
  for (let i = 1; i < r.states.length; i++) assert.ok(r.states[i].E - r.states[i - 1].E < 0.05, 'no energy gain');
});

test('determinism: the same initial state gives the same flight, and the same seed gives the same match', () => {
  const launch = { x: 1, y: 1.5, z: -7, vx: 3, vy: 4, vz: 22, sb: -8, ss: 4 };
  const a = multiBounce(launch), b = multiBounce(launch);
  assert.deepEqual(a.states, b.states);
  const m1 = playMatch({ a: 'hard', b: 'normal', seed: 77, games: 2 }), m2 = playMatch({ a: 'hard', b: 'normal', seed: 77, games: 2 });
  assert.deepEqual(m1, m2);
});

test('no tunnelling: 3000 random shots up to 50 m/s never end outside the walls, floor or net, and stay finite', () => {
  const r = rng(12345);
  let bad = 0;
  for (let i = 0; i < 3000; i++) {
    const b = { ...makeBall(), x: (r() - 0.5) * 9, y: 0.3 + r() * 3, z: (r() - 0.5) * 18, vx: (r() - 0.5) * 100, vy: (r() - 0.5) * 30, vz: (r() - 0.5) * 100, sb: (r() - 0.5) * 30, ss: (r() - 0.5) * 20, fe: PHYS.FLOOR_E };
    for (let t = 0; t < 6; t += 1 / 60) {
      const ev = [];
      stepBall(b, 1 / 60, ev);
      if (ev.some((e) => e.type === 'out')) break; // left over the top: the point is over
      const finite = Number.isFinite(b.x + b.y + b.z + b.vx + b.vy + b.vz);
      const inside = Math.abs(b.x) <= COURT.HALF_W + 1e-6 && Math.abs(b.z) <= COURT.HALF_L + 1e-6 && b.y >= COURT.BALL_R - 1e-6;
      if (!finite || !inside) { bad++; break; }
    }
  }
  assert.equal(bad, 0);
});

test('the shot solver returns finite velocities and lands where it aims; it never skips a collision', () => {
  const g = new PadelGame({ rng: () => 0.5 });
  const r = rng(99);
  let n = 0;
  const errs = [];
  for (let i = 0; i < 300; i++) {
    const b = { x: (r() - 0.5) * 8, y: 0.5 + r() * 2, z: -(1.5 + r() * 8), vx: 0, vy: 0, vz: 0, sb: 0, ss: 0, hw: 5, fe: PHYS.FLOOR_E, ff: PHYS.FLOOR_FRIC };
    const kinds = ['forehand', 'backhand', 'volley', 'slice', 'lob', 'chiquita', 'drop', 'smash', 'bandeja', 'vibora', 'block'];
    const kind = kinds[i % kinds.length];
    const aimX = (r() - 0.5) * 8, aimZ = 2 + r() * 7;
    const v = g.planShot(kind, b, 1, aimX, aimZ, 0.95, 10, null, { face: 0, e: 0.1, lateral: 0, forward: 0, spinMul: 1, powerMul: 1 });
    assert.ok([v.vx, v.vy, v.vz, v.sb, v.ss].every(Number.isFinite), `finite (${kind})`);
    const sim = simulateShot(b, v, { sb: v.sb, ss: v.ss });
    // whatever the solver says, the flight is the real physics: it ends on the floor or at a wall/net, never "teleported"
    assert.ok(['floor', 'wall', 'net', 'out', 'none'].includes(sim.kind));
    // drives, volleys, slices, blocks and smashes aim at the requested point (the other shots deliberately clamp the depth: a drop
    // shot always lands short, a lob always deep, ...)
    if (sim.kind === 'floor' && ['forehand', 'backhand', 'volley', 'slice', 'block', 'smash'].includes(kind)) {
      const [d0, d1] = { forehand: [3, 9.2], backhand: [3, 9.2], slice: [3, 9.2], volley: [3, 9], block: [4, 8], smash: [2.5, 8.5] }[kind]; // each shot clamps its own depth
      n++; errs.push(Math.hypot(sim.x - Math.max(-4.5, Math.min(4.5, aimX)), Math.abs(sim.z) - Math.max(d0, Math.min(d1, aimZ))));
    }
  }
  errs.sort((a, b) => a - b);
  assert.ok(n > 60, 'many shots land on the floor');
  assert.ok(errs[errs.length >> 1] < 0.3, `median landing error ${errs[errs.length >> 1].toFixed(2)} m`);
  const p95 = errs[Math.floor(errs.length * 0.95)];
  assert.ok(p95 < 0.7, `95th percentile landing error ${p95.toFixed(2)} m`);
  // known limit (docs/CALIBRATION.md): a flat drive from the back wall to a point 3 m past the net cannot clear the net AND land that short
});
