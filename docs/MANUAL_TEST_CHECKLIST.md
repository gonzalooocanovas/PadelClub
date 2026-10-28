# Manual test checklist

Tick a box only after you have actually done the check. Nothing here was verified by a person at the time of writing: **every box starts unchecked** and the automated tests do not replace it. Record the date and what you saw.

Start the game: `npm start`, open `http://localhost:3000` (add `?debug=1` for the overlay, `F3`).

## 1. Cameras (each preset has a purpose)

Run a 2v2 practice match (Settings > Camera, or `C` in a match to cycle). For **each** preset watch at least one full rally, one lob, one smash, one wall rebound and one net exchange, from both ends of the court (serve from both sides) and once in 1v1.

| Preset | Purpose | Must be true |
|---|---|---|
| player | default: behind you | [ ] ball and the opponents' half visible; ball never stays hidden behind your player for more than a moment; no jitter when you stop |
| first | over the shoulder | [ ] you can follow the ball on lobs; the ball is not hidden by your own racket arm at contact |
| wall | low behind the glass, for wall play | [ ] you can see rebounds off the back glass; the near back wall is hidden when you are behind it |
| corner | high from a back corner | [ ] whole court and both walls readable; no clipping with stands |
| side | TV side line | [ ] the ball is never behind the stands/pergola; depth is readable |
| broadcast | whole court, high | [ ] ball visible at all times (bold size setting if needed) |
| tactical | overhead | [ ] positions readable; the aim reticle visible |
| custom | your own numbers | [ ] sliders work and apply immediately, also while paused |

Camera transitions: switch cameras mid-rally with `C` [ ] no large unexplained jump. Camera settings while paused [ ] still apply (Esc > Settings).
Venues: repeat the ball-visibility check on **indoor, outdoor, night, rooftop** [ ] the ball stands out from every background; [ ] with *High contrast* on it still does.

Reproducible capture: open `http://localhost:3000/?debug=1`, start a practice match, pick the camera, press `F4` to copy a report (it lists camera, venue and quality) and take a screenshot; name files `venue_camera.png`.

## 2. Contact, timing and feedback

- [ ] The closing timing ring is centred on the ball and never covers it.
- [ ] Press Space as the ring touches the inner circle: the label says **perfect**; press clearly early/late: **early/late**; reach for a far ball: **stretched**; hit the edge: **off-centre**.
- [ ] A poor hit shows a small red impact flash and sounds duller than a clean one.
- [ ] Hold a direction as you hit: left/right/forward/back moves the landing point accordingly (shots land where you steer, within a metre or so for a clean hit).
- [ ] Serve: hold Space to charge (bar fills), release to hit; a full charge often goes long; the ring and the bar do not hide the ball.
- [ ] Mouse aim: press `M`, the target ring follows the cursor, click hits; press `M` again to switch off.
- [ ] Known limit: the visible swing and the authoritative contact can differ by a few frames (contact is deferred until the ball is within 1.2 m). Note anything that looks wrong beyond that.

## 3. Off-court rally (at least one complete)

- [ ] 2v2 practice. Hit the ball wide near the net (2 m from the net) so that it bounces and leaves through a door (green frame, glowing).
- [ ] Walk through the door (the gap is 2 m wide), reach the ball, hit it: it should travel along the strip, round the net post and in through the other door, landing in the opponents' court.
- [ ] A ball that leaves without bouncing first counts as out; landing outside after your return loses the point.
- [ ] Walls: a closed part of the fence/glass cannot be walked through.
- [ ] 1v1: there are no doors.

## 4. Audio listening pass (the synthesised sounds have never been judged by a person)

Settings: master 70%, effects 90%.
- [ ] forehand, backhand, volley, slice, lob, bandeja, vibora, smash, serve: each sounds different and plausible
- [ ] floor bounce, glass wall (rings), fence/mesh (dull rattle), net
- [ ] footsteps and skids follow the player's movement and are not too loud
- [ ] point / game / set / match jingles; optional spoken score (Settings > announcer)
- [ ] ambience: indoor hall, outdoor wind/birds, night crowd, rooftop city
- [ ] music: menu and match; no clipping when everything plays at once
- [ ] mute each channel independently (master, effects, ambience, announcer, music) and change venue/scene: the muted channel stays muted
- [ ] a single hit makes a single sound (also right after a pause/resume and during a replay: the replay is silent)

## 5. Online and quick match (needs 2+ people or two browser tabs)

- [ ] Quick match with 1 person: 10 s countdown, then bots fill the seats.
- [ ] Quick match with 2-4 people: they land in the same match.
- [ ] Pause request: the others get Accept/Decline; after everyone accepts the match freezes for at most 30 s; Resume from everyone ends it early.
- [ ] Close one tab mid-point: a bot covers; reopening the tab gives the seat back.

## 6. Career

- [ ] Fresh save (clear `padel.career2` in the browser storage): Career hub shows the next event; the first event is open; later ones show why they are locked.
- [ ] Play an event to the end; the bracket updates; the results screen explains the next step.
- [ ] Training drills show the star thresholds and award stars.
- [ ] Upgrades screen spends points; the bonuses show up in a practice match (and never online).
- [ ] An old ladder save (`padel.career`) is migrated and not deleted.
- [ ] Anything that still needs a person: replaying all three seasons by hand (the automated test plays them with scripted results).

## 7. Performance (on your own devices)

- [ ] `F2`: frame p95 below about 20 ms on your machine at your usual quality; note the device.
- [ ] Low-end devices and mobile have **not** been tested.
