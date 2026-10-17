import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoat, step, strokeRate, bounceOffBank, BOAT } from '../kayak/sim.js';
import { practiceRiver, locate, pointAt, headingAt } from '../kayak/course.js';

const DT = 1 / 120;

// Paddles on a fixed beat for `seconds`; `lean` is a function of the boat.
function paddle(seconds, { interval = 0.35, sides = ['left', 'right'], lean = () => 0, rudder = 0, boat = createBoat() } = {}) {
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

test('alternating strokes build speed and drag settles it', () => {
  const { boat } = paddle(30, { lean: balance });
  assert.ok(boat.speed > 5 && boat.speed < 7, `cruising speed ${boat.speed}`);
  assert.equal(boat.capsizes, 0);
});

test('a faster rhythm is faster, but drains stamina', () => {
  const sprint = paddle(15, { interval: 0.22, lean: balance }).boat;
  const cruise = paddle(15, { interval: 0.4, lean: balance }).boat;
  assert.ok(sprint.speed > cruise.speed + 1);
  assert.ok(sprint.stamina < cruise.stamina - 0.2);
  assert.ok(paddle(60, { interval: 0.4, lean: balance }).boat.stamina > 0.95, 'an easy rhythm is sustainable');
});

test('hammering faster than the blade can catch is weak', () => {
  const { events } = paddle(3, { interval: 0.08, lean: balance });
  assert.ok(events.filter((e) => e === 'weak').length > events.filter((e) => e === 'stroke').length);
});

test('two strokes on the same side are weak and turn the boat', () => {
  const { boat, events } = paddle(4, { sides: ['left'], lean: balance });
  assert.ok(events.includes('weak'));
  assert.ok(boat.heading > 0.15, 'left strokes swing the bow right');
  const alternating = paddle(4, { lean: balance }).boat;
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
  assert.ok(firstCapsize(0.35) > firstCapsize(0) * 2);
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
  assert.equal(bounceOffBank(boat, loc, course.width / 2), true);
  assert.ok(Math.abs(boat.speed - 3) < 1e-9);
  assert.ok(Math.abs(locate(course, boat.x, boat.z).lateral) <= course.width / 2 - 1 + 1e-3);
  assert.ok(boat.heading < along, 'bow turned away from the bank');
  boat.x += Math.cos(along) * 0.5;
  boat.z += Math.sin(along) * 0.5;
  assert.equal(bounceOffBank(boat, locate(course, boat.x, boat.z), course.width / 2), false, 'scraping is not a new impact');
});
