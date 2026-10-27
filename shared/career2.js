// Career v2: seasons, tournaments with real brackets, ranking, objectives, training results, player development.
// Pure logic (no DOM, no storage handle of its own): it is unit-tested in Node and used by the browser.
// Matches the player does not play are SIMULATED with the same game engine and bots, so the brackets are real results.

import { ROSTER, ROSTER_BY_ID } from './roster.js';
import { PadelGame } from './game.js';
import { botInput, makeBotMemory } from './ai.js';

export const CAREER_VERSION = 2;
export const ATTRS = ['groundstroke', 'volley', 'smash', 'lob', 'movement', 'reaction', 'stamina', 'defense', 'variety'];
export const ATTR_LABELS = {
  groundstroke: 'Groundstroke consistency', volley: 'Volley control', smash: 'Smash power', lob: 'Lob precision',
  movement: 'Movement', reaction: 'Reaction', stamina: 'Stamina', defense: 'Defensive recovery', variety: 'Shot variety',
};
export const ATTR_MAX = 10;

// round names by bracket size
const KO_ROUNDS = { 4: ['Semi-final', 'Final'], 8: ['Quarter-final', 'Semi-final', 'Final'] };

export const EVENTS = [
  { id: 'club-open', season: 1, tier: 'Club', name: 'Club Open', blurb: 'The club opens its doors. A small singles draw, a friendly crowd.', court: 'indoor', format: 'knockout', size: 4, mode: 'singles', pool: ['pablo', 'marta', 'luis', 'sofi'], sets: 1, gamesPerSet: 3, points: 30, coins: 60, xp: 80 },
  { id: 'club-doubles', season: 1, tier: 'Club', name: 'Club Doubles Cup', blurb: 'Your first doubles event. Sofi plays beside you.', court: 'indoor', format: 'knockout', size: 4, mode: 'doubles', partner: 'sofi', pool: ['marta', 'luis', 'pablo', 'diego', 'ana', 'carla'], sets: 1, gamesPerSet: 3, points: 40, coins: 80, xp: 100 },
  { id: 'sunday-league', season: 1, tier: 'League', name: 'Sunday League', blurb: 'Everyone plays everyone. Win your group to reach the final.', court: 'outdoor', format: 'group', size: 4, mode: 'singles', pool: ['diego', 'ana', 'carla', 'nico', 'marta'], sets: 1, gamesPerSet: 4, points: 60, coins: 100, xp: 140 },
  { id: 'league-final', season: 1, tier: 'League', name: 'League Final', blurb: 'The season finale under the Mediterranean sun. Ana is your partner.', court: 'outdoor', format: 'knockout', size: 8, mode: 'doubles', partner: 'ana', pool: ['diego', 'carla', 'nico', 'luis', 'marta', 'sofi', 'pablo', 'kai', 'lucia'], sets: 1, gamesPerSet: 4, points: 90, coins: 140, xp: 190 },
  { id: 'regional-qualifier', season: 2, tier: 'Regional', name: 'Regional Qualifier', blurb: 'The first serious draw: tougher opponents in every round.', court: 'indoor', format: 'knockout', size: 8, mode: 'singles', pool: ['nico', 'diego', 'ana', 'carla', 'kai', 'lucia', 'ruben', 'javi'], sets: 1, gamesPerSet: 4, points: 130, coins: 180, xp: 240, requires: { points: 100 } },
  { id: 'regional-doubles', season: 2, tier: 'Regional', name: 'Regional Doubles', blurb: 'Golden-point doubles under the floodlights with Mateo.', court: 'night', format: 'group', size: 4, mode: 'doubles', partner: 'mateo', pool: ['kai', 'lucia', 'ruben', 'elena', 'javi', 'carla', 'nico'], sets: 1, gamesPerSet: 4, golden: true, points: 160, coins: 220, xp: 280 },
  { id: 'national-open', season: 2, tier: 'National', name: 'National Open', blurb: 'A national draw. Styles clash: watch your scouting notes.', court: 'outdoor', format: 'knockout', size: 8, mode: 'singles', pool: ['kai', 'lucia', 'ruben', 'mateo', 'elena', 'javi', 'nico', 'ana'], sets: 1, gamesPerSet: 5, points: 200, coins: 260, xp: 330 },
  { id: 'national-doubles', season: 2, tier: 'National', name: 'National Doubles', blurb: 'The best pairs in the country, in the arena.', court: 'night', format: 'knockout', size: 8, mode: 'doubles', partner: 'mateo', pool: ['kai', 'lucia', 'ruben', 'mateo', 'elena', 'javi', 'carla', 'ana', 'vega'], sets: 1, gamesPerSet: 5, golden: true, points: 240, coins: 300, xp: 380 },
  { id: 'pro-qualifying', season: 3, tier: 'Pro Tour', name: 'Pro Qualifying', blurb: 'Win here to join the tour. Nothing is easy now.', court: 'indoor', format: 'knockout', size: 4, mode: 'singles', pool: ['ruben', 'mateo', 'elena', 'javi', 'vega'], sets: 1, gamesPerSet: 6, points: 280, coins: 340, xp: 430, requires: { points: 350 } },
  { id: 'international-tour', season: 3, tier: 'Pro Tour', name: 'International Tour', blurb: 'Round-robin against the circuit regulars.', court: 'night', format: 'group', size: 4, mode: 'doubles', partner: 'mateo', pool: ['ruben', 'elena', 'javi', 'lucia', 'kai', 'vega', 'rios'], sets: 1, gamesPerSet: 6, golden: true, points: 330, coins: 380, xp: 480 },
  { id: 'the-major', season: 3, tier: 'Major', name: 'The Major', blurb: 'Best of three, golden point. The sport\'s biggest stage.', court: 'night', format: 'knockout', size: 8, mode: 'doubles', partner: 'mateo', pool: ['ruben', 'elena', 'javi', 'lucia', 'kai', 'vega', 'rios', 'mateo'], sets: 3, gamesPerSet: 6, golden: true, points: 450, coins: 500, xp: 600 },
  { id: 'legends-cup', season: 3, tier: 'Legends', name: 'Legends Cup', blurb: 'Invitation only. The legends against the best of the new generation.', court: 'night', format: 'knockout', size: 4, mode: 'singles', pool: ['vega', 'rios', 'ruben', 'kai'], sets: 3, gamesPerSet: 6, golden: true, points: 600, coins: 700, xp: 800, requires: { points: 900 } },
];
export const EVENT_BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e]));

