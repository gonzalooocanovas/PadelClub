// Client side of a running match: input → server, prediction for the local player,
// interpolation for everything else, camera, and turning server events into feedback.
// The client never decides a hit, bounce or point: it only displays what the server says.

import * as THREE from 'three';
import { stepPlayer, serveLimit } from '/shared/physics.js';
import { COURT, PLAYER, SHOT_IDS, clamp } from '/shared/constants.js';
import { settings } from './settings.js';
import { scoreCallout } from './audio.js';

const TICK = 1 / 60;
const INTERP = 0.1; // seconds of render delay used to interpolate remote entities

const REASONS = {
  bounce: 'Winner', 'out-after-bounce': 'Out of play', out: 'Out', net: 'Net',
  'own-side': 'Short', 'double-fault': 'Double fault',
};

// Camera presets. dist/height: behind and above the player · follow: how much it tracks sideways · lookAhead: metres in front
// of the player it looks at (center: look at the middle of the court instead) · ball: pull toward the ball · smooth: follow speed
export const CAMERAS = {
  player: { dist: 7.2, height: 4.6, follow: 0.85, lookAhead: 9, ball: 0.25, smooth: 7, fov: 52 },
  broadcast: { dist: 12.5, height: 9, follow: 0.18, center: true, ball: 0.12, smooth: 4, fov: 42 },
  tactical: { dist: 5, height: 14, follow: 0.5, lookAhead: 4, ball: 0.1, smooth: 5, fov: 54 },
};
export function cameraConfig(s) {
  if (s.camera === 'custom') return { dist: s.camDist, height: s.camHeight, follow: 0.85, lookAhead: 9, ball: 0.25, smooth: s.camSmooth, fov: s.camFov };
  return CAMERAS[s.camera] || CAMERAS.player;
}

const QUICK = ['Nice shot!', 'Mine!', 'Yours!', 'Switch!'];

export class MatchClient {
  constructor({ net, world, hud, sound, start, onPause, input }) {
    this.input = input;
    this.net = net; this.world = world; this.hud = hud; this.sound = sound; this.onPause = onPause;
    this.interp = start.local ? 0.03 : 0.07; // render delay: tiny for local matches, a few snapshots online
    this.slot = start.slot;
    this.team = start.slot >> 1;
    this.names = start.names;
    this.settings = start.settings;
    this.os = this.team === 0 ? 1 : -1; // direction of the opponents
    this.snaps = [];
    this.phase = 'serve';
    this.lastTeam = 0;
    this.serverSlot = -1;
    this.me = { x: 0, z: 0, vx: 0, vz: 0, stamina: 100, team: this.team, xLim: start.settings.mode === 'singles' ? 3.25 : PLAYER.MAX_X, pit: start.settings.mode !== 'singles' && start.settings.openings !== false };
    this.pending = [];
    this.seq = 0;
    this.acc = 0;
    this.want = { swing: false, lob: false, jump: false, mod: 0 };
    this.swingLocal = null;
    this.aim = new THREE.Vector3(0, 0, this.os * 6);
    this.kbAim = { x: 0, z: this.os * 6.6 };
    this.aimMode = 'auto';
    this.camPos = null;
    this.camLook = new THREE.Vector3();
    this.ray = new THREE.Raycaster();
    this.paused = false;
    this.tabHidden = false;
    this.ballView = { x: 0, y: 1, z: 0 };
    this.stopped = false;
    this.fb = 0;
    this.bind();
    this.hud.setScore(start.score, this.names);
    this.world.setBallScale(settings.ballScale);
    this.sound.startAmbience(this.world.courtId);
    this.sound.setCourt(this.world.courtId);
    this.world.onStep = (i, sp, x) => this.sound.play('step', { i, speed: sp, pan: x / 5, power: i === this.slot ? 1 : 0.45 });
    this.world.onSkid = (i, x) => this.sound.play('skid', { i, pan: x / 5, power: i === this.slot ? 1 : 0.5 });
  }

