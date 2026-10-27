import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS, SCHEMES, defaultSettings, applyScheme, sanitizeSettings, loadSettings, saveSettings,
  findConflict, rebind, resetBindings, shapeStick, readPad, codeLabel, InputManager,
} from '../client/js/input.js';

const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), raw: m }; };
const btn = (pressed) => ({ pressed, value: pressed ? 1 : 0 });
const pad = (over = {}) => ({ axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => btn(false)), ...over });

test('defaults bind every action on both devices and there are no accidental duplicates on the keyboard', () => {
  const s = defaultSettings();
  for (const dev of ['keyboard', 'pad']) for (const a of ACTIONS) assert.ok(s.bindings[dev][a].length >= 1, `${dev}:${a}`);
  const seen = new Map();
  for (const a of ACTIONS) for (const c of s.bindings.keyboard[a]) {
    assert.ok(!seen.has(c), `${c} used by both ${seen.get(c)} and ${a}`);
    seen.set(c, a);
  }
  assert.ok(s.bindings.keyboard.hit.includes('Space') && s.bindings.keyboard.lob.includes('KeyG'));
});

test('schemes: classic has no mouse aiming, mouse scheme has it, switching restores that scheme\'s bindings', () => {
  const s = defaultSettings();
  assert.equal(s.mouseAim, false);
  applyScheme(s, 'mouse');
  assert.equal(s.mouseAim, true); assert.equal(s.scheme, 'mouse');
  rebind(s, 'keyboard', 'slice', 'KeyF');
  assert.equal(s.scheme, 'custom');
  applyScheme(s, 'classic');
  assert.deepEqual(s.bindings.keyboard.slice, ['KeyR']);
  applyScheme(s, 'nonsense');
  assert.equal(s.scheme, 'classic', 'unknown scheme ignored');
});

test('rebinding actually changes the binding, and duplicates are detected and resolved by swapping', () => {
  const s = defaultSettings();
  assert.equal(findConflict(s, 'keyboard', 'slice', 'KeyQ'), 'soft');
  assert.equal(findConflict(s, 'keyboard', 'slice', 'KeyZ'), null);
  let r = rebind(s, 'keyboard', 'slice', 'KeyZ');
  assert.deepEqual(r, {});
  assert.deepEqual(s.bindings.keyboard.slice, ['KeyZ']);
  r = rebind(s, 'keyboard', 'slice', 'KeyQ'); // Q belongs to "soft": swap
  assert.equal(r.swappedWith, 'soft');
  assert.equal(s.bindings.keyboard.slice[0], 'KeyQ');
  assert.ok(s.bindings.keyboard.soft.includes('KeyZ'), 'the other action received the old binding');
  assert.equal(findConflict(s, 'keyboard', 'soft', 'KeyQ'), 'slice');
  // pad bindings are separate from keyboard bindings
  rebind(s, 'pad', 'hit', 5);
  assert.equal(s.bindings.pad.hit[0], 5);
  assert.equal(s.bindings.pad.jump.includes(5), false);
  assert.deepEqual(s.bindings.keyboard.hit, defaultSettings().bindings.keyboard.hit, 'keyboard untouched');
});

test('mouse buttons can be bound like keys', () => {
  const s = defaultSettings();
  rebind(s, 'keyboard', 'slice', 'Mouse1');
  assert.deepEqual(s.bindings.keyboard.slice, ['Mouse1']);
  assert.equal(codeLabel('keyboard', 'Mouse1'), 'Mouse M');
  assert.equal(codeLabel('pad', 0), 'A');
  assert.equal(codeLabel('keyboard', 'KeyW'), 'W');
});

