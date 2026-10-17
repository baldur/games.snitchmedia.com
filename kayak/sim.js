// Kayak physics. Pure state and maths: no DOM, so it runs under Node for tests.
// Units are metres, seconds and radians. Heading 0 points down -z and grows
// clockwise seen from above, so turning right increases it. Roll > 0 leans right.

export const BOAT = {
  // Strokes: each one adds speed; drag takes it away again. Tuned to real K1
  // speeds: about 10 km/h at an easy rhythm, 12-13 km/h at a sustainable racing
  // rhythm, 17-18 km/h flat out on fresh legs.
  impulse: 0.35, // m/s from a clean stroke at full stamina
  minInterval: 0.2, // strokes closer together than this catch less water
  sameSide: 0.45, // power of a second stroke on the same side
  drag: 0.067, // quadratic
  linearDrag: 0.02,
  strokeTime: 0.32, // how long the blade is in the water

  // Stamina: drains with every stroke, recovers all the time. They balance at
  // about one stroke every 0.33 s: faster than that eats into your reserve.
  cost: 0.012,
  recover: 0.036,

  // Steering: the rudder needs speed to bite; strokes nudge the bow.
  rudder: 0.16, // target yaw rate per m/s of speed
  rudderMaxSpeed: 6,
  yawResponse: 2.5,
  strokeYaw: 0.05,

  // Balance: the hull always slowly tips over on its own. At a standstill it
  // goes quickly; with speed, and while a blade is in the water to brace on,
  // it drifts slowly enough that the odd correction keeps you upright.
  tip: 3.0,
  stabilityStill: 2.5,
  stabilitySpeed: 0.3,
  stableSpeed: 3.5,
  rollDamp: 0.9,
  brace: 0.8,
  lean: 2.2,
  turnRoll: 0.35, // turning throws you to the outside
  strokeRoll: 0.25,
  chop: 0.7, // background wobble from the water
  washRock: 1.6, // extra rocking while riding another boat's wash
  capsize: 0.8,
  swimTime: 3.5,

  // Riding another boat's wash: less drag for the same effort.
  draft: 0.3, // drag saved at the sweet spot

  // Rhythm, 0..1: built by a steady, alternating beat, and lost by irregular
  // strokes, pauses, steering and knocks. Strokes out of rhythm pull only
  // `rhythmBase` of their power, so finding your beat again after a bend or a
  // move onto someone's wash costs a burst of effort.
  rhythmGain: 0.1, // per stroke right on the beat
  rhythmSlop: 0.15, // how far off the beat (as a fraction) still counts
  rhythmBase: 0.6,
  slowBeat: 0.42, // seconds per stroke: a lazier beat than this caps your rhythm
  steerCost: 0.2, // rhythm lost per second of full rudder, which also stops it building
  fallCost: 0.4, // capsizing also costs this much stamina-equivalent speed
  beam: 1, // hull width, for the mesh
};

// The hulls you can race. Narrower is faster and tippier, needs a quicker,
// steadier beat, and a swim costs more. Wider is slower and forgiving.
export const HULLS = {
  stable: {
    ...BOAT, name: 'Stable', beam: 1.3,
    drag: 0.074, tip: 2.5, stabilitySpeed: 0.6,
    rhythmBase: 0.75, slowBeat: 0.5, swimTime: 3, fallCost: 0.3,
  },
  club: { ...BOAT, name: 'Club racer' },
  racing: {
    ...BOAT, name: 'Racing', beam: 0.8,
    drag: 0.06, tip: 3.6, stabilityStill: 2.4, brace: 0.6,
    rhythmBase: 0.45, slowBeat: 0.37, rhythmSlop: 0.12, swimTime: 5, fallCost: 0.55,
  },
};

