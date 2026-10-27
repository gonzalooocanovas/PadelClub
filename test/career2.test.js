import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENTS, EVENT_BY_ID, ATTRS, defaultSave, migrateCareer, loadCareer, saveCareer, calendar, rankOf, seasonOf,
  createTournament, nextPlayerMatch, reportPlayerMatch, standings, finishRewards, completeEvent, applyMatch,
  buyAttr, attrMods, DRILLS, drillStars, applyDrill, OBJECTIVES, claimObjectives, simulateMatch, commentary,
} from '../shared/career2.js';
import { ROSTER, ROSTER_BY_ID } from '../shared/roster.js';
import { PadelGame } from '../shared/game.js';
import { skillFor } from '../shared/ai.js';

const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), raw: m }; };
const alwaysWin = (a, b) => ({ winner: 0, gamesA: 3, gamesB: 1 });

test('events are well formed: unique ids, known roster ids, partners for doubles, increasing seasons', () => {
  assert.equal(new Set(EVENTS.map((e) => e.id)).size, EVENTS.length);
  for (const e of EVENTS) {
    for (const id of e.pool) assert.ok(ROSTER_BY_ID[id], `${e.id}: unknown ${id}`);
    if (e.mode === 'doubles') assert.ok(ROSTER_BY_ID[e.partner], `${e.id} needs a partner`);
    assert.ok([4, 8].includes(e.size));
    assert.ok(['indoor', 'outdoor', 'night', 'rooftop'].includes(e.court));
  }
  assert.ok(EVENTS.every((e, i) => i === 0 || e.season >= EVENTS[i - 1].season));
  assert.ok(ROSTER.length >= 12);
});

test('save migration: v1 progress survives, v2 is validated, garbage falls back', () => {
  const v1 = { done: { 1: 3, 2: 2, 3: 0, 5: 1 }, xp: 500 };
  const m = migrateCareer(v1);
  assert.equal(m.v, 2);
  assert.deepEqual(Object.keys(m.done).sort(), ['club-doubles', 'club-open', 'regional-qualifier']);
  assert.equal(m.xp, 500);
  assert.ok(m.points > 0 && m.stats.titles === 3);
  assert.deepEqual(migrateCareer(null), defaultSave());
  assert.deepEqual(migrateCareer('nonsense'), defaultSave());
  const hostile = migrateCareer({ v: 2, coins: -5, points: 'x', attrs: { smash: 99, volley: -2 }, done: { 'club-open': { result: 'champion', points: 30 }, nope: { result: 'champion' } }, drills: { serve: 7, lob: 2 }, objectives: { 'first-win': true, bogus: true }, unlockedRackets: [6, 99, 'x'] });
  assert.equal(hostile.coins, 0); assert.equal(hostile.attrs.smash, 10); assert.equal(hostile.attrs.volley, 0);
  assert.deepEqual(Object.keys(hostile.done), ['club-open']);
  assert.deepEqual(hostile.drills, { lob: 2 });
  assert.deepEqual(hostile.objectives, { 'first-win': true });
  assert.ok(hostile.unlockedRackets.includes(6) && !hostile.unlockedRackets.includes(99));
});

test('persistence round trip, and the old v1 key is read but never deleted', () => {
  const st = memStore();
  st.setItem('padel.career', JSON.stringify({ done: { 1: 2 }, xp: 120 }));
  const s = loadCareer(st);
  assert.ok(s.done['club-open']);
  s.coins = 77; saveCareer(st, s);
  assert.equal(loadCareer(st).coins, 77);
  assert.ok(st.raw.has('padel.career'), 'backup of the old save kept');
  st.setItem('padel.career2', '{broken');
  assert.deepEqual(loadCareer(st), defaultSave());
});

test('calendar: season gating, points requirements and sequential unlocks', () => {
  const s = defaultSave();
  let cal = calendar(s);
  assert.equal(cal[0].locked, null);
  assert.match(cal[1].locked, /Play Club Open first/);
  assert.match(cal.find((c) => c.event.id === 'regional-qualifier').locked, /season 1/);
  for (const e of EVENTS.filter((x) => x.season === 1)) s.done[e.id] = { result: 'champion', points: 10 };
  assert.equal(seasonOf(s), 2);
  s.points = 50;
  cal = calendar(s);
  assert.match(cal.find((c) => c.event.id === 'regional-qualifier').locked, /100 ranking points/);
  s.points = 120;
  assert.equal(calendar(s).find((c) => c.event.id === 'regional-qualifier').locked, null);
  assert.ok(rankOf(0) > rankOf(500) && rankOf(10000) === 1);
});

