// Tactical shot evaluation for the bots. Instead of rolling dice for named shots, every candidate shot is flown through the
// real ball physics (walls included) and scored by how hard it is for the opponents to answer, how risky it is, and what it
// does for our own position. Wall plays are therefore chosen when the rebound makes the shot better, not on a schedule.
//
// A bot only uses information a human could use: the current ball state, the players' positions and velocities (not their
// inputs) and the court. Nothing here reads a future state of the game: the flights are simulated on private copies.
import { stepBall, solveLaunch, netHeight } from './physics.js';
import { COURT, PLAYER, clamp } from './constants.js';

const OPP_RUN = 6.0; // m/s: what we assume an opponent can run (the same constant the players are limited by)
const DT_EVAL = 1 / 30; // coarse step for evaluation flights (stepBall sub-steps internally)

/** Shot templates. speed is the nominal launch speed used for the evaluation flight (not for the real shot). */
const KINDS = {
  drive: { speed: 18, sb: -8, mod: 0, lob: false },
  slice: { speed: 13, sb: 14, mod: 3, lob: false },
  lob: { T: 1.95, sb: -6, mod: 0, lob: true },
  chiquita: { speed: 8, sb: 9, mod: 1, lob: false },
  drop: { speed: 6.5, sb: 18, mod: 1, lob: false },
  smash: { speed: 30, sb: -4, mod: 0, lob: false },
  bandeja: { speed: 13, sb: 14, mod: 2, lob: false },
  vibora: { speed: 18, sb: 7, mod: 1, lob: false },
};

/** Fly a hypothetical shot on a private copy of the ball. Returns what happened after it. */
export function flyShot(ball, v, sb, ss = 0, maxT = 3.2) {
  const b = { ...ball, vx: v.vx, vy: v.vy, vz: v.vz, sb, ss };
  const side0 = Math.sign(b.z) || 1;
  const out = { valid: false, reason: '', floor: null, samples: [], wallsAfter: 0, net: false, high: [], t: 0, netMargin: 9 };
  let t = 0, floors = 0;
  for (; t < maxT; t += DT_EVAL) {
    const ev = [];
    const pz = b.z;
    stepBall(b, DT_EVAL, ev);
    if (out.netMargin === 9 && (pz < 0) !== (b.z < 0)) out.netMargin = b.y - netHeight(b.x) - COURT.BALL_R; // clearance when the ball crosses the net plane
    for (const e of ev) {
      if (e.type === 'net') { out.reason = 'net'; return out; }
      if (e.type === 'out' || e.type === 'door') { out.reason = floors ? 'out-after-bounce' : 'out'; out.valid = floors > 0; out.t = t; return out; }
      if (e.type === 'wall') {
        if (!floors) { out.reason = 'wall-first'; return out; } // a wall before the bounce is a lost point
        out.wallsAfter++;
      }
      if (e.type === 'floor') {
        floors++;
        if (floors === 1) {
          if (Math.sign(e.z) === side0 || Math.abs(e.x) > COURT.HALF_W + 0.01) { out.reason = 'own-side'; return out; }
          out.floor = { x: e.x, z: e.z, t: t + DT_EVAL };
        } else { out.valid = true; out.t = t; return out; }
      }
    }
    if (floors === 0 && Math.sign(b.z) !== side0 && b.y > 1.9 && b.y < 2.9 && b.vy < 0) out.high.push({ x: b.x, y: b.y, z: b.z, t }); // descending lob: a smash chance
    if (floors >= 1) out.samples.push({ x: b.x, y: b.y, z: b.z, vy: b.vy, t });
  }
  out.valid = floors > 0;
  out.t = t;
  return out;
}

/** Complementary error function (Abramowitz-Stegun 7.1.26, max error 1.5e-7). */
function erfc(x) {
  const z = Math.abs(x), t = 1 / (1 + 0.3275911 * z);
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z);
  return x >= 0 ? y : 2 - y;
}

