import { Net } from './net.js';
import { World } from './scene.js';
import { Sound } from './audio.js';
import { UI, toast } from './ui.js';
import { MatchClient } from './game.js';
import { settings, setSetting, onSetting } from './settings.js';

const net = new Net();
const world = new World(document.getElementById('gl'));
const sound = new Sound();

let room = null;
let match = null;
let hud = null;
let profile = null;
let screen = 'home'; // home | lobby | game | results
let selected = null; // host: member being moved
let practicePending = false;
let rematchVotes = [];
let lastResults = null;
let autoJoin = new URLSearchParams(location.search).get('room');
let level = (() => { try { return localStorage.getItem('padel.level') || 'easy'; } catch { return 'easy'; } })();
let careerView = null;
let openCareerAfterLeave = false;
let wantCareer = false; // the career screen opens only when asked for

world.setQuality(settings.quality);
world.setBallScale(settings.ballScale);
onSetting((k) => {
  if (k === 'ballScale') world.setBallScale(settings.ballScale);
  if (k === 'master' || k === 'ambience') sound.applyVolume();
});

const val = (id) => document.getElementById(id)?.value ?? '';
const myName = () => (val('nameInput').trim() || net.name || 'Guest').slice(0, 16);

const ui = new UI(document.getElementById('ui'), { sound, act });

// ---------------------------------------------------------------- screens

function showHome() {
  screen = 'home';
  if (match) { match.stop(); match = null; }
  hud = null;
  ui.home({ name: net.name, profile, status: net.status, joinCode: autoJoin || '', level, careerStars: careerView ? `${careerView.stars}/${careerView.max}` : null });
}

function lobbyReason() {
  if (!room) return '';
  const need = room.settings.mode === 'singles' ? [0, 2] : [0, 1, 2, 3];
  const filled = need.filter((i) => room.slots[i]).length;
  if (filled < need.length && !room.settings.fillBots) return 'Need all players (or turn AI fill on)';
  const waiting = room.slots.filter((s) => s?.kind === 'human' && s.id !== room.hostId && !s.ready && s.connected);
  if (waiting.length) return `Waiting for ${waiting.map((s) => s.name).join(', ')}`;
  return '';
}

function showLobby() {
  screen = 'lobby';
  world.setSingles(false);
  const input = document.getElementById('chatInput');
  const keep = input ? { v: input.value, f: document.activeElement === input, s: input.selectionStart } : null;
  ui.lobby(room, { selected, canStartReason: lobbyReason() });
  if (keep) {
    const n = document.getElementById('chatInput');
    n.value = keep.v;
    if (keep.f) { n.focus(); n.setSelectionRange(keep.s, keep.s); }
  }
}

function showResults(msg) {
  screen = 'results';
  ui.results(msg, room, room?.you, rematchVotes);
}

// ---------------------------------------------------------------- actions

function act(name, d, el) {
  switch (name) {
    case 'rename': net.send({ t: 'rename', name: val('nameInput') }); break;
    case 'create': net.send({ t: 'create', name: myName() }); break;
    case 'level':
      level = d.val;
      try { localStorage.setItem('padel.level', level); } catch { /* optional */ }
      showHome();
      break;
    case 'career': wantCareer = true; net.send({ t: 'career' }); break;
    case 'careerPlay': net.send({ t: 'careerStart', stage: +d.stage, name: myName() }); break;
    case 'careerNext': net.send({ t: 'careerStart', stage: (lastResults?.career?.stage || 0) + 1, name: myName() }); break;
    case 'careerMenu': openCareerAfterLeave = true; net.send({ t: 'leave' }); break;
    case 'careerBack': showHome(); break;
    case 'rooms': ui.roomsModal(null); net.send({ t: 'rooms' }); break;
    case 'joinRoom': ui.closeModal(); net.send({ t: 'join', code: d.code, name: myName() }); break;
    case 'practice': practicePending = 'doubles'; net.send({ t: 'create', name: myName() }); break;
    case 'practice1': practicePending = 'singles'; net.send({ t: 'create', name: myName() }); break;
    case 'join': {
      const code = val('joinCode').trim().toUpperCase();
      if (code.length !== 5) { toast('Enter the 5-character room code', true); break; }
      net.send({ t: 'join', code, name: myName() });
      break;
    }
    case 'copy':
      navigator.clipboard?.writeText(d.text).then(() => toast('Invite link copied'), () => toast(d.text));
      break;
    case 'leave': net.send({ t: 'leave' }); break;
    case 'sit': net.send({ t: 'sit', slot: +d.slot }); break;
    case 'select': selected = selected === d.id ? null : d.id; showLobby(); break;
    case 'place':
      if (selected === d.id) { selected = null; showLobby(); break; }
      if (selected) net.send({ t: 'assign', id: selected, slot: +d.slot });
      selected = null;
      break;
    case 'ready': net.send({ t: 'ready', ready: d.val === '1' }); break;
    case 'set': {
      const v = d.val === 'true' ? true : d.val === 'false' ? false : /^\d+$/.test(d.val) ? +d.val : d.val;
      net.send({ t: 'settings', settings: { [d.key]: v } });
      break;
    }
    case 'start': net.send({ t: 'start' }); break;
    case 'quick': net.send({ t: 'chat', text: d.text }); break;
    case 'chat': {
      const i = document.getElementById('chatInput');
      if (i.value.trim()) net.send({ t: 'chat', text: i.value });
      i.value = '';
      break;
    }
    case 'rematch': net.send({ t: 'rematch' }); break;
    case 'tolobby': net.send({ t: 'lobby' }); break;
    case 'profile': ui.profileModal(profile, net.name); net.send({ t: 'profile' }); break;
    case 'controls': ui.controls(); break;
    case 'settings': ui.settingsModal(() => {}); break;
    case 'closeModal': ui.closeModal(); match?.setPaused(false); break;
    case 'toggle':
      setSetting(d.key, d.val === '1');
      ui.settingsModal(() => {});
      break;
    case 'quality': setSetting('quality', d.val); world.setQuality(d.val); ui.settingsModal(() => {}); break;
    case 'fullscreen':
      if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
      break;
    default:
  }
  void el;
}

