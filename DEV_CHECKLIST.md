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

## Upgrades and fatigue
- ✅ Fatigue: stamina drains 1.5/s while the ball is in play even if you stand still (sprinting costs extra) and only recovers between points, so long points wear you down. Below 45 stamina you run up to 18% slower, hit with less accuracy and pace, and serve less accurately (everyone, bots too, online as well). The bar turns amber (tired) and red (exhausted). Bug fixed on the way: players did not recover stamina between points before
- ✅ Upgrades: 10 attributes (new Power; Speed +1.5% per level, Stamina = slower fatigue and faster recovery, plus accuracy, spin, reaction…), up to level 10 (about +15%). Available from the Upgrades button on the home screen and the Career > Development tab; they apply to every solo match and never online. Points come from career wins/titles, drills, objectives and practice wins against Club, Pro and Legend bots (+1/+2/+3; nothing against Rookies)

## Serves and aces (latest pass)
- ✅ Bug fixed: bots lost the target they chose when they started a swing (their later inputs were blank), so every bot shot, serves included, went to the default spot (short serves = many aces). They now keep the aim until contact
- ✅ Bot receivers anticipate: they go to the first point of the ball's flight they can actually reach (including after a wall rebound). Aces in bot-vs-bot play dropped from 13–26% to 0–3%
- ✅ Bots wait longer before serving (2+ s, random) so receivers are set, serve with less than full pace and avoid the extreme corners every time
- ✅ Serve: the bounce of the ball in the server's hand is slower (1.1 s per bounce instead of 0.8), and holding the hit key charges serve power (tap = normal, full charge 0.9 s = +22% pace but a less accurate serve); the serve is struck when you release
- ✅ Bot levels retuned after these changes (Legend 9/12 vs Pro, Pro 10/12 vs Club, Club 10/12 vs Rookie in simulation)

## Ball and walls, bot targets (latest pass)
- ✅ Two kinds of wall: glass (back walls up to 3 m, and the back 4 m of the side walls; all of the side walls in 1v1) is hard and lively (restitution 0.82, keeps its speed); the fence/verja (the middle of the side walls and the mesh above 3 m) is soft and dead (0.34, much more friction). The rebound sound uses the real material. Unit-tested
- ✅ Livelier floor: restitution raised (0.85 indoor/night, 0.83 outdoor, 0.84 rooftop) and less loss on hard impacts, so the ball bounces higher and rallies use the walls more
- ✅ Bot targets: in doubles bots now weigh the open space (net players count more), changing the direction of the ball and avoiding the dead centre, so they play cross-court and down the line instead of always back through the middle (landing spots in simulation are about 15% central, the rest spread to both sides)
- Bot levels retuned again after the physics change (Legend 13/16 vs Pro, Pro 15/16 vs Club, Club 15/16 vs Rookie; aces 2–9%)

## Quick match, pressure, lobs, positioning (latest pass)
- ✅ Quick match: a button on the home screen puts you in a queue; four players are matched into a doubles game, and after 10 s anyone still waiting plays with bots filling the empty seats. Shows the queue size and how many players are online (also shown on the home button, refreshed every second); cancellable. Server module server/quick.js, tested with real WebSocket clients and with a fake clock. The first two players matched are team-mates
- ✅ Pressure on contact (everyone: bots, humans, online): a ball reached at full stretch, hit with great pace, or taken on the run is answered with a weaker, shorter, less accurate shot ("Stretched" label), so a good volley or placed ball wins the exchange. A poorly struck ball also carries less pace and falls shorter
- ✅ Lobs: quality depends on contact. A clean lob climbs high and lands deep; a poor one is low and short (about 2.2+ m apex), easy to smash
- ✅ Doubles positioning: bots choose a stance (both back when a lob comes or the rivals attack, both at the net when the rivals are pinned back, otherwise one up one back), move as a pair keeping their width, and shift toward the ball

## Online pause, fixed server (latest pass)
- ✅ Online pause: the pause menu has "Request a pause". The other humans get an Accept / Decline prompt (10 s to answer). When everybody accepts the match freezes for at most 30 s, or until every human presses Resume; a disconnected player does not block it; each player has two pauses per match; with only bots around a pause starts at once. Server-authoritative (Room.pauseCtl), tested with fake clocks and over real WebSockets. Solo matches still pause instantly
- ✅ The server stays planted on the line from the start of the point until the serve is hit (no movement at all), so the serve position is the same every time
- ✅ The pause menu is a hub: Settings, Controls and the rest open on top of it and closing them returns to the pause menu (the match stays paused); only Resume resumes. While paused the view still follows the settings (camera preset, ball size, graphics), so you can preview changes

## Bot positioning, analysed and retrained (latest pass)
Method: a simulation harness measured how bot pairs really move and why they lose points, against how real pairs play.
- Found: 58-62% of the time bot pairs were split one-up-one-back (real pairs are mostly on the same line), both-at-the-net only 6%, and 15-31% of long points had a player glued to the baseline. Worse: in 95% of the points a bot team lost, NOBODY had even swung (the bot that "flubbed" a ball just watched it, and its partner never took over), and 60% of those balls were within reach
- ✅ New doubles model: the pair is on the same line almost always: both defend (baseline) or both attack (net), decided once per tick per team from shared information (incoming lob/deep ball → back; short ball → up; our deep lob or short low ball → up; our poor lob → back). One-up-one-back only at the serve and the return. Side by side, shifting with the ball, each keeping their own side; the player on the ball side takes it. Now (hard): both net 27%, both back 34%, split 19%, nobody glued to either end
- ✅ Mishits instead of passive misses: a flubbing bot still goes for the ball and strikes it badly (into the net or long), so points end in errors rather than in free winners; rallies are now 6.5 / 9.6 / 15.6 / 25 shots for Rookie / Club / Pro / Legend
- ✅ With a person as partner the bot follows THEIR line (up when you are up, back when you are back; back to cover a lob) and does not steal balls that are yours (needs a clear 0.9 m advantage)
- Levels after retuning (20 matches each): Legend beat Pro 15/20, Pro beat Club 16/20, Club beat Rookie 17/20, Legend beat Rookie 20/20
