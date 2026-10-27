import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, pointWon, displayPoints, scoreView, currentServer, serveSide } from '../shared/scoring.js';

const win = (m, team, n = 1) => { let ev = []; for (let i = 0; i < n; i++) ev = pointWon(m, team); return ev; };
const winGame = (m, team) => { for (let i = 0; i < 4; i++) pointWon(m, team); };

test('15, 30, 40, game', () => {
  const m = createMatch();
  assert.deepEqual(displayPoints(m), ['0', '0']);
  win(m, 0); assert.deepEqual(displayPoints(m), ['15', '0']);
  win(m, 0); assert.deepEqual(displayPoints(m), ['30', '0']);
  win(m, 0); assert.deepEqual(displayPoints(m), ['40', '0']);
  const ev = win(m, 0);
  assert.ok(ev.some((e) => e.type === 'game' && e.team === 0));
  assert.deepEqual(m.games, [1, 0]);
  assert.deepEqual(m.points, [0, 0]);
});

test('deuce and advantage', () => {
  const m = createMatch();
  win(m, 0, 3); win(m, 1, 3);
  assert.deepEqual(displayPoints(m), ['40', '40']);
  assert.equal(scoreView(m).label, 'Deuce');
  win(m, 0); assert.deepEqual(displayPoints(m), ['AD', '40']);
  win(m, 1); assert.deepEqual(displayPoints(m), ['40', '40']); // back to deuce
  win(m, 1); assert.deepEqual(displayPoints(m), ['40', 'AD']);
  const ev = win(m, 1);
  assert.ok(ev.some((e) => e.type === 'game' && e.team === 1));
});

test('golden point decides the game at 40-40', () => {
  const m = createMatch({ goldenPoint: true });
  win(m, 0, 3); win(m, 1, 3);
  assert.equal(scoreView(m).label, 'Golden point');
  const ev = win(m, 1);
  assert.ok(ev.some((e) => e.type === 'game' && e.team === 1));
});

test('set won 6-0, needs two-game lead, tiebreak at 6-6', () => {
  const m = createMatch({ sets: 3 });
  for (let i = 0; i < 6; i++) winGame(m, 0);
  assert.deepEqual(m.sets, [[6, 0]]);
  assert.deepEqual(m.setsWon, [1, 0]);

  const t = createMatch({ sets: 3 });
  for (let i = 0; i < 5; i++) { winGame(t, 0); winGame(t, 1); }
  winGame(t, 0); // 6-5, not a set yet
  assert.deepEqual(t.sets, []);
  winGame(t, 1); // 6-6 -> tiebreak
  assert.equal(t.tiebreak, true);
  win(t, 0, 6); win(t, 1, 6);
  assert.equal(t.tiebreak, true); // 6-6 in the tiebreak, needs a 2-point lead
  win(t, 0);
  assert.equal(t.tiebreak, true);
  win(t, 0);
  assert.equal(t.tiebreak, false);
  assert.deepEqual(t.sets, [[7, 6]]);
});

test('7-5 set without tiebreak', () => {
  const m = createMatch({ sets: 1 });
  for (let i = 0; i < 5; i++) { winGame(m, 0); winGame(m, 1); }
  winGame(m, 0); winGame(m, 0); // 7-5
  assert.deepEqual(m.sets, [[7, 5]]);
  assert.equal(m.winner, 0);
});

test('best of three: match is won on the second set and no more points count', () => {
  const m = createMatch({ sets: 3 });
  for (let i = 0; i < 12; i++) winGame(m, 1);
  assert.equal(m.winner, 1);
  assert.deepEqual(m.setsWon, [0, 2]);
  assert.deepEqual(pointWon(m, 0), []);
});

test('short formats: single set to 4 games', () => {
  const m = createMatch({ sets: 1, gamesPerSet: 4 });
  for (let i = 0; i < 4; i++) winGame(m, 0);
  assert.equal(m.winner, 0);
});

test('service rotation alternates teams and players, and side alternates per point', () => {
  const m = createMatch();
  const servers = [];
  for (let g = 0; g < 4; g++) { servers.push(currentServer(m)); winGame(m, 0); }
  assert.deepEqual(servers, [
    { team: 0, idx: 0 }, { team: 1, idx: 0 }, { team: 0, idx: 1 }, { team: 1, idx: 1 },
  ]);
  const s = createMatch();
  assert.equal(serveSide(s), 0);
  win(s, 0); assert.equal(serveSide(s), 1);
  win(s, 0); assert.equal(serveSide(s), 0);
});

test('tiebreak service: 1 point, then two each', () => {
  const m = createMatch();
  for (let i = 0; i < 5; i++) { winGame(m, 0); winGame(m, 1); }
  winGame(m, 0); winGame(m, 1);
  assert.equal(m.tiebreak, true);
  const order = [];
  for (let i = 0; i < 9; i++) { order.push(currentServer(m)); pointWon(m, i % 2); }
  const teams = order.map((s) => s.team);
  const first = teams[0];
  assert.deepEqual(teams.slice(0, 5), [first, 1 - first, 1 - first, first, first]);
  assert.notEqual(order[0].idx, order[3].idx); // partners alternate between their turns
});

test('match point is flagged in the view', () => {
  const m = createMatch({ sets: 1, gamesPerSet: 2 });
  winGame(m, 0);
  win(m, 0, 3);
  const v = scoreView(m);
  assert.equal(v.gamePoint, 0);
  assert.equal(v.matchPoint, true);
});
