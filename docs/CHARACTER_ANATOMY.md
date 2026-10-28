# Character anatomy: diagnosis, proportions, what was changed

Measured with `tools/character-measure.js` on the real geometry in the neutral pose (all joints at zero, hips 0.98 m) and looked at with `tools/pose-strip.js` (same camera, character and pose before and after). Metres.

## Diagnosis (before)
| | agile (m) | all-rounder (f) | power | defender (f) |
|---|---|---|---|---|
| total height | **2.03** | 1.91 | **2.17** | 1.85 |
| heads tall (hair included) | 7.1 | 6.5 | 6.6 | 6.9 |
| shoulder joint width | 0.42 | 0.36 | 0.53 | 0.37 |
| hip joint width | 0.19 | 0.18 | 0.21 | 0.18 |
| hip height / total | 47.7 % | 47.7 % | 47.2 % | 47.3 % |
| shoulder-to-wrist | 0.66 | 0.62 | 0.70 | 0.59 |

Root causes, in order of weight:
1. **Scale.** The built character is 1.99 m before its archetype scale (0.92–1.08), so players were 1.85–2.17 m tall, while all the widths (limbs, pelvis, chest) were drawn for a ~1.7 m person. Result: tall and thin. The model is not stretched by a parent transform: `root.scale` is uniform and the animation rotates joints only (checked: no non-uniform scaling anywhere in `scene.js` or `characters.js`).
2. **Thin, disconnected volumes.** Narrow pelvis (a hollow shell), thighs as separate tubes with large gaps between them, a calf muscle bulge that was strongest at the knee (so the knee read as a ball), shorts hems wider than the thighs, boxy chest (depth factor 0.7), thin upper arms, tiny hands, small shoes.
3. Camera perspective (52° vertical FOV, close to the player) exaggerates the legs of the nearest player a little; not changed (gameplay camera), recorded here as a contributing factor.
4. Not the cause: the skeleton positions, the animation retargeting (procedural poses drive the same joints the mesh hangs from), or an imported model (the default characters are generated in code).

## Changes
- `shared/looks.js`: heights 0.905 / 0.845 / 0.965 / 0.86 (1.80 m, 1.68 m, 1.93 m, 1.72 m); shoulder/build/limb multipliers raised for the three slimmer archetypes (a lean build, not a thin one); head multipliers lowered so the head-to-body ratio is about 7.3–7.7 heads.
- `client/js/characters.js`: new `muscle()` limb builder (smooth belly, no bulge at the ends so joints stay continuous); pelvis rebuilt wider and deeper with glutes; hip spacing 0.108; fuller thighs (r 0.118), calves (0.068 with belly), upper arms and forearms; deltoids and trapezius; deeper chest (0.8 depth) with a stronger shoulder-to-waist taper; shorter, thicker neck; bigger hands (palm plus fingers) and shoes; shorts that hug the thigh instead of hanging as boxes; knee and elbow spheres reduced so they fill the bend instead of showing as balls.
- No bone was scaled and nothing was scaled non-uniformly: the joint pivots (hips, knees, shoulders, elbows) are the same, so every animation state, the racket attachment, AI, multiplayer and character selection are untouched.

## After
| | agile (m) | all-rounder (f) | power | defender (f) |
|---|---|---|---|---|
| total height | 1.80 | 1.67 | 1.93 | 1.72 |
| shoulder joint width | 0.41 | 0.37 | 0.50 | 0.39 |
| hip joint width | 0.20 | 0.18 | 0.21 | 0.19 |
| hip height / total | 47.9 % | 48.0 % | 47.4 % | 47.6 % |
| shoulder height / total | 79 % | 79 % | 78 % | 79 % |

(Head ratio was re-measured after the last head-size change only through the numbers in the script; see the test run below.)

## Is it 3D, rigged, and was deformation checked?
Yes: real 3D meshes (lathe, ellipsoid and cone geometry), hierarchical rig of jointed groups (hips > spine > shoulders > elbows; hips > thighs > knees > feet) driven by the pose maths in `scene.js`. These are rigid-body segments (no skinning), so there is no skin deformation; joints are covered by spheres. Looked at as stills from the rear and side in: neutral, ready stance, forehand and backhand preparation and contact, overhead smash, forward run, lateral shuffle (male and female). Not looked at: deep defensive crouch and recovery as separate stills, all courts, all hair styles.

## Limits
- Leg length is 48 % of height (a real adult is ~52 %): lengthening it needs changing the hip-height constants the movement animation uses (`0.88`, `0.1` in `scene.js`); not done to avoid breaking the animation.
- Still a stylised segmented body, not a skinned human mesh. A real skinned athlete needs a pre-rigged asset (for example from Mixamo); the scanned models in `client/models` were set aside because they could not be re-posed without tearing.
- Fingers do not move; the face is made of simple shapes.
