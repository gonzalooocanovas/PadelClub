// File-backed persistence (guest profiles + finished matches).
// This is a deliberately small stand-in for PostgreSQL: the Store interface
// (profile / recordMatch) is all the rest of the server touches, so a SQL
// implementation can replace this file without changing anything else.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CAREER } from '../shared/career.js';

const MAX_MATCHES = 500;
const MAX_HISTORY = 20;

export const levelFor = (xp) => Math.floor(Math.sqrt(xp / 100)) + 1;

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'store.json');
    this.data = { profiles: {}, matches: [] };
    this.timer = null;
    fs.mkdirSync(dir, { recursive: true });
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      /* first run or unreadable file: start empty */
    }
  }

  newToken() {
    return crypto.randomBytes(16).toString('hex');
  }

  /** Create the profile if needed and return it. */
  profile(token, name) {
    let p = this.data.profiles[token];
    if (!p) {
      p = { name: name || 'Guest', xp: 0, matches: 0, wins: 0, losses: 0, createdAt: Date.now(), history: [] };
      this.data.profiles[token] = p;
      this.scheduleSave();
    } else if (name && name !== p.name) {
      p.name = name;
      this.scheduleSave();
    }
    return p;
  }

  hasProfile(token) {
    return !!this.data.profiles[token];
  }

  publicProfile(token) {
    const p = this.data.profiles[token];
    if (!p) return null;
    return { name: p.name, xp: p.xp, level: levelFor(p.xp), matches: p.matches, wins: p.wins, losses: p.losses, history: p.history };
  }

  /** Career ladder for a profile: every stage with its stars and whether it is unlocked. */
  careerView(token) {
    const p = this.profile(token);
    const done = p.career?.done || {};
    const stages = CAREER.map((s) => ({ ...s, stars: done[s.id] || 0, unlocked: s.id === 1 || (done[s.id - 1] || 0) >= 1 }));
    return { stages, stars: stages.reduce((a, s) => a + s.stars, 0), max: CAREER.length * 3 };
  }

  /** Record a career result (stars 0 = lost). Bonus XP is paid only for improving your best stars on a stage. */
  careerComplete(token, stageId, stars) {
    const p = this.profile(token);
    const stage = CAREER.find((s) => s.id === stageId);
    p.career ||= { done: {} };
    const prev = p.career.done[stageId] || 0;
    let bonusXp = 0, unlocked = null;
    if (stage && stars > prev) {
      p.career.done[stageId] = stars;
      bonusXp = stage.xp * (stars - prev);
      p.xp += bonusXp;
      if (prev === 0 && CAREER.some((s) => s.id === stageId + 1)) unlocked = stageId + 1;
    }
    this.scheduleSave();
    return { stars, prev, bonusXp, unlocked, level: levelFor(p.xp) };
  }

  /**
   * Persist a finished match. `humans` = [{token, name, slot, team}].
   * Only the server calls this, from its own simulation's result.
   */
  recordMatch({ code, humans, results, settings }) {
    const entry = {
      at: Date.now(), code, settings,
      winner: results.winner, score: results.score.sets, duration: results.duration,
      players: humans.map((h) => ({ name: h.name, team: h.team })),
    };
    this.data.matches.push(entry);
    if (this.data.matches.length > MAX_MATCHES) this.data.matches.splice(0, this.data.matches.length - MAX_MATCHES);
    const gains = {};
    for (const h of humans) {
      const p = this.profile(h.token, h.name);
      const won = h.team === results.winner;
      const gain = 40 + (won ? 60 : 0);
      p.xp += gain;
      p.matches++;
      if (won) p.wins++; else p.losses++;
      p.history.unshift({
        at: entry.at, won, score: results.score.sets.map((s) => `${s[0]}-${s[1]}`).join(' '),
        team: h.team, duration: results.duration,
      });
      if (p.history.length > MAX_HISTORY) p.history.length = MAX_HISTORY;
      gains[h.token] = { xp: gain, level: levelFor(p.xp), totalXp: p.xp };
    }
    this.scheduleSave();
    return gains;
  }

  scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 400);
    this.timer.unref?.();
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const tmp = `${this.file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] write failed:', err.message);
    }
  }
}
