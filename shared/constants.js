// World: x = across the court (-5..5), z = along it (-10..10), y = up. The net is the plane z = 0.
// Team 0 defends z < 0 (and attacks towards +z); team 1 defends z > 0.

export const COURT = {
  HALF_W: 5,
  HALF_L: 10,
  NET_H: 0.88,
  WALL_H: 4, // 3 m glass + 1 m mesh; anything above is out of play
  SERVICE_LINE: 6.95, // distance from the net
  BALL_R: 0.0335,
};

export const PHYS = {
  G: 9.81,
  FLOOR_E: 0.74, // vertical restitution on turf
  FLOOR_FRIC: 0.86, // horizontal speed kept per floor bounce
  WALL_E: 0.62,
  WALL_FRIC: 0.93,
  DT: 1 / 60,
  MAGNUS: 0.012,
  DRAG: 0.06,
  WALL_SPIN: 0.14,
};

export const PLAYER = {
  RUN: 6.0,
  SPRINT: 8.0,
  ACCEL: 30,
  DECEL: 38,
  STAMINA_MAX: 100,
  SPRINT_COST: 24, // per second
  STAMINA_REGEN: 13,
  REACH: 1.8,
  SWING_MOVE: 0.3, // movement speed multiplier while swinging: the player is "planted" and steers the shot
  JUMP_TIME: 0.62,
  SWING_TIME: 0.42,
  CONTACT_FROM: 0.05,
  CONTACT_TO: 0.38,
  SWING_COOLDOWN: 0.5,
  MIN_X: -4.75,
  MAX_X: 4.75,
  NET_GAP: 0.7,
  BACK_GAP: 0.35,
};

export const SERVER_TICK = 60;
export const SNAPSHOT_EVERY = 1; // every tick (60 Hz): lowest latency, ~70 KB/s per room
export const POINT_PAUSE = 2.4; // seconds between points

export const SHOT_IDS = [
  'none', 'forehand', 'backhand', 'volley', 'lob', 'smash', 'bandeja',
  'vibora', 'chiquita', 'drop', 'block', 'serve', 'slice',
];

export const DEFAULT_SETTINGS = {
  sets: 3, // best of
  gamesPerSet: 6,
  goldenPoint: false,
  difficulty: 'easy', // bot skill: easy | normal | hard
  court: 'indoor',
  mode: 'doubles', // doubles | singles (1v1)
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
