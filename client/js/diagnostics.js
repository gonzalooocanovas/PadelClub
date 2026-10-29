// Developer diagnostics: a read-only overlay. Off by default (enable with F3 or ?debug=1). It only READS: it never sends a message,
// never writes game state, and the single-step/pause controls exist for solo matches only (online there is nothing to step).
import * as THREE from 'three';
import { COURT } from '/shared/constants.js';
import { predictBall } from '/shared/physics.js';
import { Rolling, buildReport, landingComparison } from './diagnostics-core.js';
import { statueReady, statueError, MODEL_URL } from './statue.js';
const statueNote = () => (statueError() ? `FAILED to load (${statueError()}): procedural fallback` : statueReady() ? `loaded (${MODEL_URL}); the file has no skeleton and no clips: a generated skeleton is used` : 'loading...');

const MAT = {
  glass: new THREE.LineBasicMaterial({ color: 0x59d8ff }),
  mesh: new THREE.LineBasicMaterial({ color: 0xffa13d }),
  door: new THREE.LineBasicMaterial({ color: 0x7dff7a }),
  net: new THREE.LineBasicMaterial({ color: 0xffffff }),
  strip: new THREE.LineBasicMaterial({ color: 0xc08bff }),
  plan: new THREE.LineBasicMaterial({ color: 0xffe14d }), // what the shooter intended
  pred: new THREE.LineBasicMaterial({ color: 0x4da3ff }), // what the physics predicts from the ball's state
  act: new THREE.LineBasicMaterial({ color: 0xff5a5a }), // what actually happened
};

const loop = (pts, mat) => { const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p))); return new THREE.LineLoop(g, mat); };
const seg = (a, b, mat) => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]), mat);

export class Diagnostics {
  constructor({ world, getContext }) {
    this.world = world; this.getContext = getContext;
    this.on = false;
    this.frameMs = new Rolling(240); this.snapMs = new Rolling(240);
    this.last = 0; this.lastSnap = 0;
    this.events = []; this.pending = null; this.lastHit = null; this.landing = null; this.corrections = 0;
    this.group = null; this.panel = null; this.dyn = []; this.t = 0;
  }

  /** compact = the small performance panel (F2): frame times and network only, no 3D overlay. */
  toggle(force, compact = false) {
    const on = force === undefined ? !this.on || this.compact !== compact : !!force;
    if (this.on && (on === false || this.compact !== compact)) { this.teardown(); this.on = false; }
    if (on && !this.on) { this.compact = compact; this.on = true; this.build(); }
  }

