// Procedural, game-ready character and racket models (no external files, so nothing can fail to load).
// Units are metres. A character is ~1.8 m tall before its archetype scale. The rig groups
// (hips > spine > shoulders > elbows, hips > thighs > knees > feet) are what the animation system drives.

import * as THREE from 'three';
import { ARCHETYPES, SKIN_TONES, HAIR_COLORS, RACKETS } from '/shared/looks.js';

const TEAM = [
  { main: 0x233f86, dark: 0x16285a, light: 0x7d9be0, trim: 0xffffff }, // team A: blue
  { main: 0xb4312d, dark: 0x6f1d1a, light: 0xf0948f, trim: 0x15181d }, // team B: red
];

function canvasTex(w, h, draw, { repeat, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

// ===================================================================== rackets

function chaikin(pts, n) {
  let p = pts;
  for (let k = 0; k < n; k++) {
    const q = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      q.push(new THREE.Vector2(a.x * 0.75 + b.x * 0.25, a.y * 0.75 + b.y * 0.25), new THREE.Vector2(a.x * 0.25 + b.x * 0.75, a.y * 0.25 + b.y * 0.75));
    }
    p = q;
  }
  return p;
}

/** Outline of the racket head (counter-clockwise), w x h metres, centred on the origin. */
function headOutline(shape, w, h) {
  const pts = [];
  if (shape === 'diamond') {
    const base = [[0, 0.5], [-0.5, 0.14], [-0.2, -0.42], [0, -0.5], [0.2, -0.42], [0.5, 0.14]].map(([x, y]) => new THREE.Vector2(x * w, y * h));
    return chaikin(base, 3);
  }
  const n = 72;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const yn = Math.sin(t);
    const f = shape === 'teardrop' ? 0.8 + 0.2 * yn : 1; // teardrop: widest near the top, narrowing to the throat
    pts.push(new THREE.Vector2(-(w / 2) * Math.cos(t) * f, (h / 2) * yn));
  }
  return pts;
}

function perforationMap(pattern) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); // white = solid
    g.fillStyle = '#000'; // black = hole
    const dot = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
    if (pattern === 'radial') {
      for (let ring = 1; ring <= 8; ring++) {
        const R = ring * 15;
        const n = 6 + ring * 4;
        for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; dot(w / 2 + Math.cos(a) * R, h / 2 + Math.sin(a) * R * 1.05, 3.1); }
      }
    } else {
      const step = pattern === 'dense' ? 14 : pattern === 'sparse' ? 26 : 19;
      const r = pattern === 'dense' ? 3.2 : pattern === 'sparse' ? 6.5 : 4.4;
      for (let y = step / 2, row = 0; y < h; y += step * 0.866, row++) for (let x = (row % 2) * step / 2 + step / 2; x < w; x += step) dot(x, y, r);
    }
    g.fillStyle = '#fff'; g.fillRect(0, 205, w, 51); // solid zone near the throat
  }, { srgb: false });
}

const tapeTex = (accent) => canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#15181d'; g.fillRect(0, 0, w, h);
  g.strokeStyle = hex(accent); g.lineWidth = 6;
  for (let i = -h; i < w + h; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); }
}, { repeat: [1, 6] });

/**
 * A padel racket (pala): bevelled frame, perforated face, throat bridge, wrapped grip, butt cap and wrist cord.
 * Origin = the middle of the grip, the head extends along -y, the face normal is +z. Total length ~0.47 m.
 */
