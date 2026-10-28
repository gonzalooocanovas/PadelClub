// Server benchmarks. Run: npm run bench:server -- --scenario <name> [options]
//   --scenario ramp       N simultaneous rooms of bots (pure 60 Hz simulation + snapshot serialisation, no sockets), ramping N until a tick budget is missed
//   --scenario rooms      K rooms with 4 real WebSocket clients each, end to end (inputs at 60 Hz, snapshots received)   --rooms K --seconds S
//   --scenario sustained  one 4-client room for --seconds S (default 600), samples memory and tick time every 10 s, drops and reconnects a client every 30 s
//   --scenario abuse      malformed / oversized / flooding inputs against a running match
// Output is printed and saved to docs/bench-server-<scenario>.txt. "Tick" = one 1/60 s simulation step of ALL rooms plus the snapshot broadcast.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.js';
import { Room } from '../server/rooms.js';
import { Store } from '../server/store.js';
import { SERVER_TICK } from '../shared/constants.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const scenario = arg('scenario', 'ramp');
const lines = [];
const out = (s = '') => { lines.push(s); console.log(s); };
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const header = () => out(`PADEL CLUB server benchmark: ${scenario}   node ${process.version}   ${os.cpus()[0].model} x${os.cpus().length}   ${Math.round(os.totalmem() / 1e9)} GB   ${os.platform()} ${os.release()}   ${new Date().toISOString()}`);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : NaN; };
const mb = (b) => (b / 1048576).toFixed(1);
const budget = 1000 / SERVER_TICK;

const fakeWs = () => ({ readyState: 1, bytes: 0, send(m) { this.bytes += m.length; } });

async function ramp() {
  header();
  out(`Pure simulation: every room has 4 bots, all seats filled; each tick steps every room and serialises + broadcasts one snapshot per room (to a fake socket that only counts bytes). Budget per tick: ${f(budget)} ms (60 Hz). 600 ticks (10 s of game time) per step of the ramp, after a 120-tick warm-up.`);
  out('');
  out('rooms |  tick p50 ms |  p95 ms |  p99 ms |  max ms | over-budget ticks | snapshot bytes/room/tick | heap MB');
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'padel-bench-')));
  let firstFail = null;
  for (const N of [1, 2, 4, 8, 16, 32, 48, 64, 96, 128, 192, 256, 320, 384, 512]) {
    const rooms = [];
    for (let i = 0; i < N; i++) {
      const r = new Room('B' + i, store);
      r.settings.mode = 'doubles';
      const ws = fakeWs();
      const m = r.addMember({ token: 't' + i, name: 'H' + i, ws, look: null });
      m.connected = false; // a bot covers the human seat: all four seats are bots, but the room still broadcasts to a counting socket
      r.beginMatch();
      m.connected = false; m.ws = ws; // the seat is driven by the bot AI, the counting socket still receives every snapshot
      rooms.push({ r, ws });
    }
    for (let t = 0; t < 120; t++) for (const { r } of rooms) r.step(1 / 60);
    const times = []; let over = 0;
    for (let t = 0; t < 600; t++) {
      const t0 = performance.now();
      for (const { r } of rooms) { r.step(1 / 60); }
      const d = performance.now() - t0; times.push(d); if (d > budget) over++;
    }
    const snap = JSON.stringify(rooms[0].r.game.snapshot()).length;
    out(`${String(N).padStart(5)} | ${f(pct(times, 50)).padStart(11)} | ${f(pct(times, 95)).padStart(7)} | ${f(pct(times, 99)).padStart(7)} | ${f(Math.max(...times)).padStart(7)} | ${String(over).padStart(17)} | ${String(snap).padStart(24)} | ${mb(process.memoryUsage().heapUsed).padStart(7)}`);
    if (!firstFail && pct(times, 95) > budget) { firstFail = N; break; }
  }
  out('');
  out(firstFail ? `The simulation no longer holds the p95 < ${f(budget)} ms target at ${firstFail} simultaneous rooms on this machine (one Node thread; room.step includes the snapshot broadcast to a counting socket).` : 'The p95 tick stayed under budget for every size tested (extend the ramp to find the limit).');
  out('Not measured: the cost of real network sockets, TLS, other machines. Production capacity on Render is NOT established by this number.');
}

