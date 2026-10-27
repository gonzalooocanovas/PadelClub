// Audio engine. Every sound is synthesised with the Web Audio API (no sample files are shipped), but it is layered and
// contextual: each shot type has its own body, contact quality changes the character, glass and mesh sound different,
// every court has its own room (reverb) and ambience, and repeated sounds are varied and rate-limited.
// The context is only created after a user gesture (unlock()).
import { settings } from './settings.js';

// Per shot: bp = bright "pop" band (Hz, Q), body = low thump (Hz), len = pop length (s), dull = low-passed (bandeja/block)
const SHOTS = {
  forehand: { bp: 2000, q: 1.2, body: 300, len: 0.07, vol: 0.5 },
  backhand: { bp: 1800, q: 1.2, body: 280, len: 0.07, vol: 0.5 },
  volley: { bp: 2600, q: 1.5, body: 340, len: 0.045, vol: 0.45 },
  smash: { bp: 1400, q: 0.9, body: 170, len: 0.13, vol: 0.85, boom: true },
  bandeja: { bp: 1700, q: 1.0, body: 260, len: 0.08, vol: 0.45, dull: true },
  vibora: { bp: 2400, q: 1.1, body: 300, len: 0.08, vol: 0.62, whoosh: true },
  slice: { bp: 2200, q: 1.3, body: 330, len: 0.06, vol: 0.4, brush: true },
  serve: { bp: 1900, q: 1.1, body: 290, len: 0.07, vol: 0.5 },
  lob: { bp: 1500, q: 1.0, body: 250, len: 0.09, vol: 0.4, dull: true },
  chiquita: { bp: 1300, q: 0.9, body: 230, len: 0.06, vol: 0.32, dull: true },
  drop: { bp: 1200, q: 0.9, body: 220, len: 0.05, vol: 0.28, dull: true },
  block: { bp: 900, q: 0.8, body: 200, len: 0.05, vol: 0.38, dull: true },
};

// How each court sounds: reverb mix and the ambience layers
const ROOMS = {
  indoor: { wet: 0.22, decay: 1.8, amb: 'hall' },
  outdoor: { wet: 0.04, decay: 0.5, amb: 'outdoor' },
  night: { wet: 0.3, decay: 2.4, amb: 'crowd' },
};

const rr = (a, b) => a + Math.random() * (b - a);

export class Sound {
  constructor() {
    this.ctx = null;
    this.ambNodes = [];
    this.ambTimers = [];
    this.last = new Map();
    this.court = 'indoor';
    this.stepFlip = false;
  }

  /** Must be called from a user gesture before anything is audible. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain();
      const comp = c.createDynamicsCompressor();
      this.master.connect(comp).connect(c.destination);
      this.sfx = c.createGain(); this.sfx.connect(this.master);
      this.amb = c.createGain(); this.amb.connect(this.master);
      this.reverb = c.createConvolver();
      this.wet = c.createGain();
      this.sfx.connect(this.reverb); this.reverb.connect(this.wet); this.wet.connect(this.master);
      this.noiseBuf = this.makeNoise();
      this.setCourt(this.court);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.applyVolume();
  }

  applyVolume() {
    if (!this.ctx) return;
    this.master.gain.value = settings.master;
    this.sfx.gain.value = settings.sfx;
    this.amb.gain.value = settings.ambience;
  }

  makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  /** The room: a generated impulse response (decaying noise) whose length and mix depend on the court. */
  setCourt(id) {
    this.court = ROOMS[id] ? id : 'indoor';
    if (!this.ctx) return;
    const room = ROOMS[this.court];
    const len = Math.floor(this.ctx.sampleRate * room.decay);
    const ir = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.reverb.buffer = ir;
    this.wet.gain.value = room.wet;
  }

  // ------------------------------------------------------------------ ambience

