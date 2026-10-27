// Authoritative match simulation: players, ball, shots, padel rules and scoring flow.
// Runs on the server; the client only reuses stepPlayer for prediction.

import {
  COURT, PLAYER, POINT_PAUSE, DEFAULT_SETTINGS, SHOT_IDS, clamp,
} from './constants.js';
import {
  stepPlayer, stepBall, makeBall, serveBallHeight, solveLaunch, simulateShot, serveLimit,
} from './physics.js';
import { COURTS } from './looks.js';
import {
  createMatch, pointWon, currentServer, serveSide, scoreView,
} from './scoring.js';

const NET_CLEAR = COURT.NET_H + 0.14;

const blankInput = () => ({ mx: 0, mz: 0, sprint: false, ax: 0, az: 0, mod: 0, lob: false });

export class PadelGame {
  /**
   * @param opts.settings  match settings (see DEFAULT_SETTINGS)
   * @param opts.rng       () => [0,1) random source (injectable for tests)
   */
  constructor({ settings = {}, rng = Math.random } = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.rng = rng;
    this.match = createMatch({
      sets: this.settings.sets,
      gamesPerSet: this.settings.gamesPerSet,
      goldenPoint: this.settings.goldenPoint,
      singles: this.settings.mode === 'singles',
    });
    this.singles = this.settings.mode === 'singles';
    this.mods = this.settings.attrMods || null; // player development (local matches only): small modifiers for slot 0
    this.xLim = this.singles ? 3.25 : PLAYER.MAX_X; // 1v1 is played on a narrower, fully walled court
    this.players = [0, 1, 2, 3].map((slot) => ({
      slot, team: slot >> 1,
      x: 0, z: 0, vx: 0, vz: 0, stamina: PLAYER.STAMINA_MAX,
      input: blankInput(), wantSwing: null, wantJump: false,
      swing: null, cd: 0, jumpT: 0, kind: 0, ack: 0,
      active: !(this.settings.mode === 'singles' && (slot === 1 || slot === 3)),
      xLim: this.settings.mode === 'singles' ? 3.25 : PLAYER.MAX_X,
    }));
    if (this.mods) { this.players[0].speedMul = this.mods.runMul; this.players[0].regenMul = this.mods.regenMul; this.players[0].drainMul = this.mods.drainMul || 1; }
    this.ball = makeBall();
    this.ball.hw = this.singles ? 3.5 : COURT.HALF_W;
    this.openings = !this.singles && this.settings.openings !== false; // access doors in the side walls (doubles)
    this.ball.doors = this.openings;
    for (const pl of this.players) pl.pit = this.openings;
    const surf = (COURTS[this.settings.court] || COURTS.indoor).surface; // each court has its own turf
    this.ball.fe = surf.floorE;
    this.ball.ff = surf.floorFric;
    this.events = [];
    this.time = 0;
    this.tickNo = 0;
    this.pauseT = 0;
    this.serveWait = 0;
    this.serveIdle = 0;
    this.stats = {
      players: this.players.map(() => ({
        hits: 0, winners: 0, errors: 0, smashes: 0, volleys: 0, aces: 0, doubleFaults: 0, bandejas: 0, viboras: 0,
      })),
      longestRally: 0,
      rallies: 0,
    };
    this.startPoint();
  }

  get phase() { return this._phase; }
  set phase(v) { this._phase = v; }

  // ---------------------------------------------------------------- point setup

  startPoint() {
    const srv = currentServer(this.match);
    const side = serveSide(this.match);
    const os = srv.team === 0 ? 1 : -1; // direction the server attacks
    const sx = side === 0 ? 2.4 : -2.4;
    const serverSlot = srv.team * 2 + srv.idx;
    const recvTeam = 1 - srv.team;
    const recvSlot = recvTeam * 2 + (this.singles ? 0 : side === 0 ? 0 : 1);
    const place = (slot, x, z) => {
      const p = this.players[slot];
      p.x = x; p.z = z; p.vx = 0; p.vz = 0; p.swing = null; p.cd = 0; p.jumpT = 0; p.kind = 0;
      p.input = blankInput(); p.wantSwing = null; p.wantJump = false;
    };
    place(serverSlot, sx, -os * 8.2);
    place(recvSlot, -sx, os * 7.6);
    if (this.singles) {
      for (const s of [1, 3]) place(s, 40, 0); // parked off-court, inactive
    } else {
      place(serverSlot ^ 1, -sx, -os * 2.3);
      place(recvSlot ^ 1, sx, os * 2.3);
    }
    this.serverSlot = serverSlot;
    this.rally = {
      serving: true, faults: 0, lastTeam: srv.team, lastSlot: serverSlot,
      bounces: 0, hits: 0, netTouched: false, serveXSign: Math.sign(sx),
    };
    this.phase = 'serve';
    this.serveWait = 0.9;
    this.serveIdle = 0;
    this.holdBall();
    this.events.push({ e: 'serve', slot: serverSlot, side, score: scoreView(this.match) });
  }

