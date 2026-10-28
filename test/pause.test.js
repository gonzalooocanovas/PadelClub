import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, PAUSE_MAX_MS, PAUSE_REQUEST_MS } from '../server/rooms.js';

const fakeWs = () => ({ readyState: 1, sent: [], send(m) { this.sent.push(JSON.parse(m)); }, last(t) { return [...this.sent].reverse().find((x) => x.t === t); } });

function room(humans = 2) {
  const r = new Room('TEST1', { recordMatch: () => ({}) });
  const ms = [];
  for (let i = 0; i < humans; i++) ms.push(r.addMember({ token: 't' + i, name: 'P' + i, ws: fakeWs(), look: null }));
  r.beginMatch();
  return { r, ms };
}

test('a pause needs the other player to accept, then freezes the match until both resume', () => {
  const { r, ms } = room(2);
  const [a, b] = ms;
  const t0 = Date.now();
  assert.equal(r.pauseCtl(a, 'req', t0), null);
  assert.equal(r.pause.phase, 'request', 'only a request so far');
  assert.equal(b.ws.last('pause').phase, 'request');
  const time = r.game.time;
  r.step(1 / 60);
  assert.ok(r.game.time > time, 'the match keeps running until the other player accepts');
  r.pauseCtl(b, 'accept', t0 + 1000);
  assert.equal(r.pause.phase, 'active');
  const frozen = r.game.time;
  for (let i = 0; i < 30; i++) r.step(1 / 60);
  assert.equal(r.game.time, frozen, 'frozen while paused');
  r.pauseCtl(a, 'resume', t0 + 2000);
  assert.equal(r.pause.phase, 'active', 'one player resuming is not enough');
  r.pauseCtl(b, 'resume', t0 + 3000);
  assert.equal(r.pause, null);
  assert.equal(a.ws.last('pause').phase, 'off');
  r.step(1 / 60);
  assert.ok(r.game.time > frozen, 'and the match goes on');
});

test('a pause ends by itself after 30 seconds, a request expires after 10, and a player can decline', () => {
  const { r, ms } = room(2);
  const [a, b] = ms;
  r.pauseCtl(a, 'req', 0);
  r.pauseEvaluate(PAUSE_REQUEST_MS + 1);
  assert.equal(r.pause, null, 'unanswered request expired');
  r.pauseCtl(a, 'req', 20_000);
  r.pauseCtl(b, 'deny', 21_000);
  assert.equal(r.pause, null);
  assert.equal(a.ws.last('pause').phase, 'denied');
  r.pauseCtl(a, 'req', 30_000); r.pauseCtl(b, 'accept', 30_500);
  assert.equal(r.pause.phase, 'active');
  r.pauseEvaluate(30_500 + PAUSE_MAX_MS + 1);
  assert.equal(r.pause, null, 'never longer than 30 s');
});

test('limits: two pauses per player, a lone human pauses at once, and bots do not need to accept', () => {
  const { r, ms } = room(2);
  const [a, b] = ms;
  for (let i = 0; i < 2; i++) { r.pauseCtl(a, 'req', i * 100_000); r.pauseCtl(b, 'accept', i * 100_000 + 1); r.pauseCtl(a, 'resume', i * 100_000 + 2); r.pauseCtl(b, 'resume', i * 100_000 + 3); }
  assert.match(r.pauseCtl(a, 'req', 500_000), /used your pauses/);
  const solo = room(1);
  assert.equal(solo.r.pauseCtl(solo.ms[0], 'req', 0), null);
  assert.equal(solo.r.pause.phase, 'active', 'with only bots around nobody has to accept');
});

test('a player who disconnects does not block the pause', () => {
  const { r, ms } = room(2);
  const [a, b] = ms;
  r.pauseCtl(a, 'req', 0); r.pauseCtl(b, 'accept', 1);
  r.disconnect(b);
  r.pauseCtl(a, 'resume', 2);
  assert.equal(r.pause, null, 'the remaining connected human is enough');
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.js';

test('over real WebSockets: request, accept, frozen snapshots, resume', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'padel-pause-'));
  const srv = await createGameServer({ port: 0, dataDir: dir, host: '127.0.0.1' });
  const open = async (name) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once('open', r));
    const send = (o) => ws.send(JSON.stringify(o));
    send({ t: 'hello', name });
    const until = async (pred, ms = 6000) => { const t0 = Date.now(); for (;;) { const m = msgs.find(pred); if (m) return m; if (Date.now() - t0 > ms) throw new Error(name + ': timeout'); await new Promise((r) => setTimeout(r, 20)); } };
    await until((m) => m.t === 'welcome');
    return { ws, msgs, send, until };
  };
  try {
    const a = await open('A'), b = await open('B');
    a.send({ t: 'create', name: 'A' });
    const code = (await a.until((m) => m.t === 'room')).code;
    b.send({ t: 'join', code, name: 'B' });
    await b.until((m) => m.t === 'room');
    b.send({ t: 'ready', ready: true });
    await new Promise((r) => setTimeout(r, 100));
    a.send({ t: 'start' });
    await a.until((m) => m.t === 'start'); await b.until((m) => m.t === 'start');
    a.send({ t: 'pauseReq' });
    const req = await b.until((m) => m.t === 'pause' && m.phase === 'request');
    assert.equal(req.by, 'A');
    b.send({ t: 'pauseAccept' });
    await a.until((m) => m.t === 'pause' && m.phase === 'active');
    await new Promise((r) => setTimeout(r, 150));
    const n0 = a.msgs.filter((m) => m.t === 'snap').length;
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(a.msgs.filter((m) => m.t === 'snap').length, n0, 'no snapshots while paused');
    a.send({ t: 'pauseResume' });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(a.msgs.filter((m) => m.t === 'pause' && m.phase === 'off').length, 0, 'one Resume is not enough');
    b.send({ t: 'pauseResume' });
    await a.until((m) => m.t === 'pause' && m.phase === 'off');
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(a.msgs.filter((m) => m.t === 'snap').length > n0, 'the match runs again');
    a.ws.close(); b.ws.close();
  } finally { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

import { PadelGame } from '../shared/game.js';

test('the server stays planted on the line until the serve is hit', () => {
  const g = new PadelGame({ rng: () => 0.5 });
  const s = g.players[g.serverSlot];
  const { x, z } = s;
  for (let i = 0; i < 90; i++) { g.applyInput(g.serverSlot, { mx: 1, mz: 1, sprint: true }); g.tick(1 / 60); }
  assert.equal(g.phase, 'serve');
  assert.equal(s.x, x); assert.equal(s.z, z);
});

test('after a fault everybody goes back to their starting place for the second serve', () => {
  const g = new PadelGame({ rng: () => 0.5 });
  const start = g.players.map((p) => [p.x, p.z]);
  g.phase = 'rally';
  g.rally = { serving: true, faults: 0, lastTeam: g.players[g.serverSlot].team, lastSlot: g.serverSlot, bounces: 0, hits: 1, netTouched: false, serveXSign: 1 };
  for (const [i, p] of g.players.entries()) { p.x += 1.5; p.z += (i % 2 ? 1 : -1) * 0.8; p.vx = 3; } // the receivers moved after the serve
  g.fault('long-or-wide');
  assert.equal(g.phase, 'serve');
  g.players.forEach((p, i) => { assert.deepEqual([p.x, p.z], start[i]); assert.equal(p.vx, 0); });
});
