import { COURT, PHYS, PLAYER, clamp } from './constants.js';

const { HALF_W, HALF_L, NET_H, WALL_H, BALL_R, DOOR, PIT } = COURT;

/**
 * Player movement. Used by the server (authoritative) and by the client (prediction),
 * so both must stay bit-for-bit the same function.
 * @param p {x,z,vx,vz,stamina,team}
 * @param inp {mx,mz,sprint}  mx/mz are world-space axes in -1..1
 * @param limit optional {zMin,zMax} extra z bounds (used while serving)
 */
export function stepPlayer(p, inp, dt, limit, mul = 1) {
  let mx = inp.mx || 0;
  let mz = inp.mz || 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const moving = len > 0.05;
  const sprinting = !!inp.sprint && moving && p.stamina > 4 && mul >= 1;
  const tired = clamp((PLAYER.TIRED_FROM - p.stamina) / PLAYER.TIRED_FROM, 0, 1); // 0 fresh .. 1 exhausted
  const max = (sprinting ? PLAYER.SPRINT : PLAYER.RUN) * mul * (p.speedMul || 1) * (1 - 0.18 * tired); // speedMul: upgrades, local matches only
  const tvx = mx * max;
  const tvz = mz * max;
  const dvx = tvx - p.vx;
  const dvz = tvz - p.vz;
  const dl = Math.hypot(dvx, dvz);
  // reversing direction means braking first (real footwork): it costs a beat, like a split step
  const reversing = moving && p.vx * tvx + p.vz * tvz < 0;
  const maxChange = (moving && !reversing ? PLAYER.ACCEL : PLAYER.DECEL) * dt;
  if (dl <= maxChange || dl === 0) {
    p.vx = tvx; p.vz = tvz;
  } else {
    p.vx += (dvx / dl) * maxChange;
    p.vz += (dvz / dl) * maxChange;
  }
  const prevX = p.x;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  const drain = p.drainMul || 1;
  if (sprinting) p.stamina -= PLAYER.SPRINT_COST * drain * dt;
  else p.stamina += (p.inRally ? PLAYER.RALLY_REGEN : PLAYER.STAMINA_REGEN) * (p.regenMul || 1) * dt;
  if (p.inRally) p.stamina -= PLAYER.RALLY_DRAIN * drain * dt;
  p.stamina = clamp(p.stamina, 0, PLAYER.STAMINA_MAX);

  const xl = p.xLim || PLAYER.MAX_X;
  // players cannot cross the net
  if (p.team === 0) p.z = clamp(p.z, -HALF_L + PLAYER.BACK_GAP, -PLAYER.NET_GAP);
  else p.z = clamp(p.z, PLAYER.NET_GAP, HALF_L - PLAYER.BACK_GAP);
  if (p.pit) clampWithDoors(p, prevX);
  else p.x = clamp(p.x, -xl, xl);
  if (limit) p.z = clamp(p.z, limit.zMin, limit.zMax);
}

/**
 * Doubles with access doors: a player may walk out through a door in the side wall and move in the fenced strip outside,
 * but only through the door itself. Called on the server and in client prediction (same function).
 */
function clampWithDoors(p, prevX) {
  const az = Math.abs(p.z);
  const door = az >= DOOR.z0 + 0.15 && az <= DOOR.z1 - 0.15;
  const outer = HALF_W + PIT.w - 0.4;
  if (Math.abs(prevX) > HALF_W + 0.05) { // already outside: stay in the strip, or come back in through the door
    const s = Math.sign(p.x) || Math.sign(prevX) || 1;
    p.x = s * clamp(Math.abs(p.x), door ? PLAYER.MAX_X : HALF_W + 0.4, outer);
    p.z = Math.sign(p.z || 1) * clamp(az, PLAYER.NET_GAP, PIT.z1 - 0.3);
  } else {
    const lim = door ? outer : PLAYER.MAX_X;
    p.x = clamp(p.x, -lim, lim);
  }
}

/** Rules: until the serve is hit the server must stay behind the service line; everybody else stands still. */
export function serveLimit(team) {
  const line = COURT.SERVICE_LINE + 0.1;
  return team === 0 ? { zMin: -HALF_L + PLAYER.BACK_GAP, zMax: -line } : { zMin: line, zMax: HALF_L - PLAYER.BACK_GAP };
}

/** Height of the net top at lateral position x: 0.88 m at the centre strap, 0.92 m at the posts (it sags). */
export function netHeight(x) {
  const u = Math.min(1, Math.abs(x) / HALF_W);
  return COURT.NET_H + 0.04 * u * u;
}

/** Glass returns the ball livelier at low speed; the mesh above 3 m is much deader. */
export function wallE(speed, y) {
  const e = PHYS.WALL_E * (1 - 0.012 * Math.min(speed, 20));
  return y > 3 ? e * 0.55 : e;
}

/** Height of the ball the server bounces by hand at game time t (period 0.8 s). */
export function serveBallHeight(t) {
  const ph = (t % 0.8) / 0.8;
  return 0.1 + 0.86 * Math.abs(Math.cos(Math.PI * ph));
}

