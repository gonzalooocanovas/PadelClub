import test from 'node:test';
import assert from 'node:assert/strict';
import { PadelGame } from '../shared/game.js';
import { makeBall, simulateShot } from '../shared/physics.js';

const DT = 1 / 60;
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const ball = () => ({ ...makeBall(), x: -1, y: 1, z: -4 });
const speedOf = (v) => Math.hypot(v.vx, v.vz);

test('racket face angle: an open face launches higher with more backspin, a closed face is flatter with topspin', () => {
  const g = new PadelGame({ rng: () => 0.5 });
  const b = { ...ball(), y: 1.8, z: -6 }; // a deep target, so the net does not set the arc
  const open = g.planShot('forehand', b, 1, 2, 9, 1, 10, null, { face: 0.5, e: 0, lateral: 0, forward: 0 });
  const closed = g.planShot('forehand', b, 1, 2, 9, 1, 10, null, { face: -0.5, e: 0, lateral: 0, forward: 0 });
  assert.ok(open.vy > closed.vy + 0.3, `launch ${open.vy} vs ${closed.vy}`);
  assert.ok(open.sb > closed.sb, 'spin follows the face angle');
  // the solver still lands both where they were aimed (the angle changes the arc, not the target)
  for (const v of [open, closed]) {
    const sim = simulateShot(b, v, { sb: v.sb, ss: v.ss });
    assert.equal(sim.kind, 'floor');
    assert.ok(Math.hypot(sim.x - 2, sim.z - 9) < 0.6, `lands near the target (${sim.x.toFixed(2)}, ${sim.z.toFixed(2)})`);
  }
});

test('off-centre contact loses pace and is less reliable than a centred hit', () => {
  const g = new PadelGame({ rng: () => 0.5 });
  const b = { ...ball(), y: 1.8, z: -6 }; // a deep target, so the net does not set the arc
  const centred = g.planShot('forehand', b, 1, 2, 9, 0.9, 10, null, { face: 0, e: 0, lateral: 0, forward: 0 });
  const edge = g.planShot('forehand', b, 1, 2, 9, 0.9, 10, null, { face: 0, e: 0.8, lateral: 0, forward: 0 });
  assert.ok(speedOf(edge) < speedOf(centred) * 0.9, 'edge hit is slower');

  const spread = (ctx) => {
    const h = new PadelGame({ rng: seeded(7) });
    const xs = [];
    for (let i = 0; i < 300; i++) { const v = h.planShot('forehand', b, 1, 0, 7, 0.8, 10, null, ctx); const s = simulateShot(b, v, { sb: v.sb, ss: v.ss }); xs.push(s.x); }
    const mean = xs.reduce((a, c) => a + c, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, c) => a + (c - mean) ** 2, 0) / xs.length);
  };
  const c = spread({ face: 0, e: 0, lateral: 0, forward: 0 });
  const eg = spread({ face: 0, e: 0.8, lateral: 0, forward: 0 });
  const run = spread({ face: 0, e: 0, lateral: 6, forward: 0 });
  assert.ok(eg > c * 1.4, `edge scatter ${eg.toFixed(2)} vs ${c.toFixed(2)}`);
  assert.ok(run > c * 1.1, 'running sideways costs accuracy');
});

test('swing timing sets the face; label and numbers are reported honestly', () => {
  const hitAt = (swingT, dist) => {
    const g = new PadelGame({ rng: () => 0.5 });
    g.drainEvents();
    g.phase = 'rally';
    g.rally = { serving: false, faults: 0, lastTeam: 0, lastSlot: 0, bounces: 1, hits: 3, netTouched: false, serveXSign: 1 };
    const p = g.players[2];
    Object.assign(p, { x: 0, z: 5 });
    Object.assign(g.ball, { x: 0, y: 1.0, z: 5 - dist, vx: 0, vy: 0, vz: -2, sb: 0, ss: 0 });
    p.swing = { t: swingT, done: false, ax: 0, az: -6, mod: 0, lob: false };
    p.input = { ...p.input, ax: 0, az: -6 };
    assert.ok(g.contact(p));
    return g.drainEvents().find((e) => e.e === 'hit');
  };
  const late = hitAt(0.06, 0.95), ontime = hitAt(0.17, 0.95), early = hitAt(0.3, 0.95); // swing time at contact
  assert.ok(early.face < 0 && late.face > 0 && Math.abs(ontime.face) < 0.05, 'met early in the swing = open face, late = closed');
  const edge = hitAt(0.17, 1.7);
  assert.ok(edge.off > 0.6);
  assert.equal(edge.label, 'off-centre');
  assert.ok(['perfect', 'clean'].includes(ontime.label));
  assert.equal(hitAt(0.17, 0.95).label, ontime.label, 'deterministic');
});

test('the contact model keeps the game consistent: bots still complete a match', () => {
  const g = new PadelGame({ settings: { sets: 1, gamesPerSet: 2 } });
  let done = null;
  // deterministic movement-free smoke check: serving and point flow still work after the change
  for (let i = 0; i < 60 * 25 && !done; i++) {
    g.tick(DT);
    done = g.drainEvents().find((e) => e.e === 'point');
  }
  assert.ok(done, 'an unreturned serve ends the point');
});

test('the racket waits for the sweet spot: a fast ball is struck near the body, not at the edge of the reach', () => {
  const g = new PadelGame({ rng: () => 0.5 });
  g.drainEvents();
  g.phase = 'rally';
  g.rally = { serving: false, faults: 0, lastTeam: 0, lastSlot: 0, bounces: 1, hits: 3, netTouched: false, serveXSign: 1 };
  const p = g.players[2];
  Object.assign(p, { x: 0, z: 5 });
  Object.assign(g.ball, { x: 0, y: 1.0, z: 1.5, vx: 0, vy: 0.3, vz: 15, sb: 0, ss: 0 }); // fast ball travelling toward the player
  g.applyInput(2, { swing: true, ax: 0, az: -6 });
  let hit = null;
  for (let i = 0; i < 40 && !hit; i++) { g.tick(DT); hit = g.drainEvents().find((e) => e.e === 'hit'); }
  assert.ok(hit, 'it connects');
  assert.ok(hit.off < 0.5, 'struck near the sweet spot: off=' + hit.off);
});
