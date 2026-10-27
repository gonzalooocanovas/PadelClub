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
