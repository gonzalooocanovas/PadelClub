import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { percentile, Rolling, buildReport, landingComparison } from '../client/js/diagnostics-core.js';

test('percentiles and the rolling window behave like the statistics they claim to be', () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.ok(Number.isNaN(percentile([], 50)));
  const r = new Rolling(5);
  for (let i = 1; i <= 8; i++) r.push(i);
  const s = r.stats();
  assert.equal(s.n, 5); assert.equal(s.max, 8); assert.equal(s.mean, 6);
});

test('the report contains no private data and says when a measurement is unavailable', () => {
  const rep = buildReport({ when: 'now', mode: 'solo', court: 'indoor', camera: 'player', quality: 'medium', frame: new Rolling().stats(), net: null, interpMs: 30, ball: { x: 1, y: 2, z: 3, speed: 5 }, events: [] });
  const text = JSON.stringify(rep);
  assert.ok(!/token|name|code|email|ip/i.test(text.replace(/hidden\/throttled tab/g, '')), 'nothing identifying');
  assert.equal(typeof rep.net, 'string');
  assert.match(rep.frame.note, /throttled/);
});

test('planned vs predicted vs actual landing are reported separately, with the distances', () => {
  const c = landingComparison([1, 6], [1.2, 6.1], [1.5, 6.5]);
  assert.deepEqual(c.planned, [1, 6]);
  assert.ok(Math.abs(c.plannedVsActual - Math.hypot(0.5, 0.5)) < 1e-9);
  assert.ok(Math.abs(c.predictedVsActual - Math.hypot(0.3, 0.4)) < 1e-9);
  assert.equal(landingComparison(null, null, [1, 1]).plannedVsActual, null);
});

test('diagnostics are read-only: the module never sends a network message or writes game state', () => {
  const src = fs.readFileSync(new URL('../client/js/diagnostics.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/\.send\(|net\.|setSetting|applyInput|startSwing|\.game\./.test(src), 'no sends, no game writes');
  const main = fs.readFileSync(new URL('../client/js/main.js', import.meta.url), 'utf8');
  assert.ok(/diag\.on && local && \(e\.key === '\['/.test(main), 'stepping/pausing is gated on diagnostics being on AND a solo match');
});

test('the disabled diagnostics cost nothing measurable: 1,000,000 frame() calls take well under 50 ms', async () => {
  // Diagnostics.frame() is `if (!this.on) return;` when disabled. Measure that exact guard without importing Three.js.
  class Off { constructor() { this.on = false; } frame() { if (!this.on) return; } }
  const d = new Off();
  const t0 = performance.now();
  for (let i = 0; i < 1e6; i++) d.frame(i);
  const ms = performance.now() - t0;
  assert.ok(ms < 50, `${ms.toFixed(2)} ms per million disabled frames`);
  const src = fs.readFileSync(new URL('../client/js/diagnostics.js', import.meta.url), 'utf8');
  assert.ok(/frame\(now\) \{\n    if \(!this\.on\) return;/.test(src), 'the real method starts with that guard');
});
