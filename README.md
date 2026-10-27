# PADEL CLUB

Browser-based 4-player online padel. A Node server runs the match (authoritative physics, rules and scoring);
browsers are thin clients that render with Three.js and send inputs.

## Run it

```bash
npm install
npm start            # http://localhost:3000
npm test             # 30 tests: scoring, rules, physics, and 4 real WebSocket clients
```

Requires Node 20+. No build step: the client is plain ES modules served by the same Node process.

## Play with three friends

1. One person opens the game, clicks **Play with friends**. A room code and invite link appear.
2. Friends open the link (or type the code under *Join room*). Everyone lands in a seat; click **Sit here** or let the host **Move** people between Team A and Team B.
3. Non-hosts press **I am ready**; the host presses **Start match**.
4. For friends on other networks the server must be reachable by them: see *Deployment*, or tunnel your local port (e.g. `cloudflared tunnel --url http://localhost:3000`).

**1 vs 1**: in the lobby set *Mode* to *1 vs 1* (host). Two seats on a narrower 7 m court closed by glass walls on all sides (the ball plays off the glass like in doubles); bots fill the free seat.

**Career**: three seasons of tournaments (knockout draws and group stages, singles and doubles) against 16 named characters with their own playing styles. The matches you do not play are simulated with the same engine, so brackets and the world ranking are real. Earn ranking points, coins and development points; complete objectives to unlock rackets; use the Training tab for drills and the Development tab to improve nine attributes (small bonuses, solo only). Progress is saved in your browser.

**Off-court play (2v2)**: each side wall has two access doors near the net. If the ball bounces and then leaves through a door, chase it outside and return it along the strip and in through the other door.

**Bot levels**: Rookie, Club, Pro, Legend (pick them on the home screen, in the lobby, or via the career stage). Higher levels react faster, cover more ground, aim for open space and the lines, and mix globos, dejadas, slices and spin serves.

**Public rooms**: the host can set *Room visibility → Public* in the lobby; open lobbies appear under *Rooms* on the home screen for one-click joining.

**Courts and equipment**: three environments (Premium Indoor Club, Mediterranean Court, Night Arena), chosen by the host in the lobby or on the home screen for solo play; the turf differs slightly (outdoor is a few percent slower). *Equipment* lets you pick one of 4 player archetypes, hair, skin and one of 8 cosmetic rackets, with a live 3D preview. Your look is shown to the other players. See DEV_CHECKLIST.md for what is and is not done.

**Cameras**: Settings has four presets (player, broadcast, tactical, custom). **Racket contact**: the face angle comes from swing timing and the strike point from the distance to the sweet spot, so timing and positioning change the arc, spin, pace and accuracy of each shot. **Audio**: distinct shot sounds, court-specific rooms and ambience, optional announcer.

**Practice vs AI** starts a room with you and three bots. Empty seats are only ever filled by clearly labelled AI.

### Controls
Open **Settings → Controls → Configure** to pick a scheme (Classic keyboard, Keyboard + mouse aim, Gamepad, Custom), rebind every action (keyboard, mouse or gamepad), tune the stick, and test your inputs live. Defaults:

| Input | Action |
|---|---|
| W A S D | Move (camera-relative; W = toward the net) |
| Space | Hit / serve (press just before the ball reaches the ring around your feet) |
| Arrow keys | Move (same as WASD). You are planted while swinging, and the direction you hold at contact is where the ball goes (left/right, up = deep, down = short); the mouse does not aim (left click hits, right click = globo) |
| G / Enter | Globo (lob) |
| R | Slice: backspin, skids low and slow |
| Q | Chiquita (near net) / dejada (from deep) / **víbora** on overheads |
| E | Block on low balls / **bandeja** on overheads |
| X / Shift | Jump / sprint (stamina) |
| Tab / Esc / 1–4 | Stats / menu / quick chat |

Shot type is chosen from context (ball height, distance to the net, ball side, modifiers): forehand (topspin), backhand, slice, volley, globo, remate (smash), bandeja, víbora, chiquita, dejada, block, serve.

### Ball physics
The ball has real spin: Magnus lift/dive (backspin floats, topspin dives), sidespin curves, air drag, and spin-dependent bounces. Backspin gives a low, slow bounce; topspin kicks forward; víbora sidespin kicks sideways off the glass. The shot solver simulates the real physics and corrects the launch, so the landing spot you aim at stays accurate whatever the spin. Mishit balls carry less spin.

## Architecture

