# PADEL CLUB 3.0 overhaul: final report

Date: 2026-10-28. Machine: 12th Gen Intel i7-1255U (12 threads), 17 GB, Windows 11, Node v24.19.0. All numbers below come from files in `docs/` produced by the commands shown.

## 1. Summary
Physics were calibrated and made more physical (quadratic drag, sub-stepping, swept floor contact). Bots now choose shots by flying candidates through the real physics, verified by the real planner, and a doubles team shares one plan with ball ownership. Added: calibration/benchmark/contact/server tooling, a read-only diagnostics overlay, event-to-sound mapping, camera audit, about 87 new tests, and documentation.

## 2. Files
- Core: `shared/physics.js`, `constants.js`, `game.js`, `ai.js`, new `shared/tactics.js`.
- Server: `server/index.js` (metrics), `server/rooms.js`.
- Client: `client/js/diagnostics.js`, `diagnostics-core.js`, `sound-map.js`, `main.js`, `game.js`, `local.js`, `scene.js`, `ui.js`, `client/style.css`.
- Tools: `tools/calibrate.mjs`, `bench-bots.mjs`, `bench-server.mjs`, `contact-analysis.mjs`, `camera-audit.js`, `tools/lib/{scenarios,match,match-worker}`.
- Tests (new): calibration, tactics, teamwork, bot-fairness, geometry, contact-analysis, diagnostics, audio, career-e2e, regression. Changed: career, positioning, lob.
- Docs: BASELINE, CALIBRATION, CONTACT, DIAGNOSTICS, CAMERAS, MANUAL_TEST_CHECKLIST, this report, bench/calibration outputs, README, DEV_CHECKLIST.

## 3. Commands and results
- `npm test`: tests 184, pass 184, fail 0, duration 77.6 s (last run; earlier runs took 137-155 s under load).
- `npm run calibrate` -> docs/calibration-output.txt
- `npm run bench:bots -- --n 100 --tag final --pairs easy:normal,normal:hard,hard:expert --single easy,normal,hard,expert` (123 s) -> docs/bench-final.txt
- `npm run bench:server` (ramp, rooms, sustained, abuse) -> docs/bench-server-*.txt
- `npm run analyze:contact` -> docs/contact-analysis.txt

## 4. Bot benchmarks (100 deterministic matches per pairing, seeds 1000-1099, sides swapped, 3 games per set)
| Pairing | Stronger won | 95% CI | Unfinished | Rally (shots) |
|---|---|---|---|---|
| easy vs normal | 83/98 = 84.7% | 76-90% | 2 | 6.2 |
| normal vs hard | 95/98 = 96.9% | 91-99% | 2 | 9.1 |
| hard vs expert | 89/93 = 95.7% | 89-98% | 7 | 17.4 |

Self-play rally length easy/normal: 5.6 / 6.9 shots (hard/expert in the full file). Teamwork: 0 double commitments; reachable balls ignored by the whole team 0.3-0.6%. Wall rebounds are played in 4-6% of shots. No NaN states. Earlier runs (before AI, after physics) are in `docs/bench-baseline-before-ai.txt` and `docs/bench-after-physics.txt` (different match counts; compare with care). Levels were NOT weakened to inflate these results; differences come from skill numbers (flub, serve pace, reaction).

## 5. Calibration (measured vs estimated)
See `docs/CALIBRATION.md`. Court, net and ball sizes are standard (from secondary sources; the official FIP PDF text was not opened). Drag was 3-5x too weak and is now physical, but its coefficient is a tennis-ball estimate. Integrator error of up to 0.27 m was reduced to 0.05-0.07 m. Floor bounce is a deliberate gameplay compromise (livelier than real turf). Glass/fence restitution, Magnus and the wall spin kick are estimates.

## 6. Performance (this machine only)
- Simulation only: p95 tick 2.7 ms at 64 rooms, 10.5 ms at 256, 16.3 ms at 384 (25 ticks over budget), 20.3 ms at 512 (104 over). Budget 16.67 ms.
- 8 rooms x 4 real WebSocket clients: tick p95 1.17 ms, 0 over budget, about 16.5 KB/s per client.
- Sustained 240 s, 4 clients, 8 reconnects: p95 0.49 ms, max 5.46 ms, 0 over budget, heap about 10-14 MB, 0 errors.
- Abuse (malformed input + floods): 0 uncaught errors, server survived.
- NOT established: real network, TLS, Render capacity (its plan is far weaker than this machine).

## 7. Manual checks actually completed
Diagnostics overlay rendered in the in-app browser; one wall-camera screenshot; geometric camera audit of player/first/wall/corner/side; earlier: quick-match countdown. Nothing else was judged by a person.

## 8. Partly implemented / unverified
Audio quality (never listened to); cameras broadcast/tactical/custom and other venues; physical gamepad; 4-human session; mobile and low-end GPUs; off-court doors never walked by a person; animation vs authoritative contact mismatch (docs/CONTACT.md); Render deployment (the owner must recreate it in Frankfurt).

## 9. Known bugs / risks
- Bot points are 66-92% errors (mostly "late" or "poor" contact); winners only 3-23%.
- Bots essentially never ace or double-fault.
- Simulated career brackets are slower to compute.
- Tactics such as corner-wall and bandeja rarely win points directly.
- Benchmarks are bot-vs-bot; they say nothing about how it feels to a human.

## 10. Docs updated
README.md, DEV_CHECKLIST.md (3.0 section with status classes), and the docs/*.md files listed above.
