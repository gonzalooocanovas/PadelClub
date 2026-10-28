import test from 'node:test';
import assert from 'node:assert/strict';
import { PadelGame } from '../shared/game.js';
import { botInput, makeBotMemory } from '../shared/ai.js';
import { rng } from '../tools/lib/scenarios.js';
import { solveLaunch } from '../shared/physics.js';

/** A ball hit from the opponents' side that will land at (tx, tz) on team 0's side after T seconds. */
function ballTo(tx, tz, T = 1.0) {
  const b = { x: 0.5, y: 1.4, z: 5 };
  const v = solveLaunch(b, tx, tz, T);
  return { ...b, ...v, sb: 0, ss: 0 };
}

/** Team 0 (slots 0 and 1) receives a ball. Returns who swung and how far each moved. */
function scenario({ a, b, ball, humanSlot = -1, level = 'hard', seed = 1, secs = 1.6, frozen = [] }) {
  const g = new PadelGame({ rng: rng(seed), settings: { mode: 'doubles' } });
  g.phase = 'rally';
  g.rally = { serving: false, faults: 0, lastTeam: 1, lastSlot: 2, bounces: 0, hits: 4, netTouched: false, serveXSign: 1 };
  Object.assign(g.players[0], { x: a[0], z: a[1], vx: 0, vz: 0 });
  Object.assign(g.players[1], { x: b[0], z: b[1], vx: 0, vz: 0 });
  Object.assign(g.players[2], { x: -1, z: 6.5 }); Object.assign(g.players[3], { x: 1.5, z: 7 });
  Object.assign(g.ball, ball, { hw: 5, fe: 0.85, ff: 0.86 });
  if (humanSlot >= 0) g.players[humanSlot].human = true;
  const mem = [0, 1, 2, 3].map(makeBotMemory);
  const start = [g.players[0], g.players[1]].map((p) => [p.x, p.z]);
  const swung = [false, false];
  let minD = [99, 99];
  for (let i = 0; i < secs * 60 && g.phase === 'rally'; i++) {
    for (const k of [0, 1]) {
      if (k === humanSlot || frozen.includes(k)) { g.applyInput(k, { mx: 0, mz: 0 }); continue; }
      const inp = botInput(g, k, mem[k], level, 1 / 60);
      if (inp.swing) swung[k] = true;
      g.applyInput(k, inp);
    }
    g.players[2].input = g.players[3].input = { mx: 0, mz: 0 };
    g.tick(1 / 60);
    g.drainEvents();
    for (const k of [0, 1]) minD[k] = Math.min(minD[k], Math.hypot(g.ball.x - g.players[k].x, g.ball.z - g.players[k].z));
  }
  const moved = [0, 1].map((k) => Math.hypot(g.players[k].x - start[k][0], g.players[k].z - start[k][1]));
  return { swung, moved, minD, g };
}

test('a ball down the middle: exactly one player takes it, the other does not also run at it (at least 90% of 60 scenarios)', () => {
  let ok = 0, n = 60, both = 0, none = 0;
  for (let s = 1; s <= n; s++) {
    const r = rng(s * 3);
    const zBall = -(3.5 + r() * 3.5);
    const res = scenario({ a: [-2 - r() * 0.8, -(3 + r() * 5)], b: [2 + r() * 0.8, -(3 + r() * 5)], ball: ballTo((r() - 0.5) * 0.8, zBall), seed: s });
    const taken = res.swung.filter(Boolean).length;
    if (taken === 1) ok++; else if (taken === 2) both++; else none++;
  }
  assert.ok(ok / n >= 0.9, `one clear owner in ${ok}/${n} (both ${both}, nobody ${none})`);
});

test('cross-court ball: the player on the ball side takes it', () => {
  let ok = 0, n = 30;
  for (let s = 1; s <= n; s++) {
    const r = rng(s + 40);
    const left = r() < 0.5;
    const res = scenario({ a: [-2.2, -6], b: [2.2, -6], ball: ballTo((left ? -1 : 1) * (2.5 + r()), -6.5, 1.1), seed: s });
    const owner = res.swung.indexOf(true);
    if (owner === (left ? 0 : 1)) ok++;
  }
  assert.ok(ok / n >= 0.85, `the ball-side player owned ${ok}/${n}`);
});

test('two partners starting on top of each other separate instead of colliding', () => {
  const res = scenario({ a: [0, -6], b: [0.4, -6.2], ball: ballTo(0.2, -6, 1.2), secs: 1.0 });
  assert.ok(Math.hypot(res.g.players[0].x - res.g.players[1].x, res.g.players[0].z - res.g.players[1].z) >= 0.85);
});

test('with a person as partner: the bot does not steal a ball the person can reach, and takes one the person cannot', () => {
  // ball right at the person's feet
  const mine = scenario({ a: [-2.5, -6], b: [2.5, -6], ball: ballTo(-2.4, -6, 1.1), humanSlot: 0 });
  assert.equal(mine.swung[1], false, 'the bot leaves the human\'s ball alone');
  // the person is pulled wide on the left, a ball goes to the right corner
  const wide = scenario({ a: [-4.4, -3], b: [0, -7], ball: ballTo(3, -7, 1.3), humanSlot: 0, secs: 2.2 });
  assert.equal(wide.swung[1], true, 'the bot covers what the person cannot reach');
});

test('a teammate that cannot get there (frozen, far away): the other player takes the ball (emergency fallback)', () => {
  const res = scenario({ a: [-4.6, -2], b: [1.5, -7.5], ball: ballTo(1.0, -7, 1.3), frozen: [0], secs: 2.2 });
  assert.equal(res.swung[1], true);
});
