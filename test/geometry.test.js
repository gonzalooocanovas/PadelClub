import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stepBall, makeBall } from '../shared/physics.js';
import { PadelGame } from '../shared/game.js';
import { COURT, PHYS } from '../shared/constants.js';
import { rng, run } from '../tools/lib/scenarios.js';

const D = COURT.DOOR;
const doorMid = (D.z0 + D.z1) / 2;
const fresh = (o) => ({ ...makeBall(), doors: true, fe: PHYS.FLOOR_E, ff: PHYS.FLOOR_FRIC, ...o });

test('door boundary: a ball just inside the opening passes, just outside (sideways or above) is stopped by the glass', () => {
  const pass = (z, y) => { const b = fresh({ x: 4.5, y, z, vx: 8, vy: 0, vz: 0 }); const r = run(b, { maxT: 0.4 }); return r.log.some((e) => e.type === 'door'); };
  assert.equal(pass(D.z0 + 0.05, 1.0), true);
  assert.equal(pass(D.z1 - 0.05, 1.0), true);
  assert.equal(pass(D.z0 - 0.08, 1.0), false, 'just before the opening');
  assert.equal(pass(D.z1 + 0.08, 1.0), false, 'just after the opening');
  assert.equal(pass(doorMid, D.h - 0.1), true);
  assert.equal(pass(doorMid, D.h + 0.15), false, 'above the lintel');
  // mirror: the opposite side wall and the other half of the court
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const b = fresh({ x: sx * 4.5, y: 1, z: sz * doorMid, vx: sx * 8, vy: 0, vz: 0 });
    assert.ok(run(b, { maxT: 0.4 }).log.some((e) => e.type === 'door'), `door at x ${sx}, z ${sz}`);
  }
});

test('1v1 has no doors: the same shot bounces off solid glass', () => {
  const b = fresh({ x: 3.0, y: 1, z: doorMid, vx: 8, vy: 0, vz: 0, hw: 3.5, doors: false });
  const r = run(b, { maxT: 0.6 });
  assert.ok(r.log.some((e) => e.type === 'wall') && !r.log.some((e) => e.type === 'door'));
});

test('near the net post: outside the court the ball flies past the net; inside it is stopped by the net', () => {
  const cross = (x, ex) => { const b = fresh({ x, y: 0.5, z: -0.5, vx: 0, vy: 0, vz: 10, ex }); const r = run(b, { maxT: 0.3, dt: 1 / 240 }); return { crossed: b.z > 0.3, net: r.log.some((e) => e.type === 'net') }; };
  assert.deepEqual(cross(4.9, false), { crossed: false, net: true }, 'inside the court the net stops a low ball up to the post');
  assert.equal(cross(5.9, true).crossed, true, 'outside the glass the net does not exist: the ball goes round the post');
});

test('the strip is closed: a ball cannot leave it sideways, endways or through the court glass', () => {
  const r = rng(404);
  let bad = 0;
  for (let i = 0; i < 400; i++) {
    const b = fresh({ x: 5.2 + r() * 1.3, y: 0.3 + r() * 1.2, z: (r() < 0.5 ? -1 : 1) * (0.5 + r() * 8), vx: (r() - 0.5) * 40, vy: (r() - 0.5) * 8, vz: (r() - 0.5) * 40, ex: true });
    for (let t = 0; t < 4; t += 1 / 60) {
      const ev = []; stepBall(b, 1 / 60, ev);
      if (ev.some((e) => e.type === 'out')) break;
      if (!Number.isFinite(b.x + b.y + b.z)) { bad++; break; }
      // anywhere beyond the glass plane must be inside the strip (back inside the court is fine: the ball may come back in)
      const inStrip = Math.abs(b.x) > COURT.HALF_W + 0.06;
      const sideOk = !inStrip || (Math.abs(b.x) <= COURT.HALF_W + COURT.PIT.w + 1e-6 && Math.abs(b.z) <= COURT.PIT.z1 + 1e-6 && b.y >= 0);
      if (!sideOk) { bad++; break; }
    }
  }
  assert.equal(bad, 0);
});

