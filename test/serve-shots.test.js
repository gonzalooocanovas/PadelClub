import test from 'node:test';
import assert from 'node:assert/strict';
import { PadelGame } from '../shared/game.js';
import { simulateShot, serveBallHeight } from '../shared/physics.js';

test('well-struck slices, drives and volleys clear the net', () => {
  let s = 3;
  const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const g = new PadelGame({ rng });
  let net = 0, n = 0;
  for (const kind of ['slice', 'forehand', 'backhand', 'volley', 'chiquita', 'bandeja']) {
    for (let i = 0; i < 40; i++) {
      const b = { x: (rng() - 0.5) * 6, y: 0.7 + rng() * 0.6, z: -(2.5 + rng() * 6), vx: 0, vy: 0, vz: 0, sb: 0, ss: 0 };
      const v = g.planShot(kind, b, 1, (rng() - 0.5) * 5, 3 + rng() * 6, 0.95, 12, null, { face: 0, e: 0.1, lateral: 0, forward: 0, spinMul: 1 });
      const sim = simulateShot(b, v, { sb: v.sb, ss: v.ss });
      n++;
      if (sim.kind === 'net') net++;
    }
  }
  assert.ok(net / n < 0.03, `net rate ${net}/${n}`);
});

test('serve quality needs a narrow timing window and a good serve is faster', () => {
  const g = new PadelGame({ rng: () => 0.5 });
  const fast = g.planShot('serve', { x: 2, y: 0.62, z: -8, vx: 0, vy: 0, vz: 0 }, 1, 2, 5, 0.98, 0, null);
  const slow = g.planShot('serve', { x: 2, y: 0.62, z: -8, vx: 0, vy: 0, vz: 0 }, 1, 2, 5, 0.35, 0, null);
  assert.ok(Math.hypot(fast.vx, fast.vz) > Math.hypot(slow.vx, slow.vz) * 1.05, 'better timing = more pace');
  const ys = []; for (let t = 0; t < 0.8; t += 0.01) ys.push(serveBallHeight(t));
  const inWindow = ys.filter((y) => Math.abs(y - 0.62) < 0.1).length / ys.length;
  assert.ok(inWindow < 0.3, 'the good window is a small part of the bounce cycle');
});

test('a full-power serve often flies long; a tap almost never does', () => {
  const run = (pace) => {
    let long = 0, n = 60;
    for (let i = 0; i < n; i++) {
      let s = i * 977 + 3;
      const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      const g = new PadelGame({ rng });
      const p = g.players[g.serverSlot];
      g.phase = 'serve'; g.serveWait = 0;
      Object.assign(g.ball, { x: p.x, y: 0.62, z: p.z, vx: 0, vy: 0, vz: 0 });
      g.holdBall = () => {};
      p.swing = { t: 0.05, done: false, ax: 0, az: 5.4 * (p.team === 0 ? 1 : -1), mod: 0, lob: false, pace };
      p.input = { ...p.input, ax: 0, az: 5.4 * (p.team === 0 ? 1 : -1), mx: 0, mz: 0 };
      g.doServe(p);
      const sim = simulateShot(g.ball, { vx: g.ball.vx, vy: g.ball.vy, vz: g.ball.vz }, { sb: g.ball.sb, ss: g.ball.ss });
      const sideOk = Math.abs(sim.z) <= 6.95;
      if (sim.kind !== 'floor' || !sideOk) long++;
    }
    return long / n;
  };
  const tap = run(0.9), full = run(1.12);
  assert.ok(full > tap + 0.25, `full power ${full.toFixed(2)} vs tap ${tap.toFixed(2)}`);
  assert.ok(tap < 0.2, `a normal serve stays in (${tap.toFixed(2)})`);
});
