# The owner's character model: what the file is, how it is animated, what is missing

Source of truth: `client/models/source/output_mesh_pbr.glb` (a byte-for-byte copy of `output_mesh_pbr.glb`; never modified, loaded as it is).

## 1. What the file contains (inspected)
- One node (`Mesh_0`), one mesh, 53,552 triangles, one PBR material (base colour, normal and metal-rough textures), double-sided.
- **No skeleton, no skin, no joint indices, no weights, no animation clips.** Attributes: POSITION, NORMAL, TEXCOORD_0 only.
- 1.90 m tall (y from -0.952 to +0.950, so the pivot is at the middle of the body, not at the feet), faces +z, standing in a clean A-pose, empty hands. Width 0.89 m, depth 0.35 m.

So it **cannot be animated directly** with an `AnimationMixer`, and rotating the whole mesh would not give running or a swing.

## 2. Is there a rigged version of this exact model?
Not in the project and I could not produce one with an outside service: Mixamo needs your Adobe login (I do not log in or create accounts for you). The honest status:
- **A genuine rigged file does not exist yet.**
- What is implemented instead is a skeleton **generated in code for this exact mesh** (`client/js/skin.js`): 19 bones placed from joint positions I measured on front and side renders with a grid; per-vertex weights from the nearest bone capsules, smoothed along the mesh edges; the mesh is re-posed into a straight standing neutral pose; feet are put on the floor under the pelvis. It is a real `SkinnedMesh` with a real `Skeleton`, weights and bind pose, created at load time. The original file is not touched.
- Its quality was checked by looking at stills (below). It is not a hand-weighted production rig (no finger bones, no twist bones, no facial rig).

## 3. Optional upgrade: a Mixamo rig (manual steps, needs your account)
1. Mixamo does not take `.glb`. The file must be converted to `.obj` + textures or `.fbx` first (no Blender needed: ask me and I can export an OBJ with the three textures from the browser, or use any online glTF-to-FBX converter).
2. Go to mixamo.com, sign in with an Adobe account, **Upload Character**, choose the file, place the markers (chin, wrists, elbows, knees, groin) and let it rig. Mixamo works best with an A/T-pose and separated limbs, which this model has.
3. Download the rigged character **with skin**, format **FBX Binary (.fbx)**, "T-pose" pose, and then download the animations you want (Idle, Walking, Running, Strafe, Backwards run, a tennis forehand/backhand/serve if available) **without skin**.
4. Put the files in `client/models/rigged/`. `three/examples/jsm/loaders/FBXLoader.js` (and `libs/fflate.module.js`) are already in `node_modules`, so FBX can be loaded; it has to be inspected first (skinned mesh, bones, weights, bind pose, clip names) before anything is switched. I would then add a `clip` mode next to the generated-skeleton mode and map Mixamo clip names to the states below. Padel-specific strokes do not exist in Mixamo's library, so forehand/backhand/volley/overhead/serve would still use the pose system or the closest tennis clips.

## 4. How it is animated now
- `client/js/statue.js`: loads the source file, builds the `SkinnedMesh`, scales it uniformly once (1.82 m, scale 0.957), puts the feet on the floor, attaches the racket mesh to the right-hand bone, adds the team ring and shadow. Falls back to the procedural athlete if the file fails to load (error logged, shown in the debug panel).
- `client/js/skin.js`: skeleton, weights, neutral pose, and `skinFollow()`, which converts the pose that `scene.js` computes for every player (idle sway, run cycle, lateral shuffle, braking, split step, jump, every shot) into bone rotations. The spine, neck and shoulder girdle share the rotation between several bones; the wrist bone keeps the racket face square to the net.
- `client/js/anim-state.js`: the named state of every player, derived only from data the game already has (velocity, swing time, shot kind, jump): `idle, walk, run, backward, lateral, turn, jump`, and for shots `prep / swing / follow` with the shot name (`forehand, backhand, volley, overhead, serve, lob, bandeja, vibora, slice, chiquita, drop, block`), then `recovery`. A locomotion change needs 0.12 s of consistent input (no flicker). It does not move anything: movement stays server-authoritative, there is no root motion, scoring and physics are untouched.
- Used for the **agile archetype only** (the default first character). The other archetypes remain procedural until this one is approved. Setting "My 3D character model" turns it off.

## 5. Clips
**The file contains none.** There are no animation clips to list. Every state above is produced by the existing pose maths (keyframed poses blended over time), not by clips; "crossfade" is that blend (the debug panel shows the blend progress). No state is faked with a generic clip.

## 6. State status
| State | Works | How verified |
|---|---|---|
| idle / ready | yes | stills + in a running match |
| walk, forward run | yes | stills (run stride from behind and side) |
| backward, lateral shuffle | yes | lateral still; backward not looked at separately |
| direction change (turn) | state exists and is unit-tested | not looked at as a still |
| forehand, backhand | yes | stills at prep, contact, follow-through |
| overhead (smash) | yes | stills |
| volley, serve, lob, bandeja, vibora, slice, chiquita, drop, block | pose keyframes exist | **not looked at individually** |
| recovery | state exists, pose eases back to ready | unit-tested; not looked at |
| racket in the hand | yes: attached to the right-hand bone | stills; the hand is open (the mesh has no gripping fingers) |

## 7. Debug mode
`?debug=1` or `F3`: the panel lists, for every player, the model type, state label, state changes, clip (pose-driven), blend progress, skeleton (bone count), racket attached or MISSING, scale and yaw, and whether the model file loaded or failed. Off in normal play.

## 8. Limits and what was not done
- No real rig file, no Mixamo, no clips (see section 3).
- Hands stay open; fingers and face do not move; the mesh has no hand bones for gripping.
- Not tested: a networked match with this character, a four-human match (the three other players are procedural by design), long play sessions, mobile.
- Foot placement while running is approximate (leg length of the model, 0.79 m, differs slightly from the procedural rig, 0.88 m).
