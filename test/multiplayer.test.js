import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.js';
import { Store } from '../server/store.js';

let srv;
let dataDir;
const url = () => `ws://127.0.0.1:${srv.port}/ws`;

class Client {
  constructor(name) {
    this.name = name;
    this.msgs = [];
    this.waiters = [];
    this.token = null;
  }
  async connect(token) {
    this.ws = new WebSocket(url());
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => !w.try(m));
    });
    await new Promise((r) => this.ws.once('open', r));
    this.send({ t: 'hello', name: this.name, token });
    const w = await this.wait((m) => m.t === 'welcome');
    this.token = w.token;
    return this;
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  /** resolves with the first message (past or future) matching pred */
  wait(pred, ms = 8000, { past = true } = {}) {
    if (past) { const hit = this.msgs.find(pred); if (hit) return Promise.resolve(hit); }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.name}: timeout waiting for message`)), ms);
      this.waiters.push({ try: (m) => { if (pred(m)) { clearTimeout(t); resolve(m); return true; } return false; } });
    });
  }
  waitEvent(kind, ms = 15000, opts) {
    return this.wait((m) => m.t === 'ev' && m.ev.some((e) => e.e === kind), ms, opts)
      .then((m) => m.ev.find((e) => e.e === kind));
  }
  lastRoom() { return [...this.msgs].reverse().find((m) => m.t === 'room'); }
  close() { this.ws.close(); }
}

async function fourPlayers() {
  const cs = ['Ana', 'Ben', 'Cleo', 'Dan'].map((n) => new Client(n));
  await Promise.all(cs.map((c) => c.connect()));
  cs[0].send({ t: 'create' });
  const room = await cs[0].wait((m) => m.t === 'room');
  for (const c of cs.slice(1)) {
    c.send({ t: 'join', code: room.code });
    await c.wait((m) => m.t === 'room');
  }
  return { cs, code: room.code };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'padel-test-'));
  srv = await createGameServer({ port: 0, dataDir, host: '127.0.0.1' });
});
after(async () => {
  await srv.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a room can be created and has a shareable code', async () => {
  const a = await new Client('Solo').connect();
  a.send({ t: 'create' });
  const room = await a.wait((m) => m.t === 'room');
  assert.match(room.code, /^[A-Z2-9]{5}$/);
  assert.equal(room.hostId, room.you);
  assert.equal(room.state, 'lobby');
  a.close();
});

test('invalid code and unknown room give clear errors', async () => {
  const a = await new Client('Lost').connect();
  a.send({ t: 'join', code: 'ZZZZZ' });
  const err = await a.wait((m) => m.t === 'error');
  assert.equal(err.code, 'join-failed');
  assert.match(err.message, /not found/i);
  a.close();
});

test('four clients join, teams are assigned, ready state syncs, a fifth is rejected', async () => {
  const { cs, code } = await fourPlayers();
  const view = await cs[3].wait((m) => m.t === 'room' && m.slots.every(Boolean));
  assert.deepEqual(view.slots.map((s) => s.name), ['Ana', 'Ben', 'Cleo', 'Dan']);
  assert.equal(view.youSlot, 3); // Dan sits in team B

  // host swaps Ana (team A) with Dan (team B)
  const room = cs[0].lastRoom();
  const danId = room.slots[3].id;
  cs[0].send({ t: 'assign', id: danId, slot: 0 });
  const swapped = await cs[3].wait((m) => m.t === 'room' && m.slots[0]?.name === 'Dan', 3000, { past: false });
  assert.equal(swapped.slots[3].name, 'Ana');

  // a non-host cannot move people
  cs[1].send({ t: 'assign', id: danId, slot: 1 });
  await cs[1].wait((m) => m.t === 'error' && m.code === 'rejected');

  // ready is visible to everyone
  cs[2].send({ t: 'ready', ready: true });
  const r = await cs[0].wait((m) => m.t === 'room' && m.slots.find((s) => s?.name === 'Cleo')?.ready, 3000, { past: false });
  assert.ok(r);

  // the host cannot start until everybody is ready
  cs[0].send({ t: 'start' });
  const err = await cs[0].wait((m) => m.t === 'error' && /not ready/.test(m.message), 3000, { past: false });
  assert.ok(err);

  // room is full
  const e = await new Client('Eve').connect();
  e.send({ t: 'join', code });
  const full = await e.wait((m) => m.t === 'error');
  assert.match(full.message, /full/i);
  [e, ...cs].forEach((c) => c.close());
});

test('full match flow: consistent state, server-side scoring, cheating ignored, reconnect, persistence', async () => {
  const { cs } = await fourPlayers();
  const [host, ...others] = cs;
  host.send({ t: 'settings', settings: { sets: 1, gamesPerSet: 2 } });
  for (const c of others) c.send({ t: 'ready', ready: true });
  await host.wait((m) => m.t === 'room' && m.slots.every((s) => s.ready) && m.settings.gamesPerSet === 2, 3000, { past: false }).catch(() => {});
  host.send({ t: 'start' });

  const starts = await Promise.all(cs.map((c) => c.wait((m) => m.t === 'start')));
  assert.deepEqual(starts.map((s) => s.slot), [0, 1, 2, 3]);
  assert.deepEqual(starts[0].names, ['Ana', 'Ben', 'Cleo', 'Dan']);

  // all four see the same snapshot (same tick => identical ball + players)
  const snaps = await Promise.all(cs.map((c) => c.wait((m) => m.t === 'snap' && m.n >= 30, 4000)));
  const byTick = new Map(snaps.map((s) => [s.n, s]));
  const common = [...cs[0].msgs, ...cs[1].msgs].find((m) => m.t === 'snap' && cs.every((c) => c.msgs.some((x) => x.t === 'snap' && x.n === m.n)));
  if (common) {
    const copies = cs.map((c) => c.msgs.find((x) => x.t === 'snap' && x.n === common.n));
    for (const s of copies) assert.deepEqual(s, copies[0]);
  }
  assert.ok(byTick.size >= 1);

  // cheating: clients cannot award points, set scores or send absurd inputs
  const serveEv = await cs[0].waitEvent('serve');
  const serverSlot = serveEv.slot;
  const cheat = cs[(serverSlot + 1) % 4];
  cheat.send({ t: 'score', team: 0, points: 99 });
  cheat.send({ t: 'point', winner: 0 });
  cheat.send({ t: 'in', inputs: [{ seq: 1, mx: 9999, mz: -9999, swing: true, ax: 1e9, az: 1e9, ball: { x: 0, y: 0, z: 0 } }] });
  cheat.send({ t: 'results', winner: 0 });

  // the server's player serves an ace-ish serve: nobody returns, so the server's team wins the point
  const srvClient = cs[serverSlot];
  const dir = serverSlot < 2 ? 1 : -1;
  await new Promise((r) => setTimeout(r, 1200));
  srvClient.send({ t: 'in', inputs: [{ seq: 5, swing: true, ax: 0, az: dir * 5 }] });
  const pts = await Promise.all(cs.map((c) => c.waitEvent('point', 15000)));
  assert.equal(pts[0].winner, serverSlot < 2 ? 0 : 1);
  assert.equal(pts[0].reason, 'bounce');
  for (const p of pts) assert.deepEqual(p.score, pts[0].score); // everyone sees the same score
  assert.deepEqual(pts[0].score.totalPoints.reduce((a, b) => a + b, 0), 1);
  assert.equal(pts[0].score.points[pts[0].winner], '15');

  // disconnect + reconnect with the same guest token keeps the seat
  const victim = cs[2];
  const token = victim.token;
  victim.close();
  await host.wait((m) => m.t === 'room' && m.slots[2]?.connected === false, 4000, { past: false });
  const back = await new Client('Cleo').connect(token);
  const restart = await back.wait((m) => m.t === 'start');
  assert.equal(restart.slot, 2);
  const roomBack = await back.wait((m) => m.t === 'room' && m.slots[2]?.connected === true);
  assert.equal(roomBack.youSlot, 2);
  cs[2] = back;

  // Force the match to the last point so we can test completion + persistence quickly.
  const room = [...srv.rooms.rooms.values()].find((r) => r.state === 'match');
  const g = room.game;
  g.match.games = [1, 0];
  g.match.points = [0, 3];
  g.match.pointsInGame = 3;
  // The next point is decided by the server's own physics: team 1 wins it with a game-winning ace.
  // Let the current point end, then serve again.
  const nextServe = await cs[0].waitEvent('serve', 15000, { past: false });
  const s2 = nextServe.slot;
  const winnerTeam = s2 < 2 ? 0 : 1;
  // make the team that is about to win the point be the one on 40 and a game up
  g.match.games = [winnerTeam === 0 ? 1 : 0, winnerTeam === 1 ? 1 : 0];
  g.match.points = [winnerTeam === 0 ? 3 : 0, winnerTeam === 1 ? 3 : 0];
  const dir2 = s2 < 2 ? 1 : -1;
  await new Promise((r) => setTimeout(r, 1200));
  cs[s2].send({ t: 'in', inputs: [{ seq: 9, swing: true, ax: 0, az: dir2 * 5 }] });
  const done = await Promise.all(cs.map((c) => c.waitEvent('match', 20000)));
  assert.equal(done[0].winner, winnerTeam);
  const results = await Promise.all(cs.map((c) => c.wait((m) => m.t === 'results', 12000)));
  for (const r of results) assert.deepEqual(r.results, results[0].results);
  assert.equal(results[0].results.winner, winnerTeam);
  assert.ok(results[0].results.duration > 0);

  // persistence: the server wrote the result from its own simulation
  srv.store.flush();
  const reloaded = new Store(dataDir);
  assert.ok(reloaded.data.matches.length >= 1);
  const last = reloaded.data.matches.at(-1);
  assert.equal(last.winner, winnerTeam);
  const prof = reloaded.data.profiles[cs[winnerTeam * 2].token];
  assert.equal(prof.wins, 1);
  assert.ok(prof.xp >= 100);

  // rematch without creating a new room
  cs.forEach((c) => c.send({ t: 'rematch' }));
  const second = await Promise.all(cs.map((c) => c.wait((m) => m.t === 'start' && m !== starts[0] && c.msgs.indexOf(m) > c.msgs.findIndex((x) => x.t === 'results'), 6000)));
  assert.equal(second.length, 4);
  cs.forEach((c) => c.close());
});

test('bots fill empty seats for practice, and a lone player can serve against them', async () => {
  const a = await new Client('Practice').connect();
  a.send({ t: 'create' });
  await a.wait((m) => m.t === 'room');
  a.send({ t: 'start' });
  const start = await a.wait((m) => m.t === 'start');
  assert.deepEqual(start.names, ['Practice', 'AI', 'AI', 'AI']);
  const room = await a.wait((m) => m.t === 'room' && m.state === 'match');
  assert.deepEqual(room.slots.map((s) => s.kind), ['human', 'bot', 'bot', 'bot']);
  await a.wait((m) => m.t === 'snap');
  a.close();
});
