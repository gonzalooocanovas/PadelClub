# PADEL CLUB: full development briefing (for another AI to read)

**What I want from you (ChatGPT):** read this whole document, then reply with ONE self-contained prompt that I can paste into Claude Code (the AI that has been building this game in my repository). The prompt must improve the game further. Details of the format I want are in section 14. Be critical: sections 10 and 11 list what I know is weak or unverified.

The game owner speaks Spanish; the game UI is in English. The owner is not a programmer and tests by playing.

---

## 1. What the project is

PADEL CLUB is a real-time **online multiplayer padel game** (2 vs 2, also 1 vs 1) that runs in the browser.

- **Server**: Node.js 20+/24, ES modules, `ws` WebSocket library. Authoritative: the server runs the simulation at **60 Hz** and broadcasts snapshots every tick.
- **Client**: plain JavaScript modules, **Three.js 0.170** (no build step, no bundler, no framework). The same Node server serves the static client.
- **Shared code** (`shared/`): the game rules, physics, scoring and bot AI. The identical files run on the server, in the browser (solo matches run entirely in the browser, zero latency) and in the unit tests.
- **Deployment**: Dockerfile and `render.yaml` for Render (region Frankfurt). Source on GitHub (`gonzalooocanovas/PadelClub`).
- **Size**: about 10,000 lines of JavaScript, **123 automated tests** (`node --test`), no TypeScript.
- **Tooling constraints of the environment where it is built**: Windows 11, no Python, no Blender (so no GLB 3D models: all characters, rackets and venues are procedural Three.js geometry), Node only.

### Repository layout

```
shared/   constants.js physics.js game.js scoring.js ai.js roster.js career.js career2.js story.js looks.js history.js
server/   index.js (HTTP + WebSocket)  rooms.js (rooms, matches, pause)  quick.js (matchmaking)  store.js (profiles)
client/   index.html style.css js/{main,game,scene,envs,characters,audio,input,controls-ui,ui,career-ui,drills,local,net,settings,preview}.js
test/     scoring game spin singles contact career career2 drills looks input multiplayer openings walls lob serve-shots
          pause positioning quick history story
```

## 2. Coordinate system and court

Metres. `x` across the court (-5..5), `z` along it (-10..10), `y` up. The net is the plane `z = 0`.
Team 0 defends `z < 0` and attacks toward `+z`; team 1 the opposite.

- Court 10 m x 20 m. Net height 0.88 m at the centre, 0.92 m at the posts (it sags).
- Service line 6.95 m from the net. Back walls: 3 m glass + 1 m mesh (anything above 4 m is "out").
- Side walls: **glass in the back 4 m (|z| >= 6), fence/verja (mesh) through the middle**. In 1v1 the court narrows to 7 m and the side walls are glass all along.
- **Access doors** (doubles only): in each side wall, 1.2 m to 3.2 m from the net, 2 m high. Outside each wall there is a fenced strip 1.8 m wide, 18.4 m long. A ball that has bounced once may leave through a door; the receiving team can follow it outside (players may walk out only through the doors) and must return it along the strip, round the net post and in through the other door so it lands in the opponents' court.
- Four venues: Premium Indoor Club, Mediterranean Court (outdoor), Night Arena, Sunset Rooftop. Each has its own turf bounce constants, lighting, crowd and ambience.

## 3. Physics (the part I most want improved by someone who knows the sport)

`shared/physics.js`, fixed step 1/60 s. All units SI.

**Ball (`stepBall`)**
- Gravity 9.81. Drag: linear 0.06 x 0.6 plus quadratic `0.0035 * speed` per second (fast balls slow more).
- Magnus effect: backspin `sb > 0` lifts, topspin `sb < 0` dives (`MAGNUS = 0.012`); sidespin `ss` curves left/right of the travel direction. Spin decays `exp(-0.35 dt)`.
- Floor bounce: vertical restitution per court (0.83 to 0.85) reduced by backspin and slightly by impact speed; horizontal speed kept 0.84 to 0.86 (also spin dependent); backspin halves, sidespin x0.75 per bounce.
- **Two wall materials**: glass restitution 0.82 (minus 1% per m/s up to 20 m/s), tangential friction 0.97; fence/mesh restitution 0.34, friction 0.84. Wall spin: topspin climbs the glass (`vy += -sb * 0.11 * min(1, vn/12)`), backspin drops the ball; the wall strips part of the spin; sidespin kicks the ball along the glass (0.14).
- Net: the ball hitting the net band stops (0.22 rebound); clipping the tape within 4.5 cm may pop it over ("cord") with lost pace.
- Doors/strip: described above; ball inside the strip bounces off its fences.
- Events emitted: `floor`, `wall` (axis, material), `net`, `cord`, `door`, `out`.

