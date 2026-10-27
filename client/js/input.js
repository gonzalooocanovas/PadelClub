// Input layer: keyboard, mouse and gamepad become normalised gameplay ACTIONS.
// Nothing here touches the character, the ball or the network: the match client asks this module
// "is hit pressed?" and "where is the player steering?". The pure functions at the top (presets, rebinding,
// conflict detection, persistence, pad reading) have no DOM dependency so they are unit-tested in Node.

export const ACTIONS = ['up', 'down', 'left', 'right', 'hit', 'lob', 'slice', 'soft', 'control', 'sprint', 'jump', 'stats', 'pause'];

export const ACTION_LABELS = {
  up: 'Move up / aim deep', down: 'Move down / aim short', left: 'Move left', right: 'Move right',
  hit: 'Hit / serve', lob: 'Globo (lob)', slice: 'Slice', soft: 'Soft shot / víbora', control: 'Block / bandeja',
  sprint: 'Sprint', jump: 'Jump', stats: 'Match stats', pause: 'Pause menu',
};

const KEYBOARD = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  hit: ['Space', 'Mouse0'], lob: ['KeyG', 'Enter', 'Mouse2'], slice: ['KeyR'], soft: ['KeyQ'], control: ['KeyE'],
  sprint: ['ShiftLeft', 'ShiftRight'], jump: ['KeyX'], stats: ['Tab'], pause: ['Escape'],
};

// Standard-mapping gamepad: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start, 10 L3, 11 R3, 12-15 d-pad
const PAD = {
  up: [12], down: [13], left: [14], right: [15],
  hit: [0], lob: [1], slice: [2], soft: [3], control: [4], sprint: [7, 6], jump: [5], stats: [8], pause: [9],
};

