import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoat, step } from '../kayak/sim.js';
import { raceRiver, pointAt, locate } from '../kayak/course.js';
import { createRace, stepRace, standings, wash, DIVISION_9 } from '../kayak/race.js';

const DT = 1 / 120;
const balance = (b) => Math.max(-1, Math.min(1, -(b.roll * 2 + b.rollRate * 0.6)));

// A boat at (0, 0) heading up -z at racing speed, and a point relative to it.
const leader = () => Object.assign(createBoat(), { speed: 3.6 });
const at = (right, ahead) => createBoat({ x: right, z: -ahead });

test('a division race shows 6 km and squeezes it into a quarter of the time', () => {
  const course = raceRiver();
  assert.equal((course.finish - course.start) * course.warp, 6000);
  assert.equal(course.warp, 4);
});

test('the wash helps right behind the stern and on the hip, nowhere else', () => {
  const l = leader();
  const stern = wash(at(0, -6.3), l);
  const hip = wash(at(1.4, -4.2), l);
  const wide = wash(at(6, -4), l);
  const ahead = wash(at(0, 8), l);
  assert.ok(stern.draft > 0.8, `stern ${stern.draft}`);
  assert.ok(hip.draft > 0.7, `hip ${hip.draft}`);
  assert.ok(hip.rock > stern.rock, 'the hip rocks more than tucking in behind');
  assert.equal(wide.draft, 0);
  assert.equal(ahead.draft, 0);
  assert.equal(wash(at(0, -6.3), createBoat()).draft, 0, 'a boat sitting still makes no wash');
});

test('riding a wash is faster for the same effort', () => {
  const paddle = (draft) => {
    const boat = createBoat();
    let next = 0;
    let side = 'left';
    for (let t = 0; t < 30; t += DT) {
      const strokes = [];
      if (t >= next) { strokes.push(side); side = side === 'left' ? 'right' : 'left'; next += 0.36; }
      step(boat, DT, { strokes, lean: balance(boat), draft });
    }
    return boat.speed;
  };
  assert.ok(paddle(1) > paddle(0) * 1.1);
});

test('touching hulls are pushed apart and count as one bump', () => {
  const course = raceRiver();
  const race = createRace(course, { rivals: DIVISION_9.slice(0, 1) });
  const [a, b] = race.racers.map((r) => r.boat);
  b.x = a.x + Math.cos(a.heading) * 0.3; // side by side, overlapping
  b.z = a.z + Math.sin(a.heading) * 0.3;
  b.heading = a.heading;
  const bumps = [];
  for (let i = 0; i < 30; i++) bumps.push(...stepRace(race, DT, { strokes: [], lean: balance(race.player.boat) }, { started: false }).events);
  assert.equal(bumps.filter((e) => e === 'bump').length, 1);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 0.47);
});

test('a pack of rivals races a full 6 km without capsizing, finishing in about 28 minutes', () => {
  const course = raceRiver();
  const race = createRace(course, { rivals: DIVISION_9, seed: 3 });
  for (let t = 0; t < 3; t += DT) stepRace(race, DT, { strokes: [], lean: balance(race.player.boat) }, { started: false });
  // The player sits still behind the line, out of the way.
  while (race.time < 600 && race.racers.some((r) => r.ai && r.finish === null)) {
    stepRace(race, DT, { strokes: [], lean: balance(race.player.boat) });
  }
  const rivals = standings(race).filter((r) => r.ai);
  assert.ok(rivals.every((r) => r.finish !== null), 'everyone finished');
  const minutes = rivals.map((r) => (r.finish * course.warp) / 60);
  assert.ok(minutes[0] > 25 && minutes[0] < 29, `winner ${minutes[0]}`);
  assert.ok(minutes.at(-1) < 34, `last ${minutes.at(-1)}`);
  assert.ok(rivals.every((r) => r.boat.capsizes === 0));
  assert.equal(standings(race).at(-1), race.player, 'a player who never paddles comes last');
});

test('standings put finishers first, then whoever is furthest along', () => {
  const course = raceRiver();
  const race = createRace(course, { rivals: DIVISION_9.slice(0, 2) });
  const [a, b, c] = race.racers;
  const place = (r, s) => {
    const p = pointAt(course, s);
    Object.assign(r.boat, { x: p.x, z: p.z });
    r.loc = locate(course, p.x, p.z);
  };
  place(a, 500);
  place(b, 900);
  place(c, 300);
  c.finish = 100;
  assert.deepEqual(standings(race), [c, b, a]);
});