**Shot solver (`solveLaunch`, `simulateShot`, `planShot` in `game.js`)**
For every shot the game picks a landing point, a target flight time T and a spin, solves the launch velocity ballistically, then **simulates the real physics** (drag, spin, walls) and iteratively corrects the launch so the ball really lands there, while forcing net clearance for well-struck balls. A poor contact does not get that help.

**Racket contact (`contact()` in `game.js`)**
- Contact is deferred until the ball is within 1.2 m of the player (the "sweet spot") or the swing window is closing.
- Quality `q` (0.3..1) comes from: distance to the sweet spot (0.95 m), ball height, whether the ball is in front, running speed, running away from the ball, then a forgiving remap.
- **Fatigue**: below 45 stamina, `q` drops up to 0.25.
- **Pressure**: reaching the ball at full stretch (including a last-gasp lunge), a ball hit with great pace (>14 m/s) and being on the run reduce `q` (up to about 0.5 in total). So a good volley or a placed ball actually wins the exchange.
- Face angle from swing timing: an open face (early) gives higher, slower balls with backspin; a closed face (late) is flatter with topspin.
- Edge hits lose pace and scatter. Labels: perfect / clean / early / late / off-centre / stretched / poor.
- Bot mishits ("slip"): 60% dive into the net/floor in front, 40% go long.

**Shots**: serve, forehand, backhand, volley, lob (globo), smash (remate), bandeja, vibora, chiquita, drop shot (dejada), block, slice. Each has its own speed, depth range and spin.
- **Lob quality depends on contact**: a clean lob climbs high and lands deep (hard to smash); a poor one is low and short (easy to smash).
- **"Por 4"** (just added): a clean smash (`q >= 0.8`) from near the net, ball above 2.2 m, aimed short (depth <= 4.8 m) comes down steeply (flight time floor 0.13 s) with heavy topspin and bounces out of the court over the fence: a winner. Credited as "¡Por 4!". Bots use it with probability tied to their smash skill.
- **Serve**: the ball bounces in the server's hand (period 1.1 s). Quality depends on the ball height 0.05 s after the press (best at waist height 0.62 m, narrow window). Holding the key charges power for 0.9 s (a tap = normal; full charge = +22% pace, less accurate, **tends to fly long** past the service line). Fault rules, double fault, let-less (a net cord on the serve is a fault).
- The server stays **planted on the line** until the serve is hit; the others are frozen. After a fault everybody returns to their starting place.

**Player movement (`stepPlayer`, shared with the client for prediction)**: run 6 m/s, sprint 8 m/s, acceleration 30, deceleration 38, braking before reversing. Planted while swinging (30% speed). Stamina 100: sprint costs 24/s, **the rally itself drains 1.5/s even standing still** and only recovers between points (13/s); below 45 stamina the player is up to 18% slower. Applies to humans and bots.

## 4. Rules and scoring (`shared/scoring.js`, `game.js`)

Padel scoring: points 0-15-30-40, optional golden point, games to 6 (or configurable), sets, tiebreak, best of 1/3. Serve rotates among all four players (each team alternates its two servers). Server alternates sides. Service box diagonal. Ball must bounce once in the box. Wall before bounce = point lost for the hitter. Ball bounced and then out over the fence = point to the hitter. Second bounce = point to the hitter. Doors rules in section 2.

## 5. Multiplayer (`server/`)

- Rooms with 5-letter codes; host, ready check, team seats, AI fill, public/private, public room list, chat, quick chat, emotes, reconnection (a bot covers a dropped player; the seat is reclaimed on reconnect).
- **Quick match** (`server/quick.js`): queue; four players are matched into a doubles game; after 10 s anyone still waiting plays with bots filling the seats. The home screen shows how many players are online and the queue size.
- **Authoritative server + client prediction**: the client predicts its own player with the same `stepPlayer`, reconciles from snapshots (60 Hz), and interpolates others (0.07 s online, 0.03 s local).
- **Online pause by agreement**: a player requests a pause, every other human must accept (10 s), then the game freezes for at most 30 s or until every human presses Resume; two pauses per player; a disconnected player does not block it.
- Rate limiting, input sanitising, input queue cap, server-side validation of all settings; the client cannot submit results.
- Guest profiles (token in the browser, stored server side): XP, level, match stats.

