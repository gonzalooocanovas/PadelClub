// Seeded bot-vs-bot (and scripted-human + bot) match runner with full instrumentation.
// Used by tools/bench-bots.mjs (statistics over many matches) and by tests (single curated matches).
import { PadelGame } from '../../shared/game.js';
import { botInput, makeBotMemory } from '../../shared/ai.js';
import { PLAYER } from '../../shared/constants.js';

export function seededRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const REACH_OK = 1.6; // a ball whose closest approach to a player is under this is "clearly reachable"

/**
 * Play one match. a = level (or {level, style}) of team 0, b = team 1.
 * opts: seed, games (games per set), maxSeconds, humanSlot0 (slot 0 is driven by `human(game, slot)` instead of the bot AI and is
 * flagged as a person so its bot partner plays with a human).
 */
export function playMatch({ a, b, seed = 1, games = 3, maxSeconds = 900, human = null, wallProbe = true } = {}) {
  const rng = seededRng(seed * 7919 + 13);
  const g = new PadelGame({ rng, settings: { sets: 1, gamesPerSet: games, mode: 'doubles' } });
  const mem = [0, 1, 2, 3].map(makeBotMemory);
  if (human) g.players[0].human = true;
  const S = {
    seed, winner: -1, points: 0, rallyShots: 0, aces: 0, doubleFaults: 0, faults: 0, errors: 0, winners: 0, por4: 0,
    byReason: {}, ticks: 0, seconds: 0,
    // teamwork
    incoming: [0, 0], ignored: [0, 0], ignoredReachable: [0, 0], doubleCommit: [0, 0], overlapTicks: 0, splitTicks: 0, pairTicks: 0, bothNetTicks: 0, bothBackTicks: 0,
    positionErrorPoints: 0,
    // wall play
    errByTac: {}, errByLabel: {}, errByKind: {}, hitsByTac: {}, lastKind: '',
    wallReceived: [0, 0], wallRecoveryOk: [0, 0], tactics: {}, tacticOk: {}, wallFirstFaults: 0, hits: 0, illegal: 0, nan: 0,
  };
  // per incoming-ball episode bookkeeping
  const ep = [null, null]; // for team t: {minD, swung, commit, bothClose, wall}
  const openEpisode = (t) => { ep[t] = { minD: 99, swung: false, both: false, wall: false, tick: S.ticks }; S.incoming[t]++; };
  let lastHit = null, rallyHits = 0;
  const maxTicks = maxSeconds * 60;
  while (S.ticks < maxTicks && S.winner < 0) {
    for (let k = 0; k < 4; k++) {
      let inp;
      if (human && k === 0) inp = human(g, 0, S.ticks);
      else inp = botInput(g, k, mem[k], k < 2 ? a : b, 1 / 60);
      g.applyInput(k, inp);
      if (inp.swing && g.phase === 'rally' && ep[k >> 1]) ep[k >> 1].swung = true;
    }
    g.tick(1 / 60);
    S.ticks++;
    const bl = g.ball;
    if (!Number.isFinite(bl.x + bl.y + bl.z + bl.vx + bl.vy + bl.vz)) { S.nan++; break; }
    if (g.phase === 'rally' && !g.rally.serving) {
      for (let t = 0; t < 2; t++) {
        const e = ep[t];
        if (!e) continue;
        const half = t === 0 ? bl.z < 0.3 : bl.z > -0.3;
        if (half && bl.y < 2.6) {
          const d0 = Math.hypot(bl.x - g.players[t * 2].x, bl.z - g.players[t * 2].z), d1 = Math.hypot(bl.x - g.players[t * 2 + 1].x, bl.z - g.players[t * 2 + 1].z);
          e.minD = Math.min(e.minD, d0, d1);
          if (d0 < 1.3 && d1 < 1.3 && g.players[t * 2].swing && g.players[t * 2 + 1].swing) e.both = true;
        }
      }
      // pair geometry (hits >= 2: after the serve and return)
      if (g.rally.hits >= 2) {
        for (let t = 0; t < 2; t++) {
          const p1 = g.players[t * 2], p2 = g.players[t * 2 + 1];
          const z1 = Math.abs(p1.z), z2 = Math.abs(p2.z);
          S.pairTicks++;
          if (Math.hypot(p1.x - p2.x, p1.z - p2.z) < 1.0) S.overlapTicks++;
          if ((z1 < 4.6 && z2 > 5.6) || (z2 < 4.6 && z1 > 5.6)) S.splitTicks++;
          if (z1 < 4.6 && z2 < 4.6) S.bothNetTicks++;
          if (z1 > 5.6 && z2 > 5.6) S.bothBackTicks++;
        }
      }
    }
    for (const e of g.drainEvents()) {
      if (e.e === 'ball' && e.k === 'wall' && g.rally.bounces >= 1 && lastHit) { const t = 1 - lastHit.team; if (ep[t]) ep[t].wall = true; }
      if (e.e === 'hit') {
        S.hits++;
        const team = e.slot >> 1;
        // close the episode of the team that just hit (they answered the ball)
        if (ep[team]) {
          if (ep[team].wall) { S.wallReceived[team]++; }
          if (e.tac) { S.tactics[e.tac] = (S.tactics[e.tac] || 0) + 1; }
          ep[team] = null;
        }
        lastHit = { team, tac: e.tac || null, wallAnswered: e.wall || false, kind: e.kind, label: e.label, q: e.q };
        S.hitsByTac[e.tac || 'none'] = (S.hitsByTac[e.tac || 'none'] || 0) + 1;
        openEpisode(1 - team);
        rallyHits = g.rally.hits;
      }
      if (e.e === 'fault') S.faults++;
      if (e.e === 'point') {
        S.points++; S.rallyShots += e.rally;
        S.byReason[e.reason] = (S.byReason[e.reason] || 0) + 1;
        if (e.reason === 'bounce' && e.rally === 1) S.aces++;
        if (e.reason === 'double-fault') S.doubleFaults++;
        if (['net', 'out', 'own-side'].includes(e.reason)) { S.errors++; if (lastHit) { const k = (lastHit.tac || 'none') + '/' + lastHit.kind; S.errByTac[k] = (S.errByTac[k] || 0) + 1; S.errByLabel[lastHit.label] = (S.errByLabel[lastHit.label] || 0) + 1; } }
        if (e.reason === 'bounce' || e.reason === 'out-after-bounce') S.winners++;
        if (e.por) S.por4++;
        // a point won by the hitter ('bounce'): the receiving team's episode is still open: did they have a chance?
        const loser = 1 - e.winner;
        const open = ep[loser];
        if (open && e.reason === 'bounce' && e.rally > 1) {
          S.ignored[loser]++;
          if (!open.swung && open.minD <= REACH_OK) { S.ignoredReachable[loser]++; S.positionErrorPoints++; }
        }
        if (lastHit && lastHit.tac) { S.tacticOk[lastHit.tac] = (S.tacticOk[lastHit.tac] || 0) + (e.winner === lastHit.team ? 1 : 0); }
        if (ep[0] && ep[0].both) S.doubleCommit[0]++;
        if (ep[1] && ep[1].both) S.doubleCommit[1]++;
        ep[0] = ep[1] = null; lastHit = null;
      }
      if (e.e === 'match') S.winner = e.winner;
    }
  }
  S.seconds = S.ticks / 60;
  return S;
}

/** Wilson score interval (95%) for a win rate. */
export function wilson(wins, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = wins / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - r) / d, (c + r) / d];
}

export const REACH = PLAYER.REACH;