document.addEventListener('change', (e) => {
  if (e.target.id === 'nameInput') net.send({ t: 'rename', name: e.target.value });
});

// ---------------------------------------------------------------- network events

net.on('status', () => {
  if (screen === 'home' && document.activeElement?.id !== 'nameInput') showHome();
});
net.on('disconnected', () => hud?.connection(false));
net.on('welcome', (m) => {
  profile = m.profile;
  net.send({ t: 'career' });
  hud?.connection(true);
  if (screen === 'home' && document.activeElement?.id !== 'nameInput') showHome();
  if (autoJoin && !room) {
    net.send({ t: 'join', code: autoJoin, name: net.name });
    history.replaceState(null, '', location.pathname);
    autoJoin = null;
  }
});
net.on('profile', (m) => {
  profile = m.profile;
  if (ui.modal && document.querySelector('#modal h2')) ui.profileModal(profile, net.name);
});
net.on('error', (m) => {
  toast(m.message, true);
  practicePending = false;
  if (m.code === 'join-failed' && screen === 'home') showHome();
});
net.on('left', () => {
  room = null; practicePending = false; selected = null;
  if (openCareerAfterLeave) { openCareerAfterLeave = false; wantCareer = true; net.send({ t: 'career' }); return; }
  showHome();
});
net.on('career', (m) => {
  careerView = m.career;
  if (!wantCareer) { if (screen === 'home' && document.activeElement?.id !== 'nameInput') showHome(); return; }
  wantCareer = false;
  if (screen === 'game') return;
  if (match) { match.stop(); match = null; }
  screen = 'career';
  ui.career(m.career);
});
net.on('rooms', (m) => { if (document.getElementById('modal')) ui.roomsModal(m.rooms); });

net.on('room', (m) => {
  room = m;
  if (m.state === 'lobby') {
    if (practicePending && m.hostId === m.you) {
      net.send({ t: 'settings', settings: { difficulty: level, ...(practicePending === 'singles' ? { mode: 'singles' } : {}) } });
      practicePending = false;
      net.send({ t: 'start' });
    }
    if (screen !== 'lobby' || match) {
      if (match) { match.stop(); match = null; }
      ui.clear();
    }
    showLobby();
  } else if (m.state === 'results' && screen === 'results' && lastResults) {
    showResults(lastResults);
  }
});

net.on('start', (m) => {
  if (match) match.stop();
  ui.clear();
  rematchVotes = [];
  hud = ui.showHud(m.names, m.settings);
  world.setSingles(m.settings.mode === 'singles');
  match = new MatchClient({
    net, world, hud, sound, start: m,
    onPause: () => {
      if (ui.modal) { ui.closeModal(); match?.setPaused(false); } else { ui.pauseMenu(); match?.setPaused(true); }
    },
  });
  screen = 'game';
  sound.unlock();
});

net.on('snap', (m) => match?.onSnap(m));
net.on('ev', (m) => match?.onEvents(m.ev));
net.on('chat', (m) => ui.addChat(m));
net.on('rematchVotes', (m) => {
  rematchVotes = m.ready;
  if (screen === 'results' && lastResults) showResults(lastResults);
});
net.on('results', (m) => {
  lastResults = m;
  if (match) { match.stop(); }
  setTimeout(() => { if (screen !== 'lobby') showResults(m); }, 0);
});

// ---------------------------------------------------------------- main loop

const idleCam = { a: 0 };
function idle(dt) {
  idleCam.a += dt * 0.12;
  const a = idleCam.a;
  world.camera.position.set(Math.sin(a) * 9, 5.5 + Math.sin(a * 0.7) * 1.2, Math.cos(a) * 14);
  world.camera.lookAt(0, 1, 0);
  const spots = [[-2.2, -6.5], [2.4, -2.5], [2.2, 6.5], [-2.4, 2.5]];
  spots.forEach(([x, z], i) => world.updatePlayer(i, { x, z, vx: 0, vz: 0, swingT: -1, kindName: 'forehand', jumpT: 0 }, dt, false));
  world.setBall(0, 1.4 + Math.sin(a * 6) * 0.3, 0);
  world.reticle.position.y = -5; world.reticleDot.position.y = -5;
  world.reachRing.visible = false; world.meRing.position.y = -5;
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (match && screen === 'game') match.frame(dt, now);
  else if (screen !== 'results' && !window.__freeze) idle(dt);
  world.render(dt);
  requestAnimationFrame(loop);
}

net.connect();
showHome();
requestAnimationFrame(loop);

// handy for debugging / automated checks
window.__padel = { world, net, get match() { return match; }, get room() { return room; } };
