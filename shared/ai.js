// Padel AI. Produces the same input a human client would send, so bots obey every game rule.
// Used for practice, career mode, and to cover for players who disconnect mid-match.
//
// Four levels (the ids are what rooms and the career use):
//   easy = Rookie   normal = Club   hard = Pro   expert = Legend

import { clamp, COURT } from './constants.js';
import { predictBall, serveBallHeight } from './physics.js';
import { STYLE_MODS } from './roster.js';

export const BOT_LEVELS = ['easy', 'normal', 'hard', 'expert'];
export const BOT_LABELS = { easy: 'Rookie', normal: 'Club', hard: 'Pro', expert: 'Legend' };

const SKILL = {
  // speed: top speed factor · react: seconds before reacting · noise: aim scatter · reach: swing distance
  // flub: chance to miss a ball outright · aggr: willingness to attack · lob/slice/smash: shot mix
  // serveSpin: chance of a spin serve · serveTiming: waits for the ideal bounce height · plan: replanning interval
  easy: { speed: 0.9, sprint: true, react: 0.3, noise: 2.0, reach: 1.9, flub: 0.24, timingErr: 0.24, aggr: 0.12, lob: 0.35, slice: 0.08, smash: 0.35, serveSpin: 0, serveTiming: false, serveWindow: 0.45, serveRisk: 0.0, plan: 0.12 },
  normal: { speed: 0.96, sprint: true, react: 0.18, noise: 1.1, reach: 2.0, flub: 0.14, timingErr: 0.14, aggr: 0.3, lob: 0.45, slice: 0.18, smash: 0.5, serveSpin: 0.15, serveTiming: false, serveWindow: 0.25, serveRisk: 0.3, plan: 0.1 },
  hard: { speed: 1.0, sprint: true, react: 0.09, noise: 0.55, reach: 2.15, flub: 0.1, timingErr: 0.07, aggr: 0.5, lob: 0.5, slice: 0.25, smash: 0.7, serveSpin: 0.4, serveTiming: true, serveWindow: 0.12, serveRisk: 0.6, plan: 0.07 },
  expert: { speed: 1.04, sprint: true, react: 0.04, noise: 0.25, reach: 2.3, flub: 0.04, timingErr: 0.03, aggr: 0.75, lob: 0.55, slice: 0.3, smash: 0.85, serveSpin: 0.6, serveTiming: true, serveWindow: 0.05, serveRisk: 0.85, plan: 0.05 },
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

const blank = () => ({ mx: 0, mz: 0, sprint: false, swing: false, jump: false, ax: 0, az: 0, mod: 0, lob: false });

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
    mem.planAge += dt;
    if (mem.planAge > skill.plan) {
      mem.planAge = 0;
      const samples = predictBall(b, 3.0);
      let pick = null;
      let bounced = r.bounces >= 1;
      for (const s of samples) {
        if (s.floor) bounced = true;
        const mine = p.team === 0 ? s.z < -0.4 : s.z > 0.4;
        // groundstrokes after the bounce; volleys only in the net zone
        // overhead: a high ball falling in my half before it bounces is attacked (smash / bandeja) by players who dare
        if (mine && !bounced && s.vy < 0 && s.y < 2.45 && s.y > 1.95 && Math.abs(s.z) < 7 && rnd() < 0.25 + skill.smash * 0.75) { pick = s; break; }
        if (mine && s.y < 1.7 && s.vy <= 0.5 && (bounced || Math.abs(s.z) < 4.2)) { pick = s; break; }
      }
      mem.plan = pick || null;
    }
    const partner = game.players[slot ^ 1];
    const plan = mem.plan;
    let responsible = true;
    if (plan && partner.active) {
      const me = Math.hypot(plan.x - p.x, plan.z - p.z);
      const pa = Math.hypot(plan.x - partner.x, plan.z - partner.z);
      responsible = me < pa - 0.3 || (Math.abs(me - pa) <= 0.3 && slot < partner.slot);
    }
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
        && dist < skill.reach && !mem.flub && b.y < 2.9 && b.y > 0.1 && mem.react <= 0 && swingNow(b, dx, dz, dist, mem)) {
      chooseShot(inp, game, p, os, skill);
      inp.swing = true;
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
  return dist < 1.25 || ttc <= 0.17 + (mem.jit || 0);
}

