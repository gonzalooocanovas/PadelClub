import { Net } from './net.js';
import { World } from './scene.js';
import { Sound } from './audio.js';
import { UI, toast } from './ui.js';
import { MatchClient, CAMERA_ORDER } from './game.js';
import { settings, setSetting, onSetting } from './settings.js';
import { Preview } from './preview.js';
import { DEFAULT_LOOKS, sanitizeLook } from '/shared/looks.js';
import { LocalMatch } from './local.js';
import { InputManager, applyScheme, rebind, resetBindings, ACTIONS } from './input.js';
import { DEFAULT_SETTINGS } from '/shared/constants.js';
import {
  loadCareer as loadCareerSave, saveCareer as storeCareerSave, EVENT_BY_ID, DRILLS, createTournament, nextPlayerMatch, reportPlayerMatch,
  simulateMatch, applyMatch, completeEvent, commentary, buyAttr, attrMods, applyDrill, claimObjectives, rankOf, RESULT_LABELS,
} from '/shared/career2.js';
import { ROSTER_BY_ID } from '/shared/roster.js';
import { hubHtml, eventHtml, eventResultHtml, drillResultHtml, upgradesHtml } from './career-ui.js';
import { DrillController } from './drills.js';
import { Diagnostics } from './diagnostics.js';
import { entryFrom, addEntry, loadHistory, saveHistory, summarize } from '/shared/history.js';

const net = new Net();
const input = new InputManager(localStorage);
input.attach();
const world = new World(document.getElementById('gl'));
const sound = new Sound();

let room = null;
let match = null;
let hud = null;
let profile = null;
let screen = 'home'; // home | lobby | game | results
let selected = null; // host: member being moved
let onlineN = null; // players connected right now (from the server)
let queued = false; // searching for a quick match
let practicePending = false;
let rematchVotes = [];
let lastResults = null;
let autoJoin = new URLSearchParams(location.search).get('room');
let level = (() => { try { return localStorage.getItem('padel.level') || 'easy'; } catch { return 'easy'; } })();
const loadLook = () => { try { return sanitizeLook(JSON.parse(localStorage.getItem('padel.look') || 'null'), 0); } catch { return { ...DEFAULT_LOOKS[0] }; } };
let myLook = loadLook();
let court = (() => { try { return localStorage.getItem('padel.court') || 'indoor'; } catch { return 'indoor'; } })();
let preview = null;
let previewTeam = 0;
let local = null; // running solo match (no network)
let localCfg = null;
const localProxy = { rtt: 0, send(m) { if (m.t === 'in') local?.pushInputs(m.inputs); } };

// career progress lives in this browser (versioned save, see shared/career2.js; the old ladder save is migrated, never deleted)
const loadCareer = () => loadCareerSave(localStorage);
const saveCareer = (c) => storeCareerSave(localStorage, c);
let careerTab = 'hub';
let drillRun = null; // {id} while a drill is on screen

world.setQuality(settings.quality);
world.setBallScale(settings.ballScale);
onSetting((k) => {
  if (k === 'ballScale') world.setBallScale(settings.ballScale);
  if (['master', 'sfx', 'ambience', 'voice', 'music'].includes(k)) sound.applyVolume();
});

const val = (id) => document.getElementById(id)?.value ?? '';
const myName = () => (val('nameInput').trim() || net.name || 'Guest').slice(0, 16);

const ui = new UI(document.getElementById('ui'), { sound, act });

// Developer diagnostics (read-only overlay, off by default: F3 or ?debug=1). It never writes game state or sends messages.
const diag = new Diagnostics({
  world,
  getContext: () => ({
    mode: local ? 'solo' : room ? `online ${room.settings?.mode || ''}` : 'menu', court: world.courtId, camera: settings.camera, quality: settings.quality,
    ball: match?.ballView, me: match?.me, online: !local && !!match, solo: !!local, interpMs: match ? Math.round(match.interp * 1000) : null, rtt: net.rtt,
    singles: room?.settings?.mode === 'singles',
    anim: world.animDebug(),
    bots: local ? [1, 2, 3].map((s) => ({ slot: s, level: typeof local.diffs[s] === 'object' ? local.diffs[s].level : local.diffs[s] || local.settings.difficulty, decision: local.mem[s]?.decision || null, owner: local.game._tp?.[s >> 1]?.owner ?? null })) : null,
  }),
});
if (new URLSearchParams(location.search).get('debug') === '1') diag.toggle(true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'F3') { e.preventDefault(); diag.toggle(undefined, false); }
  else if (e.key === 'F2') { e.preventDefault(); diag.toggle(undefined, true); }
  else if (diag.on && e.key === 'F4') { e.preventDefault(); diag.copyReport(); }
  else if (diag.on && local && (e.key === '[' || e.key === ']')) { // stepping exists for solo matches only: online there is nothing to step
    if (e.key === '[') local.setPaused(!local.paused); else local.stepOnce();
  }
});
ui.getMouseAim = () => input.settings.mouseAim;