export function buildRacket(design = RACKETS[0]) {
  const g = new THREE.Group();
  g.name = `racket_${design.name.replace(/\W+/g, '_')}`;
  const W = design.shape === 'round' ? 0.255 : design.shape === 'diamond' ? 0.245 : 0.24;
  const Hh = design.shape === 'round' ? 0.26 : design.shape === 'diamond' ? 0.285 : 0.265;
  const outline = headOutline(design.shape, W, Hh);
  const inner = outline.map((p) => p.clone().multiplyScalar(0.86));

  const frameMat = new THREE.MeshStandardMaterial({ color: design.frame, roughness: 0.38, metalness: 0.25 });
  const outer = new THREE.Shape(outline);
  outer.holes.push(new THREE.Path(inner.slice().reverse()));
  const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.032, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 1 }), frameMat);
  frame.position.z = -0.016; frame.castShadow = true;

  const faceGeo = new THREE.ShapeGeometry(new THREE.Shape(inner));
  const fw = W * 0.86, fh = Hh * 0.86;
  const holes = perforationMap(design.holes);
  holes.repeat.set(1 / fw, 1 / fh); holes.offset.set(0.5, 0.5);
  holes.wrapS = holes.wrapT = THREE.ClampToEdgeWrapping;
  const faceMat = new THREE.MeshStandardMaterial({ color: design.face, roughness: 0.55, alphaMap: holes, alphaTest: 0.5, side: THREE.DoubleSide });
  const faceA = new THREE.Mesh(faceGeo, faceMat); faceA.position.z = 0.0125;
  const faceB = new THREE.Mesh(faceGeo, faceMat); faceB.position.z = -0.0125;
  const head = new THREE.Group();
  head.add(frame, faceA, faceB);
  head.position.y = -0.085 - 0.05 - Hh / 2; // below the grip and the throat
  g.add(head);

  // throat bridge with a small open triangle, like a real pala
  const throat = new THREE.Shape([new THREE.Vector2(-0.034, 0), new THREE.Vector2(0.034, 0), new THREE.Vector2(0.014, -0.058), new THREE.Vector2(-0.014, -0.058)]);
  const cut = new THREE.Path([new THREE.Vector2(-0.012, -0.012), new THREE.Vector2(0.012, -0.012), new THREE.Vector2(0, -0.042)]);
  throat.holes.push(cut);
  const th = new THREE.Mesh(new THREE.ExtrudeGeometry(throat, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 }), frameMat);
  th.position.set(0, -0.082, -0.013); g.add(th);

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0205, 0.0235, 0.17, 14), new THREE.MeshStandardMaterial({ map: tapeTex(design.accent), roughness: 0.9 }));
  grip.castShadow = true; g.add(grip);
  const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.014, 14), new THREE.MeshStandardMaterial({ color: design.accent, roughness: 0.5 }));
  butt.position.y = 0.092; g.add(butt);
  const cord = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.003, 6, 18), new THREE.MeshStandardMaterial({ color: design.accent, roughness: 0.7 }));
  cord.position.set(0.012, 0.085, 0); cord.rotation.y = Math.PI / 2; g.add(cord);
  // a thin accent line along the frame so each design reads from a distance
  const rim = new THREE.Mesh(new THREE.ExtrudeGeometry((() => { const s = new THREE.Shape(inner.map((p) => p.clone().multiplyScalar(1.07))); s.holes.push(new THREE.Path(inner.slice().reverse().map((p) => p.clone().multiplyScalar(1.0)))); return s; })(), { depth: 0.043, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: design.accent, roughness: 0.45 }));
  rim.position.z = -0.0215; head.add(rim);
  return g;
}

// ===================================================================== characters

const blob = { geo: null, mat: null };
/** The shared soft-shadow geometry and material (created on first use). */
export function blobShadow() {
  if (!blob.geo) {
    blob.geo = new THREE.CircleGeometry(0.5, 20);
    blob.mat = new THREE.MeshBasicMaterial({
      map: canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }),
      transparent: true, depthWrite: false,
    });
  }
  return blob;
}

function shirtTexture(team, arch, kit) {
  const T = TEAM[team];
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = hex(T.main); g.fillRect(0, 0, w, h);
    // fabric weave
    g.fillStyle = 'rgba(255,255,255,.035)';
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    // darker side panels
    g.fillStyle = hex(T.dark);
    g.fillRect(w * 0.22, 0, w * 0.06, h); g.fillRect(w * 0.72, 0, w * 0.06, h);
    if (arch % 2 === 0 && team === 1) { // diagonal sash like a pro kit
      g.fillStyle = hex(T.trim);
      g.beginPath(); g.moveTo(0, h * 0.9); g.lineTo(w * 0.35, 0); g.lineTo(w * 0.5, 0); g.lineTo(w * 0.15, h); g.fill();
      g.beginPath(); g.moveTo(w * 0.5, h * 0.9); g.lineTo(w * 0.85, 0); g.lineTo(w, 0); g.lineTo(w * 0.65, h); g.fill();
    } else {
      g.fillStyle = hex(T.light);
      g.fillRect(0, h * 0.82, w, h * 0.04);
    }
    // chest logo (front is u = 0 / 1 on a lathe)
    g.fillStyle = hex(kit === 'tank' ? T.trim : T.trim);
    const logo = (cx) => { g.beginPath(); g.arc(cx, h * 0.32, 7, 0, 7); g.fill(); g.fillStyle = hex(T.dark); g.beginPath(); g.arc(cx, h * 0.32, 3.4, 0, 7); g.fill(); g.fillStyle = hex(T.trim); };
    logo(w * 0.03); logo(w * 0.97);
  });
}

