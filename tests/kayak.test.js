import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoat, step, strokeRate, bounceOffBank, BOAT, HULLS } from '../kayak/sim.js';
import { practiceRiver, raceRiver, locate, pointAt, headingAt, widthAt } from '../kayak/course.js';

const DT = 1 / 120;

// Paddles on a fixed beat for `seconds`; `lean` is a function of the boat.
function paddle(seconds, { interval = 0.7, sides = ['left', 'right'], lean = () => 0, rudder = 0, boat = createBoat() } = {}) {
  let next = 0;
  let n = 0;
  const events = [];
  for (let t = 0; t < seconds; t += DT) {
    const strokes = [];
    if (interval && t >= next) {
      strokes.push(sides[n++ % sides.length]);
      next += interval;
    }
    events.push(...step(boat, DT, { strokes, rudder, lean: lean(boat) }));
  }
  return { boat, events };
}

// A steady paddler who leans against the roll.
const balance = (b) => Math.max(-1, Math.min(1, -(b.roll * 2 + b.rollRate * 0.6)));

// Average speed over the last few seconds, in km/h: it surges with each stroke.
function kmh(interval, seconds) {
  const boat = createBoat();
  let next = 0;
  let n = 0;
  let sum = 0;
  let count = 0;
  for (let t = 0; t < seconds; t += DT) {
    const strokes = [];
    if (t >= next) {
      strokes.push(n++ % 2 ? 'right' : 'left');
      next += interval;
    }
    step(boat, DT, { strokes, lean: balance(boat) });
    if (t > seconds - 3) {
      sum += boat.speed;
      count++;
    }
  }
  return (sum / count) * 3.6;
}

test('speeds and stroke rates match real K1 marathon paddling', () => {
  const easy = paddle(25, { interval: 1, lean: balance }).boat;
  const racing = paddle(25, { lean: balance }).boat;
  assert.ok(Math.abs(strokeRate(easy) - 60) <= 3, `easy rate ${strokeRate(easy)}`);
  assert.ok(Math.abs(strokeRate(racing) - 86) <= 3, `racing rate ${strokeRate(racing)}`);
  const speeds = { easy: kmh(1, 25), racing: kmh(0.7, 25), sprint: kmh(0.56, 15) };
  assert.ok(speeds.easy > 9 && speeds.easy < 11, `easy ${speeds.easy}`);
  assert.ok(speeds.racing > 12.5 && speeds.racing < 14, `racing ${speeds.racing}`);
  assert.ok(speeds.sprint > speeds.racing + 0.8 && speeds.sprint < 16, `sprint ${speeds.sprint}`);
});

test('alternating strokes paddle upright', () => {
  const { boat } = paddle(30, { lean: balance });
  assert.equal(boat.capsizes, 0);
});

test('a faster rhythm is faster, but drains stamina', () => {
  const sprint = paddle(15, { interval: 0.52, lean: balance }).boat;
  const cruise = paddle(15, { interval: 0.75, lean: balance }).boat;
  assert.ok(kmh(0.52, 15) > kmh(0.75, 15) + 1.5);
  assert.ok(sprint.stamina < cruise.stamina - 0.2);
  assert.ok(paddle(60, { lean: balance }).boat.stamina > 0.95, 'a racing rhythm is sustainable');
});

test('hammering faster than the blade can move gets you nowhere', () => {
  const frantic = paddle(10, { interval: 0.2, lean: balance }).boat;
  assert.ok(strokeRate(frantic) <= 150, `rate ${strokeRate(frantic)}`);
  assert.ok(frantic.rhythm < 0.3, 'rushing breaks the rhythm');
  assert.ok(kmh(0.2, 10) < kmh(0.7, 10), 'and it is slower than a steady racing beat');
});

