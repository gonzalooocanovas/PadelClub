// Training drills. They run on the SAME PadelGame as a match (same physics, shots, contact model, rules); this controller
// only feeds balls, resets the score after each point and counts what the player does with the real game events.
import { createMatch, scoreView } from '../../shared/scoring.js';
import { solveLaunch } from '../../shared/physics.js';
import { DRILLS } from '../../shared/career2.js';

// Where the player stands and how the ball is fed. Team 0 always attacks toward +z.
const FEEDS = {
  forehand: { stand: [1.5, -7], from: () => [rr(-2, 2), 1.6, 8.5], land: () => [rr(-1.2, 2.2), -6.2], T: 1.05 },
  lob: { stand: [0, -3.2], from: () => [rr(-2, 2), 1.5, 8.5], land: () => [rr(-1, 1), -3.6], T: 0.95 },
  volley: { stand: [0, -2.4], from: () => [rr(-1.5, 1.5), 1.5, 8.5], land: () => [rr(-1.5, 1.5), -5.2], T: 0.8 },
  smash: { stand: [0, -3.1], from: () => [rr(-1.5, 1.5), 1.5, 6.5], land: () => [rr(-0.8, 0.8), -2.2], T: 2.05 },
};

// Target zones on the opponents' side (x0..x1, z0..z1) and which shots count
const ZONES = {
  forehand: { x0: -4.6, x1: -1.6, z0: 6.0, z1: 9.7, kinds: null, label: 'Target: deep right-hand corner' },
  lob: { x0: -4.7, x1: 4.7, z0: 6.95, z1: 9.7, kinds: ['lob'], label: 'Target: behind the service line (use the globo)' },
  volley: { x0: -4.7, x1: 4.7, z0: 3, z1: 9.7, kinds: ['volley', 'block'], label: 'Target: the open court (volley it)' },
  smash: { x0: -4.7, x1: 4.7, z0: 1, z1: 9.7, kinds: ['smash', 'bandeja', 'vibora'], label: 'Target: the court (smash or bandeja)' },
};
const rr = (a, b) => a + Math.random() * (b - a);

export class DrillController {
  constructor(drillId) {
    this.drill = DRILLS.find((d) => d.id === drillId);
    this.zone = ZONES[drillId] || null;
    this.attempts = 0; this.score = 0;
    this.lastHit = null; this.evaluated = false; this.serveCounted = false;
    this.done = false;
  }

  status(lm) {
    const d = this.drill;
    lm.emit({
      t: 'drillStatus',
      text: `${d.name} · ${Math.min(this.attempts, d.n)}/${d.n} · score ${this.score}${this.zone ? ' · ' + this.zone.label : d.id === 'serve' ? ' · Space to serve' : ''}`,
      zone: this.zone,
    });
  }

  /** Called every tick before the game steps. */
  update(g, lm) {
    if (this.done) return;
    if (!this.started) { this.started = true; this.status(lm); }
    if (g.phase === 'serve' && this.drill.id !== 'serve') this.feed(g);
  }

  feed(g) {
    const f = FEEDS[this.drill.id];
    const p = g.players[0];
    p.x = f.stand[0]; p.z = f.stand[1]; p.vx = p.vz = 0; p.swing = null; p.cd = 0;
    g.phase = 'rally';
    g.rally = { serving: false, faults: 0, lastTeam: 1, lastSlot: 2, bounces: 0, hits: 1, netTouched: false, serveXSign: 1 };
    const [sx, sy, sz] = f.from();
    const [lx, lz] = f.land();
    const b = g.ball;
    Object.assign(b, { x: sx, y: sy, z: sz, sb: 0, ss: 0 });
    const v = solveLaunch(b, lx, lz, f.T);
    b.vx = v.vx; b.vy = v.vy; b.vz = v.vz;
    this.lastHit = null; this.evaluated = false;
    g.events.push({ e: 'serve', slot: 2, side: 0, score: scoreView(g.match) });
  }

  inZone(x, z) {
    const zn = this.zone;
    return x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1;
  }

  /** Called with the game's events after every tick. */
  events(evs, g, lm) {
    if (this.done) return;
    const id = this.drill.id;
    for (const e of evs) {
      if (e.e === 'hit' && e.slot === 0) { this.lastHit = e; }
      if (id === 'serve') {
        if (e.e === 'fault') { this.attempts++; this.status(lm); }
        else if (e.e === 'ball' && e.k === 'floor' && !this.serveCounted && this.lastHit?.kind === 'serve' && e.z > 0) {
          this.serveCounted = true; this.attempts++;
          this.score += 1 + (e.z > 5.2 ? 1 : 0); // in the box, +1 more when it lands deep
          this.status(lm);
        }
        if (e.e === 'point') this.serveCounted = false;
      } else if (e.e === 'ball' && e.k === 'floor' && this.lastHit && !this.evaluated && e.z > 0) {
        this.evaluated = true;
        const kindOk = !this.zone.kinds || this.zone.kinds.includes(this.lastHit.kind);
        if (kindOk && this.inZone(e.x, e.z)) this.score++;
        this.status(lm);
      }
      if (e.e === 'point') {
        this.lastHit = null; this.evaluated = false; // each ball is judged on its own
        if (id !== 'serve') { this.attempts++; this.status(lm); }
        g.match = createMatch({ sets: 1, gamesPerSet: 6 }); // the score is irrelevant here: the server never changes
        g.pauseT = Math.min(g.pauseT, 0.9);
      }
    }
    if (this.attempts >= this.drill.n) {
      this.done = true;
      lm.finishDrill({ id, score: this.score, attempts: this.attempts });
    }
  }
}