// The pause menu is a hub: Settings, Controls and the rest open on top of it and closing them comes back to the pause menu
// (the match stays paused); only Resume (or Esc on the pause menu itself) goes back to the game.
let inPause = false;
function openPauseMenu() {
  inPause = true;
  ui.pauseMenu(!!local, input.settings.mouseAim);
  match?.setPaused(true); local?.setPaused(true);
}
function closeModalOrBack() {
  const title = document.querySelector('#modal h2')?.textContent;
  ui.closeModal();
  if (inPause && title && title !== 'Paused') { openPauseMenu(); return; }
  inPause = false;
  match?.setPaused(false); local?.setPaused(false);
}

function setMouseAim(on, fromPause) {
  input.settings.mouseAim = on;
  input.settings.scheme = 'custom';
  input.save();
  toast(on ? 'Mouse aim on: move the cursor to aim, click to hit' : 'Mouse aim off: hold a direction as you hit');
  if (fromPause) ui.pauseMenu(!!local, on); else if (document.querySelector('#modal h2')?.textContent === 'Settings') ui.settingsModal(() => {});
}
document.addEventListener('keydown', (e) => {
  if ((e.key === 'c' || e.key === 'C') && screen === 'game' && !ui.modal && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) {
    const i = CAMERA_ORDER.indexOf(settings.camera);
    const next = CAMERA_ORDER[(i + 1) % CAMERA_ORDER.length];
    setSetting('camera', next);
    toast(`Camera: ${next}`);
    return;
  }
  if ((e.key === 'm' || e.key === 'M') && screen === 'game' && !ui.modal && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) setMouseAim(!input.settings.mouseAim);
});

// ---------------------------------------------------------------- screens

function showHome() {
  screen = 'home';
  inPause = false;
  sound.startMusic('menu');
  stopLocal();
  if (match) { match.stop(); match = null; }
  hud = null;
  world.setCourt(court);
  world.setLooks([myLook, ...DEFAULT_LOOKS.slice(1)]);
  const cs = loadCareer();
  world.setZone(null);
  ui.home({ name: net.name, profile, status: net.status, joinCode: autoJoin || '', level, court, online: onlineN, careerStars: cs.stats.matches ? `Season ${cs.season} · rank #${rankOf(cs.points)}` : null });
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
  sound.startMusic('menu');
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
  const c = cfg.custom; // career matches: named characters with their own level, style and look
  const names = c?.names || (cfg.mode === 'singles' ? [me, 'AI', 'AI', 'AI'] : [me, 'AI', 'AI', 'AI']);
  const diffs = c?.diffs || ['', cfg.difficulty, cfg.difficulty, cfg.difficulty];
  const looks = c?.looks || [myLook, DEFAULT_LOOKS[1], DEFAULT_LOOKS[2], DEFAULT_LOOKS[3]];
  s.attrMods = cfg.attrMods || attrMods(loadCareer().attrs); // upgrades apply to every solo match, never online
  s.court = cfg.court || court;
  room = { settings: s, hostId: 'local', you: 'local', slots: [], state: 'match', code: 'LOCAL' };
  local = new LocalMatch({
    settings: s, names, diffs, looks: looks.map((l, i) => sanitizeLook(l, i)),
    onMessage: (m) => net.emit(m.t, m),
    onFinish: cfg.onFinish || (cfg.reward ? (r) => practiceReward(cfg, r) : () => null),
    controller: cfg.controller || null,
    passive: !!cfg.passive,
  });
  local.start();
}

// ---------------------------------------------------------------- upgrades

