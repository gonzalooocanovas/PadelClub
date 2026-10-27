// All sounds are synthesised with WebAudio, so the game ships with no audio assets.
import { settings } from './settings.js';

export class Sound {
  constructor() {
    this.ctx = null;
    this.ambience = null;
  }

  /** Must be called from a user gesture before anything is audible. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.noiseBuf = this.makeNoise();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.applyVolume();
  }

  applyVolume() {
    if (!this.ctx) return;
    this.master.gain.value = settings.master;
    if (this.ambience) this.ambience.gain.value = settings.ambience * 0.25;
  }

  makeNoise() {
    const len = this.ctx.sampleRate * 1.5;
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  startAmbience() {
    if (!this.ctx || this.ambience) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const g = this.ctx.createGain(); g.gain.value = settings.ambience * 0.25;
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    this.ambience = g; this.ambSrc = src;
  }

  stopAmbience() {
    try { this.ambSrc?.stop(); } catch { /* already stopped */ }
    this.ambience = null; this.ambSrc = null;
  }

  tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0, pan = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const out = this.pan(pan);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }

  burst(freq, q, dur, { vol = 0.4, type = 'bandpass', delay = 0, pan = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.pan(pan));
    s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  pan(p) {
    if (!this.ctx.createStereoPanner) return this.master;
    const n = this.ctx.createStereoPanner();
    n.pan.value = Math.max(-1, Math.min(1, p));
    n.connect(this.master);
    return n;
  }

  play(name, { pan = 0, power = 1 } = {}) {
    if (!this.ctx) return;
    switch (name) {
      case 'hit':
        this.burst(2100, 1.2, 0.07, { vol: 0.5 * power, pan });
        this.tone(330, 0.09, { vol: 0.35 * power, slide: -120, pan });
        break;
      case 'smash':
        this.burst(1600, 0.9, 0.12, { vol: 0.8, pan });
        this.tone(220, 0.14, { vol: 0.5, slide: -100, pan });
        break;
      case 'floor':
        this.tone(150 + 60 * power, 0.09, { vol: 0.35 * power, slide: -60, pan });
        this.burst(500, 0.6, 0.05, { vol: 0.15, pan });
        break;
      case 'wall':
        this.burst(3600, 2, 0.09, { vol: 0.35 * power, pan, type: 'highpass' });
        this.tone(980, 0.12, { vol: 0.12 * power, type: 'triangle', pan });
        break;
      case 'net':
        this.burst(260, 0.7, 0.14, { vol: 0.4, pan });
        break;
      case 'point':
        this.tone(660, 0.16, { type: 'triangle', vol: 0.25 });
        this.tone(880, 0.26, { type: 'triangle', vol: 0.25, delay: 0.12 });
        break;
      case 'fault':
        this.tone(190, 0.25, { type: 'sawtooth', vol: 0.18 });
        break;
      case 'game':
        [523, 659, 784].forEach((f, i) => this.tone(f, 0.28, { type: 'triangle', vol: 0.22, delay: i * 0.1 }));
        break;
      case 'match':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.45, { type: 'triangle', vol: 0.25, delay: i * 0.16 }));
        break;
      case 'ui':
        this.tone(520, 0.05, { vol: 0.15, type: 'triangle' });
        break;
      default:
    }
  }
}