  build() {
    if (this.compact) { this.buildPanel(); return; }
    const g = new THREE.Group();
    const H = 4, hw = COURT.HALF_W, hl = COURT.HALF_L, D = COURT.DOOR, P = COURT.PIT;
    // walls: glass (back walls, and the back 4 m of the side walls) and fence (the middle of the side walls)
    for (const sz of [-1, 1]) g.add(loop([[-hw, 0, sz * hl], [hw, 0, sz * hl], [hw, 3, sz * hl], [-hw, 3, sz * hl]], MAT.glass), loop([[-hw, 3, sz * hl], [hw, 3, sz * hl], [hw, H, sz * hl], [-hw, H, sz * hl]], MAT.mesh));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) g.add(loop([[sx * hw, 0, sz * 6], [sx * hw, 0, sz * hl], [sx * hw, 3, sz * hl], [sx * hw, 3, sz * 6]], MAT.glass));
      g.add(loop([[sx * hw, 0, -6], [sx * hw, 0, 6], [sx * hw, 3, 6], [sx * hw, 3, -6]], MAT.mesh));
      for (const sz of [-1, 1]) g.add(loop([[sx * hw, 0, sz * D.z0], [sx * hw, 0, sz * D.z1], [sx * hw, D.h, sz * D.z1], [sx * hw, D.h, sz * D.z0]], MAT.door));
      g.add(loop([[sx * hw, 0.02, -P.z1], [sx * (hw + P.w), 0.02, -P.z1], [sx * (hw + P.w), 0.02, P.z1], [sx * hw, 0.02, P.z1]], MAT.strip));
    }
    g.add(loop([[-hw, 0, 0], [hw, 0, 0], [hw, COURT.NET_H + 0.04, 0], [-hw, COURT.NET_H + 0.04, 0]], MAT.net));
    this.group = g; this.world.scene.add(g);
    this.dynGroup = new THREE.Group(); this.world.scene.add(this.dynGroup);
    this.buildPanel();
  }

  buildPanel() {
    const el = document.createElement('div');
    el.id = 'diag';
    el.style.cssText = 'position:fixed;right:8px;top:8px;z-index:50;width:340px;max-height:92vh;overflow:auto;background:rgba(4,8,14,.86);color:#cfe3ff;font:11px/1.45 Consolas,monospace;padding:8px 10px;border:1px solid #2b4a6b;border-radius:6px;pointer-events:auto;white-space:pre';
    el.innerHTML = '<div id="diagText"></div><button id="diagCopy" style="margin-top:6px;font:11px monospace;cursor:pointer">Copy report (F4)</button>';
    document.body.appendChild(el); this.panel = el;
    el.querySelector('#diagCopy').onclick = () => this.copyReport();
  }

  teardown() {
    if (this.group) { this.world.scene.remove(this.group); this.group = null; }
    if (this.dynGroup) { this.world.scene.remove(this.dynGroup); this.dynGroup = null; }
    this.panel?.remove(); this.panel = null; this.dyn = []; this.arrow = null;
  }

  /** Called every rendered frame: when the diagnostics are off this is a single boolean test. */
  frame(now) {
    if (!this.on) return;
    if (this.last) this.frameMs.push(now - this.last);
    this.last = now;
    if (now - this.t < 100) return;
    this.t = now;
    this.draw(now);
  }

  onSnap(now) { if (!this.on) return; if (this.lastSnap) this.snapMs.push(now - this.lastSnap); this.lastSnap = now; }
  onCorrection() { if (this.on) this.corrections++; }

  onEvents(evs, ctx) {
    if (!this.on) return;
    for (const e of evs) {
      const brief = { t: +(performance.now() / 1000).toFixed(2), e: e.e, k: e.k, kind: e.kind, label: e.label, q: e.q, reason: e.reason, x: e.x, z: e.z, tac: e.tac || undefined };
      this.events.push(brief); if (this.events.length > 40) this.events.shift();
      if (e.e === 'hit') { this.pending = { plan: e.tgt, kind: e.kind, label: e.label, q: e.q, tac: e.tac, hitAt: performance.now() }; this.lastHit = { ...brief, tgt: e.tgt }; }
      if (e.e === 'ball' && e.k === 'floor' && this.pending && !this.pending.actual && Math.abs(e.z) > 0.2) {
        this.pending.actual = [e.x, e.z];
        const b = this.lastBallState;
        this.landing = landingComparison(this.pending.plan, this.pending.pred || null, this.pending.actual);
        this.mark(this.pending.plan, MAT.plan); this.mark(this.pending.pred, MAT.pred); this.mark(this.pending.actual, MAT.act);
        void b; void ctx;
      }
      if (e.e === 'ball' && (e.k === 'wall' || e.k === 'floor' || e.k === 'net')) this.normal(e);
    }
  }

  mark(p, mat) {
    if (!p || !this.dynGroup) return;
    const m = loop(Array.from({ length: 24 }, (_, i) => [p[0] + Math.cos((i / 24) * 6.283) * 0.22, 0.05, p[1] + Math.sin((i / 24) * 6.283) * 0.22]), mat);
    this.dynGroup.add(m); this.dyn.push({ m, t: performance.now() + 6000 });
  }

  normal(e) {
    if (!this.dynGroup) return;
    const n = e.k === 'floor' ? [0, 1, 0] : e.k === 'net' ? [0, 0, Math.sign(e.z || 1)] : e.axis === 'x' ? [-Math.sign(e.x), 0, 0] : [0, 0, -Math.sign(e.z)];
    const p = [e.x, e.y || 0.03, e.z];
    const l = seg(p, [p[0] + n[0] * 0.6, p[1] + n[1] * 0.6, p[2] + n[2] * 0.6], e.k === 'wall' && e.mesh ? MAT.mesh : MAT.glass);
    this.dynGroup.add(l); this.dyn.push({ m: l, t: performance.now() + 2500 });
  }

  draw(now) {
    const ctx = this.getContext();
    // expire markers
    this.dyn = this.dyn.filter((d) => { if (now > d.t) { this.dynGroup.remove(d.m); d.m.geometry.dispose(); return false; } return true; });
    const b = ctx.ball;
    if (b) {
      this.lastBallState = b;
      if (this.pending && !this.pending.pred && performance.now() - this.pending.hitAt > 80) { // predicted landing from the ball's state just after the hit
        const s = predictBall({ ...b, hw: ctx.singles ? 3.5 : 5, fe: 0.85, ff: 0.86 }, 3);
        const f = s.find((x) => x.floor);
        if (f) this.pending.pred = [f.x, f.z];
      }
    }
    const fr = this.frameMs.stats(), sn = this.snapMs.stats();
    const L = [];
    if (this.compact) {
      L.push(`PERFORMANCE  quality ${ctx.quality}  (F2 hides)`);
      L.push(`frame ms  p50 ${fr.p50?.toFixed(1)}  p95 ${fr.p95?.toFixed(1)}  p99 ${fr.p99?.toFixed(1)}  ~${(1000 / fr.mean).toFixed(0)} fps`);
      L.push(ctx.online ? `snapshots ms  mean ${sn.mean?.toFixed(1)}  p95 ${sn.p95?.toFixed(1)}  interp ${ctx.interpMs} ms  rtt ${ctx.rtt ?? '?'} ms` : 'network: solo match');
      L.push('GPU time, draw calls and CPU use are not available from the browser here; a hidden or throttled tab gives meaningless frame times.');
      this.panel.querySelector('#diagText').textContent = L.join('\n');
      return;
    }
    L.push(`DIAGNOSTICS (read-only)  ${ctx.mode}  court ${ctx.court}  camera ${ctx.camera}  quality ${ctx.quality}`);
    L.push(`frame ms  p50 ${fr.p50?.toFixed(1)}  p95 ${fr.p95?.toFixed(1)}  p99 ${fr.p99?.toFixed(1)}  ~${(1000 / fr.mean).toFixed(0)} fps  (n=${fr.n})`);
    L.push(ctx.online ? `snapshots ms  mean ${sn.mean?.toFixed(1)}  p95 ${sn.p95?.toFixed(1)}  max ${sn.max?.toFixed(1)}  interp ${ctx.interpMs} ms  rtt ${ctx.rtt ?? '?'} ms  corrections ${this.corrections}` : 'network: solo match (no network)');
    if (b) L.push(`ball  pos ${b.x.toFixed(2)} ${b.y.toFixed(2)} ${b.z.toFixed(2)}  v ${Math.hypot(b.vx, b.vy, b.vz).toFixed(1)} m/s  spin sb ${(b.sb || 0).toFixed(1)} ss ${(b.ss || 0).toFixed(1)}  bounces ${ctx.bounces ?? '?'}`);
    if (ctx.me) L.push(`me  pos ${ctx.me.x.toFixed(2)} ${ctx.me.z.toFixed(2)}  stamina ${ctx.me.stamina.toFixed(0)}  reach 1.8 m`);
    if (this.lastHit) L.push(`last hit  ${this.lastHit.kind} ${this.lastHit.label} q=${this.lastHit.q}  tactic ${this.lastHit.tac || '-'}  planned landing ${this.lastHit.tgt ? this.lastHit.tgt.join(', ') : 'n/a'}`);
    if (this.landing) L.push(`landing  planned(yellow) ${fmt(this.landing.planned)}  predicted(blue) ${fmt(this.landing.predicted)}  actual(red) ${fmt(this.landing.actual)}  |plan-actual| ${this.landing.plannedVsActual?.toFixed(2) ?? 'n/a'} m`);
    if (ctx.bots) for (const bt of ctx.bots) L.push(`bot ${bt.slot} ${bt.level}: ${bt.decision ? `${bt.decision.tac} — ${bt.decision.reason}` : 'no decision yet'}  owner ${bt.owner}`);
    if (ctx.anim) {
      L.push(`animation  model file ${statueNote()}`);
      for (const a of ctx.anim) L.push(`  p${a.slot} ${a.model}: state ${a.state} (changes ${a.changes})  clip ${a.clip}  blend ${a.blend}  skeleton ${a.skeleton}  racket ${a.racket ? 'attached' : 'MISSING'}  scale ${a.scale}  yaw ${a.yaw}`);
    }
    L.push('recent events:');
    for (const e of this.events.slice(-8)) L.push(`  ${e.t.toFixed(1)}s ${e.e}${e.k ? ':' + e.k : ''}${e.kind ? ' ' + e.kind : ''}${e.label ? ' ' + e.label : ''}${e.reason ? ' ' + e.reason : ''}`);
    L.push(ctx.solo ? "solo controls: [ pause/resume   ] one tick   F3 hide   F4 copy" : 'online: no stepping or pausing from here');
    this.panel.querySelector('#diagText').textContent = L.join('\n');
    // velocity arrow
    if (b && this.dynGroup) {
      if (!this.arrow) { this.arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0xffffff); this.dynGroup.add(this.arrow); }
      const v = new THREE.Vector3(b.vx, b.vy, b.vz);
      const len = v.length();
      this.arrow.visible = len > 0.5;
      if (this.arrow.visible) { this.arrow.position.set(b.x, b.y, b.z); this.arrow.setDirection(v.normalize()); this.arrow.setLength(Math.min(3, len * 0.12), 0.12, 0.06); }
    }
  }

  report() {
    const ctx = this.getContext();
    return buildReport({
      when: new Date().toISOString(), mode: ctx.mode, court: ctx.court, camera: ctx.camera, quality: ctx.quality,
      frame: this.frameMs.stats(), net: ctx.online ? this.snapMs.stats() : null, interpMs: ctx.interpMs, rtt: ctx.rtt, corrections: this.corrections,
      ball: ctx.ball ? { x: +ctx.ball.x.toFixed(2), y: +ctx.ball.y.toFixed(2), z: +ctx.ball.z.toFixed(2), speed: +Math.hypot(ctx.ball.vx, ctx.ball.vy, ctx.ball.vz).toFixed(1) } : null,
      lastHit: this.lastHit, landing: this.landing, events: this.events, bots: ctx.bots ? ctx.bots.map((b) => ({ slot: b.slot, level: b.level, decision: b.decision, owner: b.owner })) : null,
    });
  }

  copyReport() {
    const text = JSON.stringify(this.report(), null, 2);
    console.log('[diagnostics report]\n' + text);
    navigator.clipboard?.writeText(text).catch(() => {});
    return text;
  }
}

const fmt = (p) => (p ? `(${p[0].toFixed(1)}, ${p[1].toFixed(1)})` : 'n/a');
