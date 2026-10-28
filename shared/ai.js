// Padel AI. Produces the same input a human client would send, so bots obey every game rule.
// Used for practice, career mode, and to cover for players who disconnect mid-match.
//
// Four levels (the ids are what rooms and the career use):
//   easy = Rookie   normal = Club   hard = Pro   expert = Legend

import { clamp, COURT } from './constants.js';
import { predictBall, serveBallHeight } from './physics.js';
import { STYLE_MODS } from './roster.js';
import { evaluateShot } from './tactics.js';

export const BOT_LEVELS = ['easy', 'normal', 'hard', 'expert'];
export const BOT_LABELS = { easy: 'Rookie', normal: 'Club', hard: 'Pro', expert: 'Legend' };

const SKILL = {
  // speed: top speed factor · react: seconds before reacting · noise: aim scatter · reach: swing distance
  // flub: chance to miss a ball outright · aggr: willingness to attack · lob/slice/smash: shot mix
  // serveSpin: chance of a spin serve · serveTiming: waits for the ideal bounce height · plan: replanning interval
  easy: { speed: 0.9, sprint: true, react: 0.3, noise: 2.0, reach: 1.9, flub: 0.3, timingErr: 0.24, aggr: 0.12, lob: 0.35, slice: 0.08, smash: 0.35, serveSpin: 0, serveTiming: false, serveWindow: 0.45, servePace: 0.78, serveRisk: 0.0, plan: 0.12 },
  normal: { speed: 0.96, sprint: true, react: 0.18, noise: 1.4, reach: 1.95, flub: 0.24, timingErr: 0.14, aggr: 0.3, lob: 0.45, slice: 0.18, smash: 0.5, serveSpin: 0.15, serveTiming: false, serveWindow: 0.25, servePace: 0.9, serveRisk: 0.3, plan: 0.1 },
  hard: { speed: 0.95, sprint: true, react: 0.09, noise: 0.5, reach: 2.2, flub: 0.12, timingErr: 0.07, aggr: 0.5, lob: 0.5, slice: 0.25, smash: 0.7, serveSpin: 0.4, serveTiming: true, serveWindow: 0.12, servePace: 1.0, serveRisk: 0.6, plan: 0.07 },
  expert: { speed: 1.1, sprint: true, react: 0.03, noise: 0.15, reach: 2.4, flub: 0.07, timingErr: 0.03, aggr: 0.45, lob: 0.55, slice: 0.3, smash: 0.85, serveSpin: 0.6, serveTiming: true, serveWindow: 0.05, servePace: 1.1, serveRisk: 0.85, plan: 0.05 },
};

const skillCache = new Map();
/**
 * A bot is a level ('easy'..'expert') optionally with a style ({level, style}). The style shifts the level's tendencies:
 * where the bot stands (netZ/backZ) and how often it attacks, lobs, slices and smashes.
 */
export function skillFor(d) {
  const level = typeof d === 'object' && d ? d.level : d;
  const style = typeof d === 'object' && d ? d.style : null;
  const key = level + '|' + style;
  if (skillCache.has(key)) return skillCache.get(key);
  const base = { ...(SKILL[level] || SKILL.normal) };
  const m = STYLE_MODS[style] || {};
  for (const [k, v] of Object.entries(m)) {
    if (k === 'netZ' || k === 'backZ') base[k] = v;
    else base[k] = (base[k] ?? 0) + v;
  }
  for (const k of ['aggr', 'lob', 'slice', 'smash', 'flub']) base[k] = Math.max(0, Math.min(1, base[k]));
  base.speed = Math.max(0.8, Math.min(1.1, base.speed));
  base.noise = Math.max(0.1, base.noise);
  skillCache.set(key, base);
  return base;
}

export function makeBotMemory() {
  return { serveT: 0, plan: null, planAge: 99, react: 0, lastTeam: -1, flub: false };
}

const blank = () => ({ mx: 0, mz: 0, sprint: false, swing: false, jump: false, ax: 0, az: 0, mod: 0, lob: false, keep: true });

