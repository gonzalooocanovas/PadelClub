import test from 'node:test';
import assert from 'node:assert/strict';
import { PadelGame } from '../shared/game.js';
import { evaluateShot, flyShot } from '../shared/tactics.js';
import { skillFor } from '../shared/ai.js';
import { solveLaunch } from '../shared/physics.js';
import { rng } from '../tools/lib/scenarios.js';

/** Build a rally in which team 0's player 0 must answer a ball that has just come off the back glass. */
function situation({ opp, ball, me = { x: 0, z: -8.2 }, rebound = true, level = 'hard', seed = 1 }) {
  const g = new PadelGame({ rng: rng(seed), settings: { mode: 'doubles' } });
  g.phase = 'rally';
  g.rally = { serving: false, faults: 0, lastTeam: 1, lastSlot: 2, bounces: 1, hits: 4, netTouched: false, serveXSign: 1, wallTouched: rebound };
  Object.assign(g.players[0], { x: me.x, z: me.z, vx: 0, vz: 0, stamina: 100 });
  Object.assign(g.players[1], { x: -me.x || 2, z: -3 });
  Object.assign(g.players[2], { x: opp[0][0], z: opp[0][1] });
  Object.assign(g.players[3], { x: opp[1][0], z: opp[1][1] });
  Object.assign(g.ball, ball);
  return { g, p: g.players[0], skill: skillFor(level) };
}

test('flyShot uses the real physics: a ball hit into the net, onto its own side or into the glass first is invalid', () => {
  const g = new PadelGame({ rng: rng(1) });
  const b = { x: 0, y: 1, z: -8, vx: 0, vy: 0, vz: 0, hw: 5, fe: 0.85, ff: 0.86, doors: true };
  const net = flyShot(b, { vx: 0, vy: 2, vz: 8 }, 0);
  assert.equal(net.valid, false);
  const good = flyShot(b, solveLaunch(b, 0, 6, 1.0), -6);
  assert.equal(good.valid, true);
  assert.ok(good.floor.z > 0);
  const own = flyShot(b, { vx: 0, vy: -1, vz: 5 }, 0);
  assert.equal(own.valid, false);
  void g;
});

test('after a rebound off the back glass with both opponents at the net, the bot chooses a valid option that lifts or places the ball (never a flat drive at them)', () => {
  let chosen = {};
  let n = 0, valid = 0;
  for (let s = 1; s <= 40; s++) {
    const r = rng(s);
    const { g, p, skill } = situation({ opp: [[-1.5 + r(), 2.2 + r()], [1.5 + r(), 2.2 + r()]], ball: { x: (r() - 0.5) * 6, y: 0.8 + r() * 0.5, z: -9.2, vx: 0, vy: 0, vz: 0, hw: 5, fe: 0.85, ff: 0.86 }, me: { x: (r() - 0.5) * 4, z: -8.6 }, seed: s });
    const t = evaluateShot(g, p, skill, g.rng);
    n++;
    if (!t) continue;
    valid++;
    chosen[t.tac] = (chosen[t.tac] || 0) + 1;
    assert.ok(t.table.some((row) => row.score > -9), 'at least one valid candidate');
    assert.ok(Number.isFinite(t.ax) && Number.isFinite(t.az));
  }
  assert.ok(valid / n > 0.95, 'a valid plan almost always exists');
  const defensive = (chosen.recovery || 0) + (chosen.lob || 0) + (chosen.chiquita || 0) + (chosen['corner-wall'] || 0) + (chosen.slice || 0);
  assert.ok(defensive / valid > 0.8, `against net players it lifts, slices or places deep (${JSON.stringify(chosen)})`);
  assert.ok((chosen.drive || 0) / valid < 0.15, 'a flat drive at two net players is rare');
});

test('after a rebound with both opponents pinned deep, an attacking or short option is available and chosen at least sometimes', () => {
  const chosen = {};
  for (let s = 1; s <= 40; s++) {
    const r = rng(s + 500);
    const { g, p, skill } = situation({ opp: [[-2 + r(), 8.3], [2 + r(), 8.3]], ball: { x: (r() - 0.5) * 5, y: 1.0, z: -6.5, vx: 0, vy: 0, vz: 0, hw: 5, fe: 0.85, ff: 0.86 }, me: { x: (r() - 0.5) * 3, z: -6.4 }, seed: s });
    const t = evaluateShot(g, p, skill, g.rng);
    if (t) chosen[t.tac] = (chosen[t.tac] || 0) + 1;
  }
  const attack = (chosen.bajada || 0) + (chosen.drop || 0) + (chosen.chiquita || 0) + (chosen.drive || 0);
  assert.ok(attack >= 8, `short or attacking options come up against deep opponents (${JSON.stringify(chosen)})`);
});

test('the choice is made from the visible situation only: identical states give the identical plan, and the game state is untouched', () => {
  const mk = () => situation({ opp: [[-1, 6], [2, 7]], ball: { x: 1, y: 1, z: -7, vx: 3, vy: 1, vz: -4, hw: 5, fe: 0.85, ff: 0.86 }, seed: 9 });
  const a = mk(), b = mk();
  const before = JSON.stringify([a.g.ball, a.g.players.map((p) => [p.x, p.z])]);
  const ta = evaluateShot(a.g, a.p, a.skill, a.g.rng), tb = evaluateShot(b.g, b.p, b.skill, b.g.rng);
  assert.equal(ta.tac, tb.tac);
  assert.equal(ta.ax, tb.ax);
  assert.equal(JSON.stringify([a.g.ball, a.g.players.map((p) => [p.x, p.z])]), before, 'evaluation flies private copies');
});

test('bots using the planner produce legal wall rebounds only: in a short seeded match no illegal state appears', async () => {
  const { playMatch } = await import('../tools/lib/match.js');
  const s = playMatch({ a: 'hard', b: 'normal', seed: 31, games: 2 });
  assert.equal(s.nan, 0);
  assert.ok(s.points > 5);
  assert.ok(Object.keys(s.tactics).length >= 4, `varied tactics ${JSON.stringify(s.tactics)}`);
});