async function openClient(url, name) {
  const ws = new WebSocket(url);
  const c = { ws, name, snaps: 0, bytes: 0, room: null, token: null, send: (o) => ws.send(JSON.stringify(o)) };
  ws.on('message', (d) => { c.bytes += d.length; const m = JSON.parse(d.toString()); if (m.t === 'snap') c.snaps++; if (m.t === 'room') c.room = m; if (m.t === 'welcome') c.token = m.token; });
  await new Promise((r) => ws.once('open', r));
  c.send({ t: 'hello', name });
  for (let i = 0; i < 100 && !c.token; i++) await new Promise((r) => setTimeout(r, 20));
  return c;
}

async function startRoom(url, base) {
  const host = await openClient(url, base + '0');
  host.send({ t: 'create', name: base + '0' });
  for (let i = 0; i < 100 && !host.room; i++) await new Promise((r) => setTimeout(r, 20));
  const code = host.room.code;
  const others = [];
  for (let k = 1; k < 4; k++) { const c = await openClient(url, base + k); c.send({ t: 'join', code, name: base + k }); others.push(c); }
  await new Promise((r) => setTimeout(r, 200));
  for (const c of others) c.send({ t: 'ready', ready: true });
  await new Promise((r) => setTimeout(r, 200));
  host.send({ t: 'start' });
  return [host, ...others];
}

function drive(clients, abuse = false) {
  let seq = 0;
  const timer = setInterval(() => {
    seq++;
    for (const c of clients) {
      if (c.ws.readyState !== 1) continue;
      c.send({ t: 'in', inputs: [{ seq, mx: Math.sin(seq / 40 + c.name.length), mz: Math.cos(seq / 55), sprint: seq % 90 < 30, swing: seq % 70 === 0, ax: 1, az: 6 }] });
      if (abuse && seq % 5 === 0) {
        c.ws.send('{not json');
        c.ws.send(JSON.stringify({ t: 'in', inputs: 'nope' }));
        c.ws.send(JSON.stringify({ t: 'in', inputs: [{ seq: 'x', mx: 1e99, mz: NaN, ax: 'a' }] }));
        c.ws.send(JSON.stringify({ t: 'in', inputs: Array.from({ length: 200 }, (_, i) => ({ seq: i, mx: 1 })) }));
      }
    }
  }, 1000 / 60);
  return () => clearInterval(timer);
}

async function rooms() {
  header();
  const K = +arg('rooms', 4), S = +arg('seconds', 30);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'padel-bench-'));
  const srv = await createGameServer({ port: 0, dataDir: dir, host: '127.0.0.1' });
  const url = `ws://127.0.0.1:${srv.port}/ws`;
  const all = [];
  for (let i = 0; i < K; i++) all.push(...(await startRoom(url, 'R' + i + 'p')));
  await new Promise((r) => setTimeout(r, 1500));
  srv.metrics.reset();
  const stop = drive(all);
  const h0 = process.memoryUsage().heapUsed;
  await new Promise((r) => setTimeout(r, S * 1000));
  stop();
  const m = srv.metrics.summary();
  const snaps = all.reduce((a, c) => a + c.snaps, 0), bytes = all.reduce((a, c) => a + c.bytes, 0);
  out(`${K} room(s) x 4 real WebSocket clients (client and server share this machine and this CPU), ${S} s, inputs at 60 Hz per client.`);
  out(`server tick (all rooms + broadcast): p50 ${f(m.p50)} ms  p95 ${f(m.p95)} ms  p99 ${f(m.p99)} ms  max ${f(m.max)} ms   over ${f(budget)} ms budget: ${m.overBudget} of ${m.ticks} ticks   dropped time ${f(m.droppedMs, 0)} ms`);
  out(`event-loop delay: p50 ${f(m.eventLoopMs.p50)} ms  p99 ${f(m.eventLoopMs.p99)} ms  max ${f(m.eventLoopMs.max)} ms`);
  out(`snapshots received ${snaps} (${f(snaps / (S * all.length), 1)} per client per second), ${mb(bytes)} MB total = ${f(bytes / 1024 / S / all.length, 1)} KB/s per client`);
  out(`heap ${mb(h0)} -> ${mb(process.memoryUsage().heapUsed)} MB`);
  out(m.p95 < budget ? `PASS: p95 tick under ${f(budget)} ms.` : `FAIL: p95 tick above ${f(budget)} ms.`);
  all.forEach((c) => c.ws.close());
  await srv.close();
}