/**
 * @param look {arch, hair, skin, racket}
 * @param team 0 = blue, 1 = red
 */
export function buildCharacter(look, team) {
  const A = ARCHETYPES[look.arch] || ARCHETYPES[0];
  const T = TEAM[team];
  const female = A.kit === 'tank';
  const skinTone = SKIN_TONES[look.skin % SKIN_TONES.length];
  const hairCol = HAIR_COLORS[(look.hair + look.skin) % HAIR_COLORS.length];
  const S = A.shoulder, B = A.build, Lm = A.limb;

  const cloth = (color, rough = 0.62) => new THREE.MeshPhysicalMaterial({ color, roughness: rough, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff) });
  const shirt = new THREE.MeshPhysicalMaterial({ map: shirtTexture(team, A.id, A.kit), roughness: 0.62, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff) });
  const shirtPlain = cloth(T.main);
  const shorts = cloth(team === 0 ? 0xf2f4f7 : 0x15181d, 0.7);
  const skirtCol = cloth(team === 0 ? 0xf2f4f7 : 0x15181d, 0.7);
  const trim = cloth(T.trim, 0.7);
  const accent = new THREE.MeshStandardMaterial({ color: T.light, roughness: 0.55 });
  const skin = new THREE.MeshStandardMaterial({ color: skinTone, roughness: 0.72 });
  const hair = new THREE.MeshStandardMaterial({ color: hairCol, roughness: 0.85 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0xf6f6f6, roughness: 0.5 });
  const shoeTab = new THREE.MeshStandardMaterial({ color: T.main, roughness: 0.55 });
  const sole = new THREE.MeshStandardMaterial({ color: T.light, roughness: 0.6 });
  const sock = cloth(0xffffff, 0.9);
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.6 });

  const cast = (m) => { m.castShadow = true; return m; };
  const cap = (r, len, mat) => cast(new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 12), mat));
  const taper = (rt, rb, h, mat, seg = 14) => cast(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat));
  const ball = (r, mat) => cast(new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat));
  const lathe = (pts, mat, seg = 24) => cast(new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), mat));
  // A limb segment hanging down from the origin: radius r0 at the top, r1 at the bottom, with a muscle belly (bulge, as a fraction
  // of the radius) centred at `at` (0..1 down the segment). Smooth like skin, unlike a plain cone.
  const muscle = (r0, r1, len, at, bulge, mat, seg = 20, depth = 1) => {
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14, base = r0 + (r1 - r0) * t, sm = (x) => { x = Math.min(1, x); return x * x * (3 - 2 * x); };
      const k = Math.exp(-(((t - at) / 0.28) ** 2)) * sm(t / 0.2) * sm((1 - t) / 0.2); // no bulge at the ends: joints stay continuous
      pts.push([base * (1 + bulge * k), -t * len]);
    }
    const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
    g.scale(1, 1, depth);
    return cast(new THREE.Mesh(g, mat));
  };

  const root = new THREE.Group();
  root.name = `athlete_${A.key}_team${team}`;
  root.scale.setScalar(A.height);
  const hips = new THREE.Group(); hips.name = 'hips'; root.add(hips);

  // pelvis + shorts or skirt
  const pelvis = lathe([[0.001, -0.12], [0.17 * B, -0.12], [0.2 * B, -0.05], [0.205 * B, 0.0], [0.178 * B, 0.065], [0.001, 0.065]], female ? skirtCol : shorts, 24);
  pelvis.scale.z = 0.82; hips.add(pelvis);
  for (const gx of [-1, 1]) { const glute = ball(0.08 * B, female ? skirtCol : shorts); glute.scale.set(1, 1.05, 0.9); glute.position.set(gx * 0.075 * B, -0.045, -0.07 * B); hips.add(glute); }
  const waist = new THREE.Mesh(new THREE.TorusGeometry(0.153 * B, 0.014, 6, 24), accent);
  waist.rotation.x = Math.PI / 2; waist.position.y = 0.055; waist.scale.set(1, 0.8, 1); hips.add(waist);
  if (female) {
    const skirt = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.165 * B, 0.27 * B, 0.2, 28, 1, true), new THREE.MeshPhysicalMaterial({ color: team === 0 ? 0xf2f4f7 : 0x15181d, roughness: 0.7, sheen: 0.5, side: THREE.DoubleSide })));
    skirt.position.y = -0.1; skirt.scale.z = 0.85; hips.add(skirt);
    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.27 * B, 0.007, 5, 28), accent); hem.rotation.x = Math.PI / 2; hem.position.y = -0.2; hem.scale.y = 0.85; hips.add(hem);
  }

  // legs: tapered thigh and calf, shorts hem (not on skirts), sock, shoe with heel tab, toe cap and laces
  const leg = (sx) => {
    const thigh = new THREE.Group(); thigh.position.set(sx * 0.108 * (0.9 + 0.1 * B), -0.03, 0); hips.add(thigh);
    const th = muscle(0.118 * Lm, 0.07 * Lm, 0.44, 0.3, 0.17, skin, 24, 1.1); thigh.add(th);
    if (!female) {
      const hem = taper(0.128 * Lm, 0.118 * Lm, 0.27, shorts, 22); hem.position.y = -0.125; hem.scale.z = 1.1; thigh.add(hem);
      const hemTrim = new THREE.Mesh(new THREE.TorusGeometry(0.118 * Lm, 0.008, 5, 22), accent); hemTrim.rotation.x = Math.PI / 2; hemTrim.position.y = -0.26; hemTrim.scale.y = 1.1; thigh.add(hemTrim);
    }
    const knee = new THREE.Group(); knee.position.y = -0.44; thigh.add(knee);
    knee.add(ball(0.05 * Lm, skin));
    const sh = muscle(0.068 * Lm, 0.042 * Lm, 0.42, 0.22, 0.3, skin, 22, 1.12); knee.add(sh);
    const sk = taper(0.05 * Lm, 0.056 * Lm, 0.14, sock, 16); sk.position.y = -0.365; knee.add(sk);
    const foot = new THREE.Group(); foot.position.y = -0.44; knee.add(foot);
    const up = ball(0.056, shoe); up.scale.set(1.12, 0.78, 2.1); up.position.set(0, -0.03, 0.045); foot.add(up); // upper
    const toe = ball(0.052, shoe); toe.scale.set(1.12, 0.66, 1.3); toe.position.set(0, -0.04, 0.125); foot.add(toe);
    const heel = ball(0.05, shoeTab); heel.scale.set(1.0, 0.9, 0.9); heel.position.set(0, -0.03, -0.055); foot.add(heel);
    const lace = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.008, 0.085), shoeTab); lace.position.set(0, 0.022, 0.06); lace.rotation.x = -0.25; foot.add(lace);
    const so = ball(0.06, sole); so.scale.set(1.15, 0.26, 2.8); so.position.set(0, -0.07, 0.05); foot.add(so);
    return { thigh, knee, foot };
  };
  const legL = leg(1), legR = leg(-1);

  // torso: a lathe profile per kit, then scaled to the archetype's shoulders and depth
  const spine = new THREE.Group(); spine.name = 'spine'; spine.position.y = 0.06; hips.add(spine);
  const prof = female
    ? [[0.001, 0], [0.135, 0.01], [0.138, 0.08], [0.15, 0.18], [0.172, 0.3], [0.192, 0.4], [0.2, 0.46], [0.182, 0.52], [0.105, 0.585], [0.062, 0.62], [0.001, 0.63]]
    : [[0.001, 0], [0.15, 0.01], [0.155, 0.08], [0.165, 0.18], [0.188, 0.3], [0.215, 0.4], [0.228, 0.47], [0.205, 0.54], [0.115, 0.6], [0.065, 0.635], [0.001, 0.64]];
  const torso = lathe(prof, shirt, 28);
  torso.scale.set(S, 1, 0.8 * B); spine.add(torso);
  if (female) { // tank top: straps over bare shoulders
    for (const sx of [-1, 1]) { const strap = cap(0.014, 0.1, shirtPlain); strap.position.set(sx * 0.07 * S, 0.58, 0.02); strap.rotation.z = -sx * 0.3; spine.add(strap); }
  } else {
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.014, 6, 16), trim); collar.rotation.x = Math.PI / 2; collar.position.y = 0.625; spine.add(collar);
  }
  const numTex = canvasTex(64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = hex(T.trim); g.font = '800 40px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String((A.id * 7 + 3 + team * 10) % 99), 32, 34); });
  const num = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: numTex, transparent: true, depthWrite: false }));
  num.position.set(0, 0.36, -0.185 * B); num.rotation.y = Math.PI; spine.add(num);
  const neck = taper(0.058, 0.068, 0.11, skin, 16); neck.position.y = 0.685; spine.add(neck);
  for (const sx of [-1, 1]) { const trap = ball(0.06, female ? skin : shirtPlain); trap.scale.set(1.6, 0.7, 1.15); trap.position.set(sx * 0.095 * S, 0.62, -0.01); trap.rotation.z = -sx * 0.5; spine.add(trap); } // trapezius slope

  // head: face, ears, hair or cap
  const head = new THREE.Group(); head.name = 'head'; head.position.y = 0.78; head.scale.setScalar(A.head); spine.add(head);
  const skull = cast(new THREE.Mesh(new THREE.SphereGeometry(0.105, 26, 20), skin)); skull.scale.set(0.9, 1.06, 1); head.add(skull);
  const jaw = ball(female ? 0.064 : 0.072, skin); jaw.scale.set(1, 0.85, 0.95); jaw.position.set(0, -0.055, 0.03); head.add(jaw);
  const nose = ball(0.016, skin); nose.scale.set(0.9, 1.1, 1.2); nose.position.set(0, -0.008, 0.108); head.add(nose);
  for (const sx of [-1, 1]) {
    const eye = ball(0.012, new THREE.MeshStandardMaterial({ color: 0xffffff })); eye.position.set(sx * 0.036, 0.018, 0.092); eye.scale.z = 0.6; head.add(eye);
    const pupil = ball(0.0065, dark); pupil.position.set(sx * 0.036, 0.018, 0.098); head.add(pupil);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.034, female ? 0.005 : 0.008, 0.008), hair); brow.position.set(sx * 0.036, 0.04, 0.097); brow.rotation.z = -sx * (female ? 0.2 : 0.1); head.add(brow);
    const ear = ball(0.02, skin); ear.scale.set(0.5, 1, 0.8); ear.position.set(sx * 0.095, 0, 0); head.add(ear);
  }
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.005, 0.006), new THREE.MeshStandardMaterial({ color: female ? 0xa04848 : 0x7a3a3a })); mouth.position.set(0, -0.05, 0.1); head.add(mouth);

  const style = look.hair;
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.112, 24, 14, 0, Math.PI * 2, 0, Math.PI * (style === 0 || style === 6 ? 0.5 : 0.6)), hair);
  hairCap.position.y = 0.012; hairCap.rotation.x = -0.3; hairCap.castShadow = true; head.add(hairCap);
  if (style === 6) hairCap.scale.setScalar(0.985);
  if (style === 1) { const tail = cap(0.03, 0.15, hair); tail.position.set(0, -0.04, -0.13); tail.rotation.x = 0.4; head.add(tail); const tie = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 5, 10), accent); tie.position.set(0, 0.03, -0.115); head.add(tie); }
  if (style === 2) { const bun = ball(0.052, hair); bun.position.set(0, 0.115, -0.04); head.add(bun); const tie = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.007, 5, 12), accent); tie.rotation.x = Math.PI / 2; tie.position.set(0, 0.09, -0.04); head.add(tie); }
  if (style === 3) for (let i = 0; i < 10; i++) { const c = ball(0.034, hair); const a = (i / 10) * Math.PI * 2; c.position.set(Math.sin(a) * 0.1, 0.06 + (i % 2) * 0.03, Math.cos(a) * 0.09 - 0.02); head.add(c); }
  if (style === 4) { // long, loose hair
    const back = cap(0.075, 0.2, hair); back.scale.set(1.15, 1, 0.7); back.position.set(0, -0.1, -0.08); head.add(back);
    for (const sx of [-1, 1]) { const side = cap(0.026, 0.16, hair); side.position.set(sx * 0.09, -0.05, -0.02); head.add(side); }
  }
  if (style === 5) { // backward cap in the team colour with a light brim
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.118, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), new THREE.MeshStandardMaterial({ color: team === 0 ? 0xdfe3ea : 0xe6e2dc, roughness: 0.7 }));
    dome.position.y = 0.03; dome.rotation.x = -0.15; dome.castShadow = true; head.add(dome);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.008, 0.09), new THREE.MeshStandardMaterial({ color: T.main, roughness: 0.7 }));
    brim.position.set(0, 0.04, -0.14); brim.rotation.x = 0.12; head.add(brim);
  }

  // arms: sleeves on tees, bare on tanks; wristbands on both wrists; hand with thumb
  const arm = (sx, racketHand) => {
    const sh = new THREE.Group(); sh.position.set(sx * 0.225 * S, 0.53, 0); sh.rotation.order = 'YXZ'; spine.add(sh);
    const delt = ball(0.082 * Lm, female ? skin : shirtPlain); delt.scale.set(1, 1.1, 1.02); sh.add(delt); // deltoid
    const up = muscle(0.064 * Lm, 0.046 * Lm, 0.3, 0.32, 0.18, skin, 20, 1.04); sh.add(up);
    if (!female) {
      const sleeve = taper(0.076 * Lm, 0.066 * Lm, 0.16, shirtPlain, 20); sleeve.position.y = -0.09; sleeve.scale.z = 1.04; sh.add(sleeve);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.066 * Lm, 0.008, 5, 16), accent); cuff.rotation.x = Math.PI / 2; cuff.position.y = -0.17; sh.add(cuff);
    }
    const elbow = new THREE.Group(); elbow.position.y = -0.31; sh.add(elbow);
    elbow.add(ball(0.04 * Lm, skin));
    const fa = muscle(0.052 * Lm, 0.034 * Lm, 0.29, 0.16, 0.16, skin, 20, 0.98); elbow.add(fa);
    const wb = taper(0.039 * Lm, 0.039 * Lm, 0.05, racketHand ? accent : trim, 16); wb.position.y = -0.283; elbow.add(wb);
    const hand = new THREE.Group(); hand.position.y = -0.335; elbow.add(hand);
    const palm = ball(0.048, skin); palm.scale.set(0.95, 1.25, 0.72); palm.position.y = -0.012; hand.add(palm);
    const fingers = ball(0.04, skin); fingers.scale.set(1.05, 0.8, 0.8); fingers.position.set(0, -0.06, 0.012); hand.add(fingers);
    const thumb = ball(0.014, skin); thumb.scale.set(1, 1.8, 1); thumb.position.set(-sx * 0.04, -0.01, 0.022); thumb.rotation.z = sx * 0.5; hand.add(thumb);
    return { sh, elbow, hand };
  };
  const armL = arm(1, false), armR = arm(-1, true); // the player's right hand is local -x

  const racket = buildRacket(RACKETS[look.racket % RACKETS.length]);
  racket.position.y = -0.335;
  armR.elbow.add(racket);

  if (!blob.geo) {
    blob.geo = new THREE.CircleGeometry(0.5, 20);
    blob.mat = new THREE.MeshBasicMaterial({
      map: canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }),
      transparent: true, depthWrite: false,
    });
  }
  const shadow = new THREE.Mesh(blob.geo, blob.mat);
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; root.add(shadow);

  return {
    root, blob: shadow, hips, spine, head, legL, legR, armL, armR, racket,
    team, look, phase: Math.random() * 6, idlePh: Math.random() * 6, yaw: team === 0 ? 0 : Math.PI,
    split: 0, lastY: 0,
  };
}

/** Free all GPU resources of a character (used when looks change). */
export function disposeCharacter(rig) {
  if (rig.statue) { rig.markMat.dispose(); return; } // geometry, materials and textures belong to the shared loaded model
  rig.root.traverse((o) => {
    if (o.geometry && o.geometry !== blob.geo) o.geometry.dispose();
    if (o.material && o.material !== blob.mat) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose(); m.alphaMap?.dispose(); m.dispose(); }); }
  });
}
