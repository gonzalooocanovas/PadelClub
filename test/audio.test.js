import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { soundsFor } from '../client/js/sound-map.js';

// ---- a minimal fake Web Audio, enough to run the real engine in Node
function fakeAudioContext() {
  const made = { gains: [], sources: [], started: 0, oscillators: 0 };
  const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = (extra = {}) => ({ connect(t) { return t || this; }, disconnect() {}, start() { made.started++; }, stop() {}, frequency: param(), Q: param(), detune: param(), gain: param(), playbackRate: param(), pan: param(), type: '', buffer: null, loop: false, ...extra });
  class AC {
    constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = node(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    createGain() { const g = node(); made.gains.push(g); return g; }
    createOscillator() { made.oscillators++; return node(); }
    createBiquadFilter() { return node(); }
    createBufferSource() { const s = node(); made.sources.push(s); return s; }
    createConvolver() { return node(); }
    createDynamicsCompressor() { return node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }); }
    createStereoPanner() { return node(); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len), length: len, numberOfChannels: ch }; }
    createDelay() { return node(); }
    createWaveShaper() { return node(); }
    createAnalyser() { return node(); }
  }
  return { AC, made };
}

async function loadEngine({ withAudio = true } = {}) {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  globalThis.document = { body: { classList: { toggle() {} } } };
  const fake = fakeAudioContext();
  globalThis.window = withAudio ? { AudioContext: fake.AC } : {};
  const { Sound } = await import('../client/js/audio.js');
  const { settings } = await import('../client/js/settings.js');
  return { Sound, settings, fake };
}

test('event-to-sound mapping: every authoritative event produces a fixed list, door exits are silent, unknown events are ignored', () => {
  assert.deepEqual(soundsFor({ e: 'hit', kind: 'smash', label: 'perfect', q: 1, x: 5 }).map((s) => s.name), ['hit']);
  assert.equal(soundsFor({ e: 'ball', k: 'wall', x: 5, y: 3.5, s: 12 })[0].opts.mesh, true, 'above 3 m it is the fence');
  assert.equal(soundsFor({ e: 'ball', k: 'wall', x: 5, y: 1, s: 12, mesh: false })[0].opts.mesh, false);
  assert.deepEqual(soundsFor({ e: 'ball', k: 'door' }), []);
  assert.deepEqual(soundsFor({ e: 'ball', k: 'floor', x: 0, s: 5 }).map((s) => s.name), ['floor']);
  assert.deepEqual(soundsFor({ e: 'fault' }).map((s) => s.name), ['fault']);
  assert.deepEqual(soundsFor({ e: 'point', winner: 0, marks: [] }, { team: 0 }).map((s) => s.name), ['point']);
  assert.deepEqual(soundsFor({ e: 'point', winner: 1, marks: [] }, { team: 0 }).map((s) => s.name), ['lose']);
  assert.deepEqual(soundsFor({ e: 'point', winner: 0, marks: [{ type: 'game' }, { type: 'set' }] }, { team: 0 }).map((s) => s.name), ['set']);
  assert.deepEqual(soundsFor({ e: 'match', winner: 0 }), []);
  const e = { e: 'hit', kind: 'forehand', label: 'clean', q: 0.9, x: 1 };
  assert.deepEqual(soundsFor(e), soundsFor({ ...e }), 'a pure function: the same event always gives the same sounds');
});

test('sounds come only from the server events: the replay and the prediction code never call the sound engine', () => {
  const src = fs.readFileSync(new URL('../client/js/game.js', import.meta.url), 'utf8');
  const replay = src.slice(src.indexOf('  playReplay(dt) {'), src.indexOf('  endReplay() {'));
  assert.ok(replay.length > 100 && !/sound\./.test(replay), 'no sound while a replay plays');
  const step = src.slice(src.indexOf('  stepMe(inp) {'), src.indexOf('  // ------------------------------------------------------------------ network in'));
  assert.ok(step.length > 50 && !/sound\./.test(step), 'no sound from client-side prediction');
});

test('without Web Audio the engine is silent and never throws', async () => {
  const { Sound } = await loadEngine({ withAudio: false });
  const s = new Sound();
  assert.doesNotThrow(() => { s.unlock(); s.play('hit', { kind: 'smash' }); s.play('floor'); s.announce('hello'); s.startAmbience('indoor'); s.stopAmbience(); s.startMusic('menu'); s.stopMusic(); s.applyVolume(); s.setCourt('night'); });
  assert.ok(!s.ctx, 'no context was created');
});

test('volumes are independent and a muted channel stays muted across scenes, courts, music and ambience restarts', async () => {
  const { Sound, settings } = await loadEngine();
  settings.master = 0.7; settings.sfx = 0.9; settings.ambience = 0; settings.music = 0; settings.voice = 0.8;
  const s = new Sound();
  s.unlock();
  assert.ok(s.ctx);
  assert.equal(s.master.gain.value, 0.7);
  assert.equal(s.sfx.gain.value, 0.9);
  assert.equal(s.amb.gain.value, 0, 'ambience muted');
  assert.equal(s.musicGain.gain.value, 0, 'music muted');
  for (const court of ['indoor', 'outdoor', 'night', 'rooftop']) { s.setCourt(court); s.startAmbience(court); s.startMusic('match'); s.startMusic('menu'); }
  s.applyVolume();
  assert.equal(s.amb.gain.value, 0, 'still muted after changing courts and restarting the ambience');
  assert.equal(s.musicGain.gain.value, 0, 'still muted after switching the music');
  settings.ambience = 0.5; settings.music = 0.35; s.applyVolume();
  assert.equal(s.amb.gain.value, 0.5);
  assert.ok(Math.abs(s.musicGain.gain.value - 0.35 * 0.6) < 1e-9);
  assert.equal(s.sfx.gain.value, 0.9, 'effects are not touched by the other sliders');
  s.stopMusic(); s.stopAmbience();
});

test('rate limiting: a burst of identical events does not stack unlimited sounds', async () => {
  const { Sound, fake } = await loadEngine();
  const s = new Sound();
  s.unlock();
  const before = fake.made.started;
  for (let i = 0; i < 200; i++) s.play('floor', { power: 1, pan: 0 });
  const started = fake.made.started - before;
  assert.ok(started < 40, `only ${started} sources started for 200 simultaneous floor events`);
});

test('every shot kind and every venue has a defined sound (no undefined lookup, no throw)', async () => {
  const { Sound } = await loadEngine();
  const s = new Sound();
  s.unlock();
  for (const kind of ['forehand', 'backhand', 'volley', 'smash', 'bandeja', 'vibora', 'slice', 'serve', 'lob', 'chiquita', 'drop', 'block']) {
    assert.doesNotThrow(() => s.play('hit', { kind, label: 'clean', pan: 0, power: 1 }), kind);
    assert.doesNotThrow(() => s.play('hit', { kind, label: 'poor', pan: 0.5, power: 0.75 }), kind + ' poor');
  }
  for (const court of ['indoor', 'outdoor', 'night', 'rooftop']) { assert.doesNotThrow(() => { s.setCourt(court); s.startAmbience(court); }, court); s.stopAmbience(); }
  for (const name of ['wall', 'floor', 'net', 'step', 'skid', 'point', 'lose', 'fault', 'game', 'set', 'matchpoint', 'match', 'start', 'ready', 'progress', 'ui']) assert.doesNotThrow(() => s.play(name, { mesh: true }), name);
});
