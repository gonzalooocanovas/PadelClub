import { Net } from './net.js';
import { World } from './scene.js';
import { Sound } from './audio.js';
import { UI, toast } from './ui.js';
import { MatchClient } from './game.js';
import { settings, setSetting, onSetting } from './settings.js';
import { Preview } from './preview.js';
import { DEFAULT_LOOKS, sanitizeLook } from '/shared/looks.js';
import { LocalMatch } from './local.js';
import { DEFAULT_SETTINGS } from '/shared/constants.js';
import { CAREER, starsFor, careerViewFrom, applyCareerResult } from '/shared/career.js';

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
let wantCareer = false; // (server career messages are no longer used: career runs locally)
const loadLook = () => { try { return sanitizeLook(JSON.parse(localStorage.getItem('padel.look') || 'null'), 0); } catch { return { ...DEFAULT_LOOKS[0] }; } };
let myLook = loadLook();
let court = (() => { try { return localStorage.getItem('padel.court') || 'indoor'; } catch { return 'indoor'; } })();
let preview = null;
let previewTeam = 0;
let local = null; // running solo match (no network)
let localCfg = null;
const localProxy = { rtt: 0, send(m) { if (m.t === 'in') local?.pushInputs(m.inputs); } };

// career progress lives in this browser: {done: {stageId: stars}, xp}
const loadCareer = () => { try { return JSON.parse(localStorage.getItem('padel.career') || '{}'); } catch { return {}; } };
const saveCareer = (c) => { try { localStorage.setItem('padel.career', JSON.stringify(c)); } catch { /* optional */ } };

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
  stopLocal();
  if (match) { match.stop(); match = null; }
  hud = null;
  world.setCourt(court);
  world.setLooks([myLook, ...DEFAULT_LOOKS.slice(1)]);
  const cv = careerViewFrom(loadCareer().done || {});
  ui.home({ name: net.name, profile, status: net.status, joinCode: autoJoin || '', level, court, careerStars: cv.stars ? `${cv.stars}/${cv.max}` : null });
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
  stopLocal();
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

// ---------------------------------------------------------------- solo matches (no network, no lag)

function stopLocal() { local?.stop(); local = null; }

function startLocalMatch(cfg) {
  stopLocal();
  localCfg = cfg;
  const me = (net.name || 'You').slice(0, 16);
  const s = {
    ...DEFAULT_SETTINGS, mode: cfg.mode, difficulty: cfg.difficulty,
    sets: cfg.sets ?? 1, gamesPerSet: cfg.gamesPerSet ?? 4, goldenPoint: !!cfg.golden,
  };
  const names = cfg.mode === 'singles'
    ? [me, 'AI', cfg.opponents?.[0] || 'AI', 'AI']
    : [me, cfg.partner || 'AI', cfg.opponents?.[0] || 'AI', cfg.opponents?.[1] || 'AI'];
  const diffs = ['', cfg.partnerDiff || cfg.difficulty, cfg.difficulty, cfg.difficulty];
  const staged = !!cfg.stage;
  const looks = cfg.mode === 'singles'
    ? [myLook, DEFAULT_LOOKS[1], staged ? cfg.looks?.[0] : DEFAULT_LOOKS[2], DEFAULT_LOOKS[3]]
    : [myLook, staged ? cfg.looks?.[0] : DEFAULT_LOOKS[1], staged ? cfg.looks?.[1] : DEFAULT_LOOKS[2], staged ? cfg.looks?.[2] : DEFAULT_LOOKS[3]];
  s.court = cfg.court || court;
  room = { settings: s, hostId: 'local', you: 'local', slots: [], state: 'match', code: 'LOCAL' };
  local = new LocalMatch({
    settings: s, names, diffs, looks: looks.map((l, i) => sanitizeLook(l, i)),
    onMessage: (m) => net.emit(m.t, m),
    onFinish: (results) => (cfg.stage ? finishCareer(cfg.stage, results) : null),
  });
  local.start();
}

function startCareer(id) {
  const stage = CAREER.find((c) => c.id === id);
  const view = careerViewFrom(loadCareer().done || {});
  if (!stage || !view.stages.find((c) => c.id === id)?.unlocked) { toast('That stage is locked', true); return; }
  startLocalMatch({ ...stage, stage });
}

function finishCareer(stage, results) {
  const st = loadCareer();
  const stars = starsFor(results);
  const r = applyCareerResult(st.done || {}, stage.id, stars);
  st.done = r.done;
  st.xp = (st.xp || 0) + r.bonusXp;
  saveCareer(st);
  return { stage: stage.id, name: stage.name, won: stars > 0, stars, bonusXp: r.bonusXp, unlocked: r.unlocked, hasNext: stage.id < CAREER.length };
}

