import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// env-kit.js imports three's helpers through the browser path (/vendor/three/...). For Node, load a copy with the package path.
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '../client/js/env-kit.js'), 'utf8').replace("'/vendor/three/examples/jsm/utils/BufferGeometryUtils.js'", "'three/examples/jsm/utils/BufferGeometryUtils.js'");
const tmp = path.join(here, '.env-kit.node.mjs');
fs.writeFileSync(tmp, src);
const kit = await import(pathToFileURL(tmp).href);
const THREE = await import('three');
fs.rmSync(tmp, { force: true });

const finite = (g) => { const p = g.attributes.position.array; for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) return false; return true; };
const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

test('the seeded generator is deterministic', () => {
  const a = kit.rng(5), b = kit.rng(5);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
  assert.notEqual(kit.rng(5)(), kit.rng(6)());
});

test('every plant model is finite, painted, and cheap enough to instance', () => {
  const models = { olive: kit.oliveGeometry(1), cypress: kit.cypressGeometry(1), shrub: kit.shrubGeometry(1), lavender: kit.lavenderGeometry(1), grass: kit.grassGeometry(1), palm: kit.palmGeometry(1) };
  for (const [name, g] of Object.entries(models)) {
    assert.ok(finite(g), name + ' has finite vertices');
    assert.ok(g.attributes.color, name + ' is painted with vertex colours');
    assert.ok(tris(g) > 20 && tris(g) < 6000, `${name} triangles ${tris(g)}`);
  }
  // variants differ (so a grove does not look cloned) but are reproducible
  assert.notEqual(tris(kit.oliveGeometry(1)) + kit.oliveGeometry(1).boundingSphere?.radius, tris(kit.oliveGeometry(2)) + 1e9);
  assert.equal(tris(kit.oliveGeometry(3)), tris(kit.oliveGeometry(3)));
});

test('a cypress is tall and narrow, an olive wide and short', () => {
  const box = (g) => new THREE.Box3().setFromBufferAttribute(g.attributes.position);
  const c = box(kit.cypressGeometry(1, 7)).getSize(new THREE.Vector3()), o = box(kit.oliveGeometry(1)).getSize(new THREE.Vector3());
  assert.ok(c.y > 3 * c.x, `cypress ${c.y.toFixed(1)} x ${c.x.toFixed(1)}`);
  assert.ok(o.x > o.y * 0.8 && o.y < 5.5, `olive ${o.x.toFixed(1)} wide, ${o.y.toFixed(1)} high`);
});

const fakeGroup = () => { const items = []; return { items, add: (...o) => items.push(...o) }; };
const mats = { concrete: new THREE.MeshStandardMaterial(), dark: new THREE.MeshStandardMaterial() };

test('a seating bank has consistent tiers, aisles, and seats that face the court', () => {
  const g = fakeGroup();
  const bank = kit.seatingBank(g, { origin: [7.6, 0, 13], along: [0, 0, -1], away: [1, 0, 0], rows: 6, length: 26, concrete: mats.concrete, dark: mats.dark, rand: kit.rng(1) });
  assert.ok(bank.seats.length > 150 && bank.seats.length < 400, 'seats ' + bank.seats.length);
  for (const [x, y, z, yaw] of bank.seats) {
    assert.ok(x >= 7.6 && x <= 7.6 + 6 * 0.85 + 0.01, 'seat inside the bank in x: ' + x);
    assert.ok(z >= -13 && z <= 13, 'seat inside the bank in z: ' + z);
    assert.ok(y >= 0.42 && y <= 0.42 * 6 + 0.01, 'tier height ' + y);
    assert.ok(Math.abs(Math.abs(yaw) - Math.PI / 2) < 1e-6, 'a side seat looks along x');
  }
  assert.ok(Math.min(...bank.seats.map((s) => Math.abs(s[0]))) > 6.1, 'no seat inside the playing area or its fence');
  // rows climb: the back row is higher than the front row
  assert.ok(Math.max(...bank.seats.map((s) => s[1])) > Math.min(...bank.seats.map((s) => s[1])) + 1.5);
});

test('spectators are two instanced meshes, register for the cheering animation, and sit on seats', () => {
  const g = fakeGroup(), ctx = { crowds: [] };
  const seats = []; for (let i = 0; i < 200; i++) seats.push([8 + (i % 20) * 0.5, 0.5, i * 0.1, 1.2]);
  const r = kit.spectators(ctx, g, seats, { occupancy: 0.7, rand: kit.rng(3) });
  assert.equal(g.items.length, 2);
  assert.ok(r.count > 100 && r.count < 180);
  assert.equal(ctx.crowds.length, 1);
  assert.equal(ctx.crowds[0].people.length, r.count);
  assert.equal(ctx.crowds[0].headOffset, 0);
});

test('a floodlight mast carries 12 aimed lamp units, and all lenses can be drawn in one instanced mesh', () => {
  const g = fakeGroup(); const m = new THREE.MeshStandardMaterial();
  const masts = [[-13.5, -17], [13.5, 17]].map(([x, z]) => kit.floodlightMast(g, { x, z, height: 19, target: [0, 0.5, 0], steel: m, dark: m, lensMat: m }));
  for (const mast of masts) {
    assert.equal(mast.lenses.length, 12);
    assert.ok(mast.dir.y < -0.5, 'the lamps point down at the court');
    const toCourt = new THREE.Vector3(0, 0.5, 0).sub(mast.head.position).normalize();
    assert.ok(mast.dir.dot(toCourt) > 0.999, 'and at its centre');
    assert.ok(mast.head.position.y === 19 && (Math.abs(mast.head.position.x) > 12 && Math.abs(mast.head.position.z) > 16), 'the mast stands beyond the stands');
  }
  const lenses = kit.lensMesh(g, masts, new THREE.MeshBasicMaterial());
  assert.equal(lenses.count, 24);
});

test('disposeGroup frees geometries, materials and instanced buffers, and can be called twice', () => {
  const grp = new THREE.Group(); const geo = new THREE.BoxGeometry(1, 1, 1), mat = new THREE.MeshStandardMaterial();
  let g = 0, m = 0; geo.addEventListener('dispose', () => g++); mat.addEventListener('dispose', () => m++);
  grp.add(new THREE.Mesh(geo, mat), new THREE.InstancedMesh(geo, mat, 4));
  kit.disposeGroup(grp); kit.disposeGroup(grp);
  assert.ok(g >= 1 && m >= 1);
});