function moveTo(inp, p, tx, tz, skill, allowSprint) {
  const dx = tx - p.x, dz = tz - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.08) return d;
  const k = Math.min(1, d / 0.5) * skill.speed;
  inp.mx = (dx / d) * k;
  inp.mz = (dz / d) * k;
  inp.sprint = allowSprint && skill.sprint && d > 2.5 && p.stamina > 30; // bots save their legs too
  return d;
}

/**
 * The team's answer to the incoming ball, computed once per few ticks and shared by both partners (a deterministic function of the
 * visible state: ball flight, positions, skills). Returns {plan, owner, ...}: the contact point to go to and the slot that owns it
 * (-1 = nobody can do anything about it). Ownership rules, in order:
 *  - only players who can actually get there in time compete (time to run there against the time the ball takes);
 *  - the player on the ball's side gets a small advantage; the middle goes to whoever is nearer;
 *  - a person (human partner) gets priority: the bot takes the ball only if the person cannot reach it, or the bot is clearly better placed;
 *  - the owner keeps the ball unless the partner becomes clearly better placed (no flicker, no double commitment);
 *  - if nobody can reach it, the nearest player still goes for it (the emergency fallback).
 */
function teamPlan(game, team, skill) {
  const store = game._tp || (game._tp = [{ tick: -99 }, { tick: -99 }]);
  const S = store[team];
  const r = game.rally, b = game.ball;
  const key = r.hits + ':' + r.lastTeam;
  if (S.key !== key) { S.key = key; S.owner = -1; S.epStart = game.time; S.dare = game.rng(); S.plan = null; S.tick = -99; }
  if (game.tickNo - S.tick < 3 && S.plan !== undefined) return S; // a tactical read refreshed every 50 ms
  S.tick = game.tickNo;
  const mates = [game.players[team * 2], game.players[team * 2 + 1]].filter((q) => q.active);
  const speedOf = (q) => (q.human ? 1 : skill.speed);
  const reactLeft = (q) => (q.human ? 0 : Math.max(0, skill.react - (game.time - S.epStart)));
  const samples = predictBall(b, 3.0);
  const need = (q, s) => Math.max(0, Math.hypot(s.x - q.x, s.z - q.z) - 0.6) / (speedOf(q) * 6.4);
  let bounced = r.bounces >= 1, plan = null, first = null, reach = [];
  for (const s of samples) {
    if (s.floor) bounced = true;
    const mine = team === 0 ? s.z < -0.4 : s.z > 0.4;
    const overhead = mine && !bounced && s.vy < 0 && s.y < 2.45 && s.y > 1.95 && Math.abs(s.z) < 7 && S.dare < 0.25 + skill.smash * 0.75;
    const ground = mine && s.y < 1.7 && s.vy <= (bounced ? 2.0 : 0.5) && (bounced || Math.abs(s.z) < 4.2); // after the bounce, also off the glass
    if (!overhead && !ground) continue;
    first = first || s;
    const ok = mates.filter((q) => need(q, s) <= s.t - reactLeft(q));
    if (ok.length) { plan = s; reach = ok; break; }
  }
  plan = plan || first;
  S.plan = plan || null;
  if (!plan) { S.owner = -1; return S; }
  const pool = reach.length ? reach : mates; // emergency: nobody makes it, the nearest still tries
  const mid = mates.length === 2 ? (mates[0].x + mates[1].x) / 2 : 0;
  const cost = (q) => {
    const sideBias = mates.length === 2 && (plan.x - mid) * (q.x < mates.find((m) => m !== q).x ? -1 : 1) > 0 ? -0.25 : 0; // ball-side player
    return need(q, plan) + sideBias - (q.human ? 0.35 : 0) + (q.slot === S.owner ? -0.25 : 0); // priority to a person; keep the owner
  };
  let best = pool[0];
  for (const q of pool) if (cost(q) < cost(best) - 1e-9 || (Math.abs(cost(q) - cost(best)) <= 1e-9 && q.slot < best.slot)) best = q;
  S.owner = best.slot;
  return S;
}