/** Serve: stronger levels wait for the ball at waist height, aim for the corners and add spin. */
function serve(inp, game, p, os, skill, mem, dt) {
  const rnd = game.rng;
  mem.serveT += dt;
  if (mem.serveT < 1.1 + skill.react * 2 || game.serveWait > 0) return;
  const y = game.ball.y;
  // the racket meets the ball about 0.05 s after the press: judge the height then. Better levels wait for a tighter window.
  const yHit = serveBallHeight(game.time + 0.05);
  const win = skill.serveWindow ?? 0.5;
  if (Math.abs(yHit - 0.62) > win && mem.serveT < 4) return;
  void y;
  const boxSign = -game.rally.serveXSign;
  const edge = game.singles ? 3.2 : 4.4;
  // risk = how close to the lines the bot aims; the box is [0.3 .. edge] wide and 6.9 m deep
  const lateral = 1.6 + (edge - 1.9) * skill.serveRisk * rnd() + rnd() * 0.6;
  inp.ax = boxSign * Math.min(edge - 0.3, lateral);
  inp.az = os * (4.6 + 1.5 * skill.serveRisk * rnd());
  inp.mod = rnd() < skill.serveSpin ? (rnd() < 0.5 ? 3 : 1) : 0;
  inp.swing = true;
  mem.serveT = 0;
}

function formation(inp, game, p, os, skill, mem) {
  const b = game.ball;
  if (game.singles) { moveTo(inp, p, clamp(b.x * 0.45, -2.4, 2.4), -os * ((skill.backZ ?? 7.6) - 0.1), skill, false); return; }
  // whoever is already nearer the net holds it (the server's partner starts there), the other covers the back
  const partner = game.players[p.slot ^ 1];
  const dp = Math.abs(p.z), dq = Math.abs(partner.z);
  // roles are fixed when the point starts (who is at the net, who holds the baseline) and only swap when the pair has
  // really changed ends (a lob chase): players no longer drift up to the net just because they hit the last ball
  let net = dp < dq || (dp === dq && p.slot % 2 === 0);
  if (mem?.role) {
    net = mem.role === 'net';
    if (net && dp - dq > 2.8) net = false;
    else if (!net && dq - dp > 2.8) net = true;
  }
  const tz = -os * (net ? (skill.netZ ?? 3.4) : (skill.backZ ?? 7.6));
  const off = net ? (p.team === 0 ? -1.3 : 1.3) : (p.team === 0 ? 1.3 : -1.3);
  const tx = clamp(b.x * 0.45 + off, -3.6, 3.6);
  moveTo(inp, p, tx, tz, skill, false);
}

/** Pick the target and the shot: find the open space, then choose between lob, drop, smash, slice, drive. */
function chooseShot(inp, game, p, os, skill) {
  const rnd = game.rng;
  const b = game.ball;
  const opp = game.players.filter((o) => o.team !== p.team && o.active);
  const netOpp = opp.filter((o) => Math.abs(o.z) < 4.5).length;
  const deepOpp = opp.filter((o) => Math.abs(o.z) > 6.5).length;
  const lim = (game.singles ? 2.2 : 2.4) + 1.4 * skill.aggr; // stronger players go closer to the lines

  // open space: the lateral position farthest from every opponent
  let bestX = 0, bestScore = -1;
  for (let x = -lim; x <= lim + 0.01; x += lim / 2) {
    const score = Math.min(...opp.map((o) => Math.abs(o.x - x) + 0.15 * Math.abs(Math.abs(o.z) - 6))) + rnd() * (1.4 - skill.aggr);
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
    if (inp.mod === 0) inp.az = os * (netOpp ? 5 : 8);
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