## 6. Bot AI (`shared/ai.js`) and how it was analysed

Bots produce exactly the same inputs a human client would send (so they obey every rule). Four levels (Rookie, Club, Pro, Legend) with parameters: speed, reaction time, aim noise, reach, flub chance, timing error, aggression, lob/slice/smash mix, serve spin/timing window/pace/risk, planning interval. Six playing **styles** modify these (net player, retriever, power, all-rounder, wild, counter-puncher) and 16 named career characters use them.

Key behaviours:
- **Ball reading**: `predictBall` (full physics incl. walls) every few ticks; the bot goes to **the first point of the flight it can actually reach**, including after a wall rebound. Overheads before the bounce for players who dare.
- **Shot choice**: target x from a score of open space (net players weigh more), change of direction and avoidance of the dead centre; then lob / dejada / chiquita / slice / drive / smash / bandeja / vibora by situation; occasional "por 4" attempts.
- **Doubles positioning model (rebuilt after measuring)**: a team is in mode `D` (both defend from the baseline) or `A` (both at the net), decided once per tick from shared information (incoming lob or deep ball -> D; short ball -> A; our deep lob or short low ball -> A; a poor lob -> D), with hysteresis. One-up-one-back only at the serve and return. Side by side, shifting with the ball. **With a human partner the bot mirrors the human's line** and does not steal balls (needs a 0.9 m advantage).
- Serve: waits for the same narrow bounce window (tighter at higher levels), 2+ s before serving, softer than full pace, avoids the extreme corners.
- Bots tire like humans and save their sprint (>30 stamina).

**Analysis harness results (simulation, bot vs bot)**

| metric | before | after |
|---|---|---|
| pair split one-up-one-back | 58-62% | about 19% |
| both at the net | 6% | about 27% |
| long points with a player glued to the baseline | 15-31% | 0-3% (Pro/Legend) |
| points lost where nobody even swung | 95% | ~15% |
| average rally (Rookie/Club/Pro/Legend) | 4 / 7 / 11 / 31 | about 7 / 8 / 11 / 14 |
| aces (bot vs bot) | 13-26% | 0-3% |
| "por 4" winners per 100 points (Legend / Pro / Club) | n/a | 9 / 5 / 1 |

Level separation over 20 matches each: Legend beat Pro 14/20, Pro beat Club 18/20, Club beat Rookie 17/20.

Bugs found by that analysis (worth knowing about because similar ones may remain): bots lost the target they chose when starting a swing (later inputs were blank) so every shot went to the centre; slices clipped the net because net-clearance and landing correction were solved separately; players never recovered stamina between points; a "flub" meant the bot watched the ball go by and its partner never took over.

## 7. Game modes and meta

- **Quick match** (matchmaking), **private rooms** with friends, **practice 2v2 / 1v1** against bots (solo matches run in the browser, no network).
- **Career v2** (`shared/career2.js`): 3 seasons, 12 events (knockout draws of 4/8, group + final), real brackets (the matches the player does not play are simulated headlessly with the same engine and bots), 16 named characters, ranking points vs roster points, objectives (unlock two rackets), versioned save that migrates the old save, a short story scene before and after each event.
- **Training drills** (5): serve, forehand corner, lob, volley, smash; 3 stars; they run on the real game.
- **Player upgrades**: 10 attributes (speed, power, stamina, groundstroke, volley, smash, lob, reaction, defence, variety), up to level 10 (about +15%). Earned by wins (career, practice vs Club/Pro/Legend), drills and objectives. Apply to every solo match, **never online** (online everyone is equal).
- **Match history** stored in the browser (last 100 matches) with win rate, streak, best rally.
- Equipment: 4 archetypes, 7 hairs, 5 skins, 8 cosmetic rackets (two unlocked by objectives).

## 8. Client: controls, camera, UI, audio, visuals

