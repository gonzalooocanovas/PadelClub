# PADEL CLUB 2.0: development checklist (honest status)

Legend: ✅ done and tested · 🟡 partly done · ❌ not started

## Assets and visuals
- ✅ 4 character archetypes with distinct silhouettes (height, shoulders, build, limbs), blue and red kits, 7 hair styles, 5 skin tones, shirt textures, shoes, wristbands, numbers: `client/js/characters.js` (procedural meshes, not GLB: there is no Blender in this environment)
- ✅ 8 padel racket models (teardrop / round / diamond heads, bevelled frame, real see-through perforations, throat bridge, wrapped grip, cord): `buildRacket()`
- ✅ Ball model with seams, spin-driven rotation and trail
- ✅ 3 environments: Premium Indoor Club, Mediterranean Court (outdoor), Night Arena: `client/js/envs.js`
- ✅ Court selection (lobby for hosts, home screen for solo, career stages carry a court); server validates and sends the court to all clients
- ✅ Equipment screen with live 3D preview, persisted in the browser and sent to the server so other players see your look
- 🟡 Court surface physics: three documented surfaces (indoor/night fast, outdoor ~2-3% slower bounce and speed). Glass/mesh acoustics are not modelled.
- ❌ GLB/glTF pipeline, texture compression, level of detail, loading screen with progress

## Animation
- ✅ Jointed rig, shot-specific keyframes, kinetic chain, split step, run cycle, braking lean, landing, celebration/disappointment, ball tracking
- 🟡 Racket contact alignment: contact keyframe sits in the server's contact window; the hit is still decided by the server and the animation is not re-timed to the exact contact tick
- ❌ Skeletal clips, inverse kinematics for feet and hands

## Physics and gameplay
- ✅ Spin (Magnus), drag, spin-dependent bounces, shot solver that compensates spin and drag, per-shot spin and speed profiles
- ❌ Racket-face contact model (open/closed face, edge hits, swing velocity); spin is still chosen per shot type
- ❌ Honest aiming error model beyond contact quality; contextual timing windows per shot type
- ❌ Collision sub-stepping / CCD (the 60 Hz step has not shown tunnelling in tests)
- ❌ Off-court play (openings, chasing balls outside the court)
- ❌ Stamina effects beyond sprint, player-player collisions beyond teammate separation

## Controls
- ✅ Input module (client/js/input.js): keyboard, mouse buttons and gamepad become actions; 4 schemes (Classic keyboard, Keyboard + mouse aim, Gamepad, Custom); per-device bindings; rebinding with press-to-assign, Esc cancels, duplicate detection resolved by swapping; restore defaults; live input test; controller diagram showing the real mapping; dead zone, response curve, hold/toggle sprint, aim marker on/off; versioned persistence with safe fallback
- ✅ Mouse aiming: ray from the camera onto the court; ring marks the target area and widens when the ball is far from the sweet spot (it is an area, not a guarantee). Off by default: the mouse is never required
- ✅ Right stick (or left stick) places the shot; keyboard steering is resolved by the server at contact
- 🟡 Tested automatically: bindings, conflicts, persistence, corrupt storage, pad reading, capture. Checked in the browser with a SIMULATED gamepad and simulated key events: NOT with a physical controller
- ❌ Mouse wheel actions, pointer-lock cursor capture, separate per-player profiles in one browser, camera presets, power indicator, aim assist

## Career
- 🟡 8-stage ladder with named opponents/partners, stars, XP, per-stage court and looks, progress saved in the browser
- ❌ Seasons, calendar, tournament brackets, training drills, player attributes, objectives, narrative, versioned save migration

## Audio
- ❌ Sample-based audio library (audio is still synthesised with Web Audio), per-court acoustics, separate music/commentary volumes

## Multiplayer, deployment
- ✅ 4-player authoritative rooms, reconnect, 60 Hz snapshots, looks and court synchronised (tests)
- ✅ `render.yaml` targets Render's Frankfurt (EU) region. A service's region cannot be changed once created: recreate the service from the Blueprint.

## Tests
- 56 automated tests: scoring, rules, physics/spin, singles, career, looks/courts, 4 real WebSocket clients.
- Manually checked in the in-app browser: menu, equipment screen, the three courts (menu background), a night-arena practice match.
- NOT checked: gamepad, audio, a real 4-human session, mobile, performance on low-end GPUs.
