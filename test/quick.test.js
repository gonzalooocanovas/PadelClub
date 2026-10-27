import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.js';
import { QuickQueue, WAIT_MS } from '../server/quick.js';
import { RoomManager } from '../server/rooms.js';
import { Store } from '../server/store.js';

let srv, dataDir;
before(async () => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'padel-quick-')); srv = await createGameServer({ port: 0, dataDir, host: '127.0.0.1' }); });
after(async () => { await srv.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const open = async (name) => {
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
  const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.once('open', r));
  ws.send(JSON.stringify({ t: 'hello', name }));
  const until = async (pred, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = msgs.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 25)); } throw new Error(`${name}: timeout`); };
  await until((m) => m.t === 'welcome');
  return { ws, msgs, until, send: (o) => ws.send(JSON.stringify(o)) };
};

test('four players who press Quick match are put in the same doubles match, and the server reports how many are online', async () => {
  const c = await Promise.all(['a', 'b', 'c', 'd'].map(open));
  assert.ok(c[0].msgs.find((m) => m.t === 'welcome').online >= 1, 'the welcome says how many are online');
  for (const x of c) x.send({ t: 'quick', name: 'p' });
  const starts = await Promise.all(c.map((x) => x.until((m) => m.t === 'start')));
  assert.equal(new Set(starts.map((s) => s.slot)).size, 4, 'four different seats');
  assert.equal(starts[0].settings.mode, 'doubles');
  const online = await c[0].until((m) => (m.t === 'online' || m.t === 'queue') && m.online !== undefined || m.t === 'online');
  assert.ok((online.n ?? online.online) >= 4);
  for (const x of c) x.ws.close();
});

test('the queue reports its size, can be cancelled, and nobody waits forever (bots fill in after the wait)', async () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'padel-q2-')));
  const rooms = new RoomManager(store);
  let t = 1000;
  const q = new QuickQueue(rooms, () => t);
  const fakeWs = () => ({ readyState: 1, sent: [], send(m) { this.sent.push(JSON.parse(m)); } });
  const mk = (n) => ({ token: store.newToken(), name: n, ws: fakeWs(), look: null });
  const a = mk('a'), b = mk('b');
  q.add(a); q.add(b);
  assert.equal(q.size(), 2);
  assert.equal(q.status(a.token).waiting, 2);
  assert.deepEqual(q.tick(), [], 'two players are not enough yet');
  q.remove(b.token);
  assert.equal(q.size(), 1);
  t += WAIT_MS + 1;
  const made = q.tick();
  assert.equal(made.length, 1, 'after the wait the lone player gets a match');
  const room = made[0];
  assert.equal(room.state, 'match');
  assert.equal(room.slots.filter((s) => s?.kind === 'bot').length, 3, 'bots fill the other seats');
  assert.equal(q.size(), 0);
});
