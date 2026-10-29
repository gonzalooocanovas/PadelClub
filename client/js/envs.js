// Court environments: premium indoor club, Mediterranean outdoor court, floodlit night arena.
// Each builder returns { group, light, turf, ads } and is given the World as `ctx` for shared helpers.
// The playing area itself (turf, glass, mesh, net) is built once by the World; environments only dress the surroundings.
// All dimensions are metres, the court occupies x in [-5, 5], z in [-10, 10].

import * as THREE from 'three';
import { nightArena, mediterraneanClub } from './envs-pro.js';
import { indoorClub, rooftopSunset } from './envs-pro2.js';

const std = (color, rough = 0.85, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const basic = (color) => new THREE.MeshBasicMaterial({ color });

function box(mat, w, h, d, x, y, z, cast = false) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true;
  return m;
}
function cyl(mat, rt, rb, h, x, y, z, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}
function gradientTex(stops) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  stops.forEach(([p, col]) => gr.addColorStop(p, col));
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function canvasMat(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...opts.repeat); }
  return new THREE.MeshStandardMaterial({ map: t, roughness: opts.rough ?? 0.9, transparent: !!opts.alpha, alphaTest: opts.alpha ? 0.4 : 0, side: opts.alpha ? THREE.DoubleSide : THREE.FrontSide });
}

// ================================================================= 1. Premium indoor club

function indoor(ctx) {
  const group = new THREE.Group(); group.name = 'env_indoor';
  // timber slat walls, polished floor, warm accent lighting
  const wood = canvasMat(256, 256, (g, w, h) => {
    g.fillStyle = '#3a2a1e'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { g.fillStyle = `rgba(${150 + Math.random() * 40 | 0},${100 + Math.random() * 30 | 0},60,.55)`; g.fillRect(x + 1, 0, 13, h); }
    g.fillStyle = 'rgba(0,0,0,.25)'; for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 2, h);
  }, { repeat: [6, 1], rough: 0.7 });
  const dark = std(0x10151d, 0.9);
  for (const sz of [-1, 1]) {
    group.add(box(wood, 36, 11, 0.5, 0, 5.5, sz * 17));
    group.add(box(std(0xffc27a, 0.4), 30, 0.08, 0.12, 0, 3.1, sz * 16.7)); // warm cove light
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.75), new THREE.MeshBasicMaterial({ map: ctx.adTexture('PADEL CLUB', '#0d141d', '#eef3f8', 'PREMIUM INDOOR CLUB') }));
    logo.position.set(0, 6.4, sz * 16.7); logo.rotation.y = sz > 0 ? Math.PI : 0; group.add(logo);
  }
  // glass curtain walls on the sides, with city lights behind
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fc0dc, transparent: true, opacity: 0.12, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false });
  for (const sx of [-1, 1]) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(34, 10), glass); g.position.set(sx * 16.5, 5, 0); g.rotation.y = Math.PI / 2; group.add(g);
    for (let z = -16; z <= 16; z += 4) group.add(box(std(0x1a2029, 0.4, 0.6), 0.12, 10, 0.12, sx * 16.5, 5, z));
    const city = new THREE.Mesh(new THREE.PlaneGeometry(60, 14), new THREE.MeshBasicMaterial({ map: ctx.skylineTexture(), transparent: true }));
    city.position.set(sx * 30, 7, 0); city.rotation.y = -sx * Math.PI / 2; group.add(city);
  }
  // roof: ceiling, steel trusses and rows of LED strips
  group.add(box(dark, 36, 0.3, 36, 0, 11.4, 0));
  for (let z = -15; z <= 15; z += 5) group.add(box(std(0x2a313c, 0.4, 0.7), 34, 0.35, 0.3, 0, 10.6, z));
  for (let x = -12; x <= 12; x += 6) group.add(box(std(0x2a313c, 0.4, 0.7), 0.3, 0.3, 34, x, 10.8, 0));
  const led = basic(0xf3f8ff);
  for (const z of [-8, -2.7, 2.7, 8]) for (const x of [-3.4, 3.4]) group.add(box(led, 0.3, 0.08, 4.4, x, 10.3, z));
  // lounge: low crowd, sofas and plants
  ctx.makeCrowd(group, { rows: 3, sides: true, back: false, density: 0.55, pal: [0x2f4a6b, 0x6b4a3a, 0x3d5a52, 0x8a8f99, 0x253244, 0xb08968] });
  const sofa = std(0x3a4252, 0.8);
  for (const sx of [-1, 1]) for (const z of [-12, 12]) {
    group.add(box(sofa, 1.2, 0.5, 2.6, sx * 10, 0.25, z)); group.add(box(sofa, 0.3, 0.9, 2.6, sx * 10.7, 0.7, z));
  }
  const pot = std(0x1c222c, 0.6), leaf = std(0x2f7a4a, 0.8);
  for (const [x, z] of [[-9, -15], [9, -15], [-9, 15], [9, 15], [-13, 0], [13, 0]]) {
    group.add(cyl(pot, 0.4, 0.32, 0.7, x, 0.35, z));
    for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.55 - i * 0.05, 10, 8), leaf); s.position.set(x + Math.sin(i * 2) * 0.3, 1.2 + i * 0.35, z + Math.cos(i * 2) * 0.3); s.castShadow = true; group.add(s); }
  }
  return {
    group,
    light: { bg: 0x0d121a, fog: [0x0d121a, 40, 95], hemi: [0xdfe8ff, 0x2a2f3a, 0.9], sun: { color: 0xfff1dd, intensity: 1.6, pos: [6, 18, 6] }, exposure: 1.05, envIntensity: 0.34 },
    turf: { base: '#2b5f94', out: { color: 0x232b38, rough: 0.35 } },
    ads: { text: 'PADEL CLUB', bg: '#0d141d', fg: '#eef3f8', sub: 'INDOOR · DOUBLES' },
  };
}

