# The owner's character: files, rig validation, fixes, how it is animated

Files in `client/models/source/` (none of them is ever overwritten; `test/rig-file.test.js` pins the hashes of the first two):
| File | What it is |
|---|---|
| `output_mesh_pbr.glb` | the original static mesh: no skeleton, no clips |
| `output_mesh_pbr_rigged_weighted.glb` | the automatic rig you supplied (22 joints, skin weights) |
| `output_mesh_pbr_rigged_fixed.glb` | **new**: the same mesh with the joints moved onto its anatomy and rebuilt weights (`tools/fix-rig.mjs`) |

## 1. Inspection of the weighted file
- Loads without errors. One `SkinnedMesh`, 22 bones, 32,354 vertices, JOINTS_0 and WEIGHTS_0 present. **Every vertex has valid indices and finite, non-negative weights that sum to 1** (checked in Node: 0 bad). Original materials untouched. 1.90 m, faces +z, pivot at the middle of the body (feet at y = -0.95), A-pose, no animation clips.
- All bind rotations are identity and the inverse bind matrices are consistent with the node transforms, so the file is technically valid.
- **But the rig does not fit the mesh** (inspected with the development-only page `client/dev/rig-inspect.html`: skeleton overlay, weight colouring, per-bone test rotations, front/side/rear views):
  - Joints are generic proportions, not placed on this body: shoulders at y 0.145 where the mesh has them at 0.55, elbows at -0.045 (mesh 0.31), hips at -0.2 (mesh -0.08), knees at -0.54 (mesh -0.43), ankles -0.87 (mesh -0.80). Rotating the arm bone pivots around the waist, not the shoulder.
  - The weights are horizontal slabs (hard bands across the torso, legs cut in blocks).
  - The file's "Left" side is at -x, which is the character's **right** hand (the model faces +z): Left* is the racket side.
- The file is therefore valid but unusable as it is for natural deformation.

## 2. What was corrected (new file, programmatically)
`tools/fix-rig.mjs` (dev tool; needs gltf-transform, which is not a game dependency): moves all 22 joints to positions measured on the mesh (front and side renders with a grid), recomputes the inverse bind matrices, and rebuilds the weights with capsule distance per bone, **a penalty that forbids assigning a vertex to the opposite-side limb**, welding of duplicate vertices and 6 smoothing passes along the mesh edges, at most 4 influences, then validates the written file (0 bad indices, 0 negative, 0 non-finite, 0 unnormalised). Result: `output_mesh_pbr_rigged_fixed.glb`.
Limits: joint positions are estimates from renders (about 1-2 cm); weights are geometric, not hand-painted; there are no finger, twist or face bones.

## 3. Rig inspection results (fixed file, test rotations, front / side)
Spine twist, shoulder abduction, elbow flexion, hip flexion and knee flexion were applied one by one and together: limbs bend at the anatomical joints, no detached or floating limbs, no torso collapse, left and right limbs stay separate. The original weighted file, with the same rotations, bent the arm and leg at the wrong places. Wrist and ankle rotations were exercised through the game's poses (run, strokes) rather than one by one. Extreme overhead arm positions thin the upper arm a little.

## 4. Integration
- `client/js/statue.js`: loads the fixed file, validates it (`validateRig`: skinned mesh, required bones, skin attributes, valid and normalised weights, inverse bind matrices) and rejects it with a logged reason if anything is wrong, which keeps the procedural athlete in use. Each player gets its own cloned skeleton (SkeletonUtils), a single uniform scale (0.957, set once), feet on the floor, team ring, shadow, and the racket mesh on the racket-hand bone (`LeftHand`).
- `client/js/skin.js`: reads the bind positions from the file's own bones, computes the neutral standing pose, and `skinFollow()` turns the pose that `scene.js` computes for each player into rotations of the real bones (the spine, neck and shoulder girdle share rotation). The wrist bone keeps the racket face square to the net. The pose layer is the same one the procedural athletes use, so there is no second animation system and no root motion: the authoritative position and yaw come from the game and only the visual rig is rotated. No `AnimationMixer` is used because **none of the files contains a clip**.
- `client/js/anim-state.js`: named states (`idle, walk, run, backward, lateral, turn, jump, prep, swing, follow, recovery` with the shot name), 0.12 s anti-flicker, unit-tested.
- Agile archetype only. Setting "My 3D character model" turns it off.

## 5. State status
| State | Status |
|---|---|
| idle/ready, walk, forward run, lateral shuffle | works (stills and a running match) |
| backward, direction change, braking | state logic unit-tested; braking lean exists in the pose maths; not looked at separately |
| forehand, backhand, overhead | works (stills at prep, contact, follow-through) |
| volley, serve, lob, bandeja, vibora, slice, chiquita, drop, block | keyframes exist; **not looked at individually** |
| recovery | state and blend exist; not looked at |
| racket | attached to the hand bone; the hand is open (no gripping fingers) |
| foot sliding | not measured; stride is driven by speed in the pose maths |

## 6. Not done / limits
- Networked match and four-human match with this character; stroke timing against the authoritative contact event beyond what the existing pose timing does (the swing animation is pose-timed, the hit itself stays server-side).
- Mixamo or imported clips: none exist, so none are used. The generic tennis clips Mixamo offers would not be padel strokes.
- Other archetypes still use the procedural athletes.