  // ------------------------------------------------------------------ input

  bind() {
    const i = this.input;
    const hit = (lob, mod) => () => {
      if (this.paused) return;
      this.sound.unlock();
      this.want.swing = true; this.want.lob = lob;
      if (mod) this.want.mod = mod;
    };
    this.unsubs = [
      i.on('hit', hit(false, 0)), i.on('lob', hit(true, 0)),
      i.on('slice', hit(false, 3)), i.on('soft', hit(false, 1)), i.on('control', hit(false, 2)),
      i.on('jump', () => { if (!this.paused) this.want.jump = true; }),
      i.on('pause', () => this.onPause?.()),
      i.on('stats', () => this.hud.showStats(true)),
      i.on('statsUp', () => this.hud.showStats(false)),
      i.on('chat', (n) => this.net.send({ t: 'chat', text: QUICK[n] })),
    ];
    this.onVis = () => {
      if (document.hidden) {
        i.clear();
        this.net.send({ t: 'in', inputs: [{ seq: ++this.seq, mx: 0, mz: 0 }] });
        this.pending = [];
      }
    };
    document.addEventListener('visibilitychange', this.onVis);
  }

  stop() {
    this.stopped = true;
    this.unsubs?.forEach((u) => u());
    document.removeEventListener('visibilitychange', this.onVis);
    this.sound.stopAmbience();
    this.world.onStep = null; this.world.onSkid = null;
  }

  setPaused(p) { this.paused = p; if (p) this.input.clear(); }

  /** Movement relative to the camera, which always looks toward the opponents. */
  moveAxes() {
    const a = this.input.axes(); // x = right, y = forward
    // camera faces (0,0,os); screen-right is (-os, 0, 0)
    return { mx: -this.os * a.x, mz: this.os * a.y };
  }

  /**
   * Where the shot is aimed. Three sources, chosen by the control settings:
   *  mouse  : the target follows the cursor (ray from the camera onto the court)
   *  stick  : the right stick places the shot
   *  steer  : the direction you hold as you hit (keyboard, or the left stick): left/right = that side, forward = deep, back = short
   */
  updateAim(dt) {
    const os = this.os;
    const inp = this.input;
    const st = inp.aimStick();
    this.aimSource = inp.settings.mouseAim ? 'mouse' : st.active ? 'stick' : 'steer';
    if (this.aimSource === 'mouse') {
      const w = innerWidth, h = innerHeight;
      const ndc = new THREE.Vector2((inp.mouse.x / w) * 2 - 1, -(inp.mouse.y / h) * 2 + 1);
      if (!inp.mouse.moved) ndc.set(0, 0.1);
      this.ray.setFromCamera(ndc, this.world.camera);
      const o = this.ray.ray.origin, d = this.ray.ray.direction;
      let x = 0, z = os * 6;
      if (d.y < -0.001) {
        const t = -o.y / d.y;
        x = o.x + d.x * t; z = o.z + d.z * t;
      }
      this.kbAim.x = clamp(x, -4.6, 4.6);
      this.kbAim.z = os * clamp(Math.abs(z) * (z * os > 0 ? 1 : 0) || 1.2, 1.2, 9.4);
    } else {
      // opponents' positions decide the default: the open side, deep unless they are deep already
      const row = this.snaps.at(-1)?.p;
      let ox = 0, oz = 6;
      if (row) {
        const opp = [0, 1, 2, 3].filter((i) => i >> 1 !== this.team).map((i) => row[i]);
        ox = (opp[0][0] + opp[1][0]) / 2;
        oz = (Math.abs(opp[0][1]) + Math.abs(opp[1][1])) / 2;
      }
      const ax = inp.axes();
      const sx = this.aimSource === 'stick' ? st.x : ax.x;
      const sz = this.aimSource === 'stick' ? st.y : ax.y;
      const steerX = Math.abs(sx) > 0.25 ? clamp(sx, -1, 1) : 0;
      const steerZ = Math.abs(sz) > 0.25 ? Math.sign(sz) : 0;
      let tx, depth;
      if (steerX) tx = -os * steerX * 3.4; // screen-right is world (-os, 0, 0)
      else tx = (Math.abs(ox) < 0.6 ? (this.me.x > 0 ? -1 : 1) : -Math.sign(ox)) * 2.8;
      if (steerZ > 0) depth = 8.8;
      else if (steerZ < 0) depth = 3.0;
      else depth = oz < 4.5 ? 8.6 : 6.6; // opponents at the net: lob over them
      const k = this.aimSource === 'stick' ? 1 : Math.min(1, dt * 12);
      this.kbAim.x += (tx - this.kbAim.x) * k;
      this.kbAim.z += (os * depth - this.kbAim.z) * k;
    }
    this.aim.set(this.kbAim.x, 0.03, this.kbAim.z);
  }