// ------------------------------------------------------------------ save data

const emptyAttrs = () => Object.fromEntries(ATTRS.map((a) => [a, 0]));

export function defaultSave() {
  return {
    v: CAREER_VERSION, season: 1, coins: 0, xp: 0, points: 0, devPoints: 0,
    attrs: emptyAttrs(), done: {}, history: [],
    stats: { matches: 0, wins: 0, shutouts: 0, upsets: 0, smashes: 0, aces: 0, titles: 0 },
    drills: {}, objectives: {}, unlockedRackets: [0, 1, 2, 3, 4, 5], active: null, seed: 1,
  };
}

// old stage id (v1) -> the event that replaces it
const LEGACY = { 1: 'club-open', 2: 'club-doubles', 3: 'sunday-league', 4: 'league-final', 5: 'regional-qualifier', 6: 'regional-doubles', 7: 'national-open', 8: 'national-doubles' };

/**
 * Bring any saved career to the current version without losing progress.
 * Accepts: nothing, a v1 save ({done: {stageId: stars}, xp}), or a v2 save (validated and clamped).
 */
export function migrateCareer(raw) {
  const s = defaultSave();
  if (!raw || typeof raw !== 'object') return s;
  if (raw.v === CAREER_VERSION) {
    const n = (v, d = 0) => (Number.isFinite(v) && v >= 0 ? v : d);
    s.season = Math.min(3, Math.max(1, Math.floor(n(raw.season, 1))));
    for (const k of ['coins', 'xp', 'points', 'devPoints', 'seed']) s[k] = Math.floor(n(raw[k], s[k]));
    for (const a of ATTRS) s.attrs[a] = Math.min(ATTR_MAX, Math.floor(n(raw.attrs?.[a], 0)));
    for (const k of Object.keys(s.stats)) s.stats[k] = Math.floor(n(raw.stats?.[k], 0));
    if (raw.done && typeof raw.done === 'object') for (const [id, d] of Object.entries(raw.done)) if (EVENT_BY_ID[id] && d && typeof d.result === 'string') s.done[id] = { result: d.result, points: Math.floor(n(d.points)) };
    if (Array.isArray(raw.history)) s.history = raw.history.slice(0, 40).filter((h) => h && typeof h.event === 'string');
    if (raw.drills && typeof raw.drills === 'object') for (const [id, st] of Object.entries(raw.drills)) if (DRILL_IDS.has(id) && st >= 0 && st <= 3) s.drills[id] = Math.floor(st);
    if (raw.objectives && typeof raw.objectives === 'object') for (const [id, v] of Object.entries(raw.objectives)) if (OBJECTIVE_IDS.has(id) && v) s.objectives[id] = true;
    if (Array.isArray(raw.unlockedRackets)) s.unlockedRackets = [...new Set([...s.unlockedRackets, ...raw.unlockedRackets.filter((i) => Number.isInteger(i) && i >= 0 && i < 8)])];
    if (raw.active && EVENT_BY_ID[raw.active.eventId] && Array.isArray(raw.active.rounds)) s.active = raw.active;
    return s;
  }
  // v1: {done: {stageId: stars}, xp}
  const done = raw.done && typeof raw.done === 'object' ? raw.done : {};
  let cleared = 0;
  for (const [stage, stars] of Object.entries(done)) {
    const ev = EVENT_BY_ID[LEGACY[stage]];
    if (!ev || !(stars >= 1)) continue;
    s.done[ev.id] = { result: 'champion', points: ev.points };
    s.points += ev.points; cleared++;
  }
  s.xp = Number.isFinite(raw.xp) && raw.xp > 0 ? Math.floor(raw.xp) : 0;
  s.stats.matches = s.stats.wins = cleared * 2; s.stats.titles = cleared;
  s.coins = cleared * 50; s.devPoints = cleared * 3; // a thank-you for progress made before the rewrite
  s.season = seasonOf(s);
  return s;
}