export function botInput(game, slot, mem, difficulty = 'normal', dt = 1 / 60) {
  const skill = skillFor(difficulty);
  const p = game.players[slot];
  const inp = blank();
  const os = p.team === 0 ? 1 : -1;
  const r = game.rally;
  const b = game.ball;
  const rnd = game.rng;

  if (game.phase === 'serve') {
    if (game.serverSlot === slot) serve(inp, game, p, os, skill, mem, dt);
    mem.plan = null; mem.react = 0; mem.lastTeam = -1;
    mem.role = Math.abs(p.z) < 5 ? 'net' : 'back'; // the server and the receiver start at the back, their partners at the net
    if (game.aiTeam) game.aiTeam[p.team] = { mode: 'D', since: game.time, tick: -1 };
    return inp;
  }
  if (game.phase !== 'rally') return inp;

  const incoming = r.lastTeam !== p.team;
  if (r.lastTeam !== mem.lastTeam) {
    mem.lastTeam = r.lastTeam; mem.planAge = 99;
    mem.react = r.serving ? skill.react * 0.6 : skill.react; // receivers do not anticipate: they react to the serve, not before it
    mem.flub = rnd() < skill.flub * (r.serving ? 0.35 : 1);
    mem.jit = (rnd() - 0.5) * skill.timingErr; // each level presses a little earlier or later
  }
  mem.react = Math.max(0, mem.react - dt);

  if (incoming && (b.ex || Math.abs(b.x) > COURT.HALF_W) && game.openings) {
    outsideBall(inp, game, p, os, skill, mem);
    return inp;
  }

  if (incoming) {
    // Stages: (1) predict the ball, (2) find the contact points each player can really reach, (3) agree who takes it (one plan per
    // team, so partners never disagree), (4) the others hold or recover their formation, (5) the owner chooses a shot.
    const tp = teamPlan(game, p.team, skill);
    const plan = tp.plan;
    mem.plan = plan;
    const responsible = tp.owner === slot || (tp.owner === -1 && !game.players[slot ^ 1].active);
    if (plan && responsible) {
      if (mem.react <= 0) moveTo(inp, p, plan.x, plan.z - os * (plan.y > 1.8 ? 0.3 : 0.75), skill, true);
    } else {
      formation(inp, game, p, os, skill, mem);
    }
    // swing when the ball is close enough and on the way
    const dx = b.x - p.x, dz = b.z - p.z;
    const dist = Math.hypot(dx, dz);
    const onMySide = p.team === 0 ? b.z < 0.2 : b.z > -0.2;
    if (responsible && onMySide && !p.swing && p.cd <= 0 && !r.serving
        && dist < skill.reach && b.y < 2.9 && b.y > 0.1 && mem.react <= 0 && swingNow(b, dx, dz, dist, mem)) {
      // Tactical choice: every candidate shot is flown through the real physics (walls included) and scored (shared/tactics.js).
      // chooseShot (the older rule-based picker) stays as the fallback when no candidate is valid.
      const tact = evaluateShot(game, p, skill, rnd);
      if (tact) {
        inp.ax = tact.ax + (rnd() - 0.5) * skill.noise * 0.6; inp.az = tact.az; inp.mod = tact.mod; inp.lob = tact.lob; inp.tac = tact.tac;
        mem.decision = { tac: tact.tac, reason: tact.reason, score: tact.score, tick: game.tickNo, ax: inp.ax, az: inp.az };
      } else { chooseShot(inp, game, p, os, skill); inp.tac = 'fallback'; mem.decision = { tac: 'fallback', reason: 'no valid candidate', tick: game.tickNo }; }
      inp.swing = true;
      // A mishit is more likely when the ball is hard to play (pace, stretched, on the run, off the glass), not a coin flip: the bot
      // still goes for the ball but strikes it badly (into the net, or long).
      const spd = Math.hypot(b.vx, b.vy, b.vz);
      const hardness = clamp((spd - 12) / 16, 0, 1) * 0.5 + (dist > 1.35 ? 0.35 : 0) + (Math.hypot(p.vx, p.vz) > 4.5 ? 0.15 : 0) + (r.wallTouched ? 0.1 : 0);
      inp.slip = rnd() < skill.flub * 1.0 * (0.5 + 2 * Math.min(1, hardness));
    }
  } else {
    formation(inp, game, p, os, skill, mem);
  }
  return inp;
}

