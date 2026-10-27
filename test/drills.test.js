import test from 'node:test';
import assert from 'node:assert/strict';
import { PadelGame } from '../shared/game.js';
import { botInput, makeBotMemory } from '../shared/ai.js';
import { DrillController } from '../client/js/drills.js';
import { DRILLS } from '../shared/career2.js';

// Run a drill headlessly with a bot standing in for the human (slot 0), through the real game engine.
function runDrill(id, level = 'hard', seed = 11) {
  let s = seed;
  const rng = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const g = new PadelGame({ rng, settings: { sets: 1, gamesPerSet: 6 } });
  const ctl = new DrillController(id);
  const messages = [];
  let result = null;
  const lm = { emit: (m) => messages.push(m), finishDrill: (r) => { result = r; } };
  const mem = makeBotMemory();
  for (let i = 0; i < 60 * 60 * 6 && !result; i++) {
    ctl.update(g, lm);
    g.applyInput(0, botInput(g, 0, mem, level, 1 / 60));
    g.tick(1 / 60);
    ctl.events(g.drainEvents(), g, lm);
  }
  return { result, messages, ctl };
}

test('every drill finishes after exactly its number of attempts, using the real engine', () => {
  for (const d of DRILLS) {
    const { result, ctl } = runDrill(d.id);
    assert.ok(result, `${d.id} finished`);
    assert.equal(result.id, d.id);
    assert.ok(result.attempts >= d.n, `${d.id}: attempts ${result.attempts}`);
    assert.ok(result.score >= 0 && result.score <= (d.id === 'serve' ? d.n * 2 : d.n), `${d.id}: score ${result.score}`);
    assert.equal(ctl.done, true);
  }
});

test('the serve drill rewards serves that land in the box and deep; faults only count as attempts', () => {
  const { result } = runDrill('serve', 'expert', 5);
  assert.ok(result.score > 0, 'a competent server lands serves');
  assert.ok(result.attempts >= 10);
});

test('status messages carry the target zone for the court overlay', () => {
  const { messages } = runDrill('forehand');
  const st = messages.filter((m) => m.t === 'drillStatus');
  assert.ok(st.length > 3);
  assert.ok(st[0].zone && st[0].zone.x1 > st[0].zone.x0);
  assert.match(st.at(-1).text, /10\/10/);
});

test('shot kind matters: only a globo counts in the lob drill, and an off-target ball scores nothing', () => {
  const ctl = new DrillController('lob');
  const lm = { emit: () => {}, finishDrill: () => {} };
  const g = new PadelGame({});
  g.drainEvents();
  const feed = (kind, x, z) => {
    ctl.events([{ e: 'hit', slot: 0, kind }, { e: 'ball', k: 'floor', x, y: 0, z }], g, lm);
    ctl.events([{ e: 'point' }], g, lm);
  };
  feed('forehand', 0, 8.5);   // deep but not a lob
  assert.equal(ctl.score, 0);
  feed('lob', 0, 8.5);        // a lob into the zone
  assert.equal(ctl.score, 1);
  feed('lob', 0, 3);          // a lob that lands short
  assert.equal(ctl.score, 1);
  assert.equal(ctl.attempts, 3);
});
