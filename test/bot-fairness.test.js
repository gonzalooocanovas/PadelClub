import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PadelGame } from '../shared/game.js';
import { botInput, makeBotMemory } from '../shared/ai.js';
import { PLAYER } from '../shared/constants.js';
import { rng } from '../tools/lib/scenarios.js';

test('bots read no hidden information: the AI sources never touch other players\' inputs or pending swings', () => {
  for (const f of ['../shared/ai.js', '../shared/tactics.js']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/\.input\b/.test(src), `${f} does not read .input`);
    assert.ok(!/wantSwing|wantJump|\.queue|\.lastInput/.test(src), `${f} does not read pending intents`);
  }
});

test('bots do not tamper with the world: with the ball and every player frozen, deciding and moving throws nothing', () => {
  const g = new PadelGame({ rng: rng(5), settings: { mode: 'doubles' } });
  g.phase = 'rally';
  g.rally = { serving: false, faults: 0, lastTeam: 1, lastSlot: 2, bounces: 1, hits: 4, netTouched: false, serveXSign: 1, wallTouched: true };
  Object.assign(g.ball, { x: 1, y: 1, z: -7, vx: 1, vy: 0.5, vz: -4, hw: 5, fe: 0.85, ff: 0.86 });
  Object.assign(g.players[0], { x: 0.8, z: -7.4 });
  const mem = [0, 1, 2, 3].map(makeBotMemory);
  Object.freeze(g.ball);
  for (const p of g.players) Object.freeze(p);
  Object.freeze(g.rally);
  for (const lvl of ['easy', 'normal', 'hard', 'expert']) for (let k = 0; k < 4; k++) botInput(g, k, mem[k], lvl, 1 / 60); // would throw on any write
  assert.ok(true);
});

test('stamina binds the bots exactly as it binds people: an exhausted bot cannot sprint and runs slower', () => {
  const g = new PadelGame({ rng: rng(6), settings: { mode: 'doubles' } });
  g.phase = 'rally';
  g.rally = { serving: false, faults: 0, lastTeam: 1, lastSlot: 2, bounces: 0, hits: 4, netTouched: false, serveXSign: 1 };
  Object.assign(g.ball, { x: 4, y: 1, z: -2, vx: 0, vy: 0, vz: -3, hw: 5 });
  const p = g.players[0];
  Object.assign(p, { x: -4, z: -8, stamina: 0 });
  const mem = makeBotMemory();
  let sprintWanted = 0;
  for (let i = 0; i < 90; i++) {
    const inp = botInput(g, 0, mem, 'expert', 1 / 60);
    if (inp.sprint) sprintWanted++;
    g.applyInput(0, inp);
    p.stamina = Math.min(p.stamina, 5); // keep it exhausted
    g.tick(1 / 60); g.drainEvents();
  }
  assert.equal(sprintWanted, 0, 'it does not even ask to sprint');
  assert.ok(Math.hypot(p.vx, p.vz) <= PLAYER.RUN * 1.0 * (1 + 1e-6), 'and never exceeds the walking speed limit');
});

test('contact needs the ball inside the reach (a lunge covers at most 2.7 m): a swing at a ball 3.2 m away hits nothing', () => {
  const g = new PadelGame({ rng: rng(7), settings: { mode: 'doubles' } });
  g.phase = 'rally';
  g.rally = { serving: false, faults: 0, lastTeam: 1, lastSlot: 2, bounces: 1, hits: 4, netTouched: false, serveXSign: 1 };
  Object.assign(g.ball, { x: 0, y: 1, z: -6, vx: 0, vy: 0, vz: 0, hw: 5 });
  Object.assign(g.players[0], { x: 3.2, z: -6 });
  g.players[1].x = -4;
  g.startSwing(g.players[0], { ax: 0, az: 6, mod: 0, lob: false });
  let hit = null;
  for (let i = 0; i < 40; i++) { g.ball.x = 0; g.ball.z = -6; g.ball.y = 1; g.tick(1 / 60); hit = hit || g.drainEvents().find((e) => e.e === 'hit'); }
  assert.ok(!hit, 'no contact');
});

test('every bot level plays by the same movement and court limits (no teleporting, no speed above sprint)', () => {
  for (const lvl of ['easy', 'normal', 'hard', 'expert']) {
    const g = new PadelGame({ rng: rng(11), settings: { mode: 'doubles' } });
    const mem = [0, 1, 2, 3].map(makeBotMemory);
    let maxSpeed = 0, prev = g.players.map((p) => [p.x, p.z]);
    for (let i = 0; i < 60 * 40; i++) {
      for (let k = 0; k < 4; k++) g.applyInput(k, botInput(g, k, mem[k], lvl, 1 / 60));
      const live = g.phase === 'rally';
      g.tick(1 / 60); g.drainEvents();
      g.players.forEach((p, k) => { if (live && g.phase === 'rally' && p.active) { maxSpeed = Math.max(maxSpeed, Math.hypot(p.x - prev[k][0], p.z - prev[k][1]) * 60); } prev[k] = [p.x, p.z]; });
    }
    assert.ok(maxSpeed <= PLAYER.SPRINT * 1.1 + 4, `${lvl}: top speed ${maxSpeed.toFixed(1)} m/s (lunges included, point resets excluded)`);
  }
});
