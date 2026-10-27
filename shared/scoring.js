// Explicit padel scoring state machine. Teams are 0 and 1.
// Pure data in / data out so it can be tested exhaustively.

export function createMatch(cfg = {}) {
  const c = { sets: 3, gamesPerSet: 6, goldenPoint: false, singles: false, ...cfg };
  return {
    cfg: c,
    sets: [], // completed sets: [gamesTeam0, gamesTeam1]
    setsWon: [0, 0],
    games: [0, 0],
    points: [0, 0],
    tiebreak: false,
    tbOrder: null,
    tbFirstTeam: null,
    pointsInGame: 0, // points played in current game / tiebreak (drives serve side)
    servingTeam: 0,
    serverIdx: [0, 0], // which of the team's two players serves
    served: [true, false],
    totalPoints: [0, 0],
    winner: null,
  };
}

const other = (t) => 1 - t;

// Who serves the next point.
export function currentServer(m) {
  if (m.tiebreak) {
    const e = m.tbOrder[Math.floor((m.pointsInGame + 1) / 2) % 4];
    return { team: e.team, idx: m.cfg.singles ? 0 : e.idx };
  }
  return { team: m.servingTeam, idx: m.cfg.singles ? 0 : m.serverIdx[m.servingTeam] };
}

// 0 = serve from the "deuce" (right-hand) side, 1 = advantage side.
export function serveSide(m) {
  return m.pointsInGame % 2;
}

function advanceServer(m, fromTeam) {
  const next = other(fromTeam);
  if (m.served[next]) m.serverIdx[next] ^= 1;
  m.served[next] = true;
  m.servingTeam = next;
}

function startTiebreak(m) {
  m.tiebreak = true;
  m.points = [0, 0];
  m.pointsInGame = 0;
  const x = m.servingTeam;
  const y = other(x);
  const xi = m.serverIdx[x];
  const yi = m.served[y] ? m.serverIdx[y] ^ 1 : 0;
  m.tbFirstTeam = x;
  m.tbOrder = [
    { team: x, idx: xi },
    { team: y, idx: yi },
    { team: x, idx: xi ^ 1 },
    { team: y, idx: yi ^ 1 },
  ];
}

function gameWon(m, team, out) {
  m.games[team]++;
  m.points = [0, 0];
  m.pointsInGame = 0;
  out.push({ type: 'game', team });
  const g = m.cfg.gamesPerSet;
  const a = m.games[team];
  const b = m.games[other(team)];
  if ((a >= g && a - b >= 2) || (m.tiebreak && a > b)) {
    setWon(m, team, out);
  } else if (a === g && b === g) {
    startTiebreak(m);
    out.push({ type: 'tiebreak' });
  } else {
    advanceServer(m, m.servingTeam);
  }
}

function setWon(m, team, out) {
  m.sets.push([m.games[0], m.games[1]]);
  m.setsWon[team]++;
  out.push({ type: 'set', team });
  const need = Math.floor(m.cfg.sets / 2) + 1;
  const wasTiebreak = m.tiebreak;
  m.games = [0, 0];
  m.points = [0, 0];
  m.pointsInGame = 0;
  m.tiebreak = false;
  if (m.setsWon[team] >= need) {
    m.winner = team;
    out.push({ type: 'match', team });
    return;
  }
  // the team that received first in a tiebreak serves first in the next set
  advanceServer(m, wasTiebreak ? m.tbFirstTeam : m.servingTeam);
  m.tbOrder = null;
}

export function pointWon(m, team) {
  if (m.winner !== null) return [];
  const out = [{ type: 'point', team }];
  m.totalPoints[team]++;
  m.points[team]++;
  m.pointsInGame++;
  const p = m.points[team];
  const q = m.points[other(team)];
  if (m.tiebreak) {
    if (p >= 7 && p - q >= 2) gameWon(m, team, out);
  } else if (m.cfg.goldenPoint ? p >= 4 : p >= 4 && p - q >= 2) {
    gameWon(m, team, out); // golden point: the point after 40-40 decides the game
  }
  return out;
}

const LABELS = ['0', '15', '30', '40'];

export function displayPoints(m) {
  const [a, b] = m.points;
  if (m.tiebreak) return [String(a), String(b)];
  if (a >= 3 && b >= 3) {
    if (a === b) return ['40', '40'];
    return a > b ? ['AD', '40'] : ['40', 'AD'];
  }
  return [LABELS[Math.min(a, 3)], LABELS[Math.min(b, 3)]];
}

export function pointLabel(m) {
  const [a, b] = m.points;
  if (!m.tiebreak && a >= 3 && b >= 3 && a === b) return m.cfg.goldenPoint ? 'Golden point' : 'Deuce';
  return '';
}

// Public, serialisable view sent to clients.
export function scoreView(m) {
  const need = Math.floor(m.cfg.sets / 2) + 1;
  const g = m.cfg.gamesPerSet;
  let gamePoint = null;
  let setPoint = false;
  let matchPoint = false;
  if (m.winner === null) {
    for (const t of [0, 1]) {
      const copy = JSON.parse(JSON.stringify(m));
      const evs = pointWon(copy, t);
      if (evs.some((e) => e.type === 'game')) {
        gamePoint = t;
        if (evs.some((e) => e.type === 'set')) setPoint = true;
        if (evs.some((e) => e.type === 'match')) matchPoint = true;
      }
    }
  }
  const srv = m.winner === null ? currentServer(m) : null;
  return {
    sets: m.sets,
    setsWon: m.setsWon,
    games: m.games,
    points: displayPoints(m),
    label: pointLabel(m),
    tiebreak: m.tiebreak,
    server: srv,
    serveSide: serveSide(m),
    gamePoint,
    setPoint,
    matchPoint,
    totalPoints: m.totalPoints,
    winner: m.winner,
    need,
    gamesPerSet: g,
  };
}
