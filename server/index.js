// HTTP static server + WebSocket game server.

import { QuickQueue } from './quick.js';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Store } from './store.js';
import { RoomManager } from './rooms.js';
import { SERVER_TICK } from '../shared/constants.js';
import { CAREER } from '../shared/career.js';
import { sanitizeLook } from '../shared/looks.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.glb': 'model/gltf-binary',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
};
const STATIC = [
  ['/vendor/three/', path.join(ROOT, 'node_modules', 'three')],
  ['/shared/', path.join(ROOT, 'shared')],
  ['/', path.join(ROOT, 'client')],
];

function serveStatic(req, res) {
  let pathname;
  try {
    // never trust the request target: a path like "//" must not be parsed as a URL authority
    pathname = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '/'));
  } catch {
    res.writeHead(400); res.end('Bad request'); return;
  }
  if (pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  for (const [prefix, dir] of STATIC) {
    if (!pathname.startsWith(prefix)) continue;
    const file = path.resolve(dir, pathname.slice(prefix.length));
    if (!file.startsWith(dir + path.sep) && file !== dir) break; // path traversal guard
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) continue;
      const type = MIME[path.extname(file)] || 'application/octet-stream';
      const gz = (req.headers['accept-encoding'] || '').includes('gzip') && (type.startsWith('text/') || type.startsWith('application/json') || type.startsWith('application/javascript'));
      // vendored libraries never change between deploys: let browsers cache them
      const cache = prefix === '/vendor/three/' ? 'public, max-age=86400' : 'no-cache';
      res.writeHead(200, { 'content-type': type, 'cache-control': cache, ...(gz ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}) });
      const stream = fs.createReadStream(file);
      stream.on('error', () => res.destroy());
      if (gz) stream.pipe(zlib.createGzip({ level: 6 })).pipe(res); else stream.pipe(res);
      return;
    } catch { /* try next mapping */ }
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
}