/** The ball left through a door: the nearer player of the receiving team follows it outside and returns it round the net post. */
function outsideBall(inp, game, p, os, skill, mem) {
  const b = game.ball;
  const partner = game.players[p.slot ^ 1];
  const mine = Math.hypot(b.x - p.x, b.z - p.z), theirs = partner.active ? Math.hypot(b.x - partner.x, b.z - partner.z) : Infinity;
  if (theirs < mine - 0.3 || (Math.abs(theirs - mine) <= 0.3 && partner.slot < p.slot)) { formation(inp, game, p, os, skill, mem); return; }
  const s = Math.sign(b.x) || 1;
  const doorZ = -os * (COURT.DOOR.z0 + COURT.DOOR.z1) / 2;
  if (Math.abs(p.x) <= COURT.HALF_W - 0.05) { // still inside: walk to the door first
    moveTo(inp, p, Math.abs(p.z - doorZ) > 0.5 ? s * 4.2 : s * 5.6, doorZ, skill, true);
    return;
  }
  moveTo(inp, p, b.x - s * 0.5, b.z - os * 0.3, skill, true);
  const d = Math.hypot(b.x - p.x, b.z - p.z);
  if (!p.swing && p.cd <= 0 && d < 1.3 && b.y > 0.1 && b.y < 2.2 && mem.react <= 0) inp.swing = true;
}

/** Press so the ball reaches the sweet spot about 0.17 s into the swing (where the racket face is square). */
function swingNow(b, dx, dz, dist, mem) {
  const closing = -(dx * b.vx + dz * b.vz) / (dist || 1);
  const ttc = Math.max(0, dist - 0.95) / Math.max(closing, 1.5);
  if (closing < 1.5) return dist < 1.25; // a slow or stationary ball: swing when it is in range
  return ttc <= 0.17 + (mem.jit || 0); // a moving ball: press so that it meets the racket 0.17 s into the swing (not when it is already on top of us)
}

/** Serve: stronger levels wait for the ball at waist height, aim for the corners and add spin. */
function serve(inp, game, p, os, skill, mem, dt) {
  const rnd = game.rng;
  mem.serveT += dt;
  if (mem.serveWaitExtra === undefined) mem.serveWaitExtra = rnd() * 0.9;
  if (mem.serveT < 2.0 + skill.react * 2 + mem.serveWaitExtra || game.serveWait > 0) return; // give the receivers time to get set: no rushed serves
  const y = game.ball.y;
  // the racket meets the ball about 0.05 s after the press: judge the height then. Better levels wait for a tighter window.
  const yHit = serveBallHeight(game.time + 0.05);
  const win = skill.serveWindow ?? 0.5;
  if (Math.abs(yHit - 0.62) > win && mem.serveT < 4) return;
  void y;
  const boxSign = -game.rally.serveXSign;
  const edge = game.singles ? 3.2 : 4.4;
  // risk = how close to the lines the bot aims; the box is [0.3 .. edge] wide and 6.9 m deep
  const lateral = 1.4 + (edge - 2.6) * skill.serveRisk * rnd() + rnd() * 0.6; // bots no longer pick the extreme corners every time
  inp.ax = boxSign * Math.min(edge - 0.9, lateral);
  inp.az = os * (3.9 + 1.4 * skill.serveRisk * rnd());
  inp.mod = rnd() < skill.serveSpin ? (rnd() < 0.5 ? 3 : 1) : 0;
  inp.pace = (skill.servePace ?? 0.9) - rnd() * 0.06; // bots do not serve at full pace every time
  inp.swing = true;
  mem.serveT = 0;
  mem.serveWaitExtra = undefined;
}

/**
 * Doubles tactics, modelled on how real pairs move. A pair is almost always on the same line: both defending from the
 * baseline ('D') or both attacking at the net ('A'); the one-up-one-back split only exists briefly (the serve, the return,
 * a transition). The mode is decided ONCE per tick per team from shared information and stored on the game, so both
 * team-mates always agree without talking:
 *   incoming ball:  a lob or a deep ball → retreat (D); a short ball → go up (A)
 *   our own shot:   a good (deep, high) lob or a short low ball → go up (A); a poor lob or a drive → stay back (D)
 * A mode is held for a moment so the pair never flickers.
 */
