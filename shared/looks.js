// Shared catalogue: character archetypes, racket designs and courts.
// The server validates every id it receives from this file; clients render from it.

export const ARCHETYPES = [
  // height: overall scale · shoulder/build/limb: silhouette multipliers · kit: 'tee' (shirt + shorts) or 'tank' (top + skirt)
  { id: 0, key: 'agile', name: 'Agile', blurb: 'Quick feet, light frame. Lives at the net.', height: 1.02, shoulder: 0.96, build: 0.92, limb: 0.94, head: 0.98, kit: 'tee', hair: 0, skin: 0 },
  { id: 1, key: 'allrounder', name: 'All-rounder', blurb: 'Balanced and steady from every position.', height: 0.96, shoulder: 0.88, build: 0.9, limb: 0.9, head: 0.96, kit: 'tank', hair: 1, skin: 2 },
  { id: 2, key: 'power', name: 'Power', blurb: 'Tall, strong overhead. Finishes points.', height: 1.08, shoulder: 1.14, build: 1.12, limb: 1.14, head: 1.02, kit: 'tee', hair: 5, skin: 1 },
  { id: 3, key: 'defender', name: 'Defender', blurb: 'Compact and tireless. Gets every ball back.', height: 0.92, shoulder: 0.94, build: 1.0, limb: 0.98, head: 0.97, kit: 'tank', hair: 2, skin: 3 },
];

export const HAIR_STYLES = ['Crop', 'Ponytail', 'Bun', 'Curls', 'Long', 'Cap', 'Buzz'];
export const SKIN_TONES = [0xd9ab88, 0xa8704a, 0xeec6a6, 0x7a4b30, 0xc08b63];
export const HAIR_COLORS = [0x1b1410, 0x4a3320, 0x0d0d0d, 0x9a6a2a, 0x6b2b1e];

// Rackets are cosmetic: they never change the physics, so nobody can buy an advantage.
export const RACKETS = [
  { id: 0, name: 'Nova Control', category: 'Control', shape: 'teardrop', frame: 0x1a1d24, face: 0x2057c8, accent: 0x5ea2ff, holes: 'grid', note: 'Teardrop head, low balance.' },
  { id: 1, name: 'Atlas Balance', category: 'Balanced', shape: 'teardrop', frame: 0x20242c, face: 0xc23b32, accent: 0xff8a7a, holes: 'radial', note: 'The all-purpose shape.' },
  { id: 2, name: 'Vortex Power', category: 'Power', shape: 'diamond', frame: 0x14171d, face: 0xa6d51f, accent: 0xe6ff5a, holes: 'dense', note: 'Diamond head, high balance.' },
  { id: 3, name: 'Bastion Defense', category: 'Defensive', shape: 'round', frame: 0x23262e, face: 0xb8bcc4, accent: 0xffd34d, holes: 'sparse', note: 'Round head, huge sweet spot.' },
  { id: 4, name: 'Feather Light', category: 'Lightweight', shape: 'teardrop', frame: 0x2a2f38, face: 0xf2f4f7, accent: 0x7fe0c8, holes: 'grid', note: 'Whisper-light and nimble.' },
  { id: 5, name: 'First Serve', category: 'Beginner', shape: 'round', frame: 0x30343d, face: 0xff9f2e, accent: 0xffffff, holes: 'sparse', note: 'Forgiving and friendly.' },
  { id: 6, name: 'Apex Pro', category: 'Professional', shape: 'diamond', frame: 0x0e1014, face: 0x101318, accent: 0xff3b3b, holes: 'radial', note: 'Carbon black, tour finish.' },
  { id: 7, name: 'Aurum Edition', category: 'Premium', shape: 'teardrop', frame: 0x3a2f12, face: 0xd9b24a, accent: 0xfff0b0, holes: 'dense', note: 'Gold cosmetic finish.' },
];

// Courts. `surface` is the only gameplay difference and it is deliberately small and documented:
//   floorE    vertical restitution of the turf (fraction of vertical speed kept per bounce)
//   floorFric horizontal speed kept per bounce
export const COURTS = {
  indoor: {
    id: 'indoor', name: 'Premium Indoor Club',
    blurb: 'Fast, even indoor turf under a high roof and refined lighting.',
    surface: { floorE: 0.85, floorFric: 0.86 },
  },
  outdoor: {
    id: 'outdoor', name: 'Mediterranean Court',
    blurb: 'Warm daylight, palms and white walls. Slightly slower, more abrasive turf.',
    surface: { floorE: 0.83, floorFric: 0.84 },
  },
  rooftop: {
    id: 'rooftop', name: 'Sunset Rooftop',
    blurb: 'A city rooftop at golden hour with string lights. Slightly quick turf.',
    surface: { floorE: 0.84, floorFric: 0.85 },
  },
  night: {
    id: 'night', name: 'Night Arena',
    blurb: 'Floodlit tournament arena with a full crowd. Fast turf.',
    surface: { floorE: 0.85, floorFric: 0.855 },
  },
};
export const COURT_IDS = Object.keys(COURTS);

export const DEFAULT_LOOKS = [
  { arch: 0, hair: 0, skin: 0, racket: 0 },
  { arch: 1, hair: 1, skin: 2, racket: 1 },
  { arch: 2, hair: 5, skin: 1, racket: 2 },
  { arch: 3, hair: 2, skin: 3, racket: 3 },
];

const int = (v, max, fallback) => (Number.isInteger(v) && v >= 0 && v <= max ? v : fallback);

/** Clamp anything a client sends into a valid look; never trust the shape of the input. */
export function sanitizeLook(l, slot = 0) {
  const d = DEFAULT_LOOKS[slot & 3];
  if (!l || typeof l !== 'object') return { ...d };
  return {
    arch: int(l.arch, ARCHETYPES.length - 1, d.arch),
    hair: int(l.hair, HAIR_STYLES.length - 1, d.hair),
    skin: int(l.skin, SKIN_TONES.length - 1, d.skin),
    racket: int(l.racket, RACKETS.length - 1, d.racket),
  };
}