// ================================================================= 2. Mediterranean outdoor court

function palm(leafMat, x, z, h = 7.5, lean = 0.12) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const bark = std(0x7a5b3c, 0.95);
  let y = 0, cx = 0, ang = 0;
  for (let i = 0; i < 6; i++) { // a gently curved trunk made of tapered segments
    const seg = h / 6;
    const c = cyl(bark, 0.2 - i * 0.012, 0.22 - i * 0.012, seg, cx + Math.sin(ang) * seg / 2, y + Math.cos(ang) * seg / 2, 0, 8);
    c.rotation.z = -ang;
    g.add(c);
    cx += Math.sin(ang) * seg; y += Math.cos(ang) * seg; ang += lean / 3;
  }
  const topX = cx;
  for (let i = 0; i < 11; i++) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.8, 4, 1), leafMat);
    f.geometry.translate(1.5, 0, 0);
    const p = f.geometry.attributes.position;
    for (let k = 0; k < p.count; k++) p.setY(k, p.getY(k) - Math.pow(p.getX(k) / 3, 2) * 1.1); // droop
    f.position.set(topX, y, 0); f.rotation.set((i % 2) * 0.2, (i / 11) * Math.PI * 2, -0.15 + (i % 3) * 0.12);
    f.castShadow = true; g.add(f);
  }
  return g;
}