  holdBall() {
    const p = this.players[this.serverSlot];
    const os = p.team === 0 ? 1 : -1;
    const b = this.ball;
    // the ball is bounced by hand until the serve is hit (hit below the waist after a bounce)
    b.x = p.x + os * 0.22; b.y = serveBallHeight(this.time); b.z = p.z + os * 0.4;
    b.vx = b.vy = b.vz = 0; b.sb = 0; b.ss = 0; b.ex = false;
  }

  // ---------------------------------------------------------------- input

  applyInput(slot, inp) {
    const p = this.players[slot];
    if (!p || !inp) return;
    p.input = {
      mx: clamp(+inp.mx || 0, -1, 1), mz: clamp(+inp.mz || 0, -1, 1),
      sprint: !!inp.sprint, steer: !!inp.steer,
      ax: clamp(+inp.ax || 0, -20, 20), az: clamp(+inp.az || 0, -20, 20),
      mod: inp.mod === 1 || inp.mod === 2 || inp.mod === 3 ? inp.mod : 0, lob: !!inp.lob,
    };
    if (inp.swing) p.wantSwing = { ax: p.input.ax, az: p.input.az, mod: p.input.mod, lob: p.input.lob };
    if (inp.jump) p.wantJump = true;
  }

  // ---------------------------------------------------------------- main step

  tick(dt) {
    this.time += dt;
    this.tickNo++;
    const live = this.phase === 'serve' || this.phase === 'rally';

    for (const p of this.players) {
      if (!p.active) continue;
      p.inRally = this.phase === 'rally';
      if (live) {
        const mul = p.swing ? PLAYER.SWING_MOVE : 1; // planted while swinging
        if (this.phase !== 'serve') stepPlayer(p, p.input, dt, undefined, mul);
        else if (p.slot === this.serverSlot) stepPlayer(p, p.input, dt, serveLimit(p.team), mul); // server: behind the line only
        else { p.vx = 0; p.vz = 0; this.rest(p, dt); } // everyone else waits for the serve (and catches their breath)
      } else this.rest(p, dt); // between points everybody recovers
      p.jumpT = Math.max(0, p.jumpT - dt);
      p.cd = Math.max(0, p.cd - dt);
      if (live && p.wantJump && p.jumpT <= 0) p.jumpT = PLAYER.JUMP_TIME;
      p.wantJump = false;
      if (live && p.wantSwing && this.phase === 'serve' && this.serveWait > 0) {
        // a click just before the serve opens is buffered rather than lost
      } else {
        if (live && p.wantSwing && !p.swing && p.cd <= 0) this.startSwing(p, p.wantSwing);
        p.wantSwing = null;
      }
    }
    this.separateTeammates();

    for (const p of this.players) {
      if (!p.swing) continue;
      p.swing.t += dt;
      if (live && this.phase === 'rally' && !p.swing.done && p.swing.t < PLAYER.CONTACT_TO) this.lunge(p, dt);
      if (live && !p.swing.done && p.swing.t >= PLAYER.CONTACT_FROM && p.swing.t <= PLAYER.CONTACT_TO * (p.slot === 0 && this.mods ? this.mods.window : 1)) {
        if (this.phase === 'serve') {
          if (p.slot === this.serverSlot && this.serveWait <= 0) { this.doServe(p); p.swing.done = true; }
        } else {
          // the racket meets the ball at the sweet spot: wait for it unless it is already leaving or the window is closing
          const bb = this.ball;
          const d = Math.hypot(bb.x - p.x, bb.z - p.z);
          const approaching = d < (p.swing.lastD ?? Infinity) - 1e-6;
          p.swing.lastD = d;
          const ready = d <= 1.2 || !approaching || p.swing.t >= PLAYER.CONTACT_TO - 2 * dt;
          if (ready && this.contact(p)) p.swing.done = true;
        }
      }
      if (p.swing.t >= PLAYER.SWING_TIME) { p.swing = null; p.cd = PLAYER.SWING_COOLDOWN - PLAYER.SWING_TIME; }
    }

    if (this.phase === 'serve') {
      this.serveWait = Math.max(0, this.serveWait - dt);
      this.holdBall();
      this.serveIdle += dt;
      if (this.serveIdle > 20 && this.serveWait <= 0) {
        const p = this.players[this.serverSlot];
        if (!p.swing) this.startSwing(p, { ax: 0, az: (p.team === 0 ? 1 : -1) * 5, mod: 0, lob: false });
      }
    } else if (this.phase === 'rally') {
      const ev = [];
      stepBall(this.ball, dt, ev);
      for (const e of ev) {
        if (this.phase !== 'rally') break;
        this.onBallEvent(e);
      }
    } else if (this.phase === 'point' || this.phase === 'ended') {
      const ev = [];
      stepBall(this.ball, dt, ev); // let the ball coast (also after the last point of the match); events no longer matter
      for (const e of ev) if (e.type === 'floor' || e.type === 'wall') this.events.push({ e: 'ball', k: e.type, x: e.x, y: e.y ?? 0, z: e.z, s: e.speed });
      if (this.phase === 'point') {
        this.pauseT -= dt;
        if (this.pauseT <= 0) this.startPoint();
      } else if (this.ball.y <= 0.04 && Math.hypot(this.ball.vx, this.ball.vz) < 0.2) { this.ball.vx = this.ball.vz = 0; }
    }
  }