export function createGameServer({ port = 0, dataDir = process.env.DATA_DIR || path.join(ROOT, 'data'), host } = {}) {
  const store = new Store(dataDir);
  const rooms = new RoomManager(store);
  const quick = new QuickQueue(rooms);
  const onlineCount = () => { let n = 0; for (const ws of wss.clients) if (ws.readyState === 1 && ws.ctx?.token) n++; return n; };
  const server = http.createServer((req, res) => {
    try { serveStatic(req, res); } catch (err) {
      console.error('[http]', err.message);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  wss.on('connection', (ws) => {
    ws.ctx = { token: null, name: 'Guest', bucket: 200, bucketAt: Date.now() };
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', (data) => onMessage(ws, data));
    ws.on('close', () => onClose(ws));
    ws.on('error', () => {});
  });

  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const fail = (ws, message, code = 'error') => send(ws, { t: 'error', code, message });

  function onClose(ws) {
    const { token } = ws.ctx;
    if (!token) return;
    quick.remove(token);
    const ms = rooms.membership(token);
    if (ms && ms.member.ws === ws) ms.room.disconnect(ms.member);
  }

  function onMessage(ws, data) {
    // rate limit: token bucket, ~300 msgs/s sustained
    const c = ws.ctx;
    const now = Date.now();
    c.bucket = Math.min(300, c.bucket + ((now - c.bucketAt) / 1000) * 300);
    c.bucketAt = now;
    if (--c.bucket < 0) { ws.close(1008, 'rate limit'); return; }

    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'hello') {
      let token = typeof msg.token === 'string' && store.hasProfile(msg.token) ? msg.token : store.newToken();
      const prof = store.profile(token, String(msg.name || '').slice(0, 16) || undefined);
      c.token = token;
      c.name = prof.name;
      c.look = msg.look ? sanitizeLook(msg.look) : null;
      send(ws, { t: 'welcome', token, name: prof.name, profile: store.publicProfile(token), online: onlineCount() });
      const ms = rooms.membership(token);
      if (ms) {
        // reconnect: rebind the new socket to the old seat
        if (ms.member.ws && ms.member.ws !== ws) { const old = ms.member.ws; ms.member.ws = null; old.close(4000, 'replaced'); }
        ms.member.name = prof.name;
        ms.room.reconnect(ms.member, ws);
      }
      return;
    }
    if (!c.token) return fail(ws, 'Say hello first', 'no-session');

    if (msg.t === 'ping') {
      send(ws, { t: 'pong', ts: msg.ts });
      const ms = rooms.membership(c.token);
      if (ms && Number.isFinite(msg.rtt)) ms.member.rtt = Math.min(2000, Math.max(0, Math.round(msg.rtt)));
      return;
    }
    if (msg.t === 'profile') return send(ws, { t: 'profile', profile: store.publicProfile(c.token) });
    if (msg.t === 'rename') {
      const p = store.profile(c.token, String(msg.name || '').slice(0, 16));
      c.name = p.name;
      return send(ws, { t: 'profile', profile: store.publicProfile(c.token) });
    }

    if (msg.t === 'look') {
      c.look = sanitizeLook(msg.look);
      const lm = rooms.membership(c.token);
      if (lm) { lm.member.look = c.look; lm.room.broadcastRoom(); }
      return;
    }
    if (msg.t === 'quick') {
      quick.add({ token: c.token, name: msg.name || c.name, ws, look: c.look });
      return send(ws, { t: 'queue', ...quick.status(c.token), online: onlineCount() });
    }
    if (msg.t === 'quickCancel') { quick.remove(c.token); return send(ws, { t: 'queue', cancelled: true, online: onlineCount() }); }
    if (msg.t === 'rooms') return send(ws, { t: 'rooms', rooms: rooms.listPublic() });
    if (msg.t === 'career') return send(ws, { t: 'career', career: store.careerView(c.token) });
    if (msg.t === 'careerStart') {
      const stage = CAREER.find((s) => s.id === Number(msg.stage));
      const view = store.careerView(c.token);
      if (!stage || !view.stages.find((s) => s.id === stage.id)?.unlocked) return fail(ws, 'That stage is locked', 'rejected');
      if (rooms.membership(c.token)) rooms.leave(c.token);
      const { room, member } = rooms.create({ token: c.token, name: msg.name || c.name, ws, look: c.look });
      member.name = String(msg.name || c.name).slice(0, 16) || 'Guest';
      room.setupCareer(stage, member);
      return;
    }

    if (msg.t === 'create') {
      if (rooms.membership(c.token)) rooms.leave(c.token);
      const { room, member } = rooms.create({ token: c.token, name: msg.name || c.name, ws, look: c.look });
      member.name = String(msg.name || c.name).slice(0, 16) || 'Guest';
      room.broadcastRoom();
      return;
    }
    if (msg.t === 'join') {
      const cur = rooms.membership(c.token);
      if (cur && cur.room.code === String(msg.code || '').toUpperCase().trim()) { cur.room.reconnect(cur.member, ws); return; }
      if (cur) rooms.leave(c.token);
      const r = rooms.join(msg.code, { token: c.token, name: msg.name || c.name, ws, look: c.look });
      if (r.error) return fail(ws, r.error, 'join-failed');
      r.room.broadcastRoom();
      return;
    }

    const ms = rooms.membership(c.token);
    if (!ms) return fail(ws, 'You are not in a room', 'no-room');
    const { room, member } = ms;
    let err = null;
    switch (msg.t) {
      case 'leave': rooms.leave(c.token); send(ws, { t: 'left' }); return;
      case 'in': room.pushInputs(member, msg.inputs); return;
      case 'sit': err = room.sit(member, msg.slot); break;
      case 'assign': err = room.assign(member, msg.id, msg.slot); break;
      case 'ready':
        if (room.state === 'lobby') member.ready = !!msg.ready;
        break;
      case 'settings': err = room.setSettings(member, msg.settings || {}); break;
      case 'start': err = room.start(member); break;
      case 'rematch': err = room.rematch(member); return err ? fail(ws, err) : undefined;
      case 'lobby': err = room.toLobby(member); break;
      case 'pauseReq': case 'pauseAccept': case 'pauseDeny': case 'pauseResume':
        err = room.pauseCtl(member, msg.t.slice(5).toLowerCase()); if (err) return fail(ws, err, 'pause'); return;
      case 'chat': room.chat(member, msg.text); return;
      case 'emote': room.emote(member, msg.id); return;
      default: return; // unknown messages (including any attempt to submit scores) are ignored
    }
    if (err) fail(ws, err, 'rejected');
    room.broadcastRoom();
  }

  // fixed-step simulation loop shared by all rooms
  const STEP = 1 / SERVER_TICK;
  let last = performance.now();
  let acc = 0;
  // Measured, not assumed: how long each 60 Hz simulation tick takes, how often the loop falls behind, and the event-loop delay.
  const metrics = { tick: new Float64Array(36000), n: 0, over: 0, dropped: 0, started: performance.now(), loopDelay: monitorEventLoopDelay({ resolution: 5 }) };
  metrics.loopDelay.enable();
  metrics.reset = () => { metrics.n = 0; metrics.over = 0; metrics.dropped = 0; metrics.started = performance.now(); metrics.loopDelay.reset(); };
  metrics.summary = () => {
    const a = Array.from(metrics.tick.subarray(0, Math.min(metrics.n, metrics.tick.length))).sort((x, y) => x - y);
    const q = (p) => (a.length ? a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)] : NaN);
    return { ticks: metrics.n, p50: q(50), p95: q(95), p99: q(99), max: a.at(-1) ?? NaN, overBudget: metrics.over, droppedMs: metrics.dropped, eventLoopMs: { p50: metrics.loopDelay.percentile(50) / 1e6, p99: metrics.loopDelay.percentile(99) / 1e6, max: metrics.loopDelay.max / 1e6 } };
  };
  const loop = setInterval(() => {
    const now = performance.now();
    const elapsed = (now - last) / 1000;
    acc += Math.min(0.25, elapsed);
    if (elapsed > 0.25) metrics.dropped += (elapsed - 0.25) * 1000; // the loop stalled longer than the catch-up cap: simulated time was lost
    last = now;
    while (acc >= STEP) {
      const t0 = performance.now();
      rooms.step(STEP);
      const d = performance.now() - t0;
      metrics.tick[metrics.n % metrics.tick.length] = d; metrics.n++;
      if (d > 1000 / SERVER_TICK) metrics.over++;
      acc -= STEP;
    }
  }, 8);
  const sweeper = setInterval(() => rooms.sweep(), 30_000);
  // matchmaking and the live player count
  const matchmaker = setInterval(() => {
    quick.tick();
    const online = onlineCount();
    for (const ws of wss.clients) {
      if (ws.readyState !== 1 || !ws.ctx?.token) continue;
      const st = quick.status(ws.ctx.token);
      send(ws, st ? { t: 'queue', ...st, online } : { t: 'online', n: online });
    }
  }, 1000);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, 15_000);

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolve({
        port: actual, rooms, store, server, wss, metrics,
        async close() {
          clearInterval(loop); clearInterval(sweeper); clearInterval(matchmaker); clearInterval(heartbeat); metrics.loopDelay.disable();
          for (const ws of wss.clients) ws.terminate();
          store.flush();
          await new Promise((r) => wss.close(() => server.close(() => r())));
        },
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const s = await createGameServer({ port });
  console.log(`PADEL CLUB server listening on http://localhost:${s.port}`);
  // a public server must survive stray errors from any single connection
  process.on('uncaughtException', (err) => console.error('[uncaught]', err));
  process.on('unhandledRejection', (err) => console.error('[unhandled]', err));
  const stop = () => { s.close().then(() => process.exit(0)); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