function showUpgrades() {
  const save = loadCareer();
  const el = ui.openModal(`<h2>Player upgrades</h2>${upgradesHtml(save)}`);
  el.querySelector('.modal').classList.add('wide');
}

/** Practice wins against stronger bots pay upgrade points (nothing against Rookies, so they cannot be farmed). */
function practiceReward(cfg, results) {
  if (results.winner !== 0) return null;
  const pts = { easy: 0, normal: 1, hard: 2, expert: 3 }[cfg.difficulty] || 0;
  if (!pts) return null;
  const save = loadCareer();
  save.devPoints += pts; save.xp += 10 * pts;
  saveCareer(save);
  setTimeout(() => toast(`+${pts} upgrade point${pts > 1 ? 's' : ''} (Upgrades on the home screen)`), 4600);
  return null;
}

// ---------------------------------------------------------------- career v2

function showCareer(tab) {
  stopLocal();
  if (match) { match.stop(); match = null; }
  if (tab) careerTab = tab;
  hud = null;
  world.setZone(null);
  world.setSingles(false);
  screen = 'career';
  const save = loadCareer();
  ui.root.innerHTML = save.active && careerTab === 'event' ? eventHtml(save) : hubHtml(save, careerTab === 'event' ? 'hub' : careerTab);
}

function enterEvent(id) {
  const save = loadCareer();
  const ev = EVENT_BY_ID[id];
  if (!ev) return;
  if (save.active && save.active.eventId !== id) { toast('Finish or withdraw from your current event first', true); return; }
  if (!save.active) {
    const locked = (ev.requires?.points && save.points < ev.requires.points) || (ev.season > save.season);
    if (locked) { toast('That event is still locked', true); return; }
    save.active = createTournament(ev, save.seed++);
    saveCareer(save);
  }
  showCareer('event');
}

function playEventMatch() {
  const save = loadCareer();
  const t = save.active;
  if (!t) return showCareer('hub');
  const ev = EVENT_BY_ID[t.eventId];
  const n = nextPlayerMatch(t);
  if (!n) return showCareer('hub');
  const me = (net.name || 'You').slice(0, 16);
  const mates = ev.mode === 'doubles' ? [t.teams[0].ids[1]] : [];
  const roster = (id) => ROSTER_BY_ID[id];
  const opp = n.opponents.map(roster);
  const mate = mates.map(roster);
  const names = ev.mode === 'singles' ? [me, 'AI', opp[0].name, 'AI'] : [me, mate[0].name, opp[0].name, opp[1].name];
  const lv = (c) => ({ level: c.level, style: c.style });
  const diffs = ev.mode === 'singles' ? ['', 'easy', lv(opp[0]), 'easy'] : ['', lv(mate[0]), lv(opp[0]), lv(opp[1])];
  const looks = ev.mode === 'singles' ? [myLook, DEFAULT_LOOKS[1], opp[0].look, DEFAULT_LOOKS[3]] : [myLook, mate[0].look, opp[0].look, opp[1].look];
  const myPts = save.points;
  startLocalMatch({
    mode: ev.mode, difficulty: 'normal', sets: ev.sets, gamesPerSet: ev.gamesPerSet, golden: ev.golden, court: ev.court,
    attrMods: attrMods(save.attrs),
    custom: { names, diffs, looks },
    onFinish: (results) => finishEventMatch(ev, n, opp, myPts, results),
  });
}

function finishEventMatch(ev, n, opp, myPts, results) {
  const save = loadCareer();
  const t = save.active;
  if (!t) return null;
  let gf = 0, ga = 0;
  for (const [a, b] of results.score.sets) { gf += a; ga += b; }
  const won = results.winner === 0;
  const upset = won && opp.some((o) => o.points > myPts);
  const me = results.players[0] || {};
  const applied = applyMatch(save, ev, n.name, won, {
    gamesFor: gf, gamesAgainst: ga, opp: opp.map((o) => o.name).join(' & '), upset, smashes: me.smashes, aces: me.aces, at: Date.now(),
  });
  const seed = save.seed++;
  let k = 0;
  reportPlayerMatch(t, won, gf, ga, (a, b) => simulateMatch(a, b, ev, seed * 31 + k++));
  const info = { event: ev.name, eventId: ev.id, round: n.name, commentary: commentary(won, gf, ga, opp[0]?.note), objectives: [], next: '' };
  let finished = null;
  if (t.status === 'done') {
    finished = completeEvent(save, ev, t.result);
    info.finished = { ...finished, result: t.result };
    info.summary = t.result === 'champion' ? `${ev.name} is yours.` : `You finished as ${RESULT_LABELS[t.result].toLowerCase()}.`;
  } else {
    const nx = nextPlayerMatch(t);
    info.next = nx ? `${nx.name} against ${nx.opponents.map((id) => ROSTER_BY_ID[id].name).join(' & ')}` : '';
  }
  info.objectives = claimObjectives(save);
  saveCareer(save);
  return { kind: 'event', won, over: !!finished, html: eventResultHtml(info) };
}

