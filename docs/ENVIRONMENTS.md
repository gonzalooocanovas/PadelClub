# Night Arena and Mediterranean Club: audit, what was built, measurements

Environment ids are unchanged: `night` is the Night Arena and `outdoor` is the Mediterranean Club (the home screen, lobbies, career stages and the server keep using the same ids). `indoor` and `rooftop` were not redesigned.

## 1. Audit (before)
- `client/js/envs.js` builds the surroundings only; each builder returns `{ group, light, turf, ads }` and `World.setCourt(id)` (client/js/scene.js) swaps `envGroup`, calls `applyLight` (sky colour, fog, hemisphere light, the one shadow-casting sun, exposure), `setTurf` and `buildAds`. The playing area (turf, glass, mesh, net, doors, pit strip) is built once by `World.buildCourt()` and is not touched by environments, so no collision geometry is shared with the scenery.
- Night (before): a black box with a flat sign wall, stands made of capsule "people" in candy colours on box steps, four floodlight "towers" with glowing rectangles, a black background. Mediterranean (before): a long cream wall with arches, cartoon palms and spheres for olive trees, terracotta tiles, flat green hills.
- Camera visibility: the near back wall is hidden by `World.render` when the camera is behind the baseline; environments must not put anything on those camera lines (nothing tall was placed within the court footprint or directly behind the baselines).

## 2. Night Arena (`client/js/envs-pro.js`, `nightArena`)
- Stands: four structured banks (6/6/8/4 tiers of 0.42 m x 0.85 m, dark steel supports, front balustrades, aisles every 13 seats), instanced seats in navy sections, 70 % occupied by seated spectators (muted clothing, six skin tones, mixed sizes): **two instanced meshes for the whole crowd**. Still hops when the crowd cheers.
- Venue shell: concrete facades with pilasters, LED edge lines, a faint spill of light up the walls, sponsor bands, two player tunnels, a framed tournament display (a static graphic, not a live score), LED boards along the stand fronts, cantilever roofs with LED lines over the far and side stands.
- Lighting: four masts (19 m) with real housings (frame, 12 lamp units each, reflector rings, emissive lenses in one instanced mesh, glare sprites) placed beyond the stands; four spot lights (no shadows) light the court evenly, two weak point lights wash the stands, the single sun light (cool, 0.9) casts the shadows. Dominant look: dark navy surroundings, neutral-white floodlights, blue court.
- Sky and distance: a navy gradient dome with a lighter horizon, 500 faint stars, a ring of 70 distant venue silhouettes with ~320 sparse warm windows, four red aviation lights. (Standard gameplay cameras look down into the bowl, so the sky is rarely on screen.)
- Reflections: the glass and the frame use a baked night reflection map (dark dome with four bright rectangles) so highlights look like floodlights; the frame is powder-coated anthracite.

## 3. Mediterranean Club (`mediterraneanClub`)
- Golden hour: warm low sun from the side (elevation about 17°, intensity 3.1, colour 0xffc78a), cool-blue sky fill with warm ground bounce, warm haze fog, a sun glow and a pale-blue-to-warm sky gradient. The court keeps its blue.
- Architecture: a clubhouse along the far baseline: limestone plinth, cream stucco ground floor and a set-back upper floor, slab overhangs, terracotta cornice, five deep glazed openings with limestone reveals, bronze mullions and a warm interior, a continuous upper glazing band with a vertical timber screen, a covered terrace on slim columns, rooftop pergola, terracotta accent wall with club sign, wall lights; a low near-side service building with timber doors; limestone boundary walls.
- Ground: limestone paving slabs (instead of terracotta tiles), raised beds with lavender and ornamental grasses, shrubs, planters.
- Landscaping: **six reusable plant models** (3 olive variants with twisted limbs and silver-green leaf puffs, 2 cypress variants, a palm, 2 shrub variants, lavender, grass), placed as InstancedMesh with random scale, rotation and tint; olives and cypresses stand beyond the side walls and behind the clubhouse line, never between a camera and the court.
- Furniture: four timber benches on dark metal legs, a water station, a racket rack with rackets, 14 path lights (instanced), timber pergolas on both sides that throw their shadows over the outer court, five guests on the terrace.
- Distance: three layers of hills in receding haze, a strip of sea, a sun glow.
- Frame: dark bronze.

