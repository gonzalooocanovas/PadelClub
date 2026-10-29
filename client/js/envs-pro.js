// The two art-directed environments: NIGHT ARENA (id 'night') and MEDITERRANEAN CLUB (id 'outdoor').
// Same contract as envs.js: a builder gets the World as `ctx` and returns { group, light, turf, ads }. Only the surroundings are
// built here; the playing area (turf, glass, mesh, net, doors) belongs to the World and is untouched. Nothing in these groups is
// collidable and nothing is placed inside the court or on the camera lines behind the baselines.
import * as THREE from 'three';
import {
  rng, std, tex, plasterTex, limestoneTex, timberTex, concreteTex, pavingTex, gradientTex, glowTex, merge, paint,
  seatingBank, spectators, oliveGeometry, cypressGeometry, shrubGeometry, lavenderGeometry, grassGeometry, palmGeometry, instance,
  floodlightMast, lensMesh,
} from './env-kit.js';

const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });
const mesh = (geo, mat, x = 0, y = 0, z = 0, cast = false) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; return m; };
const box = (mat, w, h, d, x, y, z, cast = false) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, cast);

/** Distant ring of venue silhouettes with sparse warm windows and a few aviation lights. Everything is merged or instanced. */
function skyline(group, { seed, rIn, rOut, count, color, windows = 260 }) {
  const rand = rng(seed), parts = [], win = [];
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2, r = rIn + rand() * (rOut - rIn), w = 6 + rand() * 14, d = 6 + rand() * 12, h = 6 + Math.pow(rand(), 1.8) * 40;
    const g = new THREE.BoxGeometry(w, h, d); g.translate(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r); g.rotateY(0);
    g.deleteAttribute('uv'); parts.push(g);
    if (rand() < 0.7) for (let k = 0; k < windows / count * 1.4; k++) {
      const ax = Math.cos(a) * r, az = Math.sin(a) * r, towards = Math.atan2(-az, -ax); // windows on the face that looks at the venue
      const u = (rand() - 0.5) * w * 0.8, yy = 2 + rand() * (h - 4);
      win.push([ax + Math.cos(towards) * (d / 2 + 0.05) - Math.sin(towards) * u, yy, az + Math.sin(towards) * (d / 2 + 0.05) + Math.cos(towards) * u, towards]);
    }
  }
  group.add(new THREE.Mesh(merge(parts), std(color, 1)));
  const wm = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 1.2), basic(0xffd9a0), win.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  win.forEach(([x, y, z, t], i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 - t); m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)); wm.setMatrixAt(i, m4); });
  group.add(wm);
}

// ================================================================= NIGHT ARENA