export function makeBall() {
  return { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, sb: 0, ss: 0 };
}

/**
 * Advance the ball one step. Returns a list of physical events:
 *  {type:'floor', x,z, speed} {type:'wall', axis:'x'|'z', x,y,z} {type:'net', x,y} {type:'out', x,y,z}
 */
export function stepBall(b, dt, events) {
  // Magnus effect: backspin (sb>0) lifts the ball, topspin (sb<0) dives; sidespin (ss) curves it left/right of travel.
  const hw = b.hw || HALF_W; // half width of the walls (narrower in 1v1)
  const sb = b.sb || 0, ss = b.ss || 0;
  const sh = Math.hypot(b.vx, b.vz);
  const hx0 = sh > 0.5 ? b.vx / sh : 0;
  const hz0 = sh > 0.5 ? b.vz / sh : 0;
  if (sh > 0.5 && (sb || ss)) {
    b.vy += PHYS.MAGNUS * sb * sh * dt;
    const lat = PHYS.MAGNUS * ss * sh * dt;
    b.vx += hz0 * lat; b.vz -= hx0 * lat;
    const d = Math.exp(-0.35 * dt);
    b.sb = sb * d; b.ss = ss * d;
  }
  const speed3 = Math.hypot(b.vx, b.vy, b.vz);
  const drag = 1 - (PHYS.DRAG * 0.6 + PHYS.DRAG2 * speed3) * dt; // linear plus a quadratic part: fast balls slow down more
  b.vx *= drag; b.vy *= drag; b.vz *= drag;
  b.vy -= PHYS.G * dt;
  const px = b.x, py = b.y, pz = b.z;
  let nx = px + b.vx * dt;
  let ny = py + b.vy * dt;
  let nz = pz + b.vz * dt;

  // net plane (z = 0)
  if ((pz < 0) !== (nz < 0) && pz !== nz) {
    const f = Math.abs(pz) / Math.abs(nz - pz);
    const cy = py + (ny - py) * f;
    const cx = px + (nx - px) * f;
    const top = netHeight(cx);
    if (cy - BALL_R < top && cy - BALL_R > top - 0.045 && b.vy < 3 && Math.abs(cx) <= hw && !b.cord) {
      // clips the tape: the ball loses pace, pops up and may still drop over
      events.push({ type: 'cord', x: cx, y: cy, speed: Math.hypot(b.vx, b.vz) });
      b.vz *= 0.5; b.vx *= 0.8; b.vy = Math.abs(b.vy) * 0.3 + 1.6; b.cord = true;
    } else if (cy - BALL_R < top && Math.abs(cx) <= hw) {
      events.push({ type: 'net', x: cx, y: cy, speed: Math.hypot(b.vx, b.vz) });
      nz = pz < 0 ? -0.02 : 0.02;
      b.vz = -b.vz * 0.22;
      b.vx *= 0.6;
      b.vy *= 0.5;
      nx = px; ny = cy;
    }
  }

  if (b.ex) {
    // the ball is in the strip outside a door
    const s = Math.sign(px) || 1;
    const ax = Math.abs(nx), az = Math.abs(nz);
    const xo = HALF_W + PIT.w;
    if (ax > xo - BALL_R) {
      if (ny > WALL_H) events.push({ type: 'out', x: nx, y: ny, z: nz });
      else { nx = s * (xo - BALL_R); events.push({ type: 'wall', axis: 'x', x: nx, y: ny, z: nz, speed: Math.abs(b.vx) }); b.vx = -b.vx * PHYS.WALL_E; b.vz *= PHYS.WALL_FRIC; }
    }
    if (az > PIT.z1 - BALL_R) {
      if (ny <= WALL_H) {
        const sz = Math.sign(nz) || 1;
        nz = sz * (PIT.z1 - BALL_R);
        events.push({ type: 'wall', axis: 'z', x: nx, y: ny, z: nz, speed: Math.abs(b.vz) });
        b.vz = -b.vz * PHYS.WALL_E; b.vx *= PHYS.WALL_FRIC;
      }
    }
    if (Math.abs(nx) < HALF_W + BALL_R && Math.abs(px) >= HALF_W) {
      const inDoor = Math.abs(nz) > DOOR.z0 && Math.abs(nz) < DOOR.z1 && ny < DOOR.h;
      if (!inDoor && ny <= WALL_H && Math.abs(b.vx) > 0 && Math.sign(b.vx) !== s) { // glass seen from outside
        nx = s * (HALF_W + BALL_R);
        events.push({ type: 'wall', axis: 'x', x: nx, y: ny, z: nz, speed: Math.abs(b.vx) });
        b.vx = -b.vx * PHYS.WALL_E; b.vz *= PHYS.WALL_FRIC;
      }
    }
    if (Math.abs(nx) < HALF_W - 0.3) b.ex = false;
  } else if (b.doors && Math.abs(nx) > hw - BALL_R && Math.abs(nz) > DOOR.z0 && Math.abs(nz) < DOOR.z1 && ny < DOOR.h) {
    // through the open door
    if (Math.abs(nx) > hw + 0.05) { b.ex = true; events.push({ type: 'door', x: nx, y: ny, z: nz }); }
  } else if (Math.abs(nx) > hw - BALL_R) {
    if (ny > WALL_H) {
      events.push({ type: 'out', x: nx, y: ny, z: nz });
    } else {
      const s = Math.sign(nx);
      nx = s * (hw - BALL_R);
      events.push({ type: 'wall', axis: 'x', x: nx, y: ny, z: nz, speed: Math.abs(b.vx) });
      b.vx = -b.vx * wallE(Math.abs(b.vx), ny);
      b.vz += -hx0 * (b.ss || 0) * PHYS.WALL_SPIN; // sidespin kicks the ball along the glass
      b.vz *= PHYS.WALL_FRIC;
      b.vy *= PHYS.WALL_FRIC;
    }
  }
  // back walls
  if (Math.abs(nz) > HALF_L - BALL_R) {
    if (ny > WALL_H) {
      events.push({ type: 'out', x: nx, y: ny, z: nz });
    } else {
      const s = Math.sign(nz);
      nz = s * (HALF_L - BALL_R);
      events.push({ type: 'wall', axis: 'z', x: nx, y: ny, z: nz, speed: Math.abs(b.vz) });
      b.vz = -b.vz * wallE(Math.abs(b.vz), ny);
      b.vx += hz0 * (b.ss || 0) * PHYS.WALL_SPIN;
      b.vx *= PHYS.WALL_FRIC;
      b.vy *= PHYS.WALL_FRIC;
    }
  }

  // floor
  if (ny < BALL_R && b.vy < 0) {
    ny = BALL_R;
    events.push({ type: 'floor', x: nx, z: nz, speed: Math.abs(b.vy) });
    // backspin (sb>0) bites: lower bounce, ball slows. Topspin (sb<0) kicks up and forward.
    const s = b.sb || 0;
    b.vy = -b.vy * clamp((b.fe ?? PHYS.FLOOR_E) * (1 - 0.014 * s) * (1 - 0.008 * Math.min(Math.abs(b.vy), 12)), 0.35, 0.95);
    if (b.vy < 0.5) b.vy = 0;
    const hf = clamp((b.ff ?? PHYS.FLOOR_FRIC) * (1 - 0.016 * s), 0.5, 1.02);
    b.vx *= hf; b.vz *= hf;
    b.sb = s * 0.5; b.ss = (b.ss || 0) * 0.75;
  }

  if (b.cord && Math.abs(nz) > 0.3) b.cord = false;
  b.x = nx; b.y = ny; b.z = nz;
}

