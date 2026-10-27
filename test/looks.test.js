import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ARCHETYPES, RACKETS, COURTS, COURT_IDS, DEFAULT_LOOKS, sanitizeLook } from '../shared/looks.js';
import { Store } from '../server/store.js';
import { RoomManager } from '../server/rooms.js';
import { stepBall, makeBall } from '../shared/physics.js';
import { PadelGame } from '../shared/game.js';

test('catalogue: four distinct archetypes, eight distinct rackets, three courts', () => {
  assert.equal(ARCHETYPES.length, 4);
  assert.equal(new Set(ARCHETYPES.map((a) => a.height)).size, 4, 'different heights');
  assert.equal(RACKETS.length, 8);
  assert.equal(new Set(RACKETS.map((r) => r.name)).size, 8);
  assert.equal(new Set(RACKETS.map((r) => `${r.face}-${r.shape}-${r.holes}`)).size, 8, 'distinct designs');
  assert.deepEqual(COURT_IDS.sort(), ['indoor', 'night', 'outdoor']);
});

test('looks from clients are always clamped to valid ids', () => {
  assert.deepEqual(sanitizeLook(null, 2), DEFAULT_LOOKS[2]);
  assert.deepEqual(sanitizeLook({ arch: 99, hair: -3, skin: 'x', racket: 1e9 }, 1), DEFAULT_LOOKS[1]);
  assert.deepEqual(sanitizeLook({ arch: 3, hair: 4, skin: 2, racket: 7 }, 0), { arch: 3, hair: 4, skin: 2, racket: 7 });
});

test('court surface is a small, documented difference: outdoor turf is slightly slower', () => {
  const bounce = (court) => {
    const g = new PadelGame({ settings: { court } });
    const b = { ...makeBall(), x: 0, y: 1.5, z: 2, vz: 8, vy: -2, fe: g.ball.fe, ff: g.ball.ff };
    const ev = [];
    let peak = 0, first = false, vz = 0;
    for (let i = 0; i < 90; i++) { ev.length = 0; stepBall(b, 1 / 60, ev); if (!first && ev.some((e) => e.type === 'floor')) { first = true; vz = b.vz; } if (first) peak = Math.max(peak, b.y); }
    return { peak, vz };
  };
  const indoor = bounce('indoor'), outdoor = bounce('outdoor');
  assert.ok(outdoor.vz < indoor.vz && outdoor.peak < indoor.peak);
  assert.ok(indoor.vz / outdoor.vz < 1.05, 'but only by a few percent');
});

test('server keeps looks and court consistent for everybody in the room', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'padel-looks-'));
  const mgr = new RoomManager(new Store(dir));
  const sent = [];
  const fakeWs = { readyState: 1, send: (d) => sent.push(JSON.parse(d)) };
  const a = mgr.create({ token: 'a', name: 'Ana', ws: fakeWs, look: { arch: 2, hair: 5, skin: 1, racket: 6 } });
  const b = mgr.join(a.room.code, { token: 'b', name: 'Ben', ws: fakeWs, look: { arch: 99 } });
  assert.deepEqual(a.member.look, { arch: 2, hair: 5, skin: 1, racket: 6 });
  assert.deepEqual(b.member.look, DEFAULT_LOOKS[0], 'garbage falls back to a valid look');
  assert.equal(a.room.setSettings(a.member, { court: 'night' }), null);
  assert.equal(a.room.setSettings(a.member, { court: 'moon' }), null);
  assert.equal(a.room.settings.court, 'night', 'unknown courts are ignored');
  b.member.ready = true;
  assert.equal(a.room.start(a.member), null);
  const start = sent.filter((m) => m.t === 'start');
  assert.equal(start.length, 2);
  for (const s of start) { assert.equal(s.settings.court, 'night'); assert.equal(s.looks.length, 4); assert.equal(s.looks[0].racket, 6); }
  fs.rmSync(dir, { recursive: true, force: true });
});
