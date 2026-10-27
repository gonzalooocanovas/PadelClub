import test from 'node:test';
import assert from 'node:assert/strict';
import { stepBall, stepPlayer, makeBall } from '../shared/physics.js';
import { PadelGame } from '../shared/game.js';
import { COURT } from '../shared/constants.js';
import { botInput, makeBotMemory } from '../shared/ai.js';

const door = (COURT.DOOR.z0 + COURT.DOOR.z1) / 2;
const doorB = -door; // door on team 0's half

function fly(b, secs = 3) {
  const ev = [];
  for (let t = 0; t < secs * 60; t++) stepBall(b, 1 / 60, ev);
  return ev;
}

test('a ball aimed at a door leaves the court; elsewhere the glass bounces it', () => {
  const a = { ...makeBall(), doors: true, x: 4, y: 1, z: door, vx: 8, vy: 1, vz: 0 };
  const evA = fly(a, 0.5);
  assert.ok(evA.some((e) => e.type === 'door'));
  assert.ok(a.x > 5);
  const b = { ...makeBall(), doors: true, x: 4, y: 1, z: 5, vx: 8, vy: 1, vz: 0 };
  const evB = fly(b, 0.5);
  assert.ok(evB.some((e) => e.type === 'wall') && !evB.some((e) => e.type === 'door'));
  assert.ok(b.x < 5);
});

test('above the door height the glass still bounces the ball', () => {
  const a = { ...makeBall(), doors: true, x: 4, y: 2.6, z: door, vx: 6, vy: 0, vz: 0 };
  const ev = fly(a, 0.4);
  assert.ok(ev.some((e) => e.type === 'wall'));
});

test('the outer fence keeps the ball in the strip, and it can return through the door', () => {
  const a = { ...makeBall(), doors: true, x: 4.5, y: 1, z: door, vx: 14, vy: 2, vz: 0 };
  const ev = fly(a, 2);
  assert.ok(ev.some((e) => e.type === 'door'));
  assert.ok(Math.abs(a.x) <= COURT.HALF_W + COURT.PIT.w);
});

test('players only reach the strip through the door', () => {
  const p = { x: 4.7, z: -door, vx: 0, vz: 0, stamina: 100, team: 0, pit: true };
  for (let i = 0; i < 90; i++) stepPlayer(p, { mx: 1, mz: 0 }, 1 / 60);
  assert.ok(p.x > 5.3, 'walked out through the door');
  const q = { x: 4.7, z: -5, vx: 0, vz: 0, stamina: 100, team: 0, pit: true };
  for (let i = 0; i < 90; i++) stepPlayer(q, { mx: 1, mz: 0 }, 1 / 60);
  assert.ok(q.x <= 4.75 + 1e-9, 'blocked by the wall away from the door');
});

test('1v1 has no doors', () => {
  const g = new PadelGame({ settings: { mode: 'singles' } });
  assert.equal(g.ball.doors, false);
});

test('rules: a ball that leaves through a door before bouncing is out; after a bounce the receiver may play it from outside', () => {
  const g = new PadelGame({ settings: { mode: 'doubles' } });
  g.phase = 'rally';
  g.rally = { serving: false, faults: 0, lastTeam: 0, lastSlot: 0, bounces: 0, hits: 2, netTouched: false, serveXSign: 1 };
  g.onBallEvent({ type: 'door', x: 5.1, y: 1, z: door });
  assert.equal(g.phase, 'point');
  assert.equal(g.events.find((e) => e.e === 'point').winner, 1);

  const h = new PadelGame({ settings: { mode: 'doubles' } });
  h.phase = 'rally';
  h.rally = { serving: false, faults: 0, lastTeam: 0, lastSlot: 0, bounces: 1, hits: 2, netTouched: false, serveXSign: 1 };
  h.onBallEvent({ type: 'door', x: 5.1, y: 1, z: door });
  assert.equal(h.phase, 'rally');
});

