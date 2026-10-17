// A pack race: the player plus computer paddlers on the same boat physics.
// Rivals pace themselves on stamina, hang on each other's wash, avoid and bump
// into each other and kick for the line. Pure, no DOM, so races run in tests.
import { createBoat, step, bounceOffBank, wrap, BOAT } from './sim.js';
import { locate, pointAt, headingAt } from './course.js';

const BOW = 3.3; // hull ends, metres from the boat's origin (see meshes.kayakMesh)
const STERN = 1.9;
const BEAM = 0.48; // closest two hulls can get
const LANE = 3.2; // spacing on the start line

// Division 9: club paddlers, a little uneven. Cadence is seconds per stroke;
// kick is how far out (real metres) they start sprinting for the line.
export const DIVISION_9 = [
  { name: 'Ingrid', power: 1.0, endurance: 1.0, cadence: 0.35, kick: 120 },
  { name: 'Tomás', power: 0.98, endurance: 1.1, cadence: 0.36, kick: 200 },
  { name: 'Aoife', power: 0.96, endurance: 1.05, cadence: 0.35, kick: 90 },
  { name: 'Kenji', power: 1.02, endurance: 0.85, cadence: 0.34, kick: 150 },
  { name: 'Maja', power: 0.95, endurance: 1.0, cadence: 0.37, kick: 110 },
  { name: 'Olu', power: 0.97, endurance: 0.95, cadence: 0.36, kick: 250 },
  { name: 'Bjarki', power: 0.93, endurance: 1.1, cadence: 0.38, kick: 80 },
];

export function createRace(course, { rivals = [], seed = 1 } = {}) {
  const rand = mulberry32(seed);
  const n = rivals.length + 1;
  const slot = Math.floor((n - 1) / 2); // the player starts just left of centre
  const order = [...rivals.keys()];
  order.splice(slot, 0, -1);
  const s = course.start - BOW - 2;
  const p = pointAt(course, s);
  const heading = headingAt(course, s);
  const racers = order.map((who, k) => {
    const lateral = (k - (n - 1) / 2) * LANE;
    const x = p.x - p.tz * lateral;
    const z = p.z + p.tx * lateral;
    const rival = rivals[who];
    const boat = createBoat({ x, z, heading, power: rival?.power, endurance: rival?.endurance });
    return {
      name: rival?.name ?? 'You',
      boat,
      loc: locate(course, x, z),
      finish: null,
      draft: 0, // how much of someone's wash they're riding, 0..1
      ai: rival ? {
        ...rival,
        interval: rival.cadence,
        next: rand() * 0.3,
        side: rand() < 0.5 ? -1 : 1, // which hip of a leader to hang on
        lane: lateral * 0.7,
      } : null,
    };
  });
  return { course, racers, player: racers[slot], time: 0, rand, contacts: new Set() };
}

// One fixed step. `input` drives the player. Before the gun (`started` false)
// nobody can paddle. Returns { events, splashes }: the player's events
// ('stroke', 'weak', 'capsize', 'remount', 'bank', 'bump', 'finish'), and how
// far away each rival stroke was, for the sound of the pack.
export function stepRace(race, dt, input, { started = true } = {}) {
  const { course, racers, player } = race;
  if (started) race.time += dt;
  const splashes = [];
  let events = [];

  const washes = racers.map((r) => totalWash(r, racers));
  racers.forEach((r, i) => {
    const intent = r.ai ? think(r, race, started) : { ...input };
    if (!started) intent.strokes = [];
    r.draft = washes[i].draft;
    const result = step(r.boat, dt, { ...intent, draft: r.draft, rock: washes[i].rock });
    r.loc = locate(course, r.boat.x, r.boat.z, r.loc.i);
    if (bounceOffBank(r.boat, r.loc, course.width / 2)) result.push('bank');
    if (r === player) events = result;
    else if (result.includes('stroke')) splashes.push(Math.hypot(r.boat.x - player.boat.x, r.boat.z - player.boat.z));
  });

  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      if (collide(race, i, j) && (racers[i] === player || racers[j] === player)) events.push('bump');
    }
  }

  for (const r of racers) {
    if (started && r.finish === null && r.loc.s >= course.finish) {
      r.finish = race.time;
      if (r === player) events.push('finish');
    }
  }
  return { events, splashes };
}