function flightInfo(game) {
  const c = game._flight;
  if (c && c.tick === game.tickNo) return c;
  if (c && game.tickNo - c.tick < 4) return c; // recomputed every few ticks: it is only a tactical read
  const samples = predictBall(game.ball, 2.6);
  let apex = game.ball.y, firstFloor = null, netY = null, prevZ = game.ball.z;
  for (const s of samples) {
    apex = Math.max(apex, s.y);
    if (netY === null && (prevZ < 0) !== (s.z < 0)) netY = s.y;
    prevZ = s.z;
    if (!firstFloor && s.floor) firstFloor = s;
  }
  game._flight = { tick: game.tickNo, apex, firstFloor, netY };
  return game._flight;
}

function teamMode(game, p, skill) {
  const T = game.aiTeam || (game.aiTeam = [{ mode: 'D', since: 0, tick: -1 }, { mode: 'D', since: 0, tick: -1 }]);
  const S = T[p.team];
  if (S.tick === game.tickNo) return S.mode;
  S.tick = game.tickNo;
  const r = game.rally, b = game.ball;
  const f = flightInfo(game);
  const dFloor = f.firstFloor ? Math.abs(f.firstFloor.z) : 6; // distance from the net of the first bounce
  const lobby = f.apex > 3.2 && (f.netY === null || f.netY > 2.4);
  let want = null;
  const mate = game.players[p.slot ^ 1];
  if (mate.human) {
    // playing with a person: follow THEIR line (up when they are up, back when they are back) so the pair stays together; a
    // lob coming over still sends us back to cover it
    const incoming = r.lastTeam !== p.team;
    const lobIn = incoming && f.apex > 3.2 && (f.netY === null || f.netY > 2.4);
    if (lobIn) want = 'D';
    else if (Math.abs(mate.z) < 4.4) want = 'A';
    else if (Math.abs(mate.z) > 5.8) want = 'D';
    if (want && want !== S.mode && game.time - S.since >= 0.6) { S.mode = want; S.since = game.time; }
    return S.mode;
  }
  if (r.lastTeam !== p.team) { // the ball is coming to us
    const onMySide = p.team === 0 ? b.z < 0.5 : b.z > -0.5;
    if (lobby || dFloor > 6.2) want = 'D';
    else if (dFloor < 4.3 && b.y < 2.4 && skill.aggr >= 0.1) want = 'A';
    else if (!onMySide) want = null;
  } else { // we hit it
    if (lobby) want = dFloor > 7.2 ? 'A' : 'D'; // a deep lob wins the net, a poor one gets smashed
    else if (dFloor < 3.6 && f.apex < 2.0) want = 'A'; // a short low ball: they have to lift it
    else if (skill.aggr >= 0.1 && f.apex < 2.2 && game.players.filter((o) => o.team !== p.team && o.active).every((o) => Math.abs(o.z) > 6)) want = 'A';
  }
  if (want && want !== S.mode && game.time - S.since >= 0.8) { S.mode = want; S.since = game.time; }
  return S.mode;
}

function formation(inp, game, p, os, skill, mem) {
  const b = game.ball;
  if (game.singles) { moveTo(inp, p, clamp(b.x * 0.45, -2.4, 2.4), -os * ((skill.backZ ?? 7.6) - 0.1), skill, false); return; }
  const partner = game.players[p.slot ^ 1];
  const dp = Math.abs(p.z), dq = Math.abs(partner.z);
  const r = game.rally;
  if (r.serving || r.hits <= 1) {
    // the serve and the return keep the starting roles: server and receiver at the baseline, their partners at the net
    let net = dp < dq || (dp === dq && p.slot % 2 === 0);
    if (mem?.role) net = mem.role === 'net';
    const tz = -os * (net ? (skill.netZ ?? 3.4) : (skill.backZ ?? 7.6));
    const off = net ? (p.team === 0 ? -1.3 : 1.3) : (p.team === 0 ? 1.3 : -1.3);
    moveTo(inp, p, clamp(b.x * 0.45 + off, -3.6, 3.6), tz, skill, false);
    return;
  }
  // From the first return on, the pair moves as a unit: same line, side by side, shifting with the ball
  const mode = teamMode(game, p, skill);
  const lower = p.x < partner.x || (p.x === partner.x && p.slot < partner.slot); // each keeps their own side
  const att = mode === 'A';
  const centre = clamp(b.x * (att ? 0.5 : 0.55), -1.7, 1.7);
  const half = att ? 1.2 : 1.55; // the net pair is tighter; defenders cover more ground
  const tx = clamp(centre + (lower ? -half : half), -3.9, 3.9);
  let depth = att ? (skill.netZ ?? 3.4) - 0.5 : (skill.backZ ?? 7.6) - 0.4;
  // while the partner is out chasing the ball, move with them: the pair keeps one line (a partner pulled back by a lob is joined at
  // the back, a partner stepping up for a short ball is joined at the net) instead of leaving a hole
  const tp = game._tp?.[p.team];
  if (tp && game.rally.lastTeam !== p.team && tp.owner === partner.slot && tp.plan) depth = clamp(depth * 0.35 + clamp(Math.abs(partner.z), 2.8, 7.6) * 0.65, 2.8, 7.6);
  const tz = -os * depth;
  if (mem) mem.role = Math.abs(p.z) < Math.abs(partner.z) ? 'net' : 'back';
  moveTo(inp, p, tx, tz, skill, false);
}