  startAmbience(courtId) {
    if (!this.ctx) return;
    this.stopAmbience();
    this.setCourt(courtId || this.court);
    const c = this.ctx;
    const layer = (freq, q, type, gain, lfoHz = 0, lfoDepth = 0) => {
      const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = gain;
      src.connect(f).connect(g).connect(this.amb);
      src.start();
      this.ambNodes.push(src);
      if (lfoHz) {
        const lfo = c.createOscillator(); lfo.frequency.value = lfoHz;
        const d = c.createGain(); d.gain.value = lfoDepth;
        lfo.connect(d).connect(g.gain); lfo.start(); this.ambNodes.push(lfo);
      }
    };
    const kind = ROOMS[this.court].amb;
    if (kind === 'hall') { layer(200, 0.5, 'lowpass', 0.07); layer(520, 0.7, 'bandpass', 0.05, 0.13, 0.02); }
    if (kind === 'outdoor') {
      layer(420, 0.6, 'bandpass', 0.07, 0.11, 0.05); // wind swelling
      layer(1600, 0.4, 'highpass', 0.012);
      this.ambTimers.push(setInterval(() => this.bird(), 4500)); // birdsong now and then
    }
    if (kind === 'crowd') {
      layer(700, 0.6, 'bandpass', 0.13, 0.17, 0.05); // crowd murmur with slow swells
      layer(300, 0.5, 'lowpass', 0.06);
      layer(5200, 4, 'bandpass', 0.008, 7, 0.006); // night insects
    }
  }

  stopAmbience() {
    for (const n of this.ambNodes) { try { n.stop(); } catch { /* already stopped */ } }
    this.ambNodes = [];
    this.ambTimers.forEach(clearInterval);
    this.ambTimers = [];
  }

  bird() {
    if (!this.ctx || Math.random() < 0.4) return;
    const n = 2 + (Math.random() * 3 | 0), base = rr(2800, 4200);
    for (let i = 0; i < n; i++) this.tone(base * rr(0.9, 1.2), 0.07, { vol: 0.03, slide: rr(300, 900), delay: i * 0.1, bus: this.amb });
  }

  // ------------------------------------------------------------------ building blocks

  out(pan, bus) {
    const dest = bus || this.sfx;
    if (!this.ctx.createStereoPanner || !pan) return dest;
    const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(dest);
    return p;
  }

  tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0, pan = 0, bus = null } = {}) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out(pan, bus));
    o.start(t); o.stop(t + dur + 0.02);
  }

  burst(freq, q, dur, { vol = 0.4, type = 'bandpass', delay = 0, pan = 0, sweep = 0 } = {}) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, freq + sweep), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.out(pan));
    s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  gate(name, ms) {
    const now = performance.now();
    if (now - (this.last.get(name) || 0) < ms) return false;
    this.last.set(name, now);
    return true;
  }

  // ------------------------------------------------------------------ gameplay sounds

  /** A racket hit. o: {kind, label, power, pan}. Shot type picks the body, contact quality the character. */
  hit(o = {}) {
    const S = SHOTS[o.kind] || SHOTS.forehand;
    const pan = o.pan || 0;
    const v = S.vol * (o.power ?? 1) * rr(0.9, 1.1);
    const k = rr(0.94, 1.06); // pitch variation so rallies do not sound like a loop
    const bad = o.label === 'off-centre' || o.label === 'poor';
    const bp = S.bp * k * (bad ? 0.55 : 1);
    this.burst(bp, S.q, S.len * (bad ? 1.3 : 1), { vol: v, pan, type: S.dull ? 'lowpass' : 'bandpass' });
    this.tone(S.body * k, 0.1, { vol: v * 0.7, slide: -S.body * 0.4, pan });
    if (S.boom) this.tone(90, 0.22, { vol: v * 0.5, slide: -40, pan });
    if (S.whoosh) this.burst(1800, 0.7, 0.16, { vol: v * 0.3, pan, sweep: -1000, delay: -0.0 });
    if (S.brush) this.burst(4200, 1.5, 0.05, { vol: v * 0.3, pan, type: 'highpass' });
    if (bad) this.tone(700 * k, 0.09, { vol: v * 0.35, type: 'triangle', pan }); // hollow frame sound
    else if (o.label === 'perfect') this.tone(3400 * k, 0.05, { vol: v * 0.12, pan }); // clean, bright ring
  }

  play(name, o = {}) {
    if (!this.ctx) return;
    const { pan = 0, power = 1 } = o;
    switch (name) {
      case 'hit': if (this.gate('hit', 25)) this.hit(o); break;
      case 'smash': if (this.gate('hit', 25)) this.hit({ ...o, kind: 'smash' }); break;
      case 'floor':
        if (!this.gate('floor', 30)) break;
        this.tone(rr(135, 175) + 55 * power, 0.09, { vol: 0.35 * power, slide: -60, pan });
        this.burst(500, 0.6, 0.05, { vol: 0.15, pan });
        break;
      case 'wall': // glass rings, the mesh above 3 m rattles
        if (!this.gate('wall', 40)) break;
        if (o.mesh) { this.burst(2800, 0.8, 0.18, { vol: 0.28 * power, pan, type: 'highpass' }); this.tone(420, 0.1, { vol: 0.08, type: 'triangle', pan }); } else {
          this.burst(3600, 2, 0.09, { vol: 0.35 * power, pan, type: 'highpass' });
          this.tone(rr(900, 1050), 0.14, { vol: 0.12 * power, type: 'triangle', pan });
          this.tone(1800, 0.1, { vol: 0.05 * power, pan, delay: 0.01 });
        }
        break;
      case 'net': this.burst(260, 0.7, 0.14, { vol: 0.4, pan }); this.burst(3000, 1, 0.05, { vol: 0.08, pan, type: 'highpass' }); break;
      case 'step':
        if (!this.gate('step' + (o.i ?? 0), 90)) break;
        this.stepFlip = !this.stepFlip;
        this.burst((this.stepFlip ? 850 : 1000) * rr(0.9, 1.1), 0.7, 0.04, { vol: 0.07 * (o.power ?? 1) * Math.min(1.4, (o.speed || 4) / 5), pan, type: 'lowpass' });
        break;
      case 'skid': if (this.gate('skid' + (o.i ?? 0), 400)) this.burst(2600, 1.1, 0.12, { vol: 0.07 * (o.power ?? 1), pan, type: 'bandpass' }); break;
      case 'point': this.tone(660, 0.16, { type: 'triangle', vol: 0.25 }); this.tone(880, 0.26, { type: 'triangle', vol: 0.25, delay: 0.12 }); break;
      case 'lose': this.tone(330, 0.22, { type: 'triangle', vol: 0.18 }); this.tone(262, 0.3, { type: 'triangle', vol: 0.16, delay: 0.14 }); break;
      case 'fault': this.tone(190, 0.25, { type: 'sawtooth', vol: 0.18 }); break;
      case 'game': [523, 659, 784].forEach((f, i) => this.tone(f, 0.28, { type: 'triangle', vol: 0.22, delay: i * 0.1 })); break;
      case 'set': [523, 659, 784, 988].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.22, delay: i * 0.09 })); break;
      case 'matchpoint': this.tone(784, 0.12, { type: 'square', vol: 0.08 }); this.tone(988, 0.2, { type: 'square', vol: 0.08, delay: 0.14 }); break;
      case 'match': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.45, { type: 'triangle', vol: 0.25, delay: i * 0.16 })); break;
      case 'start': this.tone(440, 0.1, { type: 'triangle', vol: 0.2 }); this.tone(660, 0.18, { type: 'triangle', vol: 0.2, delay: 0.1 }); break;
      case 'ready': this.tone(600, 0.07, { type: 'triangle', vol: 0.15 }); this.tone(900, 0.1, { type: 'triangle', vol: 0.15, delay: 0.07 }); break;
      case 'progress': [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.2, delay: i * 0.08 })); break;
      case 'ui': this.tone(520, 0.05, { vol: 0.15, type: 'triangle' }); break;
      default:
    }
  }

  // ------------------------------------------------------------------ announcer (optional speech)

  announce(text) {
    if (!settings.announcer || !('speechSynthesis' in window) || !text) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.volume = Math.min(1, settings.voice * settings.master * 1.4);
      u.lang = 'en-GB'; u.rate = 1.05; u.pitch = 0.95;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* speech not available */ }
  }
}

/** "Fifteen, love", "Deuce", "Advantage": the score as a referee would call it, server first. */
export function scoreCallout(score, serverTeam) {
  const word = { 0: 'love', 15: 'fifteen', 30: 'thirty', 40: 'forty', AD: 'advantage' };
  if (score.label === 'Deuce') return 'Deuce';
  const [a, b] = score.points;
  const first = serverTeam === 1 ? b : a, second = serverTeam === 1 ? a : b;
  if (score.tiebreak) return `${first}, ${second}`;
  if (first === 'AD' || second === 'AD') return `Advantage ${first === 'AD' ? 'server' : 'receiver'}`;
  if (first === second) return `${word[first]} all`;
  return `${word[first]}, ${word[second]}`;
}