// power scales every stroke and endurance scales stamina recovery, so rivals
// can be fitter or weaker than you on the same boat.
export function createBoat({ x = 0, z = 0, heading = 0, power = 1, endurance = 1, hull = 'club' } = {}) {
  return {
    x, z, heading, power, endurance,
    hull: HULLS[hull],
    rhythm: 0,
    beat: null, // the stroke interval you've settled into
    steer: 0, // how hard the rudder is working, 0..1
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

// input: { strokes: ['left' | 'right', ...], rudder: -1..1, lean: -1..1,
//          draft: 0..1, rock: 0..1 } (draft and rock come from race.js's wash())
// Returns the events that happened, for sound and the HUD:
// 'stroke' | 'weak' | 'capsize' | 'remount'.
export function step(boat, dt, input) {
  const H = boat.hull;
  const events = [];
  boat.time += dt;

  if (boat.swim > 0) {
    boat.swim -= dt;
    boat.speed *= Math.exp(-3 * dt);
    if (boat.swim <= 0) {
      Object.assign(boat, { swim: 0, roll: 0, rollRate: 0, yawRate: 0, lastSide: null, rhythm: 0, beat: null });
      events.push('remount');
    }
    move(boat, dt);
    return events;
  }

  for (const side of input.strokes ?? []) events.push(stroke(boat, side));

  boat.stamina = Math.min(1, boat.stamina + H.recover * boat.endurance * dt);
  const drag = 1 - H.draft * (input.draft ?? 0);
  boat.speed = Math.max(0, boat.speed - drag * (H.drag * boat.speed ** 2 + H.linearDrag * boat.speed) * dt);

  // Lose the beat: by pausing, and by leaning on the rudder.
  if (boat.beat && boat.time - boat.lastStroke > boat.beat * 1.6) boat.rhythm = Math.max(0, boat.rhythm - 0.6 * dt);
  const bite = Math.min(boat.speed, H.rudderMaxSpeed);
  boat.steer = Math.abs(input.rudder ?? 0) * Math.min(1, bite / 2);
  boat.rhythm = Math.max(0, boat.rhythm - H.steerCost * boat.steer * dt);
  const target = (input.rudder ?? 0) * H.rudder * bite;
  boat.yawRate += (target - boat.yawRate) * Math.min(1, H.yawResponse * dt);
  boat.heading += boat.yawRate * dt;

  const braced = boat.time - boat.paddle.at < H.strokeTime;
  const stability = H.stabilityStill + H.stabilitySpeed * Math.min(boat.speed / H.stableSpeed, 1);
  const accel = H.tip * Math.sin(boat.roll)
    - stability * boat.roll
    - (H.rollDamp + (braced ? H.brace : 0)) * boat.rollRate
    + H.lean * (input.lean ?? 0)
    - H.turnRoll * boat.yawRate * boat.speed
    + H.chop * chop(boat.time)
    + H.washRock * (input.rock ?? 0) * slap(boat.time);
  boat.rollRate += accel * dt;
  boat.roll += boat.rollRate * dt;

  if (Math.abs(boat.roll) > H.capsize) {
    boat.swim = H.swimTime;
    boat.capsizes++;
    boat.speed *= 0.3 * (1 - H.fallCost);
    boat.stamina = Math.max(0, boat.stamina - H.fallCost * 0.3);
    events.push('capsize');
  }

  move(boat, dt);
  return events;
}

function stroke(boat, side) {
  const H = boat.hull;
  const gap = boat.time - boat.lastStroke;
  let quality = Math.min(1, gap / H.minInterval);
  const repeat = side === boat.lastSide;
  if (repeat) quality *= H.sameSide;
  quality *= 0.5 + 0.5 * Math.sqrt(boat.stamina);
  keepTime(boat, gap, repeat);

  const dir = side === 'left' ? 1 : -1; // a left stroke turns the bow right
  boat.speed += H.impulse * boat.power * quality * (H.rhythmBase + (1 - H.rhythmBase) * boat.rhythm);
  boat.yawRate += dir * H.strokeYaw * (repeat ? 2.5 : 1) * Math.max(quality, 0.3);
  boat.rollRate += -dir * H.strokeRoll * (repeat ? 2 : 1);
  boat.stamina = Math.max(0, boat.stamina - H.cost * Math.min(1, gap / H.minInterval));

  boat.lastSide = side;
  boat.lastStroke = boat.time;
  boat.paddle = { side, at: boat.time };
  boat.strokeTimes.push(boat.time);
  while (boat.strokeTimes[0] < boat.time - 6) boat.strokeTimes.shift();
  return quality < 0.6 ? 'weak' : 'stroke';
}

// Rhythm bookkeeping for one stroke, `gap` seconds after the previous one.
function keepTime(boat, gap, repeat) {
  const H = boat.hull;
  if (repeat) {
    boat.rhythm -= 0.2;
  } else if (!boat.beat || gap > boat.beat * 2) {
    if (boat.beat) boat.rhythm -= 0.25;
    boat.beat = Math.min(gap, 0.8); // starting up: this gap is the first guess at a beat
  } else {
    const off = Math.abs(gap - boat.beat) / boat.beat;
    boat.rhythm += off < H.rhythmSlop ? H.rhythmGain * (1 - off / H.rhythmSlop) * (1 - boat.steer) : -Math.min(0.3, off - H.rhythmSlop);
    boat.beat += (gap - boat.beat) * 0.25; // speeding up or easing off gradually keeps the rhythm
  }
  const cap = Math.min(1, 1 - (boat.beat - H.slowBeat) * 4);
  boat.rhythm = Math.max(0, Math.min(cap, boat.rhythm));
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

// The quicker slap of wash waves against the hull.
function slap(t) {
  return Math.sin(5.3 * t) * (0.6 + 0.4 * Math.sin(0.9 * t + 1)) + 0.4 * Math.sin(8.1 * t + 0.5);
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
  if (impact) boat.rhythm = Math.max(0, boat.rhythm - 0.4);
  boat.onBank = true;
  return impact;
}

export function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
