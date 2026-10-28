// Character measurements (metres) from the real geometry in the neutral pose. Start a practice match, then in the console:
//   const T = await import("three"); window.__Box3 = T.Box3; window.__V3 = T.Vector3;  (paste this file)  measure(window.__padel.world, slot)
window.measure = (w, slot = 0) => {
  const pl = w.players[slot];
  for (const k of ['hips','spine','head']) pl[k].rotation.set(0,0,0);
  for (const a of [pl.armL, pl.armR]) { a.sh.rotation.set(0,0,0); a.elbow.rotation.set(0,0,0); }
  for (const l of [pl.legL, pl.legR]) { l.thigh.rotation.set(0,0,0); l.knee.rotation.set(0,0,0); l.foot.rotation.set(0,0,0); }
  pl.hips.position.set(0, 0.98, 0); pl.root.position.set(0,0,0); pl.root.rotation.set(0,0,0); pl.root.updateMatrixWorld(true);
  pl.racket && (pl.racket.visible = false);
  const THREEbox = pl.root.constructor; 
  const B = new (w.scene.constructor === undefined ? Object : Object)();
  const box = (o) => { const b = new (window.__Box3)(); b.setFromObject(o); return b; };
  const wp = (o) => { const v = new (window.__V3)(); o.getWorldPosition(v); return v; };
  const total = box(pl.root);
  const sz = total.getSize(new (window.__V3)());
  const out = { scale: pl.root.scale.x, totalHeight: +(total.max.y - total.min.y).toFixed(3), widthAtWidest: +sz.x.toFixed(3), depth: +sz.z.toFixed(3) };
  const hs = wp(pl.armR.sh), hl = wp(pl.armL.sh);
  out.shoulderJointWidth = +hs.distanceTo(hl).toFixed(3);
  out.shoulderHeight = +hs.y.toFixed(3);
  const hipR = wp(pl.legR.thigh), hipL = wp(pl.legL.thigh);
  out.hipJointWidth = +hipR.distanceTo(hipL).toFixed(3); out.hipHeight = +hipR.y.toFixed(3);
  out.kneeHeight = +wp(pl.legR.knee).y.toFixed(3); out.ankleHeight = +wp(pl.legR.foot).y.toFixed(3);
  out.elbowDrop = +(hs.y - wp(pl.armR.elbow).y).toFixed(3); out.wristDrop = +(hs.y - wp(pl.armR.hand).y).toFixed(3);
  out.headCentreHeight = +wp(pl.head).y.toFixed(3);
  const hb = box(pl.head); out.headHeight = +(hb.max.y - hb.min.y).toFixed(3); out.headWidth = +(hb.max.x - hb.min.x).toFixed(3);
  const tb = box(pl.spine); out.torsoBoxWidth = +(tb.max.x - tb.min.x).toFixed(3);
  out.headsTall = +(out.totalHeight / out.headHeight).toFixed(2);
  return out;
};
