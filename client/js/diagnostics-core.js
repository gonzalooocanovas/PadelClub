// Pure helpers of the diagnostics mode (no DOM, no Three.js): unit-tested in Node. Nothing here can change the game.

/** Percentile of a numeric sample (nearest-rank). */
export function percentile(values, p) {
  if (!values.length) return NaN;
  const a = [...values].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1))];
}

/** A rolling window of numbers with summary statistics (frame times, snapshot intervals...). */
export class Rolling {
  constructor(size = 240) { this.size = size; this.v = []; }
  push(x) { this.v.push(x); if (this.v.length > this.size) this.v.shift(); }
  stats() {
    const v = this.v;
    if (!v.length) return { n: 0, mean: NaN, p50: NaN, p95: NaN, p99: NaN, max: NaN };
    return { n: v.length, mean: v.reduce((a, b) => a + b, 0) / v.length, p50: percentile(v, 50), p95: percentile(v, 95), p99: percentile(v, 99), max: Math.max(...v) };
  }
}

/** The compact, shareable report (no names, no tokens, no room code: nothing private). */
export function buildReport(state) {
  const f = (x, d = 2) => (Number.isFinite(x) ? +x.toFixed(d) : null);
  return {
    when: state.when, build: state.build || 'padel-club', mode: state.mode, court: state.court, camera: state.camera, quality: state.quality,
    frame: { fps: f(1000 / state.frame.mean, 1), p50: f(state.frame.p50), p95: f(state.frame.p95), p99: f(state.frame.p99), samples: state.frame.n, note: 'browser frame times in ms; a hidden/throttled tab gives meaningless values' },
    net: state.net ? { snapIntervalMs: { mean: f(state.net.mean), p95: f(state.net.p95), max: f(state.net.max) }, interpDelayMs: state.interpMs, rttMs: state.rtt ?? null, corrections: state.corrections ?? null } : 'not available (solo match: no network)',
    ball: state.ball, lastHit: state.lastHit || null, landing: state.landing || null,
    recentEvents: (state.events || []).slice(-12),
    bots: state.bots || null,
  };
}

/** Planned vs predicted vs actual landing of a shot, in metres. Any of the three may be null (unknown). */
export function landingComparison(planned, predicted, actual) {
  const d = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : null);
  return { planned, predicted, actual, plannedVsActual: d(planned, actual), predictedVsActual: d(predicted, actual) };
}