/** Pick the target and the shot: find the open space, then choose between lob, drop, smash, slice, drive. */
function chooseShot(inp, game, p, os, skill) {
  const rnd = game.rng;
  const b = game.ball;
  const opp = game.players.filter((o) => o.team !== p.team && o.active);
  const netOpp = opp.filter((o) => Math.abs(o.z) < 4.5).length;
  const deepOpp = opp.filter((o) => Math.abs(o.z) > 6.5).length;
  // Where to send it: weigh the open space (away from the opponents, the net player most of all) against changing the
  // direction of the ball (cross-court or down the line instead of always straight back) and keep away from the very
  // lines unless the bot is good enough to risk it.
  const lim = (game.singles ? 2.6 : 3.0) + 1.0 * skill.aggr;
  let bestX = 0, bestScore = -Infinity;
  const steps = game.singles ? [-2.6, -1.3, 0, 1.3, 2.6] : [-3.8, -2.5, -1.2, 0, 1.2, 2.5, 3.8];
  for (const x of steps) {
    if (Math.abs(x) > lim) continue;
    let space = Infinity;
    for (const o of opp) {
      const w = Math.abs(o.z) < 4.5 ? 1.35 : 1.0; // a player at the net covers less ground sideways but punishes a weak ball
      space = Math.min(space, Math.abs(o.x - x) * w + 0.12 * Math.abs(Math.abs(o.z) - 6));
    }
    const change = Math.abs(x - b.x) * 0.32; // send it somewhere else than where it came from
    const centre = Math.abs(x) < 0.7 ? -0.9 : 0; // the middle is the default of a weak player, not a plan
    const score = space + change + centre + rnd() * (1.6 - skill.aggr);
    if (score > bestScore) { bestScore = score; bestX = x; }
  }
  inp.ax = bestX + (rnd() - 0.5) * skill.noise;
  inp.az = os * (6 + rnd() * 2.6);
  inp.mod = 0;
  inp.lob = false;

  if (b.y > 2.1) { // overhead: remate when they are exposed, otherwise a placed bandeja or a víbora
    const r = rnd();
    if (r < skill.smash * (netOpp === 0 ? 1.0 : 0.6)) inp.mod = 0;
    else inp.mod = rnd() < 0.5 ? 2 : 1;
    if (inp.mod === 0) {
      inp.az = os * (netOpp ? 5 : 8);
      if (rnd() < skill.smash * 0.45 * (1 - skill.noise * 0.3)) inp.az = os * 3.4; // go for the kill: "por 4" (needs a clean contact)
    }
    return;
  }
  if (netOpp >= 1 && rnd() < skill.lob * 0.55) { // globo over the net players (not every time: it is a change of pace, not a habit)
    inp.lob = true; inp.az = os * 8.5;
  } else if (deepOpp === opp.length && rnd() < skill.aggr * 0.5) { // dejada against deep opponents
    inp.mod = 1; inp.az = os * 1.6;
  } else if (Math.abs(p.z) < 3.8 && rnd() < 0.25) { // chiquita at their feet
    inp.mod = 1; inp.az = os * 3;
  } else if (rnd() < skill.slice) { // slice to change the pace
    inp.mod = 3;
  }
}
