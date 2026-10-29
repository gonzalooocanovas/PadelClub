import test from 'node:test';
import assert from 'node:assert/strict';
import { newAnim, stepAnim, animLabel, HOLD, RECOVERY } from '../client/js/anim-state.js';

const V = (o = {}) => ({ vx: 0, vz: 0, swingT: -1, kindName: 'forehand', jumpT: 0, ...o });
const run = (a, v, yaw, secs) => { for (let t = 0; t < secs; t += 1 / 60) stepAnim(a, v, yaw, 1 / 60); return a; };

test('standing still is idle, walking is walk, fast is run', () => {
  const a = newAnim();
  assert.equal(run(a, V(), 0, 0.5).state, 'idle');
  assert.equal(run(a, V({ vz: 1.2 }), 0, 0.5).state, 'walk');
  assert.equal(run(a, V({ vz: 5 }), 0, 0.5).state, 'run');
});

test('moving backwards and sideways use their own states, relative to the body direction', () => {
  const a = newAnim();
  assert.equal(run(a, V({ vz: -3 }), 0, 0.5).state, 'backward');
  assert.equal(run(a, V({ vx: 4 }), 0, 0.5).state, 'lateral');
  // the same world velocity is forward motion for a body that faces +x (yaw = pi/2)
  assert.equal(run(newAnim(), V({ vx: 5 }), Math.PI / 2, 0.5).state, 'run');
});

test('each shot kind is named and goes prep, swing, follow, then recovery, then idle', () => {
  const a = newAnim();
  const seen = [];
  for (let t = 0; t < 0.42; t += 1 / 60) { stepAnim(a, V({ swingT: t, kindName: 'smash' }), 0, 1 / 60); if (seen[seen.length - 1] !== animLabel(a)) seen.push(animLabel(a)); }
  assert.deepEqual(seen, ['prep:overhead', 'swing:overhead', 'follow:overhead']);
  stepAnim(a, V(), 0, 1 / 60);
  assert.equal(a.state, 'recovery');
  run(a, V(), 0, RECOVERY + 0.1);
  assert.equal(a.state, 'idle');
});

test('forehand and backhand are different states of the same controller', () => {
  const f = stepAnim(newAnim(), V({ swingT: 0.1, kindName: 'forehand' }), 0, 1 / 60);
  const b = stepAnim(newAnim(), V({ swingT: 0.1, kindName: 'backhand' }), 0, 1 / 60);
  assert.notEqual(animLabel(f), animLabel(b));
});

test('input jitter does not flicker the locomotion state', () => {
  const a = newAnim();
  run(a, V({ vz: 5 }), 0, 0.5);
  const before = a.changes;
  for (let i = 0; i < 20; i++) stepAnim(a, V({ vz: i % 2 ? 5 : 0.2 }), 0, 1 / 60); // alternates every frame for 1/3 s
  assert.ok(a.changes - before <= 2, `state changed ${a.changes - before} times`);
});

test('an interrupted swing (a new press) restarts cleanly and a jump overrides locomotion', () => {
  const a = newAnim();
  stepAnim(a, V({ swingT: 0.2, kindName: 'forehand' }), 0, 1 / 60);
  stepAnim(a, V({ swingT: 0.0, kindName: 'backhand' }), 0, 1 / 60);
  assert.equal(animLabel(a), 'prep:backhand');
  stepAnim(a, V({ jumpT: 0.3 }), 0, 1 / 60);
  assert.equal(a.state, 'jump');
});

test('a sharp reversal at speed is a direction change', () => {
  const a = newAnim();
  run(a, V({ vx: 5 }), 0, 0.5);
  run(a, V({ vx: -5 }), 0, HOLD + 0.05);
  assert.ok(['turn', 'lateral'].includes(a.state));
  assert.ok(a.changes >= 1);
});
