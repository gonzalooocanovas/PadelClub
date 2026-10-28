// Pose filmstrip for the skinned player models. Start a practice match, paste this in the browser console, then e.g.
//     strip(1, 'forehand', [0.075, 0.17, 0.3, 0.42], 1.3)   // slot, shot kind, swing times (s; -1 = ready), camera angle (rad)
// It moves the four athletes out of the game scene into a private one: reload the page afterwards.
(() => {
  const w = window.__padel.world;
  const r2 = new w.renderer.constructor({ antialias: true, preserveDrawingBuffer: true });
  r2.domElement.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#889';
  document.body.appendChild(r2.domElement);
  const sc = new w.scene.constructor(); sc.background = w.scene.background.clone();
  sc.add(new w.hemi.constructor(0xffffff, 0x555566, 2.2));
  const d = new w.sun.constructor(0xffffff, 2.5); d.position.set(3, 6, 4); sc.add(d);
  for (const pl of w.players) pl.root.parent?.remove(pl.root);
  const V = (slot, kind, t, extra = {}) => w.updatePlayer(slot, { x: 0, z: 0, vx: 0, vz: 0, swingT: t, kindName: kind, jumpT: 0, ...extra }, 0.016, false);
  window.strip = (slot, kind, times, a = 0.9, fov = 22, run = 0) => {
    const pl = w.players[slot];
    for (const q of w.players) sc.remove(q.root);
    sc.add(pl.root); r2.setSize(800, 600, false); r2.domElement.style.width = '800px'; r2.domElement.style.height = '600px'; r2.setScissorTest(true);
    pl.startPose = null; pl.wasSwinging = false;
    for (let i = 0; i < 30; i++) V(slot, kind, -1);
    times.forEach((t, i) => {
      if (t < 0) V(slot, kind, -1, run ? { vz: run * (i + 1) / 4 } : {});
      else for (let k = 0; k <= Math.round(t / 0.016); k++) V(slot, kind, k * 0.016);
      pl.root.position.set(0, 0, 0); pl.root.rotation.y = pl.yaw; pl.root.updateMatrixWorld(true);
      const cam = new w.camera.constructor(fov, (800 / times.length) / 600, 0.1, 50), s = pl.team ? -1 : 1;
      cam.position.set(Math.sin(a) * 5.2 * s, 1.1, Math.cos(a) * 5.2 * s); cam.lookAt(0, 0.9, 0);
      const W = 800 / times.length; r2.setViewport(i * W, 0, W, 600); r2.setScissor(i * W, 0, W, 600); r2.render(sc, cam); pl.wasSwinging = false;
    });
  };
})();
