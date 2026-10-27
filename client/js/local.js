// Solo matches (practice, 1v1, career) run entirely in the browser: the same PadelGame the server uses,
// with the same bots, but no network in the loop, so there is zero latency.
// It speaks the same messages as the server (start / snap / ev / results) so the rest of the client does not care.

import { PadelGame } from '/shared/game.js';
import { botInput, makeBotMemory } from '/shared/ai.js';
import { SERVER_TICK, SNAPSHOT_EVERY } from '/shared/constants.js';
import { scoreView } from '/shared/scoring.js';

const STEP = 1 / SERVER_TICK;
const MAX_QUEUE = 10;
const RESULTS_DELAY = 4; // seconds of celebration before the results screen

export class LocalMatch {
  /**
   * @param o.settings  match settings
   * @param o.names     four display names (slot 0 is the human)
   * @param o.diffs     bot level per slot
   * @param o.onMessage (msg) => void, receives start/snap/ev/results
   * @param o.onFinish  (results) => career info | null, called once when the match ends
   */
  constructor({ settings, names, diffs, looks, onMessage, onFinish, controller = null, passive = false }) {
    Object.assign(this, { settings, names, diffs, looks, emit: onMessage, onFinish, controller, passive });
    this.paused = false;
    this.timer = null;
  }

  start() {
    this.game = new PadelGame({ settings: this.settings });
    this.mem = [0, 1, 2, 3].map(makeBotMemory);
    this.queue = [];
    this.lastInput = null;
    this.starved = 0;
    this.acc = 0;
    this.lastT = performance.now();
    this.resultAt = 0;
    this.finished = false;
    this.emit({ t: 'start', slot: 0, names: this.names, looks: this.looks, settings: this.settings, score: scoreView(this.game.match), tickRate: SERVER_TICK, local: true, drill: !!this.controller });
    this.timer = setInterval(() => this.pump(), 8);
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  /** A drill ended: tell the app and stop the loop. */
  finishDrill(result) {
    this.emit({ t: 'drillResults', result });
    this.stop();
  }

  setPaused(p) { this.paused = p; this.lastT = performance.now(); }

  pushInputs(inputs) {
    if (!Array.isArray(inputs)) return;
    for (const inp of inputs.slice(0, 8)) if (inp && typeof inp === 'object') this.queue.push(inp);
    while (this.queue.length > MAX_QUEUE) {
      const d = this.queue.shift();
      if (d.swing) this.queue[0].swing = true;
      if (d.jump) this.queue[0].jump = true;
    }
  }

  pump() {
    const now = performance.now();
    const dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (this.paused) return;
    this.acc += Math.min(0.1, dt);
    while (this.acc >= STEP) { this.step(STEP); this.acc -= STEP; }
  }

  step(dt) {
    const g = this.game;
    // human (slot 0): same input handling as the server
    let inp = this.queue.shift();
    if (inp) {
      this.lastInput = inp; this.starved = 0;
      g.players[0].ack = Number.isInteger(inp.seq) ? inp.seq : g.players[0].ack;
    } else if (this.lastInput) {
      const stale = ++this.starved > 15;
      inp = { ...this.lastInput, swing: false, jump: false, ...(stale ? { mx: 0, mz: 0, sprint: false } : {}) };
    }
    if (inp) g.applyInput(0, inp);
    this.controller?.update(g, this);
    for (let s = 1; s < 4; s++) {
      if (!g.players[s].active || this.passive) continue; // drills: the other players stand still
      g.applyInput(s, botInput(g, s, this.mem[s], this.diffs[s] || this.settings.difficulty, dt));
    }
    g.tick(dt);
    const evs = g.drainEvents();
    if (evs.length && this.controller) this.controller.events(evs, g, this);
    if (evs.length) {
      this.emit({ t: 'ev', ev: evs });
      const done = evs.find((e) => e.e === 'match');
      if (done && !this.finished) {
        this.finished = true;
        this.results = done.results;
        this.career = this.onFinish ? this.onFinish(done.results) : null;
        this.resultAt = g.time + RESULTS_DELAY;
      }
    }
    if (g.tickNo % SNAPSHOT_EVERY === 0) this.emit(g.snapshot());
    if (this.resultAt && g.time >= this.resultAt) {
      this.resultAt = 0;
      this.emit({ t: 'results', results: this.results, names: this.names, progress: {}, career: this.career });
      this.stop();
    }
  }
}
