// Rendering only: court, players, ball. No game rules live here.
import * as THREE from 'three';
import { RoomEnvironment } from '/vendor/three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from '/vendor/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '/vendor/three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '/vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '/vendor/three/examples/jsm/postprocessing/OutputPass.js';
import { COURT } from '/shared/constants.js';
import { DEFAULT_LOOKS } from '/shared/looks.js';
import { buildCharacter, disposeCharacter } from './characters.js';
import { buildEnvironment } from './envs.js';
import { netHeight } from '/shared/physics.js';

const TEAM_COLORS = [0xf2f5f8, 0x3d78c4]; // team A white, team B blue
const ACCENT = 0xd4f23c;

function canvasTex(w, h, draw, { repeat, aniso = 4 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

function turfTexture(base = '#2b5f94') {
  const W = 1024, H = 2048; // 102.4 px per metre
  return canvasTex(W, H, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 60000; i++) { // fibre speckle
      const x = Math.random() * W, y = Math.random() * H;
      g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.06)';
      g.fillRect(x, y, 2, 2);
    }
    for (let y = 0; y < H; y += 128) { // mowing stripes
      g.fillStyle = (y / 128) % 2 ? 'rgba(255,255,255,.018)' : 'rgba(0,0,0,.02)';
      g.fillRect(0, y, W, 128);
    }
    g.strokeStyle = '#f4f6f8'; g.lineWidth = 6; g.lineCap = 'square';
    const px = (x) => (x + 5) * 102.4;
    const pz = (z) => (z + 10) * 102.4;
    g.strokeRect(3, 3, W - 6, H - 6);
    for (const z of [-COURT.SERVICE_LINE, COURT.SERVICE_LINE]) { g.beginPath(); g.moveTo(0, pz(z)); g.lineTo(W, pz(z)); g.stroke(); }
    g.beginPath(); g.moveTo(px(0), pz(-COURT.SERVICE_LINE)); g.lineTo(px(0), pz(COURT.SERVICE_LINE)); g.stroke();
  }, { aniso: 8 });
}

function meshTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(200,210,225,.9)'; g.lineWidth = 6;
    g.strokeRect(0, 0, w, h);
  }, { repeat: [1, 1] });
}

/** A horizontal advertising board / sign texture (1024x128). */
function bannerTexture(text = 'PADEL CLUB', bg = '#0d141d', fg = '#eef3f8', sub = 'INDOOR · DOUBLES') {
  return canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d4f23c'; g.beginPath(); g.arc(70, 64, 26, 0, Math.PI * 2); g.fill();
    g.fillStyle = fg; g.font = '800 62px Segoe UI, Arial'; g.textBaseline = 'middle';
    g.fillText(text, 120, 68);
    const x = 120 + g.measureText(text).width + 40;
    g.fillStyle = '#3d6492'; g.fillRect(x, 40, 4, 48);
    g.fillStyle = fg; g.globalAlpha = 0.6; g.font = '600 34px Segoe UI, Arial'; g.fillText(sub, x + 30, 66); g.globalAlpha = 1;
  });
}

