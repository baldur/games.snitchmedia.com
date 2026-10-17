import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoat, step } from '../kayak/sim.js';
import { raceRiver, pointAt, locate, headingAt } from '../kayak/course.js';
import { wrap } from '../kayak/sim.js';
import { createRace, stepRace, standings, started, wash, DIVISION_9 } from '../kayak/race.js';

const DT = 1 / 120;
const balance = (b) => Math.max(-1, Math.min(1, -(b.roll * 2 + b.rollRate * 0.6)));

const nearestGap = (race) => race.gaps.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));

// The player's input for one step: paddle up into the nearest gap on the start
// line at `interval` seconds a stroke, then sit still on it (or, with
// `through`, keep going over it).
function lineUp(race, { interval = 0.75, through = false } = {}) {
  const { boat, loc } = race.player;
  const bow = loc.s + 3.3;
  const strokes = [];
  if ((through || bow < race.start.line - 1.2) && boat.time - boat.lastStroke >= (bow > race.start.line - 4 ? 1.2 : interval)) {
    strokes.push(boat.lastSide === 'left' ? 'right' : 'left');
  }
  // Head for the gap's lane, then straighten up along the river.
  const along = headingAt(race.course, loc.s);
  const want = along + Math.max(-0.35, Math.min(0.35, (nearestGap(race) - loc.lateral) * 0.2));
  const err = wrap(want - boat.heading);
  return { strokes, rudder: Math.max(-1, Math.min(1, err * 3 - boat.yawRate * 0.5)), lean: balance(boat) };
}

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
      if (t >= next) { strokes.push(side); side = side === 'left' ? 'right' : 'left'; next += 0.62; }
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
  for (let i = 0; i < 30; i++) bumps.push(...stepRace(race, DT, { strokes: [], lean: balance(race.player.boat) }).events);
  assert.equal(bumps.filter((e) => e === 'bump').length, 1);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 0.47);
});

test('a pack of rivals races a full 6 km without capsizing, finishing in about 28 minutes', () => {
  const course = raceRiver();
  const race = createRace(course, { rivals: DIVISION_9, seed: 3 });
  // The player comes up to the line, then just sits there.
  for (let t = 0; !started(race); t += DT) {
    assert.ok(t < 60, 'the start never came');
    stepRace(race, DT, lineUp(race));
  }
  while (race.time < 600 && race.racers.some((r) => r.ai && r.finish === null)) {
    stepRace(race, DT, { strokes: [], lean: balance(race.player.boat) });
  }
  const rivals = standings(race).filter((r) => r.ai);
  assert.ok(rivals.every((r) => r.finish !== null), 'everyone finished');
  const minutes = rivals.map((r) => (r.finish * course.warp) / 60);
  assert.ok(minutes[0] > 25 && minutes[0] < 29, `winner ${minutes[0]}`);
  assert.ok(minutes.at(-1) < 35, `last ${minutes.at(-1)}`);
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

test('the horn comes after "Are you ready?", at an unpredictable moment', () => {
  const waits = new Set();
  for (const seed of [1, 2, 3]) {
    const race = createRace(raceRiver(), { rivals: DIVISION_9, seed });
    const calls = [];
    let t = 0;
    while (!started(race)) {
      assert.ok(t < 60, 'the start never came');
      for (const e of stepRace(race, DT, lineUp(race)).events) if (e !== 'stroke' && e !== 'weak') calls.push([e, t]);
      t += DT;
    }
    assert.deepEqual(calls.map(([e]) => e), ['line-up', 'ready', 'go']);
    waits.add((calls[2][1] - calls[1][1]).toFixed(1));
    assert.ok(race.time <= DT, 'the race clock starts at the horn');
  }
  assert.ok(waits.size > 1);
});

test('the rivals wait on the line with gaps, and you paddle up into one', () => {
  const race = createRace(raceRiver(), { rivals: DIVISION_9, seed: 5 });
  assert.equal(race.gaps.length, 2);
  const line = race.start.line;
  for (const r of race.racers.filter((r) => r.ai)) {
    assert.ok(Math.abs(r.loc.s + 3.3 - line) < 1.5, `${r.name} on the line`);
    for (const g of race.gaps) assert.ok(Math.abs(r.loc.lateral - g) > 1, `${r.name} clear of the gap`);
  }
  assert.ok(race.player.loc.s + 3.3 < line - 10, 'you start behind the line');
  for (let t = 0; !started(race); t += DT) {
    assert.ok(t < 60, 'the start never came');
    stepRace(race, DT, lineUp(race));
  }
  assert.ok(Math.abs(race.player.loc.lateral - nearestGap(race)) < 0.8, 'in the gap');
  assert.ok(Math.abs(race.player.loc.s + 3.3 - line) < 2.5, 'level with the others');
});

test('the starter waits for you, and calls you up again', () => {
  const race = createRace(raceRiver(), { rivals: DIVISION_9, seed: 6 });
  const calls = [];
  for (let t = 0; t < 30; t += DT) calls.push(...stepRace(race, DT, { strokes: [], lean: balance(race.player.boat) }).events);
  assert.deepEqual(calls, ['line-up', 'nudge', 'nudge']);
  assert.equal(started(race), false);
});

test('jumping the start holds it until the field comes up level, then starts again', () => {
  const race = createRace(raceRiver(), { rivals: DIVISION_9, seed: 4 });
  const calls = [];
  for (let t = 0; !started(race) && t < 90; t += DT) {
    // Charge at the line and over it, then sit still.
    const input = lineUp(race, { interval: 0.55, through: race.start.phase !== 'hold' && !race.start.holds });
    calls.push(...stepRace(race, DT, input).events.filter((e) => e !== 'stroke' && e !== 'weak'));
  }
  assert.deepEqual(calls.slice(calls.indexOf('hold')), ['hold', 'line-up', 'ready', 'go']);
  assert.ok(race.start.line > race.course.start, 'the line moved up to the jumper');
  for (const r of race.racers) assert.ok(Math.abs(r.loc.s + 3.3 - race.start.line) < 2.5, `${r.name} is level`);
});
