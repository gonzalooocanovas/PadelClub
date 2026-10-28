# Contact model, feedback and the known animation discrepancy

## What the contact model is (and is not)

`PadelGame.contact()` (shared/game.js) is a **quality model, not a racket-face simulation**. There is no racket orientation, no contact point on a 3D face and no collision response between a racket mesh and the ball. What exists:

- A player has a reach (1.8 m) and a sweet spot 0.95 m in front. When a swing is active and the ball is within the reach, contact happens once the ball is within 1.2 m of the player or is leaving or the swing window is closing (so the racket "meets the ball at the sweet spot").
- Quality `q` (0.3-1) is computed from: distance to the sweet spot, ball height, ball in front or behind, running speed, running away from the ball; minus fatigue (below 45 stamina), minus **pressure** (stretch, ball pace over 14 m/s, being on the run), minus a mishit for bots.
- Timing sets a face angle: pressing early (contact early in the swing) gives an open face (higher, slower, backspin); late gives a closed face (flatter, topspin).
- Labels: `perfect` (q >= 0.82), `clean` (>= 0.62), `stretched` (pressure >= 0.28 and q < 0.75), `off-centre` (sweet-spot distance > 0.55), `early`/`late`, `poor` (< 0.4).
- Outcome: `planShot` chooses a landing point, flight time and spin, solves a launch, simulates it with the real physics and corrects. Quality scales pace (0.8 + 0.2 q), scatter ((1 - q) x 1.7 m), spin, depth (shorter when poor) and net-clearance assistance (only above a face threshold).

## Measured relationship (npm run analyze:contact, 600 scenarios, 376 contacts)

| quality | contacts | pace after contact | lands on the floor | landing error vs the aimed point |
|---|---|---|---|---|
| q < 0.50 | 53 | 10.9 m/s | 34% | 2.15 m |
| 0.50-0.70 | 58 | 12.1 m/s | 47% | 1.34 m |
| 0.70-0.85 | 162 | 14.4 m/s | 62% | 0.92 m |
| q >= 0.85 | 61 | 15.0 m/s | 75% | 0.47 m |

Mean quality by movement: standing 0.81, walking 0.73, sprinting 0.59, running sideways 0.54. (`docs/contact-analysis.txt` is the full output; `test/contact-analysis.test.js` asserts the trends and the same-seed determinism.)

## Feedback

- Impact flash: bright white for perfect, yellow for clean, amber for early/late/stretched, small dull red for poor.
- Label next to the player (`PERFECT`, `CLEAN`, `Stretched`, ...), colour-coded.
- Sound: hit sounds change with the label (see `docs/MANUAL_TEST_CHECKLIST.md`, audio pass: not yet judged by a person).
- The timing ring is centred on the ball and is only a ring: it does not hide the ball.

## Known discrepancy: animation versus the authoritative hit

The swing animation plays keyframes over 0.42 s with the racket "contact" pose at about 0.17 s. The authoritative contact can happen between 0.05 s and 0.38 s after the press, because it waits for the ball to arrive. So:

- Pressing early: the visible racket may pass the ball position before the hit event fires (the ball then "jumps" at contact).
- Pressing late: the swing can finish while the contact is still pending (the contact window closes at 0.38 s).

Online, the hit event also arrives after the network delay plus the interpolation delay (about 70 ms), while the local swing animation starts instantly. Making the animation phase follow the authoritative event would need the animation to wait for the server's hit event, or the server to return the exact contact time; that is not implemented. Treat any mismatch of a few frames as this known limitation.