test('knockout bracket: the player is in the draw, rounds advance, a loss ends the run at the right stage', () => {
  const ev = EVENT_BY_ID['league-final']; // 8 draw doubles
  const t = createTournament(ev, 42);
  assert.equal(t.teams.length, 8);
  assert.deepEqual(t.teams[0].ids, ['you', 'ana']);
  assert.equal(new Set(t.teams.flatMap((x) => x.ids)).size, 16, 'everybody is a different person');
  assert.equal(t.rounds[0].name, 'Quarter-final');
  let n = nextPlayerMatch(t);
  assert.ok(n && n.opponents.length === 2);
  reportPlayerMatch(t, true, 4, 1, alwaysWin);
  assert.equal(t.rounds.length, 2); assert.equal(t.rounds[1].name, 'Semi-final');
  assert.ok(t.rounds[0].matches.every((m) => m.winner !== undefined), 'the other quarter-finals were played');
  n = nextPlayerMatch(t); assert.equal(n.name, 'Semi-final');
  reportPlayerMatch(t, true, 4, 2, alwaysWin);
  n = nextPlayerMatch(t); assert.equal(n.name, 'Final');
  reportPlayerMatch(t, true, 4, 0, alwaysWin);
  assert.equal(t.status, 'done'); assert.equal(t.result, 'champion'); assert.equal(nextPlayerMatch(t), null);

  const t2 = createTournament(ev, 42);
  reportPlayerMatch(t2, true, 4, 1, alwaysWin);
  reportPlayerMatch(t2, false, 1, 4, alwaysWin);
  assert.equal(t2.status, 'done'); assert.equal(t2.result, 'semi');
  const t3 = createTournament(EVENT_BY_ID['club-open'], 7); // 4 draw: semi, final
  reportPlayerMatch(t3, true, 3, 0, alwaysWin);
  reportPlayerMatch(t3, false, 1, 3, alwaysWin);
  assert.equal(t3.result, 'finalist');
});

test('group stage: three matches, table, final for the top two', () => {
  const t = createTournament(EVENT_BY_ID['sunday-league'], 9);
  assert.equal(t.rounds.length, 3);
  for (let i = 0; i < 3; i++) { assert.equal(nextPlayerMatch(t).name, `Group match ${i + 1}`); reportPlayerMatch(t, true, 4, 1, alwaysWin); }
  assert.equal(standings(t)[0], 0, 'three wins tops the table');
  assert.equal(t.status, 'playing');
  assert.equal(nextPlayerMatch(t).name, 'Final');
  reportPlayerMatch(t, true, 4, 2, alwaysWin);
  assert.equal(t.result, 'champion');

  const u = createTournament(EVENT_BY_ID['sunday-league'], 9);
  for (let i = 0; i < 3; i++) reportPlayerMatch(u, false, 1, 4, (a, b) => ({ winner: 0, gamesA: 4, gamesB: 2 }));
  assert.equal(u.status, 'done');
  assert.ok(['third', 'fourth'].includes(u.result));
});

test('rewards, XP, objectives (granted once), unlocks and development', () => {
  const s = defaultSave();
  const ev = EVENT_BY_ID['club-open'];
  assert.ok(finishRewards(ev, 'champion').points > finishRewards(ev, 'semi').points);
  applyMatch(s, ev, 'Semi-final', true, { gamesFor: 3, gamesAgainst: 0, opp: 'Marta', smashes: 3 });
  assert.equal(s.stats.shutouts, 1);
  let got = claimObjectives(s);
  assert.deepEqual(got.map((o) => o.id).sort(), ['first-win', 'shutout']);
  assert.equal(claimObjectives(s).length, 0, 'never granted twice');
  const coinsBefore = s.coins;
  completeEvent(s, ev, 'champion');
  got = claimObjectives(s);
  assert.ok(got.some((o) => o.id === 'first-title'));
  assert.ok(s.unlockedRackets.includes(6), 'the title unlocked a racket');
  assert.ok(s.coins > coinsBefore && s.points > 0 && s.done['club-open'].result === 'champion' && s.active === null);

  s.devPoints = 3;
  assert.deepEqual(buyAttr(s, 'smash'), { ok: true });      // costs 1
  assert.deepEqual(buyAttr(s, 'smash'), { ok: true });      // costs 2
  assert.equal(buyAttr(s, 'smash').ok, false);              // would cost 3, has 0
  assert.equal(s.attrs.smash, 2);
  assert.equal(buyAttr(s, 'nope').ok, false);
  s.attrs.lob = 10; s.devPoints = 99; assert.equal(buyAttr(s, 'lob').ok, false, 'capped at 10');
});