test('1,000 seeded edge-case trajectories (doors, net, glass, fence, strip): finite, never through a closed wall, one point at most per rally', () => {
  const r = rng(2024);
  let nan = 0, wall = 0, dup = 0;
  for (let i = 0; i < 1000; i++) {
    const g = new PadelGame({ rng: rng(i + 1), settings: { mode: i % 7 === 0 ? 'singles' : 'doubles' } });
    g.phase = 'rally';
    g.rally = { serving: false, faults: 0, lastTeam: i % 2, lastSlot: (i % 2) * 2, bounces: i % 3 === 0 ? 0 : 1, hits: 3, netTouched: false, serveXSign: 1 };
    const nearDoor = i % 3 === 0;
    const hw = g.singles ? 3.5 : 5;
    Object.assign(g.ball, {
      x: nearDoor ? (r() < 0.5 ? -1 : 1) * (hw - 1.2 * r()) : (r() - 0.5) * 2 * (hw - 0.3),
      y: 0.2 + r() * 2.6,
      z: nearDoor ? (r() < 0.5 ? -1 : 1) * (D.z0 - 0.6 + r() * (D.z1 - D.z0 + 1.2)) : (r() - 0.5) * 19,
      vx: (r() - 0.5) * (nearDoor ? 24 : 40), vy: (r() - 0.5) * 16, vz: (r() - 0.5) * 40, sb: (r() - 0.5) * 30, ss: (r() - 0.5) * 20,
    });
    for (const p of g.players) { p.input = { mx: 0, mz: 0 }; }
    let points = 0;
    for (let t = 0; t < 6 * 60 && g.phase !== 'ended'; t++) {
      g.tick(1 / 60);
      const b = g.ball;
      if (!Number.isFinite(b.x + b.y + b.z + b.vx + b.vy + b.vz)) { nan++; break; }
      for (const e of g.drainEvents()) if (e.e === 'point') points++;
      // beyond the court glass is only legal in the strip (doubles) and only if the ball went through a door
      if (g.phase === 'rally' && b.y <= COURT.WALL_H && Math.abs(b.x) > hw + 0.06 && !(b.ex && !g.singles)) { wall++; break; }
      if (g.phase === 'point') break; // the rally is decided: later coasting does not matter
    }
    if (points > 1) dup++;
  }
  assert.equal(nan, 0, 'no NaN');
  assert.equal(wall, 0, 'no wall traversal');
  assert.equal(dup, 0, 'no duplicate point awards');
});

test('a complete off-court rally: the ball leaves through a door after a bounce, the player follows and returns it legally into the opponents\' court', async () => {
  const { botInput, makeBotMemory } = await import('../shared/ai.js');
  let returned = 0;
  for (let m = 0; m < 12; m++) {
    const g = new PadelGame({ rng: rng(m + 7), settings: { mode: 'doubles' } });
    const mem = [0, 1, 2, 3].map(makeBotMemory);
    g.phase = 'rally';
    g.rally = { serving: false, faults: 0, lastTeam: 1, lastSlot: 2, bounces: 1, hits: 3, netTouched: false, serveXSign: 1 };
    const side = m % 2 ? 1 : -1;
    Object.assign(g.ball, { x: 4.9 * side, y: 1.0, z: -doorMid, vx: 2.6 * side, vy: 1.0, vz: -0.3, ex: false });
    Object.assign(g.players[0], { x: -2, z: -6 }); Object.assign(g.players[1], { x: 1, z: -3 });
    Object.assign(g.players[2], { x: 0, z: 6 }); Object.assign(g.players[3], { x: 1, z: 2 });
    let door = false, outHit = false, landedLegal = false;
    for (let i = 0; i < 60 * 6 && g.phase === 'rally'; i++) {
      for (let k = 0; k < 4; k++) g.applyInput(k, botInput(g, k, mem[k], 'hard', 1 / 60));
      g.tick(1 / 60);
      for (const e of g.drainEvents()) {
        if (e.e === 'ball' && e.k === 'door') door = true;
        if (e.e === 'hit' && Math.abs(e.x) > 5) outHit = true;
        if (e.e === 'ball' && e.k === 'floor' && outHit && e.z > 0 && Math.abs(e.x) < 5) landedLegal = true;
      }
    }
    if (door && outHit && landedLegal) returned++;
  }
  assert.ok(returned >= 1, `at least one scripted bot executed a full legal off-court return (${returned}/12)`);
});

test('rendered geometry comes from the collision constants: the scene reads COURT.DOOR / COURT.PIT, with no door numbers of its own', () => {
  const src = fs.readFileSync(new URL('../client/js/scene.js', import.meta.url), 'utf8');
  assert.ok(/COURT\.DOOR/.test(src) && /COURT\.PIT/.test(src));
  assert.ok(!/dz0\s*=\s*[0-9]/.test(src) && !/dz1\s*=\s*[0-9]/.test(src), 'no literal door coordinates in the renderer');
});