  buildInput() {
    const { mx, mz } = this.moveAxes();
    const i = this.input;
    const held = i.actionDown('soft') ? 1 : i.actionDown('control') ? 2 : i.actionDown('slice') ? 3 : 0;
    const mod = this.want.swing && this.want.mod ? this.want.mod : held;
    const inp = {
      seq: ++this.seq, mx, mz, sprint: i.actionDown('sprint'),
      ax: +this.aim.x.toFixed(2), az: +this.aim.z.toFixed(2), mod,
      swing: this.want.swing, lob: this.want.lob, jump: this.want.jump,
      // keyboard steering is resolved by the server at contact; a mouse or right-stick target is sent as an explicit point
      steer: this.aimSource === 'steer',
    };
    if (this.want.swing && !this.swingLocal) this.swingLocal = { t: 0, kind: this.guessKind(inp) };
    this.want.swing = false; this.want.jump = false; this.want.mod = 0;
    return inp;
  }

  guessKind(inp) {
    const b = this.ballView;
    if (this.phase === 'serve') return 'serve';
    if (inp.lob) return 'lob';
    if (inp.mod === 3 && b.y <= 2.1) return 'slice';
    if (b.y > 2.1) return inp.mod === 2 ? 'bandeja' : inp.mod === 1 ? 'vibora' : 'smash';
    const near = Math.abs(this.me.z) < 3.8;
    if (inp.mod === 1) return near ? 'chiquita' : 'drop';
    if (inp.mod === 2) return 'block';
    if (near && b.y > 0.35) return 'volley';
    const right = this.team === 0 ? b.x < this.me.x : b.x > this.me.x;
    return right ? 'forehand' : 'backhand';
  }

  /** Same movement rules as the server, including the serve restrictions. */
  stepMe(inp) {
    const mul = this.swingLocal ? PLAYER.SWING_MOVE : 1; // planted while swinging
    if (this.phase === 'serve') {
      if (this.slot === this.serverSlot) stepPlayer(this.me, inp, TICK, serveLimit(this.team), mul);
      else { this.me.vx = 0; this.me.vz = 0; }
    } else {
      stepPlayer(this.me, inp, TICK, undefined, mul);
    }
  }

  // ------------------------------------------------------------------ network in

  onSnap(m) {
    m.rt = performance.now();
    this.snaps.push(m);
    if (this.snaps.length > 40) this.snaps.shift();
    this.phase = m.ph;
    this.lastTeam = m.lt;
    const row = m.p[this.slot];
    const live = m.ph === 'serve' || m.ph === 'rally';
    Object.assign(this.me, { x: row[0], z: row[1], vx: row[2], vz: row[3], stamina: row[4] });
    const ack = row[8];
    this.pending = live ? this.pending.filter((i) => i.seq > ack) : [];
    for (const i of this.pending) this.stepMe(i);
    this.hud.setClock(m.n / 60);
  }

