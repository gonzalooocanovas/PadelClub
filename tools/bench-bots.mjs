// Seeded bot benchmark. Run: npm run bench:bots -- [--n 100] [--games 3] [--pairs easy:normal,normal:hard,hard:expert] [--tag name] [--human]
//   --pairs   adjacent pairings "A:B": A plays team 0 in half of the matches and team 1 in the other half (side swapped, same seeds)
//   --human   slot 0 is a scripted "human" (a Club-level bot flagged as a person) with a bot partner: tests teamwork with a person
// Every match is deterministic for its seed. Output: a table per pairing, saved to docs/bench-<tag>.txt
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import { wilson } from './lib/match.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const N = +arg('n', 100);
const GAMES = +arg('games', 3);
const TAG = String(arg('tag', 'latest'));
const pairs = String(arg('pairs', 'easy:normal,normal:hard,hard:expert')).split(',').map((p) => p.split(':'));
const SINGLE = arg('single', false);
const singles = SINGLE ? String(SINGLE).split(',') : [];
const workers = Math.max(1, Math.min(os.cpus().length - 1, 10));

const jobs = [];
let id = 0;
for (const [lo, hi] of pairs) for (let i = 0; i < N; i++) {
  const swap = i % 2 === 1;
  jobs.push({ id: id++, pair: `${lo}:${hi}`, a: swap ? hi : lo, b: swap ? lo : hi, loSide: swap ? 1 : 0, seed: 1000 + i, games: GAMES });
}
for (const lvl of singles) for (let i = 0; i < N; i++) jobs.push({ id: id++, pair: `self:${lvl}`, a: lvl, b: lvl, loSide: 0, seed: 5000 + i, games: GAMES });

const results = new Map();
const t0 = Date.now();
await new Promise((resolve) => {
  let next = 0, done = 0;
  const pool = [];
  const feed = (w) => { if (next < jobs.length) w.postMessage(jobs[next++]); };
  for (let i = 0; i < workers; i++) {
    const w = new Worker(new URL('./lib/match-worker.mjs', import.meta.url));
    w.on('message', (m) => {
      if (m.error) { console.error(m.error); process.exit(1); }
      results.set(m.id, m.stats); done++;
      if (done % 25 === 0) process.stderr.write(`  ${done}/${jobs.length} matches\r`);
      if (done === jobs.length) { pool.forEach((x) => x.terminate()); resolve(); } else feed(w);
    });
    pool.push(w); feed(w);
  }
});

const lines = [];
const out = (s = '') => { lines.push(s); console.log(s); };
out(`PADEL CLUB bot benchmark   tag=${TAG}   matches per pairing=${N}   games per set=${GAMES}   node ${process.version}   ${os.cpus()[0].model}, ${os.cpus().length} threads   ${((Date.now() - t0) / 1000).toFixed(0)} s`);
out('Seeds: 1000..' + (1000 + N - 1) + ' (self-play 5000..). Side swapped on alternate seeds. Every match is deterministic for its seed.');
const sum = (a) => a.reduce((x, y) => x + y, 0);
const pct = (x, n) => (n ? (100 * x / n).toFixed(1) + '%' : 'n/a');
const per = (x, n) => (n ? (x / n).toFixed(2) : 'n/a');
for (const key of [...new Set(jobs.map((j) => j.pair))]) {
  const js = jobs.filter((j) => j.pair === key);
  const S = js.map((j) => ({ j, s: results.get(j.id) }));
  const done = S.filter((x) => x.s.winner >= 0);
  const hiWins = done.filter((x) => x.s.winner !== x.j.loSide).length;
  const [lo, hi] = wilson(hiWins, done.length);
  const pts = sum(S.map((x) => x.s.points));
  out('');
  out(`== ${key} ==`);
  if (!key.startsWith('self')) out(`   stronger (${key.split(':')[1]}) won ${hiWins}/${done.length} = ${pct(hiWins, done.length)}   95% CI [${(100 * lo).toFixed(0)}%, ${(100 * hi).toFixed(0)}%]   unfinished: ${S.length - done.length}`);
  out(`   points ${pts}   rally ${per(sum(S.map((x) => x.s.rallyShots)), pts)} shots   aces ${pct(sum(S.map((x) => x.s.aces)), pts)}   double faults ${pct(sum(S.map((x) => x.s.doubleFaults)), pts)}   errors ${pct(sum(S.map((x) => x.s.errors)), pts)}   winners ${pct(sum(S.map((x) => x.s.winners)), pts)}   por-4 ${pct(sum(S.map((x) => x.s.por4)), pts)}`);
  const rs = {}; for (const x of S) for (const [k, v] of Object.entries(x.s.byReason)) rs[k] = (rs[k] || 0) + v;
  out(`   points by reason: ${Object.entries(rs).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k} ${pct(v, pts)}`).join(', ')}`);
  const et = {}; for (const x of S) for (const [k, v] of Object.entries(x.s.errByTac)) et[k] = (et[k] || 0) + v;
  out(`   errors by last shot (tactic/kind): ${Object.entries(et).sort((a, c) => c[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const el = {}; for (const x of S) for (const [k, v] of Object.entries(x.s.errByLabel || {})) el[k] = (el[k] || 0) + v;
  out(`   errors by contact label: ${Object.entries(el).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const inc = sum(S.map((x) => sum(x.s.incoming)));
  const ign = sum(S.map((x) => sum(x.s.ignoredReachable)));
  const pairTicks = sum(S.map((x) => x.s.pairTicks)) || 1;
  out(`   teamwork: incoming balls ${inc}   clearly reachable ones the whole team ignored ${ign} (${pct(ign, inc)})   double commitments ${sum(S.map((x) => sum(x.s.doubleCommit)))}   overlap ${pct(sum(S.map((x) => x.s.overlapTicks)), pairTicks)}   split one-up-one-back ${pct(sum(S.map((x) => x.s.splitTicks)), pairTicks)}   both net ${pct(sum(S.map((x) => x.s.bothNetTicks)), pairTicks)}   both back ${pct(sum(S.map((x) => x.s.bothBackTicks)), pairTicks)}   points lost to positioning ${sum(S.map((x) => x.s.positionErrorPoints))}`);
  const tac = {}, tacOk = {};
  for (const x of S) { for (const [k, v] of Object.entries(x.s.tactics)) tac[k] = (tac[k] || 0) + v; for (const [k, v] of Object.entries(x.s.tacticOk)) tacOk[k] = (tacOk[k] || 0) + v; }
  const hits = sum(S.map((x) => x.s.hits));
  out(`   wall play: rebounds played ${sum(S.map((x) => sum(x.s.wallReceived)))} of ${hits} shots (${pct(sum(S.map((x) => sum(x.s.wallReceived))), hits)})   tactics chosen: ${Object.entries(tac).map(([k, v]) => `${k} ${v} (won point ${pct(tacOk[k] || 0, v)})`).join(', ') || 'none'}`);
  out(`   invalid: NaN states ${sum(S.map((x) => x.s.nan))}   mean match length ${(sum(S.map((x) => x.s.seconds)) / S.length).toFixed(0)} s`);
}
fs.mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL(`../docs/bench-${TAG}.txt`, import.meta.url), lines.join('\n') + '\n');
