// Authoritative match simulation: players, ball, shots, padel rules and scoring flow.
// Runs on the server; the client only reuses stepPlayer for prediction.

import {
  COURT, PLAYER, POINT_PAUSE, DEFAULT_SETTINGS, SHOT_IDS, clamp,
} from './constants.js';
import {
  stepPlayer, stepBall, makeBall, solveLaunch, simulateShot, serveLimit,
} from './physics.js';
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
    this.xLim = this.singles ? 3.25 : PLAYER.MAX_X; // 1v1 is played on a narrower, fully walled court
    this.players = [0, 1, 2, 3].map((slot) => ({
      slot, team: slot >> 1,
      x: 0, z: 0, vx: 0, vz: 0, stamina: PLAYER.STAMINA_MAX,
      input: blankInput(), wantSwing: null, wantJump: false,
      swing: null, cd: 0, jumpT: 0, kind: 0, ack: 0,
      active: !(this.settings.mode === 'singles' && (slot === 1 || slot === 3)),
      xLim: this.settings.mode === 'singles' ? 3.25 : PLAYER.MAX_X,
    }));
    this.ball = makeBall();
    this.ball.hw = this.singles ? 3.5 : COURT.HALF_W;
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
    const ph = (this.time % 0.8) / 0.8;
    b.x = p.x + os * 0.22; b.y = 0.1 + 0.86 * Math.abs(Math.cos(Math.PI * ph)); b.z = p.z + os * 0.4;
    b.vx = b.vy = b.vz = 0; b.sb = 0; b.ss = 0;
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
      if (live) {
        const mul = p.swing ? PLAYER.SWING_MOVE : 1; // planted while swinging
        if (this.phase !== 'serve') stepPlayer(p, p.input, dt, undefined, mul);
        else if (p.slot === this.serverSlot) stepPlayer(p, p.input, dt, serveLimit(p.team), mul); // server: behind the line only
        else { p.vx = 0; p.vz = 0; } // everyone else waits for the serve
      }
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
      if (live && !p.swing.done && p.swing.t >= PLAYER.CONTACT_FROM && p.swing.t <= PLAYER.CONTACT_TO) {
        if (this.phase === 'serve') {
          if (p.slot === this.serverSlot && this.serveWait <= 0) { this.doServe(p); p.swing.done = true; }
        } else if (this.contact(p)) {
          p.swing.done = true;
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
    } else if (this.phase === 'point') {
      const ev = [];
      stepBall(this.ball, dt, ev); // let the ball coast; events no longer matter
      for (const e of ev) if (e.type === 'floor' || e.type === 'wall') this.events.push({ e: 'ball', k: e.type, x: e.x, y: e.y ?? 0, z: e.z, s: e.speed });
      this.pauseT -= dt;
      if (this.pauseT <= 0) this.startPoint();
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
    p.x = clamp(p.x + (dx / d) * step, -p.xLim, p.xLim);
    const nz = p.z + (dz / d) * step;
    p.z = p.team === 0 ? clamp(nz, -COURT.HALF_L + PLAYER.BACK_GAP, -PLAYER.NET_GAP) : clamp(nz, PLAYER.NET_GAP, COURT.HALF_L - PLAYER.BACK_GAP);
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
  planShot(kind, b, os, aimX, aimZ, q, inSpeed = 0, spinOv = null) {
    const lim = this.singles ? 3.2 : 4.5;
    let tx = clamp(aimX, -lim, lim);
    let depth = clamp(Math.abs(aimZ), 1, 9.4);
    let speed = 19;
    let sb = 0, ss = 0; // backspin(+)/topspin(-), sidespin
    switch (kind) {
      case 'serve': speed = 11.5; depth = clamp(Math.abs(aimZ), 2.5, 6.3); sb = 4; break;
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
    const spinQ = 0.4 + 0.6 * q; // mishit balls carry less spin
    sb *= spinQ; ss *= spinQ;
    let tz = os * depth;
    const err = (1 - q) * (kind === 'serve' ? 0.8 : 1.7);
    tx += (this.rng() - 0.5) * 2 * err;
    tz += (this.rng() - 0.5) * 2 * err * 0.8;
    const dist = Math.hypot(tx - b.x, tz - b.z);
    let T = kind === 'lob'
      ? clamp(1.5 + dist * 0.05, 1.7, 2.4)
      : dist / (speed * (0.8 + 0.4 * q + Math.min(0.2, inSpeed * 0.007))); // returns carry some of the incoming pace
    T = Math.max(T, 0.28);
    const spin = { sb, ss };
    let aimX2 = tx, aimZ2 = tz;
    let v = solveLaunch(b, aimX2, aimZ2, T);
    // well-struck balls clear the net; poor contact does not get that help
    if (kind !== 'lob') {
      for (let i = 0; i < 18; i++) {
        const sim = simulateShot(b, v, spin);
        if (sim.netH === null || sim.netH >= NET_CLEAR) break;
        T *= 1.07;
        v = solveLaunch(b, aimX2, aimZ2, T);
      }
    }
    // correct the launch so spin and drag still land the ball on the aimed spot
    for (let i = 0; i < 3; i++) {
      const sim = simulateShot(b, v, spin);
      if (sim.kind !== 'floor') break;
      const ex = tx - sim.x, ez = tz - sim.z;
      if (Math.hypot(ex, ez) < 0.08) break;
      aimX2 += ex; aimZ2 += ez;
      v = solveLaunch(b, aimX2, aimZ2, T);
    }
    return { ...v, sb, ss };
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
    const q = clamp(0.62 + 0.36 * (1 - Math.abs(b.y - 0.62) / 0.5), 0.5, 0.98);
    const spinOv = sw.mod === 3 ? { sb: 15 } : sw.mod === 1 ? { sb: -9 } : null; // R = slice serve, Q = kick serve
    const v = this.planShot('serve', b, os, clamp(ax, lo, hi), os * clamp(Math.abs(aim.az), 2.5, 6.3), q, 0, spinOv);
    b.vx = v.vx; b.vy = v.vy; b.vz = v.vz; b.sb = v.sb; b.ss = v.ss;
    this.phase = 'rally';
    const r = this.rally;
    r.lastTeam = p.team; r.lastSlot = p.slot; r.bounces = 0; r.hits = 1; r.netTouched = false; r.serving = true;
    this.stats.players[p.slot].hits++;
    this.events.push({ e: 'hit', slot: p.slot, kind: 'serve', q: +q.toFixed(2), label: q >= 0.85 ? 'perfect' : q >= 0.68 ? 'good' : 'poor', x: b.x, y: b.y, z: b.z, sb: v.sb, ss: v.ss });
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
    const kind = this.classify(p, sw);
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

    let label = 'poor';
    if (q >= 0.82) label = 'perfect';
    else if (q >= 0.6) label = 'good';
    else if (q >= 0.3) label = fwdDist > 0.9 ? 'early' : 'late';

    const inSpeed = Math.hypot(b.vx, b.vy, b.vz);
    const aim = this.aimFor(p);
    const v = this.planShot(kind, b, os, aim.ax, aim.az, q, inSpeed);
    b.vx = v.vx; b.vy = v.vy; b.vz = v.vz; b.sb = v.sb; b.ss = v.ss;

    r.lastTeam = p.team; r.lastSlot = p.slot; r.bounces = 0; r.hits++; r.netTouched = false; r.serving = false;
    const st = this.stats.players[p.slot];
    st.hits++;
    if (kind === 'smash') st.smashes++;
    if (kind === 'volley') st.volleys++;
    if (kind === 'bandeja') st.bandejas++;
    if (kind === 'vibora') st.viboras++;
    this.stats.longestRally = Math.max(this.stats.longestRally, r.hits);
    this.events.push({ e: 'hit', slot: p.slot, kind, q: +q.toFixed(2), label, x: b.x, y: b.y, z: b.z, sb: v.sb, ss: v.ss });
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
    if (e.type === 'wall') {
      this.events.push({ e: 'ball', k: 'wall', axis: e.axis, x: e.x, y: e.y, z: e.z, s: e.speed });
      if (r.bounces === 0) {
        if (r.serving) this.fault('out');
        else this.endPoint(1 - r.lastTeam, 'out');
      }
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
