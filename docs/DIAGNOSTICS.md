# Diagnostics mode: how to turn it on and capture a useful report

The diagnostics are a **read-only overlay for the owner/developers**. They are off by default. They never send a message to the server, never write game state, and cannot change an online match. Stepping and pausing work only in **solo** matches (practice, 1v1, career, training).

## Turn it on / off

| How | What you get |
|---|---|
| `F3` in a match (or open the game with `?debug=1`) | Full overlay: panel + 3D wireframes + markers |
| `F2` | Small performance panel only (frame times, network, quality) |
| `F3` / `F2` again | Off |

## What you see

**Panel (top right)**
- Mode, venue, camera preset, graphics quality.
- Frame time p50 / p95 / p99 and approximate fps (browser measurements; a hidden or throttled tab gives meaningless numbers).
- Online only: snapshot arrival interval (mean, p95, max), interpolation delay, round-trip time, number of prediction corrections (how often the server position differed from your predicted position by more than 5 cm).
- Ball: position, speed, spin (`sb` back/topspin, `ss` sidespin).
- Your player: position, stamina, reach (1.8 m).
- Last hit: shot kind, contact label, quality `q`, the bot's tactic if it was a bot, and the **planned landing point**.
- Landing comparison: **planned** (yellow), **predicted** from the ball's state right after the hit (blue), **actual** first bounce (red), and the planned-vs-actual distance. A big gap means a mishit or a collision happened on the way, not a bug in the plan.
- Bots (solo): each bot's chosen tactic, the reason string with the evaluator's numbers (`diff` = how hard the shot is for the opponents, `risk`, `walls` = glass contacts after the bounce) and which slot owns the incoming ball.
- The last eight events (hit, floor, wall, net, point...).

**In the court (3D)**
- Cyan lines: glass. Orange lines: fence/mesh. Green: the access doors (from `COURT.DOOR`, the same numbers the physics uses). Purple: the outside strips. White: the net plane.
- Short arrows at each collision showing the collision normal for 2.5 s (cyan = glass/floor, orange = fence).
- A white arrow on the ball showing its velocity.
- Yellow / blue / red rings for planned / predicted / actual landing, kept for 6 s.

Comparing the green door frames with the yellow door frames of the venue is the quick way to check that what you see is what collides.

## Solo controls (only while the overlay is on)

- `[` pause / resume the simulation
- `]` advance exactly one 1/60 s tick (while paused)

These keys do nothing online (there is no local simulation to step) and nothing when the overlay is off.

## Capturing a report

Press `F4` (or click **Copy report**). A compact JSON report is copied to the clipboard and printed in the browser console. It contains: time, mode, venue, camera, quality, frame statistics, network statistics (or "not available"), the current ball state, the last hit and landing comparison, the last events and the bots' latest decisions. It contains **no names, tokens, room codes or other private data**. Paste it into a message to the developer.

## Cost when it is off

`Diagnostics.frame()` begins with `if (!this.on) return;`. `test/diagnostics.test.js` measures one million such calls at well under 50 ms (a few microseconds per thousand frames): no measurable cost.
