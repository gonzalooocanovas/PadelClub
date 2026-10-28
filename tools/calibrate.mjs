// Physics calibration report. Run: npm run calibrate   (prints a table; add --write to save docs/calibration-output.txt)
import fs from 'node:fs';
import { dropRebound, stepConvergence, wallImpact, surfaceBounce, netCrossing, multiBounce, energy } from './lib/scenarios.js';
import { COURTS } from '../shared/looks.js';
import { PHYS, COURT } from '../shared/constants.js';

const out = [];
const log = (s = '') => { out.push(s); console.log(s); };
const f = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? 'n/a' : x.toFixed(d));

log('PADEL CLUB physics calibration report');
log(`parameters: FLOOR_E=${PHYS.FLOOR_E} WALL_E=${PHYS.WALL_E} MESH_E=${PHYS.MESH_E} DRAG=${PHYS.DRAG} DRAG2=${PHYS.DRAG2} MAGNUS=${PHYS.MAGNUS}`);
log('');
log('1. Official drop test (reference: FIP/ITF-style padel ball, dropped from 2.54 m onto a rigid floor rebounds 1.35-1.45 m)');
for (const [name, e] of [['realistic rigid floor (e=0.742)', 0.742], ['game default (PHYS.FLOOR_E)', PHYS.FLOOR_E], ...Object.values(COURTS).map((c) => [`court ${c.id}`, c.surface.floorE])]) {
  log(`   ${name.padEnd(34)} rebound ${f(dropRebound(e))} m`);
}
log('');
log('2. Time-step convergence (landing point of a 25 m/s drive, step 1/60 vs 1/600)');
for (const sb of [0, -10, 12]) {
  const r = stepConvergence({ x: 0, y: 1, z: -6, vx: 1, vy: 2, vz: 25, sb });
  log(`   spin ${String(sb).padStart(3)}: 1/60 -> z=${f(r.coarse?.z)} t=${f(r.coarse?.t, 3)} | 1/600 -> z=${f(r.fine?.z)} t=${f(r.fine?.t, 3)} | difference ${f(Math.abs((r.coarse?.z ?? 0) - (r.fine?.z ?? 0)), 3)} m`);
}
log('');
log('3. Glass and fence impact (speed 14 m/s, spin 0). e_n = normal speed kept; angle = path vs wall surface');
for (const material of ['glass', 'mesh']) for (const angleDeg of [90, 60, 30, 15]) {
  const r = wallImpact({ speed: 14, angleDeg, material });
  log(`   ${material.padEnd(5)} incidence ${String(angleDeg).padStart(2)} deg: e_n=${f(r.eNormal)}  out/in tangential=${f(r.out.vt / r.in.vt)}  reflection angle ${f(r.outAngleDeg, 1)} deg`);
}
log('   glass speed dependence (head-on): ' + [4, 8, 14, 20, 30].map((v) => `${v} m/s -> e_n ${f(wallImpact({ speed: v, angleDeg: 90 }).eNormal)}`).join(', '));
log('');
log('4. Spin off glass (head-on, 14 m/s): vertical speed gained');
for (const sb of [-12, -6, 0, 6, 12]) log(`   spin ${String(sb).padStart(3)}: vy after = ${f(wallImpact({ speed: 14, angleDeg: 90, spin: sb }).out.vy)} m/s`);
log('');
log('5. Surfaces (2 m drop with 8 m/s forward speed)');
for (const id of Object.keys(COURTS)) {
  const r = surfaceBounce(id);
  log(`   ${id.padEnd(8)} e=${f(r.e)} fric=${f(r.fric)}  rebound ${f(r.rebound)} m (from 2.0 m)  horizontal speed kept ${f(r.vxKept)}`);
}
log('');
log(`6. Net (centre height ${COURT.NET_H} m, ball radius ${COURT.BALL_R} m): crossing at different heights`);
for (const h of [0.7, 0.85, 0.9, 0.95, 1.0, 1.1]) { const r = netCrossing(h); log(`   height ${f(h)} m: ${r.crossed ? 'passes' : 'blocked'}  events [${r.kinds.join(',')}]`); }
log('');
log('7. Multiple collisions (45 m/s corner shot): energy per unit mass must never rise (except the small spin kick off the glass)');
{
  const r = multiBounce({ x: 3, y: 2, z: 5, vx: 30, vy: -5, vz: 34, sb: 0 });
  const es = r.states.map((s) => s.E);
  let maxRise = 0; for (let i = 1; i < es.length; i++) maxRise = Math.max(maxRise, es[i] - es[i - 1]);
  log(`   ${r.events.length} collision events, E start ${f(energy({ ...r.states[0] }), 1)} -> end ${f(es.at(-1), 1)} J/kg, largest single-step rise ${f(maxRise, 3)} J/kg, finite: ${r.states.every((s) => Number.isFinite(s.x + s.y + s.z))}`);
}
log('');
log('8. Air drag: game model vs a physical estimate (Cd 0.6 for a felt ball, rho 1.2 kg/m3, r 0.0335 m, m 0.058 kg: a = 0.0219 v^2)');
for (const v of [10, 20, 30]) {
  const game = (PHYS.DRAG * 0.6 + PHYS.DRAG2 * v) * v;
  const phys = 0.5 * 1.2 * 0.6 * Math.PI * COURT.BALL_R ** 2 / 0.058 * v * v;
  log(`   ${String(v).padStart(2)} m/s: game ${f(game, 1)} m/s2   physical estimate ${f(phys, 1)} m/s2   ratio ${f(game / phys)}`);
}
if (process.argv.includes('--write')) fs.writeFileSync(new URL('../docs/calibration-output.txt', import.meta.url), out.join('\n') + '\n');
