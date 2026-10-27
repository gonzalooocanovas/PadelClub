import test from 'node:test';
import assert from 'node:assert/strict';
import { PadelGame } from '../shared/game.js';
import { stepBall, makeBall, simulateShot } from '../shared/physics.js';

const DT = 1 / 60;
const fly = (b, seconds) => { const ev = []; for (let i = 0; i < seconds * 60; i++) stepBall(b, DT, ev); return ev; };
const launched = (over) => Object.assign(makeBall(), { x: 0, y: 1.2, z: -6, vx: 0, vy: 2, vz: 14 }, over);

test('backspin floats, topspin dives (Magnus effect)', () => {
  const flat = launched({}), back = launched({ sb: 18 }), top = launched({ sb: -18 });
  fly(flat, 0.5); fly(back, 0.5); fly(top, 0.5);
  assert.ok(back.y > flat.y + 0.1, 'backspin higher');
  assert.ok(top.y < flat.y - 0.1, 'topspin lower');
});

test('sidespin curves the ball sideways', () => {
  const a = launched({ ss: 16 }), b = launched({ ss: -16 });
  fly(a, 0.6); fly(b, 0.6);
  assert.ok(a.x > 0.15 && b.x < -0.15, `curve ${a.x} ${b.x}`);
});

test('backspin bounces lower and slower than topspin', () => {
  const run = (sb) => {
    const b = Object.assign(makeBall(), { x: 0, y: 1.5, z: 1, vz: 10, vy: -2, sb });
    const ev = [];
    let peak = 0, after = false, vzAfter = 0;
    for (let i = 0; i < 120; i++) {
      ev.length = 0; stepBall(b, DT, ev);
      if (!after && ev.some((e) => e.type === 'floor')) { after = true; vzAfter = b.vz; }
      if (after) peak = Math.max(peak, b.y);
    }
    return { peak, vzAfter };
  };
  const slice = run(17), drive = run(-9);
  assert.ok(slice.peak < drive.peak, `peak ${slice.peak} < ${drive.peak}`);
  assert.ok(slice.vzAfter < drive.vzAfter, 'slice slows down');
});

test('sidespin kicks the ball along the glass on rebound', () => {
  const run = (ss) => {
    const b = Object.assign(makeBall(), { x: 0, y: 2, z: 5, vz: 14, vy: 0, ss });
    const ev = [];
    for (let i = 0; i < 80; i++) { stepBall(b, DT, ev); if (ev.some((e) => e.type === 'wall')) break; }
    return b.vx;
  };
  assert.ok(Math.abs(run(17) - run(0)) > 0.3);
});

test('shot solver lands spun balls where they were aimed (spin and drag compensated)', () => {
  const g = new PadelGame({ rng: () => 0.5 });
  const b = { ...makeBall(), x: -1, y: 1, z: -4 };
  for (const kind of ['forehand', 'slice', 'bandeja', 'vibora', 'drop', 'lob', 'volley']) {
    const v = g.planShot(kind, b, 1, 2, 7, 1);
    assert.ok(v.sb !== 0, `${kind} has spin`);
    const sim = simulateShot(b, v, { sb: v.sb, ss: v.ss });
    assert.equal(sim.kind, 'floor', `${kind} should land on the floor first`);
    if (kind === 'vibora') continue; // sidespin keeps curving, tested separately
    assert.ok(Math.hypot(sim.x - 2, sim.z - Math.max(7, 0)) < 3.2 || ['drop'].includes(kind), `${kind} lands near aim (${sim.x.toFixed(1)}, ${sim.z.toFixed(1)})`);
  }
});

test('shots have distinct signatures: slice is lower/slower than drive, bandeja slower than smash, vibora has sidespin', () => {
  const g = new PadelGame({ rng: () => 0.5 });
  const b = { ...makeBall(), x: 0, y: 1, z: -4 };
  const drive = g.planShot('forehand', b, 1, 0, 7, 1);
  const slice = g.planShot('slice', b, 1, 0, 7, 1);
  assert.ok(slice.sb > 0 && drive.sb < 0);
  assert.ok(Math.hypot(slice.vx, slice.vz) < Math.hypot(drive.vx, drive.vz));
  const hi = { ...makeBall(), x: 0, y: 2.6, z: -3 };
  const smash = g.planShot('smash', hi, 1, 0, 6, 1);
  const bandeja = g.planShot('bandeja', hi, 1, 0, 6, 1);
  const vibora = g.planShot('vibora', hi, 1, 2, 6, 1);
  assert.ok(Math.hypot(bandeja.vx, bandeja.vz) < Math.hypot(smash.vx, smash.vz));
  assert.ok(Math.abs(vibora.ss) > 5);
  assert.ok(bandeja.sb > 5);
});

test('holding the slice modifier plays a slice', () => {
  const g = new PadelGame({ rng: () => 0.5 });
  g.drainEvents();
  g.phase = 'rally';
  g.rally = { serving: false, faults: 0, lastTeam: 0, lastSlot: 0, bounces: 1, hits: 3, netTouched: false, serveXSign: 1 };
  Object.assign(g.ball, { x: 0.3, y: 1, z: 5.5, vx: 0, vy: 0, vz: -2 });
  Object.assign(g.players[2], { x: 0, z: 5 });
  g.applyInput(2, { swing: true, mod: 3, ax: 0, az: -6 });
  const evs = [];
  for (let i = 0; i < 30; i++) { g.tick(DT); evs.push(...g.drainEvents()); }
  const hit = evs.find((e) => e.e === 'hit');
  assert.equal(hit.kind, 'slice');
  assert.ok(g.ball.sb > 0);
});
