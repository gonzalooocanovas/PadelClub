import test from 'node:test';
import assert from 'node:assert/strict';
import { stepBall, makeBall, wallE } from '../shared/physics.js';
import { PHYS } from '../shared/constants.js';

const rebound = (b) => {
  const ev = [];
  for (let i = 0; i < 90 && !ev.some((e) => e.type === 'wall'); i++) stepBall(b, 1 / 60, ev);
  return ev.find((e) => e.type === 'wall');
};

test('glass is lively, the fence (verja) is dead', () => {
  const side = (z, y) => ({ ...makeBall(), doors: false, x: 4.0, y, z, vx: 14, vy: 0, vz: 0 });
  const glass = side(8, 1.2); const glassHit = rebound(glass);
  const fence = side(4.5, 1.2); const fenceHit = rebound(fence);
  assert.equal(glassHit.mesh, false); assert.equal(fenceHit.mesh, true);
  assert.ok(-glass.vx > 8, `glass returns most of the speed (${glass.vx.toFixed(1)})`);
  assert.ok(-fence.vx < 0.45 * -glass.vx, `the fence takes most of it (${fence.vx.toFixed(1)} vs ${glass.vx.toFixed(1)})`);
  const back = { ...makeBall(), x: 0, y: 1.2, z: 9.0, vx: 0, vy: 0, vz: 14 }; assert.equal(rebound(back).mesh, false);
  assert.ok(-back.vz > 8, 'the back glass returns the ball');
  const high = { ...makeBall(), x: 0, y: 3.5, z: 9.0, vx: 0, vy: 0, vz: 14 }; assert.equal(rebound(high).mesh, true);
  assert.ok(-high.vz < 0.45 * -back.vz, 'the mesh above the glass is dead');
});

test('1v1 side walls are glass all along', () => {
  const b = { ...makeBall(), hw: 3.5, x: 2.5, y: 1.2, z: 1.0, vx: 14, vy: 0, vz: 0 };
  assert.equal(rebound(b).mesh, false);
});

test('the floor bounces higher than before and a hard drop keeps most of its height', () => {
  const b = { ...makeBall(), fe: PHYS.FLOOR_E, x: 0, y: 2, z: 0, vx: 0, vy: 0, vz: 0 };
  let peak = 0, bounced = false;
  for (let i = 0; i < 200; i++) {
    const ev = []; stepBall(b, 1 / 60, ev);
    if (ev.some((e) => e.type === 'floor')) bounced = true;
    if (bounced) peak = Math.max(peak, b.y);
  }
  assert.ok(peak > 1.15 && peak < 1.7, `bounce height ${peak.toFixed(2)} m from 2 m`);
  assert.ok(wallE(10, false) > wallE(10, true) * 2);
});

test('spin meets glass: topspin climbs the wall, backspin drops it', () => {
  const hit = (sb) => {
    const b = { ...makeBall(), x: 0, y: 1.5, z: 9.0, vx: 0, vy: 0, vz: 14, sb };
    rebound(b);
    return b.vy;
  };
  const top = hit(-12), none = hit(0), back = hit(12);
  assert.ok(top > none + 0.5 && back < none - 0.5, `topspin ${top.toFixed(1)}, flat ${none.toFixed(1)}, backspin ${back.toFixed(1)} m/s vertical off the glass`);
});

test('"por 4": a clean short smash from the net bounces out of the court over the fence, a poor one does not', async () => {
  const { PadelGame } = await import('../shared/game.js');
  const g = new PadelGame({ rng: () => 0.5 });
  const fly = (q) => {
    const b = { x: 0.5, y: 2.6, z: -2.4, vx: 0, vy: 0, vz: 0, sb: 0, ss: 0, hw: 5, fe: 0.85, ff: 0.86 };
    const v = g.planShot('smash', b, 1, 1.5, 3.5, q, 8, null, { face: 0, e: 0.1, lateral: 0, forward: 0, spinMul: 1, powerMul: 1 });
    const ball = { ...b, vx: v.vx, vy: v.vy, vz: v.vz, sb: v.sb, ss: v.ss };
    let bounced = false;
    for (let i = 0; i < 400; i++) {
      const ev = []; stepBall(ball, 1 / 60, ev);
      for (const e of ev) { if (e.type === 'floor') bounced = true; if (e.type === 'out' && bounced) return true; }
    }
    return false;
  };
  assert.equal(fly(0.95), true);
  assert.equal(fly(0.6), false);
});

test('a ball that has settled on the floor rolls and slows gently instead of stopping dead, without spamming bounce events', () => {
  const b = { ...makeBall(), x: 0, y: 0.0335, z: 0, vx: 6, vy: 0, vz: 0 };
  let events = 0, dist = 0;
  for (let i = 0; i < 60; i++) { const ev = []; const x0 = b.x; stepBall(b, 1 / 60, ev); events += ev.filter((e) => e.type === 'floor').length; dist += b.x - x0; }
  assert.equal(events, 0, 'rolling is not a bounce');
  assert.ok(dist > 2.5, `rolled ${dist.toFixed(1)} m in a second`);
  assert.ok(b.vx > 1 && b.vx < 6, 'slowing, not stopped');
});
