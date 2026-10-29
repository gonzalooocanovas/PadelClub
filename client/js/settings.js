import { store } from './net.js';

const DEFAULTS = {
  quality: 'medium', // low | medium | high
  master: 0.7,
  sfx: 0.9,
  ambience: 0.5,
  voice: 0.8,
  music: 0.35,
  announcer: false, // spoken score calls (uses the browser's speech synthesis)
  camera: 'player', // player | broadcast | tactical | custom
  camDist: 7.2,
  camHeight: 4.6,
  camSmooth: 7,
  camFov: 52,
  ballTrack: true, // the view drifts toward the ball (never changes how you move or aim)
  ballScale: 3,
  timing: true,
  replays: true, // instant replay after each point (solo matches)
  trail: true,
  hints: true,
  highContrast: false,
  invertAim: false,
  scannedModels: true, // use the owner's 3D character (client/models/source) for the agile archetype; off = the procedural athletes
};

let cur = { ...DEFAULTS };
try { cur = { ...DEFAULTS, ...JSON.parse(store.get('padel.settings', '{}')) }; } catch { /* keep defaults */ }
const listeners = [];

export const settings = cur;
export function setSetting(k, v) {
  cur[k] = v;
  store.set('padel.settings', JSON.stringify(cur));
  document.body.classList.toggle('hc', !!cur.highContrast);
  listeners.forEach((fn) => fn(k, v));
}
export function onSetting(fn) { listeners.push(fn); }
document.body.classList.toggle('hc', !!cur.highContrast);