export const SCHEMES = {
  classic: { label: 'Classic keyboard', mouseAim: false, hint: 'WASD / arrows move. Hold a direction as you hit to place the shot.' },
  mouse: { label: 'Keyboard + mouse aim', mouseAim: true, hint: 'WASD moves, the mouse aims (target ring on the court), click to hit.' },
  gamepad: { label: 'Gamepad', mouseAim: false, hint: 'Left stick moves, right stick (or the left stick) places the shot.' },
  custom: { label: 'Custom', mouseAim: false, hint: 'Your own bindings.' },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function defaultSettings() {
  return {
    v: 1, scheme: 'classic',
    bindings: { keyboard: clone(KEYBOARD), pad: clone(PAD) },
    mouseAim: false, deadzone: 0.18, curve: 1.4, toggleSprint: false, aimMarker: true, stickAim: true,
  };
}

/** Switch to a preset. 'custom' keeps whatever is currently bound. */
export function applyScheme(s, scheme) {
  if (!SCHEMES[scheme]) return s;
  s.scheme = scheme;
  s.mouseAim = SCHEMES[scheme].mouseAim;
  if (scheme !== 'custom') s.bindings = { keyboard: clone(KEYBOARD), pad: clone(PAD) };
  return s;
}

/** Validate anything read from storage: unknown shapes fall back to defaults, numbers are clamped. */
export function sanitizeSettings(raw) {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const out = { ...d };
  if (SCHEMES[raw.scheme]) out.scheme = raw.scheme;
  for (const dev of ['keyboard', 'pad']) {
    for (const a of ACTIONS) {
      const v = raw.bindings?.[dev]?.[a];
      if (Array.isArray(v) && v.every((c) => (dev === 'pad' ? Number.isInteger(c) && c >= 0 && c < 32 : typeof c === 'string' && c.length < 24))) out.bindings[dev][a] = v.slice(0, 4);
    }
  }
  out.mouseAim = typeof raw.mouseAim === 'boolean' ? raw.mouseAim : SCHEMES[out.scheme].mouseAim;
  out.deadzone = num(raw.deadzone, 0, 0.6, d.deadzone);
  out.curve = num(raw.curve, 0.6, 3, d.curve);
  out.toggleSprint = !!raw.toggleSprint;
  out.aimMarker = raw.aimMarker !== false;
  out.stickAim = raw.stickAim !== false;
  return out;
}

const KEY = 'padel.input';
export function loadSettings(storage) {
  try { return sanitizeSettings(JSON.parse(storage.getItem(KEY))); } catch { return defaultSettings(); }
}
export function saveSettings(storage, s) {
  try { storage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}

/** The other action already using `code` on this device, or null. */
export function findConflict(s, device, action, code) {
  for (const a of ACTIONS) if (a !== action && s.bindings[device][a].includes(code)) return a;
  return null;
}

/**
 * Bind `code` as the primary binding of `action`. If another action already uses it, the two swap:
 * the other action takes this action's previous primary binding. Returns {swappedWith} or {}.
 */
export function rebind(s, device, action, code) {
  const b = s.bindings[device];
  const old = b[action][0];
  const other = findConflict(s, device, action, code);
  let swappedWith = null;
  if (other) {
    b[other] = b[other].filter((c) => c !== code);
    if (old !== undefined && !b[other].includes(old)) b[other].unshift(old);
    swappedWith = other;
  }
  b[action] = [code, ...b[action].filter((c) => c !== code && c !== old)];
  s.scheme = 'custom';
  return swappedWith ? { swappedWith } : {};
}

export function resetBindings(s, device) {
  s.bindings[device] = clone(device === 'pad' ? PAD : KEYBOARD);
  s.scheme = 'custom';
  return s;
}

export const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', '↑', '↓', '←', '→', 'Home'];
export function codeLabel(device, code) {
  if (device === 'pad') return PAD_NAMES[code] ?? `Button ${code}`;
  if (code.startsWith('Mouse')) return ['Mouse L', 'Mouse M', 'Mouse R'][+code.slice(5)] ?? code;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'Shift L', ShiftRight: 'Shift R', ControlLeft: 'Ctrl L', Space: 'Space' }[code] || code;
}

/** Radial dead zone with a response curve: small stick movements stay precise, full tilt reaches 1. */
export function shapeStick(x, y, deadzone, curve) {
  const mag = Math.hypot(x, y);
  if (mag <= deadzone) return { x: 0, y: 0 };
  const m = Math.min(1, (mag - deadzone) / (1 - deadzone));
  const k = Math.pow(m, curve) / mag;
  return { x: x * k, y: y * k };
}

/**
 * Read a gamepad-like object ({axes, buttons}) into actions. Axis y is screen-down positive, so it is flipped:
 * the result uses x = right, y = up/forward.
 */
export function readPad(pad, s) {
  const axis = (i) => pad.axes?.[i] ?? 0;
  const L = shapeStick(axis(0), -axis(1), s.deadzone, s.curve);
  const R = shapeStick(axis(2), -axis(3), s.deadzone, s.curve);
  const down = new Set();
  const b = s.bindings.pad;
  for (const a of ACTIONS) {
    if (b[a].some((i) => pad.buttons?.[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5))) down.add(a);
  }
  const pressedButtons = new Set();
  (pad.buttons || []).forEach((btn, i) => { if (btn && (btn.pressed || btn.value > 0.5)) pressedButtons.add(i); });
  return { move: L, aim: R, down, pressedButtons };
}

// ===================================================================== DOM manager

const EDGE_ACTIONS = ['hit', 'lob', 'slice', 'soft', 'control', 'jump', 'stats', 'pause'];

export class InputManager {
  constructor(storage) {
    this.storage = storage;
    this.settings = loadSettings(storage);
    this.down = new Set(); // keyboard codes and Mouse0..2
    this.padDown = new Set(); // actions currently held on the gamepad
    this.padButtons = new Set();
    this.padStick = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 } };
    this.padName = null;
    this.mouse = { x: 0, y: 0, moved: false };
    this.handlers = new Map();
    this.sprintOn = false;
    this.gameActive = false;
    this.captureCb = null;
    this.lastDevice = 'keyboard';
  }

  save() { saveSettings(this.storage, this.settings); }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
    return () => this.handlers.get(event).delete(fn);
  }

  emit(event, arg) { for (const fn of this.handlers.get(event) || []) fn(arg); }

  actionsFor(device, code) {
    const out = [];
    for (const a of ACTIONS) if (this.settings.bindings[device][a].includes(code)) out.push(a);
    return out;
  }

  press(action) {
    if (action === 'sprint' && this.settings.toggleSprint) this.sprintOn = !this.sprintOn;
    if (EDGE_ACTIONS.includes(action)) this.emit(action);
  }

  attach(win = window) {
    const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    this.onKeyDown = (e) => {
      if (this.captureCb) { e.preventDefault(); this.finishCapture('keyboard', e.code); return; }
      if (typing()) return;
      if (/^Digit[1-4]$/.test(e.code) && this.gameActive && !e.repeat) { this.emit('chat', +e.code.slice(5) - 1); return; }
      const acts = this.actionsFor('keyboard', e.code);
      if (acts.length && this.gameActive) e.preventDefault();
      if (e.repeat) return;
      this.lastDevice = 'keyboard';
      this.down.add(e.code);
      for (const a of acts) this.press(a);
    };
    this.onKeyUp = (e) => {
      this.down.delete(e.code);
      for (const a of this.actionsFor('keyboard', e.code)) if (a === 'stats') this.emit('statsUp');
    };
    this.onPointerDown = (e) => {
      const code = `Mouse${e.button}`;
      if (this.captureCb) { if (e.target.closest?.('#modal')) { e.preventDefault(); this.finishCapture('keyboard', code); } return; }
      if (e.target?.id !== 'gl') return;
      this.lastDevice = 'keyboard';
      this.down.add(code);
      for (const a of this.actionsFor('keyboard', code)) this.press(a);
    };
    this.onPointerUp = (e) => this.down.delete(`Mouse${e.button}`);
    this.onPointerMove = (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.moved = true; };
    this.onContext = (e) => { if (this.gameActive) e.preventDefault(); };
    this.onBlur = () => this.clear();
    win.addEventListener('keydown', this.onKeyDown);
    win.addEventListener('keyup', this.onKeyUp);
    win.addEventListener('pointerdown', this.onPointerDown);
    win.addEventListener('pointerup', this.onPointerUp);
    win.addEventListener('pointermove', this.onPointerMove);
    win.addEventListener('contextmenu', this.onContext);
    win.addEventListener('blur', this.onBlur);
  }

  clear() { this.down.clear(); this.padDown.clear(); this.sprintOn = false; }

  /** Ask for the next key / mouse button / pad button. Escape cancels. */
  capture(cb, device) {
    this.captureCb = cb; this.captureDevice = device;
  }

  cancelCapture() { this.captureCb = null; }

  finishCapture(device, code) {
    if (device === 'keyboard' && code === 'Escape') { this.captureCb = null; return; } // never bind the menu key by accident
    if (this.captureDevice && this.captureDevice !== device) return; // wrong device for this tab: keep waiting
    const cb = this.captureCb; this.captureCb = null;
    cb?.(device, code);
  }

  /** Poll the gamepad once per frame (button edges and sticks). */
  poll() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const pad = pads.find((p) => p.connected && p.mapping === 'standard') || pads.find((p) => p.connected);
    const name = pad ? pad.id.slice(0, 40) : null;
    if (name !== this.padName) { this.padName = name; this.emit('padchange', name); }
    if (!pad) { this.padDown = new Set(); this.padButtons = new Set(); this.padStick = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 } }; return; }
    const r = readPad(pad, this.settings);
    if (this.captureCb) {
      for (const i of r.pressedButtons) if (!this.padButtons.has(i)) { this.padButtons = r.pressedButtons; this.finishCapture('pad', i); return; }
    } else {
      for (const a of r.down) if (!this.padDown.has(a)) { this.lastDevice = 'pad'; this.press(a); }
      for (const a of this.padDown) if (!r.down.has(a) && a === 'stats') this.emit('statsUp');
    }
    this.padDown = r.down; this.padButtons = r.pressedButtons; this.padStick = { move: r.move, aim: r.aim };
    if (Math.hypot(r.move.x, r.move.y) > 0.3) this.lastDevice = 'pad';
  }

  actionDown(action) {
    if (action === 'sprint' && this.settings.toggleSprint) return this.sprintOn;
    return this.padDown.has(action) || this.settings.bindings.keyboard[action].some((c) => this.down.has(c));
  }

  /** Movement: x = right, y = forward, each in -1..1 (analog on a stick, digital on keys). */
  axes() {
    const k = (neg, pos) => (this.actionDown(pos) ? 1 : 0) - (this.actionDown(neg) ? 1 : 0);
    let x = this.padStick.move.x, y = this.padStick.move.y;
    // the d-pad actions also count as digital input
    x += k('left', 'right'); y += k('down', 'up');
    const m = Math.hypot(x, y);
    return m > 1 ? { x: x / m, y: y / m } : { x, y };
  }

  /** Right-stick shot placement (only when enabled in the settings). */
  aimStick() {
    const a = this.padStick.aim;
    const active = this.settings.stickAim && Math.hypot(a.x, a.y) > 0.3;
    return { x: a.x, y: a.y, active };
  }
}