  onEvents(evs) {
    const later = (fn) => setTimeout(() => !this.stopped && fn(), this.interp * 900);
    for (const e of evs) {
      switch (e.e) {
        case 'serve': {
          this.serverSlot = e.slot;
          this.hud.setScore(e.score, this.names);
          if (e.score.matchPoint) this.sound.play('matchpoint');
          this.sound.announce(scoreCallout(e.score, e.score.server?.team));
          const mine = e.slot === this.slot;
          this.hud.banner(mine ? 'Your serve' : `${this.names[e.slot]} serves`, e.score.label || scoreCall(e.score), 2000);
          break;
        }
        case 'hit': {
          later(() => {
            this.sound.play('hit', { kind: e.kind, label: e.label, pan: e.x / 5, power: 0.75 + 0.25 * (e.q ?? 1) });
            this.world.spawnFx('hit', e.x, e.y, e.z, e.kind === 'smash' ? 1.6 : 1);
            this.world.punch(e.kind === 'smash' ? 2.4 : 0.9);
          });
          // the other team split-steps just before the ball arrives
          for (let s = 0; s < 4; s++) {
            if (s >> 1 === e.slot >> 1) continue;
            const pv = this.snaps.at(-1)?.p[s];
            const dist = pv ? Math.hypot(pv[0] - e.x, pv[1] - e.z) : 8;
            setTimeout(() => !this.stopped && this.world.splitStep(s), Math.max(0, (dist / 15 - 0.2) * 1000));
          }
          if (e.slot === this.slot) this.hud.feedback(e.label, e.kind);
          break;
        }
        case 'ball': {
          if (e.k === 'door') { later(() => this.hud.banner('Out the door!', 'Chase it outside', 1400)); break; }
          const pw = clamp((e.s || 4) / 9, 0.3, 1.4);
          later(() => {
            this.sound.play(e.k, { pan: e.x / 5, power: pw, mesh: e.k === 'wall' && e.y > 3 });
            this.world.spawnFx(e.k, e.x, e.y, e.z, pw, e.axis);
          });
          break;
        }
        case 'fault':
          this.sound.play('fault');
          this.hud.banner('Fault', e.n === 1 ? 'Second serve' : '', 1800);
          break;
        case 'point': {
          this.hud.setScore(e.score, this.names);
          this.hud.setStats(e.st, e.lr);
          if (e.winner === this.team) this.world.cheerCrowd();
          setTimeout(() => {
            if (this.stopped) return;
            for (let s = 0; s < 4; s++) if (this.world.players[s].root.visible) this.world.emote(s, (s >> 1) === e.winner ? 'win' : 'lose');
          }, 350);
          const top = e.marks.find((m) => m.type === 'match') || e.marks.find((m) => m.type === 'set') || e.marks.find((m) => m.type === 'game');
          const team = e.winner === this.team ? 'Your team' : 'Opponents';
          const why = e.reason === 'bounce' && e.rally === 1 ? 'Ace' : REASONS[e.reason] || '';
          if (top) {
            const word = { match: 'Game, set & match', set: 'Set', game: 'Game' }[top.type];
            this.hud.banner(word, `${team} · ${why}`, 2200);
            this.sound.play(top.type === 'match' ? 'match' : top.type === 'set' ? 'set' : 'game');
            this.sound.announce(top.type === 'match' ? 'Game, set and match' : top.type === 'set' ? 'Set' : 'Game');
          } else {
            this.hud.banner(why, `${team} wins the point`, 1800);
            this.sound.play(e.winner === this.team ? 'point' : 'lose');
          }
          break;
        }
        case 'match':
          this.hud.banner(e.winner === this.team ? 'Victory' : 'Defeat', 'Match over', 4000);
          break;
        default:
      }
    }
  }

  // ------------------------------------------------------------------ frame