test('attributes are modest: never more than about +6% speed, and only slot 0 of a local match benefits', () => {
  const maxed = Object.fromEntries(ATTRS.map((a) => [a, 10]));
  const m = attrMods(maxed);
  assert.ok(m.runMul <= 1.06 + 1e-9 && m.q.ground <= 0.1 + 1e-9 && m.window <= 1.1 + 1e-9);
  assert.deepEqual(attrMods(defaultSave().attrs).q, { ground: 0, volley: 0, smash: 0, lob: 0, defense: 0 });
  const dist = (settings) => { const g = new PadelGame({ settings }); g.drainEvents(); g.applyInput(0, { mx: 1 }); g.applyInput(2, { mx: 1 }); for (let i = 0; i < 90; i++) g.tick(1 / 60); return [g.players[0], g.players[2]].map((p) => Math.abs(p.x - (p === g.players[0] ? 0 : 0))); };
  const base = new PadelGame({ settings: {} }); const dev = new PadelGame({ settings: { attrMods: m } });
  assert.equal(base.players[0].speedMul, undefined);
  assert.ok(dev.players[0].speedMul > 1 && dev.players[2].speedMul === undefined);
  void dist;
});

test('drills: stars thresholds, only improvements pay', () => {
  const d = DRILLS.find((x) => x.id === 'forehand');
  assert.equal(drillStars(d, 2), 0); assert.equal(drillStars(d, 3), 1); assert.equal(drillStars(d, 5), 2); assert.equal(drillStars(d, 9), 3);
  const s = defaultSave();
  assert.equal(applyDrill(s, d, 5).devPoints, 2);
  assert.equal(applyDrill(s, d, 4).devPoints, 0, 'a worse result pays nothing');
  assert.equal(applyDrill(s, d, 8).devPoints, 1);
  assert.equal(s.drills.forehand, 3);
});

test('matches the player does not play are really simulated, deterministically, with each character style', () => {
  const ev = EVENT_BY_ID['club-open'];
  const a = simulateMatch(['marta'], ['luis'], ev, 5), b = simulateMatch(['marta'], ['luis'], ev, 5);
  assert.deepEqual(a, b);
  assert.ok(a.winner === 0 || a.winner === 1);
  assert.ok(a.gamesA + a.gamesB >= 3);
  const d = simulateMatch(['kai', 'lucia'], ['pablo', 'sofi'], { ...EVENT_BY_ID['club-doubles'] }, 3);
  assert.ok(d.winner === 0 || d.winner === 1);
});

test('styles change how bots play, levels still order them', () => {
  const net = skillFor({ level: 'normal', style: 'net' }), counter = skillFor({ level: 'normal', style: 'counter' }), plain = skillFor('normal');
  assert.ok(net.netZ < (plain.netZ ?? 2.9));
  assert.ok(net.netZ < counter.netZ && net.backZ < counter.backZ, 'net players stand closer to the net than counter-punchers');
  assert.ok(skillFor({ level: 'normal', style: 'power' }).smash > plain.smash);
  assert.ok(skillFor({ level: 'normal', style: 'wild' }).flub > plain.flub);
  assert.ok(skillFor({ level: 'easy', style: 'retriever' }).speed > skillFor('easy').speed);
  assert.ok(skillFor({ level: 'expert', style: 'wild' }).aggr <= 1);
});

test('commentary is concise and matches the result', () => {
  assert.match(commentary(true, 4, 0), /perfect/i);
  assert.match(commentary(false, 1, 5, 'Keep it low.'), /scouting|Outplayed/);
  assert.match(commentary(false, 3, 4, 'Keep it low.'), /Keep it low/);
  assert.ok(OBJECTIVES.every((o) => o.text.length < 70));
});