// Pose vector: [pelvisYaw, spineYaw, lean, kneeBend, rShYaw, rShPitch, rElbow, lShYaw, lShPitch, lElbow, step]
// yaw < 0 = the player's right; pitch < 0 raises the arm forward/up; step > 0 = right foot forward.
const READY = [0, 0, 0.12, 0.32, -0.45, -0.7, 1.7, 0.35, -0.5, 0.9, 0];
// serving: ball bounced in the left hand, racket low and back
// after a point: the winners celebrate, the losers hang their head
const EMOTE_WIN = [0.1, 0.15, -0.05, 0.25, -0.6, -2.9, 0.4, 0.4, -2.7, 0.5, 0];
const EMOTE_LOSE = [0, 0, 0.3, 0.15, -0.2, -0.25, 0.5, 0.12, -0.1, 0.3, 0];
const SERVE_READY = [0.05, -0.2, 0.15, 0.45, -0.3, 0.15, 0.5, 0.15, -0.2, 0.5, -0.1];
// each shot: [load, contact, follow]
const SWING = {
  forehand: [[-0.5, -0.55, 0.1, 0.55, -1.25, -0.45, 1.2, -0.1, -1.2, 0.5, -0.35], [0.35, 0.5, 0.22, 0.5, -0.4, -0.95, 0.75, 0.6, -0.6, 0.9, 0.35], [0.9, 1.0, 0.25, 0.4, 0.8, -1.35, 1.5, 0.7, -0.15, 1.0, 0.25]],
  backhand: [[0.45, 0.75, 0.1, 0.55, 1.0, -0.8, 1.1, 0.5, -0.4, 0.6, -0.3], [-0.1, -0.1, 0.22, 0.5, -0.1, -1.15, 0.5, 0.9, 0.1, 0.4, 0.3], [-0.6, -0.9, 0.25, 0.4, -1.3, -1.25, 0.9, 1.0, 0.2, 0.4, 0.25]],
  volley: [[-0.25, -0.3, 0.15, 0.5, -0.8, -1.0, 1.0, 0.3, -0.9, 0.8, -0.1], [0.1, 0.2, 0.2, 0.5, -0.2, -1.25, 0.7, 0.3, -0.5, 0.9, 0.2], [0.15, 0.25, 0.2, 0.45, -0.1, -1.2, 0.8, 0.3, -0.5, 0.9, 0.15]],
  lob: [[-0.3, -0.35, 0.05, 0.8, -0.6, 0.15, 0.9, 0.3, -0.3, 0.6, -0.2], [0.1, 0.2, 0.0, 0.55, -0.2, -1.0, 0.6, 0.5, -0.4, 0.7, 0.2], [0.3, 0.4, -0.1, 0.15, 0.2, -2.5, 0.3, 0.8, -0.8, 0.5, 0.1]],
  smash: [[-0.4, -0.5, -0.18, 0.5, -0.6, -2.5, 2.3, 0.1, -2.2, 0.5, -0.2], [0.3, 0.35, 0.05, 0.3, -0.15, -3.0, 0.25, 0.4, -0.6, 1.0, 0.25], [0.6, 0.8, 0.35, 0.5, 0.7, -0.9, 0.7, 0.4, -0.3, 0.9, 0.4]],
  bandeja: [[-0.5, -0.65, -0.05, 0.4, -0.7, -2.4, 2.0, 0.1, -2.0, 0.5, -0.2], [0.15, 0.2, 0.1, 0.35, -0.15, -2.7, 0.6, 0.4, -0.7, 0.9, 0.15], [0.5, 0.55, 0.2, 0.4, 0.7, -1.6, 1.2, 0.5, -0.4, 0.9, 0.15]],
  vibora: [[-0.7, -0.9, -0.05, 0.4, -1.0, -2.3, 1.9, 0.1, -2.0, 0.5, -0.3], [-0.2, -0.15, 0.1, 0.3, -0.95, -2.25, 0.5, 0.4, -0.7, 0.9, 0.25], [0.8, 1.1, 0.3, 0.45, 1.1, -1.1, 0.9, 0.8, -0.2, 0.9, 0.3]],
  slice: [[-0.4, -0.6, 0.12, 0.6, -0.9, -1.6, 1.3, 0.2, -1.0, 0.6, -0.25], [0.1, 0.1, 0.2, 0.6, -0.25, -1.1, 0.9, 0.5, -0.5, 0.9, 0.3], [0.5, 0.6, 0.25, 0.65, 0.6, -0.5, 0.5, 0.6, -0.3, 0.9, 0.3]],
  chiquita: [[-0.2, -0.3, 0.2, 0.85, -0.5, -0.5, 1.1, 0.3, -0.4, 0.7, -0.1], [0.1, 0.15, 0.3, 0.85, -0.15, -0.8, 0.8, 0.4, -0.5, 0.8, 0.2], [0.15, 0.2, 0.3, 0.8, -0.1, -0.9, 0.8, 0.4, -0.5, 0.8, 0.2]],
  drop: [[-0.2, -0.3, 0.15, 0.6, -0.5, -0.9, 1.2, 0.3, -0.4, 0.7, -0.1], [0.1, 0.1, 0.2, 0.65, -0.2, -0.9, 0.9, 0.4, -0.5, 0.8, 0.15], [0.1, 0.1, 0.2, 0.6, -0.15, -0.8, 0.9, 0.4, -0.5, 0.8, 0.1]],
  block: [[-0.15, -0.15, 0.15, 0.55, -0.4, -0.9, 1.3, 0.35, -0.6, 0.8, 0], [0.05, 0.05, 0.18, 0.55, -0.2, -1.0, 1.0, 0.35, -0.6, 0.8, 0.1], [0.05, 0.05, 0.18, 0.55, -0.2, -1.0, 1.0, 0.35, -0.6, 0.8, 0.1]],
  serve: [[-0.3, -0.4, 0.15, 0.5, -0.2, 0.55, 0.5, -0.1, -1.3, 0.9, -0.15], [0.2, 0.3, 0.25, 0.45, -0.2, -0.9, 0.4, 0.2, -0.5, 0.9, 0.25], [0.3, 0.4, 0.2, 0.4, 0.1, -1.7, 0.8, 0.3, -0.3, 0.9, 0.2]],
};

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1119);
    this.scene.fog = new THREE.Fog(0x0b1119, 38, 90);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200);
    this.players = [];
    this.buildLights();
    this.buildCourt();
    // the back wall nearest the camera is hidden (like TV coverage) so it never blocks the view
    this.backWall = this.courtGroup.children.filter((c) => c.geometry && Math.abs(Math.abs(c.position.z) - 10) < 0.02 && Math.abs(c.rotation.y) < 0.01 && c.position.y < 5);
    this.buildBall();
    this.buildMarkers();
    this.crowds = [];
    this.buildFx();
    this.buildEnv();
    this.setLooks(DEFAULT_LOOKS);
    this.setCourt('indoor');
    this.setQuality('medium');
    this.resize();
    this.clock = 0;
    this.fovKick = 0;
    this.baseFov = 52;
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q) {
    const pr = Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.sun.castShadow = q !== 'low';
    this.bloom = q === 'high';
    if (this.bloom && !this.composer) {
      const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 0.92));
      this.composer.addPass(new OutputPass());
    }
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x1a2230, 0.95);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.7);
    sun.position.set(7, 20, 5);
    sun.target.position.set(0, 0, 0);
    const c = sun.shadow.camera;
    c.left = -13; c.right = 13; c.top = 13; c.bottom = -13; c.near = 5; c.far = 45;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.sun = sun;
    this.scene.add(sun, sun.target);
  }

  buildCourt() {
    // everything that makes up the court lives in one group so the 1v1 court can be narrowed as a whole
    const s = new THREE.Group();
    this.scene.add(s);
    this.courtGroup = s;
    // surround floor
    const out = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshStandardMaterial({ color: 0x151d29, roughness: 0.95 }));
    out.rotation.x = -Math.PI / 2; out.position.y = -0.01; out.receiveShadow = true;
    s.add(out);
    this.outFloor = out;
    // playing surface
    const turf = new THREE.Mesh(new THREE.PlaneGeometry(10, 20), new THREE.MeshStandardMaterial({ map: turfTexture(), roughness: 0.92 }));