function startDrill(id) {
  const save = loadCareer();
  const drill = DRILLS.find((d) => d.id === id);
  if (!drill) return;
  drillRun = { id };
  startLocalMatch({
    mode: 'singles', difficulty: 'easy', sets: 1, gamesPerSet: 6, court: court === 'outdoor' ? 'outdoor' : 'indoor',
    attrMods: attrMods(save.attrs), passive: true, controller: new DrillController(id),
  });
}

function onDrillResults(m) {
  const { id, score, attempts } = m.result;
  const drill = DRILLS.find((d) => d.id === id);
  const save = loadCareer();
  const r = applyDrill(save, drill, score);
  const gained = claimObjectives(save);
  saveCareer(save);
  stopLocal();
  if (match) { match.stop(); match = null; }
  hud = null;
  world.setZone(null);
  screen = 'results';
  ui.root.innerHTML = `<div class="screen"><div class="panel modal" style="width:min(520px,100%)">${drillResultHtml(drill, score, attempts, r)}${gained.map((o) => `<div class="obj done"><span>✓</span><span class="grow">Objective complete: ${o.text}</span></div>`).join('')}</div></div>`;
}

// ---------------------------------------------------------------- controls screen

const ctrl = { device: 'keyboard', capture: null, raf: 0 };
function openControls() {
  const el = ui.controlsModal(input.settings, { device: ctrl.device, capture: ctrl.capture, padName: input.padName });
  el.addEventListener('input', (e) => {
    const k = e.target.dataset.ctrlRange;
    if (k) { input.settings[k] = +e.target.value; input.save(); }
  });
  // live test of every action while the screen is open
  cancelAnimationFrame(ctrl.raf);
  const tick = () => {
    const modal = document.getElementById('modal');
    if (!modal || !modal.querySelector('[data-test]')) return;
    modal.querySelectorAll('[data-test]').forEach((c) => c.classList.toggle('on', input.actionDown(c.dataset.test)));
    ctrl.raf = requestAnimationFrame(tick);
  };
  ctrl.raf = requestAnimationFrame(tick);
  ui.onModalClose = () => { input.cancelCapture(); ctrl.capture = null; cancelAnimationFrame(ctrl.raf); };
}
input.on('padchange', () => { if (document.querySelector('#modal [data-test]')) openControls(); });

// ---------------------------------------------------------------- actions

