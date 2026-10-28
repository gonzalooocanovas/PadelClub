import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, summarize, contactScenario } from '../tools/contact-analysis.mjs';

test('contact analysis: 500 generated scenarios; better contact means more pace, more accuracy and more valid shots', () => {
  const rows = analyze(500);
  assert.ok(rows.length > 250, `${rows.length} contacts`);
  const s = summarize(rows);
  assert.ok(s.length >= 3);
  for (let i = 1; i < s.length; i++) {
    assert.ok(s[i].pace > s[i - 1].pace - 0.3, `pace rises with quality (${s.map((x) => x.pace.toFixed(1))})`);
    assert.ok(s[i].err < s[i - 1].err + 0.1, `error falls with quality (${s.map((x) => x.err.toFixed(2))})`);
  }
  assert.ok(s.at(-1).landedPct > s[0].landedPct + 20, 'clean contact lands much more often');
  assert.ok(s.at(-1).err < 0.8 && s[0].err > 1.2, 'documented tolerance: clean < 0.8 m, poor > 1.2 m');
});

test('contact outcome depends on movement: a player on the run or stretched hits worse than a set player', () => {
  const rows = analyze(400);
  const m = (k) => { const a = rows.filter((r) => r.move === k).map((r) => r.q); return a.reduce((x, y) => x + y, 0) / a.length; };
  assert.ok(m('still') > m('sprint') + 0.1 && m('walk') > m('lateral'), `still ${m('still').toFixed(2)} walk ${m('walk').toFixed(2)} sprint ${m('sprint').toFixed(2)} lateral ${m('lateral').toFixed(2)}`);
});

test('determinism: the same scenario seed gives the identical contact', () => {
  for (const s of [3, 17, 99, 250]) assert.deepEqual(contactScenario(s), contactScenario(s));
});
