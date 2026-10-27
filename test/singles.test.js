import test from 'node:test';
import assert from 'node:assert/strict';
import { PadelGame } from '../shared/game.js';
import { botInput, makeBotMemory } from '../shared/ai.js';
import { createMatch, pointWon, currentServer } from '../shared/scoring.js';
import { Room } from '../server/rooms.js';

const DT = 1 / 60;

test('singles: only two players are active and the server is always the first player of the team', () => {
  const g = new PadelGame({ settings: { mode: 'singles' } });
  assert.deepEqual(g.players.map((p) => p.active), [true, false, true, false]);
  const m = createMatch({ singles: true, sets: 1, gamesPerSet: 6 });
  const servers = [];
  for (let i = 0; i < 4; i++) { servers.push(currentServer(m)); for (let k = 0; k < 4; k++) pointWon(m, 0); }
  assert.ok(servers.every((s) => s.idx === 0));
  assert.deepEqual(servers.map((s) => s.team), [0, 1, 0, 1]);
});

test('singles: the court is narrower and fully walled: the ball plays off the side glass, players stay inside', () => {
  const g = new PadelGame({ settings: { mode: 'singles' }, rng: () => 0.5 });
  g.drainEvents();
  g.phase = 'rally';
  g.rally = { serving: false, faults: 0, lastTeam: 0, lastSlot: 0, bounces: 1, hits: 3, netTouched: false, serveXSign: 1 };
  Object.assign(g.ball, { x: 3.2, y: 1.8, z: 4, vx: 5, vy: 0, vz: 1 });
  const evs = [];
  for (let i = 0; i < 20; i++) { g.tick(DT); evs.push(...g.drainEvents()); }
  assert.ok(evs.some((e) => e.e === 'ball' && e.k === 'wall' && e.axis === 'x'), 'ball hit the side glass at 3.5 m');
  assert.ok(!evs.some((e) => e.e === 'point'), 'no out call: walls are in play');
  assert.ok(Math.abs(g.ball.x) <= 3.5);
  g.applyInput(0, { mx: 1 });
  for (let i = 0; i < 200; i++) g.tick(DT);
  assert.ok(Math.abs(g.players[0].x) <= 3.25 + 1e-6, 'player cannot leave the narrow court');
});

test('singles: two bots play a full short match', () => {
  const g = new PadelGame({ settings: { mode: 'singles', sets: 1, gamesPerSet: 2, difficulty: 'hard' } });
  const mem = [0, 1, 2, 3].map(makeBotMemory);
  let done = null;
  for (let i = 0; i < 60 * 60 * 30 && !done; i++) {
    for (const s of [0, 2]) g.applyInput(s, botInput(g, s, mem[s], 'hard'));
    g.tick(DT);
    done = g.drainEvents().find((e) => e.e === 'match');
  }
  assert.ok(done, 'singles match finished');
  assert.ok(g.stats.players[1].hits === 0 && g.stats.players[3].hits === 0, 'inactive slots never play');
});

test('room: switching to 1v1 moves players into the singles seats and limits the room to two', () => {
  const store = { recordMatch: () => ({}) };
  const room = new Room('TEST1', store);
  const mk = (n) => room.addMember({ token: n, name: n, ws: null });
  const a = mk('Ana'), b = mk('Ben'), c = mk('Cleo');
  assert.deepEqual([a, b, c].map((m) => room.slotOf(m.id)), [0, 1, 2]);
  assert.match(room.setSettings(a, { mode: 'singles' }), /Too many/);
  room.removeMember(c.id);
  assert.equal(room.setSettings(a, { mode: 'singles' }), null);
  assert.deepEqual([a, b].map((m) => room.slotOf(m.id)), [0, 2]);
  assert.equal(room.canJoin(), 'Room is full');
  assert.equal(room.sit(a, 1), 'Bad slot');
});