const STORAGE_KEY = 'padel.career2';
const LEGACY_KEY = 'padel.career';

export function loadCareer(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) return migrateCareer(JSON.parse(raw));
    const old = storage.getItem(LEGACY_KEY); // never deleted: the old save stays as a backup
    return old ? migrateCareer(JSON.parse(old)) : defaultSave();
  } catch { return defaultSave(); }
}
export function saveCareer(storage, s) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(s)); return true; } catch { return false; }
}

// ------------------------------------------------------------------ calendar, ranking, level

export const levelFor = (xp) => Math.floor(Math.sqrt(xp / 100)) + 1;

export function seasonOf(s) {
  const done = (n) => EVENTS.filter((e) => e.season === n).every((e) => s.done[e.id]);
  return done(1) ? (done(2) ? 3 : 2) : 1;
}

/** Calendar status of every event: done / available / locked (with the reason). */
export function calendar(s) {
  const season = seasonOf(s);
  return EVENTS.map((e, i) => {
    const d = s.done[e.id];
    let locked = null;
    if (e.season > season) locked = `Finish season ${e.season - 1} first`;
    else if (e.requires?.points && s.points < e.requires.points) locked = `Needs ${e.requires.points} ranking points (you have ${s.points})`;
    else if (i > 0 && EVENTS[i - 1].season === e.season && !s.done[EVENTS[i - 1].id] && !d) locked = `Play ${EVENTS[i - 1].name} first`;
    return { event: e, done: d || null, locked: d ? null : locked, active: s.active?.eventId === e.id };
  });
}

/** World ranking: the roster has fixed points; yours come from results. Rank 1 = best. */
export function rankOf(points) {
  return 1 + ROSTER.filter((r) => r.points > points).length;
}

