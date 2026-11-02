// Player variants for the single scanned character: the base colour texture is re-coloured once per combination (cached), so every
// player can wear a different kit, have a different skin tone and a different hair colour while the mesh, normal map and rig are shared.
// It changes pixels only; it cannot change the shape of a face (that needs another model).
import * as THREE from 'three';
import { SKIN_TONES, HAIR_COLORS } from '/shared/looks.js';

// kit palettes: hue in degrees (null keeps the original navy), saturation and value multipliers
export const OUTFITS = [
  { name: 'navy', hue: null },
  { name: 'teal', hue: 172, s: 1.05, v: 1.35 },
  { name: 'forest', hue: 128, s: 0.95, v: 1.2 },
  { name: 'violet', hue: 272, s: 1.0, v: 1.35 },
  { name: 'red', hue: 355, s: 1.2, v: 1.7 },
  { name: 'orange', hue: 24, s: 1.25, v: 2.0 },
  { name: 'white', hue: 210, s: 0.12, v: 3.6 },
  { name: 'black', hue: 230, s: 0.15, v: 0.5 },
];
const SKIN_V = [1.0, 0.8, 1.1, 0.58, 0.9]; // brightness of the skin pixels for each skin tone index

function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, mx ? d / mx : 0, mx];
}
function hsv2rgb(h, s, v) {
  h = ((h % 360) + 360) % 360 / 60; const i = Math.floor(h), f = h - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
}

/** Pure per-pixel recolour (exported for tests). `px` is RGBA bytes, modified in place. */
export function recolorPixels(px, { outfit = 0, skin = 0, hair = 0 }) {
  const o = OUTFITS[outfit % OUTFITS.length], hairC = new THREE.Color(HAIR_COLORS[hair % HAIR_COLORS.length]);
  const hv = rgb2hsv(hairC.r, hairC.g, hairC.b), sv = SKIN_V[skin % SKIN_V.length];
  for (let i = 0; i < px.length; i += 4) {
    const [h, s, v] = rgb2hsv(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255);
    let out = null;
    if (o.hue !== null && h >= 165 && h <= 262 && s > 0.22 && v > 0.07) {           // kit: navy shirt and shorts, teal panels, wristband
      out = hsv2rgb(o.hue + (h - 220) * 0.25, Math.min(1, s * o.s), Math.min(1, v * o.v));
    } else if (sv !== 1 && (h <= 42 || h >= 345) && s >= 0.14 && s <= 0.75 && v > 0.28) { // skin
      out = hsv2rgb(h, Math.min(1, s * (sv < 1 ? 1.1 : 0.95)), Math.min(1, v * sv));
    } else if (hv && (h <= 55) && s > 0.15 && v < 0.34 && v > 0.03) {              // hair, brows (dark warm pixels)
      const k = Math.min(1.6, v / 0.2);
      out = hsv2rgb(hv[0], Math.min(1, hv[1] * 1.1 + 0.1), Math.min(1, Math.max(0.05, hv[2] * 1.1 * k)));
    }
    if (out) { px[i] = out[0] * 255; px[i + 1] = out[1] * 255; px[i + 2] = out[2] * 255; }
  }
  return px;
}

const cache = new Map();
/** A recoloured copy of the model's base colour texture, cached by combination. Returns null if the image cannot be read. */
export function variantTexture(baseTexture, opts) {
  const key = `${opts.outfit}|${opts.skin}|${opts.hair}`;
  if (cache.has(key)) return cache.get(key);
  const img = baseTexture?.image;
  if (!img || !(img.width > 0)) return null;
  try {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height); recolorPixels(d.data, opts); g.putImageData(d, 0, 0);
    const t = new THREE.CanvasTexture(c); t.flipY = baseTexture.flipY; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = baseTexture.wrapS; t.wrapT = baseTexture.wrapT;
    cache.set(key, t); return t;
  } catch (e) { console.error('[player model] recolour failed', e); return null; }
}

/** Which variant a player gets: the archetype and team pick the kit, the look's skin and hair pick the skin tone and hair colour. */
export const variantFor = (look, team) => ({ outfit: (look.arch + (team ? 4 : 0)) % OUTFITS.length, skin: look.skin ?? 0, hair: (look.hair ?? 0) + (look.skin ?? 0) });
