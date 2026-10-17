// Kayak physics. Pure state and maths: no DOM, so it runs under Node for tests.
// Units are metres, seconds and radians. Heading 0 points down -z and grows
// clockwise seen from above, so turning right increases it. Roll > 0 leans right.

export const BOAT = {
  // Strokes: each one adds speed; drag takes it away again.
  impulse: 0.55, // m/s from a clean stroke at full stamina
  minInterval: 0.2, // strokes closer together than this catch less water
  sameSide: 0.45, // power of a second stroke on the same side
  drag: 0.035, // quadratic
  linearDrag: 0.02,
  strokeTime: 0.32, // how long the blade is in the water

  // Stamina: drains with every stroke, recovers all the time.
  cost: 0.012,
  recover: 0.03,

  // Steering: the rudder needs speed to bite; strokes nudge the bow.
  rudder: 0.12, // target yaw rate per m/s of speed
  rudderMaxSpeed: 6,
  yawResponse: 2.5,
  strokeYaw: 0.05,

  // Balance: the hull always slowly tips over on its own. At a standstill it
  // goes quickly; with speed, and while a blade is in the water to brace on,
  // it drifts slowly enough that the odd correction keeps you upright.
  tip: 3.0,
  stabilityStill: 2.5,
  stabilitySpeed: 0.3,
  stableSpeed: 4.5,
  rollDamp: 0.9,
  brace: 0.8,
  lean: 2.2,
  turnRoll: 0.35, // turning throws you to the outside
  strokeRoll: 0.25,
  chop: 0.7, // background wobble from the water
  capsize: 0.8,
  swimTime: 3.5,
};

export function createBoat({ x = 0, z = 0, heading = 0 } = {}) {
  return {
    x, z, heading,
    speed: 0,
    yawRate: 0,
    roll: 0,
    rollRate: 0,
    stamina: 1,
    time: 0,
    lastSide: null,
    lastStroke: -Infinity,
    strokeTimes: [], // recent stroke times, for the stroke rate
    paddle: { side: null, at: -Infinity }, // last stroke, for the paddle animation
    swim: 0, // seconds left climbing back in after a capsize
    onBank: false,
    capsizes: 0,
  };
}

// input: { strokes: ['left' | 'right', ...], rudder: -1..1, lean: -1..1 }
// Returns the events that happened, for sound and the HUD:
// 'stroke' | 'weak' | 'capsize' | 'remount'.
export function step(boat, dt, input) {
  const events = [];
  boat.time += dt;

  if (boat.swim > 0) {
    boat.swim -= dt;
    boat.speed *= Math.exp(-3 * dt);
    if (boat.swim <= 0) {
      Object.assign(boat, { swim: 0, roll: 0, rollRate: 0, yawRate: 0, lastSide: null });
      events.push('remount');
    }
    move(boat, dt);
    return events;
  }

  for (const side of input.strokes ?? []) events.push(stroke(boat, side));

  boat.stamina = Math.min(1, boat.stamina + BOAT.recover * dt);
  boat.speed = Math.max(0, boat.speed - (BOAT.drag * boat.speed ** 2 + BOAT.linearDrag * boat.speed) * dt);

  const bite = Math.min(boat.speed, BOAT.rudderMaxSpeed);
  const target = (input.rudder ?? 0) * BOAT.rudder * bite;
  boat.yawRate += (target - boat.yawRate) * Math.min(1, BOAT.yawResponse * dt);
  boat.heading += boat.yawRate * dt;

  const braced = boat.time - boat.paddle.at < BOAT.strokeTime;
  const stability = BOAT.stabilityStill + BOAT.stabilitySpeed * Math.min(boat.speed / BOAT.stableSpeed, 1);
  const accel = BOAT.tip * Math.sin(boat.roll)
    - stability * boat.roll
    - (BOAT.rollDamp + (braced ? BOAT.brace : 0)) * boat.rollRate
    + BOAT.lean * (input.lean ?? 0)
    - BOAT.turnRoll * boat.yawRate * boat.speed
    + BOAT.chop * chop(boat.time);
  boat.rollRate += accel * dt;
  boat.roll += boat.rollRate * dt;

  if (Math.abs(boat.roll) > BOAT.capsize) {
    boat.swim = BOAT.swimTime;
    boat.capsizes++;
    boat.speed *= 0.3;
    boat.stamina = Math.max(0, boat.stamina - 0.1);
    events.push('capsize');
  }

  move(boat, dt);
  return events;
}

function stroke(boat, side) {
  const gap = boat.time - boat.lastStroke;
  let quality = Math.min(1, gap / BOAT.minInterval);
  const repeat = side === boat.lastSide;
  if (repeat) quality *= BOAT.sameSide;
  quality *= 0.5 + 0.5 * Math.sqrt(boat.stamina);

  const dir = side === 'left' ? 1 : -1; // a left stroke turns the bow right
  boat.speed += BOAT.impulse * quality;
  boat.yawRate += dir * BOAT.strokeYaw * (repeat ? 2.5 : 1) * Math.max(quality, 0.3);
  boat.rollRate += -dir * BOAT.strokeRoll * (repeat ? 2 : 1);
  boat.stamina = Math.max(0, boat.stamina - BOAT.cost * Math.min(1, gap / BOAT.minInterval));

  boat.lastSide = side;
  boat.lastStroke = boat.time;
  boat.paddle = { side, at: boat.time };
  boat.strokeTimes.push(boat.time);
  while (boat.strokeTimes[0] < boat.time - 6) boat.strokeTimes.shift();
  return quality < 0.6 ? 'weak' : 'stroke';
}

function move(boat, dt) {
  boat.x += Math.sin(boat.heading) * boat.speed * dt;
  boat.z -= Math.cos(boat.heading) * boat.speed * dt;
}

// Strokes per minute over the last few seconds. Measured between strokes, so a
// steady rhythm reads steady; once you stop, the gap since the last stroke drags it down.
export function strokeRate(boat) {
  const recent = boat.strokeTimes.filter((t) => t > boat.time - 6);
  if (recent.length < 2) return 0;
  const intervals = recent.length - 1;
  const span = recent.at(-1) - recent[0];
  const idle = boat.time - recent.at(-1);
  const window = idle > (span / intervals) * 1.5 ? boat.time - recent[0] : span;
  return Math.round((intervals / window) * 60);
}

// A deterministic, irregular wobble so the water never feels perfectly still.
function chop(t) {
  return Math.sin(1.7 * t) * Math.sin(0.37 * t + 1) + 0.5 * Math.sin(2.9 * t + 2) * Math.sin(0.23 * t);
}

// Keeps the boat inside the river. `loc` comes from course.locate(). Hitting the
// bank costs speed once; after that the boat scrapes along it with the bow
// turned slightly away. Returns true on the moment of impact.
export function bounceOffBank(boat, loc, halfWidth) {
  const limit = halfWidth - 1;
  if (Math.abs(loc.lateral) <= limit) {
    boat.onBank = false;
    return false;
  }
  const side = Math.sign(loc.lateral);
  const push = Math.abs(loc.lateral) - limit;
  boat.x -= -loc.tz * side * push;
  boat.z -= loc.tx * side * push;
  const along = Math.atan2(loc.tx, -loc.tz);
  if (wrap(boat.heading - along) * side > 0) {
    boat.heading = along - side * 0.05;
    boat.yawRate = 0;
  }
  const impact = !boat.onBank;
  boat.speed *= impact ? 0.6 : 0.998;
  boat.onBank = true;
  return impact;
}

export function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