// ------------------------------------------------------------------ tournaments

function seeded(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const levelRank = { easy: 0, normal: 1, hard: 2, expert: 3 };

/**
 * Build the draw. teams[0] is always the player (with their partner in doubles). Opponents come from the event's pool,
 * strongest last so later rounds are tougher.
 */
export function createTournament(event, seed) {
  const rng = seeded(seed);
  const per = event.mode === 'doubles' ? 2 : 1;
  const need = (event.size - 1) * per;
  // opponents: the event's own pool first (shuffled), then the closest-level characters from the rest of the roster,
  // so nobody ever appears twice in the same draw
  const preferred = [...new Set(event.pool.filter((id) => id !== event.partner))].map((id) => ({ id, k: rng() })).sort((x, y) => x.k - y.k).map((x) => x.id);
  const median = preferred.reduce((s, id) => s + levelRank[ROSTER_BY_ID[id].level], 0) / (preferred.length || 1);
  const others = ROSTER.map((r) => r.id).filter((id) => !preferred.includes(id) && id !== event.partner)
    .sort((x, y) => Math.abs(levelRank[ROSTER_BY_ID[x].level] - median) - Math.abs(levelRank[ROSTER_BY_ID[y].level] - median));
  const picked = [...preferred, ...others].slice(0, need);
  const byStrength = picked.sort((x, y) => levelRank[ROSTER_BY_ID[x].level] - levelRank[ROSTER_BY_ID[y].level] || ROSTER_BY_ID[x].points - ROSTER_BY_ID[y].points);
  const teams = [{ ids: event.mode === 'doubles' ? ['you', event.partner] : ['you'], player: true }];
  for (let i = 0; i < event.size - 1; i++) teams.push({ ids: byStrength.slice(i * per, i * per + per), player: false });

  const state = { eventId: event.id, format: event.format, mode: event.mode, teams, rounds: [], round: 0, status: 'playing', result: null, games: teams.map(() => ({ w: 0, l: 0, gf: 0, ga: 0 })) };
  if (event.format === 'group') {
    state.rounds = [
      { name: 'Group match 1', matches: [{ a: 0, b: 1 }, { a: 2, b: 3 }] },
      { name: 'Group match 2', matches: [{ a: 0, b: 2 }, { a: 1, b: 3 }] },
      { name: 'Group match 3', matches: [{ a: 0, b: 3 }, { a: 1, b: 2 }] },
    ];
  } else {
    // seed the player into a random slot, the others in strength order (weakest first), so the player meets the strongest last
    const slots = [...Array(event.size).keys()];
    const at = Math.floor(rng() * event.size);
    const order = slots.map((i) => (i === at ? 0 : null));
    let t = 1;
    for (let i = 0; i < event.size; i++) if (order[i] === null) order[i] = t++;
    const names = KO_ROUNDS[event.size];
    const first = { name: names[0], matches: [] };
    for (let i = 0; i < event.size; i += 2) first.matches.push({ a: order[i], b: order[i + 1] });
    state.rounds = [first];
    state.koNames = names;
  }
  return state;
}

/** The player's next match: {round, match, name, opponentTeam, opponents (roster ids)} or null when the event is over. */
export function nextPlayerMatch(state) {
  if (state.status !== 'playing') return null;
  const r = state.rounds[state.round];
  if (!r) return null;
  const m = r.matches.find((x) => (x.a === 0 || x.b === 0) && x.winner === undefined);
  if (!m) return null;
  const opp = m.a === 0 ? m.b : m.a;
  return { round: state.round, name: r.name, opponentTeam: opp, opponents: state.teams[opp].ids };
}

/**
 * Record the player's match and advance the event.
 * @param simulate (idsA, idsB) => {winner: 0|1, gamesA, gamesB} used for every match the player is not in
 */
export function reportPlayerMatch(state, won, gamesFor, gamesAgainst, simulate) {
  const r = state.rounds[state.round];
  const pm = r.matches.find((x) => (x.a === 0 || x.b === 0) && x.winner === undefined);
  const youA = pm.a === 0;
  pm.winner = won ? 0 : (youA ? pm.b : pm.a);
  pm.score = `${gamesFor}-${gamesAgainst}`;
  const book = (a, b, winner, gA, gB) => {
    const g = state.games;
    g[a].gf += gA; g[a].ga += gB; g[b].gf += gB; g[b].ga += gA;
    g[winner].w++; g[winner === a ? b : a].l++;
  };
  book(pm.a, pm.b, pm.winner, youA ? gamesFor : gamesAgainst, youA ? gamesAgainst : gamesFor);
  for (const m of r.matches) {
    if (m.winner !== undefined) continue;
    const sim = simulate(state.teams[m.a].ids, state.teams[m.b].ids);
    m.winner = sim.winner === 0 ? m.a : m.b;
    m.score = `${sim.gamesA}-${sim.gamesB}`;
    book(m.a, m.b, m.winner, sim.gamesA, sim.gamesB);
  }
  advance(state, won);
  return state;
}

function advance(state, playerWon) {
  const r = state.rounds[state.round];
  if (state.format === 'knockout') {
    if (!playerWon) { state.status = 'done'; state.result = r.name === 'Final' ? 'finalist' : r.name === 'Semi-final' ? 'semi' : 'quarter'; return; }
    if (state.round === state.rounds.length - 1 && r.name === 'Final') { state.status = 'done'; state.result = 'champion'; return; }
    const winners = r.matches.map((m) => m.winner);
    const next = { name: state.koNames[state.round + 1], matches: [] };
    for (let i = 0; i < winners.length; i += 2) next.matches.push({ a: winners[i], b: winners[i + 1] });
    state.rounds.push(next); state.round++;
    return;
  }
  // group: after 3 matches the top two play the final
  if (state.round < 2) { state.round++; return; }
  if (state.round === 2) {
    const order = standings(state);
    const pos = order.indexOf(0);
    if (pos > 1) { state.status = 'done'; state.result = pos === 2 ? 'third' : 'fourth'; return; }
    state.rounds.push({ name: 'Final', matches: [{ a: order[0], b: order[1] }] });
    state.round = 3; return;
  }
  state.status = 'done';
  state.result = playerWon ? 'champion' : 'finalist';
}

/** Group table: wins, then game difference. Returns team indexes best first. */
export function standings(state) {
  return state.teams.map((_, i) => i).sort((a, b) => state.games[b].w - state.games[a].w || (state.games[b].gf - state.games[b].ga) - (state.games[a].gf - state.games[a].ga) || a - b);
}

const FINISH_SHARE = { champion: 1, finalist: 0.6, semi: 0.35, quarter: 0.2, third: 0.3, fourth: 0.12 };
export function finishRewards(event, result) {
  const k = FINISH_SHARE[result] ?? 0.1;
  return { points: Math.round(event.points * k), coins: Math.round(event.coins * k), xp: Math.round(event.xp * k) };
}

export const RESULT_LABELS = { champion: 'Champion', finalist: 'Finalist', semi: 'Semi-finalist', quarter: 'Quarter-finalist', third: '3rd in the group', fourth: '4th in the group' };

// ------------------------------------------------------------------ simulation of the matches you do not play

/** Run a real headless match between two rostered teams. Deterministic for a given seed. */
export function simulateMatch(idsA, idsB, event, seed) {
  const rng = seeded(seed);
  const singles = event.mode === 'singles';
  const g = new PadelGame({ rng, settings: { mode: singles ? 'singles' : 'doubles', sets: 1, gamesPerSet: 3, goldenPoint: !!event.golden } });
  const slots = singles ? [[0, idsA[0]], [2, idsB[0]]] : [[0, idsA[0]], [1, idsA[1]], [2, idsB[0]], [3, idsB[1]]];
  const bots = {};
  for (const [slot, id] of slots) { const c = ROSTER_BY_ID[id] || ROSTER_BY_ID.marta; bots[slot] = { level: c.level, style: c.style }; }
  const mem = [0, 1, 2, 3].map(makeBotMemory);
  let done = null;
  for (let i = 0; i < 60 * 60 * 10 && !done; i++) {
    for (const [slot] of slots) g.applyInput(slot, botInput(g, slot, mem[slot], bots[slot], 1 / 60));
    g.tick(1 / 60);
    done = g.drainEvents().find((e) => e.e === 'match');
  }
  if (!done) { // too long: the team with more points wins
    const tp = g.match.totalPoints;
    return { winner: tp[0] >= tp[1] ? 0 : 1, gamesA: g.match.games[0], gamesB: g.match.games[1] };
  }
  let ga = 0, gb = 0;
  for (const [a, b] of done.results.score.sets) { ga += a; gb += b; }
  return { winner: done.winner, gamesA: ga, gamesB: gb };
}

// ------------------------------------------------------------------ applying results

export function commentary(won, gf, ga, opponentNote) {
  const total = gf + ga || 1;
  if (won && ga === 0) return 'A perfect match. Not a single game dropped.';
  if (won && ga / total <= 0.25) return 'Dominant. You controlled the rally from the first ball.';
  if (won && ga / total >= 0.45) return 'A fight to the end, and you found the extra point when it mattered.';
  if (won) return 'A solid win. You kept the errors down and made them hurry.';
  if (ga / total >= 0.7) return 'Outplayed today. Read the scouting notes and change the pattern next time.';
  return `Close, but not enough. ${opponentNote || ''}`.trim();
}

/** Apply the result of one played match to the save: stats, history, XP, development points. Returns what changed. */
export function applyMatch(save, event, roundName, won, res) {
  save.stats.matches++;
  const out = { devPoints: 0, xp: 20 };
  if (won) { save.stats.wins++; out.devPoints += 2; out.xp += 20; if (res.gamesAgainst === 0) save.stats.shutouts++; }
  save.stats.smashes += res.smashes || 0;
  save.stats.aces += res.aces || 0;
  if (res.upset) save.stats.upsets++;
  save.devPoints += out.devPoints; save.xp += out.xp;
  save.history.unshift({ at: res.at ?? 0, event: event.id, round: roundName, won, score: `${res.gamesFor}-${res.gamesAgainst}`, opp: res.opp });
  save.history.length = Math.min(save.history.length, 30);
  return out;
}

/** The event is over: pay the finish rewards and mark it done. */
export function completeEvent(save, event, result) {
  const r = finishRewards(event, result);
  save.points += r.points; save.coins += r.coins; save.xp += r.xp;
  if (result === 'champion') { save.stats.titles++; save.devPoints += 5; r.devPoints = 5; }
  save.done[event.id] = { result, points: r.points };
  save.active = null;
  save.season = seasonOf(save);
  return r;
}

// ------------------------------------------------------------------ player development

export const attrCost = (level) => level + 1;

export function buyAttr(save, attr) {
  if (!ATTRS.includes(attr)) return { ok: false, reason: 'Unknown attribute' };
  const lv = save.attrs[attr];
  if (lv >= ATTR_MAX) return { ok: false, reason: 'Already at maximum' };
  const cost = attrCost(lv);
  if (save.devPoints < cost) return { ok: false, reason: `Needs ${cost} development points` };
  save.devPoints -= cost; save.attrs[attr]++;
  return { ok: true };
}

/**
 * Gameplay modifiers from the attributes. Deliberately small (about +6% at most) so a developed player is better,
 * not a different species. Only ever applied to local single-player matches: online everybody is equal.
 */
export function attrMods(a) {
  const x = (k) => Math.min(ATTR_MAX, a?.[k] || 0);
  return {
    runMul: 1 + 0.006 * x('movement'), regenMul: 1 + 0.03 * x('stamina'), spin: 1 + 0.03 * x('variety'),
    window: 1 + 0.01 * x('reaction'),
    q: { ground: 0.01 * x('groundstroke'), volley: 0.01 * x('volley'), smash: 0.01 * x('smash'), lob: 0.01 * x('lob'), defense: 0.01 * x('defense') },
  };
}

// ------------------------------------------------------------------ training

export const DRILLS = [
  { id: 'serve', name: 'Serve accuracy', blurb: 'Ten serves. Land them in the box, closer to the corner scores more.', attr: 'variety', n: 10, stars: [8, 12, 16] },
  { id: 'forehand', name: 'Forehands to the corner', blurb: 'Ten fed balls. Place groundstrokes in the target zone deep in the right-hand corner.', attr: 'groundstroke', n: 10, stars: [3, 5, 7] },
  { id: 'lob', name: 'Defensive lobs', blurb: 'Ten balls at your feet. Lob them deep, past the service line.', attr: 'lob', n: 10, stars: [3, 5, 7] },
  { id: 'volley', name: 'Volley control', blurb: 'Fast balls at the net. Volley them into the open court.', attr: 'volley', n: 10, stars: [3, 5, 7] },
  { id: 'smash', name: 'Overheads', blurb: 'High balls. Smash or bandeja them into the court.', attr: 'smash', n: 10, stars: [3, 5, 7] },
];
export const DRILL_IDS = new Set(DRILLS.map((d) => d.id));

export function drillStars(drill, score) {
  return score >= drill.stars[2] ? 3 : score >= drill.stars[1] ? 2 : score >= drill.stars[0] ? 1 : 0;
}

/** Record a finished drill: keeps the best stars, pays development points only for improvement. */
export function applyDrill(save, drill, score) {
  const stars = drillStars(drill, score);
  const prev = save.drills[drill.id] || 0;
  let dev = 0;
  if (stars > prev) { dev = stars - prev; save.drills[drill.id] = stars; save.devPoints += dev; save.xp += 15 * dev; }
  return { stars, prev, devPoints: dev };
}

// ------------------------------------------------------------------ objectives

export const OBJECTIVES = [
  { id: 'first-win', text: 'Win your first career match', reward: { coins: 50 }, check: (s) => s.stats.wins >= 1 },
  { id: 'shutout', text: 'Win a match without losing a game', reward: { coins: 80, devPoints: 1 }, check: (s) => s.stats.shutouts >= 1 },
  { id: 'upset', text: 'Beat an opponent ranked above you', reward: { coins: 100, devPoints: 2 }, check: (s) => s.stats.upsets >= 1 },
  { id: 'first-title', text: 'Win an event', reward: { coins: 150, rackets: [6] }, rewardText: 'unlocks the Apex Pro racket', check: (s) => s.stats.titles >= 1 },
  { id: 'training', text: 'Earn 2+ stars in three different drills', reward: { devPoints: 3 }, check: (s) => Object.values(s.drills).filter((v) => v >= 2).length >= 3 },
  { id: 'smasher', text: 'Hit 25 smashes in career matches', reward: { coins: 90, devPoints: 1 }, check: (s) => s.stats.smashes >= 25 },
  { id: 'top10', text: 'Reach the world top 10', reward: { coins: 300, rackets: [7] }, rewardText: 'unlocks the Aurum Edition racket', check: (s) => rankOf(s.points) <= 10 },
  { id: 'rounded', text: 'Raise every attribute to at least 3', reward: { coins: 200, devPoints: 2 }, check: (s) => ATTRS.every((a) => s.attrs[a] >= 3) },
];
export const OBJECTIVE_IDS = new Set(OBJECTIVES.map((o) => o.id));

/** Grant any objective that has just been completed (once). Returns the list of newly completed objectives. */
export function claimObjectives(save) {
  const out = [];
  for (const o of OBJECTIVES) {
    if (save.objectives[o.id] || !o.check(save)) continue;
    save.objectives[o.id] = true;
    save.coins += o.reward.coins || 0; save.devPoints += o.reward.devPoints || 0;
    for (const r of o.reward.rackets || []) if (!save.unlockedRackets.includes(r)) save.unlockedRackets.push(r);
    out.push(o);
  }
  return out;
}

/** Opponent display data for the player's next match. */
export function describeOpponents(ids) {
  return ids.map((id) => ROSTER_BY_ID[id]).filter(Boolean);
}