  /**
   * Where the shot goes is decided at the moment of contact (like a tennis game): with steering aim, the direction
   * held at that instant wins (left/right = that side, forward = deep, back = short). Otherwise the latest aim point.
   */
  aimFor(p) {
    const inp = p.input, os = p.team === 0 ? 1 : -1;
    let ax = inp.ax, az = inp.az;
    if (inp.steer) {
      if (Math.abs(inp.mx) > 0.25) ax = Math.sign(inp.mx) * 3.4;
      const f = inp.mz * os;
      if (f > 0.25) az = os * 8.8; else if (f < -0.25) az = os * 3.0;
    }
    return { ax, az };
  }

  /** A last step toward the ball while swinging, so the racket arrives where the ball is (no hitting from across the court). */
  lunge(p, dt) {
    const b = this.ball, r = this.rally;
    if (r.lastTeam === p.team || r.serving) return;
    if (p.team === 0 ? b.z > 0.25 : b.z < -0.25) return;
    const dx = b.x - p.x, dz = b.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d <= 1.1 || d > 2.7 || b.y > 3.2) return;
    const step = Math.min(d - 1.1, 5.5 * dt);
    const nx = p.x + (dx / d) * step;
    p.x = p.pit && Math.abs(p.x) > COURT.HALF_W // out in the strip beside the court
      ? Math.sign(nx) * clamp(Math.abs(nx), COURT.HALF_W + 0.4, COURT.HALF_W + COURT.PIT.w - 0.4)
      : clamp(nx, -p.xLim, p.xLim);
    const nz = p.z + (dz / d) * step;
    p.z = p.team === 0 ? clamp(nz, -COURT.HALF_L + PLAYER.BACK_GAP, -PLAYER.NET_GAP) : clamp(nz, PLAYER.NET_GAP, COURT.HALF_L - PLAYER.BACK_GAP);
  }

  rest(p, dt) {
    p.stamina = Math.min(PLAYER.STAMINA_MAX, p.stamina + PLAYER.STAMINA_REGEN * (p.regenMul || 1) * dt);
  }

  separateTeammates() {
    if (this.singles) return;
    for (let t = 0; t < 2; t++) {
      const a = this.players[t * 2];
      const b = this.players[t * 2 + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = 0.9;
      if (d < min) {
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
        const push = (min - d) / 2;
        a.x -= nx * push; a.z -= nz * push;
        b.x += nx * push; b.z += nz * push;
      }
    }
  }

  // ---------------------------------------------------------------- shots

  classify(p, sw) {
    const b = this.ball;
    if (sw.lob) return 'lob';
    if (b.y > 2.1) return sw.mod === 2 ? 'bandeja' : sw.mod === 1 ? 'vibora' : 'smash';
    const nearNet = Math.abs(p.z) < 3.8;
    if (sw.mod === 3) return 'slice';
    if (sw.mod === 1) return nearNet ? 'chiquita' : 'drop';
    if (sw.mod === 2) return 'block';
    if (nearNet && this.rally.bounces === 0 && b.y > 0.35) return 'volley';
    const right = p.team === 0 ? b.x < p.x : b.x > p.x; // right-handed
    return right ? 'forehand' : 'backhand';
  }

  startSwing(p, sw) {
    if (this.phase === 'serve' && p.slot !== this.serverSlot) return;
    p.swing = { t: 0, done: false, ax: sw.ax, az: sw.az, mod: sw.mod, lob: sw.lob };
    p.kind = SHOT_IDS.indexOf(this.phase === 'serve' ? 'serve' : this.classify(p, sw));
  }

  /**
   * Choose where the ball should land, how fast and with which spin, then solve the launch velocity
   * through the real ball physics (so drag and Magnus lift are compensated and the aim stays honest).
   */
  /**
   * ctx (optional) is the racket contact: {face, e, lateral, forward}
   *   face    -1 closed .. +1 open (from swing timing and ball height): an open face launches higher and adds backspin,
   *           a closed face is flatter with topspin and gets no net-clearance help when strongly closed
   *   e       distance of the strike from the sweet spot in metres (0 = centre of the face): edge hits lose pace and scatter
   *   lateral sideways running speed (m/s): costs accuracy;  forward: speed toward the net (m/s): adds a little pace
   */
  planShot(kind, b, os, aimX, aimZ, q, inSpeed = 0, spinOv = null, ctx = null) {
    if (ctx?.outside) return this.planOutside(b, os, q);
    const lim = this.singles ? 3.2 : 4.5;
    let tx = clamp(aimX, -lim, lim);
    let depth = clamp(Math.abs(aimZ), 1, 9.4);
    let speed = 19;
    let sb = 0, ss = 0; // backspin(+)/topspin(-), sidespin
    switch (kind) {
      case 'serve': speed = 9.5 + 5 * q; depth = clamp(Math.abs(aimZ), 2.5, 6.3); sb = 4; break;
      case 'forehand': sb = -9; depth = clamp(depth, 3, 9.2); break; // topspin drive
      case 'backhand': sb = -6; depth = clamp(depth, 3, 9.2); break;
      case 'slice': speed = 13.5; sb = 17; depth = clamp(depth, 3, 9.2); break; // skidding backspin
      case 'volley': speed = 16.5; depth = clamp(depth, 3, 9); sb = 5; break;
      case 'smash': speed = 30; depth = clamp(depth, 2.5, 8.5); sb = -4; break;
      case 'bandeja': speed = 13.5; depth = clamp(Math.max(depth, 6.5), 6.5, 9); sb = 15; break; // slow, backspin, stays low off the glass
      case 'vibora': // fast, sidespin: kicks sideways off the glass
        speed = 19; depth = clamp(depth, 5, 9); tx = clamp(tx * 1.2, -lim - 0.1, lim + 0.1); sb = 7;
        ss = (Math.sign((tx - b.x) * os) || 1) * 17;
        break;
      case 'lob': depth = clamp(Math.max(depth, 7.2), 7, 9.3); sb = -6; break; // globo
      case 'chiquita': speed = 8; depth = clamp(depth, 2.2, 4); sb = 9; break;
      case 'drop': speed = 6.5; depth = clamp(depth, 1.1, 2.4); sb = 21; break;
      case 'block': speed = 9.5; depth = clamp(depth, 4, 8); sb = 3; break;
      default: depth = clamp(depth, 3, 9.2);
    }
    if (spinOv) { sb = spinOv.sb; ss = spinOv.ss || 0; }
    if (ctx) {
      sb += ctx.face * 5; // spin transfer from the face angle
      sb *= ctx.spinMul || 1; ss *= ctx.spinMul || 1;
      speed *= 1 - 0.22 * clamp(ctx.e / 0.85, 0, 1); // energy lost off-centre
      speed *= 1 + clamp(ctx.forward, -3, 3) * 0.012; // moving into the shot adds pace
      speed *= ctx.powerMul || 1; // upgrades add pace, fatigue takes it away
    }
    const spinQ = 0.4 + 0.6 * q; // mishit balls carry less spin
    sb *= spinQ; ss *= spinQ;
    let tz = os * depth;
    let err = (1 - q) * (kind === 'serve' ? 1.4 : 1.7);
    if (ctx) err *= 1 + 0.8 * clamp((ctx.e - 0.4) / 0.45, 0, 1) + 0.05 * ctx.lateral; // edge hits and sideways running are less reliable
    tx += (this.rng() - 0.5) * 2 * err;
    tz += (this.rng() - 0.5) * 2 * err * 0.8;
    const dist = Math.hypot(tx - b.x, tz - b.z);
    let T = kind === 'lob'
      ? clamp(1.5 + dist * 0.05, 1.7, 2.4)
      : dist / (speed * (0.8 + 0.4 * q + Math.min(0.2, inSpeed * 0.007))); // returns carry some of the incoming pace
    if (ctx && kind !== 'lob' && kind !== 'serve') T *= 1 + 0.16 * ctx.face; // open face = higher, slower arc
    T = Math.max(T, 0.28);
    const spin = { sb, ss };
    let aimX2 = tx, aimZ2 = tz;
    let v = solveLaunch(b, aimX2, aimZ2, T);
    // well-struck balls clear the net (poor contact does not get that help); then correct the launch so spin and drag
    // still land the ball on the aimed spot. Both are checked together: fixing one must not undo the other.
    const needClear = kind !== 'lob' && (!ctx || ctx.face > -0.6);
    let corrections = 0;
    for (let it = 0; it < 24; it++) {
      v = solveLaunch(b, aimX2, aimZ2, T);
      const sim = simulateShot(b, v, spin);
      if (needClear && (sim.kind === 'net' || (sim.netH !== null && sim.netH < NET_CLEAR))) { T *= 1.06; continue; }
      if (sim.kind === 'floor' && corrections < 4) {
        const ex = tx - sim.x, ez = tz - sim.z;
        if (Math.hypot(ex, ez) < 0.08) break;
        aimX2 += ex; aimZ2 += ez; corrections++;
        continue;
      }
      break;
    }
    return { ...v, sb, ss };
  }

  /**
   * A ball played from the strip outside the court: it cannot go through the glass, so it travels along the strip, round the
   * net post and in through the opponents' door. Look for a flight that really does that (simulated with the real physics).
   */
  planOutside(b, os, q) {
    const s = Math.sign(b.x) || 1;
    const D = COURT.DOOR;
    const doorZ = os * (D.z0 + D.z1) / 2;
    const spin = { sb: 3, ss: 0 };
    const err = (1 - q) * 0.5;
    let best = null;
    for (const jit of [0, 0.3, -0.3]) {
      for (const T of [1.0, 1.15, 0.9, 1.3, 0.8, 1.5]) {
        for (const L of [3.5, 4.5, 2.8]) {
          const dx = COURT.HALF_W * s - b.x, dz = doorZ + jit - b.z;
          const dl = Math.hypot(dx, dz) || 1;
          const tx = COURT.HALF_W * s + (dx / dl) * L + (this.rng() - 0.5) * 2 * err;
          const tz = doorZ + jit + (dz / dl) * L + (this.rng() - 0.5) * 2 * err;
          if (Math.abs(tx) > 4.6 || os * tz < 1.2 || os * tz > 9.2) continue;
          const v = solveLaunch(b, tx, tz, T);
          const sim = simulateShot(b, v, spin);
          if (sim.kind === 'floor' && os * sim.z > 0.3 && Math.abs(sim.x) < 4.9) return { ...v, sb: spin.sb, ss: 0 };
          best = best || v;
        }
      }
    }
    const v = best || solveLaunch(b, 0, os * 6, 1.2);
    return { ...v, sb: spin.sb, ss: 0 };
  }

  doServe(p) {
    const os = p.team === 0 ? 1 : -1;
    const sw = p.swing;
    const b = this.ball;
    const boxSign = -this.rally.serveXSign;
    const aim = this.aimFor(p);
    const ax = aim.ax * boxSign > 0 ? aim.ax : boxSign * 2.5;
    const edge = this.singles ? 3.3 : 4.6;
    const lo = boxSign > 0 ? 0.3 : -edge;
    const hi = boxSign > 0 ? edge : -0.3;
    // contact height on the bounce decides quality: best around 0.6 m (waist height)
    const tiredK = clamp((PLAYER.TIRED_FROM - p.stamina) / PLAYER.TIRED_FROM, 0, 1);
    const q = clamp(1.02 - Math.abs(b.y - 0.62) / 0.3 - 0.2 * tiredK, 0.3, 0.98); // best at waist height; the window is narrow, and a tired server is less accurate
    const spinOv = sw.mod === 3 ? { sb: 15 } : sw.mod === 1 ? { sb: -9 } : null; // R = slice serve, Q = kick serve
    const v = this.planShot('serve', b, os, clamp(ax, lo, hi), os * clamp(Math.abs(aim.az), 2.5, 6.3), q, 0, spinOv);
    b.vx = v.vx; b.vy = v.vy; b.vz = v.vz; b.sb = v.sb; b.ss = v.ss;
    this.phase = 'rally';
    const r = this.rally;
    r.lastTeam = p.team; r.lastSlot = p.slot; r.bounces = 0; r.hits = 1; r.netTouched = false; r.serving = true;
    this.stats.players[p.slot].hits++;
    this.events.push({ e: 'hit', slot: p.slot, kind: 'serve', q: +q.toFixed(2), label: q >= 0.85 ? 'perfect' : q >= 0.6 ? 'good' : 'poor', x: b.x, y: b.y, z: b.z, sb: v.sb, ss: v.ss });
  }

  contact(p) {
    const b = this.ball;
    const r = this.rally;
    if (r.lastTeam === p.team || r.serving) return false; // a serve must bounce in the box first
    const own = p.team === 0 ? b.z <= 0.25 : b.z >= -0.25;
    if (!own) return false;
    const maxH = p.jumpT > 0 ? 3.5 : 2.75;
    if (b.y < 0.08 || b.y > maxH) return false;
    const dx = b.x - p.x, dz = b.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > PLAYER.REACH) return false;

    const sw = p.swing;
    const outside = Math.abs(b.x) > COURT.HALF_W || Math.abs(p.x) > COURT.HALF_W; // playing the ball from outside the court
    const kind = outside ? 'forehand' : this.classify(p, sw);
    const os = p.team === 0 ? 1 : -1;

    // contact quality: sweet spot ~0.85 m from the body, comfortable height, not rushed, ball in front
    const qd = 1 - Math.abs(d - 0.95) / 1.7;
    const overhead = b.y > 2.1;
    const qh = overhead ? 1 - Math.min(0.5, Math.abs(b.y - 2.5) * 0.4) : 1 - Math.min(0.5, Math.max(0, Math.abs(b.y - 1.0) - 0.4) * 0.35);
    const fwdDist = dz * os; // >0 ball in front of the body
    let q = qd * 0.7 + qh * 0.3;
    if (fwdDist < -0.25) q -= 0.25;
    if (Math.hypot(p.vx, p.vz) > 6.2) q -= 0.08; // off balance at full sprint
    if ((p.vx * -dx + p.vz * -dz) / (d || 1) < -2.5) q -= 0.1; // running away from the ball
    q = clamp(q * 0.8 + 0.2, 0.3, 1); // forgiving: contact is never worse than "late"
    const tiredK = clamp((PLAYER.TIRED_FROM - p.stamina) / PLAYER.TIRED_FROM, 0, 1);
    q = clamp(q - 0.25 * tiredK, 0.3, 1); // exhausted players mistime and mishit
    if (p.slot === 0 && this.mods) { // development bonus for the matching skill, kept small
      const grp = { forehand: 'ground', backhand: 'ground', volley: 'volley', smash: 'smash', bandeja: 'smash', vibora: 'smash', lob: 'lob', slice: 'defense', block: 'defense', chiquita: 'defense', drop: 'defense' }[kind];
      q = clamp(q + (this.mods.q[grp] || 0), 0.3, 1);
    }

    // racket contact: timing sets the face angle, the distance from the sweet spot stands for the point on the face
    // timing > 0: the ball met the racket late in the swing (swing started early), < 0: early in the swing (started late).
    // Met before the swing peaked = behind the ball, face open (higher, slower, backspin); met after = out in front, face closed.
    const timing = clamp((sw.t - 0.17) / 0.12, -1, 1);
    const face = clamp(-timing * 0.8 + (b.y < 0.5 ? 0.4 : b.y > 1.6 && b.y <= 2.1 ? -0.2 : 0), -1, 1);
    const e = Math.abs(d - 0.95);
    const ctx = { face, e, lateral: Math.abs(p.vx), forward: p.vz * os, spinMul: p.slot === 0 && this.mods ? this.mods.spin : 1, powerMul: (p.slot === 0 && this.mods ? this.mods.power || 1 : 1) * (1 - 0.16 * tiredK) };

    let label;
    if (q < 0.4) label = 'poor';
    else if (e > 0.55) label = 'off-centre';
    else if (q >= 0.82) label = 'perfect';
    else if (q >= 0.62) label = 'clean';
    else label = timing < 0 ? 'late' : 'early';

    const inSpeed = Math.hypot(b.vx, b.vy, b.vz);
    const aim = this.aimFor(p);
    if (outside) ctx.outside = true;
    const v = this.planShot(kind, b, os, aim.ax, aim.az, q, inSpeed, null, ctx);
    b.vx = v.vx; b.vy = v.vy; b.vz = v.vz; b.sb = v.sb; b.ss = v.ss;

    r.lastTeam = p.team; r.lastSlot = p.slot; r.bounces = 0; r.hits++; r.netTouched = false; r.serving = false; r.exited = false;
    const st = this.stats.players[p.slot];
    st.hits++;
    if (kind === 'smash') st.smashes++;
    if (kind === 'volley') st.volleys++;
    if (kind === 'bandeja') st.bandejas++;
    if (kind === 'vibora') st.viboras++;
    this.stats.longestRally = Math.max(this.stats.longestRally, r.hits);
    this.events.push({ e: 'hit', slot: p.slot, kind, q: +q.toFixed(2), label, face: +face.toFixed(2), off: +e.toFixed(2), x: b.x, y: b.y, z: b.z, sb: v.sb, ss: v.ss });
    return true;
  }

  // ---------------------------------------------------------------- rules

  inServiceBox(x, z) {
    const r = this.rally;
    const recvTeam = 1 - r.lastTeam;
    const sideOk = recvTeam === 0 ? z < 0 : z > 0;
    const boxSign = -r.serveXSign;
    return sideOk && Math.abs(z) <= COURT.SERVICE_LINE && x * boxSign >= -0.02 && Math.abs(x) <= (this.singles ? 3.5 : 5);
  }

  onBallEvent(e) {
    const r = this.rally;
    const hitterSide = r.lastTeam; // team 0 defends z<0 = side 0
    if (e.type === 'net') {
      this.events.push({ e: 'ball', k: 'net', x: e.x, y: e.y, z: 0, s: e.speed });
      r.netTouched = true;
      if (r.serving) this.fault('net');
      return;
    }
    if (e.type === 'cord') { this.events.push({ e: 'ball', k: 'net', x: e.x, y: e.y, z: 0, s: e.speed * 0.5 }); return; }
    if (e.type === 'wall') {
      this.events.push({ e: 'ball', k: 'wall', axis: e.axis, x: e.x, y: e.y, z: e.z, s: e.speed });
      if (r.bounces === 0) {
        if (r.serving) this.fault('out');
        else this.endPoint(1 - r.lastTeam, 'out');
      }
      return;
    }
    if (e.type === 'door') {
      this.events.push({ e: 'ball', k: 'door', x: e.x, y: e.y, z: e.z, s: 0 });
      if (r.bounces === 0) { // left through the door without bouncing first: out
        if (r.serving) this.fault('out');
        else this.endPoint(1 - r.lastTeam, 'out');
      } else { r.exited = true; r.exitBounce = false; }
      return;
    }
    if (e.type === 'out') {
      if (r.bounces === 0) {
        if (r.serving) this.fault('out');
        else this.endPoint(1 - r.lastTeam, 'out');
      } else {
        this.endPoint(r.lastTeam, 'out-after-bounce');
      }
      return;
    }
    if (e.type === 'floor') {
      this.events.push({ e: 'ball', k: 'floor', x: e.x, y: 0, z: e.z, s: e.speed });
      const side = e.z < 0 ? 0 : 1;
      if (r.exited && r.bounces >= 1 && Math.abs(e.x) > COURT.HALF_W && !r.exitBounce) { // outside the court one bounce is allowed before the return
        r.exitBounce = true;
        return;
      }
      if (!r.serving && r.bounces === 0 && Math.abs(e.x) > COURT.HALF_W) { // a return from outside must land inside the court
        this.endPoint(1 - r.lastTeam, 'out');
        return;
      }
      if (r.serving) {
        if (!this.inServiceBox(e.x, e.z)) { this.fault(side === 1 - r.lastTeam ? 'long-or-wide' : 'short'); return; }
        r.serving = false;
        r.bounces = 1;
        return;
      }
      r.bounces++;
      if (r.bounces === 1) {
        if (side === hitterSide) this.endPoint(1 - r.lastTeam, r.netTouched ? 'net' : 'own-side');
      } else {
        this.endPoint(r.lastTeam, 'bounce');
      }
    }
  }

  fault(reason) {
    const r = this.rally;
    r.faults++;
    const srvPlayerSlot = this.serverSlot;
    if (r.faults >= 2) {
      this.stats.players[srvPlayerSlot].doubleFaults++;
      this.endPoint(1 - this.players[srvPlayerSlot].team, 'double-fault');
      return;
    }
    this.events.push({ e: 'fault', reason, n: r.faults, slot: srvPlayerSlot });
    r.serving = true; r.bounces = 0; r.hits = 0; r.netTouched = false; r.lastTeam = this.players[srvPlayerSlot].team;
    this.phase = 'serve';
    this.serveWait = 1.2;
    this.serveIdle = 0;
    for (const p of this.players) { p.swing = null; p.cd = 0; }
    this.holdBall();
  }

  endPoint(winner, reason) {
    if (this.phase !== 'rally' && this.phase !== 'serve') return;
    const r = this.rally;
    const st = this.stats.players;
    const lastSlot = r.lastSlot;
    const hitterWon = winner === r.lastTeam;
    if (reason === 'bounce' || reason === 'out-after-bounce') {
      if (r.hits === 1) { st[lastSlot].aces++; }
      else st[lastSlot].winners++;
    } else if (reason === 'out' || reason === 'net' || reason === 'own-side') {
      if (!hitterWon) st[lastSlot].errors++;
    }
    this.stats.longestRally = Math.max(this.stats.longestRally, r.hits);
    this.stats.rallies++;
    this.phase = 'point';
    this.pauseT = POINT_PAUSE;
    for (const p of this.players) { p.swing = null; }
    const sc = pointWon(this.match, winner);
    const marks = sc.filter((s) => s.type !== 'point');
    const ev = {
      e: 'point', winner, reason, rally: r.hits, by: lastSlot,
      marks, score: scoreView(this.match),
      st: this.stats.players.map((s) => ({ ...s })), lr: this.stats.longestRally,
    };
    this.events.push(ev);
    if (this.match.winner !== null) {
      this.phase = 'ended';
      this.events.push({ e: 'match', winner: this.match.winner, results: this.results() });
    }
  }

  // ---------------------------------------------------------------- views

  results() {
    return {
      winner: this.match.winner,
      score: scoreView(this.match),
      duration: Math.round(this.time),
      longestRally: this.stats.longestRally,
      rallies: this.stats.rallies,
      players: this.stats.players.map((s) => ({ ...s })),
      teamPoints: [...this.match.totalPoints],
    };
  }

  snapshot() {
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const b = this.ball;
    return {
      t: 'snap',
      n: this.tickNo,
      ph: this.phase,
      b: [r3(b.x), r3(b.y), r3(b.z), r3(b.vx), r3(b.vy), r3(b.vz), Math.round(b.sb * 10) / 10, Math.round(b.ss * 10) / 10],
      p: this.players.map((p) => [
        r3(p.x), r3(p.z), r3(p.vx), r3(p.vz), Math.round(p.stamina), p.kind,
        p.swing ? r3(p.swing.t) : -1, r3(p.jumpT), p.ack,
      ]),
      lt: this.rally.lastTeam,
    };
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
