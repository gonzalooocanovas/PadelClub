// HTML for the controls screen: scheme picker, calibration, rebinding table, live input test and a controller diagram
// that shows the ACTUAL mapping of every button. Pure string building, so ui.js and main.js stay small.
import { ACTIONS, ACTION_LABELS, SCHEMES, codeLabel, PAD_NAMES } from './input.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SHORT = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', hit: 'Hit', lob: 'Lob', slice: 'Slice', soft: 'Soft', control: 'Block', sprint: 'Sprint', jump: 'Jump', stats: 'Stats', pause: 'Pause' };

const seg = (act, key, opts, val) => `<div class="seg">${opts.map(([v, l]) => `<button data-act="${act}" data-key="${key}" data-val="${v}" class="${String(val) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;

/** Controller drawing with the current action bound to each button. */
export function padDiagram(s) {
  const lab = (i) => { const a = ACTIONS.find((x) => s.bindings.pad[x].includes(i)); return a ? SHORT[a] : ''; };
  const btn = (i, x, y, name, r = 13) => `<g><circle cx="${x}" cy="${y}" r="${r}" fill="#172131" stroke="#3a4a66"/><text x="${x}" y="${y - 1}" text-anchor="middle" font-size="9" fill="#8d9bb1">${esc(name)}</text><text x="${x}" y="${y + 9}" text-anchor="middle" font-size="9" font-weight="700" fill="#d4f23c">${esc(lab(i))}</text></g>`;
  const rect = (i, x, y, w, name) => `<g><rect x="${x}" y="${y}" width="${w}" height="16" rx="4" fill="#172131" stroke="#3a4a66"/><text x="${x + w / 2}" y="${y + 11}" text-anchor="middle" font-size="9" fill="#8d9bb1">${esc(name)} <tspan fill="#d4f23c" font-weight="700">${esc(lab(i))}</tspan></text></g>`;
  return `<svg viewBox="0 0 380 210" width="100%" role="img" aria-label="Controller mapping">
    <path d="M70 60 Q60 40 100 38 L280 38 Q320 40 310 60 L345 160 Q352 192 322 190 Q296 188 280 160 L100 160 Q84 188 58 190 Q28 192 35 160 Z" fill="#0f1622" stroke="#3a4a66" stroke-width="2"/>
    ${rect(4, 62, 14, 62, 'LB')}${rect(5, 256, 14, 62, 'RB')}${rect(6, 62, -2, 62, 'LT').replace('y="-2"', 'y="0"')}${rect(7, 256, -2, 62, 'RT').replace('y="-2"', 'y="0"')}
    ${btn(12, 95, 82, '↑')}${btn(13, 95, 122, '↓')}${btn(14, 72, 102, '←')}${btn(15, 118, 102, '→')}
    ${btn(3, 285, 76, 'Y')}${btn(0, 285, 128, 'A')}${btn(2, 259, 102, 'X')}${btn(1, 311, 102, 'B')}
    ${btn(8, 160, 88, 'Back', 11)}${btn(9, 220, 88, 'Start', 11)}
    <circle cx="140" cy="140" r="17" fill="#172131" stroke="#3a4a66"/><text x="140" y="143" text-anchor="middle" font-size="9" font-weight="700" fill="#d4f23c">Move</text>
    <circle cx="232" cy="140" r="17" fill="#172131" stroke="#3a4a66"/><text x="232" y="143" text-anchor="middle" font-size="9" font-weight="700" fill="#d4f23c">${s.stickAim ? 'Aim' : '–'}</text>
  </svg>`;
}

export function controlsHtml(s, st) {
  const dev = st.device;
  const rows = ACTIONS.map((a) => {
    const waiting = st.capture === a;
    const codes = s.bindings[dev][a];
    return `<tr><td>${esc(ACTION_LABELS[a])}</td><td>${codes.map((c) => `<kbd>${esc(codeLabel(dev, c))}</kbd>`).join(' ') || '<span class="mute">unbound</span>'}</td><td><button class="btn small ${waiting ? 'on' : ''}" data-act="rebind" data-action="${a}">${waiting ? 'Press…' : 'Rebind'}</button></td></tr>`;
  }).join('');
  const prompt = st.capture
    ? `<div class="prompt">${dev === 'pad' ? 'Press a controller button' : 'Press a key or mouse button'} for <b>${esc(ACTION_LABELS[st.capture])}</b> · <kbd>Esc</kbd> cancels</div>`
    : '';
  const chips = ACTIONS.map((a) => `<span class="chip" data-test="${a}">${esc(SHORT[a])}</span>`).join('');
  return `<h2>Controls</h2>
    <div class="label">Control scheme</div>
    <div class="seg wrap">${Object.entries(SCHEMES).map(([k, v]) => `<button data-act="scheme" data-val="${k}" class="${s.scheme === k ? 'on' : ''}">${esc(v.label)}</button>`).join('')}</div>
    <p class="mute" style="margin:6px 0 10px">${esc(SCHEMES[s.scheme].hint)}</p>
    <div class="setting"><span>Mouse aiming <span class="mute">(ring on the court follows the cursor)</span></span>${seg('ctrlOpt', 'mouseAim', [[true, 'On'], [false, 'Off']], s.mouseAim)}</div>
    <div class="setting"><span>Right stick places the shot</span>${seg('ctrlOpt', 'stickAim', [[true, 'On'], [false, 'Off']], s.stickAim)}</div>
    <div class="setting"><span>Sprint</span>${seg('ctrlOpt', 'toggleSprint', [[false, 'Hold'], [true, 'Toggle']], s.toggleSprint)}</div>
    <div class="setting"><span>Aim marker and accuracy ring</span>${seg('ctrlOpt', 'aimMarker', [[true, 'Show'], [false, 'Hide']], s.aimMarker)}</div>
    <div class="setting"><span>Stick dead zone</span><input type="range" min="0" max="0.5" step="0.01" value="${s.deadzone}" data-ctrl-range="deadzone" style="max-width:200px"></div>
    <div class="setting"><span>Stick response curve</span><input type="range" min="0.6" max="2.5" step="0.1" value="${s.curve}" data-ctrl-range="curve" style="max-width:200px"></div>
    <div class="label" style="margin:12px 0 6px">Bindings</div>
    <div class="seg"><button data-act="ctrlDevice" data-val="keyboard" class="${dev === 'keyboard' ? 'on' : ''}">Keyboard &amp; mouse</button><button data-act="ctrlDevice" data-val="pad" class="${dev === 'pad' ? 'on' : ''}">Gamepad</button></div>
    ${prompt}
    ${dev === 'pad' ? `<div style="margin:10px 0">${padDiagram(s)}<p class="mute" style="font-size:12px">${st.padName ? 'Detected: ' + esc(st.padName) : 'No gamepad detected. Connect one and press any button.'}</p></div>` : ''}
    <table class="table" style="margin-top:6px"><tr><th>Action</th><th>Bound to</th><th></th></tr>${rows}</table>
    <div class="row" style="margin-top:10px"><button class="btn small" data-act="ctrlReset">Restore defaults (${dev === 'pad' ? 'gamepad' : 'keyboard'})</button><span class="grow"></span></div>
    <div class="label" style="margin:14px 0 6px">Test your inputs <span class="mute">(highlighted while pressed)</span></div>
    <div class="chips">${chips}</div>
    <p class="mute" style="font-size:12px;margin-top:8px">Number keys 1-4 (quick chat) and Escape (menu) are fixed. Rackets, camera and graphics are in Settings.</p>`;
}

export { PAD_NAMES };