- **Controls** (`input.js`): WASD/arrows move, Space hits (to serve: hold to charge, release to hit), G/Enter globo, R slice, Q soft (chiquita/dejada/vibora), E controlled (block/bandeja), Shift sprint, X jump, Tab stats, Esc pause, 1-4 quick chat, **M toggles mouse aim** (cursor places the target ring, click hits), **C cycles cameras**. Aim: while swinging you are planted and the direction held at contact decides the shot (left/right = side, forward = deep, back = short), like a tennis game. Remappable bindings, gamepad support (**not verified on a real gamepad**), swap-on-conflict, versioned persistence.
- **Cameras**: player (behind), first (over the shoulder), wall (low behind the glass), corner (high from a back corner), side (TV side line), broadcast, tactical (overhead), custom. (The last four fixed cameras were just added and have **not** been visually verified yet.)
- **Timing aid**: a circle that closes onto the ball (the owner asked for this); PERFECT/GOOD/LATE labels; reach ring; aim reticle with an accuracy ring.
- **Instant replays** after each point in solo matches (slow motion, high TV camera). Not online (the server cannot be paused).
- **HUD**: broadcast-style scoreboard (serving ball, set columns, games, points, game/set/match point flags), rally length chip after each point, stamina bar (amber when tired, red when exhausted), serve charge bar.
- **Visuals**: procedural jointed athletes (kinetic-chain swing keyframes per shot, run cycle, idle, emotes, footsteps), procedural rackets, glass/mesh/net, 4 venues with instanced crowds, ACES tone mapping, PCF soft shadows, optional bloom, auto quality drop if fps < 38.
- **Audio** (`audio.js`, all synthesised with Web Audio, no files): a distinct sound per shot type, glass vs mesh, footsteps/skids from the animation, per-venue reverb and ambience, optional spoken score calls (speech synthesis), **generative music** (pad, bass, electric-piano melody, light beat in matches).
- UI: home, lobby, results, settings, controls, equipment with a 3D preview, career hub/calendar/bracket/training/upgrades, history, quick-match search, pause menu as a hub (settings stay open while paused).

## 9. Development history (in order, with the owner's feedback)

1. Initial build to a master spec: authoritative server, rooms, scoring, bots, Three.js client, tests.
2. The owner asked for better graphics/physics, "realistic" player motion, and the padel shots (slice, bandeja, globo, vibora).
3. Controls without a mouse (Space hits, arrows move), a "closing circle" timing aid, 2K-tennis-style aim (planted while swinging, direction at contact).
4. A real public link (tunnels were unstable; moved to Render, Frankfurt for latency); a server crash fixed.
5. Solo matches moved into the browser because online lag was bad; 1v1 on a narrow fully-walled court; bot difficulty levels; career mode; public rooms.
6. A very large "PADEL CLUB 2.0" overhaul spec (physics/contact model, movement, animation, cameras, controls, career, courts, rackets, audio, VFX, UI, performance, multiplayer integrity, tests, GLB assets). Implemented in phases with an honest status list (`DEV_CHECKLIST.md`). GLB assets impossible without Blender; extra courts, music, off-court play were added later.
7. Spin/Magnus physics, racket contact model, rebuilt audio engine, remappable input/gamepad/mouse aim, camera presets.
8. Career v2, drills, attributes, objectives, rackets unlock.
9. **Off-court play** through side doors; ball physics pass; serve timing, aces fixed, chargeable serve; broadcast scoreboard; replays; music; rooftop venue; career story.
10. Owner's play-testing feedback fixes: mouse aim option back, rally length shown, pause freezes solo matches, doors visible and wider, ball coasts after the last point, match history, bots keep their role after the serve, stamina/fatigue and upgrades, glass vs fence walls and livelier floor, bots change direction in doubles, quick match with online count, contact pressure, lob quality, online pause by agreement, server planted on the line, settings usable while paused, **bot positioning rebuilt from a measured analysis**, positions restored after a fault, power serve can go long.
11. This turn (in progress): "por 4", wall-spin physics, more cameras (the owner defined "por 4" as a volley/smash that sends the ball completely out of the court).

Recurring complaints from the owner (themes): bots positioning and decisions; too many aces; aces/serves too easy or too fast; the AI always hitting through the middle; lobs spammed; things that look "unrealistic" (legs, physics); the game must be based on real padel; fatigue in long points; more wall play; more cameras.

