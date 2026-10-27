const fs = require('fs');
const edit = (file, pairs) => {
  let s = fs.readFileSync(file, 'utf8');
  for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(file + ' missing: ' + a.slice(0, 70)); s = s.replace(a, () => b); }
  fs.writeFileSync(file, s);
};

edit('shared/game.js', [
  [`        } else if (this.contact(p)) {
          p.swing.done = true;
        }`, `        } else {
          // the racket meets the ball at the sweet spot: wait for it unless it is already leaving or the window is closing
          const bb = this.ball;
          const d = Math.hypot(bb.x - p.x, bb.z - p.z);
          const approaching = d < (p.swing.lastD ?? Infinity) - 1e-6;
          p.swing.lastD = d;
          const ready = d <= 1.2 || !approaching || p.swing.t >= PLAYER.CONTACT_TO - 2 * dt;
          if (ready && this.contact(p)) p.swing.done = true;
        }`],
  [`    const late = clamp((sw.t - 0.17) / 0.12, -1, 1); // + late (face opens), - early (face closed)
    const face = clamp(late * 0.8 + (b.y < 0.5 ? 0.4 : b.y > 1.6 && b.y <= 2.1 ? -0.2 : 0), -1, 1);`,
   `    // timing > 0: the ball met the racket late in the swing (swing started early), < 0: early in the swing (started late).
    // Met before the swing peaked = behind the ball, face open (higher, slower, backspin); met after = out in front, face closed.
    const timing = clamp((sw.t - 0.17) / 0.12, -1, 1);
    const face = clamp(-timing * 0.8 + (b.y < 0.5 ? 0.4 : b.y > 1.6 && b.y <= 2.1 ? -0.2 : 0), -1, 1);`],
  ["    else label = late > 0 ? 'late' : 'early';", "    else label = timing < 0 ? 'late' : 'early';"],
]);

edit('shared/ai.js', [
  ["flub: 0.34, aggr: 0.12,", "flub: 0.34, timingErr: 0.24, aggr: 0.12,"],
  ["flub: 0.22, aggr: 0.3,", "flub: 0.22, timingErr: 0.14, aggr: 0.3,"],
  ["flub: 0.08, aggr: 0.5,", "flub: 0.08, timingErr: 0.07, aggr: 0.5,"],
  ["flub: 0.03, aggr: 0.75,", "flub: 0.03, timingErr: 0.03, aggr: 0.75,"],
  ["    mem.flub = rnd() < skill.flub * (r.serving ? 0.35 : 1);", "    mem.flub = rnd() < skill.flub * (r.serving ? 0.35 : 1);\n    mem.jit = (rnd() - 0.5) * skill.timingErr; // each level presses a little earlier or later"],
  ["        && dist < skill.reach && !mem.flub && b.y < 2.9 && b.y > 0.1 && mem.react <= 0) {", "        && dist < skill.reach && !mem.flub && b.y < 2.9 && b.y > 0.1 && mem.react <= 0 && swingNow(b, dx, dz, dist, mem)) {"],
  ["/** Serve: stronger levels", `/** Press so the ball reaches the sweet spot about 0.17 s into the swing (where the racket face is square). */
function swingNow(b, dx, dz, dist, mem) {
  const closing = -(dx * b.vx + dz * b.vz) / (dist || 1);
  const ttc = Math.max(0, dist - 0.95) / Math.max(closing, 1.5);
  return dist < 1.25 || ttc <= 0.17 + (mem.jit || 0);
}

/** Serve: stronger levels`],
]);