async function sustained() {
  header();
  const S = +arg('seconds', 600);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'padel-bench-'));
  const srv = await createGameServer({ port: 0, dataDir: dir, host: '127.0.0.1' });
  const url = `ws://127.0.0.1:${srv.port}/ws`;
  const clients = await startRoom(url, 'S');
  await new Promise((r) => setTimeout(r, 1500));
  srv.metrics.reset();
  const stop = drive(clients);
  const errors = [];
  process.on('uncaughtException', (e) => errors.push(String(e)));
  out(`Sustained run: one 4-client room for ${S} s; every 30 s one client is dropped and reconnected (same token) mid-match. Memory sampled every 10 s.`);
  out('t(s) | heap MB | rss MB | tick p95 ms | tick max ms | over budget | dropped ms | reconnects');
  let reconnects = 0;
  const t0 = Date.now();
  const heaps = [];
  for (let t = 10; t <= S; t += 10) {
    await new Promise((r) => setTimeout(r, 10000));
    if (t % 30 === 0) {
      const c = clients[2]; const token = c.token; c.ws.terminate();
      await new Promise((r) => setTimeout(r, 200));
      const n = new WebSocket(url);
      const nc = { ws: n, name: c.name, snaps: 0, bytes: 0, token, send: (o) => n.send(JSON.stringify(o)) };
      n.on('message', (d) => { nc.bytes += d.length; });
      await new Promise((r) => n.once('open', r));
      nc.send({ t: 'hello', name: c.name, token });
      clients[2] = nc; reconnects++;
    }
    if (global.gc) global.gc(); // run with --expose-gc to see live memory instead of garbage-collector noise
    const m = srv.metrics.summary(); const mu = process.memoryUsage();
    heaps.push(mu.heapUsed);
    out(`${String(t).padStart(4)} | ${mb(mu.heapUsed).padStart(7)} | ${mb(mu.rss).padStart(6)} | ${f(m.p95).padStart(11)} | ${f(m.max).padStart(11)} | ${String(m.overBudget).padStart(11)} | ${f(m.droppedMs, 0).padStart(10)} | ${reconnects}`);
  }
  stop();
  const m = srv.metrics.summary();
  const from = Math.floor(heaps.length / 4);
  const slope = (heaps.at(-1) - heaps[from]) / ((heaps.length - 1 - from) * 10) / 1024;
  out('');
  out(`Whole run: ${m.ticks} ticks, p50 ${f(m.p50)} ms, p95 ${f(m.p95)} ms, p99 ${f(m.p99)} ms, max ${f(m.max)} ms; over budget ${m.overBudget}; dropped ${f(m.droppedMs, 0)} ms; event-loop p99 ${f(m.eventLoopMs.p99)} ms.`);
  out(`Heap change over the last 3/4 of the run: ${f(slope, 1)} KB/s (garbage-collector noise included). Uncaught errors: ${errors.length}. Elapsed ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
  clients.forEach((c) => c.ws.close());
  await srv.close();
}

async function abuse() {
  header();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'padel-bench-'));
  const srv = await createGameServer({ port: 0, dataDir: dir, host: '127.0.0.1' });
  const url = `ws://127.0.0.1:${srv.port}/ws`;
  const clients = await startRoom(url, 'A');
  await new Promise((r) => setTimeout(r, 1000));
  srv.metrics.reset();
  const errors = [];
  process.on('uncaughtException', (e) => errors.push(String(e)));
  const stop = drive(clients, true);
  await new Promise((r) => setTimeout(r, +arg('seconds', 20) * 1000));
  stop();
  const m = srv.metrics.summary();
  out('4 clients sending valid inputs at 60 Hz plus, every 5 inputs: invalid JSON, wrong types, NaN/1e99 values and 200-input floods.');
  out(`server tick p95 ${f(m.p95)} ms, p99 ${f(m.p99)} ms, max ${f(m.max)} ms, over budget ${m.overBudget}/${m.ticks}; uncaught errors ${errors.length}; clients still connected: ${clients.filter((c) => c.ws.readyState === 1).length}/4 (the rate limiter may disconnect flooders: that is correct).`);
  out(errors.length ? 'FAIL: the server threw.' : 'PASS: the server survived malformed and flooding input.');
  clients.forEach((c) => c.ws.close());
  await srv.close();
}

await ({ ramp, rooms, sustained, abuse }[scenario] || ramp)();
fs.mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL(`../docs/bench-server-${scenario}.txt`, import.meta.url), lines.join('\n') + '\n');
process.exit(0);