## 10. Known weaknesses and honest limits

- Nothing here has been judged by a human on **real hardware**: gamepad, audio listening (music is synthesised, the owner said an earlier version was "very bad"; it was rewritten but not re-judged), mobile, low-end GPUs, a real 4-human session, the feel of the off-court doors.
- The in-app browser used for checking throttles `requestAnimationFrame` to about 1 fps, so visual checks were done with manual frame stepping and screenshots; real-time smoothness was never measured.
- No real 3D models (procedural only); animation is keyframe/IK-light, not motion capture; no cloth/hair.
- Bots are rule-based, not learned. The owner said bots "se colocan mal", "hacen cosas mal". The positioning was rebuilt from simulation metrics, but only measured bot-vs-bot, not against human playing styles.
- The "wall play" is physical (spin kick, two materials) but bots do not deliberately **play shots off the walls** (bajada de pared, doble pared, contrapared, chiquita to the glass), only react to rebounds. A defending bot does not choose wall plays.
- Doors/strip are narrow (1.8 m) and bots rarely produce door exits.
- The calibration constants (restitutions, friction, Magnus, drag, pace) were tuned by feel and simulation, not against measured ball data. I would like them reviewed against real padel ball physics (Penn/Head padel balls: pressure and bounce height standards, glass restitution, turf friction).
- The career has no cutscenes; story is text only. The career economy (coins) has nothing to buy yet.
- No accounts: history, career and upgrades live in the browser's local storage (per device); only profile XP is on the server.
- Online anti-cheat is basic (the server validates inputs, but a client could send maximum serve charge every time).

## 11. Ideas I have not done (candidates)

Real wall play for bots and a "wall play" teaching drill; lob/chiquita/dejada defence AI; a coaching/analysis mode that shows where you lose points; ELO/ranked online with accounts; tournaments online; spectator mode; replays online with a replay buffer on the server; cosmetics shop using coins; real GLB assets and animation retargeting; better crowd/stadium; more drills and a tutorial; accessibility options; localisation (Spanish UI); mobile/touch controls; performance profile and a benchmark harness; a determinism/desync test for client prediction; telemetry for balance.

## 12. How it is verified (so you can ask for more of the same)

`npm test` runs 123 tests: scoring, rules, physics and spin, shot solver, wall materials and spin kick, lob quality, contact pressure, "por 4", serve timing and power, doors and off-court movement, bot positioning metrics, bot level ordering, career v2 brackets and save migration, drills, quick match and pause (including real WebSocket clients and fake clocks), match history. Simulation scripts (not committed) measured bot-vs-bot statistics (aces, rally lengths, pair positions, why points are lost).

## 13. Files worth reading first

`shared/physics.js` (ball, walls, player movement), `shared/game.js` (rules, contact, shots, serve), `shared/ai.js` (bots), `server/rooms.js` (matches, pause), `client/js/game.js` (prediction, cameras, replay), `DEV_CHECKLIST.md` (honest status of every feature).

## 14. The answer I want from you

Reply with **one prompt**, in English, ready to paste into Claude Code, that:

1. Starts with a short role/context paragraph (it may assume Claude Code can read the repository and this briefing is the owner's summary).
2. Contains a **prioritised list of 8 to 12 improvements** that would most raise quality, realism and fun, each with: the problem, the concrete change, files likely involved, and **measurable acceptance criteria** (for example "average rally 10-16 shots for Pro in 20 simulated matches", "bots choose a wall play in at least 10% of defensive situations", "a unit test that ...").
3. Pays special attention to: (a) **real padel realism** of the ball and wall physics and calibration against real data; (b) **bot tactics**, especially wall play and doubles teamwork; (c) feel and readability of the game for a human (timing, camera, feedback); (d) things I cannot verify myself and how to instrument them (telemetry, debug overlays, benchmark scripts).
4. Says clearly what **not** to do (do not rewrite the architecture, keep the shared deterministic code, keep tests green, no new build step, no external assets that cannot be generated).
5. Ends with instructions to work in small verified steps, run `npm test` after each, update `DEV_CHECKLIST.md` honestly (done / partly / not done), and commit with clear messages.

Be specific and sceptical. If something in this document looks physically or tactically wrong for real padel, say so in the prompt and tell Claude Code how to correct it.
