import test from 'node:test';
import assert from 'node:assert/strict';
import { PadelGame } from '../shared/game.js';
import { stepBall, makeBall } from '../shared/physics.js';
import { botInput, makeBotMemory } from '../shared/ai.js';

const DT = 1 / 60;
const fixedRng = () => 0.5; // zero aiming error

function rallyGame(over = {}) {
  const g = new PadelGame({ rng: fixedRng, settings: { sets: 3 } });
  g.drainEvents();
  g.phase = 'rally';
  g.rally = { serving: false, faults: 0, lastTeam: 0, lastSlot: 0, bounces: 0, hits: 3, netTouched: false, serveXSign: 1, ...over.rally };
  Object.assign(g.ball, { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0 }, over.ball);
  return g;
}
function runUntilPoint(g, seconds = 8) {
  const out = [];
  for (let i = 0; i < seconds * 60; i++) {
    g.tick(DT);
    const evs = g.drainEvents();
    out.push(...evs);
    if (evs.some((e) => e.e === 'point')) break;
  }
  return out;
}
const pointOf = (evs) => evs.find((e) => e.e === 'point');

test('ball bounces on the floor with energy loss and never goes through it', () => {
  const b = makeBall(); b.y = 2;
  const ev = [];
  let maxAfterBounce = 0, bounced = false;
  for (let i = 0; i < 300; i++) {
    stepBall(b, DT, ev);
    assert.ok(b.y >= 0);
    if (ev.some((e) => e.type === 'floor')) bounced = true;
    if (bounced) maxAfterBounce = Math.max(maxAfterBounce, b.y);
  }
  assert.ok(bounced);
  assert.ok(maxAfterBounce < 2 && maxAfterBounce > 0.5, `rebound ${maxAfterBounce}`);
});

test('glass rebounds reflect velocity with loss', () => {
  const b = makeBall(); Object.assign(b, { x: 4.9, y: 1.5, z: 0, vx: 10, vy: 0, vz: 0 });
  const ev = [];
  for (let i = 0; i < 10; i++) stepBall(b, DT, ev);
  assert.ok(ev.some((e) => e.type === 'wall' && e.axis === 'x'));
  assert.ok(b.vx < 0 && b.vx > -10);
});

test('ball landing on the hitter own side loses the point', () => {
  const g = rallyGame({ ball: { x: 1, y: 1, z: -4 }, rally: { lastTeam: 0 } });
  const p = pointOf(runUntilPoint(g));
  assert.equal(p.winner, 1);
  assert.equal(p.reason, 'own-side');
});

test('second bounce on the receiving side wins the point for the hitter', () => {
  const g = rallyGame({ ball: { x: 1, y: 1, z: 4 }, rally: { lastTeam: 0 } });
  const p = pointOf(runUntilPoint(g));
  assert.equal(p.winner, 0);
  assert.equal(p.reason, 'bounce');
});

test('hitting the glass before bouncing is out', () => {
  const g = rallyGame({ ball: { x: 0, y: 2.5, z: 9, vz: 12 }, rally: { lastTeam: 0 } });
  const p = pointOf(runUntilPoint(g));
  assert.equal(p.winner, 1);
  assert.equal(p.reason, 'out');
});

test('a wall rebound AFTER the first bounce keeps the rally alive', () => {
  const g = rallyGame({ ball: { x: 0, y: 1.2, z: 5.5, vz: 9, vy: -3 }, rally: { lastTeam: 0 } });
  const evs = runUntilPoint(g);
  const wallAt = evs.findIndex((e) => e.e === 'ball' && e.k === 'wall');
  const p = pointOf(evs);
  assert.ok(wallAt >= 0, 'ball reached the glass');
  assert.ok(evs.indexOf(p) > wallAt, 'point only after the wall rebound');
  // legal: the glass is not out. It ends on the second floor bounce, won by the hitter.
  assert.equal(p.reason, 'bounce');
  assert.equal(p.winner, 0);
});

test('ball over the fence is out (before bounce: hitter loses; after: hitter wins)', () => {
  let g = rallyGame({ ball: { x: 4.8, y: 3.9, z: 3, vx: 6, vy: 4 }, rally: { lastTeam: 0, bounces: 0 } });
  let p = pointOf(runUntilPoint(g));
  assert.equal(p.winner, 1);
  g = rallyGame({ ball: { x: 4.8, y: 3.9, z: 3, vx: 6, vy: 4 }, rally: { lastTeam: 0, bounces: 1 } });
  p = pointOf(runUntilPoint(g));
  assert.equal(p.winner, 0);
});

test('ball hitting the net and dropping back is a net error', () => {
  const g = rallyGame({ ball: { x: 0, y: 0.6, z: -1.5, vz: 8 }, rally: { lastTeam: 0 } });
  const evs = runUntilPoint(g);
  assert.ok(evs.some((e) => e.e === 'ball' && e.k === 'net'));
  const p = pointOf(evs);
  assert.equal(p.winner, 1);
  assert.equal(p.reason, 'net');
});

