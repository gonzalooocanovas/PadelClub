// Room lifecycle: Lobby → Team selection → Ready check → Match → Results → Rematch.

import crypto from 'node:crypto';
import { PadelGame } from '../shared/game.js';
import { botInput, makeBotMemory } from '../shared/ai.js';
import { DEFAULT_SETTINGS, SNAPSHOT_EVERY, SERVER_TICK } from '../shared/constants.js';
import { scoreView } from '../shared/scoring.js';
import { CAREER, starsFor } from '../shared/career.js';
import { sanitizeLook, COURT_IDS } from '../shared/looks.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_QUEUE = 10;
const RESULTS_DELAY = 4; // seconds of celebration before the results screen
const LOBBY_GRACE_MS = 60_000;
const EMPTY_ROOM_TTL_MS = 10 * 60_000;
export const PAUSE_REQUEST_MS = 10_000; // how long the others have to accept
export const PAUSE_MAX_MS = 30_000; // a pause never lasts longer than this
const PAUSES_PER_PLAYER = 2;

const cleanName = (n) => String(n ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Guest';
const cleanText = (t) => String(t ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 140);

export class Room {
  constructor(code, store, onEmpty) {
    this.code = code;
    this.store = store;
    this.onEmpty = onEmpty;
    this.members = new Map(); // id -> member
    this.slots = [null, null, null, null]; // {kind:'human', id} | {kind:'bot'} | null
    this.hostId = null;
    this.state = 'lobby';
    this.settings = { ...DEFAULT_SETTINGS, fillBots: true, public: false };
    this.career = null; // stage id when this room is a career match
    this.game = null;
    this.queues = [[], [], [], []];
    this.lastInput = [null, null, null, null];
    this.starved = [0, 0, 0, 0];
    this.botMem = [0, 1, 2, 3].map(makeBotMemory);
    this.resultAt = 0;
    this.persisted = false;
    this.emptySince = null;
    this.chatTimes = new Map();
    this.pause = null; // {phase:'request'|'active', by, accepts:Set, resumes:Set, expires|until}
    this.pausesUsed = new Map(); // member id -> pauses used this match
  }

  // ------------------------------------------------------------ membership

  humanCount() {
    return [...this.members.values()].length;
  }

  addMember({ token, name, ws, look }) {
    const id = crypto.randomBytes(3).toString('hex');
    const m = { id, token, name: cleanName(name), ws, connected: true, ready: false, rtt: 0, dropTimer: null, look: look ? sanitizeLook(look) : null };
    this.members.set(id, m);
    if (!this.hostId) this.hostId = id;
    // take the first free slot, otherwise replace a bot
    const act = this.activeSlots();
    let slot = act.find((i) => this.slots[i] === null);
    if (slot === undefined) slot = act.find((i) => this.slots[i]?.kind === 'bot');
    this.slots[slot] = { kind: 'human', id };
    this.emptySince = null;
    return m;
  }

  activeSlots(mode = this.settings.mode) { return mode === 'singles' ? [0, 2] : [0, 1, 2, 3]; }

  slotOf(id) {
    return this.slots.findIndex((s) => s?.kind === 'human' && s.id === id);
  }

  canJoin() {
    if (this.state !== 'lobby') return 'Match already in progress';
    const free = this.activeSlots().some((i) => this.slots[i] === null || this.slots[i].kind === 'bot');
    if (!free) return 'Room is full';
    return null;
  }

  removeMember(id) {
    const m = this.members.get(id);
    if (!m) return;
    clearTimeout(m.dropTimer);
    this.members.delete(id);
    const slot = this.slotOf(id);
    if (slot >= 0) this.slots[slot] = this.state === 'match' ? { kind: 'bot' } : null;
    if (this.hostId === id) {
      const next = [...this.members.values()].find((x) => x.connected) || [...this.members.values()][0];
      this.hostId = next ? next.id : null;
    }
    if (this.members.size === 0) this.emptySince = Date.now();
    this.broadcastRoom();
  }

  disconnect(member) {
    member.connected = false;
    member.ws = null;
    member.ready = this.state === 'lobby' ? false : member.ready;
    if (this.hostId === member.id) {
      const next = [...this.members.values()].find((x) => x.connected);
      if (next) this.hostId = next.id;
    }
    // In a match a bot covers the slot immediately (see step()); in the lobby the seat is held briefly.
    if (this.state !== 'match') {
      member.dropTimer = setTimeout(() => this.removeMember(member.id), LOBBY_GRACE_MS);
      member.dropTimer.unref?.();
    }
    if (![...this.members.values()].some((x) => x.connected)) this.emptySince = Date.now();
    this.broadcastRoom();
  }

  reconnect(member, ws) {
    clearTimeout(member.dropTimer);
    member.ws = ws;
    member.connected = true;
    this.emptySince = null;
    this.queues[this.slotOf(member.id)] = [];
    this.broadcastRoom();
    if (this.state === 'match' && this.game) { this.sendStart(member); if (this.pause) this.send(member, this.pauseView()); }
    if (this.state === 'results' && this.lastResultsMsg) this.send(member, this.lastResultsMsg);
  }

  // ------------------------------------------------------------ messaging

  send(member, msg) {
    if (member.ws && member.ws.readyState === 1) member.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  broadcast(msg) {
    const s = typeof msg === 'string' ? msg : JSON.stringify(msg);
    for (const m of this.members.values()) this.send(m, s);
  }

  roomView() {
    return {
      t: 'room',
      code: this.code,
      hostId: this.hostId,
      state: this.state,
      settings: this.settings,
      slots: this.slots.map((s) => {
        if (!s) return null;
        if (s.kind === 'bot') return { kind: 'bot', name: s.name || 'AI' };
        const m = this.members.get(s.id);
        return { kind: 'human', id: m.id, name: m.name, ready: m.ready || m.id === this.hostId, connected: m.connected, rtt: m.rtt, look: m.look };
      }),
    };
  }

  broadcastRoom() {
    const v = this.roomView();
    for (const m of this.members.values()) this.send(m, { ...v, you: m.id, youSlot: this.slotOf(m.id) });
  }

  // ------------------------------------------------------------ lobby actions

  isHost(m) { return m.id === this.hostId; }

  sit(m, slot) {
    if (this.state !== 'lobby') return 'Teams are locked during a match';
    if (!this.activeSlots().includes(slot)) return 'Bad slot';
    const cur = this.slotOf(m.id);
    if (cur === slot) return null;
    const target = this.slots[slot];
    if (target?.kind === 'human') return 'That seat is taken';
    this.slots[cur] = null;
    this.slots[slot] = { kind: 'human', id: m.id };
    m.ready = false;
    return null;
  }

  assign(host, id, slot) {
    if (!this.isHost(host)) return 'Only the host can move players';
    if (this.state !== 'lobby') return 'Teams are locked during a match';
    const m = this.members.get(id);
    if (!m || !this.activeSlots().includes(slot)) return 'Bad request';
    const cur = this.slotOf(id);
    const target = this.slots[slot];
    this.slots[cur] = target?.kind === 'human' ? target : null; // swap with whoever sits there
    this.slots[slot] = { kind: 'human', id };
    for (const x of this.members.values()) x.ready = false;
    return null;
  }

  setSettings(host, s) {
    if (!this.isHost(host)) return 'Only the host can change settings';
    if (this.state !== 'lobby') return 'Settings are locked during a match';
    const n = { ...this.settings };
    if ([1, 3, 5].includes(s.sets)) n.sets = s.sets;
    if ([2, 4, 6].includes(s.gamesPerSet)) n.gamesPerSet = s.gamesPerSet;
    if (typeof s.goldenPoint === 'boolean') n.goldenPoint = s.goldenPoint;
    if (['easy', 'normal', 'hard', 'expert'].includes(s.difficulty)) n.difficulty = s.difficulty;
    if (typeof s.fillBots === 'boolean') n.fillBots = s.fillBots;
    if (typeof s.public === 'boolean') n.public = s.public;
    if (COURT_IDS.includes(s.court)) n.court = s.court;
    if ((s.mode === 'singles' || s.mode === 'doubles') && s.mode !== n.mode) {
      const err = this.applyMode(s.mode);
      if (err) return err;
      n.mode = s.mode;
    }
    this.settings = n;
    return null;
  }

  /** Switching to 1v1 moves everybody into the two singles seats (or refuses if there are too many humans). */
  applyMode(mode) {
    if (mode === 'singles') {
      const humans = [1, 3].map((i) => this.slots[i]).filter((s) => s?.kind === 'human');
      const free = [0, 2].filter((i) => this.slots[i]?.kind !== 'human');
      if (humans.length > free.length) return 'Too many players for 1v1 (max 2)';
      for (const i of [1, 3]) {
        const s = this.slots[i];
        if (s?.kind === 'human') this.slots[free.shift()] = s;
        this.slots[i] = null;
      }
      for (const i of [0, 2]) if (this.slots[i]?.kind === 'bot') this.slots[i] = null;
    }
    for (const m of this.members.values()) m.ready = false;
    return null;
  }

  canStart() {
    if (this.state !== 'lobby') return 'Not in the lobby';
    const act = this.activeSlots();
    const filled = act.filter((i) => this.slots[i]).length;
    if (filled < act.length && !this.settings.fillBots) return 'Need four players (or enable AI fill)';
    const notReady = [...this.members.values()].filter((m) => !this.isHost(m) && !m.ready && m.connected);
    if (notReady.length) return `${notReady.map((m) => m.name).join(', ')} not ready`;
    // team balance: each team needs at least one human or a bot to fill
    return null;
  }

  start(host) {
    if (!this.isHost(host)) return 'Only the host can start';
    const err = this.canStart();
    if (err) return err;
    this.beginMatch();
    return null;
  }

  beginMatch() {
    const act = this.activeSlots();
    for (let i = 0; i < 4; i++) this.slots[i] = act.includes(i) ? this.slots[i] || { kind: 'bot' } : null;
    this.state = 'match';
    this.game = new PadelGame({ settings: this.settings });
    this.queues = [[], [], [], []];
    this.lastInput = [null, null, null, null];
    this.starved = [0, 0, 0, 0];
    this.botMem = [0, 1, 2, 3].map(makeBotMemory);
    this.persisted = false;
    this.pause = null; this.pausesUsed = new Map();
    this.resultAt = 0;
    this.lastResultsMsg = null;
    for (const m of this.members.values()) { m.ready = false; m.rematch = false; }
    this.broadcastRoom();
    for (const m of this.members.values()) this.sendStart(m);
  }

  sendStart(m) {
    const names = this.slots.map((s) => (s?.kind === 'human' ? this.members.get(s.id).name : s?.name || 'AI'));
    this.send(m, {
      t: 'start', slot: this.slotOf(m.id), names, settings: this.settings,
      looks: this.slots.map((s, i) => sanitizeLook(s?.kind === 'human' ? this.members.get(s.id)?.look : s?.look, i)),
      score: scoreView(this.game.match), tickRate: SERVER_TICK,
    });
  }

  rematch(m) {
    if (this.state !== 'results') return 'No finished match';
    m.rematch = true;
    const waiting = [...this.members.values()].filter((x) => x.connected && !x.rematch);
    this.broadcast({ t: 'rematchVotes', ready: [...this.members.values()].filter((x) => x.rematch).map((x) => x.id) });
    if (waiting.length === 0) this.beginMatch();
    return null;
  }

  /** Career: configure the room from a stage (named bots with their own levels) and start at once. */
  setupCareer(stage, member) {
    this.career = stage.id;
    this.settings = {
      ...DEFAULT_SETTINGS, fillBots: true, public: false, mode: stage.mode, difficulty: stage.difficulty, court: stage.court || 'indoor',
      sets: stage.sets, gamesPerSet: stage.gamesPerSet, goldenPoint: !!stage.golden,
    };
    const bot = (name, diff, look) => ({ kind: 'bot', name, diff, look });
    this.slots = [{ kind: 'human', id: member.id }, null, null, null];
    if (stage.mode === 'doubles') {
      this.slots[1] = bot(stage.partner, stage.partnerDiff || stage.difficulty, stage.looks?.[0]);
      this.slots[2] = bot(stage.opponents[0], stage.difficulty, stage.looks?.[1]);
      this.slots[3] = bot(stage.opponents[1], stage.difficulty, stage.looks?.[2]);
    } else {
      this.slots[2] = bot(stage.opponents[0], stage.difficulty, stage.looks?.[0]);
    }
    this.beginMatch();
  }

  toLobby(host) {
    if (this.career) return 'Career matches have no lobby';
    if (!this.isHost(host)) return 'Only the host can return to the lobby';
    if (this.state === 'match') return 'Match in progress';
    this.state = 'lobby';
    this.game = null;
    for (const m of this.members.values()) { m.ready = false; m.rematch = false; }
    this.broadcastRoom();
    return null;
  }

  chat(m, text) {
    const now = Date.now();
    const last = this.chatTimes.get(m.id) || 0;
    if (now - last < 400) return;
    this.chatTimes.set(m.id, now);
    const t = cleanText(text);
    if (t) this.broadcast({ t: 'chat', id: m.id, name: m.name, slot: this.slotOf(m.id), text: t });
  }

  emote(m, id) {
    if (!Number.isInteger(id) || id < 0 || id > 7) return;
    this.broadcast({ t: 'emote', slot: this.slotOf(m.id), id });
  }

  pushInputs(m, inputs) {
    if (this.state !== 'match' || !Array.isArray(inputs)) return;
    const slot = this.slotOf(m.id);
    if (slot < 0) return;
    const q = this.queues[slot];
    for (const inp of inputs.slice(0, 8)) {
      if (!inp || typeof inp !== 'object') continue;
      q.push(inp);
    }
    // never let lag build an unbounded backlog; keep swing/jump intents when trimming
    while (q.length > MAX_QUEUE) {
      const d = q.shift();
      if (d.swing) q[0].swing = true;
      if (d.jump) q[0].jump = true;
    }
  }

  // ------------------------------------------------------------ pause (online)
  // One player asks, the other humans accept. The game then stops for at most 30 s, or until every human presses Resume.

  connectedHumans() {
    return [...this.members.values()].filter((m) => m.connected && this.slotOf(m.id) >= 0);
  }

  pauseView(extra = {}) {
    const p = this.pause;
    if (!p) return { t: 'pause', phase: 'off', ...extra };
    const name = (id) => this.members.get(id)?.name || '?';
    return {
      t: 'pause', phase: p.phase, by: name(p.by), byId: p.by, expires: p.expires, until: p.until, now: Date.now(),
      accepted: [...p.accepts].map(name), resumed: [...(p.resumes || [])].map(name), resumedIds: [...(p.resumes || [])], humans: this.connectedHumans().map((m) => m.id), ...extra,
    };
  }

  /** kind: 'req' | 'accept' | 'deny' | 'resume'. Returns an error message or null. */
  pauseCtl(m, kind, now = Date.now()) {
    if (this.state !== 'match' || !this.game || this.game.phase === 'ended') return 'There is no match to pause';
    if (this.slotOf(m.id) < 0) return 'Only players can pause';
    const p = this.pause;
    if (kind === 'req') {
      if (p) return p.phase === 'active' ? 'Already paused' : 'A pause was already requested';
      if ((this.pausesUsed.get(m.id) || 0) >= PAUSES_PER_PLAYER) return 'You have used your pauses for this match';
      this.pause = { phase: 'request', by: m.id, accepts: new Set([m.id]), resumes: new Set(), expires: now + PAUSE_REQUEST_MS };
      this.pauseEvaluate(now);
      if (this.pause?.phase === 'request') this.broadcast(this.pauseView());
      return null;
    }
    if (!p) return null;
    if (kind === 'accept' && p.phase === 'request' && m.id !== p.by) { p.accepts.add(m.id); this.pauseEvaluate(now); if (this.pause?.phase === 'request') this.broadcast(this.pauseView()); return null; }
    if (kind === 'deny' && p.phase === 'request' && m.id !== p.by) { this.pause = null; this.broadcast({ t: 'pause', phase: 'denied', by: m.name }); return null; }
    if (kind === 'resume' && p.phase === 'active') { p.resumes.add(m.id); this.pauseEvaluate(now); if (this.pause) this.broadcast(this.pauseView()); return null; }
    return null;
  }

  /** Move the pause forward: accepted by everybody, resumed by everybody, or timed out. */
  pauseEvaluate(now = Date.now()) {
    const p = this.pause;
    if (!p) return;
    const humans = this.connectedHumans();
    if (p.phase === 'request') {
      if (now >= p.expires) { this.pause = null; this.broadcast({ t: 'pause', phase: 'denied', by: '', expired: true }); return; }
      if (humans.every((h) => p.accepts.has(h.id))) {
        p.phase = 'active'; p.until = now + PAUSE_MAX_MS; p.resumes = new Set();
        this.pausesUsed.set(p.by, (this.pausesUsed.get(p.by) || 0) + 1);
        this.broadcast(this.pauseView());
      }
      return;
    }
    if (now >= p.until || humans.every((h) => p.resumes.has(h.id))) {
      this.pause = null;
      for (let s = 0; s < 4; s++) { this.queues[s] = []; this.lastInput[s] = null; this.starved[s] = 0; } // nothing stale carries over
      this.broadcast({ t: 'pause', phase: 'off' });
    }
  }

  // ------------------------------------------------------------ simulation

  step(dt) {
    const g = this.game;
    if (!g) return;
    if (this.pause) { this.pauseEvaluate(); if (this.pause?.phase === 'active') return; } // the match is frozen while paused
    for (let s = 0; s < 4; s++) {
      if (!g.players[s].active) continue;
      const slot = this.slots[s];
      const m = slot?.kind === 'human' ? this.members.get(slot.id) : null;
      g.players[s].human = !!(m && m.connected); // bots read this to play sensibly with a person as partner
      if (m && m.connected) {
        const q = this.queues[s];
        let inp = q.shift();
        if (inp) {
          this.lastInput[s] = inp;
          this.starved[s] = 0;
          g.players[s].ack = Number.isInteger(inp.seq) ? inp.seq : g.players[s].ack;
        } else if (this.lastInput[s]) {
          // no fresh input (lag spike or hidden tab): repeat briefly, then stand still
          const stale = ++this.starved[s] > 15;
          inp = { ...this.lastInput[s], swing: false, jump: false, ...(stale ? { mx: 0, mz: 0, sprint: false } : {}) };
        }
        if (inp) g.applyInput(s, inp);
      } else {
        g.applyInput(s, botInput(g, s, this.botMem[s], slot?.diff || this.settings.difficulty, dt));
      }
    }
    g.tick(dt);
    const evs = g.drainEvents();
    if (evs.length) {
      this.broadcast({ t: 'ev', ev: evs });
      const done = evs.find((e) => e.e === 'match');
      if (done) this.finishMatch(done);
    }
    if (g.tickNo % SNAPSHOT_EVERY === 0) this.broadcast(g.snapshot());
    if (this.resultAt && g.time >= this.resultAt && this.state === 'match') {
      this.state = 'results';
      this.broadcastRoom();
      this.broadcast(this.lastResultsMsg);
    }
  }

  finishMatch(ev) {
    if (this.persisted) return;
    this.persisted = true;
    const humans = [];
    for (let s = 0; s < 4; s++) {
      const slot = this.slots[s];
      if (slot?.kind === 'human') {
        const m = this.members.get(slot.id);
        if (m) humans.push({ token: m.token, id: m.id, name: m.name, slot: s, team: s >> 1 });
      }
    }
    const gains = this.store.recordMatch({ code: this.code, humans, results: ev.results, settings: this.settings });
const names = this.slots.map((s) => (s?.kind === 'human' ? this.members.get(s.id)?.name : s?.name || 'AI'));
    const progress = {};
    for (const h of humans) progress[h.id] = gains[h.token];
    let career = null;
    const stage = this.career && CAREER.find((c) => c.id === this.career);
    if (stage && humans[0]) {
      const stars = starsFor(ev.results);
      const c = this.store.careerComplete(humans[0].token, stage.id, stars);
      career = { stage: stage.id, name: stage.name, won: stars > 0, stars, bonusXp: c.bonusXp, unlocked: c.unlocked, hasNext: stage.id < CAREER.length };
    }
    this.lastResultsMsg = JSON.stringify({ t: 'results', results: ev.results, names, progress, career });
    this.resultAt = this.game.time + RESULTS_DELAY;
  }

  expired(now) {
    return this.emptySince !== null && now - this.emptySince > EMPTY_ROOM_TTL_MS;
  }
}

export class RoomManager {
  constructor(store) {
    this.store = store;
    this.rooms = new Map();
    this.byToken = new Map(); // token -> {room, id}
  }

  newCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  create({ token, name, ws, look }) {
    const room = new Room(this.newCode(), this.store);
    this.rooms.set(room.code, room);
    const m = room.addMember({ token, name, ws, look });
    this.byToken.set(token, { room, id: m.id });
    return { room, member: m };
  }

  join(code, { token, name, ws, look }) {
    const room = this.rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return { error: 'Room not found. Check the code and try again.' };
    const err = room.canJoin();
    if (err) return { error: err };
    const m = room.addMember({ token, name, ws, look });
    this.byToken.set(token, { room, id: m.id });
    return { room, member: m };
  }

  /** Open lobbies that chose to be public and still have a free seat. */
  listPublic() {
    const out = [];
    for (const r of this.rooms.values()) {
      if (r.state !== 'lobby' || !r.settings.public || r.career || r.canJoin()) continue;
      const host = r.members.get(r.hostId);
      const act = r.activeSlots();
      out.push({
        code: r.code, host: host ? host.name : '?', mode: r.settings.mode, difficulty: r.settings.difficulty,
        players: act.filter((i) => r.slots[i]?.kind === 'human').length, max: act.length,
      });
    }
    return out.slice(0, 30);
  }

  /** The room/member this guest identity currently belongs to, if still alive. */
  membership(token) {
    const e = this.byToken.get(token);
    if (!e) return null;
    const member = e.room.members.get(e.id);
    if (!member || !this.rooms.has(e.room.code)) { this.byToken.delete(token); return null; }
    return { room: e.room, member };
  }

  leave(token) {
    const ms = this.membership(token);
    if (!ms) return;
    this.byToken.delete(token);
    ms.room.removeMember(ms.member.id);
  }

  step(dt) {
    for (const r of this.rooms.values()) if (r.state === 'match') r.step(dt);
  }

  sweep(now = Date.now()) {
    for (const [code, r] of this.rooms) {
      if (r.expired(now) || (r.members.size === 0 && r.emptySince !== null && now - r.emptySince > 30_000)) {
        for (const m of r.members.values()) this.byToken.delete(m.token);
        this.rooms.delete(code);
      }
    }
  }
}
