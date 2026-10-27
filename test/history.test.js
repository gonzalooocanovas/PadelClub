import test from 'node:test';
import assert from 'node:assert/strict';
import { entryFrom, addEntry, summarize, loadHistory, saveHistory, HISTORY_MAX } from '../shared/history.js';

const results = (winner) => ({
  winner, score: { sets: [[4, 2]] }, duration: 600, longestRally: 14, rallies: 40, teamPoints: [30, 22],
  players: [{ hits: 50, winners: 7, errors: 3, aces: 2, smashes: 1, volleys: 4, doubleFaults: 0 }, {}, {}, {}],
});

test('an entry is written from the player\'s point of view', () => {
  const win = entryFrom(results(0), { slot: 0, names: ['Me', 'Mate', 'A', 'B'], mode: 'doubles', court: 'night', kind: 'career', at: 5 });
  assert.equal(win.won, true);
  assert.deepEqual(win.sets, [[4, 2]]);
  assert.deepEqual(win.mates, ['Mate']);
  assert.deepEqual(win.opponents, ['A', 'B']);
  assert.equal(win.stats.aces, 2);
  const loss = entryFrom(results(0), { slot: 2, names: ['A', 'B', 'Me', 'Mate'], mode: 'doubles' });
  assert.equal(loss.won, false);
  assert.deepEqual(loss.sets, [[2, 4]], 'sets are flipped for team 1');
  assert.deepEqual(loss.points, [22, 30]);
  const solo = entryFrom(results(0), { slot: 0, names: ['Me', 'x', 'Bot', 'x'], mode: 'singles' });
  assert.deepEqual(solo.opponents, ['Bot']);
  assert.deepEqual(solo.mates, []);
});

test('history keeps the newest first, is capped, and survives reloads', () => {
  let list = [];
  for (let i = 0; i < HISTORY_MAX + 20; i++) list = addEntry(list, entryFrom(results(i % 2), { slot: 0, names: ['a', 'b', 'c', 'd'], at: i }));
  assert.equal(list.length, HISTORY_MAX);
  assert.equal(list[0].at, HISTORY_MAX + 19);
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.ok(saveHistory(storage, list));
  assert.equal(loadHistory(storage).length, HISTORY_MAX);
  store.set('padel.history', '{not json');
  assert.deepEqual(loadHistory(storage), [], 'corrupt data is ignored, not thrown');
  store.set('padel.history', JSON.stringify([{ junk: 1 }, list[0]]));
  assert.equal(loadHistory(storage).length, 1, 'invalid rows are dropped');
});

test('summary counts wins, streaks and records', () => {
  const mk = (won, at, rally = 5) => ({ ...entryFrom(results(won ? 0 : 1), { slot: 0, names: ['a', 'b', 'c', 'd'], at }), longestRally: rally });
  const list = [mk(true, 5, 9), mk(true, 4, 30), mk(false, 3), mk(true, 2), mk(true, 1)]; // newest first
  const s = summarize(list);
  assert.equal(s.matches, 5);
  assert.equal(s.wins, 4);
  assert.equal(s.winRate, 80);
  assert.equal(s.streak, 2);
  assert.equal(s.bestStreak, 2);
  assert.equal(s.longestRally, 30);
  assert.equal(summarize([]).winRate, 0);
});
