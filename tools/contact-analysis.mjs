// Contact analysis. Run: npm run analyze:contact [-- --n 600]
// Generates seeded contact scenarios (player movement state, ball distance/height/pace, press timing) through the REAL game
// (PadelGame.contact + planShot + physics) and reports how contact quality relates to pace, spin, accuracy and validity.
import fs from 'node:fs';
import { PadelGame } from '../shared/game.js';
import { PHYS } from '../shared/constants.js';
import { rng } from './lib/scenarios.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };

/** One scenario. Returns null when no contact happened (a miss: ball out of reach). */
export function contactScenario(seed) {
  const r = rng(seed * 7 + 3);
  const g = new PadelGame({ rng: rng(seed), settings: { mode: 'doubles' } });
  g.phase = 'rally';
  g.rally = { serving: false, faults: 0, lastTeam: 1, lastSlot: 2, bounces: 1, hits: 4, netTouched: false, serveXSign: 1 };
  const move = ['still', 'walk', 'sprint', 'lateral'][Math.floor(r() * 4)];
  const dist = 0.3 + r() * 1.6; // where the ball passes relative to the player (m)
  const height = 0.45 + r() * 1.7;
  const px = (r() - 0.5) * 6, pz = -(3.5 + r() * 5);
  const p = g.players[0];
  Object.assign(p, { x: px, z: pz, vx: 0, vz: 0, stamina: 100 });
  const mv = { still: [0, 0, false], walk: [0, 0.5, false], sprint: [0, 1, true], lateral: [1, 0, false] }[move]; // [mx, mz, sprint]
  const sgn = r() < 0.5 ? 1 : -1;
  // where the ball will be when the racket meets it
  const ang = r() * Math.PI * 2;
  const P = { x: px + Math.cos(ang) * dist, y: height, z: pz + Math.sin(ang) * dist * 0.6 };
  const T = 0.55 + r() * 0.5; // flight time from the opponents' side to the contact point
  const b0 = { x: (r() - 0.5) * 4, y: 1.6, z: 4 };
  const v = { vx: (P.x - b0.x) / T, vy: (P.y - b0.y + 0.5 * PHYS.G * T * T) / T, vz: (P.z - b0.z) / T };
  Object.assign(g.ball, b0, v, { hw: 5, fe: PHYS.FLOOR_E, ff: PHYS.FLOOR_FRIC, sb: 0, ss: 0 });
  const press = 0.17 - (r() - 0.45) * 0.3; // seconds before the ball arrives (0.17 = the ideal press)
  const aim = { ax: (r() - 0.5) * 7, az: 3.5 + r() * 5.5 };
  let hit = null, landing = null, swung = false;
  for (let i = 0; i < 90 && !landing; i++) {
    const t = i / 60;
    if (!swung && t >= T - press) { g.startSwing(p, { ax: aim.ax, az: aim.az, mod: 0, lob: false }); g.players[0].input = { ...g.players[0].input, ax: aim.ax, az: aim.az }; swung = true; }
    if (!hit) g.applyInput(0, { mx: mv[0] * sgn, mz: mv[1] * sgn, sprint: mv[2], ax: aim.ax, az: aim.az });
    g.tick(1 / 60);
    for (const e of g.drainEvents()) {
      if (e.e === 'hit' && !hit) hit = e;
      if (e.e === 'ball' && e.k === 'floor' && hit && !landing && e.z > 0) landing = { x: e.x, z: e.z };
    }
  }
  if (!hit) return null;
  const sp = Math.hypot(g.ball.vx, g.ball.vz);
  const target = { x: Math.max(-4.5, Math.min(4.5, aim.ax)), z: Math.max(3, Math.min(9.2, aim.az)) };
  const err = landing ? Math.hypot(landing.x - target.x, landing.z - target.z) : null;
  return { seed, move, dist, height, press, q: hit.q, label: hit.label, face: hit.face, off: hit.off, spin: hit.sb, speed: sp, landed: !!landing, inCourt: !!landing && Math.abs(landing.x) <= 5 && landing.z <= 10, err, kind: hit.kind };
}

export function analyze(n = 600) {
  const rows = [];
  for (let s = 1; s <= n; s++) { const r = contactScenario(s); if (r) rows.push(r); }
  return rows;
}

const bin = (q) => (q < 0.5 ? 'q<0.50' : q < 0.7 ? '0.50-0.70' : q < 0.85 ? '0.70-0.85' : 'q>=0.85');
export function summarize(rows) {
  const by = {};
  for (const r of rows) { (by[bin(r.q)] ??= []).push(r); }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  return ['q<0.50', '0.50-0.70', '0.70-0.85', 'q>=0.85'].filter((k) => by[k]).map((k) => {
    const a = by[k];
    return { bin: k, n: a.length, pace: mean(a.map((r) => r.speed)), spin: mean(a.map((r) => Math.abs(r.spin))), landedPct: 100 * mean(a.map((r) => (r.landed ? 1 : 0))), err: mean(a.filter((r) => r.err !== null).map((r) => r.err)) };
  });
}

if (process.argv[1] && process.argv[1].endsWith('contact-analysis.mjs')) {
  const n = +arg('n', 600);
  const rows = analyze(n);
  const lines = [];
  const out = (s = '') => { lines.push(s); console.log(s); };
  out(`Contact analysis: ${n} generated scenarios, ${rows.length} produced a contact (the rest were out of reach). Deterministic: scenario i uses seed i.`);
  out('Movement states: still / walk (3 m/s) / sprint (6.5 m/s) / lateral (5 m/s); ball distance 0.3-1.9 m; height 0.45-2.15 m; press timing around the ideal 0.17 s.');
  out('');
  out('quality bin | contacts | mean pace after contact (m/s) | mean |spin| | landed on the floor | mean landing error vs the aimed point (m)');
  for (const s of summarize(rows)) out(`${s.bin.padEnd(10)} | ${String(s.n).padStart(8)} | ${s.pace.toFixed(1).padStart(9)} | ${s.spin.toFixed(1).padStart(6)} | ${s.landedPct.toFixed(0).padStart(5)}% | ${s.err.toFixed(2)}`);
  const labels = {}; for (const r of rows) labels[r.label] = (labels[r.label] || 0) + 1;
  out('');
  out('labels: ' + Object.entries(labels).map(([k, v]) => `${k} ${v}`).join(', '));
  const byMove = {}; for (const r of rows) (byMove[r.move] ??= []).push(r.q);
  out('mean quality by movement state: ' + Object.entries(byMove).map(([k, a]) => `${k} ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2)} (n=${a.length})`).join(', '));
  fs.writeFileSync(new URL('../docs/contact-analysis.txt', import.meta.url), lines.join('\n') + '\n');
}
