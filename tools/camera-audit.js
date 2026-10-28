// Camera audit snippet. Start a practice match (any venue), open the browser console, paste this file, then run for example:
//     await __audit('wall', 6000)          // one preset for 6 s
//     for (const c of ['player','first','wall','corner','side','broadcast','tactical']) console.log(await __audit(c, 5000))
// It drives the match in real time with a bot as the player and measures, per frame: is the ball on screen, how far the camera moves
// per frame, and is a player's torso near the camera-to-ball line (a rough occlusion test). It measures geometry, not beauty.
(async () => {
  const THREE = await import('/vendor/three/build/three.module.min.js');
  const ai = await import('/shared/ai.js');
  const { setSetting } = await import('/js/settings.js');
  window.__audit = async (cam, ms = 6000) => {
    const p = window.__padel, l = p.local, m = p.match, w = p.world;
    if (!l || !m) throw new Error('start a solo match first (Practice 2 vs 2)');
    const mem = window.__auditMem || (window.__auditMem = ai.makeBotMemory(0));
    setSetting('camera', cam);
    let last = performance.now(), frames = 0, onScreen = 0, maxStep = 0, prev = null, occluded = 0;
    const stop = performance.now() + ms, v = new THREE.Vector3();
    await new Promise((res) => {
      const tick = () => {
        const now = performance.now(), dt = (now - last) / 1000; last = now;
        l.pushInputs([ai.botInput(l.game, 0, mem, 'hard', 1 / 60)]);
        m.frame(Math.min(dt, 0.1), now);
        w.camera.updateMatrixWorld();
        const b = w.ball.position;
        v.copy(b).project(w.camera);
        frames++;
        if (v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) onScreen++;
        const cp = w.camera.position.clone();
        if (prev) maxStep = Math.max(maxStep, cp.distanceTo(prev));
        prev = cp;
        for (const pl of w.players) {
          if (!pl.root.visible) continue;
          const pp = pl.root.position.clone().add(new THREE.Vector3(0, 1, 0));
          const ab = b.clone().sub(cp);
          const t = Math.max(0, Math.min(1, pp.clone().sub(cp).dot(ab) / ab.lengthSq()));
          if (cp.clone().add(ab.multiplyScalar(t)).distanceTo(pp) < 0.45 && t < 0.97 && t > 0.05) { occluded++; break; }
        }
        if (now < stop) setTimeout(tick, 8); else res();
      };
      tick();
    });
    return { cam, frames, onScreenPct: Math.round(100 * onScreen / frames), behindPlayerPct: Math.round(100 * occluded / frames), maxCameraStepM: +maxStep.toFixed(2) };
  };
  console.log('camera audit ready: await __audit("wall", 6000)');
})();
