import test from 'node:test';
import assert from 'node:assert/strict';
import { PadelGame } from '../shared/game.js';
import { botInput, makeBotMemory } from '../shared/ai.js';

function simulate(level, seeds, { human = false } = {}) {
  const M = { t: 0, net: 0, back: 0, stag: 0, rallies: 0, pts: 0, stuckBack: 0, long: 0 };
  for (let seed = 1; seed <= seeds; seed++) {
    let s = seed * 7919;
    const rng = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
    const g = new PadelGame({ rng, settings: { sets: 1, gamesPerSet: 3 } });
    const mem = [0, 1, 2, 3].map(makeBotMemory);
    if (human) g.players[0].human = true;
    let netTicks = [[0, 0], [0, 0]], rt = 0;
    for (let i = 0; i < 60 * 60 * 10; i++) {
      for (let k = 0; k < 4; k++) g.applyInput(k, botInput(g, k, mem[k], k === 0 && human ? 'normal' : level));
      g.tick(1 / 60);
      if (g.phase === 'rally' && g.rally.hits >= 2) {
        rt++;
        for (let t = 0; t < 2; t++) {
          const a = Math.abs(g.players[t * 2].z), b = Math.abs(g.players[t * 2 + 1].z);
          M.t++;
          if (a < 4.6 && b < 4.6) M.net++; else if (a > 5.6 && b > 5.6) M.back++; else if ((a < 4.6 && b > 5.6) || (b < 4.6 && a > 5.6)) M.stag++;
          netTicks[t][0] += a < 4.6 ? 1 : 0; netTicks[t][1] += b < 4.6 ? 1 : 0;
        }
      }
      let end = false;
      for (const e of g.drainEvents()) {
        if (e.e === 'point') {
          M.pts++; M.rallies += e.rally;
          if (rt > 180) for (let t = 0; t < 2; t++) for (let j = 0; j < 2; j++) { M.long++; if (netTicks[t][j] / rt < 0.07) M.stuckBack++; }
          netTicks = [[0, 0], [0, 0]]; rt = 0;
        }
        if (e.e === 'match') end = true;
      }
      if (end) break;
    }
  }
  return M;
}

test('bot pairs move like real pairs: mostly on the same line, both ways, never glued to one end', () => {
  const m = simulate('hard', 3);
  const f = (x) => x / m.t;
  assert.ok(f(m.net) > 0.15, `both at the net a fair share of the time (${(100 * f(m.net)).toFixed(0)}%)`);
  assert.ok(f(m.back) > 0.15, `both defending a fair share (${(100 * f(m.back)).toFixed(0)}%)`);
  assert.ok(f(m.stag) < 0.4, `one up / one back is the exception (${(100 * f(m.stag)).toFixed(0)}%)`);
  assert.ok(m.long === 0 || m.stuckBack / m.long < 0.15, 'nobody stays on the baseline for a whole long point');
});

test('with a person as partner the bot follows their line instead of playing its own game', () => {
  const m = simulate('hard', 3, { human: true });
  assert.ok(m.stag / m.t < 0.4, `the pair stays together (${(100 * m.stag / m.t).toFixed(0)}% split)`);
});

test('bots mishit instead of just watching the ball: rallies end, and it is mostly errors at lower levels', () => {
  const m = simulate('normal', 2);
  assert.ok(m.pts > 20);
  assert.ok(m.rallies / m.pts < 25, `rallies of a sensible length (${(m.rallies / m.pts).toFixed(1)} shots)`);
});