export function nightArena(ctx) {
  const group = new THREE.Group(); group.name = 'env_night';
  const rand = rng(1234);
  const concrete = std(0xffffff, 0.92, 0, { map: concreteTex('#565b64', [6, 2]), vertexColors: true });
  const dark = std(0x131820, 0.55, 0.6, { vertexColors: true });
  const steel = std(0x4b5563, 0.38, 0.75);
  const wall = std(0xffffff, 0.9, 0, { map: concreteTex('#5b626e', [10, 2]), emissive: 0x131b2b, emissiveIntensity: 1 });

  // --- stands: structured tiers with dark supports, aisles and instanced seats (navy sections) and spectators
  const banks = [
    { origin: [7.6, 0, 13], along: [0, 0, -1], away: [1, 0, 0], rows: 6, length: 26 },
    { origin: [-7.6, 0, -13], along: [0, 0, 1], away: [-1, 0, 0], rows: 6, length: 26 },
    { origin: [9, 0, -14.2], along: [-1, 0, 0], away: [0, 0, -1], rows: 8, length: 18 },
    { origin: [-9, 0, 15.2], along: [1, 0, 0], away: [0, 0, 1], rows: 4, length: 18 },
  ];
  const allSeats = [];
  for (const b of banks) {
    const bank = seatingBank(group, { ...b, rise: 0.42, run: 0.85, concrete, dark, aisle: 6, seatColors: [0x1b2a4d, 0x24396b, 0x1b2a4d, 0x30363f], rand });
    allSeats.push(...bank.seats);
  }
  spectators(ctx, group, allSeats, { occupancy: 0.72, rand: rng(77) });

  // --- venue shell behind the stands: facades with vertical panels, LED edge lines, sponsor bands, player tunnel openings
  const shell = (w, h, x, y, z, ry) => { const m = box(wall, w, h, 0.7, 0, 0, 0); const g = new THREE.Group(); g.add(m); g.position.set(x, y, z); g.rotation.y = ry; group.add(g); return g; };
  shell(30, 13, 0, 6.5, -23.2, 0); shell(46, 11, 14.4, 5.5, -2, Math.PI / 2); shell(46, 11, -14.4, 5.5, -2, Math.PI / 2); shell(30, 8, 0, 4, 20.5, 0);
  const led = basic(0x9fc4ff);
  for (const [w, x, y, z, ry] of [[30, 0, 13.1, -22.8, 0], [46, 14.0, 11.1, -2, Math.PI / 2], [46, -14.0, 11.1, -2, Math.PI / 2], [30, 0, 8.1, 20.1, 0]]) { const l = mesh(new THREE.BoxGeometry(w, 0.1, 0.1), led, x, y, z); l.rotation.y = ry; group.add(l); }
  // pilasters every 3 m (merged) give the facades structure; a faint cool wash of floodlight spill climbs each wall
  { const rib = [];
    for (let x = -14; x <= 14; x += 3.5) { const g = new THREE.BoxGeometry(0.5, 12.4, 0.5); g.translate(x, 6.2, -22.6); g.deleteAttribute('uv'); rib.push(g); }
    for (let z = -20; z <= 18; z += 3.5) for (const sx of [-1, 1]) { const g = new THREE.BoxGeometry(0.5, 10.4, 0.5); g.translate(sx * 13.9, 5.2, z); g.deleteAttribute('uv'); rib.push(g); }
    group.add(new THREE.Mesh(merge(rib), dark)); }
  const washTex = tex(4, 128, (g, w, h) => { const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(150,185,255,0.30)'); gr.addColorStop(0.55, 'rgba(120,160,255,0.08)'); gr.addColorStop(1, 'rgba(120,160,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, { aniso: 1 });
  const washMat = new THREE.MeshBasicMaterial({ map: washTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const [w, h, x, y, z, ry] of [[30, 12, 0, 6.5, -22.8, 0], [46, 10, 13.9, 5.5, -2, -Math.PI / 2], [46, 10, -13.9, 5.5, -2, Math.PI / 2]]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), washMat); p.position.set(x, y, z); p.rotation.y = ry; group.add(p); }
  // cantilever roofs over the far and side stands: a dark underside with LED lines and a truss edge, so the top of the frame is architecture, not void
  { const roofMat = std(0x1a2029, 0.6, 0.5), ledLine = basic(0xbcd4ff);
    const roof = (w, d, x, y, z, ry, tilt) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; const slab = box(roofMat, w, 0.25, d, 0, 0, 0); slab.rotation.x = tilt; g.add(slab);
      for (let i = 0; i < 4; i++) { const l = mesh(new THREE.BoxGeometry(w - 1, 0.05, 0.06), ledLine, 0, -0.16 + 0, -d / 2 + (i + 0.6) * d / 4.4); l.rotation.x = tilt; g.add(l); }
      const edge = box(dark, w, 0.5, 0.2, 0, 0.1, d / 2); edge.rotation.x = tilt; g.add(edge); group.add(g); };
    roof(26, 8.4, 0, 10.3, -19.4, 0, -0.18); roof(26, 6.2, 10.9, 8.1, -1.5, -Math.PI / 2, 0.2); roof(26, 6.2, -10.9, 8.1, -1.5, Math.PI / 2, 0.2); }
  // sponsor bands and the players' tunnels in the far facade
  const bandTex = (t, bg, fg, sub) => new THREE.MeshBasicMaterial({ map: ctx.adTexture(t, bg, fg, sub) });
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 1.4), bandTex(['PADEL CLUB', 'ARENA TOUR', 'LIVE'][i], '#0b1a33', '#dbe7ff', ['OPEN SERIES', 'FINALS NIGHT', 'BROADCAST'][i])); b.position.set(-10 + i * 10, 9.6, -22.7); group.add(b); }
  for (const x of [-4.5, 4.5]) { group.add(box(std(0x05070b, 1), 3, 3.4, 0.5, x, 1.7, -22.7)); group.add(box(basic(0x6fa8ff), 3.2, 0.08, 0.1, x, 3.5, -22.4)); }
  // the tournament display: a framed screen hung over the far stand (static graphic, not a live score)
  const board = new THREE.Group(); board.position.set(0, 7.4, -22.2);
  board.add(box(dark, 10.2, 3.6, 0.4, 0, 0, 0)); const scr = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 3.0), bandTex('PADEL CLUB OPEN', '#07142c', '#ffffff', 'FINAL · NIGHT SESSION')); scr.position.z = 0.22; board.add(scr);
  for (const x of [-4.2, 4.2]) board.add(box(steel, 0.12, 3, 0.12, x, 3.2, -0.2));
  group.add(board);
  // LED advertising boards along the front of every stand (restrained: three alternating sponsors)
  const ledTex = ['PADEL CLUB', 'ARENA TOUR', 'OPEN SERIES'].map((t, i) => ctx.adTexture(t, ['#0b1a33', '#10243f', '#0b1a33'][i], '#cfe0ff', 'LIVE · NIGHT'));
  ledTex.forEach((t) => { t.wrapS = THREE.RepeatWrapping; t.repeat.set(2, 1); });
  for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(26, 0.8), new THREE.MeshBasicMaterial({ map: ledTex[sx > 0 ? 0 : 1] })); m.position.set(sx * 7.55, 1.05, 0); m.rotation.y = -sx * Math.PI / 2; group.add(m); }
  { const m = new THREE.Mesh(new THREE.PlaneGeometry(18, 0.8), new THREE.MeshBasicMaterial({ map: ledTex[2] })); m.position.set(0, 1.05, -14.15); group.add(m); }

  // --- floodlights: four masts with real housings, aimed lens panels, glare, and four spot lights that light the court
  const lens = basic(0xfff3dc), glow = glowTex();
  const masts = [];
  for (const [x, z] of [[-13.5, -17], [13.5, -17], [-13.5, 17], [13.5, 17]]) masts.push(floodlightMast(group, { x, z, height: 19, target: [0, 0.5, 0], cols: 4, rows: 3, steel, dark, lensMat: lens, glow }));
  lensMesh(group, masts, lens);
  const spots = [];
  for (const [x, z] of [[-13, -15.5], [13, -15.5], [-13, 15.5], [13, 15.5]]) {
    const s = new THREE.SpotLight(0xfff1dc, 1800, 0, 0.5, 0.75, 2); s.position.set(x, 18.5, z); s.target.position.set(0, 0, 0); group.add(s, s.target); spots.push(s);
  }
  // a faint pool of light spilling over the stands (cheap: two wide, weak lights instead of more shadows)
  for (const sx of [-1, 1]) { const w = new THREE.PointLight(0xaec6ff, 90, 22, 2); w.position.set(sx * 10, 7, 0); group.add(w); }

  // --- the world beyond: sky dome, haze, distant venue silhouettes with a few lit windows, aviation lights
  const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 12), new THREE.MeshBasicMaterial({ map: gradientTex([[0, '#03060f'], [0.45, '#0a1428'], [0.7, '#14233f'], [0.88, '#22345a'], [1, '#2b3f66']]), side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.scale.y = 0.62; sky.renderOrder = -2; group.add(sky);
  const starPos = new Float32Array(500 * 3), sr = rng(5);
  for (let i = 0; i < 500; i++) { const a = sr() * Math.PI * 2, e = 0.3 + sr() * 1.0, r = 170; starPos.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r * 0.62, Math.sin(a) * Math.cos(e) * r], i * 3); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  group.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xbcd0ff, size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.55 })));
  skyline(group, { seed: 9, rIn: 75, rOut: 135, count: 70, color: 0x0b1222, windows: 320 });
  const red = basic(0xff4040); for (const [x, z, h] of [[-90, -70, 52], [105, -40, 48], [60, 110, 44], [-110, 60, 50]]) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 6), red); m.position.set(x, h, z); group.add(m); }

  // --- a night environment map: dark dome with four bright rectangles, so the glass and steel catch believable highlights
  const envScene = new THREE.Scene(); envScene.background = new THREE.Color(0x05080f);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 13, 11), side: THREE.DoubleSide })); p.position.set(x * 8, 9, z * 8); p.lookAt(0, 0, 0); envScene.add(p); }
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 16), new THREE.MeshBasicMaterial({ color: 0x0c1830 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -3; envScene.add(floor);
  const pm = new THREE.PMREMGenerator(ctx.renderer), envTarget = pm.fromScene(envScene, 0.03), envTexture = envTarget.texture; pm.dispose();
  envTexture.addEventListener('dispose', () => envTarget.dispose()); // disposing the texture also frees its render target
  envScene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });   // the small scene was only needed to bake the map

  return {
    group,
    light: {
      bg: 0x050a14, fog: [0x0a1326, 80, 240], hemi: [0x2a3e70, 0x0a0e18, 0.62], sun: { color: 0xeaf0ff, intensity: 0.9, pos: [5, 24, 4] },
      exposure: 1.0, envIntensity: 0.5, envTexture, frame: 0x39414d, frameMetal: 0.65, frameRough: 0.4,
    },
    turf: { base: '#2a5ca8', out: { color: 0x151a22, rough: 0.8 } },
    ads: { text: 'PADEL CLUB', bg: '#0a1a33', fg: '#cfe0ff', sub: 'OPEN SERIES · LIVE' },
  };
}