```
shared/    Pure simulation, imported by BOTH server and client
  constants.js  court/physics/player tuning
  physics.js    stepPlayer (also used for client prediction), stepBall, ballistic shot solver
  scoring.js    explicit scoring state machine (points, deuce/advantage/golden point, games, sets, tiebreaks, service order)
  game.js       PadelGame: players, shots, contact quality, padel rules (bounces, glass, net, serve box, faults), stats
  ai.js         doubles bot: predicts the ball, covers its half, picks lobs/smashes/bandejas
server/
  index.js      HTTP static + WebSocket server, fixed 60 Hz loop, rate limiting
  rooms.js      Room lifecycle (lobby → ready → match → results → rematch), reconnect, bot takeover
  store.js      File-backed persistence (guest profiles, XP, match history)
client/
  js/net.js     WebSocket + auto-reconnect, guest token
  js/game.js    input, prediction + reconciliation, snapshot interpolation, camera, event feedback
  js/scene.js   court, glass/mesh, net, procedural player models and animation, ball
  js/ui.js      menus, lobby, HUD, results, settings
  js/audio.js   synthesised sound (no audio files)
```

### Networking model
- Server ticks at 60 Hz and broadcasts compact snapshots at 30 Hz (ball, 4 players); discrete events (hit, bounce, fault, point) are sent reliably.
- Clients send timestamped inputs (`seq`, move axes, aim point, swing/lob/jump/modifier flags). The server validates and clamps everything. It decides every contact, bounce and point; a client cannot submit scores, ball positions or results (unknown messages are ignored; covered by a test).
- The local player is predicted with the same `stepPlayer` and reconciled against the server's acked `seq`. Other players and the ball are interpolated ~100 ms behind.
- Disconnects: a **bot takes over the seat instantly** (the point continues, nobody is stuck waiting); reconnecting with the same guest token returns control. In the lobby a seat is held for 60 s. Rooms with no connected players are removed after 10 minutes.
- Persistence: when the server's own simulation ends a match it records the result, grants XP, and updates profiles.

## What works / what does not (honest status)

Working and covered by tests or verified in a browser:
- Private rooms with codes and invite links, 4 seats, teams, host moves players, ready check, host-controlled format (1 or 3 sets, 2/4/6 games, golden point, AI level), chat + quick chat, rematch without a new room, reconnect.
- Authoritative doubles match with real padel rules and scoring (see `test/`), serve box, faults/double faults, glass rebounds after the first bounce, net, out calls.
- Practice mode vs bots; bots cover for disconnected players.
- Guest profiles with level/XP/win-loss/history (file store); real stats (winners, errors, aces, smashes, volleys, longest rally) from match events.
- Settings: graphics quality, volumes, camera distance/height, ball size, timing indicator, high contrast, fullscreen.

Not built yet (intentionally not faked):
- Public matchmaking / Quick Play, ranked mode, ratings, leaderboards.
- Friends list, presence, voice chat, emotes beyond quick chat, accounts (guests only).
- True racket-face physics: spin is chosen per shot type (and scaled by contact quality), not computed from the racket angle.
- Control remapping, gamepad, training drills (use Practice vs AI), beginner doubles hints, replay/tactical camera.
- Only one environment (indoor club). Players are procedurally animated jointed figures (elbows, knees, torso twist, split-step, head tracking the ball), not imported skeletal models.
- Persistence is a JSON file, not PostgreSQL (`server/store.js` is the only file to replace).
- Not yet load-tested; the game loop is single-process, one Node process hosts all rooms.

## Manual 4-player test checklist
Use four browsers/devices (or three browser profiles plus one incognito window). Replace `HOST` with the host's address.
1. Player 1: open `http://HOST:3000`, enter a name, **Play with friends**. Note the code.
2. Players 2–4: open the invite link. Expect all four names in the lobby, the 5th person gets "Room is full".
3. Host moves someone to the other team; all screens update within a second. Players 2–4 ready up; **Start** stays disabled until they do.
4. Play a point: all four see the same ball path, the same call and the same score.
5. Hit the ball into the glass before it bounces → "Out". Let it bounce twice → point for the hitter. Hit the net → "Net".
6. Close one tab mid-point, reopen the site (same browser): you rejoin the same seat; meanwhile a bot covered.
7. Finish a match (use *Games per set = 2*, *Single set*): results screen identical on all clients; **Rematch** restarts without a new room; profile shows XP and history.
8. Throttle one browser (DevTools → Network → Slow 3G) and confirm it stays playable and others are unaffected.

## Deployment
Single Node service + a persistent disk. **Region:** the Blueprint targets Frankfurt (EU). Render cannot change the region of an existing service, so delete the old service and create it again from the Blueprint.
- **Docker** (any container host, Fly.io, Railway, Render, a VPS): `docker build -t padel-club . && docker run -p 3000:3000 -v padel-data:/data padel-club`
- Put it behind HTTPS (the client automatically uses `wss://` on `https://` pages). Your proxy must allow WebSocket upgrades on `/ws` and keep idle connections open > 30 s.
- Environment: see `.env.example` (`PORT`, `DATA_DIR`). No secrets are required.
- Scale-out: rooms live in memory in one process. To scale horizontally, shard by room code at the load balancer (sticky routing) and move `Store` to a shared database.