  interpolated(now) {
    const s = this.snaps;
    if (!s.length) return null;
    const t = now - this.interp * 1000;
    let i = s.length - 1;
    while (i > 0 && s[i - 1].rt > t) i--;
    const a = s[Math.max(0, i - 1)], b = s[i];
    let f = a === b ? 1 : (t - a.rt) / (b.rt - a.rt);
    let extra = 0;
    if (f > 1) { extra = Math.min(0.12, (t - b.rt) / 1000); f = 1; }
    f = clamp(f, 0, 1);
    const lerp = (p, q) => p + (q - p) * f;
    const ball = {
      x: lerp(a.b[0], b.b[0]) + b.b[3] * extra,
      y: Math.max(0.03, lerp(a.b[1], b.b[1]) + b.b[4] * extra - 4.9 * extra * extra),
      z: lerp(a.b[2], b.b[2]) + b.b[5] * extra,
      vy: b.b[4], vx: b.b[3], vz: b.b[5], sb: b.b[6] || 0,
    };
    const players = b.p.map((rb, k) => {
      const ra = a.p[k];
      return {
        x: lerp(ra[0], rb[0]) + rb[2] * extra, z: lerp(ra[1], rb[1]) + rb[3] * extra,
        vx: rb[2], vz: rb[3], kindName: SHOT_IDS[rb[5]] || 'forehand', swingT: rb[6], jumpT: rb[7],
      };
    });
    return { ball, players };
  }

  frame(dt, now) {
    if (this.stopped) return;
    dt = Math.min(dt, 0.1);
    this.updateAim(dt);

    // fixed-step local input + prediction
    this.acc += dt;
    const out = [];
    const live = this.phase === 'serve' || this.phase === 'rally';
    while (this.acc >= TICK) {
      this.acc -= TICK;
      const inp = this.paused ? { seq: ++this.seq, mx: 0, mz: 0 } : this.buildInput();
      if (live) this.stepMe(inp);
      this.pending.push(inp);
      out.push(inp);
    }
    if (this.pending.length > 120) this.pending.splice(0, this.pending.length - 120);
    if (out.length) this.net.send({ t: 'in', inputs: out });

    const view = this.interpolated(now);
    const w = this.world;
    if (view) {
      this.ballView = view.ball;
      w.setBall(view.ball.x, view.ball.y, view.ball.z);
      w.ballVel = { x: view.ball.vx, y: view.ball.vy, z: view.ball.vz };
      const sp = Math.hypot(view.ball.vx, view.ball.vz);
      w.animateBall(dt, Math.hypot(sp, view.ball.vy), sp > 0.1 ? view.ball.vx / sp : 0, sp > 0.1 ? view.ball.vz / sp : 1, view.ball.sb);
      view.players.forEach((v, k) => {
        v.serving = this.phase === 'serve' && k === this.serverSlot;
        if (k === this.slot) {
          const sl = this.swingLocal;
          const mine = { ...v, x: this.me.x, z: this.me.z, vx: this.me.vx, vz: this.me.vz };
          if (sl) { mine.swingT = sl.t; mine.kindName = sl.kind; } else if (v.swingT >= 0) { mine.swingT = v.swingT; }
          w.updatePlayer(k, mine, dt, true);
        } else {
          w.updatePlayer(k, v, dt, false);
        }
      });
      if (this.swingLocal) { this.swingLocal.t += dt; if (this.swingLocal.t > 0.42) this.swingLocal = null; }
    }

    // reticle + reach ring (timing aid)
    w.reticle.position.set(this.aim.x, 0.04, this.aim.z);
    w.reticleDot.position.copy(w.reticle.position);
    // the ring is the target AREA, not a promise: it widens when the ball is far from the sweet spot (worse contact)
    const marker = this.input.settings.aimMarker;
    w.reticle.visible = w.reticleDot.visible = marker;
    {
      const bb = this.ballView;
      const dd = Math.hypot(bb.x - this.me.x, bb.z - this.me.z);
      const incoming = this.lastTeam !== this.team && this.phase === 'rally' && dd < 4;
      const radius = 0.3 + (incoming ? Math.min(1, Math.abs(dd - 0.95) / 1.7) * 0.9 : 0.15);
      w.reticle.scale.setScalar(radius / 0.3);
    }
    const b = this.ballView;
    const d = Math.hypot(b.x - this.me.x, b.z - this.me.z);
    const mine = this.lastTeam !== this.team && this.phase === 'rally';
    const inReach = mine && d < 2.0 && b.y < 2.8 && (this.team === 0 ? b.z < 0.3 : b.z > -0.3);
    w.reachRing.visible = settings.timing;
    w.reachRing.material.color.set(inReach ? 0xd4f23c : 0xffffff);
    w.reachRing.material.opacity = inReach ? 0.85 : mine && d < 3.5 ? 0.35 : 0.14;
    w.ballHalo.material.opacity = settings.ballScale > 2.4 ? 0.5 : 0;
    w.trailOn = settings.trail;

    this.updateCamera(dt);
    this.updateTimingRing(inReach);
    this.hud.setVitals(this.me.stamina, this.net.rtt);
  }