/** How hard is this flight for the opponents? > 0 means they cannot get a good ball back (seconds of margin they lack). */
function difficulty(flight, opps, react) {
  let best = -Infinity; // the best-placed opponent decides
  for (const o of opps) {
    let margin = -1; // no playable point at all: the ball dies / goes away from them
    for (const s of flight.samples) {
      if (s.y < 0.25 || s.y > 1.8) continue;
      if (Math.sign(s.z) !== Math.sign(o.z || 1) && Math.abs(s.z) > 0.4) continue; // on their own side only
      const need = Math.max(0, Math.hypot(s.x - o.x, s.z - o.z) - 1.4) / OPP_RUN + react;
      margin = s.t - need;
      break; // the first playable point after the bounce (walls included)
    }
    // a smashable lob: an opponent who can get under the descending ball before it bounces
    for (const h of flight.high) {
      const need = Math.max(0, Math.hypot(h.x - o.x, h.z - o.z) - 1.2) / OPP_RUN + react * 0.5;
      const m = h.t - need;
      if (m > -0.1) { margin = Math.max(margin, 1.2); break; }
    }
    best = Math.max(best, margin);
  }
  return clamp(-best, -1.4, 1.2);
}

/**
 * Choose the best shot for bot player `p` right now.
 * Returns {ax, az, mod, lob, tac, reason, score, evaluated, table} or null when nothing valid is found.
 * `skill` is the bot's skill record (shared/ai.js); `rnd` the game's random source.
 */
