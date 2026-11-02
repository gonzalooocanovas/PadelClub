import test from 'node:test';
import assert from 'node:assert/strict';
import { PadelGame } from '../shared/game.js';
import { botInput, makeBotMemory } from '../shared/ai.js';

const rngFor = (seed) => { let s = seed * 7919; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; };

test('serve set-up: the server\'s partner is at the net, the receiver and the receiver\'s partner are at the back', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const g = new PadelGame({ rng: rngFor(seed) });
    const srv = g.serverSlot, recv = g.recvSlot;
    assert.ok(Math.abs(g.players[srv].z) > 7, 'the server is at the baseline');
    assert.ok(Math.abs(g.players[srv ^ 1].z) < 3, 'the server\'s partner is at the net');
    assert.ok(Math.abs(g.players[recv].z) > 7, 'the receiver is at the back');
    assert.ok(Math.abs(g.players[recv ^ 1].z) > 7, 'and so is his partner (not at the net)');
    assert.notEqual(g.players[recv].x, g.players[recv ^ 1].x, 'on the other side of the court');
  }
});

test('the receiver\'s partner neither runs for the serve nor can hit it (bots), over many serves', () => {
  let serves = 0, moved = 0, hits = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const g = new PadelGame({ rng: rngFor(seed), settings: { sets: 1, gamesPerSet: 2 } });
    const mem = [0, 1, 2, 3].map(makeBotMemory);
    let tracking = false, partner = null, start = null, lastRally = null, pSlot = -1;
    for (let i = 0; i < 60 * 90; i++) {
      for (let k = 0; k < 4; k++) g.applyInput(k, botInput(g, k, mem[k], 'normal'));
      g.tick(1 / 60);
      if (g.phase !== 'rally') tracking = false; // a new point teleports everybody to the serve positions
      if (g.phase === 'rally' && g.rally.serving && !tracking && g.rally !== lastRally) { lastRally = g.rally; tracking = true; serves++; pSlot = g.recvSlot ^ 1; partner = g.players[pSlot]; start = [partner.x, partner.z]; }
      if (tracking && partner) {
        if (Math.abs(start[1]) - Math.abs(partner.z) > 1.2) moved++; // ran toward the net
        if (!g.rally.serving || g.rally.hits >= 2) { tracking = false; partner = null; } // the window is the serve itself, until the return is hit
      }
      for (const e of g.drainEvents()) if (e.e === 'hit' && lastRally === g.rally && e.slot === pSlot && g.rally.hits <= 2) hits++;
    }
  }
  assert.ok(serves >= 10, 'serves observed ' + serves);
  assert.equal(moved, 0, 'the receiver\'s partner never ran up in all ' + serves + ' serves');
  assert.equal(hits, 0);
});

test('a human receiver\'s partner cannot return the serve either', () => {
  const g = new PadelGame({ rng: rngFor(3) });
  const partner = g.players[g.recvSlot ^ 1];
  g.phase = 'rally'; g.rally.hits = 1; g.rally.lastTeam = 1 - partner.team;
  g.startSwing(partner, { ax: 0, az: 5, mod: 0, lob: false });
  assert.equal(partner.swing, null, 'no swing allowed');
  g.startSwing(g.players[g.recvSlot], { ax: 0, az: 5, mod: 0, lob: false });
  assert.ok(g.players[g.recvSlot].swing, 'the receiver may');
});