  /**
   * Closing-circle timing aid. The outer circle shrinks onto the ball as it nears the player;
   * pressing Space when it meets the inner ring (about 0.17 s before contact) is PERFECT.
   */
  updateTimingRing() {
    const b = this.ballView;
    const mine = this.lastTeam !== this.team && this.phase === 'rally';
    const dx = this.me.x - b.x, dz = this.me.z - b.z;
    const d = Math.hypot(dx, dz);
    const bv = this.snaps.at(-1)?.b;
    const closing = bv && d > 0.01 ? (dx * bv[3] + dz * bv[5]) / d : 0;
    const onMySide = this.team === 0 ? b.z < 0.4 : b.z > -0.4;
    if (!settings.timing || !mine || !onMySide || closing < 1.5 || d > 14 || b.y > 3.2) { this.hud.timing(null); return; }
    const ttc = Math.max(0, d - 0.85) / closing; // seconds until the ball is at the sweet spot
    if (ttc > 1.1) { this.hud.timing(null); return; }
    const off = ttc - 0.17; // 0 = press now
    const v = new THREE.Vector3(b.x, b.y, b.z).project(this.world.camera);
    const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
    const inner = 26;
    const outer = inner + Math.max(0, off) * 200;
    let zone = 'far', text = '';
    if (off < -0.16) { zone = 'late'; text = 'TARDE'; }
    else if (Math.abs(off) <= 0.09) { zone = 'perfect'; text = 'PERFECTO'; }
    else if (off < 0) { zone = 'good'; text = 'BIEN'; }
    else if (off <= 0.22) { zone = 'good'; text = 'BIEN'; }
    this.hud.timing(x, y, Math.max(outer, inner * 0.8), zone, text);
  }

  updateCamera(dt) {
    const cam = this.world.camera;
    const c = cameraConfig(settings);
    const want = new THREE.Vector3(this.me.x * c.follow, c.height, this.me.z - this.os * c.dist);
    // stay inside the venue walls (the room backdrop is at 17 m)
    want.z = clamp(want.z, -15.5, 15.5);
    if (!this.camPos) this.camPos = want.clone();
    this.camPos.lerp(want, 1 - Math.exp(-dt * c.smooth));
    const ball = this.ballView;
    const focus = c.center
      ? new THREE.Vector3(this.me.x * 0.3, 0.8, 0)
      : new THREE.Vector3(this.me.x * 0.6, 0.6, this.me.z + this.os * c.lookAhead);
    // optionally drift toward the ball; this only moves the view, never the aim or the controls
    if (settings.ballTrack) focus.lerp(new THREE.Vector3(ball.x, Math.min(ball.y, 2), ball.z), c.ball);
    this.camLook.lerp(focus, 1 - Math.exp(-dt * c.smooth * 0.85));
    this.world.baseFov = c.fov;
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
  }
}

function scoreCall(s) {
  const [a, b] = s.points;
  return s.tiebreak ? `Tiebreak ${a}–${b}` : `${a}–${b}`;
}
