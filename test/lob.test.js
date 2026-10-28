import test from 'node:test';
import assert from 'node:assert/strict';
import { PadelGame } from '../shared/game.js';
import { stepBall, solveLaunch } from '../shared/physics.js';

function flight(q) {
  const g = new PadelGame({ rng: () => 0.5 });
  const b = { x: 0, y: 1, z: -3, vx: 0, vy: 0, vz: 0, sb: 0, ss: 0 };
  const v = g.planShot('lob', b, 1, 0, 8.5, q, 8, null, { face: 0, e: 0.1, lateral: 0, forward: 0, spinMul: 1, powerMul: 1 });
  const ball = { ...b, vx: v.vx, vy: v.vy, vz: v.vz, sb: v.sb, ss: v.ss };
  let apex = 0, land = null;
  for (let i = 0; i < 300 && !land; i++) {
    const ev = [];
    stepBall(ball, 1 / 60, ev);
    apex = Math.max(apex, ball.y);
    const f = ev.find((e) => e.type === 'floor');
    if (f) land = f;
  }
  return { apex, land };
}

test('a clean lob goes high and deep; a poor one is low and short (easy to smash)', () => {
  const good = flight(0.95), poor = flight(0.35);
  assert.ok(good.land && poor.land);
  assert.ok(good.land.z > 7, `perfect lob lands deep (${good.land.z.toFixed(1)} m)`);
  assert.ok(poor.land.z < good.land.z - 2, `poor lob lands short (${poor.land.z.toFixed(1)} m)`);
  assert.ok(good.apex > poor.apex + 0.6, `and higher (${good.apex.toFixed(1)} vs ${poor.apex.toFixed(1)} m)`);
  assert.ok(poor.apex > 2.2, 'a poor lob is still a lob: in smash range, not a drive');
});

import { botInput, makeBotMemory } from '../shared/ai.js';

test('doubles: when a real lob is coming the pair drops back: both end deep, side by side', () => {
  const g = new PadelGame({ rng: () => 0.5, settings: { mode: 'doubles' } });
  const mem = [0, 1, 2, 3].map(makeBotMemory);
  g.phase = 'rally';
  g.rally = { serving: false, faults: 0, lastTeam: 1, lastSlot: 2, bounces: 0, hits: 4, netTouched: false, serveXSign: 1 };
  Object.assign(g.players[0], { x: -2, z: -3 }); Object.assign(g.players[1], { x: 2, z: -2.6 });
  Object.assign(g.players[2], { x: -1, z: 3.2 }); Object.assign(g.players[3], { x: 1.5, z: 3.0 });
  const b = { x: 0.5, y: 2.2, z: 3.5 };
  Object.assign(g.ball, b, solveLaunch(b, 0.5, -8.6, 2.0), { hw: 5, fe: 0.85, ff: 0.86, sb: 0, ss: 0 });
  for (let i = 0; i < 100 && g.phase === 'rally'; i++) {
    for (const k of [0, 1]) g.applyInput(k, botInput(g, k, mem[k], 'hard', 1 / 60));
    g.players[2].input = g.players[3].input = { mx: 0, mz: 0 };
    g.tick(1 / 60); g.drainEvents();
  }
  const [a, c] = [g.players[0], g.players[1]];
  assert.ok(Math.min(a.z, c.z) < -5.8 && Math.max(a.z, c.z) < -4.5, `both retreat (${a.z.toFixed(1)}, ${c.z.toFixed(1)})`);
  assert.ok(Math.abs(a.x - c.x) > 1.0, 'and the pair keeps its width');
});

test('a ball reached at full stretch or hit with great pace gets a weaker reply', () => {
  const reply = (px, speed) => {
    const g = new PadelGame({ rng: () => 0.5 });
    g.phase = 'rally';
    g.rally = { serving: false, faults: 0, lastTeam: 1, lastSlot: 2, bounces: 0, hits: 3, netTouched: false, serveXSign: 1 };
    Object.assign(g.ball, { x: 0, y: 1.0, z: -3, vx: 0, vy: 0, vz: -speed });
    Object.assign(g.players[0], { x: px, z: -3.0, vx: 0, vz: 0 });
    g.startSwing(g.players[0], { ax: 0, az: 8, mod: 0, lob: false });
    for (let i = 0; i < 40; i++) {
      g.ball.x = 0; g.ball.z = -3; g.ball.y = 1.0; // hold the ball where it is for the test
      g.tick(1 / 60);
      const h = g.drainEvents().find((e) => e.e === 'hit');
      if (h) return { q: h.q, label: h.label, speed: Math.hypot(g.ball.vx, g.ball.vz) };
    }
    return null;
  };
  const easy = reply(-0.95, 6), stretched = reply(-1.75, 6), fast = reply(-0.95, 26);
  assert.ok(easy && stretched && fast);
  assert.ok(stretched.q < easy.q - 0.15, `stretched ${stretched.q} vs ${easy.q}`);
  assert.ok(fast.q < easy.q - 0.1, `fast ${fast.q} vs ${easy.q}`);
  assert.ok(stretched.speed < easy.speed, 'and the reply is slower');
});