function act(name, d, el) {
  sound.unlock(); // a click is the user gesture that lets audio (and music) start
  if (!sound.musicKind && screen !== 'game') sound.startMusic('menu');
  switch (name) {
    case 'rename': net.send({ t: 'rename', name: val('nameInput') }); break;
    case 'create': net.send({ t: 'create', name: myName() }); break;
    case 'quick':
      queued = true;
      net.send({ t: 'quick', name: myName() });
      ui.quickModal({ waiting: 1, online: onlineN, botsIn: 10 });
      ui.onModalClose = () => { if (queued) { queued = false; net.send({ t: 'quickCancel' }); } };
      break;
    case 'level':
      level = d.val;
      try { localStorage.setItem('padel.level', level); } catch { /* optional */ }
      showHome();
      break;
    case 'court': court = d.val; try { localStorage.setItem('padel.court', court); } catch { /* optional */ } showHome(); break;
    case 'equipment': {
      const canvas = ui.equipmentModal(myLook, loadCareer().unlockedRackets);
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
    case 'mouseAim': setMouseAim(d.val === '1', d.pause === '1'); break;
    case 'camera': setSetting('camera', d.val); ui.settingsModal(() => {}); break;
    case 'controlsSettings': openControls(); break;
    case 'scheme': applyScheme(input.settings, d.val); input.save(); openControls(); break;
    case 'ctrlDevice': ctrl.device = d.val; ctrl.capture = null; input.cancelCapture(); openControls(); break;
    case 'ctrlOpt': input.settings[d.key] = d.val === 'true'; if (d.key === 'mouseAim' && input.settings.scheme !== 'custom') input.settings.scheme = 'custom'; input.save(); openControls(); break;
    case 'ctrlReset': resetBindings(input.settings, ctrl.device); input.settings.scheme = 'custom'; input.save(); openControls(); toast('Defaults restored'); break;
    case 'rebind': {
      ctrl.capture = d.action;
      openControls();
      input.capture((device, code) => {
        const r = rebind(input.settings, device, d.action, code);
        ctrl.capture = null;
        input.save();
        openControls();
        toast(r.swappedWith ? `Swapped with "${r.swappedWith}"` : 'Binding saved');
      }, ctrl.device);
      break;
    }
    case 'career': showCareer(); break;
    case 'careerTab': showCareer(d.val); break;
    case 'eventEnter': enterEvent(d.event); break;
    case 'eventPlay': playEventMatch(); break;
    case 'eventContinue': case 'careerMenu': {
      const s = loadCareer();
      showCareer(s.active ? 'event' : 'hub');
      break;
    }
    case 'eventAbandon': {
      const s = loadCareer();
      s.active = null;
      saveCareer(s);
      toast('You withdrew from the event');
      showCareer('calendar');
      break;
    }
    case 'drillStart': startDrill(d.drill); break;
    case 'attrBuy': {
      const s = loadCareer();
      const r = buyAttr(s, d.attr);
      if (!r.ok) toast(r.reason, true); else { claimObjectives(s); saveCareer(s); }
      if (document.querySelector('#modal .upg')) showUpgrades(); else showCareer('development');
      break;
    }
    case 'careerBack': showHome(); break;
    case 'rooms': ui.roomsModal(null); net.send({ t: 'rooms' }); break;
    case 'joinRoom': ui.closeModal(); net.send({ t: 'join', code: d.code, name: myName() }); break;
    case 'upgrades': showUpgrades(); break;
    case 'practice': startLocalMatch({ mode: 'doubles', difficulty: level, reward: true }); break;
    case 'practice1': startLocalMatch({ mode: 'singles', difficulty: level, reward: true }); break;
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
    case 'leaveLocal': stopLocal(); room = null; showHome(); break;
    case 'tolobby': net.send({ t: 'lobby' }); break;
    case 'profile': {
      const bonus = loadCareer().xp;
      const merged = profile ? { ...profile, xp: profile.xp + bonus, level: Math.floor(Math.sqrt((profile.xp + bonus) / 100)) + 1 } : null;
      ui.profileModal(merged, net.name);
      break;
    }
    case 'history': { const list = loadHistory(localStorage); ui.historyModal(list, summarize(list)); break; }
    case 'historyClear': { saveHistory(localStorage, []); ui.historyModal([], summarize([])); toast('History cleared'); break; }
    case 'controls': ui.controls(); break;
    case 'settings': ui.settingsModal(() => {}); break;
    case 'pauseRequest': net.send({ t: 'pauseReq' }); ui.closeModal(); match?.setPaused(false); toast('Pause requested: waiting for the other players'); break;
    case 'pauseAccept': net.send({ t: 'pauseAccept' }); break;
    case 'pauseDeny': net.send({ t: 'pauseDeny' }); ui.clearPauseOverlay(); break;
    case 'pauseResume': net.send({ t: 'pauseResume' }); break;
    case 'closeModal': closeModalOrBack(); break;
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
  if (Number.isFinite(m.online)) onlineN = m.online;
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
  showHome();
});
net.on('drillStatus', (m) => { hud?.setDrill(m.text); world.setZone(m.zone || null); });
net.on('drillResults', onDrillResults);
function setOnline(n) {
  if (!Number.isFinite(n)) return;
  onlineN = n;
  const el = document.getElementById('onlineN');
  if (el) el.textContent = `${n} online`;
}
net.on('online', (m) => setOnline(m.n));
net.on('queue', (m) => {
  setOnline(m.online);
  if (m.cancelled || !queued) return;
  ui.quickModal(m);
});
// online pause: a request the others must accept, then a freeze of at most 30 s until everybody presses Resume
let pauseTimer = null;
function renderPause(m, offset) {
  const left = (t) => Math.max(0, Math.ceil((t - (Date.now() - offset)) / 1000));
  const mineRequest = m.byId === room?.you;
  if (m.phase === 'request') {
    ui.pauseOverlay(mineRequest
      ? `<h2>Pause requested</h2><p class="mute">Waiting for the other players to accept… (${left(m.expires)}s)</p>`
      : `<h2>${m.by} wants to pause</h2><p class="mute">Accept? It stops the match for 30 seconds at most. (${left(m.expires)}s)</p><div class="row" style="justify-content:center;margin-top:12px"><button class="btn primary" data-act="pauseAccept">Accept</button><button class="btn" data-act="pauseDeny">Decline</button></div>`);
  } else if (m.phase === 'active') {
    const me = m.resumedIds?.includes(room?.you);
    ui.pauseOverlay(`<h2>Paused</h2><p class="mute">The match resumes when everyone presses Resume, or in ${left(m.until)}s.</p><p class="mute" style="margin-top:6px">Resumed: ${m.resumed?.length || 0} / ${m.humans?.length || 0}</p><div class="row" style="justify-content:center;margin-top:12px"><button class="btn primary" data-act="pauseResume" ${me ? 'disabled' : ''}>${me ? 'Waiting for the others…' : 'Resume'}</button></div>`);
  }
}
net.on('pause', (m) => {
  clearInterval(pauseTimer);
  if (m.phase === 'request' || m.phase === 'active') {
    const offset = Date.now() - (m.now || Date.now());
    renderPause(m, offset);
    match?.setPaused(m.phase === 'active');
    pauseTimer = setInterval(() => renderPause(m, offset), 500);
  } else {
    ui.clearPauseOverlay();
    match?.setPaused(false);
    if (m.phase === 'denied') toast(m.expired ? 'The pause request expired' : `${m.by} declined the pause`, true);
  }
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
  queued = false; inPause = false;
  clearInterval(pauseTimer); ui.clearPauseOverlay();
  if (match) match.stop();
  ui.clear();
  world.setCourt(m.settings.court || 'indoor');
  world.setLooks(m.looks);
  rematchVotes = [];
  hud = ui.showHud(m.names, m.settings);
  world.setSingles(m.settings.mode === 'singles');
  match = new MatchClient({
    net: m.local ? localProxy : net, world, hud, sound, start: m, input,
    onReplay: (on) => local?.setPaused(on),
    onCorrection: () => diag.onCorrection(),
    onPause: () => { if (ui.modal) closeModalOrBack(); else openPauseMenu(); },
  });
  screen = 'game';
  sound.unlock();
  sound.startMusic('match');
});

net.on('snap', (m) => { match?.onSnap(m); diag.onSnap(performance.now()); });
net.on('ev', (m) => { match?.onEvents(m.ev); diag.onEvents(m.ev); });
net.on('chat', (m) => ui.addChat(m));
net.on('rematchVotes', (m) => {
  rematchVotes = m.ready;
  if (screen === 'results' && lastResults) showResults(lastResults);
});
function recordMatch(m) {
  try {
    const slot = local ? 0 : Math.max(0, room?.slots?.findIndex((s) => s && s.id === room.you) ?? 0);
    const entry = entryFrom(m.results, { slot, names: m.names, mode: room?.settings?.mode || 'doubles', court: room?.settings?.court || 'indoor', kind: m.career ? 'career' : local ? 'practice' : 'online' });
    saveHistory(localStorage, addEntry(loadHistory(localStorage), entry));
  } catch { /* history is a convenience: never break the results screen */ }
}

net.on('results', (m) => {
  lastResults = m;
  recordMatch(m);
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
  input.gameActive = screen === 'game';
  input.poll();
  if (match && screen === 'game') match.frame(dt, now);
  else if (screen !== 'results' && !window.__freeze) idle(dt);
  world.render(dt);
  diag.frame(now);
  requestAnimationFrame(loop);
}

net.connect();
showHome();
requestAnimationFrame(loop);

// handy for debugging / automated checks
window.__padel = { world, net, input, diag, get local() { return local; }, get match() { return match; }, get room() { return room; } };