## 4. Shared (court) refinements
Glass: more reflective in moderation (`envMapIntensity 1.6`); frame colour, metalness and roughness follow the environment (`light.frame`); glass clamps at the side-wall seams (one InstancedMesh; none on the near back wall, which the camera logic hides, because loose clamps would be left floating); turf texture with wear near baselines and the net, sand infill speckle and fibre strokes.

## 5. Measurements (this machine: 12th Gen Intel i7-1255U, Intel Iris Xe, 1024x768 canvas, Chromium in the app's browser pane)
Per rendered frame (60 frames, synchronous, includes `gl.finish`, so CPU and GPU time together):
| Environment | ms per frame | draw calls | triangles | lights | instanced items |
|---|---|---|---|---|---|
| indoor (unchanged) | 5.0 | 442 | 163,674 | 2 | 228 |
| Night Arena | 4.5 | 441 | 604,774 | 8 | 2,702 |
| Mediterranean Club | 4.4 | 488 | 227,122 | 2 | 247 |
The browser pane was hidden while measuring, so requestAnimationFrame timing is not meaningful and the numbers above are the synchronous ones. Four active players are in the scene in all three rows. Not measured: low-end GPUs, integrated graphics at 1080p, mobile.
Resource cleanup: 24 environment switches over four environments: the scene graph stays at 596 objects and GPU geometry/texture counts stay flat (a leak of 5 geometries and 1 texture per Night switch, from the reflection-map bake, was found by this test and fixed).
Tests: `test/env-kit.test.js` (7 tests: seeded randomness, finite and painted plant geometry with a triangle budget, cypress tall and olive wide, seating bank layout and no seat inside the court, spectators instanced and registered for the cheer animation, floodlight aim and lens count, disposal).

## 6. Visually inspected
Both environments, in the running game, from the player, broadcast, corner, side, first-person, wall and tactical camera settings (screenshots), with the ball and the four players visible; no floating objects or gaps were seen in those frames. One bug found and fixed in that pass: floating black glass clamps on the near wall. Not inspected: every combination of 1v1 courts, the rest of the camera angles during off-court play, high-contrast mode, low graphics quality.

## 7. Limits
- Procedural geometry and textures only (no external assets, no Blender): the architecture is layered boxes with reveals and details, not sculpted, and plants are low-poly. Reference sites were used as direction only (not opened in this session; the descriptions come from the brief).
- The Night Arena sky and distant skyline are rarely on screen with the standard cameras.
- Spectators are static silhouettes (they hop when the crowd cheers; no other animation). The tournament display is a static graphic.
- Only the sun casts shadows (the floodlights and washers do not); pergola and tree shadows exist in the Mediterranean club but were not judged closely.
- The clubhouse upper floor and roof are mostly out of frame from the player camera.

## 8. The two remaining courts (`client/js/envs-pro2.js`)
- **Premium Indoor Club** (`indoor`): a hall with a far wall of merged timber acoustic slats between dark piers and a lit club logo, a glass curtain wall on the left with bronze mullions, dusk sky and stone planters with shrubs, a lounge mezzanine on the right (glass balustrade, low seating in warm colours, a few guests), a ceiling with trusses every 5 m, timber baffles and five long LED lines, hanging banners, polished-concrete surround, two soft spot lights and one shadow-casting key light.
- **Sunset Rooftop** (`rooftop`): a roof slab with a glass balustrade and steel rail, timber deck either side of the court, lounge sofas and low tables, planters with small olive trees, ornamental grasses along the rail, a water tank and antenna masts with red lights, string lights on slim poles (bulbs instanced), a layered dusk skyline of 120 distant towers with about 900 warm windows, a low sun with glow, a pink-to-gold sky.
- Wired like the others (`envs.js` falls back to the old builders if the new ones throw). Seen in the running game from the player and broadcast cameras only; not measured separately, not judged from the other cameras, and the rooftop court reads a little darker under the warm light than the others.