test('two serve faults are a double fault', () => {
  const g = new PadelGame({ rng: fixedRng });
  g.drainEvents();
  const server = g.serverSlot;
  const team = server >> 1;
  const os = team === 0 ? 1 : -1;
  const drop = () => { // ball lands on the wrong half of the court
    g.phase = 'rally';
    Object.assign(g.ball, { x: g.rally.serveXSign * 2, y: 1, z: os * 4, vx: 0, vy: 0, vz: 0 });
  };
  drop();
  let evs = [];
  for (let i = 0; i < 90; i++) { g.tick(DT); evs.push(...g.drainEvents()); }
  assert.ok(evs.some((e) => e.e === 'fault' && e.n === 1), 'first fault');
  assert.equal(g.phase, 'serve');
  drop();
  evs = [];
  for (let i = 0; i < 90; i++) { g.tick(DT); evs.push(...g.drainEvents()); }
  const p = pointOf(evs);
  assert.equal(p.reason, 'double-fault');
  assert.equal(p.winner, 1 - team);
});

test('a real serve lands in the diagonal box and the receivers must play it', () => {
  const g = new PadelGame({ rng: fixedRng });
  g.drainEvents();
  const s = g.serverSlot;
  for (let i = 0; i < 80; i++) g.tick(DT); // serve wait elapsed
  const os = (s >> 1) === 0 ? 1 : -1;
  g.applyInput(s, { swing: true, ax: -g.rally.serveXSign * 2.5, az: os * 5 });
  const evs = [];
  for (let i = 0; i < 90; i++) { g.tick(DT); evs.push(...g.drainEvents()); }
  assert.ok(evs.some((e) => e.e === 'hit' && e.kind === 'serve'));
  assert.ok(!evs.some((e) => e.e === 'fault'));
  assert.equal(g.rally.serving, false);
  assert.equal(g.rally.bounces, 1);
});

test('unreturned serve is an ace for the server', () => {
  const g = new PadelGame({ rng: fixedRng });
  g.drainEvents();
  const s = g.serverSlot;
  for (let i = 0; i < 80; i++) g.tick(DT);
  const os = (s >> 1) === 0 ? 1 : -1;
  g.applyInput(s, { swing: true, ax: -g.rally.serveXSign * 2.5, az: os * 5 });
  const p = pointOf(runUntilPoint(g, 10));
  assert.equal(p.winner, s >> 1);
  assert.equal(g.stats.players[s].aces, 1);
});

test('a player hits an incoming ball, and the same team cannot hit twice in a row', () => {
  const g = rallyGame({ ball: { x: 0.3, y: 1.1, z: 5.5, vz: -3, vy: 0 }, rally: { lastTeam: 0 } });
  Object.assign(g.players[2], { x: 0, z: 5 });
  g.applyInput(2, { swing: true, ax: 1, az: -6 });
  const evs = [];
  for (let i = 0; i < 30; i++) { g.tick(DT); evs.push(...g.drainEvents()); }
  const hit = evs.find((e) => e.e === 'hit');
  assert.ok(hit, 'hit registered');
  assert.equal(hit.slot, 2);
  assert.equal(g.rally.lastTeam, 1);
  // the partner may not return their own team's shot
  Object.assign(g.players[3], { x: 0, z: 3 });
  Object.assign(g.ball, { x: 0, y: 1, z: 3.5, vx: 0, vy: 0, vz: 0 });
  g.applyInput(3, { swing: true, ax: 0, az: -6 });
  const evs2 = [];
  for (let i = 0; i < 20; i++) { g.tick(DT); evs2.push(...g.drainEvents()); }
  assert.ok(!evs2.some((e) => e.e === 'hit'));
});

test('players cannot cross the net', () => {
  const g = rallyGame();
  g.applyInput(0, { mz: 1 });
  for (let i = 0; i < 240; i++) g.tick(DT);
  assert.ok(g.players[0].z < 0);
});

test('simulation is deterministic for identical inputs and rng', () => {
  const run = () => {
    let s = 12345;
    const rng = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
    const g = new PadelGame({ rng });
    const mem = [0, 1, 2, 3].map(makeBotMemory);
    for (let i = 0; i < 60 * 25; i++) {
      for (let k = 0; k < 4; k++) g.applyInput(k, botInput(g, k, mem[k], 'normal'));
      g.tick(DT);
    }
    return JSON.stringify([g.snapshot(), g.match.totalPoints]);
  };
  assert.equal(run(), run());
});

