// DOM screens: home, lobby, HUD, results, modals. Pure presentation + callbacks into main.js.
import { settings, setSetting } from './settings.js';
import { BOT_LEVELS, BOT_LABELS } from '/shared/ai.js';
import { controlsHtml } from './controls-ui.js';
import { ARCHETYPES, HAIR_STYLES, SKIN_TONES, RACKETS, COURTS, COURT_IDS } from '/shared/looks.js';

const COURT_SHORT = { indoor: 'Indoor', outdoor: 'Outdoor', night: 'Night', rooftop: 'Rooftop' };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const TEAM_NAMES = ['Team A', 'Team B'];
const TEAM_COLORS = ['#f2f5f8', '#3d78c4'];

export function toast(text, err = false) {
  const el = document.createElement('div');
  el.className = `toast${err ? ' err' : ''}`;
  el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

const pingClass = (rtt) => (rtt === 0 ? '' : rtt < 80 ? 'ok' : rtt < 160 ? 'warn' : 'bad');

export class UI {
  constructor(root, cb) {
    this.root = root;
    this.cb = cb;
    this.chatLines = [];
    this.modal = null;
    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      this.cb.sound.unlock();
      this.cb.sound.play('ui');
      this.cb.act(el.dataset.act, el.dataset, el);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const a = e.target.dataset?.enter;
      if (a) this.cb.act(a, e.target.dataset, e.target);
    });
  }

  clear() { this.root.innerHTML = ''; this.hud = null; this.modal = null; }

  // ------------------------------------------------------------------ home

  home({ name, profile, status, joinCode, level = 'easy', careerStars = null, court = 'indoor' }) {
    const lvl = profile?.level ?? 1;
    const xp = profile?.xp ?? 0;
    const into = xp - (lvl - 1) ** 2 * 100;
    const need = lvl ** 2 * 100 - (lvl - 1) ** 2 * 100;
    this.root.innerHTML = `
      <div class="home"><div class="home-inner">
        <div class="brand"><div class="brand-mark"></div><h1>PADEL CLUB</h1></div>
        <p class="tagline">Four-player online doubles. Grab three friends, share a room code, and play on a real glass-walled court.</p>
        <div class="profile-chip">
          <div class="avatar">${esc((name || 'G')[0].toUpperCase())}</div>
          <div class="grow">
            <input type="text" id="nameInput" maxlength="16" value="${esc(name)}" placeholder="Your name" data-enter="rename" aria-label="Player name">
            <div class="row" style="margin-top:8px"><span class="label">Level ${lvl}</span><div class="bar grow"><i style="width:${Math.min(100, (into / need) * 100)}%"></i></div></div>
          </div>
        </div>
        <div class="menu">
          <button class="btn primary" data-act="create" ${status !== 'online' ? 'disabled' : ''}>Play with friends <small>create private room</small></button>
          <button class="btn" data-act="career">Career <small>${careerStars || 'seasons, rankings, training'}</small></button>
          <button class="btn" data-act="equipment">Equipment <small>player &amp; racket</small></button>
          <button class="btn" data-act="upgrades">Upgrades <small>speed, power, stamina…</small></button>
          <div class="row levelrow"><span class="label">Court</span><div class="seg grow">${COURT_IDS.map((c) => `<button data-act="court" data-val="${c}" class="${court === c ? 'on' : ''}">${COURT_SHORT[c]}</button>`).join('')}</div></div>
          <div class="row levelrow"><span class="label">Bots</span><div class="seg grow">${BOT_LEVELS.map((l) => `<button data-act="level" data-val="${l}" class="${level === l ? 'on' : ''}">${BOT_LABELS[l]}</button>`).join('')}</div></div>
          <button class="btn" data-act="practice" ${status !== 'online' ? 'disabled' : ''}>Practice 2 vs 2 <small>you + 3 bots</small></button>
          <button class="btn" data-act="practice1" ${status !== 'online' ? 'disabled' : ''}>1 vs 1 <small>you vs AI</small></button>
          <div class="joinrow">
            <input type="text" id="joinCode" maxlength="5" placeholder="CODE" value="${esc(joinCode || '')}" data-enter="join" aria-label="Room code">
            <button class="btn grow" data-act="join" ${status !== 'online' ? 'disabled' : ''}>Join room</button>
          </div>
          <div class="row">
            <button class="btn ghost grow" data-act="profile">Profile</button>
            <button class="btn ghost grow" data-act="history">History</button>
            <button class="btn ghost grow" data-act="rooms">Rooms</button>
            <button class="btn ghost grow" data-act="controls">How to play</button>
            <button class="btn ghost grow" data-act="settings">Settings</button>
          </div>
        </div>
        <div class="status"><span class="dot ${status === 'online' ? 'ok' : 'warn'}"></span>${status === 'online' ? 'Connected to server' : status === 'reconnecting' ? 'Connection lost — retrying…' : 'Connecting…'}</div>
      </div></div>`;
  }

  // ------------------------------------------------------------------ lobby

  lobby(room, { selected, canStartReason }) {
    const me = room.you;
    const isHost = room.hostId === me;
    const s = room.settings;
    const singles = s.mode === 'singles';
    const link = `${location.origin}/?room=${room.code}`;
    const seat = (i) => {
      const sl = room.slots[i];
      if (!sl) {
        return `<div class="seat empty"><span>Empty seat</span><button class="btn small" data-act="${selected ? 'place' : 'sit'}" data-slot="${i}">${selected ? 'Place here' : 'Sit here'}</button></div>`;
      }
      if (sl.kind === 'bot') {
        return `<div class="seat empty"><span class="name"><span class="tag">AI</span> Bot player</span><button class="btn small" data-act="${selected ? 'place' : 'sit'}" data-slot="${i}">${selected ? 'Place here' : 'Take this seat'}</button></div>`;
      }
      const mine = sl.id === me;
      const tags = [
        sl.id === room.hostId ? '<span class="tag host">Host</span>' : '',
        sl.connected ? (sl.ready ? '<span class="tag ready">Ready</span>' : '<span class="tag">Not ready</span>') : '<span class="tag off">Disconnected</span>',
      ].join(' ');
      const swap = isHost ? `<button class="btn small ghost" data-act="${selected ? 'place' : 'select'}" data-slot="${i}" data-id="${sl.id}">${selected === sl.id ? 'Cancel' : selected ? 'Swap here' : 'Move'}</button>` : '';
      const takeSeat = !mine && !isHost && selected ? '' : '';
      return `<div class="seat ${mine ? 'me' : ''} ${selected === sl.id ? 'sel' : ''}">
        <div class="name"><span class="dot ${pingClass(sl.rtt)}"></span>${esc(sl.name)}${mine ? ' <span class="mute">(you)</span>' : ''}</div>
        <div class="row">${tags}<span class="grow"></span><span class="mute" style="font-size:12px">${sl.rtt ? sl.rtt + ' ms' : ''}</span>${swap}${takeSeat}</div>
      </div>`;
    };
    const seg = (key, opts, val, enabled) => `<div class="seg">${opts.map(([v, l]) => `<button data-act="set" data-key="${key}" data-val="${v}" class="${String(val) === String(v) ? 'on' : ''}" ${enabled ? '' : 'disabled'}>${l}</button>`).join('')}</div>`;
    const meMember = room.slots.find((x) => x?.id === me);
    this.root.innerHTML = `
      <div class="screen"><div class="lobby">
        <div class="panel lobby-head">
          <div><div class="label">Room code</div><div class="code">${esc(room.code)}</div></div>
          <div class="col grow" style="gap:6px"><span class="label">Invite link</span><input type="text" readonly value="${esc(link)}" onclick="this.select()" aria-label="Invite link"></div>
          <button class="btn" data-act="copy" data-text="${esc(link)}">Copy link</button>
          <button class="btn ghost" data-act="leave">Leave room</button>
        </div>
        <div class="panel col">
          <div class="teams">
            <div class="team"><h3><span class="swatch" style="background:${TEAM_COLORS[0]}"></span>${TEAM_NAMES[0]}</h3>${seat(0)}${singles ? '' : seat(1)}</div>
            <div class="team"><h3><span class="swatch" style="background:${TEAM_COLORS[1]}"></span>${TEAM_NAMES[1]}</h3>${seat(2)}${singles ? '' : seat(3)}</div>
          </div>
          <div class="row" style="margin-top:6px">
            ${isHost
    ? `<button class="btn primary grow" data-act="start" ${canStartReason ? 'disabled' : ''}>Start match</button><span class="mute" style="font-size:13px">${esc(canStartReason || 'Everyone is ready')}</span>`
    : `<button class="btn ${meMember?.ready ? '' : 'primary'} grow" data-act="ready" data-val="${meMember?.ready ? 0 : 1}">${meMember?.ready ? 'Cancel ready' : 'I am ready'}</button><span class="mute" style="font-size:13px">Waiting for the host to start</span>`}
          </div>
        </div>
        <div class="panel col">
          <div class="label">Match format ${isHost ? '' : '(host controls)'}</div>
          <div class="setting"><span>Mode</span>${seg('mode', [['doubles', '2 vs 2'], ['singles', '1 vs 1']], s.mode || 'doubles', isHost)}</div>
          <div class="setting"><span>Court</span>${seg('court', COURT_IDS.map((c) => [c, COURT_SHORT[c]]), s.court || 'indoor', isHost)}</div>
          <div class="setting"><span>Sets</span>${seg('sets', [[1, 'Single set'], [3, 'Best of 3']], s.sets, isHost)}</div>
          <div class="setting"><span>Games per set</span>${seg('gamesPerSet', [[2, '2'], [4, '4'], [6, '6']], s.gamesPerSet, isHost)}</div>
          <div class="setting"><span>Deuce</span>${seg('goldenPoint', [[false, 'Advantage'], [true, 'Golden point']], s.goldenPoint, isHost)}</div>
          <div class="setting"><span>AI level</span>${seg('difficulty', BOT_LEVELS.map((l) => [l, BOT_LABELS[l]]), s.difficulty, isHost)}</div>
          <div class="setting"><span>Fill empty seats with AI</span>${seg('fillBots', [[true, 'On'], [false, 'Off']], s.fillBots, isHost)}</div>
          <div class="setting"><span>Room visibility</span>${seg('public', [[false, 'Private'], [true, 'Public']], !!s.public, isHost)}</div>
          <div class="chat grow">
            <div class="label" style="margin-top:6px">Chat</div>
            <div class="chat-log" id="chatLog"></div>
            <div class="quick">${['Ready?', 'Nice!', 'Good luck', 'Rematch?', 'One sec'].map((t) => `<button data-act="quick" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>
            <input type="text" id="chatInput" maxlength="140" placeholder="Say something…" data-enter="chat" aria-label="Chat message">
          </div>
        </div>
      </div></div>`;
    this.renderChat();
  }

  addChat(m) {
    this.chatLines.push(m);
    if (this.chatLines.length > 60) this.chatLines.shift();
    this.renderChat();
    if (this.hud) this.hud.feedLine(m);
  }

  renderChat() {
    const log = $('#chatLog');
    if (!log) return;
    log.innerHTML = this.chatLines.map((m) => `<div><b style="color:${TEAM_COLORS[(m.slot ?? 0) >> 1] || '#fff'}">${esc(m.name)}</b> ${esc(m.text)}</div>`).join('');
    log.scrollTop = log.scrollHeight;
  }

  // ------------------------------------------------------------------ HUD

  showHud(names, settingsMatch) {
    this.root.innerHTML = `
      <div class="hud">
        <div class="score" id="score"></div>
        <div class="topright"><span id="clock">0:00</span><span class="status"><span class="dot" id="pingDot"></span><span id="ping">– ms</span></span></div>
        <div class="drillbar hidden" id="drillbar"></div>
        <div class="rallychip hidden" id="rally"></div>
        <div class="chargebar hidden" id="charge"><span>Serve power</span><div><i></i></div></div>
        <div class="banner" id="banner"><div class="big"></div><div class="sub"></div></div>
        <div class="feedback" id="feedback"></div>
        <div class="timing hidden" id="timing"><i class="t-out"></i><i class="t-in"></i><span></span></div>
        <div class="chatfeed" id="feed"></div>
        <div class="bottomleft">
          <div class="label" id="stamLabel">Stamina</div><div class="bar" style="margin-top:6px"><i id="stam" style="width:100%"></i></div>
          <div class="keys" id="keys">WASD or arrows move · Shift sprint · X jump<br><b>Space hit</b> (serve: hold to add power, release to hit) · G globo · R slice<br>Q soft / víbora · E bandeja / block · M mouse aim<br>Hold a direction as you hit: that is where the ball goes<br><br>Tab stats · Esc menu · 1–4 quick chat</div>
        </div>
        <div class="statsov hidden" id="statsov"><div class="panel modal" id="statsbody"></div></div>
        <div class="reconnect hidden" id="recon">Connection lost — reconnecting…</div>
      </div>`;
    const ui = this;
    this.hud = {
      names,
      singles: settingsMatch?.mode === 'singles',
      lastScore: null,
      stats: null,
      hideKeys: setTimeout(() => { const k = $('#keys'); if (k) k.style.opacity = 0.0; }, 18000),
      setScore(v, n = this.names) {
        const prev = this.lastScore;
        this.lastScore = v;
        const el = $('#score');
        if (!el) return;
        const ns = v.sets.length;
        const cols = `5px 14px minmax(110px, 1fr) ${'26px '.repeat(ns)}40px 50px`;
        const row = (t) => {
          const nm = this.singles ? esc(n[t * 2]) : `${esc(n[t * 2])} <i>/</i> ${esc(n[t * 2 + 1])}`;
          const serving = v.server && v.server.team === t;
          const done = v.sets.map((s) => `<span class="n ${s[t] > s[1 - t] ? 'w' : ''}">${s[t]}</span>`).join('');
          const bump = (now, was) => (prev && was !== undefined && now !== was ? ' bump' : '');
          const gBump = bump(v.games[t], prev?.games?.[t]);
          const pBump = bump(v.points[t], prev?.points?.[t]);
          return `<div class="tr t${t}" style="grid-template-columns:${cols}"><span class="tb" style="background:${TEAM_COLORS[t]}"></span><span class="sv ${serving ? 'on' : ''}"></span><span class="tn">${nm}</span>${done}<span class="g${gBump}">${v.games[t]}</span><span class="p${pBump}">${v.points[t]}</span></div>`;
        };
        const flag = v.matchPoint ? 'Match point' : v.setPoint ? 'Set point' : v.gamePoint !== null && v.gamePoint !== undefined ? 'Game point' : v.tiebreak ? 'Tiebreak' : v.label;
        const hot = v.matchPoint ? ' hot' : v.setPoint ? ' warm' : '';
        const head = `<div class="hd" style="grid-template-columns:1fr ${'26px '.repeat(ns)}40px 50px"><span></span>${v.sets.map((_, i) => `<span>S${i + 1}</span>`).join('')}<span>Games</span><span>Pts</span></div>`;
        el.innerHTML = head + row(0) + row(1) + (flag ? `<div class="meta${hot}">${esc(flag)}</div>` : '');
      },
      setClock(sec) {
        const c = $('#clock');
        if (c) c.textContent = `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
      },
      setVitals(stam, rtt) {
        const s = $('#stam'); if (s) { s.style.width = `${stam}%`; s.classList.toggle('tired', stam < 50); s.classList.toggle('spent', stam < 25); }
        const sl = $('#stamLabel'); if (sl) sl.textContent = stam < 25 ? 'Exhausted' : stam < 50 ? 'Tired' : 'Stamina';
        const p = $('#ping'); if (p) p.textContent = rtt ? `${rtt} ms` : '– ms';
        const d = $('#pingDot'); if (d) d.className = `dot ${pingClass(rtt)}`;
      },
      banner(big, sub, ms) {
        const b = $('#banner'); if (!b) return;
        b.querySelector('.big').textContent = big;
        b.querySelector('.sub').textContent = sub || '';
        b.classList.add('show');
        clearTimeout(this.bt);
        if (ms) this.bt = setTimeout(() => b.classList.remove('show'), ms);
      },
      feedback(label, kind) {
        const f = $('#feedback'); if (!f || !settings.timing) return;
        const nice = { perfect: 'Perfect', clean: 'Clean', good: 'Good', early: 'Early', late: 'Late', 'off-centre': 'Off-centre', poor: 'Poor contact', serve: 'Serve' }[label] || label;
        const shot = { lob: 'globo', vibora: 'víbora', chiquita: 'chiquita', drop: 'dejada', block: 'bloqueo', slice: 'slice', bandeja: 'bandeja', smash: 'remate', serve: 'saque' }[kind] || kind;
        f.textContent = `${nice} · ${shot}`;
        f.className = `feedback show ${label === 'perfect' ? 'perfect' : label === 'good' || label === 'clean' || label === 'serve' ? 'good' : 'bad'}`;
        clearTimeout(this.ft);
        this.ft = setTimeout(() => f.classList.remove('show'), 900);
      },
      feedLine(m) {
        const feed = $('#feed'); if (!feed) return;
        const d = document.createElement('div');
        d.innerHTML = `<b style="color:${TEAM_COLORS[(m.slot ?? 0) >> 1] || '#fff'}">${esc(m.name)}</b> ${esc(m.text)}`;
        feed.appendChild(d);
        setTimeout(() => d.remove(), 5000);
      },
      setStats(st, longest) { this.stats = { st, longest }; if (!$('#statsov')?.classList.contains('hidden')) this.showStats(true); },
      showStats(on) {
        const o = $('#statsov'); if (!o) return;
        o.classList.toggle('hidden', !on);
        if (!on) return;
        const s = this.stats?.st;
        $('#statsbody').innerHTML = `<h2>Match stats</h2>${s ? statsTable(s, this.names, this.singles) + `<p class="mute" style="margin-top:10px">Longest rally: ${this.stats.longest} shots</p>` : '<p class="mute">Stats appear after the first point.</p>'}`;
      },
      timing(x, y, outPx, zone, text) {
        const t = $('#timing'); if (!t) return;
        if (x === null) { t.classList.add('hidden'); return; }
        t.classList.remove('hidden');
        t.style.transform = `translate(${x}px, ${y}px)`;
        t.className = `timing z-${zone}`;
        t.querySelector('.t-out').style.width = t.querySelector('.t-out').style.height = `${outPx * 2}px`;
        t.querySelector('span').textContent = text;
      },
      charge(f) { const c = $('#charge'); if (!c) return; if (f === null) { c.classList.add('hidden'); return; } c.classList.remove('hidden'); const i = c.querySelector('i'); i.style.width = `${f * 100}%`; c.classList.toggle('full', f >= 0.98); },
      rally(n) { const r = $('#rally'); if (!r) return; if (!n) { r.classList.add('hidden'); return; } r.innerHTML = `<small>Rally</small><b>${n}</b><small>${n === 1 ? 'shot' : 'shots'}</small>`; r.classList.remove('hidden'); r.classList.toggle('long', n >= 10); },
      setDrill(text) { const d = $('#drillbar'); if (!d) return; d.classList.toggle('hidden', !text); d.textContent = text || ''; },
      connection(ok) { $('#recon')?.classList.toggle('hidden', ok); },
    };
    void ui; void settingsMatch;
    return this.hud;
  }

  // ------------------------------------------------------------------ results

  results(m, room, myId, rematchVotes = []) {
    const r = m.results;
    const win = r.winner;
    const names = m.names;
    const sets = r.score.sets.map((s) => `${s[0]}–${s[1]}`).join('  ·  ');
    const isHost = room?.hostId === myId;
    const my = m.progress?.[myId];
    const mins = `${Math.floor(r.duration / 60)}:${String(r.duration % 60).padStart(2, '0')}`;
    this.root.innerHTML = `
      <div class="screen"><div class="panel modal" style="width:min(720px,100%)">
        <div class="label">Final</div>
        <div class="winner" style="color:${TEAM_COLORS[win]}">${room?.settings?.mode === 'singles' ? esc(names[win * 2]) : `${esc(names[win * 2])} / ${esc(names[win * 2 + 1])}`} win</div>
        <p style="font-size:22px;margin:6px 0 16px;font-variant-numeric:tabular-nums">${sets}</p>
        <div class="row" style="gap:28px;margin-bottom:14px">
          <div><div class="label">Duration</div>${mins}</div>
          <div><div class="label">Longest rally</div>${r.longestRally} shots</div>
          <div><div class="label">Points</div>${r.teamPoints[0]} – ${r.teamPoints[1]}</div>
          ${my ? `<div><div class="label">XP earned</div>+${my.xp} · Level ${my.level}</div>` : ''}
        </div>
        ${statsTable(r.players, names, room?.settings?.mode === 'singles')}
        ${m.career ? m.career.html : ''}
        <div class="row" style="margin-top:18px">
          ${m.career ? `<button class="btn primary grow" data-act="eventContinue">${m.career.over ? 'Back to career' : 'Continue'}</button>
          <button class="btn ghost" data-act="leaveLocal">Main menu</button>` : `
          <button class="btn primary grow" data-act="rematch">Rematch ${rematchVotes.length ? `(${rematchVotes.length} ready)` : ''}</button>
          ${isHost ? '<button class="btn grow" data-act="tolobby">Back to lobby</button>' : ''}
          <button class="btn ghost" data-act="leave">Leave</button>`}
        </div>
      </div></div>`;
  }

  // ------------------------------------------------------------------ modals

  roomsModal(list) {
    const rows = list === null ? '<p class="mute">Loading…</p>' : list.length === 0
      ? '<p class="mute">No public rooms right now. Create one and set <b>Room visibility → Public</b> in the lobby.</p>'
      : `<table class="table"><tr><th>Host</th><th>Mode</th><th>Bots</th><th>Players</th><th></th></tr>${list.map((r) => `<tr><td>${esc(r.host)}</td><td>${r.mode === 'singles' ? '1 vs 1' : '2 vs 2'}</td><td>${BOT_LABELS[r.difficulty] || r.difficulty}</td><td>${r.players}/${r.max}</td><td><button class="btn small primary" data-act="joinRoom" data-code="${esc(r.code)}">Join</button></td></tr>`).join('')}</table>`;
    this.openModal(`<h2>Public rooms</h2>${rows}<div class="row" style="margin-top:12px"><button class="btn small" data-act="rooms">Refresh</button></div>`);
  }

  historyModal(list, s) {
    const when = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const kind = { practice: 'Practice', career: 'Career', online: 'Online' };
    const rows = list.slice(0, 40).map((e) => `<tr><td>${esc(when(e.at))}</td><td>${kind[e.kind] || ''} · ${e.mode === 'singles' ? '1v1' : '2v2'}</td><td>${e.mates?.length ? esc(e.mates.join(' & ')) + ' vs ' : 'vs '}${esc((e.opponents || []).join(' & '))}</td><td style="color:${e.won ? 'var(--accent)' : 'var(--bad)'};font-weight:800">${e.won ? 'W' : 'L'} ${e.sets.map((x) => x.join('–')).join(' ')}</td><td>${e.longestRally}</td></tr>`).join('');
    this.openModal(`<h2>Match history</h2>
      <div class="statrow"><div><span class="label">Matches</span><b>${s.matches}</b></div><div><span class="label">Wins</span><b>${s.wins}</b></div><div><span class="label">Win rate</span><b>${s.winRate}%</b></div><div><span class="label">Streak</span><b>${s.streak}</b></div><div><span class="label">Best rally</span><b>${s.longestRally}</b></div><div><span class="label">Aces</span><b>${s.aces}</b></div></div>
      ${list.length ? `<table class="table" style="margin-top:12px"><tr><th>When</th><th>Mode</th><th>Players</th><th>Result</th><th>Rally</th></tr>${rows}</table>${list.length > 40 ? '<p class="mute">Showing the latest 40.</p>' : ''}<div class="row" style="margin-top:10px"><button class="btn small ghost" data-act="historyClear">Clear history</button></div>` : '<p class="mute" style="margin-top:12px">No matches yet. Every finished match (practice, career or online) is saved here, in this browser.</p>'}`);
    this.modal.querySelector('.modal').classList.add('wide');
  }

  openModal(html) {
    this.closeModal();
    const el = document.createElement('div');
    el.className = 'screen';
    el.id = 'modal';
    el.style.zIndex = 20;
    el.innerHTML = `<div class="panel modal">${html}<div class="row" style="margin-top:18px"><span class="grow"></span><button class="btn" data-act="closeModal">Close</button></div></div>`;
    this.root.appendChild(el);
    this.modal = el;
    return el;
  }

  closeModal() { $('#modal')?.remove(); this.modal = null; this.onModalClose?.(); this.onModalClose = null; }

  /** Player + racket customisation with a live 3D preview. Returns the preview canvas. */
  equipmentModal(look, unlocked = null) {
    const arch = ARCHETYPES.map((a) => `<button class="opt" data-act="lookArch" data-val="${a.id}"><b>${esc(a.name)}</b><span class="mute">${esc(a.blurb)}</span></button>`).join('');
    const hair = HAIR_STYLES.map((h, i) => `<button data-act="lookHair" data-val="${i}">${esc(h)}</button>`).join('');
    const skin = SKIN_TONES.map((c, i) => `<button class="swatch-btn" data-act="lookSkin" data-val="${i}" style="background:#${c.toString(16).padStart(6, '0')}" aria-label="Skin tone ${i + 1}"></button>`).join('');
    const rk = RACKETS.map((r) => `<button class="opt racket" data-act="lookRacket" data-val="${r.id}" ${!unlocked || unlocked.includes(r.id) ? '' : 'disabled title="Unlock it in Career objectives"'}><i style="background:#${r.face.toString(16).padStart(6, '0')};border-color:#${r.accent.toString(16).padStart(6, '0')}"></i><span><b>${esc(r.name)}</b> <span class="mute">${esc(r.category)}</span><br><span class="mute">${esc(r.note)}</span></span></button>`).join('');
    const el = this.openModal(`<h2>Equipment</h2><div class="equip">
      <div class="equip-view"><canvas id="previewCanvas" width="320" height="380"></canvas>
        <div class="row" style="flex-wrap:wrap"><button class="btn small" data-act="previewMode" data-val="character">Player</button><button class="btn small" data-act="previewMode" data-val="racket">Inspect racket</button><button class="btn small ghost" data-act="previewTeam">Team colour</button></div></div>
      <div class="equip-opts">
        <div class="label">Player</div><div class="optgrid">${arch}</div>
        <div class="label">Hair</div><div class="seg wrap">${hair}</div>
        <div class="label">Skin tone</div><div class="row">${skin}</div>
        <div class="label">Racket <span class="mute">(cosmetic: no gameplay advantage)</span></div><div class="optgrid">${rk}</div>
      </div></div>`);
    el.querySelector('.modal').classList.add('wide');
    this.markEquipment(look);
    return el.querySelector('#previewCanvas');
  }

  markEquipment(look) {
    const want = { lookArch: look.arch, lookHair: look.hair, lookSkin: look.skin, lookRacket: look.racket };
    document.querySelectorAll('#modal [data-act^=look]').forEach((b) => b.classList.toggle('on', want[b.dataset.act] === +b.dataset.val));
  }

  controlsModal(s, st) {
    const el = $('#modal');
    if (el) { this.reopenScroll = el.querySelector('.modal').scrollTop; el.remove(); this.modal = null; } // keep the scroll position when the screen refreshes
    const m = this.openModal(controlsHtml(s, st));
    m.querySelector('.modal').classList.add('wide');
    if (this.reopenScroll) { m.querySelector('.modal').scrollTop = this.reopenScroll; this.reopenScroll = 0; }
    return m;
  }

  pauseMenu(local = false, mouseAimOn = false) {
    this.openModal(`<h2>Paused</h2><p class="mute" style="margin-bottom:14px">${local ? 'The match is stopped.' : 'Online matches cannot be stopped: the game keeps running for the other players.'}</p>
      <div class="col"><button class="btn primary" data-act="closeModal">Resume</button><button class="btn" data-act="mouseAim" data-val="${mouseAimOn ? 0 : 1}" data-pause="1">Mouse aim: ${mouseAimOn ? 'ON (click to switch off)' : 'OFF (click to switch on)'}</button><button class="btn" data-act="settings">Settings</button><button class="btn" data-act="controls">Controls</button><button class="btn ghost" data-act="leave">Leave match</button></div>`);
  }

  controls() {
    this.openModal(`<h2>How to play</h2>
      <div class="kv">
        <span class="k">W A S D / Arrows</span><span>Move (both work). The camera follows you, so W always runs toward the net.</span>
        <span class="k">Aim</span><span>While you swing you are planted, and the direction you hold at the moment of contact is where the ball goes: left/right = that side, up = deep, down = short. With no direction it picks the open side. With mouse aim on (Settings, the pause menu or the M key) the target ring follows the cursor and left click hits (right click = globo).</span>
        <span class="k">Space</span><span><b>Hit</b>. To serve, the ball bounces in your hand (slowly): HOLD Space to charge power and release to hit (a tap is a normal serve, a full charge is +22% pace but less accurate); hit it as it rises to waist height (the lower and higher you hit it, the less accurate). R = slice serve, Q = kick serve; hold a direction to aim it. A circle closes in on the ball: press Space when it touches the small inner ring. Green = PERFECT, white = GOOD, red = LATE. Mouse left-click does the same.</span>
        <span class="k">R</span><span>Hits a slice (press it instead of Space): backspin that skids low and slow off the floor and glass.</span>
        <span class="k">Q</span><span>Hits a soft shot: chiquita near the net, dejada (drop shot) from deep, <b>víbora</b> (sidespin) on overheads.</span>
        <span class="k">E</span><span>Hits a controlled shot: block on low balls, <b>bandeja</b> (backspin, placed deep) on overheads.</span>
        <span class="k">G / Enter</span><span>Globo (lob), a high ball over opponents at the net. Mouse right-click does the same. Overheads with no key: remate (smash).</span>
        <span class="k">X</span><span>Jump for high balls.</span>
        <span class="k">Shift</span><span>Sprint (uses stamina).</span>
        <span class="k">Tab / Esc</span><span>Match stats / menu. Keys 1–4 send quick chat.</span>
      </div>
      <p class="mute" style="margin-top:14px;line-height:1.5">Rules: the ball must bounce once on the opponents' side before touching glass. After that you may play it off the walls. Two bounces, hitting the glass first, the net or out = point lost. Serve underhand into the diagonal box; two faults lose the point. Your partner and you cannot hit twice in a row.</p>`);
  }

  settingsModal(onChange) {
    const mouseAimOn = !!this.getMouseAim?.();
    const range = (key, min, max, step, label) => `<div class="setting"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${settings[key]}" data-range="${key}" style="max-width:200px"></div>`;
    const tog = (key, label) => `<div class="setting"><span>${label}</span><div class="seg"><button data-act="toggle" data-key="${key}" data-val="1" class="${settings[key] ? 'on' : ''}">On</button><button data-act="toggle" data-key="${key}" data-val="0" class="${settings[key] ? '' : 'on'}">Off</button></div></div>`;
    const el = this.openModal(`<h2>Settings</h2>
      <div class="setting"><span>Graphics quality</span><div class="seg">${['low', 'medium', 'high'].map((q) => `<button data-act="quality" data-val="${q}" class="${settings.quality === q ? 'on' : ''}">${q}</button>`).join('')}</div></div>
      ${range('master', 0, 1, 0.05, 'Master volume')}
      ${range('sfx', 0, 1, 0.05, 'Effects volume')}
      ${range('ambience', 0, 1, 0.05, 'Environment volume')}
      ${tog('announcer', 'Announcer (spoken score)')}
      ${range('voice', 0, 1, 0.05, 'Announcer volume')}
      ${range('music', 0, 1, 0.05, 'Music volume')}
<div class="setting"><span>Camera</span><div class="seg">${['player', 'broadcast', 'tactical', 'custom'].map((c) => `<button data-act="camera" data-val="${c}" class="${settings.camera === c ? 'on' : ''}">${c}</button>`).join('')}</div></div>
      ${tog('ballTrack', 'Camera drifts toward the ball')}
      ${settings.camera === 'custom' ? range('camDist', 4, 16, 0.1, 'Custom: distance') + range('camHeight', 2.5, 16, 0.1, 'Custom: height') + range('camSmooth', 2, 12, 0.5, 'Custom: smoothing') + range('camFov', 36, 70, 1, 'Custom: field of view') : '<p class="mute" style="font-size:12px;margin:4px 0">Player: behind you · Broadcast: whole court, high · Tactical: overhead view of the positions · Custom: your own distance, height, smoothing and field of view.</p>'}
      ${range('ballScale', 1, 4, 0.1, 'Ball size (visibility)')}
      <div class="setting"><span>Aim with the mouse (click to hit)</span><div class="seg"><button data-act="mouseAim" data-val="1" class="${mouseAimOn ? 'on' : ''}">On</button><button data-act="mouseAim" data-val="0" class="${mouseAimOn ? '' : 'on'}">Off</button></div></div>
      ${tog('timing', 'Timing indicator')}
      ${tog('replays', 'Instant replays after points (solo matches)')}
      ${tog('trail', 'Ball trail')}
      ${tog('highContrast', 'High contrast UI')}
      <div class="setting"><span>Controls (keyboard, mouse, gamepad)</span><button class="btn small primary" data-act="controlsSettings">Configure…</button></div>
      <div class="setting"><span>Fullscreen</span><button class="btn small" data-act="fullscreen">Toggle</button></div>`);
    el.addEventListener('input', (e) => {
      const k = e.target.dataset.range;
      if (k) { setSetting(k, +e.target.value); onChange(k); }
    });
  }

  profileModal(profile, name) {
    if (!profile) { this.openModal('<h2>Profile</h2><p class="mute">Loading…</p>'); return; }
    const hist = profile.history.length
      ? `<table class="table"><tr><th>Result</th><th>Score</th><th>Length</th></tr>${profile.history.slice(0, 8).map((h) => `<tr><td style="color:${h.won ? 'var(--accent)' : 'var(--bad)'}">${h.won ? 'Win' : 'Loss'}</td><td>${esc(h.score)}</td><td>${Math.floor(h.duration / 60)} min</td></tr>`).join('')}</table>`
      : '<p class="mute">No matches yet. Play one!</p>';
    this.openModal(`<h2>${esc(name)}</h2>
      <div class="row" style="gap:28px;margin-bottom:14px"><div><div class="label">Level</div><div style="font-size:26px;font-weight:800">${profile.level}</div></div><div><div class="label">XP</div>${profile.xp}</div><div><div class="label">Record</div>${profile.wins}W – ${profile.losses}L</div></div>
      <div class="label" style="margin-bottom:6px">Recent matches</div>${hist}`);
  }
}

function statsTable(players, names, singles = false) {
  const rows = players.map((p, i) => singles && i % 2 ? '' : `<tr><td><span class="swatch" style="background:${TEAM_COLORS[i >> 1]};margin-right:8px"></span>${esc(names[i])}</td><td>${p.winners + p.aces}</td><td>${p.errors}</td><td>${p.aces}</td><td>${p.smashes}</td><td>${p.volleys}</td><td>${p.bandejas + p.viboras}</td><td>${p.hits}</td></tr>`).join('');
  return `<table class="table"><tr><th>Player</th><th>Winners</th><th>Errors</th><th>Aces</th><th>Smashes</th><th>Volleys</th><th>Bandeja/Víbora</th><th>Shots</th></tr>${rows}</table>`;
}
