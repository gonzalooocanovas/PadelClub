import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.js';
import { Room, RoomManager } from '../server/rooms.js';
import { CAREER, starsFor } from '../shared/career.js';
import { BOT_LEVELS } from '../shared/ai.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'padel-career-'));

test('career ladder: only stage 1 is open, beating a stage unlocks the next, stars only pay when improved', () => {
  const dir = tmp();
  const store = new Store(dir);
  const v0 = store.careerView('tok');
  assert.deepEqual(v0.stages.map((s) => s.unlocked), [true, ...CAREER.slice(1).map(() => false)]);
  const lost = store.careerComplete('tok', 1, 0);
  assert.equal(lost.unlocked, null);
  const win = store.careerComplete('tok', 1, 2);
  assert.equal(win.unlocked, 2);
  assert.equal(win.bonusXp, CAREER[0].xp * 2);
  const again = store.careerComplete('tok', 1, 2);
  assert.equal(again.bonusXp, 0, 'no bonus for repeating the same result');
  const better = store.careerComplete('tok', 1, 3);
  assert.equal(better.bonusXp, CAREER[0].xp);
  assert.equal(better.unlocked, null, 'already unlocked');
  const v1 = store.careerView('tok');
  assert.equal(v1.stages[1].unlocked, true);
  assert.equal(v1.stages[2].unlocked, false);
  assert.equal(v1.stars, 3);
  store.flush();
  assert.equal(new Store(dir).careerView('tok').stars, 3, 'progress persists');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stars depend on how many games you concede', () => {
  const r = (sets, winner = 0) => ({ winner, score: { sets } });
  assert.equal(starsFor(r([[6, 0]])), 3);
  assert.equal(starsFor(r([[6, 3]])), 2);
  assert.equal(starsFor(r([[6, 5]])), 1);
  assert.equal(starsFor(r([[6, 0]], 1)), 0);
});

test('every career stage uses a valid bot level and enough names for its mode', () => {
  for (const s of CAREER) {
    assert.ok(BOT_LEVELS.includes(s.difficulty));
    assert.equal(s.opponents.length, s.mode === 'doubles' ? 2 : 1);
    if (s.mode === 'doubles') { assert.ok(s.partner); assert.ok(BOT_LEVELS.includes(s.partnerDiff)); }
  }
  assert.ok(CAREER.map((s) => BOT_LEVELS.indexOf(s.difficulty)).every((v, i, a) => i === 0 || v >= a[i - 1]), 'difficulty never goes down');
});

test('career room: human plus named bots at the stage level, a result earns stars and unlocks the next stage', () => {
  const dir = tmp();
  const store = new Store(dir);
  const mgr = new RoomManager(store);
  const { room, member } = mgr.create({ token: 'tok', name: 'Gon', ws: null });
  const stage = CAREER[1]; // doubles
  room.setupCareer(stage, member);
  assert.equal(room.state, 'match');
  assert.deepEqual(room.slots.map((s) => s.name || 'human'), ['human', 'Sofi', 'Marta', 'Luis']);
  assert.equal(room.slots[2].diff, stage.difficulty);
  assert.equal(room.settings.sets, stage.sets);
  // the human's team wins 3-0
  room.finishMatch({ results: { winner: 0, score: { sets: [[3, 0]] }, duration: 90, players: [], teamPoints: [12, 2], longestRally: 5, rallies: 14 } });
  const msg = JSON.parse(room.lastResultsMsg);
  assert.equal(msg.career.stars, 3);
  assert.equal(msg.career.unlocked, 3);
  assert.equal(room.toLobby(member), 'Career matches have no lobby');
  assert.equal(store.careerView('tok').stages[2].unlocked, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('public rooms are listed only while open and public', () => {
  const dir = tmp();
  const mgr = new RoomManager(new Store(dir));
  const a = mgr.create({ token: 'a', name: 'Ana', ws: null });
  const b = mgr.create({ token: 'b', name: 'Ben', ws: null });
  assert.equal(mgr.listPublic().length, 0, 'rooms are private by default');
  assert.equal(a.room.setSettings(a.member, { public: true }), null);
  const list = mgr.listPublic();
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].code, list[0].host, list[0].players, list[0].max], [a.room.code, 'Ana', 1, 4]);
  a.room.beginMatch();
  assert.equal(mgr.listPublic().length, 0, 'started matches are not listed');
  void b;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bot levels are really different: stronger levels beat weaker ones', async () => {
  const { PadelGame } = await import('../shared/game.js');
  const { botInput, makeBotMemory } = await import('../shared/ai.js');
  const play = (a, b, seed) => {
    let s = seed * 104729;
    const rng = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
    const g = new PadelGame({ rng, settings: { sets: 1, gamesPerSet: 3 } });
    const mem = [0, 1, 2, 3].map(makeBotMemory);
    for (let i = 0; i < 60 * 60 * 12; i++) {
      for (let k = 0; k < 4; k++) g.applyInput(k, botInput(g, k, mem[k], k < 2 ? a : b));
      g.tick(1 / 60);
      for (const e of g.drainEvents()) if (e.e === 'match') return e.winner;
    }
    return -1;
  };
  for (const [hi, lo] of [['expert', 'easy'], ['hard', 'normal']]) {
    let wins = 0;
    for (let seed = 1; seed <= 4; seed++) { if (play(hi, lo, seed) === 0) wins++; if (play(lo, hi, seed + 50) === 1) wins++; }
    assert.ok(wins >= 7, hi + ' should beat ' + lo + ' (' + wins + '/8)');
  }
});

test('career helpers (used by the in-browser career) match the server rules', async () => {
  const { careerViewFrom, applyCareerResult } = await import('../shared/career.js');
  let done = {};
  assert.deepEqual(careerViewFrom(done).stages.map((s) => s.unlocked).slice(0, 3), [true, false, false]);
  let r = applyCareerResult(done, 1, 2);
  assert.equal(r.unlocked, 2); assert.equal(r.bonusXp, CAREER[0].xp * 2);
  done = r.done;
  r = applyCareerResult(done, 1, 2);
  assert.equal(r.bonusXp, 0); assert.equal(r.unlocked, null);
  assert.equal(applyCareerResult(done, 1, 3).bonusXp, CAREER[0].xp);
  assert.equal(careerViewFrom(done).stages[1].unlocked, true);
  assert.equal(done[1], 2, 'input map is not mutated');
});
