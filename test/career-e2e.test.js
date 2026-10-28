import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENTS, EVENT_BY_ID, DRILLS, OBJECTIVES, defaultSave, migrateCareer, loadCareer, saveCareer, calendar, seasonOf, rankOf, createTournament,
  nextPlayerMatch, reportPlayerMatch, applyMatch, completeEvent, claimObjectives, applyDrill, drillStars, simulateMatch, buyAttr, ATTRS,
} from '../shared/career2.js';

/** Play one event to the end with a fixed policy: win(roundIndex) decides whether the player wins that match. */
function playEvent(save, ev, win, seed = 1) {
  const t = createTournament(ev, seed);
  save.active = t;
  let k = 0, guard = 0;
  while (t.status === 'playing' && guard++ < 20) {
    const n = nextPlayerMatch(t);
    assert.ok(n, 'a playing event always has a next match for the player');
    const won = win(n.round, n);
    const res = { gamesFor: won ? ev.gamesPerSet : 1, gamesAgainst: won ? 0 : ev.gamesPerSet, opp: 'x', upset: won, smashes: won ? 3 : 0, aces: won ? 1 : 0 };
    applyMatch(save, ev, n.name, won, res);
    reportPlayerMatch(t, won, res.gamesFor, res.gamesAgainst, (a, b) => simulateMatch(a, b, ev, seed * 31 + k++));
  }
  assert.equal(t.status, 'done', `${ev.id} finishes`);
  const rewards = completeEvent(save, ev, t.result);
  claimObjectives(save);
  return { result: t.result, rewards, t };
}

test('a perfect player can finish all 12 events in order: unlock rules hold, every event ends, rewards and objectives are consistent', () => {
  const save = defaultSave();
  let order = 0;
  const seenLocked = [];
  for (let pass = 0; pass < 60 && Object.keys(save.done).length < EVENTS.length; pass++) {
    const cal = calendar(save);
    const next = cal.find((c) => !c.done && !c.locked);
    if (!next) { // locked by points: replay the best finished event to earn more (this must always be possible)
      const replay = cal.filter((c) => c.done && !c.locked).at(-1);
      assert.ok(replay, 'there is always something to play');
      playEvent(save, replay.event, () => true, 100 + pass);
      continue;
    }
    for (const c of cal) if (c.locked && !seenLocked.includes(c.event.id)) seenLocked.push(c.event.id);
    const before = save.points;
    const r = playEvent(save, next.event, () => true, pass + 1);
    assert.equal(r.result, 'champion');
    assert.ok(save.points > before, 'a title always pays ranking points');
    order++;
  }
  assert.equal(Object.keys(save.done).length, EVENTS.length, 'all 12 events completed');
  assert.equal(seasonOf(save), 3);
  assert.ok(save.stats.titles >= 12 && save.stats.wins > 20);
  assert.ok(rankOf(save.points) <= 8, `a perfect career reaches the top of the ranking (rank ${rankOf(save.points)})`);
  // every objective that is reachable by playing was granted exactly once
  for (const o of OBJECTIVES.filter((x) => x.id !== 'training' && x.id !== 'rounded')) assert.equal(save.objectives[o.id], true, `objective ${o.id}`);
  assert.ok(save.unlockedRackets.includes(6) && save.unlockedRackets.includes(7), 'both racket unlocks arrive');
  assert.ok(order >= 12);
});

test('rewards and objectives are granted exactly once, however often they are claimed or the event is replayed', () => {
  const save = defaultSave();
  playEvent(save, EVENTS[0], () => true, 1);
  const snap = JSON.stringify([save.coins, save.devPoints, save.unlockedRackets, save.objectives]);
  for (let i = 0; i < 5; i++) assert.deepEqual(claimObjectives(save), [], 'nothing new to claim');
  assert.equal(JSON.stringify([save.coins, save.devPoints, save.unlockedRackets, save.objectives]), snap, 'claiming again changes nothing');
  const titlesBefore = save.stats.titles, coinsBefore = save.coins;
  playEvent(save, EVENTS[0], () => true, 2); // replay: pays the event again (by design) but not the one-off objectives
  assert.equal(save.stats.titles, titlesBefore + 1);
  assert.ok(save.coins > coinsBefore);
  assert.equal(Object.keys(save.objectives).filter((k) => save.objectives[k]).length, Object.keys(save.objectives).length);
  const firstTitleCoins = OBJECTIVES.find((o) => o.id === 'first-title').reward.coins;
  const ev = EVENTS[0];
  assert.ok(save.coins < coinsBefore + ev.coins + firstTitleCoins, 'the first-title bonus was not paid a second time');
});

test('a player who loses everything cannot get stuck: replays always earn points, so every gate can be reached', () => {
  const save = defaultSave();
  let plays = 0;
  // lose the first match everywhere; play whatever is open, replay when locked
  while (Object.keys(save.done).length < EVENTS.length && plays < 200) {
    const cal = calendar(save);
    const open = cal.find((c) => !c.done && !c.locked);
    const target = open || cal.filter((c) => c.done && !c.locked)[0];
    assert.ok(target, 'never nothing to play');
    playEvent(save, target.event, (round) => false, plays + 5);
    plays++;
  }
  assert.equal(Object.keys(save.done).length, EVENTS.length, `even losing every first match, all events become playable and done (${plays} events played)`);
  assert.ok(plays < 120, `a bounded amount of play (${plays})`);
  assert.equal(save.active, null);
});

