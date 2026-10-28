// Which sounds a game event produces. Pure function (unit-tested): the sounds come from the authoritative events the server sends,
// never from client-side predictions, and one event maps to a fixed list of sounds (no duplicates by construction).
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** @returns {{name: string, opts?: object}[]} */
export function soundsFor(e, ctx = {}) {
  switch (e.e) {
    case 'hit':
      return [{ name: 'hit', opts: { kind: e.kind, label: e.label, pan: e.x / 5, power: 0.75 + 0.25 * (e.q ?? 1) } }];
    case 'ball': {
      if (e.k === 'door') return []; // a banner, no sound
      if (!['floor', 'wall', 'net'].includes(e.k)) return [];
      const power = clamp((e.s || 4) / 9, 0.3, 1.4);
      return [{ name: e.k, opts: { pan: e.x / 5, power, mesh: e.k === 'wall' && (e.mesh ?? e.y > 3) } }];
    }
    case 'fault': return [{ name: 'fault' }];
    case 'point': {
      const top = e.marks?.find((m) => m.type === 'match') || e.marks?.find((m) => m.type === 'set') || e.marks?.find((m) => m.type === 'game');
      if (top) return [{ name: top.type }];
      return [{ name: e.winner === ctx.team ? 'point' : 'lose' }];
    }
    case 'serve': return e.score?.matchPoint ? [{ name: 'matchpoint' }] : [];
    default: return [];
  }
}