function outdoor(ctx) {
  const group = new THREE.Group(); group.name = 'env_outdoor';
  const stucco = canvasMat(128, 128, (g, w, h) => { g.fillStyle = '#efe8dc'; g.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${150 + Math.random() * 60 | 0},${130 + Math.random() * 50 | 0},100,.07)`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); } }, { repeat: [8, 2], rough: 0.95 });
  const roof = canvasMat(128, 64, (g, w, h) => { g.fillStyle = '#b4572f'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(70,25,10,.5)'; g.lineWidth = 3; for (let x = 0; x < w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } }, { repeat: [10, 1], rough: 0.8 });
  // courtyard walls, a long building with arches behind each baseline, shutters and terracotta roof
  for (const sz of [-1, 1]) {
    group.add(box(stucco, 34, 6.5, 0.8, 0, 3.25, sz * 18));
    const r = box(roof, 36, 0.35, 3, 0, 6.9, sz * 18); r.rotation.x = sz * 0.22; group.add(r);
    const arch = new THREE.Shape(); arch.moveTo(-1, 0); arch.lineTo(-1, 2.2); arch.absarc(0, 2.2, 1, Math.PI, 0, true); arch.lineTo(1, 0);
    const archMat = new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 0.9, emissive: 0xffb866, emissiveIntensity: 0.25 });
    for (let x = -12; x <= 12; x += 4.8) {
      const a = new THREE.Mesh(new THREE.ShapeGeometry(arch), archMat); a.position.set(x, 0, sz * 17.58); a.rotation.y = sz > 0 ? Math.PI : 0; group.add(a);
      group.add(box(std(0x2f6b5a, 0.8), 0.45, 2.2, 0.1, x - 1.5, 1.6, sz * 17.55)); group.add(box(std(0x2f6b5a, 0.8), 0.45, 2.2, 0.1, x + 1.5, 1.6, sz * 17.55));
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.5), new THREE.MeshBasicMaterial({ map: ctx.adTexture('PADEL CLUB', '#efe8dc', '#1d3b5a', 'MEDITERRANEAN COURT') }));
    sign.position.set(0, 5.1, sz * 17.55); sign.rotation.y = sz > 0 ? Math.PI : 0; group.add(sign);
  }
  for (const sx of [-1, 1]) group.add(box(stucco, 0.8, 2.4, 34, sx * 15, 1.2, 0));
  // vegetation: palms, cypress, olive trees, flowering pots
  const leafMat = canvasMat(128, 32, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = '#3f8f3a';
    g.beginPath(); g.moveTo(0, h / 2); g.quadraticCurveTo(w * 0.5, 0, w, h / 2); g.quadraticCurveTo(w * 0.5, h, 0, h / 2); g.fill();
    g.strokeStyle = '#2b6a2a'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    for (let x = 6; x < w - 4; x += 6) { g.beginPath(); g.moveTo(x, h / 2); g.lineTo(x + 5, 2); g.moveTo(x, h / 2); g.lineTo(x + 5, h - 2); g.stroke(); }
  }, { alpha: true });
  for (const [x, z, h, l] of [[-12, -12, 8, 0.2], [12.5, -13, 7, -0.18], [-12.5, 12, 7.5, 0.16], [12, 13, 8.5, -0.2], [-14, 0, 6.5, 0.14]]) group.add(palm(leafMat, x, z, h, l));
  const cypress = std(0x1f4a2c, 0.9);
  for (const [x, z] of [[-14, -6], [14, -6], [-14, 7], [14, 6], [-8, -16], [8, 16]]) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.8, 6.5, 10), cypress); c.position.set(x, 3.25, z); c.castShadow = true; group.add(c); }
  const olive = std(0x7e8f6a, 0.9), trunk = std(0x5b4a3a, 0.95);
  for (const [x, z] of [[-10, -15], [10, -15], [-10, 15], [10, 15]]) {
    group.add(cyl(trunk, 0.22, 0.3, 1.8, x, 0.9, z, 8));
    for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(1.1 - i * 0.12, 10, 8), olive); s.position.set(x + Math.sin(i * 1.7) * 0.8, 2.4 + i * 0.25, z + Math.cos(i * 1.7) * 0.8); s.castShadow = true; group.add(s); }
  }
  const pink = std(0xd23d86, 0.8), potM = std(0xb4572f, 0.8);
  for (const [x, z] of [[-6.5, -13], [6.5, -13], [-6.5, 13], [6.5, 13]]) { group.add(cyl(potM, 0.45, 0.35, 0.7, x, 0.35, z)); for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), pink); s.position.set(x + Math.cos(i * 1.1) * 0.35, 0.95 + (i % 3) * 0.12, z + Math.sin(i * 1.1) * 0.35); group.add(s); } }
  // pergola with benches on the sunny side
  const wood = std(0x7b5a3a, 0.8);
  for (const sx of [-1, 1]) {
    for (const z of [-4.2, 4.2]) for (const dx of [0, 2.2]) group.add(box(wood, 0.18, 3, 0.18, sx * (8.4 + dx), 1.5, z, true));
    for (let z = -4.6; z <= 4.6; z += 0.6) group.add(box(wood, 2.8, 0.08, 0.14, sx * 9.5, 3.05, z, true));
    group.add(box(wood, 0.6, 0.45, 8, sx * 8.7, 0.25, 0)); group.add(box(wood, 0.12, 0.8, 8, sx * 9.0, 0.7, 0));
  }
  ctx.makeCrowd(group, { rows: 1, sides: true, back: false, density: 0.35, xBase: 8.5, rowStep: 0.6, stepH: 0.45, pal: [0xf2e6d0, 0x4a7ab0, 0xd9803a, 0x7fa86a, 0xc65a5a], stepMat: wood });
  // distant hills and the sea
  const hill = std(0x6f8a5a, 1), sand = std(0xc9b48a, 1), sea = new THREE.MeshStandardMaterial({ color: 0x2f7fb8, roughness: 0.25, metalness: 0.2 });
  for (const [x, z, s, m] of [[-70, -30, 38, hill], [-40, -80, 46, hill], [60, -60, 40, sand], [80, 20, 36, hill], [30, 90, 44, hill]]) { const h = new THREE.Mesh(new THREE.SphereGeometry(s, 16, 8), m); h.scale.y = 0.45; h.position.set(x, -s * 0.2, z); group.add(h); }
  const seaPlane = new THREE.Mesh(new THREE.PlaneGeometry(300, 140), sea); seaPlane.rotation.x = -Math.PI / 2; seaPlane.position.set(-130, -1.2, 40); group.add(seaPlane);
  return {
    group,
    light: { bg: gradientTex([[0, '#3f86d6'], [0.55, '#9ccaf0'], [0.85, '#f6e3c4'], [1, '#ffd9a1']]), fog: [0xe9dfcf, 55, 170], hemi: [0x9cc7ef, 0xc9a37a, 1.05], sun: { color: 0xffe0b0, intensity: 2.4, pos: [-12, 15, 9] }, exposure: 1.0, envIntensity: 0.3, background2D: true },
    turf: { base: '#2c6aa3', out: { color: 0xb5653f, rough: 0.92, tiles: true } },
    ads: { text: 'PADEL CLUB', bg: '#efe8dc', fg: '#1d3b5a', sub: 'MEDITERRANEAN COURT' },
  };
}

// ================================================================= 3. Floodlit night arena

function night(ctx) {
  const group = new THREE.Group(); group.name = 'env_night';
  const dark = std(0x0b0f16, 0.9), steel = std(0x2b323d, 0.4, 0.7);
  // enclosing bowl
  for (const sz of [-1, 1]) group.add(box(dark, 44, 14, 0.6, 0, 7, sz * 21));
  for (const sx of [-1, 1]) group.add(box(dark, 0.6, 14, 44, sx * 17.5, 7, 0));
  ctx.makeCrowd(group, { rows: 7, sides: true, back: true, density: 0.92, pal: [0xc0392b, 0x2f63d6, 0xeeeeee, 0x1b1f2a, 0xf1c40f, 0x2d8a4e, 0x8e44ad, 0x7f8c8d], stepMat: std(0x141a26, 0.9) });
  // tunnel and signage behind the far baseline
  group.add(box(std(0x05070b, 0.9), 7, 4.2, 2, 0, 2.1, -16.2));
  group.add(box(basic(0x9fd0ff), 6.4, 0.08, 0.1, 0, 4.0, -15.15));
  const flag = (x, col) => { const f = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.6), basic(col)); f.position.set(x, 6.5, -16); group.add(f); };
  [-9, -6.5, 6.5, 9].forEach((x, i) => flag(x, i % 2 ? 0x2f63d6 : 0xd6403a));
  // tournament signage and a hanging scoreboard cube
  for (const sz of [-1, 1]) {
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(22, 2.6), new THREE.MeshBasicMaterial({ map: ctx.adTexture('PADEL CLUB OPEN', '#0a1a33', '#ffffff', 'NIGHT SESSION · FINAL') }));
    banner.position.set(0, 9.5, sz * 20.6); banner.rotation.y = sz > 0 ? Math.PI : 0; group.add(banner);
  }
  const cube = new THREE.Group(); cube.position.set(0, 8.6, 0);
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.6), new THREE.MeshBasicMaterial({ map: ctx.adTexture('PADEL CLUB', '#101a2e', '#9fd0ff', 'OPEN') })); f.rotation.y = i * Math.PI / 2; f.position.set(Math.sin(i * Math.PI / 2) * 1.2, 0, Math.cos(i * Math.PI / 2) * 1.2); cube.add(f); }
  cube.add(box(steel, 2.6, 0.3, 2.6, 0, 0.9, 0)); group.add(cube);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) group.add(cyl(steel, 0.02, 0.02, 3, x * 1.1, 10, z * 1.1, 4));
  // floodlight towers with emissive panels
  const panel = basic(0xfff6e0);
  for (const [x, z] of [[-13, -15], [13, -15], [-13, 15], [13, 15]]) {
    group.add(cyl(steel, 0.18, 0.3, 17, x, 8.5, z, 8));
    const head = new THREE.Group(); head.position.set(x, 17.4, z); head.lookAt(0, 0, 0);
    head.add(box(steel, 3.4, 2.4, 0.3, 0, 0, 0));
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) { const p = box(panel, 0.7, 0.6, 0.06, -1.2 + c * 0.8, -0.8 + r * 0.8, 0.2); head.add(p); }
    group.add(head);
  }
  // stars
  const starPos = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) { const a = Math.random() * Math.PI * 2, e = 0.25 + Math.random() * 1.1, r = 140; starPos[i * 3] = Math.cos(a) * Math.cos(e) * r; starPos[i * 3 + 1] = Math.sin(e) * r; starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r; }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  group.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 0.9, sizeAttenuation: false, fog: false })));
  return {
    group,
    light: { bg: 0x04070d, fog: [0x04070d, 48, 120], hemi: [0x2a3d6b, 0x090c14, 0.55], sun: { color: 0xfff3df, intensity: 2.5, pos: [4, 22, 3] }, exposure: 1.1, envIntensity: 0.22 },
    turf: { base: '#2a58a6', out: { color: 0x12161e, rough: 0.6 } },
    ads: { text: 'PADEL CLUB', bg: '#0a1a33', fg: '#9fd0ff', sub: 'OPEN · LIVE' },
  };
}

// ================================================================= 4. Sunset rooftop

function rooftop(ctx) {
  const group = new THREE.Group(); group.name = 'env_rooftop';
  const concrete = std(0x8b8f96, 0.95), dark = std(0x2a2f3a, 0.8), wood = std(0x8a6a48, 0.8);
  // roof deck and low parapet all round
  group.add(box(concrete, 40, 0.3, 46, 0, -0.17, 0));
  for (const sz of [-1, 1]) group.add(box(concrete, 40, 1.1, 0.6, 0, 0.45, sz * 22.7));
  for (const sx of [-1, 1]) group.add(box(concrete, 0.6, 1.1, 46, sx * 19.7, 0.45, 0));
  // timber deck around the court
  for (const sx of [-1, 1]) group.add(box(wood, 5, 0.06, 24, sx * 8.2, 0.03, 0));
  // skyline: towers with lit windows on every side
  const winTex = () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#5a4a72'; g.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 124; y += 10) for (let x = 6; x < 58; x += 12) { g.fillStyle = Math.random() < 0.45 ? 'rgba(255,205,120,.95)' : 'rgba(90,76,112,.9)'; g.fillRect(x, y, 6, 6); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  };
  const towerTex = [winTex(), winTex(), winTex()];
  let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2, r = 42 + rnd() * 34, h = 14 + rnd() * 46, w = 6 + rnd() * 9;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshBasicMaterial({ map: towerTex[i % 3] }));
    m.position.set(Math.cos(a) * r, h / 2 - 6, Math.sin(a) * r); group.add(m);
  }
  // string lights across the court, and a water tank and plants for character
  const bulb = basic(0xfff0b8);
  for (const sz of [-1, 1]) for (let x = -18; x <= 18; x += 1.5) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), bulb); b.position.set(x, 5.6 - 0.6 * Math.cos((x / 18) * Math.PI / 2), sz * 12.5); group.add(b); }
  for (const sx of [-1, 1]) for (let z = -14; z <= 14; z += 1.5) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), bulb); b.position.set(sx * 10.5, 5.4 - 0.5 * Math.cos((z / 14) * Math.PI / 2), z); group.add(b); }
  for (const sx of [-1, 1]) for (const z of [-12.5, 12.5]) group.add(cyl(dark, 0.06, 0.06, 5.6, sx * 10.5, 2.8, z, 6));
  group.add(cyl(dark, 1.6, 1.6, 3, -15, 1.5, -17, 14)); group.add(cyl(std(0x3a3f4b, 0.6), 1.7, 1.7, 0.3, -15, 3.1, -17, 14));
  const plant = std(0x3f8f4a, 0.9), pot = std(0xb4572f, 0.8);
  for (const [x, z] of [[-9.2, -11.5], [9.2, -11.5], [-9.2, 11.5], [9.2, 11.5], [-9.2, 0], [9.2, 0]]) {
    group.add(cyl(pot, 0.45, 0.35, 0.7, x, 0.35, z));
    for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.4 - i * 0.04, 8, 6), plant); s.position.set(x + Math.sin(i * 1.7) * 0.3, 1.0 + i * 0.22, z + Math.cos(i * 1.7) * 0.3); s.castShadow = true; group.add(s); }
  }
  // lounge benches and a few spectators
  for (const sx of [-1, 1]) { group.add(box(wood, 0.6, 0.45, 9, sx * 8.4, 0.25, 0)); group.add(box(wood, 0.12, 0.8, 9, sx * 8.75, 0.7, 0)); }
  ctx.makeCrowd(group, { rows: 1, sides: true, back: false, density: 0.3, xBase: 8.3, rowStep: 0.6, stepH: 0.0001, pal: [0xf2e6d0, 0x4a7ab0, 0xd9803a, 0x7fa86a, 0xc65a5a], stepMat: wood });
  // sunset sky and sun
  const sky = new THREE.Mesh(new THREE.SphereGeometry(160, 24, 12), new THREE.MeshBasicMaterial({ map: gradientTex([[0, '#2a2f6b'], [0.45, '#b4507a'], [0.62, '#ff9a5c'], [0.72, '#ffd08a'], [1, '#ffe9b8']]), side: THREE.BackSide, fog: false }));
  sky.scale.y = 0.6; group.add(sky);
  const sun = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false })); sun.position.set(-95, 14, -60); group.add(sun);
  return {
    group,
    light: { bg: 0x2a2f6b, fog: [0xd88a74, 55, 150], hemi: [0xffc9a8, 0x4a3a4e, 0.9], sun: { color: 0xffc58a, intensity: 1.9, pos: [-14, 9, -10] }, exposure: 1.0, envIntensity: 0.3 },
    turf: { base: '#2b6b8f', out: { color: 0x7b7f87, rough: 0.95 } },
    ads: { text: 'PADEL CLUB', bg: '#1d2540', fg: '#ffd08a', sub: 'SUNSET ROOFTOP' },
  };
}

// 'outdoor' is the Mediterranean Club and 'night' the Night Arena (envs-pro.js). The earlier simple versions stay as a fallback: if the
// art-directed builder throws, the old one is used and the error is logged.
const LEGACY = { outdoor, night, indoor, rooftop };
export const ENVIRONMENTS = { indoor: indoorClub, outdoor: mediterraneanClub, night: nightArena, rooftop: rooftopSunset };
export function buildEnvironment(id, ctx) {
  try { return (ENVIRONMENTS[id] || indoor)(ctx); } catch (err) {
    console.error('[environment] failed to build', id, err);
    return (LEGACY[id] || indoor)(ctx);
  }
}
