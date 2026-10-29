// The other two art-directed environments: PREMIUM INDOOR CLUB (id 'indoor') and SUNSET ROOFTOP (id 'rooftop').
// Same contract and rules as envs-pro.js: surroundings only, nothing inside the court footprint, merged or instanced repeated parts.
import * as THREE from 'three';
import {
  rng, std, tex, plasterTex, limestoneTex, timberTex, concreteTex, gradientTex, glowTex, merge,
  seatingBank, spectators, oliveGeometry, shrubGeometry, grassGeometry, instance,
} from './env-kit.js';
import { basic, mesh, box, skyline } from './envs-pro.js';

// ================================================================= PREMIUM INDOOR CLUB

export function indoorClub(ctx) {
  const group = new THREE.Group(); group.name = 'env_indoor';
  const rand = rng(777);
  const dark = std(0x1b1f26, 0.5, 0.6), steel = std(0x4a525e, 0.4, 0.7);
  const timberV = std(0xffffff, 0.7, 0, { map: timberTex([170, 122, 76], false, [6, 2]) });
  const plasterW = std(0xffffff, 0.9, 0, { map: plasterTex('#e8e4dc', [6, 2]) });
  const warmLed = basic(0xfff0d0);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xbcd4e0, roughness: 0.05, transparent: true, opacity: 0.18, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false });
  const stone = std(0xffffff, 0.88, 0, { map: limestoneTex([4, 2]) });

  // hall shell: far wall of timber slat panels with a lit logo between structural piers, a plastered near wall
  group.add(box(std(0x2a2018, 0.9), 36, 11, 0.5, 0, 5.5, -23.2));                       // dark backing
  { const slats = []; for (let x = -17.6; x <= 17.6; x += 0.26) { const g = new THREE.BoxGeometry(0.18, 10.6, 0.14); g.translate(x, 5.5, -22.85); g.deleteAttribute('uv'); slats.push(g); }
    group.add(new THREE.Mesh(merge(slats), std(0xb98a58, 0.65))); }                        // acoustic timber slats, one merged mesh
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.6), new THREE.MeshBasicMaterial({ map: ctx.adTexture('PADEL CLUB', '#1a1f26', '#f1e6cf', 'PREMIUM INDOOR CLUB') }));
  logo.position.set(0, 7.4, -22.9); group.add(logo);
  for (const x of [-9, 9]) group.add(box(dark, 0.5, 11, 0.7, x, 5.5, -22.9));
  group.add(box(plasterW, 36, 11, 0.5, 0, 5.5, 24.5));

  // left wall: a glass curtain with bronze mullions, the dusk sky behind it, tall planters with shrubs in front
  group.add(box(glass, 0.06, 7.5, 36, -17.5, 4.5, 0));
  group.add(box(plasterW, 0.5, 3.4, 48, -17.8, 1.7, 0));
  for (let z = -21; z <= 21; z += 3) group.add(box(dark, 0.14, 7.6, 0.14, -17.4, 4.5, z));
  const dusk = new THREE.Mesh(new THREE.PlaneGeometry(80, 8), new THREE.MeshBasicMaterial({ map: gradientTex([[0, '#1d2a52'], [0.6, '#5b6fa6'], [1, '#e8b08a']]), fog: false }));
  dusk.position.set(-26, 5, 0); dusk.rotation.y = Math.PI / 2; group.add(dusk);

  // right wall: a lounge mezzanine with a glass balustrade, low seating in warm colours and a few guests
  group.add(box(plasterW, 0.5, 11, 48, 17.8, 5.5, 0));
  group.add(box(stone, 5.2, 0.5, 40, 14.9, 2.1, 0, true));
  group.add(box(glass, 0.05, 1.1, 38, 12.4, 3.0, 0));
  group.add(box(dark, 0.08, 0.08, 38, 12.4, 3.6, 0));
  const lounge = seatingBank(group, { origin: [15.8, 2.35, 18], along: [0, 0, -1], away: [1, 0, 0], rows: 1, length: 36, rise: 0.0001, run: 1.2, concrete: stone, dark, aisle: 5, seatColors: [0x9a4a2c, 0x2f6b66, 0xd9c7a0], rand });
  spectators(ctx, group, lounge.seats.filter((_, i) => i % 2), { occupancy: 0.55, rand: rng(8), palette: [0xf3ead9, 0x2c3a52, 0x9a4a2c, 0xd9c7a0, 0x2f6b66] });

  // ceiling: dark slab, truss lines every 5 m and timber baffles (merged), long LED lines above the court
  group.add(box(std(0x15181d, 0.8), 36, 0.4, 48, 0, 11.8, 0));
  const tr = [], bf = [];
  for (let z = -22; z <= 22; z += 5) {
    const g = new THREE.BoxGeometry(35, 0.5, 0.35); g.translate(0, 11.3, z); g.deleteAttribute('uv'); tr.push(g);
    for (const x of [-12, -6, 0, 6, 12]) { const d = new THREE.BoxGeometry(0.15, 1.6, 0.15); d.translate(x, 10.6, z); d.deleteAttribute('uv'); tr.push(d); }
  }
  for (let z = -22.5; z <= 22.5; z += 0.8) { const g = new THREE.BoxGeometry(34, 0.12, 0.3); g.translate(0, 11.0, z); g.deleteAttribute('uv'); bf.push(g); }
  group.add(new THREE.Mesh(merge(tr), steel), new THREE.Mesh(merge(bf), std(0xb98a58, 0.7)));
  for (const x of [-8, -4, 0, 4, 8]) group.add(box(warmLed, 0.18, 0.06, 40, x, 10.9, 0));

  // banners, and a row of stone planters with shrubs along the glass wall
  for (const x of [-7, 7]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 4), new THREE.MeshBasicMaterial({ map: ctx.adTexture('PADEL', '#2f6b66', '#f1e6cf', 'CLUB') }));
    b.position.set(x, 8.2, -22.5); group.add(b);
  }
  const shrub = [shrubGeometry(51, 0.9), shrubGeometry(52, 0.7)], list = [[], []];
  for (let z = -18, i = 0; z <= 18; z += 4.5, i++) { group.add(box(stone, 1.4, 0.7, 1.4, -16.4, 0.35, z, true)); list[i & 1].push([-16.4, z, 0.8, rand() * 6, 0xffffff]); }
  list.forEach((l, i) => l.length && instance(group, shrub[i], l, { y: 0.7, shadow: false }));

  // lighting: bright neutral hall with two soft spot lights from the ceiling (no shadows) and the single shadow-casting key light
  for (const x of [-5, 5]) {
    const s = new THREE.SpotLight(0xfff1dc, 900, 0, 0.8, 0.8, 2); s.position.set(x, 10.5, 0); s.target.position.set(0, 0, 0); group.add(s, s.target);
  }
  return {
    group,
    light: { bg: 0x10141b, fog: [0x1a1f28, 60, 150], hemi: [0xfff1de, 0x3a3f4a, 0.78], sun: { color: 0xfff4e6, intensity: 1.3, pos: [4, 20, 3] }, exposure: 1.05, envIntensity: 0.4, frame: 0x2b2f36, frameMetal: 0.6, frameRough: 0.4 },
    turf: { base: '#2a65a8', out: { color: 0xffffff, rough: 0.55, map: concreteTex('#a4a7ad', [14, 14]) } },
    ads: { text: 'PADEL CLUB', bg: '#1a1f26', fg: '#f1e6cf', sub: 'INDOOR · DOUBLES' },
  };
}