/** Ballistic launch: velocity that takes the ball from (x,y,z) to the floor point (tx,tz) in T seconds. */
export function solveLaunch(b, tx, tz, T) {
  return {
    vx: (tx - b.x) / T,
    vz: (tz - b.z) / T,
    vy: (BALL_R - b.y + 0.5 * PHYS.G * T * T) / T,
  };
}

/** Height of the ball above the floor when it crosses the net plane for a given launch (or null). */
export function heightAtNet(b, v) {
  if (v.vz === 0) return null;
  const t = -b.z / v.vz;
  if (t <= 0) return null;
  return b.y + v.vy * t - 0.5 * PHYS.G * t * t;
}

/** Copy the ball and simulate ahead; returns samples [{t,x,y,z,vy}] */
export function predictBall(ball, seconds, step = 1 / 60) {
  const b = { ...ball };
  const out = [];
  const ev = [];
  for (let t = step; t <= seconds; t += step) {
    ev.length = 0;
    stepBall(b, step, ev);
    out.push({ t, x: b.x, y: b.y, z: b.z, vy: b.vy, floor: ev.some((e) => e.type === 'floor') });
  }
  return out;
}

/**
 * Fly a launched ball through the real physics (spin, drag, ...) until it first touches something.
 * Returns {kind:'floor'|'wall'|'net'|'out'|'none', x, z, t, netH} where netH is the ball height when it crosses the net plane.
 */
export function simulateShot(ball, v, spin, maxT = 4) {
  const b = { ...ball, vx: v.vx, vy: v.vy, vz: v.vz, sb: spin.sb, ss: spin.ss };
  const ev = [];
  const side0 = Math.sign(b.z) || 1;
  let netH = null;
  for (let t = 0; t < maxT; t += PHYS.DT) {
    const pz = b.z;
    ev.length = 0;
    stepBall(b, PHYS.DT, ev);
    if (netH === null && Math.sign(pz) === side0 && Math.sign(b.z) !== side0) netH = b.y;
    const e = ev.find((x) => x.type !== 'door' && x.type !== 'cord');
    if (e) return { kind: e.type, x: b.x, z: b.z, t, netH: e.type === 'net' ? e.y : netH };
  }
  return { kind: 'none', x: b.x, z: b.z, t: maxT, netH };
}
