# Physics calibration report

Generated data: `npm run calibrate` (writes `docs/calibration-output.txt`). Assertions: `test/calibration.test.js`. Scenarios: `tools/lib/scenarios.js`.
Units: metres, seconds, m/s, m/s². The game's spin numbers (`sb` backspin(+)/topspin(-), `ss` sidespin) are **game units, not rad/s**.

## 1. What is measured/standard and what is estimated

| Quantity | Value in game | Status | Source / reason |
|---|---|---|---|
| Court 10 x 20 m, service line 6.95 m from the net, net 0.88 m centre / 0.92 m posts | `COURT.*` | **Standard** | FIP rules, as quoted by several sites: [FIP Rules of Padel](https://www.padelfip.com/wp-content/uploads/2025/12/FIP_Rules-of-Padel.pdf), [LTA rules of padel](https://www.lta.org.uk/490bb5/siteassets/compete/padel/file/rules-of-padel.pdf). A search snippet confirmed the dimensions on secondary sites; the official PDF text was not opened in this session. |
| Walls: 3 m glass + 1 m mesh at the back, 3 m glass / fence at the sides | `WALL_H = 4`, glass/mesh split | **Standard (approximate)** | General court construction; the exact glass/mesh layout of the side walls varies by court. |
| Ball diameter 6.35-6.77 cm, mass 56-59.4 g | `BALL_R = 0.0335` (6.7 cm) | **Standard (secondary source)** | Two secondary sites quote these FIP limits; not verified in the official text this session. |
| Drop test 254 cm -> rebound 135-145 cm | used by the test | **Standard as I recall it, NOT confirmed in this session** | The search did not return this figure. It is the usual ITF/FIP-style ball bounce test; verify against the FIP ball regulation before relying on it. |
| Air drag (felt ball) `Cd = 0.6-0.7` | `PHYS.DRAG2 = 0.0219` (`a = 0.0219 v²`), `DRAG = 0` | **Measured (tennis ball, wind tunnel), applied to a padel ball** | Mehta's wind-tunnel work reports `CD ≈ 0.6-0.7` for new tennis balls for Re 80,000-300,000 ([Mehta, sports ball aerodynamics](https://www.physics.usyd.edu.au/~cross/TRAJECTORIES/Sports%20Balls.pdf)). `0.0219` = `0.5 ρ Cd A / m` with ρ 1.2, Cd 0.6, r 0.0335 m, m 0.058 kg. **A padel ball is not a tennis ball** (smaller, different felt, lower pressure): the true padel value is unknown, so treat this as an estimate. |
| Magnus lift | `PHYS.MAGNUS = 0.012` (per game spin unit) | **Estimate** | Tuned so topspin/backspin visibly dive/float; no padel-ball lift coefficient was found. |
| Floor restitution | `PHYS.FLOOR_E = 0.85` (courts 0.83-0.85) | **Game compromise** | See below. |
| Glass restitution | `WALL_E = 0.82`, minus 1% per m/s up to 20 m/s; friction 0.97 | **Estimate** | Measured values for padel glass were not found. 0.65-0.78 normal restitution results at 4-30 m/s. |
| Fence (mesh) | `MESH_E = 0.34`, friction 0.84 | **Estimate** | A soft, dead response; no measurement found. |
| Spin kick off the glass | `WALL_KICK = 0.11` m/s per spin unit | **Estimate / game tuning** | Direction (topspin climbs, backspin drops) follows contact mechanics; the magnitude is tuned. |
| Rolling resistance | `1 - 0.9 dt` per step | **Estimate** | Gentle slowing of a ball at rest on the floor. |
| Integration | 4 sub-steps per 1/60 s step | **Engineering** | See section 3. |

## 2. Findings (the numbers behind the changes)

1. **The drag was 3-5 times too weak.** At 10/20/30 m/s the old model decelerated the ball by 0.7/2.1/4.2 m/s², a physical estimate gives 2.2/8.8/19.7. Because it is an estimate for a padel ball, the game now uses the physical form (`a = 0.0219 v²`). Effect measured by `npm run bench:bots`: rallies 9.7-17 shots, no NaN states; the solver compensates by launching faster.
2. **The 1/60 s integrator moved the landing point by up to 0.27 m** (25 m/s drive, 10 m flight) compared with a 1/600 s reference, and the floor contact point was snapped to the end of the step (up to 0.4 m late at 25 m/s). Fixes: swept floor contact (exact contact point, remaining time spent after the bounce) and `PHYS.SUBSTEPS = 4`. Remaining difference: 0.05-0.07 m. The shot solver and the game use the same stepping, so they stay consistent.
3. **Drop test.** With the physical drag, a rigid-floor effective restitution of about 0.80 reproduces a 1.40 m rebound from 2.54 m (the drop happens in air). The game's turf values (0.83-0.85) give 1.5-1.6 m: **a deliberate gameplay compromise** (the owner asked for a livelier bounce; padel turf with sand infill is in reality *less* lively than a rigid floor). The tests keep this departure visible (`dropRebound(courtE) > 1.45`).
4. **Glass.** Normal restitution 0.78 (4 m/s) -> 0.65 (>= 20 m/s); the tangential speed is kept (0.96-0.97) so shallow shots slide along the glass; the reflection angle is always flatter than the incidence angle.
5. **Fence.** `e_n ≈ 0.30`, tangential 0.83: ball dies against the mesh.
6. **Net.** Blocked below the tape (0.85 m), passes at 0.95 m and above; at 0.90 m the tape can pop the ball over ("cord").
7. **Many collisions.** A 45 m/s corner shot produces 10 collision events, stays finite and never gains energy.
8. **No tunnelling.** 3,000 random shots up to 50 m/s never ended outside the walls/floor, never produced NaN (the boundary code clamps at the plane, and the net uses a crossing test, not a thickness test, so sub-stepping was added for accuracy rather than for tunnelling).
9. **Shot solver.** All 300 generated shots returned finite launches; drives, volleys, slices, blocks and smashes land within 0.3 m median / 0.7 m (95th percentile) of the requested point (after each shot's own depth clamp). **Known limit:** a flat drive from the back wall asked to land 3 m past the net cannot clear the net and land that short; it lands about 2.4 m long. The solver never bypasses a collision: every correction is checked with the real physics (`simulateShot`) and net clearance is only *assisted* for well struck balls (`q`, face angle), never granted to poor contact.

## 3. Gameplay compromises (intentional departures from real physics)

- Floor restitution is higher than a real padel court (livelier bounces, owner request).
- Spin is a single scalar pair in game units, not a 3D angular velocity; spin decay and wall kick are tuned.
- The racket contact is a quality scalar (`q`), not a simulated racket face (see README, "Contact").
- Players are circles with a reach radius; the ball is a point-mass sphere without a deformation model (the squash on screen is cosmetic).
- Net posts and the net band's thickness are not collision objects: the net is a plane with a height profile.

## 4. How to recompute

```
npm run calibrate           # prints the report and refreshes docs/calibration-output.txt
node --test test/calibration.test.js
```