// ================================================================= SUNSET ROOFTOP

export function rooftopSunset(ctx) {
  const group = new THREE.Group(); group.name = 'env_rooftop';
  const rand = rng(909);
  const concrete = std(0xffffff, 0.92, 0, { map: concreteTex('#8d9097', [10, 12]) });
  const dark = std(0x24272f, 0.5, 0.6);
  const wood = std(0xffffff, 0.8, 0, { map: timberTex([150, 106, 66], true, [8, 14]) });
  const woodSlat = std(0xffffff, 0.78, 0, { map: timberTex([156, 108, 64], true, [2, 1]) });
  const fabric = std(0xefe6d6, 0.95), fabric2 = std(0x2f4a58, 0.95);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe3ee, roughness: 0.04, transparent: true, opacity: 0.2, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false });
  const bulb = basic(0xffe3a8);

  // roof slab with a glass balustrade and a steel rail all round, a timber deck either side of the court
  group.add(box(concrete, 42, 0.4, 50, 0, -0.2, 0));
  for (const [w, d, x, z] of [[42, 0.06, 0, 25], [42, 0.06, 0, -25], [0.06, 50, 21, 0], [0.06, 50, -21, 0]]) {
    group.add(box(glass, w, 1.15, d, x, 0.62, z));
    group.add(box(dark, w === 42 ? 42 : 0.1, 0.07, d === 50 ? 50 : 0.1, x, 1.22, z));
  }
  for (const sx of [-1, 1]) group.add(box(wood, 5.4, 0.08, 26, sx * 9.6, 0.04, 0));

  // lounge sofas and low tables on the decks (outside the court's 7 m half-width)
  const sofa = (x, z, ry, mat) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
    g.add(box(mat, 2.4, 0.4, 0.9, 0, 0.32, 0, true)); g.add(box(mat, 2.4, 0.55, 0.22, 0, 0.7, -0.34, true));
    for (const dx of [-0.6, 0.6]) g.add(box(mat, 1.1, 0.14, 0.7, dx, 0.57, 0.02));
    group.add(g);
  };
  sofa(9.8, -6, -Math.PI / 2, fabric); sofa(9.8, 6, -Math.PI / 2, fabric2); sofa(-9.8, -6, Math.PI / 2, fabric2); sofa(-9.8, 6, Math.PI / 2, fabric);
  for (const [x, z] of [[8.6, 0], [-8.6, 0]]) { group.add(box(woodSlat, 1.1, 0.4, 1.1, x, 0.2, z, true)); group.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.25, 8), bulb, x, 0.55, z)); }

  // planters with small olive trees, ornamental grasses along the rail, an equipment tank and antenna masts
  const olive = oliveGeometry(61), gr = [grassGeometry(61), grassGeometry(62)], gl = [[], []];
  const tubs = [[-12.5, -14], [12.5, -14], [-12.5, 14], [12.5, 14], [-12.5, 0], [12.5, 0]];
  tubs.forEach(([x, z]) => group.add(box(std(0x39414a, 0.7), 1.3, 0.75, 1.3, x, 0.37, z, true)));
  instance(group, olive, tubs.map(([x, z]) => [x, z, 0.38 + rand() * 0.1, rand() * 6, 0xffffff]), { y: 0.74 });
  for (let z = -22, i = 0; z <= 22; z += 1.1, i++) for (const sx of [-1, 1]) gl[i & 1].push([sx * 20, z, 0.9 + rand() * 0.5, rand() * 6, 0xffffff]);
  gl.forEach((l, i) => instance(group, gr[i], l, { roughness: 0.95, shadow: false, side: THREE.DoubleSide }));
  group.add(mesh(new THREE.CylinderGeometry(1.7, 1.7, 3, 16), std(0x3a3f4b, 0.6, 0.4), -16, 1.5, -21, true));
  group.add(mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.3, 16), dark, -16, 3.1, -21));
  for (const [x, z, h] of [[17, -22, 9], [19, -20, 7]]) { group.add(mesh(new THREE.CylinderGeometry(0.05, 0.08, h, 6), dark, x, h / 2, z)); group.add(mesh(new THREE.SphereGeometry(0.12, 6, 6), basic(0xff4040), x, h, z)); }

  // string lights on slim poles: bulbs instanced, wires as thin line segments
  const poles = []; for (const sx of [-1, 1]) for (let z = -16; z <= 16; z += 8) poles.push([sx * 11.5, z]);
  for (const [x, z] of poles) group.add(box(dark, 0.08, 4.6, 0.08, x, 2.3, z));
  const bulbs = [], pts = [], sag = (t) => 4.5 - 0.5 * Math.sin(Math.PI * t);
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) {
    const z0 = -16 + i * 8, x = sx * 11.5;
    for (let k = 0; k <= 8; k++) { const t = k / 8, z = z0 + 8 * t; bulbs.push([x, sag(t), z]); if (k < 8) pts.push(x, sag(t), z, x, sag((k + 1) / 8), z0 + 8 * (k + 1) / 8); }
  }
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 8, 6), bulb, bulbs.length), m4 = new THREE.Matrix4();
  bulbs.forEach(([x, y, z], i) => { m4.makeTranslation(x, y, z); im.setMatrixAt(i, m4); }); group.add(im);
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x20232a })));

  // dusk: a layered skyline of towers with warm windows, a low sun with glow, a warm gradient sky
  skyline(group, { seed: 33, rIn: 85, rOut: 150, count: 120, color: 0x4a3f6a, windows: 900 });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 12), new THREE.MeshBasicMaterial({ map: gradientTex([[0, '#222b5e'], [0.4, '#6f4a86'], [0.58, '#d8607f'], [0.7, '#ff9a62'], [0.82, '#ffc983'], [1, '#ffd9a0']]), side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.scale.y = 0.6; sky.renderOrder = -2; group.add(sky);
  const sunDir = new THREE.Vector3(-0.8, 0.16, -0.55).normalize();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(255,205,140,1)', 'rgba(255,205,140,0)'), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.95 }));
  glow.position.copy(sunDir).multiplyScalar(150); glow.scale.set(70, 70, 1); group.add(glow);

  const deck = tex(256, 256, (g, w, h) => {
    for (let y = 0; y < h; y += 32) { const o = (y / 32 % 2) * 40; for (let x = -o; x < w; x += 80) { const t = Math.random(); g.fillStyle = `rgb(${160 + t * 20 | 0},${116 + t * 20 | 0},${74 + t * 16 | 0})`; g.fillRect(x, y, 78, 31); } }
    g.fillStyle = 'rgba(40,24,10,.5)'; for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 1.5);
  }, { repeat: [12, 14] });
  return {
    group,
    light: { bg: 0x6f4a86, fog: [0xe0907a, 70, 200], hemi: [0xffc3a0, 0x4a3a4e, 0.8], sun: { color: 0xffb27a, intensity: 2.4, pos: [sunDir.x * 30, sunDir.y * 30 + 4, sunDir.z * 30] }, exposure: 1.0, envIntensity: 0.32, frame: 0x30343c, frameMetal: 0.6, frameRough: 0.4 },
    turf: { base: '#2a64ab', out: { color: 0xffffff, rough: 0.9, map: deck } },
    ads: { text: 'PADEL CLUB', bg: '#1d2540', fg: '#ffd08a', sub: 'SUNSET ROOFTOP' },
  };
}
