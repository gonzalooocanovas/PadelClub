import { COURT, PHYS, PLAYER, clamp } from './constants.js';

const { HALF_W, HALF_L, NET_H, WALL_H, BALL_R } = COURT;

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
  const max = (sprinting ? PLAYER.SPRINT : PLAYER.RUN) * mul;
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
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  if (sprinting) p.stamina = Math.max(0, p.stamina - PLAYER.SPRINT_COST * dt);
  else p.stamina = Math.min(PLAYER.STAMINA_MAX, p.stamina + PLAYER.STAMINA_REGEN * dt);

  const xl = p.xLim || PLAYER.MAX_X;
  p.x = clamp(p.x, -xl, xl);
  // players cannot cross the net
  if (p.team === 0) p.z = clamp(p.z, -HALF_L + PLAYER.BACK_GAP, -PLAYER.NET_GAP);
  else p.z = clamp(p.z, PLAYER.NET_GAP, HALF_L - PLAYER.BACK_GAP);
  if (limit) p.z = clamp(p.z, limit.zMin, limit.zMax);
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
  const drag = 1 - PHYS.DRAG * dt;
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
    if (cy - BALL_R < netHeight(cx) && Math.abs(cx) <= hw) {
      events.push({ type: 'net', x: cx, y: cy, speed: Math.hypot(b.vx, b.vz) });
      nz = pz < 0 ? -0.02 : 0.02;
      b.vz = -b.vz * 0.22;
      b.vx *= 0.6;
      b.vy *= 0.5;
      nx = px; ny = cy;
    }
  }

  // side walls
  if (Math.abs(nx) > hw - BALL_R) {
    if (ny > WALL_H) {
      events.push({ type: 'out', x: nx, y: ny, z: nz });
    } else {
      const s = Math.sign(nx);
      nx = s * (hw - BALL_R);
      events.push({ type: 'wall', axis: 'x', x: nx, y: ny, z: nz, speed: Math.abs(b.vx) });
      b.vx = -b.vx * PHYS.WALL_E;
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
      b.vz = -b.vz * PHYS.WALL_E;
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
    b.vy = -b.vy * clamp(PHYS.FLOOR_E * (1 - 0.014 * s), 0.35, 0.95);
    if (b.vy < 0.5) b.vy = 0;
    const hf = clamp(PHYS.FLOOR_FRIC * (1 - 0.016 * s), 0.5, 1.02);
    b.vx *= hf; b.vz *= hf;
    b.sb = s * 0.5; b.ss = (b.ss || 0) * 0.75;
  }

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
    const e = ev[0];
    if (e) return { kind: e.type, x: b.x, z: b.z, t, netH: e.type === 'net' ? e.y : netH };
  }
  return { kind: 'none', x: b.x, z: b.z, t: maxT, netH };
}