test('two strokes on the same side are weak and turn the boat', () => {
  const { boat, events } = paddle(6, { sides: ['left'], lean: balance });
  assert.ok(events.includes('weak'));
  assert.ok(boat.heading > 0.15, 'left strokes swing the bow right');
  const alternating = paddle(6, { lean: balance }).boat;
  assert.ok(Math.abs(alternating.heading) < 0.1, 'alternating keeps a straight line');
});

test('sitting still you tip over unless you balance', () => {
  const idle = paddle(20, { interval: 0 });
  assert.ok(idle.events.includes('capsize'));
  const balanced = paddle(20, { interval: 0, lean: balance });
  assert.equal(balanced.boat.capsizes, 0);
});

test('balance is easier at speed: hands-off you last much longer moving', () => {
  const firstCapsize = (interval) => {
    const boat = createBoat();
    let next = 0;
    let side = 'left';
    for (let t = 0; t < 120; t += DT) {
      const strokes = [];
      if (interval && t >= next) {
        strokes.push(side);
        side = side === 'left' ? 'right' : 'left';
        next += interval;
      }
      if (step(boat, DT, { strokes }).includes('capsize')) return t;
    }
    return Infinity;
  };
  assert.ok(firstCapsize(0.7) > firstCapsize(0) * 2);
});

test('a capsize stops you, then you climb back in', () => {
  const boat = createBoat();
  boat.speed = 5;
  boat.roll = BOAT.capsize + 0.01;
  assert.deepEqual(step(boat, DT, { strokes: [] }), ['capsize']);
  const during = step(boat, DT, { strokes: ['left'] });
  assert.equal(during.length, 0, 'no paddling while swimming');
  const { events } = paddle(BOAT.swimTime, { interval: 0, boat, lean: balance });
  assert.ok(events.includes('remount'));
  assert.ok(boat.speed < 1);
  assert.ok(Math.abs(boat.roll) < 0.01);
});

test('the rudder only bites with speed', () => {
  const still = paddle(2, { interval: 0, rudder: 1, lean: balance }).boat;
  assert.ok(Math.abs(still.heading) < 0.01);
  const moving = createBoat();
  moving.speed = 5;
  paddle(2, { interval: 0, rudder: 1, lean: balance, boat: moving });
  assert.ok(moving.heading > 0.5);
});

test('a steady beat builds rhythm, and rhythm is speed', () => {
  const steady = paddle(15, { lean: balance }).boat;
  assert.ok(steady.rhythm > 0.95, `rhythm ${steady.rhythm}`);
  // The same average rhythm, played unevenly.
  const ragged = createBoat();
  let t = 0;
  for (let n = 0; t < 15; n++) {
    const gap = n % 2 ? 0.55 : 0.85;
    for (let s = 0; s < gap; s += DT, t += DT) {
      step(ragged, DT, { strokes: s === 0 ? [n % 2 ? 'left' : 'right'] : [], lean: balance(ragged) });
    }
  }
  assert.ok(ragged.rhythm < 0.3, `ragged rhythm ${ragged.rhythm}`);
  assert.ok(steady.speed > ragged.speed + 0.4);
});

test('riding a wash costs less stamina', () => {
  const sprint = (draft) => {
    const boat = createBoat();
    let next = 0;
    let n = 0;
    for (let t = 0; t < 20; t += DT) {
      const strokes = [];
      if (t >= next) {
        strokes.push(n++ % 2 ? 'right' : 'left');
        next += 0.55;
      }
      step(boat, DT, { strokes, lean: balance(boat), draft });
    }
    return boat.stamina;
  };
  const alone = 1 - sprint(0);
  const sheltered = 1 - sprint(1);
  assert.ok(sheltered < alone * 0.5, `spent ${sheltered} on the wash vs ${alone} alone`);
});

test('steering hard breaks your rhythm', () => {
  const straight = paddle(10, { lean: balance }).boat;
  const steering = paddle(10, { lean: balance, rudder: 1 }).boat;
  assert.ok(steering.rhythm < straight.rhythm - 0.3, `${steering.rhythm} vs ${straight.rhythm}`);
});