// Finished racers in order, then everyone else by how far along they are.
export function standings(race) {
  return [...race.racers].sort((a, b) => {
    if (a.finish !== null || b.finish !== null) return (a.finish ?? Infinity) - (b.finish ?? Infinity);
    return b.loc.s - a.loc.s;
  });
}

// How much `boat` gains from `other`'s wash. Right behind the stern, or beside
// its rear half (hanging on the hip), you push less water: that's `draft`, 0..1.
// Anywhere in the wash, and most of all on the hip, the boat rocks: `rock`.
export function wash(boat, other) {
  const f = [Math.sin(other.heading), -Math.cos(other.heading)];
  const dx = boat.x - other.x;
  const dz = boat.z - other.z;
  const along = dx * f[0] + dz * f[1];
  const lateral = Math.abs(dx * f[1] * -1 + dz * f[0]);
  const bow = along + BOW; // our bow, measured along the other boat
  const strength = Math.min(1, other.speed / 3);
  if (strength <= 0) return { draft: 0, rock: 0 };

  const stern = bell(bow, -STERN - 1, 1.6) * bell(lateral, 0, 0.7);
  const hip = bell(bow, -0.9, 1.7) * bell(lateral, 1.4, 0.65);
  // The diverging waves: a V spreading back from the bow at about 20 degrees.
  const back = -along + BOW;
  const arm = back > 0 && back < 30 ? Math.exp(-((lateral - back * 0.36) ** 2) / 1.5) * (1 - back / 30) : 0;
  return {
    draft: Math.max(stern, hip * 0.85) * strength,
    rock: Math.max(stern * 0.35, hip, arm * 0.7) * strength,
  };
}

function totalWash(r, racers) {
  let draft = 0;
  let rock = 0;
  for (const o of racers) {
    if (o === r || o.boat.swim > 0) continue;
    const dx = o.boat.x - r.boat.x;
    const dz = o.boat.z - r.boat.z;
    if (dx * dx + dz * dz > 40 * 40) continue;
    const w = wash(r.boat, o.boat);
    draft = Math.max(draft, w.draft);
    rock += w.rock;
  }
  return { draft, rock: Math.min(1, rock) };
}

// Equilibrium speed for a rhythm, at fairly fresh stamina: what a rival could
// hold on their own, so they know when a wash is too slow to sit on.
export function cruiseSpeed(interval, power = 1) {
  const push = (0.35 * power * 0.95) / interval;
  return (-0.02 + Math.sqrt(0.02 ** 2 + 4 * 0.067 * push)) / (2 * 0.067);
}

function think(r, race, started) {
  const { boat, ai, loc } = r;
  const { course, racers } = race;
  const lean = clamp(-(boat.roll * 2 + boat.rollRate * 0.6));
  if (!started) return { strokes: [], rudder: 0, lean };

  const togo = course.finish - loc.s;
  // The rhythm they could keep up forever: anything quicker spends stamina.
  const steady = BOAT.cost / (BOAT.recover * boat.endurance);
  const tired = boat.stamina < 0.35;
  let cadence = ai.cadence;
  if (r.finish !== null) cadence = race.time - r.finish < 8 ? 0.6 : 0; // paddle off, then drift
  else if (togo < ai.kick && boat.stamina > 0.12) cadence *= 0.78;
  else if (tired) cadence = Math.max(cadence, steady * (1.05 + (0.35 - boat.stamina)));

  // Find the wash to sit on: the nearest boat just ahead, if it isn't too slow.
  let leader = null;
  for (const o of racers) {
    if (o === r || o.boat.swim > 0) continue;
    const gap = o.loc.s - loc.s;
    if (gap > 1.5 && gap < 14 && Math.abs(o.loc.lateral - loc.lateral) < 6 && (!leader || gap < leader.loc.s - loc.s)) leader = o;
  }
  const kicking = togo < ai.kick && r.finish === null;
  const tooSlow = leader && leader.boat.speed < cruiseSpeed(ai.cadence, ai.power) - 0.25;
  let lateral = ai.lane;
  if (leader && !kicking && !tooSlow && r.finish === null && cadence) {
    // Hold station on its hip (or tucked in behind): speed up when dropping
    // back, ease off when riding up. The wash makes easing off cheap.
    const spot = ai.side ? 4.2 : 6.5;
    lateral = leader.loc.lateral + ai.side * 1.4;
    const target = leader.boat.speed + limit(((leader.loc.s - loc.s) - spot) * 0.25, -0.6, 0.6);
    ai.interval = limit(ai.interval - (target - boat.speed) * 0.003, tired ? cadence : cadence * 0.85, cadence * 1.5);
  } else {
    if (leader && (kicking || tooSlow)) lateral = leader.loc.lateral + ai.side * 3.2; // go round
    ai.interval += (cadence - ai.interval) * 0.05;
  }

  // Keep off anyone alongside (except the boat we're hanging on).
  for (const o of racers) {
    if (o === r || o === leader) continue;
    const gap = o.loc.s - loc.s;
    const apart = loc.lateral - o.loc.lateral;
    if (Math.abs(gap) < 7 && Math.abs(apart) < 1.6) lateral += Math.sign(apart || ai.side) * (1.6 - Math.abs(apart)) * 2;
  }
  lateral = limit(lateral, -(course.width / 2 - 3), course.width / 2 - 3);

  const strokes = [];
  if (cadence && race.time >= ai.next) {
    strokes.push(boat.lastSide === 'left' ? 'right' : 'left');
    ai.next = race.time + ai.interval * (1 + (race.rand() - 0.5) * 0.05);
  }

  const aim = pointAt(course, loc.s + 18);
  const ax = aim.x - aim.tz * lateral;
  const az = aim.z + aim.tx * lateral;
  const err = wrap(Math.atan2(ax - boat.x, -(az - boat.z)) - boat.heading);
  return { strokes, rudder: clamp(err * 3 - boat.yawRate * 0.5), lean };
}