// ================================================================= MEDITERRANEAN CLUB

export function mediterraneanClub(ctx) {
  const group = new THREE.Group(); group.name = 'env_outdoor';
  const rand = rng(4321);
  // materials: warm plaster, limestone, terracotta, bronze metal, timber, glass
  const plaster = std(0xffffff, 0.92, 0, { map: plasterTex('#efe6d4', [5, 2]) });
  const plasterSide = std(0xffffff, 0.92, 0, { map: plasterTex('#e9dec9', [3, 2]) });
  const stone = std(0xffffff, 0.88, 0, { map: limestoneTex([4, 2]) });
  const terracotta = std(0xb8643c, 0.85, 0, { map: tex(128, 128, (g, w, h) => { g.fillStyle = '#b8643c'; g.fillRect(0, 0, w, h); for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${120 + Math.random() * 60 | 0},${50 + Math.random() * 30 | 0},30,${Math.random() * 0.2})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 2); } }, { repeat: [6, 1] }) });
  const bronze = std(0x2a2724, 0.45, 0.7);
  const wood = std(0xffffff, 0.78, 0, { map: timberTex([156, 108, 64], true, [3, 1]) });
  const woodV = std(0xffffff, 0.78, 0, { map: timberTex([150, 104, 62], false, [4, 1]) });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x20323a, roughness: 0.08, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.78 });
  const warm = basic(0xffd9a0);
  const interior = new THREE.MeshBasicMaterial({ map: gradientTex([[0, '#f4c98a'], [0.55, '#ffe2b0'], [1, '#c98f52']]) });

  // --- clubhouse along the far baseline: layered volumes with recesses, deep openings, timber screen, roof terrace and pergola
  const club = new THREE.Group(); club.position.set(0, 0, -25); group.add(club);
  club.add(box(stone, 34, 1.0, 9, 0, 0.5, 0, true));                          // plinth
  club.add(box(plaster, 30, 4.6, 8, 0, 3.3, -0.3, true));                      // ground floor
  club.add(box(plasterSide, 22, 3.6, 7.4, -3, 7.4, -0.6, true));               // upper volume, set back
  club.add(box(stone, 31, 0.35, 8.6, 0, 5.75, 0.0, true));                     // slab edge (overhang)
  club.add(box(plaster, 22.6, 0.4, 8.0, -3, 9.4, -0.6, true));                 // roof slab with overhang
  club.add(box(terracotta, 22.8, 0.25, 0.5, -3, 9.75, 3.2, true));             // terracotta cornice
  // ground-floor glazing: tall openings with bronze frames, deep reveals and a lit interior
  for (let i = 0; i < 5; i++) {
    const x = -10 + i * 5;
    club.add(box(stone, 3.6, 3.7, 0.5, x, 3.1, 3.75));                          // limestone surround (reveal)
    club.add(box(interior, 3.0, 3.3, 0.1, x, 3.1, 3.55));
    club.add(box(glass, 3.0, 3.3, 0.06, x, 3.1, 3.95));
    for (const dx of [-1.5, 0, 1.5]) club.add(box(bronze, 0.07, 3.4, 0.12, x + dx, 3.1, 4.0));
    club.add(box(bronze, 3.1, 0.07, 0.12, x, 4.8, 4.0)); club.add(box(bronze, 3.1, 0.07, 0.12, x, 1.45, 4.0));
    club.add(box(stone, 3.8, 0.12, 0.8, x, 1.25, 3.9));                         // sill
  }
  // covered terrace: a deep roof slab on slim cream columns, with a warm ceiling
  club.add(box(plaster, 30, 0.3, 3.2, 0, 4.9, 5.4, true)); club.add(box(std(0xe9b878, 0.9), 29.6, 0.05, 3.0, 0, 4.72, 5.4));
  for (let i = 0; i < 7; i++) club.add(box(plaster, 0.34, 4.5, 0.34, -13.5 + i * 4.5, 2.5, 6.8, true));
  club.add(box(stone, 31, 0.3, 3.4, 0, 0.15, 5.6));
  // upper floor: a continuous band of glazing with timber slats and a balcony rail
  club.add(box(interior, 18, 2.2, 0.1, -3, 7.5, 3.25)); club.add(box(glass, 18, 2.2, 0.06, -3, 7.5, 3.45));
  for (let i = 0; i <= 12; i++) club.add(box(bronze, 0.07, 2.3, 0.12, -12 + i * 1.5, 7.5, 3.5));
  for (let i = 0; i < 16; i++) club.add(box(woodV, 0.12, 3.4, 0.25, -11.5 + i * 1.25, 7.4, 3.85));   // vertical timber screen
  club.add(box(bronze, 22, 0.06, 0.06, -3, 6.5, 4.0)); club.add(box(bronze, 22, 0.06, 0.06, -3, 6.1, 4.0));
  // terracotta accent wall and club signage
  club.add(box(terracotta, 5.6, 4.6, 0.6, 12.8, 3.3, 3.6, true));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.9), new THREE.MeshBasicMaterial({ map: ctx.adTexture('PADEL CLUB', '#b8643c', '#f7eedd', 'COSTA DEL SOL') })); sign.position.set(12.8, 4.4, 3.95); club.add(sign);
  // rooftop pergola and planters
  for (const x of [-12, -6, 0]) for (const z of [-3.5, 2.5]) club.add(box(bronze, 0.14, 2.6, 0.14, x, 10.9, z, true));
  for (let i = 0; i < 12; i++) club.add(box(wood, 0.12, 0.22, 6.4, -12.5 + i * 1.35, 12.2, -0.5, true));
  club.add(box(wood, 14, 0.2, 0.2, -6, 12.0, -3.5)); club.add(box(wood, 14, 0.2, 0.2, -6, 12.0, 2.5));
  // warm wall lights on the facade
  for (const x of [-12.4, -7.4, -2.4, 2.6, 7.6, 12.4]) club.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 8), warm, x, 5.2, 4.1));

  // --- near-side service building (low, with a roof terrace) and side walls: limestone walls with timber gates
  const near = new THREE.Group(); near.position.set(0, 0, 26); group.add(near);
  near.add(box(plaster, 26, 3.6, 5, 0, 1.8, 0, true)); near.add(box(stone, 26.6, 0.3, 5.6, 0, 3.75, 0, true)); near.add(box(terracotta, 26.6, 0.2, 0.4, 0, 3.95, 2.7));
  for (let i = 0; i < 4; i++) { near.add(box(woodV, 2.2, 2.4, 0.15, -9 + i * 6, 1.3, -2.55)); near.add(box(bronze, 2.3, 0.08, 0.2, -9 + i * 6, 2.55, -2.55)); }
  const sideWalls = [-1, 1].map((sx) => { const g = new THREE.Group(); g.position.set(sx * 19, 0, -1); g.add(box(stone, 0.7, 1.8, 40, 0, 0.9, 0, true)); g.add(box(stone, 0.9, 0.2, 40, 0, 1.9, 0)); group.add(g); return g; });

  // --- ground: limestone terraces and a raised planting bed along each side, sun beds of lavender and grasses
  const lavGeo = [lavenderGeometry(1), lavenderGeometry(2), lavenderGeometry(3)], grassGeo = [grassGeometry(1), grassGeometry(2)];
  const lav = [[], [], []], gr = [[], []];
  for (const sx of [-1, 1]) for (let z = -17; z <= 18; z += 0.9) for (let k = 0; k < 2; k++) {
    const x = sx * (15.4 + k * 0.9 + rand() * 0.4); const list = rand() < 0.62 ? lav[Math.floor(rand() * 3)] : gr[Math.floor(rand() * 2)];
    list.push([x, z + rand() * 0.4, 0.85 + rand() * 0.5, rand() * 6.28, 0xffffff]);
  }
  lav.forEach((l, i) => l.length && instance(group, lavGeo[i], l, { roughness: 0.95, shadow: false }));
  gr.forEach((l, i) => l.length && instance(group, grassGeo[i], l, { roughness: 0.95, shadow: false, side: THREE.DoubleSide }));
  for (const sx of [-1, 1]) { group.add(box(stone, 3.2, 0.35, 38, sx * 16.0, 0.17, -1)); }   // raised bed edge
  // olive trees (3 variants), cypress (2 variants), a few palms, shrubs in planters and beds
  const oliveGeo = [oliveGeometry(11), oliveGeometry(12), oliveGeometry(13)], cyprGeo = [cypressGeometry(21, 7.5), cypressGeometry(22, 6.2)], palmGeo = palmGeometry(31, 8), shrubGeo = [shrubGeometry(41, 0.85), shrubGeometry(42, 0.65)];
  const oliveL = [[], [], []], cyprL = [[], []], shrubL = [[], []];
  const olives = [[-14.5, -12], [-14.8, 4], [14.6, -4], [14.8, 14], [-14.3, 16], [14.5, -17], [-10, 30], [10, 30], [-20, -22], [21, -24]];
  olives.forEach(([x, z], i) => oliveL[i % 3].push([x, z, 1.0 + rand() * 0.5, rand() * 6.28, 0xffffff]));
  const cyp = [[-15.5, -20], [-15.5, -8], [15.8, -9], [15.6, 6], [-15.4, 10], [16, 20], [-19, 14], [19.5, 12], [-6, -21.5], [6.5, -21.5]];
  cyp.forEach(([x, z], i) => cyprL[i % 2].push([x, z, 0.9 + rand() * 0.35, rand() * 6.28, 0xffffff]));
  for (let i = 0; i < 26; i++) { const sx = rand() < 0.5 ? -1 : 1; shrubL[i % 2].push([sx * (13.6 + rand() * 1.0), -18 + rand() * 38, 0.8 + rand() * 0.7, rand() * 6.28, 0xffffff]); }
  oliveL.forEach((l, i) => instance(group, oliveGeo[i], l)); cyprL.forEach((l, i) => instance(group, cyprGeo[i], l)); shrubL.forEach((l, i) => instance(group, shrubGeo[i], l, { shadow: false }));
  instance(group, palmGeo, [[-17.5, -17, 1, 0.5], [17.6, -19, 1.1, 2.4], [-18, 22, 0.9, 4.0]], { side: THREE.DoubleSide });
  // stone planters with shrubs flanking each baseline
  for (const [x, z] of [[-6.5, -14], [6.5, -14], [-6.5, 14.5], [6.5, 14.5]]) { group.add(box(stone, 1.6, 0.8, 1.6, x, 0.4, z, true)); instance(group, shrubGeo[1], [[x, z, 0.7, rand() * 6, 0xffffff]], { shadow: true, y: 0.78 }); }

  // --- terrace furniture: timber benches on dark metal legs, a water station, a racket rack, path lights, a pergola shade on the sunny side
  const bench = (x, z, ry) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; g.add(box(wood, 2.0, 0.07, 0.42, 0, 0.45, 0, true)); g.add(box(wood, 2.0, 0.34, 0.06, 0, 0.75, -0.2, true)); for (const dx of [-0.85, 0.85]) g.add(box(bronze, 0.06, 0.45, 0.4, dx, 0.22, 0)); group.add(g); };
  bench(-8.1, -4.5, Math.PI / 2); bench(-8.1, 4.5, Math.PI / 2); bench(8.1, -4.5, -Math.PI / 2); bench(8.1, 4.5, -Math.PI / 2);
  const water = new THREE.Group(); water.position.set(8.6, 0, -9); water.add(box(stone, 0.6, 1.0, 0.6, 0, 0.5, 0, true)); water.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6), std(0xb8bcc2, 0.3, 0.9), 0, 1.15, 0.1)); water.add(box(std(0x9aa7b0, 0.3, 0.8), 0.32, 0.06, 0.32, 0, 1.03, 0.04)); group.add(water);
  const rack = new THREE.Group(); rack.position.set(-8.7, 0, -9.3); rack.add(box(wood, 1.6, 0.08, 0.35, 0, 0.9, 0)); rack.add(box(wood, 1.6, 1.0, 0.06, 0, 0.5, -0.15));
  for (let i = 0; i < 5; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.015, 5, 14), std([0x2057c8, 0xc23b32, 0xa6d51f, 0x222222, 0xff9f2e][i], 0.5)); r.position.set(-0.55 + i * 0.28, 1.05, 0.05); r.scale.y = 1.25; rack.add(r); }
  group.add(rack);
  const lamps = []; for (const sx of [-1, 1]) for (let z = -12; z <= 12; z += 4) lamps.push([sx * 7.7, z]);
  { const lg = new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), top = new THREE.SphereGeometry(0.1, 8, 6);
    const bol = new THREE.InstancedMesh(lg, bronze, lamps.length), tops = new THREE.InstancedMesh(top, warm, lamps.length), m4 = new THREE.Matrix4();
    lamps.forEach(([x, z], i) => { m4.makeTranslation(x, 0.35, z); bol.setMatrixAt(i, m4); m4.makeTranslation(x, 0.75, z); tops.setMatrixAt(i, m4); }); group.add(bol, tops); }
  // timber pergola on each side, with the shadows it throws across the outer edge of the court
  for (const sx of [-1, 1]) {
    for (const z of [-3.2, 3.2]) for (const dx of [0, 2.4]) group.add(box(bronze, 0.16, 3.0, 0.16, sx * (9.2 + dx), 1.5, z, true));
    for (let z = -3.8; z <= 3.8; z += 0.5) group.add(box(wood, 3.0, 0.08, 0.14, sx * 10.4, 3.05, z, true));
    group.add(box(wood, 0.16, 0.22, 8.2, sx * 9.2, 3.0, 0)); group.add(box(wood, 0.16, 0.22, 8.2, sx * 11.6, 3.0, 0));
  }
  // a few guests on the terrace (shared crowd system, small and calm)
  const seats = []; for (const [x, z] of [[-8.1, -4.9], [-8.1, -4.1], [-8.1, 4.1], [8.1, 4.9], [8.1, -4.9]]) seats.push([x, 0.5, z, x < 0 ? Math.PI / 2 : -Math.PI / 2]);
  spectators(ctx, group, seats, { occupancy: 1, rand: rng(3), palette: [0xf3ead9, 0x5b7fa8, 0xd8a45a, 0x8fae7a, 0xc66a5a] });

  // --- sky, a low sun with glow, layered hills receding into warm haze, and a strip of sea
  const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 12), new THREE.MeshBasicMaterial({ map: gradientTex([[0, '#4f8fd0'], [0.38, '#8fbbe3'], [0.6, '#cfe0ea'], [0.74, '#f4dfc0'], [0.85, '#f6d2a2'], [1, '#e9c39a']]), side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.scale.y = 0.6; sky.renderOrder = -2; group.add(sky);
  const sunDir = new THREE.Vector3(-0.8, 0.3, 0.5).normalize();
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(255,236,200,1)', 'rgba(255,236,200,0)'), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.85 }));
  sunGlow.position.copy(sunDir).multiplyScalar(150); sunGlow.scale.set(60, 60, 1); group.add(sunGlow);
  const ridge = (seed, r, h0, amp, color, a0, a1) => { // a ribbon of hills: a curved silhouette strip around part of the horizon
    const rr = rng(seed), pos = [], idx = [], N = 60;
    for (let i = 0; i <= N; i++) { const a = a0 + (a1 - a0) * (i / N), hh = h0 + amp * (Math.sin(i * 0.35 + seed) * 0.5 + Math.sin(i * 0.9 + seed * 2) * 0.3 + rr() * 0.25); pos.push(Math.cos(a) * r, -2, Math.sin(a) * r, Math.cos(a) * r, hh, Math.sin(a) * r); if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: true }));
  };
  group.add(ridge(1, 150, 14, 10, 0x9fb08c, -2.4, 0.4)); group.add(ridge(2, 125, 10, 8, 0x8ca077, -2.9, 0.9)); group.add(ridge(3, 100, 7, 5, 0x76895f, -3.1, 1.4));
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 90), new THREE.MeshBasicMaterial({ map: gradientTex([[0, '#bfd6e2'], [1, '#5f9bc4']]), fog: true })); sea.rotation.x = -Math.PI / 2; sea.position.set(-60, -1.6, 70); group.add(sea);

  // --- lighting: golden-hour sun from the side, soft sky and warm bounce
  const light = {
    bg: 0x9cc4e8, fog: [0xf2dcc0, 60, 210], hemi: [0xa9c8e8, 0xb58e66, 0.78], sun: { color: 0xffc78a, intensity: 3.1, pos: [sunDir.x * 30, sunDir.y * 30 + 2, sunDir.z * 30] },
    exposure: 0.97, envIntensity: 0.34, frame: 0x2b2926, frameMetal: 0.55, frameRough: 0.48,
  };
  return { group, light, turf: { base: '#2c6aa8', out: { color: 0xffffff, rough: 0.9, paving: true } }, ads: { text: 'PADEL CLUB', bg: '#efe5d2', fg: '#9a4a2a', sub: 'COSTA DEL SOL' } };
}