export function evaluateShot(game, p, skill, rnd) {
  const b = game.ball;
  const os = p.team === 0 ? 1 : -1;
  const opps = game.players.filter((o) => o.team !== p.team && o.active);
  if (!opps.length) return null;
  const rebound = !!game.rally.wallTouched; // the ball has just come off a wall
  const stretched = Math.hypot(b.x - p.x, b.z - p.z) > 1.35 || Math.hypot(p.vx, p.vz) > 4.5;
  const tired = p.stamina < PLAYER.TIRED_FROM;
  const pressure = clamp((stretched ? 0.6 : 0) + (tired ? 0.3 : 0) + (rebound && Math.abs(p.z) > 8 ? 0.3 : 0), 0, 1);
  const high = b.y > 2.1;
  const nearNet = Math.abs(p.z) < 4.8;
  const deepOpp = opps.every((o) => Math.abs(o.z) > 5.8);
  const netOpp = opps.some((o) => Math.abs(o.z) < 4.6);
  const lim = game.singles ? 3.0 : 4.2;
  const xs = game.singles ? [-2.4, 0, 2.4] : [-3.8, -2.2, 0, 2.2, 3.8];
  const cands = [];
  const add = (kind, label, x, depth, extra = {}) => cands.push({ kind, label, x: clamp(x, -lim, lim), depth, ...extra });

  if (high) {
    for (const x of xs) { add('smash', 'smash', x, 8); }
    if (nearNet && b.y >= 2.2) { add('smash', 'smash-kill', xs[1], 3.4); add('smash', 'smash-kill', xs[3], 3.4); }
    for (const x of [xs[0], xs[xs.length - 1]]) { add('bandeja', 'bandeja', x * 0.8, 8); add('vibora', 'vibora', x, 7.5); }
  } else {
    for (const x of xs) for (const d of [5.5, 8.6]) add('drive', 'drive', x, d);
    for (const x of [xs[0], xs[xs.length - 1]]) add('slice', 'slice', x, 8);
    for (const x of [-2.4, 0, 2.4]) add('lob', 'lob', x, 8.8);
    if (nearNet) { add('chiquita', 'chiquita', xs[1], 3); add('chiquita', 'chiquita', xs[3], 3); }
    if (deepOpp) add('drop', 'drop', xs[2], 1.8);
    // deep angled shots that make the ball come off the side and back glass (double wall): hard to return
    add('drive', 'corner', xs[0] * 1.1, 9.3); add('drive', 'corner', xs[xs.length - 1] * 1.1, 9.3);
    if (!game.singles) { add('slice', 'corner', xs[0] * 1.1, 9.3); add('slice', 'corner', xs[xs.length - 1] * 1.1, 9.3); }
  }

  const react = 0.12 + 0.2 * (1 - clamp(skill.speed, 0.8, 1.1)) + 0.12; // what we assume the opponents need to start moving
  const table = [];
  let best = null;
  for (const c of cands) {
    const K = KINDS[c.kind];
    const tx = c.x, tz = os * c.depth;
    const dist = Math.hypot(tx - b.x, tz - b.z) || 1;
    const T = K.T ?? clamp(dist / K.speed, c.kind === 'smash' ? 0.16 : 0.3, 3);
    const v = solveLaunch(b, tx, tz, T);
    const ss = c.kind === 'vibora' ? (Math.sign((tx - b.x) * os) || 1) * 12 : 0;
    const f = flyShot(b, v, K.sb, ss);
    let score;
    let why;
    if (!f.valid || !f.floor) { score = -9; why = f.reason || 'no bounce'; }
    else {
      const diff = difficulty(f, opps, react);
      const edge = Math.min(COURT.HALF_W - Math.abs(f.floor.x), COURT.HALF_L - Math.abs(f.floor.z), f.reason === 'out-after-bounce' ? 9 : 99);
      // Real shots scatter: the worse the contact, the wider. Risk = chance the landing spot ends outside the lines (a normal
      // distribution around the plan) plus the chance of not clearing the net.
      const sigma = 0.45 + 0.6 * skill.noise + 0.8 * pressure;
      const pOut = 0.5 * erfc(Math.max(0, edge) / (sigma * 1.414));
      const netSigma = 0.12 + 0.12 * skill.noise + 0.2 * pressure;
      const pNet = f.netMargin === 9 ? 0 : 0.5 * erfc(Math.max(0, f.netMargin) / (netSigma * 1.414));
      const risk = (pOut * 2 + pNet * 2.2);
      let bonus = 0;
      if (c.kind === 'lob') bonus += (skill.lob - 0.4) * 0.8 + (netOpp ? 0.1 : -0.35) + pressure * 0.45 + (Math.abs(p.z) > 7.5 ? 0.1 : 0);
      if (c.kind === 'chiquita') bonus += (netOpp ? 0.25 : -0.1) + (skill.slice - 0.2) * 0.4;
      if (c.kind === 'drop') bonus += (skill.aggr - 0.4) * 0.5;
      if (c.kind === 'slice') bonus += (skill.slice - 0.2) * 0.8 + pressure * 0.15;
      if (c.kind === 'smash') bonus += (skill.smash - 0.5) * 0.5 + 0.35;
      if (c.label === 'smash-kill') bonus += (skill.smash - 0.6) * 1.2 - 0.3 + (f.reason === 'out-after-bounce' ? 1.1 : 0);
      if (c.kind === 'bandeja') bonus += 0.2 + (1 - skill.aggr) * 0.3;
      if (c.label === 'corner') bonus += f.wallsAfter >= 1 ? 0.15 + 0.1 * Math.min(2, f.wallsAfter) : -0.2;
      if (c.kind === 'drive') bonus += (skill.aggr - 0.3) * 0.4;
      // the glass does the work: a rebound ball is best answered by an option that keeps the opponents away from the net / uses the wall
      if (rebound && c.kind === 'lob') bonus += 0.25;
      score = diff * 1.6 + bonus - risk * 1.4;
      why = `diff ${diff.toFixed(2)} risk ${risk.toFixed(2)} walls ${f.wallsAfter}`;
    }
    const row = { ...c, score, why, f };
    table.push(row);
    if (!best || score > best.score) best = row;
  }
  if (!best || best.score <= -9) return null;
  // players are not perfect: the weaker the bot, the more it can pick a near-best option instead of the best
  const slack = (0.55 - 0.4 * skill.aggr) * (1.3 - clamp(skill.speed, 0.8, 1.1) * 0.8) * 0.5;
  const near = table.filter((r) => r.score > -9 && r.score >= best.score - slack);
  const pick = near.length > 1 ? near[Math.floor(rnd() * near.length)] : best;
  const K = KINDS[pick.kind];
  let tac = pick.label === 'smash-kill' ? 'por4' : pick.label === 'corner' ? 'corner-wall' : pick.kind;
  if (rebound && pick.label !== 'corner' && pick.label !== 'smash-kill') tac = pick.kind === 'lob' || pick.kind === 'chiquita' || pick.kind === 'slice' ? 'recovery' : pick.kind === 'drive' || pick.kind === 'smash' ? 'bajada' : tac;
  return {
    ax: pick.x, az: os * pick.depth, mod: K.mod, lob: K.lob, tac, kind: pick.kind, label: pick.label,
    reason: `${pick.label}${rebound ? ' (after a wall rebound)' : ''}: ${pick.why}`, score: pick.score, evaluated: table.length, table, rebound, pressure,
  };
}

export { netHeight };