function showCareer() {
  stopLocal();
  if (match) { match.stop(); match = null; }
  careerView = careerViewFrom(loadCareer().done || {});
  screen = 'career';
  ui.career(careerView);
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
    case 'court': court = d.val; try { localStorage.setItem('padel.court', court); } catch { /* optional */ } showHome(); break;
    case 'equipment': {
      const canvas = ui.equipmentModal(myLook);
      preview?.dispose();
      preview = new Preview(canvas);
      preview.setCharacter(myLook, previewTeam);
      ui.onModalClose = () => { preview?.dispose(); preview = null; };
      break;
    }
    case 'lookArch': case 'lookHair': case 'lookSkin': case 'lookRacket': {
      const key = { lookArch: 'arch', lookHair: 'hair', lookSkin: 'skin', lookRacket: 'racket' }[name];
      myLook = sanitizeLook({ ...myLook, [key]: +d.val }, 0);
      try { localStorage.setItem('padel.look', JSON.stringify(myLook)); } catch { /* optional */ }
      net.look = myLook;
      net.send({ t: 'look', look: myLook });
      ui.markEquipment(myLook);
      if (preview) { if (preview.mode === 'racket') preview.setRacket(myLook.racket); else preview.setCharacter(myLook, previewTeam); }
      break;
    }
    case 'previewMode': if (preview) { if (d.val === 'racket') preview.setRacket(myLook.racket); else preview.setCharacter(myLook, previewTeam); } break;
    case 'previewTeam': previewTeam ^= 1; if (preview && preview.mode === 'character') preview.setCharacter(myLook, previewTeam); break;
    case 'career': showCareer(); break;
    case 'careerPlay': startCareer(+d.stage); break;
    case 'careerNext': startCareer((lastResults?.career?.stage || 0) + 1); break;
    case 'careerMenu': showCareer(); break;
    case 'careerBack': showHome(); break;
    case 'rooms': ui.roomsModal(null); net.send({ t: 'rooms' }); break;
    case 'joinRoom': ui.closeModal(); net.send({ t: 'join', code: d.code, name: myName() }); break;
    case 'practice': startLocalMatch({ mode: 'doubles', difficulty: level }); break;
    case 'practice1': startLocalMatch({ mode: 'singles', difficulty: level }); break;
    case 'join': {
      const code = val('joinCode').trim().toUpperCase();
      if (code.length !== 5) { toast('Enter the 5-character room code', true); break; }
      net.send({ t: 'join', code, name: myName() });
      break;
    }
    case 'copy':
      navigator.clipboard?.writeText(d.text).then(() => toast('Invite link copied'), () => toast(d.text));
      break;
    case 'leave':
      if (local) { stopLocal(); room = null; showHome(); } else net.send({ t: 'leave' });
      break;
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
    case 'rematch': if (local) startLocalMatch(localCfg); else net.send({ t: 'rematch' }); break;
    case 'tolobby': net.send({ t: 'lobby' }); break;
    case 'profile': {
      const bonus = loadCareer().xp || 0;
      const merged = profile ? { ...profile, xp: profile.xp + bonus, level: Math.floor(Math.sqrt((profile.xp + bonus) / 100)) + 1 } : null;
      ui.profileModal(merged, net.name);
      break;
    }
    case 'controls': ui.controls(); break;
    case 'settings': ui.settingsModal(() => {}); break;
    case 'closeModal': ui.closeModal(); match?.setPaused(false); local?.setPaused(false); break;
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
net.on('disconnected', () => { if (!local) hud?.connection(false); });
net.on('welcome', (m) => {
  profile = m.profile;
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
  world.setCourt(m.settings.court || 'indoor');
  world.setLooks(m.looks);
  rematchVotes = [];
  hud = ui.showHud(m.names, m.settings);
  world.setSingles(m.settings.mode === 'singles');
  match = new MatchClient({
    net: m.local ? localProxy : net, world, hud, sound, start: m,
    onPause: () => {
      if (ui.modal) { ui.closeModal(); match?.setPaused(false); local?.setPaused(false); } else { ui.pauseMenu(); match?.setPaused(true); local?.setPaused(true); }
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

// automatic graphics quality: if the game cannot hold ~40 fps, step the preset down
let last = performance.now();
let fpsT = 0, fpsN = 0, slowWindows = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fpsT += dt; fpsN++;
  if (fpsT >= 2) {
    const fps = fpsN / fpsT;
    fpsT = 0; fpsN = 0;
    slowWindows = screen === 'game' && fps < 38 && !document.hidden ? slowWindows + 1 : 0;
    if (slowWindows >= 2 && settings.quality !== 'low') {
      const next = settings.quality === 'high' ? 'medium' : 'low';
      setSetting('quality', next);
      world.setQuality(next);
      toast(`Low frame rate: graphics set to ${next}`);
      slowWindows = 0;
    }
  }
  if (match && screen === 'game') match.frame(dt, now);
  else if (screen !== 'results' && !window.__freeze) idle(dt);
  world.render(dt);
  requestAnimationFrame(loop);
}

net.connect();
showHome();
requestAnimationFrame(loop);

// handy for debugging / automated checks
window.__padel = { world, net, get local() { return local; }, get match() { return match; }, get room() { return room; } };