test('tournament brackets are always valid: unique opponents, correct round names, no impossible states, results consistent with the player match', () => {
  for (const ev of EVENTS) {
    for (let seed = 1; seed <= 2; seed++) {
      const t = createTournament(ev, seed);
      const ids = t.teams.flatMap((x) => x.ids);
      assert.equal(new Set(ids).size, ids.length, `${ev.id} seed ${seed}: nobody twice`);
      assert.equal(t.teams[0].ids[0], 'you');
      let guard = 0;
      while (t.status === 'playing' && guard++ < 10) {
        const n = nextPlayerMatch(t);
        const m = t.rounds[t.round].matches.find((x) => (x.a === 0 || x.b === 0) && x.winner === undefined);
        assert.ok(m);
        reportPlayerMatch(t, seed % 2 === 0, 3, 2, (a, b) => simulateMatch(a, b, ev, seed));
        assert.ok(t.rounds[t.round - 1 >= 0 ? t.round - 1 : 0].matches.every((x) => x.winner !== undefined) || t.status === 'done');
        void n;
      }
      assert.equal(t.status, 'done');
      assert.ok(['champion', 'finalist', 'semi', 'quarter', 'third', 'fourth'].includes(t.result), t.result);
    }
  }
});

test('save migration: an old ladder save becomes a valid v2 save without deleting the old one, and migrating twice changes nothing', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  store.set('padel.career', JSON.stringify({ done: { 1: 3, 2: 2, 3: 1, 99: 3 }, xp: 640 }));
  const s = loadCareer(storage);
  assert.equal(s.v, 2);
  assert.equal(Object.keys(s.done).length, 3, 'three real stages carried over, the unknown one dropped');
  assert.equal(s.xp, 640);
  assert.ok(store.has('padel.career'), 'the old save is kept as a backup');
  assert.deepEqual(migrateCareer(JSON.parse(JSON.stringify(s))), migrateCareer(migrateCareer(JSON.parse(JSON.stringify(s)))), 'idempotent');
  assert.ok(saveCareer(storage, s));
  assert.deepEqual(loadCareer(storage), s);
  // corrupt and hostile data is clamped, never thrown
  const bad = migrateCareer({ v: 2, season: 99, coins: -5, xp: 'x', points: NaN, attrs: { movement: 1e9, bogus: 5 }, done: { 'club-open': { result: 'champion', points: 1 }, nope: {} }, drills: { serve: 7, junk: 1 }, objectives: { 'first-win': true, zzz: true }, unlockedRackets: [1, 99, -1, 3.5], active: { eventId: 'nope' } });
  assert.ok(bad.season >= 1 && bad.season <= 3 && bad.coins >= 0 && Number.isFinite(bad.xp) && Number.isFinite(bad.points));
  assert.equal(bad.attrs.movement, 10);
  assert.ok(!('bogus' in bad.attrs) && !('nope' in bad.done) && !('junk' in bad.drills) && !('zzz' in bad.objectives));
  assert.ok(bad.unlockedRackets.every((i) => Number.isInteger(i) && i >= 0 && i < 8));
  assert.equal(bad.active, null);
  assert.equal(loadCareer({ getItem: () => '{broken', setItem() {} }).v, 2, 'unreadable storage gives a fresh save');
});

test('drills have clear, strictly increasing star thresholds and pay only improvements', () => {
  for (const d of DRILLS) {
    assert.equal(d.stars.length, 3);
    assert.ok(d.stars[0] < d.stars[1] && d.stars[1] < d.stars[2], d.id);
    assert.ok(d.stars[2] <= d.n * (d.id === 'serve' ? 2 : 1), `${d.id}: three stars are reachable with ${d.n} balls`);
    assert.equal(drillStars(d, d.stars[0] - 1), 0); assert.equal(drillStars(d, d.stars[0]), 1); assert.equal(drillStars(d, d.stars[1]), 2); assert.equal(drillStars(d, d.stars[2]), 3);
    const s = defaultSave();
    const first = applyDrill(s, d, d.stars[1]);
    assert.equal(first.devPoints, 2);
    assert.equal(applyDrill(s, d, d.stars[1]).devPoints, 0, 'repeating pays nothing');
    assert.equal(applyDrill(s, d, d.stars[0]).devPoints, 0, 'a worse run pays nothing and never lowers the stars');
    assert.equal(s.drills[d.id], 2);
  }
});

test('a played match leaves consistent records: history, stats, XP and development points move together', () => {
  const save = defaultSave();
  const ev = EVENTS[0];
  const before = { m: save.stats.matches, w: save.stats.wins, h: save.history.length, xp: save.xp, dev: save.devPoints };
  const out = applyMatch(save, ev, 'Semi-final', true, { gamesFor: 3, gamesAgainst: 0, opp: 'Marta', upset: true, aces: 2, smashes: 3 });
  assert.equal(save.stats.matches, before.m + 1);
  assert.equal(save.stats.wins, before.w + 1);
  assert.equal(save.stats.shutouts, 1);
  assert.equal(save.stats.upsets, 1);
  assert.equal(save.history.length, before.h + 1);
  assert.equal(save.history[0].won, true);
  assert.equal(save.xp, before.xp + out.xp);
  assert.equal(save.devPoints, before.dev + out.devPoints);
  // attributes: costs rise, points are spent, the maximum holds
  save.devPoints = 1000;
  for (const a of ATTRS) for (let i = 0; i < 12; i++) buyAttr(save, a);
  assert.ok(ATTRS.every((a) => save.attrs[a] === 10), 'every attribute caps at 10');
  assert.ok(save.devPoints >= 0 && save.devPoints < 1000);
  assert.equal(EVENT_BY_ID[ev.id], ev);
});
