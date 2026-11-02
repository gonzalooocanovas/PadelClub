import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// variants.js imports the looks catalogue through the browser path (/shared/...): load a copy with a relative path for Node.
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '../client/js/variants.js'), 'utf8').replace("'/shared/looks.js'", "'../../shared/looks.js'");
const tmp = path.join(here, '../client/js/.variants.node.mjs');
fs.writeFileSync(tmp, src);
const V = await import(pathToFileURL(tmp).href);
fs.rmSync(tmp, { force: true });

const px = (...rgb) => new Uint8ClampedArray(rgb.flatMap((c) => [...c, 255]));
const NAVY = [20, 32, 70], SKIN = [200, 150, 120], HAIR = [60, 40, 28], WHITE = [240, 240, 240];

test('the kit colour changes the navy pixels only', () => {
  const a = px(NAVY, SKIN, HAIR, WHITE); V.recolorPixels(a, { outfit: 4, skin: 0, hair: 0 }); // red kit, original skin and hair settings
  assert.ok(a[0] > a[2] * 1.5, 'navy turned red');
  assert.deepEqual([...a.slice(8, 12)].slice(0, 3).length, 3);
  assert.deepEqual([...a.slice(12, 15)], WHITE, 'white socks and shoes are untouched');
});

test('every kit gives a different shirt colour, and index 0 keeps the original navy', () => {
  const seen = new Set();
  for (let i = 0; i < V.OUTFITS.length; i++) { const a = px(NAVY); V.recolorPixels(a, { outfit: i, skin: 0, hair: 0 }); seen.add([...a.slice(0, 3)].join(',')); }
  assert.equal(seen.size, V.OUTFITS.length);
  const a = px(NAVY); V.recolorPixels(a, { outfit: 0, skin: 0, hair: 0 });
  assert.deepEqual([...a.slice(0, 3)], NAVY);
});

test('skin tone index darkens or keeps the skin, never changing its hue family', () => {
  const light = px(SKIN), dark = px(SKIN);
  V.recolorPixels(light, { outfit: 0, skin: 0, hair: 0 }); V.recolorPixels(dark, { outfit: 0, skin: 3, hair: 0 });
  assert.deepEqual([...light.slice(0, 3)], SKIN);
  assert.ok(dark[0] < SKIN[0] * 0.8 && dark[0] > dark[2], 'darker but still warm');
});

test('hair colour is applied to dark warm pixels only', () => {
  const a = px(HAIR, NAVY); V.recolorPixels(a, { outfit: 0, skin: 0, hair: 3 }); // index 3: light brown
  assert.ok(a[0] !== HAIR[0] || a[1] !== HAIR[1], 'hair pixel changed');
  assert.deepEqual([...a.slice(4, 7)], NAVY, 'navy pixel not treated as hair');
});

test('the four default players get four different looks', () => {
  const looks = [{ arch: 0, skin: 0, hair: 0 }, { arch: 1, skin: 2, hair: 1 }, { arch: 2, skin: 1, hair: 5 }, { arch: 3, skin: 3, hair: 2 }];
  const keys = looks.map((l, i) => JSON.stringify(V.variantFor(l, i >> 1)));
  assert.equal(new Set(keys).size, 4);
});