test('bots play a full short match to completion with valid scoring', () => {
  const g = new PadelGame({ settings: { sets: 1, gamesPerSet: 2 } });
  const mem = [0, 1, 2, 3].map(makeBotMemory);
  let ended = null;
  for (let i = 0; i < 60 * 60 * 25 && !ended; i++) {
    for (let k = 0; k < 4; k++) g.applyInput(k, botInput(g, k, mem[k], 'hard'));
    g.tick(DT);
    ended = g.drainEvents().find((e) => e.e === 'match');
  }
  assert.ok(ended, 'match finished');
  assert.equal(g.phase, 'ended');
  const r = ended.results;
  assert.ok(r.teamPoints[0] + r.teamPoints[1] >= 5);
  assert.equal(r.winner, g.match.winner);
});

test('before the serve is hit: receivers stand still and the server stays behind the service line', () => {
  const g = new PadelGame({ rng: fixedRng });
  g.drainEvents();
  const s = g.serverSlot;
  const os = (s >> 1) === 0 ? 1 : -1;
  for (const i of [0, 1, 2, 3]) g.applyInput(i, { mx: 1, mz: (i >> 1) === (s >> 1) ? os : -os }); // everyone charges the net
  const others = [0, 1, 2, 3].filter((i) => i !== s);
  const before = others.map((i) => [g.players[i].x, g.players[i].z]);
  for (let k = 0; k < 240; k++) g.tick(DT);
  assert.equal(g.phase, 'serve');
  others.forEach((i, j) => assert.deepEqual([g.players[i].x, g.players[i].z], before[j]));
  assert.ok(Math.abs(g.players[s].z) >= 6.95, 'server never crosses the service line');
});

test('steering decides the shot at contact: hold left/right/forward/back while hitting', () => {
  const land = (steerInput) => {
    const g = new PadelGame({ rng: fixedRng });
    g.drainEvents();
    g.phase = 'rally';
    g.rally = { serving: false, faults: 0, lastTeam: 0, lastSlot: 0, bounces: 1, hits: 3, netTouched: false, serveXSign: 1 };
    Object.assign(g.ball, { x: 0, y: 1.0, z: 5.5, vx: 0, vy: 0, vz: -2, sb: 0, ss: 0 });
    Object.assign(g.players[2], { x: 0, z: 5 });
    g.applyInput(2, { swing: true, steer: true, ax: 0, az: -6, ...steerInput });
    for (let i = 0; i < 40; i++) g.tick(DT);
    return { vx: g.ball.vx, vz: g.ball.vz };
  };
  assert.ok(land({ mx: 1 }).vx > 1, 'holding +x sends it to +x');
  assert.ok(land({ mx: -1 }).vx < -1, 'holding -x sends it to -x');
  const deep = land({ mz: -1 }), short = land({ mz: 1 });
  assert.ok(Math.abs(deep.vz) > Math.abs(short.vz), 'forward = deeper (faster away) than back = short');
});

test('the player is planted while swinging', () => {
  const g = rallyGame({ ball: { x: 0, y: 3, z: -9, vz: 0 }, rally: { lastTeam: 1 } });
  Object.assign(g.players[0], { x: 0, z: -3 });
  g.applyInput(0, { mx: 1, mz: 0, swing: true });
  for (let i = 0; i < 20; i++) g.tick(DT);
  const planted = g.players[0].x;
  const g2 = rallyGame({ ball: { x: 0, y: 3, z: -9, vz: 0 }, rally: { lastTeam: 1 } });
  Object.assign(g2.players[0], { x: 0, z: -3 });
  g2.applyInput(0, { mx: 1, mz: 0 });
  for (let i = 0; i < 20; i++) g2.tick(DT);
  assert.ok(planted < g2.players[0].x * 0.6, `planted ${planted} vs free ${g2.players[0].x}`);
});

test('serve: the ball is bounced by hand, and R/Q choose a slice or kick serve', () => {
  const g = new PadelGame({ rng: fixedRng });
  g.drainEvents();
  const ys = [];
  for (let i = 0; i < 90; i++) { g.tick(DT); ys.push(g.ball.y); }
  assert.ok(Math.max(...ys) > 0.8 && Math.min(...ys) < 0.3, 'ball bounces between hand and floor');
  const serve = (mod) => {
    const h = new PadelGame({ rng: fixedRng });
    h.drainEvents();
    for (let i = 0; i < 80; i++) h.tick(DT);
    const s = h.serverSlot, os = (s >> 1) === 0 ? 1 : -1;
    h.applyInput(s, { swing: true, mod, ax: -h.rally.serveXSign * 2.5, az: os * 5 });
    for (let i = 0; i < 40; i++) h.tick(DT);
    return h;
  };
  assert.ok(serve(3).ball.sb > serve(0).ball.sb, 'slice serve has more backspin');
  assert.ok(serve(1).ball.sb < 0, 'kick serve has topspin');
});
