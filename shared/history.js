// Match history kept in this browser: every finished match (practice, career, online) is remembered.
// Pure functions plus load/save against any Storage-like object, so they are unit-tested in Node.

export const HISTORY_KEY = 'padel.history';
export const HISTORY_MAX = 100;

/**
 * Build one history entry from a finished match.
 * @param r        the 'results' object of the match (winner, score, duration, longestRally, players, teamPoints)
 * @param o        {slot: my slot, names, mode, court, kind: 'practice'|'career'|'online', at}
 */
export function entryFrom(r, o) {
  const team = (o.slot ?? 0) >> 1;
  const me = r.players?.[o.slot ?? 0] || {};
  const sets = (r.score?.sets || []).map(([a, b]) => [a, b]);
  const mine = (s) => (team === 0 ? s : [s[1], s[0]]);
  const mates = o.mode === 'singles' ? [] : [o.names[team * 2 + ((o.slot ?? 0) & 1 ? -1 : 1)]];
  const opp = o.mode === 'singles' ? [o.names[(1 - team) * 2]] : [o.names[(1 - team) * 2], o.names[(1 - team) * 2 + 1]];
  return {
    at: o.at ?? Date.now(), kind: o.kind || 'practice', mode: o.mode || 'doubles', court: o.court || 'indoor',
    won: r.winner === team, sets: sets.map(mine), mates: mates.filter(Boolean), opponents: opp.filter(Boolean),
    duration: r.duration || 0, longestRally: r.longestRally || 0, rallies: r.rallies || 0,
    points: team === 0 ? r.teamPoints : [r.teamPoints?.[1], r.teamPoints?.[0]],
    stats: { hits: me.hits || 0, winners: me.winners || 0, errors: me.errors || 0, aces: me.aces || 0, smashes: me.smashes || 0, volleys: me.volleys || 0, doubleFaults: me.doubleFaults || 0 },
  };
}

export function addEntry(list, entry, max = HISTORY_MAX) {
  return [entry, ...list].slice(0, max);
}

export function summarize(list) {
  const s = { matches: list.length, wins: 0, losses: 0, winRate: 0, streak: 0, bestStreak: 0, longestRally: 0, aces: 0, winners: 0, errors: 0, minutes: 0, byKind: {} };
  let run = 0;
  for (const e of [...list].reverse()) { // oldest first for streaks
    if (e.won) { run++; s.bestStreak = Math.max(s.bestStreak, run); } else run = 0;
  }
  s.streak = list.length && list[0].won ? list.findIndex((e) => !e.won) < 0 ? list.length : list.findIndex((e) => !e.won) : 0;
  for (const e of list) {
    if (e.won) s.wins++; else s.losses++;
    s.longestRally = Math.max(s.longestRally, e.longestRally || 0);
    s.aces += e.stats?.aces || 0; s.winners += e.stats?.winners || 0; s.errors += e.stats?.errors || 0;
    s.minutes += (e.duration || 0) / 60;
    s.byKind[e.kind] = (s.byKind[e.kind] || 0) + 1;
  }
  s.winRate = s.matches ? Math.round((s.wins / s.matches) * 100) : 0;
  s.minutes = Math.round(s.minutes);
  return s;
}

const valid = (e) => e && typeof e === 'object' && Number.isFinite(e.at) && typeof e.won === 'boolean' && Array.isArray(e.sets);

export function loadHistory(storage) {
  try {
    const raw = JSON.parse(storage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(valid).slice(0, HISTORY_MAX) : [];
  } catch { return []; }
}

export function saveHistory(storage, list) {
  try { storage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX))); return true; } catch { return false; }
}
