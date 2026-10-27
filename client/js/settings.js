import { store } from './net.js';

const DEFAULTS = {
  quality: 'medium', // low | medium | high
  master: 0.7,
  ambience: 0.25,
  camDist: 7.2,
  camHeight: 4.6,
  ballScale: 3,
  timing: true,
  trail: true,
  hints: true,
  highContrast: false,
  invertAim: false,
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