test('a narrow racing hull is faster, a wide one steadier', () => {
  const speed = (hull) => paddle(20, { lean: balance, boat: createBoat({ hull }) }).boat.speed;
  assert.ok(speed('racing') > speed('club') + 0.1);
  assert.ok(speed('club') > speed('stable') + 0.1);
  // Hands off the balance, at a gentle paddle: how long until you fall in?
  const upright = (hull) => {
    const boat = createBoat({ hull });
    const { events } = paddle(60, { interval: 0.9, boat });
    return events.filter((e) => e === 'capsize').length;
  };
  assert.ok(upright('racing') > upright('stable'));
  assert.ok(HULLS.racing.swimTime > HULLS.stable.swimTime, 'and a swim costs more');
});

test('stroke rate counts recent strokes per minute', () => {
  const { boat } = paddle(8, { interval: 0.5, lean: balance });
  assert.ok(Math.abs(strokeRate(boat) - 120) <= 6, `rate ${strokeRate(boat)}`);
});

test('the practice course is about 1 km between start and finish', () => {
  const course = practiceRiver();
  assert.equal(course.finish - course.start, 1000);
  assert.ok(course.length > course.finish);
});

test('locating a point finds its distance along and offset across the river', () => {
  const course = practiceRiver();
  for (const s of [100, 400, 777]) {
    const p = pointAt(course, s);
    const h = headingAt(course, s);
    const right = [Math.cos(h), Math.sin(h)];
    const loc = locate(course, p.x + right[0] * 5, p.z + right[1] * 5);
    assert.ok(Math.abs(loc.s - s) < 1, `s ${loc.s} vs ${s}`);
    assert.ok(Math.abs(loc.lateral - 5) < 0.2, `lateral ${loc.lateral}`);
  }
});

test('hitting the bank costs speed once, then you slide along it', () => {
  const course = practiceRiver();
  const boat = createBoat();
  const p = pointAt(course, 300);
  const along = headingAt(course, 300);
  Object.assign(boat, { x: p.x + Math.cos(along) * 20, z: p.z + Math.sin(along) * 20, heading: along + 0.4, speed: 5 });
  const loc = locate(course, boat.x, boat.z);
  const { half } = widthAt(course, 300);
  assert.equal(bounceOffBank(boat, loc, half), true);
  assert.ok(Math.abs(boat.speed - 3) < 1e-9);
  assert.ok(Math.abs(locate(course, boat.x, boat.z).lateral) <= half - 1 + 1e-3);
  assert.ok(boat.heading < along, 'bow turned away from the bank');
  boat.x += Math.cos(along) * 0.5;
  boat.z += Math.sin(along) * 0.5;
  assert.equal(bounceOffBank(boat, locate(course, boat.x, boat.z), half), false, 'scraping is not a new impact');
});

test('the race river is a narrow English river, with a wide reach for the start', () => {
  const course = raceRiver();
  assert.ok(widthAt(course, course.start).half * 2 >= 24, 'room for thirteen places on the line');
  for (let s = course.start + 200; s < course.finish; s += 10) {
    const { half } = widthAt(course, s);
    assert.ok(half * 2 >= 10.5 && half * 2 <= 17, `width ${half * 2} at ${s}`);
  }
});

test('a moored narrowboat is bank: you bounce off it', () => {
  const course = practiceRiver();
  const [m] = course.moorings;
  const w = widthAt(course, m.s);
  assert.ok(w.right < w.half - 2 && w.left === w.half);
  const boat = createBoat();
  const p = pointAt(course, m.s);
  Object.assign(boat, { x: p.x - p.tz * (w.half - 1.5), z: p.z + p.tx * (w.half - 1.5), heading: headingAt(course, m.s), speed: 3 });
  assert.equal(bounceOffBank(boat, locate(course, boat.x, boat.z), w.left, w.right), true);
});
