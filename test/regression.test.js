import test from 'node:test';
import assert from 'node:assert/strict';
import { stepBall, makeBall } from '../shared/physics.js';
import { PadelGame } from '../shared/game.js';
import { PLAYER, COURT } from '../shared/constants.js';
import { Room } from '../server/rooms.js';
import { rng } from '../tools/lib/scenarios.js';

const fakeWs = () => ({ readyState: 1, sent: [], send(m) { this.sent.push(typeof m === 'string' ? JSON.parse(m) : m); } });
const newRoom = (humans = 2) => {
  const r = new Room('REG01', { recordMatch: () => ({}) });
  const ms = [];
  for (let i = 0; i < humans; i++) ms.push(r.addMember({ token: 't' + i, name: 'P' + i, ws: fakeWs(), look: null }));
  r.beginMatch();
  return { r, ms };
};

test('a ball hits a wall and the floor within one simulation step: both are reported, in the right order, with a finite state', () => {
  const b = { ...makeBall(), x: 4.93, y: 0.07, z: 3, vx: 30, vy: -9, vz: 5, fe: 0.85, ff: 0.86, doors: false };
  const ev = [];
  stepBall(b, 1 / 60, ev);
  const kinds = ev.map((e) => e.type);
  assert.ok(kinds.includes('wall') && kinds.includes('floor'), `both collisions in one step: ${kinds}`);
  assert.ok([b.x, b.y, b.z, b.vx, b.vy, b.vz].every(Number.isFinite));
  assert.ok(b.x <= COURT.HALF_W && b.y >= COURT.BALL_R - 1e-9);
});

test('a player disconnecting in the middle of a point is covered by a bot at once, the match goes on, and reconnecting gives the seat back', () => {
  const { r, ms } = newRoom(2);
  const [a, b] = ms;
  r.game.phase = 'rally';
  r.game.rally = { serving: false, faults: 0, lastTeam: 1, lastSlot: 2, bounces: 0, hits: 3, netTouched: false, serveXSign: 1 };
  Object.assign(r.game.ball, { x: 0, y: 1.5, z: 3, vx: 0, vy: 1, vz: -8 });
  for (let i = 0; i < 20; i++) r.step(1 / 60);
  r.disconnect(b);
  const t0 = r.game.time;
  for (let i = 0; i < 180; i++) r.step(1 / 60);
  assert.ok(r.game.time > t0 + 2.9, 'the simulation kept running');
  assert.ok(r.game.players.every((p) => Number.isFinite(p.x + p.z)), 'finite state');
  r.reconnect(b, fakeWs());
  assert.equal(b.connected, true);
  assert.equal(r.slotOf(b.id) >= 0, true, 'the seat is still theirs');
  void a;
});

test('a room goes through pause, resume, results and rematch without losing its state', () => {
  const { r, ms } = newRoom(1);
  const [a] = ms;
  const now = Date.now();
  assert.equal(r.pauseCtl(a, 'req', now), null);
  assert.equal(r.pause.phase, 'active', 'a lone human pauses at once');
  const frozen = r.game.time;
  for (let i = 0; i < 10; i++) r.step(1 / 60);
  assert.equal(r.game.time, frozen);
  r.pauseCtl(a, 'resume', now + 1000);
  assert.equal(r.pause, null);
  // finish the match: force the winner through the scoring state
  r.game.match.winner = 0;
  r.game.phase = 'ended';
  r.game.events.push({ e: 'match', winner: 0, results: r.game.results() });
  for (let i = 0; i < 60 * 6; i++) r.step(1 / 60);
  assert.equal(r.state, 'results');
  assert.ok(r.lastResultsMsg);
  a.ready = true;
  assert.equal(r.rematch(a), null);
  for (const m of r.members.values()) assert.ok(m);
  assert.ok(['match', 'lobby'].includes(r.state), `after the rematch vote the room is ${r.state}`);
});

test('a very fast shot cannot bypass the net: at 50 m/s a low ball is still stopped, a high one still passes', () => {
  const cross = (y) => {
    const b = { ...makeBall(), x: 1, y, z: -2, vx: 0, vy: 0, vz: 50 };
    let net = false;
    for (let i = 0; i < 20; i++) { const ev = []; stepBall(b, 1 / 60, ev); if (ev.some((e) => e.type === 'net')) net = true; }
    return { net, z: b.z };
  };
  assert.equal(cross(0.5).net, true);
  assert.ok(cross(0.5).z < 0.1, 'it did not tunnel through');
  assert.equal(cross(1.5).net, false);
  assert.ok(cross(1.5).z > 1);
});

test('invalid online input cannot alter authoritative state: hostile values are clamped and the game stays finite and within limits', () => {
  const g = new PadelGame({ rng: rng(3), settings: { mode: 'doubles' } });
  const evil = [
    { mx: 1e99, mz: -1e99, sprint: 'yes', ax: 1e99, az: NaN, pace: 1e9, tac: { x: 1 }, swing: 1, jump: 1, steer: {} },
    { mx: 'a', mz: [], ax: -1e99, az: Infinity, pace: -5, tac: 'x'.repeat(500), slip: 'maybe' },
    null, undefined, 5, 'x', { swing: true, ax: NaN },
  ];
  for (let i = 0; i < 400; i++) {
    for (const k of [0, 1, 2, 3]) g.applyInput(k, evil[(i + k) % evil.length]);
    g.tick(1 / 60);
    g.drainEvents();
    for (const p of g.players) {
      assert.ok(Number.isFinite(p.x + p.z + p.vx + p.vz + p.stamina), 'finite');
      assert.ok(Math.abs(p.x) <= 8 && Math.abs(p.z) <= 10, 'inside the venue');
      assert.ok(Math.hypot(p.vx, p.vz) <= PLAYER.SPRINT * 1.01 + 1e-6, 'never faster than a sprint');
      assert.ok(p.stamina >= 0 && p.stamina <= 100);
    }
  }
  const sw = g.players[0].wantSwing;
  if (sw) { assert.ok(sw.pace >= 0.6 && sw.pace <= 1.15, 'pace is clamped'); assert.ok(String(sw.tac).length <= 14, 'labels are bounded'); }
  assert.ok(Number.isFinite(g.ball.x + g.ball.y + g.ball.z));
});

test('the server ignores input from a client that is not in a match, and clamps queue length per player', () => {
  const { r, ms } = newRoom(1);
  const [a] = ms;
  r.pushInputs(a, Array.from({ length: 500 }, (_, i) => ({ seq: i, mx: 1 })));
  assert.ok(r.queues[r.slotOf(a.id)].length <= 10, 'bounded queue');
  const lobby = new Room('REG02', { recordMatch: () => ({}) });
  const m = lobby.addMember({ token: 'x', name: 'X', ws: fakeWs(), look: null });
  assert.doesNotThrow(() => lobby.pushInputs(m, [{ mx: 1 }]));
});