test('settings persist across reloads, and corrupt or hostile storage falls back safely', () => {
  const st = memStore();
  const s = defaultSettings();
  rebind(s, 'keyboard', 'jump', 'KeyV');
  s.deadzone = 0.3; s.toggleSprint = true; s.mouseAim = true;
  assert.equal(saveSettings(st, s), true);
  const back = loadSettings(st);
  assert.equal(back.bindings.keyboard.jump[0], 'KeyV');
  assert.equal(back.deadzone, 0.3); assert.equal(back.toggleSprint, true); assert.equal(back.mouseAim, true);
  assert.equal(back.scheme, 'custom');

  st.raw.set('padel.input', '{not json');
  assert.deepEqual(loadSettings(st), defaultSettings());
  const hostile = sanitizeSettings({ scheme: 'x', deadzone: 99, curve: -5, bindings: { keyboard: { hit: 'Space', lob: [1, 2, 3], jump: ['A'.repeat(50)] }, pad: { hit: ['a'], lob: [99] } }, mouseAim: 'yes' });
  assert.equal(hit(hostile), 'Space', 'invalid keyboard bindings fall back to defaults');
  assert.deepEqual(hostile.bindings.pad.hit, [0]);
  assert.deepEqual(hostile.bindings.pad.lob, [1]);
  assert.ok(hostile.deadzone <= 0.6 && hostile.curve >= 0.6);
  assert.equal(typeof hostile.mouseAim, 'boolean');
  function hit(x) { return x.bindings.keyboard.hit[0]; }
});

test('gamepad: dead zone, response curve, button mapping and remapped buttons', () => {
  const s = defaultSettings();
  assert.deepEqual(shapeStick(0.1, 0.1, 0.18, 1.4), { x: 0, y: 0 }, 'inside the dead zone');
  const full = shapeStick(1, 0, 0.18, 1.4);
  assert.ok(Math.abs(full.x - 1) < 1e-9);
  const half = shapeStick(0.59, 0, 0.18, 2);
  assert.ok(half.x > 0 && half.x < 0.3, 'curve keeps small tilts precise');

  const r = readPad(pad({ axes: [1, -1, 0.9, 0], buttons: Object.assign(pad().buttons, { 0: btn(true), 7: btn(true) }) }), s);
  assert.ok(r.move.x > 0.6 && r.move.y > 0.6, 'stick up is forward (screen y flipped), diagonal normalised');
  assert.ok(r.aim.x > 0.5 && Math.abs(r.aim.y) < 1e-9);
  assert.ok(r.down.has('hit') && r.down.has('sprint') && !r.down.has('lob'));

  rebind(s, 'pad', 'lob', 0); // A now lobs
  const r2 = readPad(pad({ buttons: Object.assign(pad().buttons, { 0: btn(true) }) }), s);
  assert.ok(r2.down.has('lob') && !r2.down.has('hit'));
});

test('input manager: events, held state, toggle sprint, capture cancel with Escape, device switching', () => {
  const st = memStore();
  const im = new InputManager(st);
  const fired = [];
  im.on('hit', () => fired.push('hit')); im.on('pause', () => fired.push('pause'));
  // simulate what the DOM handlers do
  for (const a of im.actionsFor('keyboard', 'Space')) im.press(a);
  for (const a of im.actionsFor('keyboard', 'Escape')) im.press(a);
  assert.deepEqual(fired, ['hit', 'pause']);

  im.down.add('KeyD'); im.down.add('KeyW');
  const ax = im.axes();
  assert.ok(ax.x > 0 && ax.y > 0 && Math.hypot(ax.x, ax.y) <= 1 + 1e-9);
  im.down.clear();

  im.settings.toggleSprint = true;
  assert.equal(im.actionDown('sprint'), false);
  im.press('sprint'); assert.equal(im.actionDown('sprint'), true);
  im.press('sprint'); assert.equal(im.actionDown('sprint'), false);

  let got = null;
  im.capture((d, c) => { got = [d, c]; }, 'keyboard');
  im.finishCapture('keyboard', 'Escape'); // cancelled, nothing bound
  assert.equal(got, null); assert.equal(im.captureCb, null);
  im.capture((d, c) => { got = [d, c]; }, 'pad');
  im.finishCapture('keyboard', 'KeyP'); // wrong device for this tab: keeps waiting
  assert.equal(got, null);
  im.finishCapture('pad', 3);
  assert.deepEqual(got, ['pad', 3]);

  im.padStick = { move: { x: -0.5, y: 0.5 }, aim: { x: 0.8, y: 0 } };
  assert.ok(im.axes().x < 0, 'analog movement is read');
  assert.equal(im.aimStick().active, true);
  im.settings.stickAim = false;
  assert.equal(im.aimStick().active, false, 'stick aiming can be switched off');
  assert.ok(Object.keys(SCHEMES).length >= 4);
});
