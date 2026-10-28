# Camera presets: purpose and what was actually checked

Cycle with `C` in a match, or Settings > Camera. Movement keys stay relative to your side of the court in every preset (W always moves toward the net).

| Preset | Purpose | Automated audit (solo practice, hard bots, indoor venue, 5-6 s each) | Visual inspection |
|---|---|---|---|
| player | default, behind you | ball on screen 100% of frames; max camera step 0.02 m/frame; ball hidden behind a player in ~39% of frames (the ball is often behind the nearest player when seen from behind: normal for a behind-the-player view) | not inspected one by one in this pass |
| first | over the shoulder | ball on screen 100%; max step 0.59 m/frame (point resets); behind a player 3% | not inspected |
| wall | low behind your own glass: watch wall play | ball on screen 95% (a high lob near the camera leaves the frame); behind a player 13%; the preset switch itself is an instant 28 m jump (see below) | **inspected once** (screenshot): low view through the glass, the near back wall is hidden; doors visible |
| corner | high from a back corner | ball on screen 100%; the camera never moves; behind a player 0% | not inspected |
| side | television side line | ball on screen 100%; max step 0.1 m; behind a player 0% | not inspected |
| broadcast | whole court, high | not audited in this pass | not inspected |
| tactical | overhead | not audited in this pass | not inspected |
| custom | your own distance/height/smoothing/fov | not audited | not inspected |

How the audit works: `window.__audit(cam, ms)` (paste `tools/camera-audit.js` into the browser console during a solo match) drives a real-time solo match with a bot as player and, every frame, projects the ball to the screen, records the camera displacement and tests whether a player's torso is within 0.45 m of the camera-to-ball line. It measures geometry, **not** how pleasant the view is.

## Transitions

- Switching presets keeps the camera position and eases toward the new one (the 28 m "step" in the table appeared only because the audit script reset the camera position on purpose).
- After an instant replay the match camera now eases back from the replay camera instead of jumping (fixed in this pass).

## Not verified

- Every other court (outdoor, night, rooftop) with every preset; singles; the camera during off-court play; the custom preset; the ball's contrast against each background with the real eye. These are on the manual checklist and are **not** marked as done.