// Hulls as line segments from stern to bow. Overlapping boats are pushed
// apart; the first moment of contact costs both some speed and a wobble.
function collide(race, i, j) {
  const a = race.racers[i].boat;
  const b = race.racers[j].boat;
  if ((a.x - b.x) ** 2 + (a.z - b.z) ** 2 > 7 * 7 || a.swim > 0 || b.swim > 0) return false;
  const key = `${i}-${j}`;
  const ha = hull(a);
  const hb = hull(b);
  let best = null;
  for (let k = 0; k <= 6; k++) {
    for (const [p, seg, sign] of [[lerp(ha, k / 6), hb, 1], [lerp(hb, k / 6), ha, -1]]) {
      const q = closest(seg, p);
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (!best || d < best.d) best = { d, n: [(p[0] - q[0]) * sign, (p[1] - q[1]) * sign] };
    }
  }
  if (best.d >= BEAM) {
    if (best.d > BEAM + 0.4) race.contacts.delete(key); // clear of each other: the next touch is a new hit
    return false;
  }
  const len = best.d || 1;
  const n = best.d ? [best.n[0] / len, best.n[1] / len] : [Math.cos(a.heading), Math.sin(a.heading)];
  const push = (BEAM - best.d) / 2;
  a.x += n[0] * push;
  a.z += n[1] * push;
  b.x -= n[0] * push;
  b.z -= n[1] * push;
  const fresh = !race.contacts.has(key);
  race.contacts.add(key);
  for (const [boat, dir] of [[a, 1], [b, -1]]) {
    // Which way this boat is being shoved: +1 to its right.
    const side = Math.sign((n[0] * Math.cos(boat.heading) + n[1] * Math.sin(boat.heading)) * dir);
    if (fresh) {
      boat.speed *= 0.9;
      boat.rollRate += side * 0.5; // shoved sideways, the hull rolls away from the hit
    } else {
      boat.speed *= 0.9995;
    }
    boat.heading += side * 0.004; // hulls grinding together glance apart
  }
  return fresh;
}

function hull(b) {
  const f = [Math.sin(b.heading), -Math.cos(b.heading)];
  return [[b.x - f[0] * STERN, b.z - f[1] * STERN], [b.x + f[0] * BOW, b.z + f[1] * BOW]];
}

function lerp([a, b], t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function closest([a, b], p) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = clamp01(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz));
  return [a[0] + dx * t, a[1] + dz * t];
}

function bell(x, centre, width) {
  const u = (x - centre) / width;
  return Math.max(0, 1 - u * u);
}

const limit = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clamp = (v) => limit(v, -1, 1);
const clamp01 = (v) => limit(v, 0, 1);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