turf.rotation.x = -Math.PI / 2; turf.receiveShadow = true;
    const bump = canvasTex(128, 128, (g, w, h) => { for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() * 255 | 0},${Math.random() * 255 | 0},${Math.random() * 255 | 0},.5)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }, { repeat: [10, 20] });
    turf.material.bumpMap = bump; turf.material.bumpScale = 0.6;
    s.add(turf);
    this.turfMesh = turf;
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xaecde6, transparent: true, opacity: 0.13, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa7b8, metalness: 0.7, roughness: 0.4 });
    const mt = meshTexture();
    const meshMat = (w, h) => {
      const t = mt.clone(); t.needsUpdate = true; t.repeat.set(w / 0.12, h / 0.12); t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, opacity: 0.55 });
    };
    const glass = (w, h, x, y, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
      m.position.set(x, y, z); m.rotation.y = ry; s.add(m);
    };
    const fence = (w, h, x, y, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), meshMat(w, h));
      m.position.set(x, y, z); m.rotation.y = ry; s.add(m);
    };
    const post = (x, z, h) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.08), steel);
      p.position.set(x, h / 2, z); p.castShadow = true; s.add(p);
    };
    const rail = (w, x, y, z, ry) => {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.06), steel);
      r.position.set(x, y, z); r.rotation.y = ry; s.add(r);
    };
    // back walls: 3 m glass + 1 m mesh; side walls: glass in the back 4 m, mesh through the middle
    for (const sz of [-1, 1]) {
      const z = sz * 10;
      glass(10, 3, 0, 1.5, z, 0);
      fence(10, 1, 0, 3.5, z, 0);
      rail(10, 0, 4, z, 0); rail(10, 0, 3, z, 0);
      post(sz * 5, z, 4); post(-sz * 5, z, 4);
      for (const sx of [-1, 1]) {
        glass(4, 3, sx * 5, 1.5, sz * 8, Math.PI / 2);
        fence(4, 1, sx * 5, 3.5, sz * 8, Math.PI / 2);
        post(sx * 5, sz * 6, 4);
      }
    }
    for (const sx of [-1, 1]) {
      const x = sx * 5;
      fence(12, 3, x, 1.5, 0, Math.PI / 2);
      fence(12, 1, x, 3.5, 0, Math.PI / 2);
      rail(20, x, 4, 0, Math.PI / 2); rail(20, x, 3, 0, Math.PI / 2);
      post(x, 0, 4);
    }
    // glass panel seams and base rails
    const seamMat = new THREE.MeshStandardMaterial({ color: 0x20293a, roughness: 0.5, metalness: 0.5 });
    const seam = (x, z, h = 3) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, h, 0.04), seamMat); m.position.set(x, h / 2, z); s.add(m); };
    for (const sz of [-1, 1]) {
      for (const x of [-4, -2, 0, 2, 4]) seam(x, sz * 9.99);
      for (const sx of [-1, 1]) for (const zz of [6, 8, 10]) seam(sx * 4.99, sz * zz);
      rail(10, 0, 0.04, sz * 10, 0);
    }

    // 1v1: the side walls become solid glass all along
    this.singlesGlass = new THREE.Group();
    for (const sx of [-1, 1]) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), glassMat); g.position.set(sx * 4.98, 1.5, 0); g.rotation.y = Math.PI / 2; this.singlesGlass.add(g);
      for (const zz of [-4, -2, 0, 2, 4]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, 3, 0.04), seamMat); m.position.set(sx * 4.97, 1.5, zz); this.singlesGlass.add(m); }
    }
    this.singlesGlass.visible = false; s.add(this.singlesGlass);

    // net: sagging mesh, white top band, centre strap, side bands, posts with caps
    const cell = canvasTex(32, 32, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(30,36,48,.95)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
    }, { repeat: [10 / 0.07, 1 / 0.07] });
    const netGeo = new THREE.PlaneGeometry(10, 1, 60, 8);
    const np = netGeo.attributes.position;
    for (let i = 0; i < np.count; i++) np.setY(i, (np.getY(i) + 0.5) * netHeight(np.getX(i)));
    const net = new THREE.Mesh(netGeo, new THREE.MeshBasicMaterial({ map: cell, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide }));
    s.add(net);
    const strip = (w, h, segs, yFn, mat, castS = false) => {
      const g = new THREE.PlaneGeometry(w, h, segs, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, yFn(p.getX(i)) + p.getY(i));
      const m = new THREE.Mesh(g, mat); m.castShadow = castS; return m;
    };
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide });
    s.add(strip(10, 0.075, 60, (x) => netHeight(x) - 0.037, white, true));
    s.add(strip(10, 0.03, 60, () => 0.02, new THREE.MeshStandardMaterial({ color: 0x20242c, side: THREE.DoubleSide })));
    const strap = new THREE.Mesh(new THREE.PlaneGeometry(0.06, COURT.NET_H), white);
    strap.position.set(0, COURT.NET_H / 2, 0.003); s.add(strap);
    const strap2 = strap.clone(); strap2.position.z = -0.003; s.add(strap2);
    const anchor = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 14), steel); anchor.position.set(0, 0.006, 0); s.add(anchor);
    for (const sx of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.PlaneGeometry(0.05, netHeight(5)), white); band.position.set(sx * 4.975, netHeight(5) / 2, 0); band.rotation.y = Math.PI / 2; s.add(band);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, 1.1, 14), steel);
      post.position.set(sx * 5.06, 0.55, 0); post.castShadow = true; s.add(post);
      const capM = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), steel); capM.position.set(sx * 5.06, 1.1, 0); s.add(capM);
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.07, 10), new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.5 }));
      knob.rotation.z = Math.PI / 2; knob.position.set(sx * 5.1, 0.55, 0); s.add(knob);
    }
  }

  buildBall() {
    const tex = canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = '#d9f23a'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(80,100,0,.08)';
      for (let i = 0; i < 300; i++) g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
      g.strokeStyle = '#f6ffd0'; g.lineWidth = 4;
      g.beginPath(); g.arc(w * 0.25, h * 0.5, h * 0.42, -1.2, 1.2); g.stroke();
      g.beginPath(); g.arc(w * 0.75, h * 0.5, h * 0.42, Math.PI - 1.2, Math.PI + 1.2); g.stroke();
    });
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.0335, 24, 18),
      new THREE.MeshStandardMaterial({ map: tex, emissive: 0x4a5c00, emissiveIntensity: 0.55, roughness: 0.75 }),
    );
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.12, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballShadow);
    this.ballHalo = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.12, 24),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.0, depthWrite: false, depthTest: false }),
    );
    this.scene.add(this.ballHalo);
    // motion trail: fading ghosts of earlier positions
    this.trailPos = [];
    this.trail = [];
    const gm = new THREE.SphereGeometry(0.0335, 8, 6);
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(gm, new THREE.MeshBasicMaterial({ color: 0xe6ff5a, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; this.scene.add(m); this.trail.push(m);
    }
  }

  buildMarkers() {
    const mk = (r0, r1, color, op) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.03; this.scene.add(m); return m;
    };
    this.reticle = mk(0.22, 0.3, ACCENT, 0.95);
    this.reticleDot = mk(0, 0.06, ACCENT, 0.95);
    this.reachRing = mk(1.53, 1.6, 0xffffff, 0.22);
    this.meRing = mk(0.5, 0.58, ACCENT, 0.9);
  }

  /** 1v1: the whole court (walls, net, turf) narrows to 7 m and the sides become solid glass. */
  setSingles(on) {
    this.courtGroup.scale.x = on ? 0.7 : 1;
    this.singlesGlass.visible = on;
  }

  setBallScale(k) { this.ball.scale.setScalar(k); this.ballShadow.scale.setScalar(k * 0.7); this.ballHalo.scale.setScalar(k * 0.7); }

  // ------------------------------------------------------------------ players

  /**
   * Jointed athlete: pelvis → spine (twist/lean) → shoulders → elbows, and hip → knee → foot per leg.
   * Poses are driven by a small parameter vector (see READY) so every shot is a set of keyframes.
   */
  makePlayer(team, look) {
    const rig = buildCharacter(look, team);
    rig.cur = READY.slice();
    return rig;
  }

  /** (Re)build the four athletes from their looks. Unchanged looks keep their rig. */
  setLooks(looks) {
    for (let i = 0; i < 4; i++) {
      const look = looks?.[i] || DEFAULT_LOOKS[i];
      const key = JSON.stringify(look);
      if (this.players[i] && this.players[i].lookKey === key) continue;
      const old = this.players[i];
      if (old) { this.scene.remove(old.root); disposeCharacter(old); }
      const rig = this.makePlayer(i >> 1, look);
      rig.lookKey = key;
      this.players[i] = rig;
      this.scene.add(rig.root);
    }
  }

  /** Interpolate the keyframes of a swing at time t (seconds since the swing began). */
  swingParams(kind, t, from = READY) {
    const K = SWING[kind] || SWING.forehand;
    const keys = [from, K[0], K[1], K[2]];
    const times = [0, 0.075, 0.17, 0.42];
    let i = 0;
    while (i < 2 && t > times[i + 1]) i++; // the last segment (contact → follow-through) also covers t beyond its end
    const f = Math.min(1, Math.max(0, (t - times[i]) / (times[i + 1] - times[i])));
    const e = f * f * (3 - 2 * f);
    return keys[i].map((v, k) => v + (keys[i + 1][k] - v) * e);
  }

  /**
   * Keep the racket face square to the net whatever the arm does: the head continues the forearm, and the
   * face normal is the body's forward direction projected perpendicular to that axis.
   */
  orientRacket(pl) {
    const T = this._rt || (this._rt = { q: new THREE.Quaternion(), qw: new THREE.Quaternion(), a: new THREE.Vector3(), n: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), f: new THREE.Vector3(), m: new THREE.Matrix4() });
    pl.root.updateMatrixWorld(true);
    pl.armR.elbow.getWorldQuaternion(T.q);
    T.a.set(0, -1, 0).applyQuaternion(T.q); // direction the racket head points
    const yaw = pl.yaw + pl.hips.rotation.y + pl.spine.rotation.y * 0.6;
    T.f.set(Math.sin(yaw), 0, Math.cos(yaw));
    T.n.copy(T.f).addScaledVector(T.a, -T.f.dot(T.a));
    if (T.n.lengthSq() < 0.05) { T.n.set(0, 1, 0).addScaledVector(T.a, -T.a.y); }
    T.n.normalize();
    T.y.copy(T.a).negate();
    T.x.crossVectors(T.y, T.n);
    T.m.makeBasis(T.x, T.y, T.n);
    T.qw.setFromRotationMatrix(T.m);
    pl.racket.quaternion.copy(T.q.invert()).multiply(T.qw);
  }

  /** type: 'win' | 'lose' */
  emote(slot, type) { this.players[slot].emote = { type, t: 0 }; }

  splitStep(slot) { this.players[slot].split = 0.3; }

  /**
   * @param v {x, z, vx, vz, swingT, kindName, jumpT}
   */
  updatePlayer(i, v, dt, isMe) {
    const pl = this.players[i];
    pl.root.visible = Math.abs(v.x) < 20; // parked (inactive) players are hidden
    const speed = Math.hypot(v.vx, v.vz);
    const base = pl.team === 0 ? 0 : Math.PI;
    const swinging = v.swingT >= 0;
    if (swinging && !pl.wasSwinging) pl.startPose = pl.cur.slice();
    pl.wasSwinging = swinging;
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

    // Body yaw: square to the net, turning toward the ball when it is on our side. Frozen while swinging.
    const bp = this.ball.position;
    const ballAng = wrap(Math.atan2(bp.x - v.x, bp.z - v.z) - base);
    const ownSide = pl.team === 0 ? bp.z < 0.5 : bp.z > -0.5;
    if (!swinging) {
      const want = base + THREE.MathUtils.clamp(ballAng, -1.05, 1.05) * (ownSide ? 0.6 : 0.2);
      pl.yaw += wrap(want - pl.yaw) * Math.min(1, dt * 8);
    }
    pl.root.rotation.y = pl.yaw;

    // gait in the body's own frame: forward/back running and side shuffles use different leg motion
    const sy = Math.sin(pl.yaw), cy = Math.cos(pl.yaw);
    const vf = v.vx * sy + v.vz * cy;
    const vl = v.vx * cy - v.vz * sy;
    // smoothed speed (so bot jitter does not flap the legs); cadence follows ground speed so feet do not slide
    pl.speedS = (pl.speedS ?? speed) + (speed - (pl.speedS ?? speed)) * Math.min(1, dt * 9);
    const sp = pl.speedS;
    pl.phase += dt * sp * 2.2;
    const ph = pl.phase;
    { // a foot lands every half stride; a hard stop skids
      const sg = Math.sign(Math.sin(ph));
      if (pl.lastSg !== undefined && sg !== pl.lastSg && sp > 1.2 && !swinging && v.jumpT <= 0) this.onStep?.(i, sp, v.x);
      pl.lastSg = sg;
    }
    const run = Math.min(1, sp / 6);
    const moving = sp > 0.35 ? 1 : 0;
    const pitchAmp = Math.min(1.2, Math.abs(vf) / 6) * (0.35 + 0.5 * run) * moving;
    const rollAmp = Math.min(1, Math.abs(vl) / 5.4) * 0.5 * moving;
    const dirF = Math.sign(vf) || 1, dirL = Math.sign(vl) || 1;

    // target pose
    let target;
if (swinging) {
      const st = pl.startPose || READY;
      target = this.swingParams(v.kindName, v.swingT, st);
      const lead = this.swingParams(v.kindName, v.swingT + 0.04, st); // hips and legs lead the swing
      const lag = this.swingParams(v.kindName, Math.max(0, v.swingT - 0.03), st); // the arm whips through behind the body
      target[0] = lead[0]; target[3] = lead[3]; target[10] = lead[10];
      target[4] = lag[4]; target[5] = lag[5]; target[6] = lag[6];
    } else if (v.serving) {
      target = SERVE_READY.slice();
      // the left hand follows the bouncing ball: arm down when it is low, forearm up when it comes back
      const k = Math.min(1, Math.max(0, (bp.y - 0.1) / 0.86));
      target[8] = -0.5 * k; target[9] = 0.1 + 0.65 * k; target[7] = 0.2 - 0.1 * k;
      pl.cur[8] = target[8]; pl.cur[9] = target[9]; pl.cur[7] = target[7]; // stay glued to the ball
    } else {
      target = READY.slice();
      // anticipation: turn the shoulders and take the racket back as the ball closes in
      const bv = this.ballVel;
      if (bv && ownSide) {
        const dx = bp.x - v.x, dz = bp.z - v.z, d = Math.hypot(dx, dz) || 1;
        const closing = -(dx * bv.x + dz * bv.z) / d;
        if (closing > 1.5 && d < 5.5) {
          const prep = Math.min(1, (5.5 - d) / 3.5) * 0.8;
          const right = pl.team === 0 ? bp.x < v.x : bp.x > v.x;
          const kind = bp.y > 2.0 ? 'smash' : right ? 'forehand' : 'backhand';
          const load = SWING[kind][0];
          for (let n = 0; n < target.length; n++) target[n] += (load[n] - target[n]) * prep;
        }
      }
    }
    let emoteHop = 0, emoteHead = null;
    if (pl.emote && !swinging) {
      const e = pl.emote;
      e.t += dt;
      if (e.t > 2.4) pl.emote = null;
      else {
        const fade = Math.min(1, e.t / 0.25, (2.4 - e.t) / 0.5);
        const tgt = e.type === 'win' ? EMOTE_WIN : EMOTE_LOSE;
        for (let n = 0; n < target.length; n++) target[n] += (tgt[n] - target[n]) * fade;
        if (e.type === 'win') emoteHop = Math.abs(Math.sin(e.t * 8)) * 0.1 * fade;
        else emoteHead = { x: 0.4 * fade, y: Math.sin(e.t * 3) * 0.3 * fade };
      }
    }
    const k = swinging ? 1 : 1 - Math.exp(-dt * 13);
    for (let n = 0; n < target.length; n++) pl.cur[n] += (target[n] - pl.cur[n]) * k;
    const P = pl.cur.slice();
    const calm = swinging ? 0.25 : 1;
    // lean into acceleration, sit back when braking
    pl.accS = (pl.accS || 0) + (((sp - (pl.prevSp ?? sp)) / Math.max(dt, 1e-3)) - (pl.accS || 0)) * Math.min(1, dt * 6);
    pl.prevSp = sp;
    const leanA = THREE.MathUtils.clamp(pl.accS * 0.012, -0.12, 0.18) * calm;
    if (pl.accS < -16 && sp > 3 && !swinging) this.onSkid?.(i, v.x);
    const brake = THREE.MathUtils.clamp(-pl.accS * 0.012, 0, 0.18) * calm;
    // landing from a jump: absorb with the knees
    if (pl.wasJump && !(v.jumpT > 0)) pl.land = 0.28;
    pl.wasJump = v.jumpT > 0;
    let landCrouch = 0;
    if (pl.land > 0) { landCrouch = Math.sin((pl.land / 0.28) * Math.PI) * 0.35; pl.land -= dt; }
    // idle life: breathing, weight shift, a light bounce on the toes and a loose racket. Fades out while running.
    const idle = swinging ? 0 : Math.max(0, 1 - speed / 1.5);
    const it = this.clock + pl.idlePh;
    if (idle > 0) {
      const calmer = v.serving ? 0.3 : 1;
      P[3] += Math.sin(it * 3.1) * 0.05 * idle * calmer;
      P[2] += Math.sin(it * 1.7) * 0.02 * idle;
      P[0] += Math.sin(it * 0.8) * 0.06 * idle;
      P[1] += Math.sin(it * 0.8 + 0.5) * 0.05 * idle;
      P[5] += Math.sin(it * 2.2) * 0.07 * idle * calmer;
      P[6] += Math.sin(it * 2.7 + 1) * 0.08 * idle * calmer;
      if (!v.serving) P[8] += Math.sin(it * 2.0 + 2) * 0.06 * idle;
    }
    const sway = Math.sin(it * 0.9) * idle;

    // split-step: quick crouch + hop as the opponent hits
    let hop = 0, splitCrouch = 0;
    if (pl.split > 0) {
      const u = 1 - pl.split / 0.3;
      splitCrouch = Math.sin(Math.min(1, u * 1.6) * Math.PI) * 0.35;
      hop = u > 0.55 ? Math.sin((u - 0.55) / 0.45 * Math.PI) * 0.07 : 0;
      pl.split = Math.max(0, pl.split - dt);
    }
    // jump: coil, extend, tuck
    let crouch = P[3] * (1 - 0.55 * run) + splitCrouch + brake + landCrouch; // upright stride when running
    if (v.jumpT > 0) {
      const u = 1 - v.jumpT / 0.62;
      crouch = u < 0.18 ? 0.5 : u < 0.8 ? 0.08 : 0.45;
    }
    const a = crouch;
    pl.hips.position.y = 0.88 * Math.cos(a) + 0.1 + hop + emoteHop + Math.cos(2 * ph) * 0.025 * run * calm; // gentle two-per-stride bob, no hopping
    pl.hips.rotation.set(0, P[0] - Math.sin(ph) * 0.12 * run * calm * dirF, 0); // hips and shoulders counter-rotate when running
    pl.hips.rotation.x = Math.max(-0.3, Math.min(0.35, vf * 0.03)) * calm;
    pl.hips.rotation.z = -vl * 0.02 * calm + sway * 0.03;
    pl.hips.position.x = sway * 0.025;
    pl.spine.rotation.set(P[2] + (vf > 0 ? Math.min(0.3, vf * 0.04) : Math.max(-0.1, vf * 0.015)) * calm + leanA, P[1] + Math.sin(ph) * 0.18 * run * calm * dirF, 0);

    // legs: base crouch + stride + shuffle + batting step
    const legPose = (L, sgn) => {
      const phL = ph + (sgn > 0 ? 0 : Math.PI);
      const stride = Math.sin(phL) * pitchAmp * dirF * calm;
      const lift = Math.max(0, Math.cos(phL * dirF)) * pitchAmp * 1.4 * calm;
      const step = P[10] * (sgn > 0 ? -0.55 : 0.55); // right leg (sgn<0) steps forward when step>0
      L.thigh.rotation.x = -a - stride - step * 0.8;
      L.knee.rotation.x = 2 * a + lift + Math.abs(step) * 0.35;
      L.foot.rotation.x = -(L.thigh.rotation.x + L.knee.rotation.x) * 0.9 + Math.max(0, -Math.sin(phL) * dirF) * 0.5 * run * calm; // toe-off
      L.thigh.rotation.z = Math.sin(phL) * rollAmp * dirL * sgn * calm + (swinging ? sgn * 0.12 : sgn * 0.06);
    };
    legPose(this.players[i].legL, 1);
    legPose(this.players[i].legR, -1);

    // arms
    const counter = Math.sin(ph) * pitchAmp * 1.1 * calm;
    pl.armR.sh.rotation.set(P[5], P[4], 0);
    pl.armR.elbow.rotation.set(-(P[6] + Math.sin(ph + Math.PI) * 0.15 * run * calm), 0, 0);
    pl.armL.sh.rotation.set(P[8] + counter, P[7], 0.12);
    pl.armL.elbow.rotation.set(-(P[9] + 0.55 * run * calm), 0, 0); // running arms bend
    this.orientRacket(pl);

    // head tracks the ball
    const total = pl.yaw + P[0] + P[1];
    const look = wrap(Math.atan2(bp.x - v.x, bp.z - v.z) - total);
    pl.head.rotation.y += (THREE.MathUtils.clamp(look, -1.0, 1.0) * 0.85 - pl.head.rotation.y) * Math.min(1, dt * 12);
    pl.head.rotation.x = 0.08 - (pl.spine.rotation.x) * 0.6 + Math.min(0.2, Math.max(-0.2, (bp.y - 1.5) * -0.04)); // gaze stays level when the body leans
    if (emoteHead) { pl.head.rotation.x += emoteHead.x; pl.head.rotation.y += emoteHead.y; }

    const lift = v.jumpT > 0 ? Math.sin(Math.PI * (1 - v.jumpT / 0.62)) * 0.7 : 0;
    pl.root.position.set(v.x, lift, v.z);
    pl.blob.position.y = 0.02 - lift;
    pl.blob.scale.setScalar(1 - lift * 0.4);
    if (isMe) {
      this.meRing.position.set(v.x, 0.03, v.z);
      this.reachRing.position.set(v.x, 0.03, v.z);
    }
  }

  setBall(x, y, z) {
    this.ball.position.set(x, y, z);
    this.ballShadow.position.set(x, 0.02, z);
    const k = Math.max(0.35, 1 - y * 0.12);
    this.ballShadow.scale.setScalar(k * this.ball.scale.x * 0.7);
    this.ballHalo.position.set(x, y, z);
    this.ballHalo.quaternion.copy(this.camera.quaternion);
  }

  /** Seam rotation from travel + spin, and the motion trail. sb = backspin(+)/topspin(-). */
  animateBall(dt, speed, hx, hz, sb) {
    if (speed > 0.5) {
      const L = new THREE.Vector3(hz, 0, -hx).normalize();
      this.ball.rotateOnWorldAxis(L, (speed * 0.55 - sb * 0.5) * dt);
    }
    const on = this.trailOn && speed > 9;
    this.trailPos.unshift(this.ball.position.clone());
    if (this.trailPos.length > 20) this.trailPos.pop();
    this.trail.forEach((m, i) => {
      const p = this.trailPos[(i + 1) * 2 - 1];
      m.visible = !!(on && p);
      if (!m.visible) return;
      m.position.copy(p);
      m.scale.setScalar(this.ball.scale.x * (1 - i * 0.08));
      m.material.opacity = Math.min(0.5, (speed - 9) / 20) * (1 - i / 9);
    });
  }

  // ------------------------------------------------------------------ effects

  buildFx() {
    this.fx = [];
    this.ringGeo = new THREE.RingGeometry(0.08, 0.1, 28);
    this.puffGeo = new THREE.SphereGeometry(0.05, 8, 6);
    this.trailOn = true;
  }

  spawnFx(kind, x, y, z, power = 1, axis = 'z') {
    const add = (mesh, life, update) => { this.scene.add(mesh); this.fx.push({ mesh, life, t: 0, update }); };
    if (kind === 'floor') {
      const n = 3 + Math.round(power * 3);
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(this.puffGeo, new THREE.MeshBasicMaterial({ color: 0xcfe0d6, transparent: true, opacity: 0.45, depthWrite: false }));
        m.position.set(x, 0.04, z);
        const ang = Math.random() * 6.28, sp = 0.6 + Math.random() * 1.2 * power;
        const vx = Math.cos(ang) * sp, vz = Math.sin(ang) * sp, vy = 0.3 + Math.random() * 0.6;
        add(m, 0.5, (f, u) => { f.mesh.position.x += vx * 0.016; f.mesh.position.z += vz * 0.016; f.mesh.position.y += vy * 0.016 * (1 - u); f.mesh.scale.setScalar(1 + u * 3); f.mesh.material.opacity = 0.4 * (1 - u); });
      }
      const r = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
      r.rotation.x = -Math.PI / 2; r.position.set(x, 0.035, z);
      add(r, 0.3, (f, u) => { f.mesh.scale.setScalar(1 + u * 5 * power); f.mesh.material.opacity = 0.5 * (1 - u); });
    } else if (kind === 'wall') {
      const r = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
      r.position.set(x, y, z);
      r.rotation.y = axis === 'x' ? Math.PI / 2 : 0;
      add(r, 0.35, (f, u) => { f.mesh.scale.setScalar(1 + u * 9 * power); f.mesh.material.opacity = 0.8 * (1 - u); });
    } else if (kind === 'net') {
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(this.puffGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
        m.position.set(x, y, 0);
        const vx = (Math.random() - 0.5) * 1.2, vy = (Math.random() - 0.2) * 0.8;
        add(m, 0.35, (f, u) => { f.mesh.position.x += vx * 0.016; f.mesh.position.y += vy * 0.016; f.mesh.material.opacity = 0.5 * (1 - u); });
      }
    } else if (kind === 'hit') {
      const r = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xf3ff7a, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false }));
      r.position.set(x, y, z);
      add(r, 0.22, (f, u) => { f.mesh.quaternion.copy(this.camera.quaternion); f.mesh.scale.setScalar((1 + u * 4) * power); f.mesh.material.opacity = 0.9 * (1 - u); });
    }
  }

  updateFx(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.t += dt;
      const u = f.t / f.life;
      if (u >= 1) { this.scene.remove(f.mesh); f.mesh.material.dispose(); this.fx.splice(i, 1); continue; }
      f.update(f, u);
    }
  }

  // ------------------------------------------------------------------ crowd + reflections

  /**
   * Stands with instanced spectators. cfg: rows, sides, back, density (0..1), pal (colours), xBase, rowStep, stepH, stepMat.
   * Everything is added to `group` so it is disposed with the environment.
   */
  makeCrowd(group, cfg = {}) {
    const { rows = 5, sides = true, back = false, density = 0.7, xBase = 6.6, rowStep = 1.05, stepH = 0.45 } = cfg;
    const pal = cfg.pal || [0x2f4a6b, 0x6b2f3a, 0x3d6b52, 0x7a6a3a, 0x4b4b5e, 0x8a8f99, 0x253244];
    const stepMat = cfg.stepMat || new THREE.MeshStandardMaterial({ color: 0x141c28, roughness: 0.9 });
    const people = [];
    const row = (x, z, along, r, rotY) => {
      const h = stepH * (r + 1);
      const step = new THREE.Mesh(new THREE.BoxGeometry(along ? 24 : rowStep, h, along ? rowStep : 24), stepMat);
      step.position.set(x, h / 2, z); step.receiveShadow = true; group.add(step);
      for (let t = -11; t <= 11; t += 0.62) {
        if (Math.random() > density) continue;
        const j = (Math.random() - 0.5) * 0.15;
        people.push(along ? [t + j, h + 0.3, z + j, rotY] : [x + j, h + 0.3, t + j, rotY]);
      }
    };
    if (sides) for (const sx of [-1, 1]) for (let r = 0; r < rows; r++) row(sx * (xBase + r * rowStep), 0, false, r, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
    if (back) for (const sz of [-1, 1]) for (let r = 0; r < rows; r++) row(0, sz * (13.5 + r * rowStep), true, r, sz > 0 ? Math.PI : 0);
    if (!people.length) return;
    const bm = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.17, 0.25, 3, 8), new THREE.MeshStandardMaterial({ roughness: 0.9 }), people.length);
    const hm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.115, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.8 }), people.length);
    const skins = [0xc89878, 0x8d5a3c, 0xe0b799, 0xa87450];
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    const phase = [];
    people.forEach(([x, y, z, ry], i) => {
      m4.makeRotationY(ry).setPosition(x, y, z);
      bm.setMatrixAt(i, m4); bm.setColorAt(i, col.setHex(pal[(Math.random() * pal.length) | 0]));
      m4.setPosition(x, y + 0.36, z); hm.setMatrixAt(i, m4); hm.setColorAt(i, col.setHex(skins[(Math.random() * skins.length) | 0]));
      phase.push(Math.random() * 6);
    });
    group.add(bm, hm);
    this.crowds.push({ bm, hm, people, phase });
  }

  cheerCrowd() { this.cheerT = 1.6; }

  updateCrowd() {
    if (!this.cheerT || this.cheerT <= 0) return;
    this.cheerT -= this.dt;
    const m4 = new THREE.Matrix4();
    const amp = Math.max(0, Math.min(1, this.cheerT)) * 0.18;
    for (const c of this.crowds) {
      c.people.forEach(([x, y, z, ry], i) => {
        const hop = Math.abs(Math.sin(this.clock * 9 + c.phase[i])) * amp;
        m4.makeRotationY(ry).setPosition(x, y + hop, z); c.bm.setMatrixAt(i, m4);
        m4.setPosition(x, y + 0.36 + hop, z); c.hm.setMatrixAt(i, m4);
      });
      c.bm.instanceMatrix.needsUpdate = true; c.hm.instanceMatrix.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------ courts (environments)

  adTexture(text, bg, fg, sub) { return bannerTexture(text, bg, fg, sub); }

  skylineTexture() {
    return canvasTex(512, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.fillStyle = '#0a0e16';
      let x = 0;
      while (x < w) {
        const bw = 18 + Math.random() * 40, bh = 30 + Math.random() * 90;
        g.fillRect(x, h - bh, bw, bh);
        g.fillStyle = 'rgba(255,214,140,.8)';
        for (let yy = h - bh + 6; yy < h - 4; yy += 9) for (let xx = x + 4; xx < x + bw - 4; xx += 8) if (Math.random() < 0.35) g.fillRect(xx, yy, 3, 4);
        g.fillStyle = '#0a0e16'; x += bw + 2;
      }
    });
  }

  /** Switch the whole environment: surroundings, lighting, turf colour and advertising. */
  setCourt(id) {
    if (this.courtId === id) return;
    this.courtId = id;
    if (this.envGroup) {
      this.scene.remove(this.envGroup);
      this.envGroup.traverse((o) => { o.geometry?.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m) { m.map?.dispose(); m.dispose(); } }); });
    }
    this.crowds = [];
    const env = buildEnvironment(id, this);
    this.envGroup = env.group;
    this.scene.add(env.group);
    this.applyLight(env.light);
    this.setTurf(env.turf);
    this.buildAds(env.ads);
  }

  applyLight(l) {
    if (l.background2D) this.scene.background = l.bg; else this.scene.background = new THREE.Color(l.bg);
    this.scene.fog = new THREE.Fog(l.fog[0], l.fog[1], l.fog[2]);
    this.hemi.color.set(l.hemi[0]); this.hemi.groundColor.set(l.hemi[1]); this.hemi.intensity = l.hemi[2];
    this.sun.color.set(l.sun.color); this.sun.intensity = l.sun.intensity; this.sun.position.set(...l.sun.pos);
    this.renderer.toneMappingExposure = l.exposure;
    this.scene.environmentIntensity = l.envIntensity;
  }

  setTurf(t) {
    const mat = this.turfMesh.material;
    mat.map?.dispose();
    mat.map = turfTexture(t.base);
    mat.needsUpdate = true;
    const om = this.outFloor.material;
    om.map?.dispose(); om.map = null;
    om.color.set(t.out.color); om.roughness = t.out.rough;
    if (t.out.tiles) {
      om.color.set(0xffffff);
      om.map = canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = '#b86a42'; g.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 64) for (let x = 0; x < w; x += 64) { g.fillStyle = `rgba(${150 + Math.random() * 50 | 0},${70 + Math.random() * 30 | 0},40,.45)`; g.fillRect(x + 2, y + 2, 60, 60); }
        g.strokeStyle = 'rgba(60,30,18,.55)'; g.lineWidth = 3; for (let i = 0; i <= w; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
      }, { repeat: [14, 14] });
    }
    om.needsUpdate = true;
  }

  buildAds(a) {
    if (this.adGroup) { this.courtGroup.remove(this.adGroup); this.adGroup.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); }); }
    const g = new THREE.Group();
    const tex = bannerTexture(a.text, a.bg, a.fg, a.sub); tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(2.8, 1);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    for (const sx of [-1, 1]) { const ad = new THREE.Mesh(new THREE.PlaneGeometry(20, 0.9), mat); ad.position.set(sx * 6.05, 0.45, 0); ad.rotation.y = -sx * Math.PI / 2; g.add(ad); }
    for (const sz of [-1, 1]) { const ad = new THREE.Mesh(new THREE.PlaneGeometry(12, 0.9), mat); ad.position.set(0, 0.45, sz * 10.9); ad.rotation.y = sz > 0 ? Math.PI : 0; g.add(ad); }
    this.adGroup = g; this.courtGroup.add(g);
  }

  /** Short field-of-view kick on powerful hits. */
  punch(k) { this.fovKick = Math.max(this.fovKick, k); }

  buildEnv() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.32;
    pm.dispose();
  }

  render(dt = 0.016) {
    this.dt = dt;
    this.clock += dt;
    this.updateFx(dt);
    this.updateCrowd();
    if (this.backWall) { const cz = this.camera.position.z; for (const o of this.backWall) o.visible = !(Math.abs(cz) > 9.5 && Math.sign(cz) === Math.sign(o.position.z)); }
    if (this.fovKick > 0.01) { this.fovKick *= Math.exp(-dt * 9); this.camera.fov = this.baseFov + this.fovKick; this.camera.updateProjectionMatrix(); } else if (this.camera.fov !== this.baseFov && !window.__freeze) { this.camera.fov = this.baseFov; this.camera.updateProjectionMatrix(); }
    if (this.bloom && this.composer) this.composer.render(dt); else this.renderer.render(this.scene, this.camera);
  }
}