test('a return from outside must land inside the court', () => {
  const g = new PadelGame({ settings: { mode: 'doubles' } });
  g.phase = 'rally';
  g.rally = { serving: false, faults: 0, lastTeam: 1, lastSlot: 2, bounces: 0, hits: 3, netTouched: false, serveXSign: 1 };
  g.onBallEvent({ type: 'floor', x: 6.2, z: 5.5, speed: 3 });
  assert.equal(g.events.find((e) => e.e === 'point').winner, 0);
});

test('a bot-free full scenario: the receiver goes out, hits a lob over the glass and the ball lands in the opponent court', () => {
  const g = new PadelGame({ settings: { mode: 'doubles', openings: true }, rng: () => 0.5 });
  g.phase = 'rally';
  g.rally = { serving: false, faults: 0, lastTeam: 1, lastSlot: 2, bounces: 1, hits: 2, netTouched: false, serveXSign: 1 };
  const b = g.ball;
  Object.assign(b, { x: 5.6, y: 0.9, z: -door, vx: 0, vy: 0, vz: 0, ex: true });
  const p = g.players[0];
  Object.assign(p, { x: 5.2, z: -door, vx: 0, vz: 0 });
  g.players[1].x = -3; g.players[1].z = -2;
  p.input = { ...p.input, mx: 0, mz: 0, ax: -1, az: 8 };
  g.startSwing(p, { ax: -1, az: 8, mod: 0, lob: false });
  let landed = null;
  for (let i = 0; i < 60 * 6 && g.phase === 'rally'; i++) {
    g.tick(1 / 60);
    for (const e of g.drainEvents()) if (e.e === 'ball' && e.k === 'floor' && !landed) landed = e;
  }
  assert.ok(landed, 'ball landed');
  assert.ok(landed.z > 0 && Math.abs(landed.x) < 5, `landed in the opponent court (${landed.x}, ${landed.z})`);
});

test('bots follow a ball out of the door and return it into play', () => {
  let outHits = 0;
  for (let m = 0; m < 12; m++) {
    let s = m + 7;
    const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const g = new PadelGame({ rng, settings: { mode: 'doubles' } });
    const mem = [0, 1, 2, 3].map(makeBotMemory);
    g.phase = 'rally';
    g.rally = { serving: false, faults: 0, lastTeam: 1, lastSlot: 2, bounces: 1, hits: 3, netTouched: false, serveXSign: 1 };
    const side = m % 2 ? 1 : -1;
    Object.assign(g.ball, { x: 4.9 * side, y: 1.0, z: -2.2, vx: 2.6 * side, vy: 1.0, vz: -0.3, ex: false });
    Object.assign(g.players[0], { x: -2, z: -6 }); Object.assign(g.players[1], { x: 1, z: -3 });
    Object.assign(g.players[2], { x: 0, z: 6 }); Object.assign(g.players[3], { x: 1, z: 2 });
    for (let i = 0; i < 60 * 6 && g.phase === 'rally'; i++) {
      for (let k = 0; k < 4; k++) g.applyInput(k, botInput(g, k, mem[k], 'hard', 1 / 60));
      g.tick(1 / 60);
      for (const e of g.drainEvents()) if (e.e === 'hit' && Math.abs(e.x) > 5) outHits++;
    }
  }
  assert.ok(outHits >= 6, `bots hit from outside in most cases (${outHits}/12)`);
});

test('the net tape can pop a ball over (cord) without it being a fault', () => {
  const b = { ...makeBall(), x: 0, y: 0.97, z: -0.05, vx: 0, vy: -0.4, vz: 6 };
  const ev = [];
  for (let i = 0; i < 20; i++) stepBall(b, 1 / 60, ev);
  assert.ok(ev.some((e) => e.type === 'cord') || ev.some((e) => e.type === 'net') || b.z > 0);
});
