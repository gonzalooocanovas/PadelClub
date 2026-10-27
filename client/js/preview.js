// A small stand-alone 3D viewer used by the equipment screen: rotates a character or a single racket.
import * as THREE from 'three';
import { buildCharacter, buildRacket, disposeCharacter } from './characters.js';
import { RACKETS } from '/shared/looks.js';

export class Preview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x30384a, 1.15));
    const key = new THREE.DirectionalLight(0xfff3e0, 2.2); key.position.set(2, 4, 3); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fb4ff, 1.2); rim.position.set(-3, 2, -3); this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.MeshStandardMaterial({ color: 0x1b2433, roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2; this.scene.add(floor);
    this.camera = new THREE.PerspectiveCamera(32, canvas.width / canvas.height, 0.1, 30);
    this.mode = 'character';
    this.item = null;
    this.t = 0;
    this.last = performance.now();
    this.stopped = false;
    const loop = (now) => {
      if (this.stopped) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now; this.t += dt;
      if (this.item) this.item.rotation.y += dt * 0.7;
      if (this.rig) this.breathe();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  clearItem() {
    if (this.item) { this.scene.remove(this.item); if (this.rig) disposeCharacter(this.rig); this.item = null; this.rig = null; }
  }

  /** Show a character in the ready stance. */
  setCharacter(look, team) {
    this.clearItem();
    const rig = buildCharacter(look, team);
    const a = 0.32;
    rig.hips.position.y = 0.88 * Math.cos(a) + 0.1;
    for (const L of [rig.legL, rig.legR]) { L.thigh.rotation.x = -a; L.knee.rotation.x = 2 * a; L.foot.rotation.x = -a * 0.9; }
    rig.spine.rotation.x = 0.12;
    rig.armR.sh.rotation.set(-0.7, -0.45, 0); rig.armR.elbow.rotation.set(-1.7, 0, 0);
    rig.armL.sh.rotation.set(-0.5, 0.35, 0.12); rig.armL.elbow.rotation.set(-0.9, 0, 0);
    rig.racket.rotation.set(0, 0, 0);
    this.rig = rig; this.item = rig.root; this.mode = 'character';
    this.scene.add(rig.root);
    this.camera.position.set(0, 1.15, 4.1); this.camera.lookAt(0, 0.95, 0);
  }

  /** Show a single racket, large, so its design can be inspected. */
  setRacket(index) {
    this.clearItem();
    const r = buildRacket(RACKETS[index]);
    r.scale.setScalar(3.2);
    r.rotation.z = Math.PI; // head up
    const holder = new THREE.Group(); holder.add(r); holder.position.y = 0.95;
    this.item = holder; this.mode = 'racket';
    this.scene.add(holder);
    this.camera.position.set(0, 1.0, 2.9); this.camera.lookAt(0, 0.95, 0);
  }

  breathe() {
    const t = this.t;
    this.rig.hips.position.y += (Math.sin(t * 2.4) * 0.004);
    this.rig.armR.elbow.rotation.x = -1.7 + Math.sin(t * 2.1) * 0.04;
  }

  dispose() {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.clearItem();
    this.renderer.dispose();
  }
}
