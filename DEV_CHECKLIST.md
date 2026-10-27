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
- ✅ Racket contact model (shared/game.js): swing timing sets the face angle (open = higher, slower arc + backspin; closed = flatter + topspin, no net help when very closed); distance from the sweet spot stands for the point on the face (edge hits lose pace and scatter); sideways running costs accuracy, moving into the shot adds pace; the racket meets the ball at the sweet spot instead of the first instant it is in reach. Labels: perfect / clean / early / late / off-centre / poor. Tests in test/contact.test.js
- 🟡 It is a mathematical impact model driven by timing and distance, not a simulation of the racket's real orientation in 3D
- 🟡 Aiming error now depends on contact quality, edge contact and running; the timing window is the same for every shot type
- ❌ Collision sub-stepping / CCD (the 60 Hz step has not shown tunnelling in tests)
- ✅ Off-court play (doubles): access doors in the side walls near the net (1.4–3.0 m from it, 2 m high) lead to a fenced strip along each side. After the first bounce a ball may leave through a door; the receiving team follows it, may let it bounce once outside, and must return it along the strip, round the net post and in through the other door so it lands in the opponents' court (hitting the glass, or landing outside, loses the point). A ball leaving without bouncing is out. Players and bots can walk out only through the doors; 1v1 stays fully walled. Unit-tested (physics, rules, movement, bots)
- 🟡 Off-court play has not been played by a person: bots rarely produce door exits on their own, and the strip is narrow (1.8 m)
- ❌ Stamina effects beyond sprint, player-player collisions beyond teammate separation

## Controls
- ✅ Input module (client/js/input.js): keyboard, mouse buttons and gamepad become actions; 4 schemes (Classic keyboard, Keyboard + mouse aim, Gamepad, Custom); per-device bindings; rebinding with press-to-assign, Esc cancels, duplicate detection resolved by swapping; restore defaults; live input test; controller diagram showing the real mapping; dead zone, response curve, hold/toggle sprint, aim marker on/off; versioned persistence with safe fallback
- ✅ Mouse aiming: ray from the camera onto the court; ring marks the target area and widens when the ball is far from the sweet spot (it is an area, not a guarantee). Off by default: the mouse is never required
- ✅ Right stick (or left stick) places the shot; keyboard steering is resolved by the server at contact
- 🟡 Tested automatically: bindings, conflicts, persistence, corrupt storage, pad reading, capture. Checked in the browser with a SIMULATED gamepad and simulated key events: NOT with a physical controller
- ❌ Mouse wheel actions, pointer-lock cursor capture, separate per-player profiles in one browser, camera presets, power indicator, aim assist

## Career
- ✅ Career v2 (shared/career2.js, client/js/career-ui.js): 3 seasons and 12 events (knockout draws of 4/8, group + final), per-event court and rules, real brackets (matches you do not play are simulated headlessly with the same engine and bots), 16 named characters with playing styles, world ranking vs roster points, objectives (rewards granted once, unlock two rackets), versioned save (padel.career2) that migrates the old ladder save without deleting it
- ✅ Training: 5 drills run on the real game (serve, forehand corner, lob, volley, smash), 3 stars each, development points only for improvement
- ✅ Development: 9 attributes, each level a small bonus (about +1%), applied only to local matches, never online
- ✅ Story: a short scene before and after each of the 12 events (a character speaks; text only, no cutscenes)
- 🟡 Unit-tested logic; only played through in the in-app browser with scripted input, not by a person

## Camera
- ✅ Presets: player, broadcast, tactical, custom (distance, height, smoothing, field of view); optional drift toward the ball; the camera never rotates with the movement keys

## Audio
- ✅ Rewritten engine (client/js/audio.js): a distinct sound per shot type, character changes with contact quality, glass vs mesh, footsteps and skids from the animation, per-court room reverb and ambience (hall / wind and birds / crowd and insects), random variation and rate limits, separate effects / environment / announcer volumes, optional spoken score calls (browser speech synthesis)
- 🟡 All sounds are still synthesised (no recorded samples are shipped). Not listened to by a person in this session: only checked that nothing throws
- ✅ Music: a generative synthesised loop (pad, bass, arpeggio; a light beat in matches), own volume in Settings. Not listened to by a person, and it is synthesised, not composed
- ❌ Recorded effort/celebration sounds, crowd announcements

## Multiplayer, deployment
- ✅ 4-player authoritative rooms, reconnect, 60 Hz snapshots, looks and court synchronised (tests)
- ✅ `render.yaml` targets Render's Frankfurt (EU) region. A service's region cannot be changed once created: recreate the service from the Blueprint.

## Tests
- 97 automated tests: scoring, rules, physics/spin, contact model, singles, career v2 (brackets, migration, rewards), drills, input, looks/courts, 4 real WebSocket clients.
- Manually checked in the in-app browser: menu, equipment screen, the three courts (menu background), a night-arena practice match.
- NOT checked: gamepad, audio, a real 4-human session, mobile, performance on low-end GPUs.

## Ball physics (latest pass)
- ✅ Quadratic air drag on top of linear drag, speed-dependent glass restitution, much deader mesh above 3 m, speed-dependent floor bounce, net-tape cord (pops over with lost pace) instead of always stopping at the tape

## AI, serves, replays, scoreboard (latest pass)
- ✅ Serve timing: the bounce is judged ~0.05 s after the press and only a narrow window around waist height gives a good serve (faster and more accurate); a closing ring shows it (Timing indicator setting). Bots wait for the same window, a tighter one at higher levels, and receivers react to the serve instead of anticipating it
- ✅ Bug fixed: perfectly struck slices and other shots could clip the net (net clearance and landing correction are now solved together)
- ✅ Bots now attack high balls (smash, bandeja, víbora), lob less, and the levels are separated more clearly (checked by simulation: Legend beats Pro, Pro beats Club, Club beats Rookie)
- ✅ Instant replay after each point in solo matches (slow motion, high TV camera, Space/Esc to skip, toggle in Settings). NOT in online matches: the server keeps running, so there is no safe moment to pause
- ✅ Broadcast-style scoreboard: serving ball, set columns, games and points, animated changes, game/set/match point flags

## Courts
- ✅ Fourth court: Sunset Rooftop (skyline with lit windows, string lights, plants, city ambience, slightly quick turf). Selectable on the home screen and in lobbies. A fifth (resort) is not made

## Fixes after play-testing
- ✅ Mouse aim is back as a visible option: Settings, the pause menu, or the M key (target ring follows the cursor, left click hits, right click = globo)
- ✅ Rally length shown after every point (chip under the scoreboard and in the banner)
- ✅ Pausing a solo match now freezes everything (logic and animation). Online matches cannot be paused: the pause menu says so
- ✅ After the last point the ball keeps coasting instead of freezing mid-air
- ✅ Doors are wider (2 m) and marked: glowing frames, lit lintel and a floor mat inside the court
- ✅ Music rewritten (warm pad, soft electric-piano melody, swing, reverb, softer beat). Still synthesised and not judged by a person
- ✅ Match history: every finished match (practice, career, online) is saved in this browser (last 100) and shown under History on the home screen with wins, win rate, streak, best rally and aces. It lives in the browser's storage, so it is per device and is lost if site data is cleared; it is not synced to the server
- ✅ Bots hold their positions after the serve: roles (net / baseline) are fixed when the point starts and only swap after a real lob chase, so the server and receiver stay near the baseline instead of drifting up to the net; default positions are deeper (baseline 7.6 m, net 3.4 m). Checked by simulation (levels still ordered: Legend > Pro > Club > Rookie)
