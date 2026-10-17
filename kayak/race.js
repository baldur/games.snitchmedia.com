// A pack race: the player plus computer paddlers on the same boat physics.
// The rivals wait on the start line with a couple of gaps; you paddle up from
// behind into one. A starter then sounds the horn without warning; rivals then
// sprint off the line, pace themselves on stamina, hang on each other's wash,
// avoid and bump into each other and kick for the finish. Pure, no DOM, so
// whole races run in tests.
import { createBoat, step, bounceOffBank, wrap, steadyBeat, BOAT } from './sim.js';
import { locate, pointAt, headingAt, widthAt, roomAhead } from './course.js';

const BOW = 3.3; // hull ends, metres from the boat's origin (see meshes.kayakMesh)
const STERN = 1.9;
const BEAM = 0.48; // closest two hulls can get
const LANE = 1.75; // spacing on the start line: blades all but touching
const GAPS = 2; // open places the rivals leave on the line
const BEHIND = 14; // how far back from the line you start, metres

// Division 9, the entry division: a start line of twelve club paddlers in
// all sorts of boats. Pace is their usual beat as a share of the beat they
// could hold for ever (below 1 is quicker, and tires them); kick is how far out
// (real metres) they start sprinting for the line.
export const DIVISION_9 = [
  { name: 'Ingrid', hull: 'club', power: 1.0, endurance: 1.0, pace: 1.0, kick: 120 },
  { name: 'Tomás', hull: 'club', power: 0.98, endurance: 1.1, pace: 1.0, kick: 200 },
  { name: 'Aoife', hull: 'racing', power: 0.95, endurance: 1.0, pace: 0.99, kick: 90 },
  { name: 'Kenji', hull: 'club', power: 1.02, endurance: 0.85, pace: 0.98, kick: 150 },
  { name: 'Maja', hull: 'stable', power: 0.98, endurance: 1.05, pace: 1.0, kick: 110 },
  { name: 'Olu', hull: 'club', power: 0.97, endurance: 0.95, pace: 1.01, kick: 250 },
  { name: 'Bjarki', hull: 'stable', power: 0.96, endurance: 1.1, pace: 1.02, kick: 80 },
  { name: 'Priya', hull: 'club', power: 0.96, endurance: 1.0, pace: 1.01, kick: 140 },
  { name: 'Lukas', hull: 'stable', power: 1.0, endurance: 0.9, pace: 0.99, kick: 180 },
  { name: 'Freya', hull: 'club', power: 0.94, endurance: 1.05, pace: 1.02, kick: 100 },
  { name: 'Mateo', hull: 'racing', power: 0.96, endurance: 0.9, pace: 1.0, kick: 160 },
];

// The starter: boats come up to the line; once the line is steady, "Are you
// ready?"; then the horn after a pause you can't predict. Cross the line early
// and the start is held while everyone else comes up level with you, then it
// begins again.
const LINE_UP = 3; // seconds at least before the ready call
const NUDGE = 12; // seconds the starter waits for you before calling you up again
const READY = [1.2, 4.5]; // shortest and longest wait for the horn after it
const JUMP = 1; // metres over the line that count as jumping the start
const ON_LINE = 2.5; // a bow this close behind the line is on it

// you: the player's { power, endurance, hull }.
export function createRace(course, { rivals = [], seed = 1, you = {} } = {}) {
  const rand = mulberry32(seed);
  const solo = !rivals.length;
  // The rivals take the line, leaving two gaps (never at the very edge).
  const slots = [...Array(rivals.length + GAPS).keys()];
  const inner = slots.length > GAPS + 2 ? 1 : 0;
  const open = new Set();
  while (open.size < GAPS) open.add(inner + Math.floor(rand() * (slots.length - 2 * inner)));
  const taken = slots.filter((k) => !open.has(k));
  const place = (s, lateral, heading) => {
    const p = pointAt(course, s);
    return { x: p.x - p.tz * lateral, z: p.z + p.tx * lateral, heading };
  };
  const onLine = course.start - BOW - 0.3;
  const heading = headingAt(course, onLine);
  const racer = (name, boat, ai) => ({ name, boat, loc: locate(course, boat.x, boat.z), finish: null, draft: 0, ai });
  const player = racer('You', createBoat({ ...place(solo ? onLine : onLine - BEHIND, 0, headingAt(course, onLine - BEHIND)), ...you }), null);
  const racers = rivals.map((rival, k) => {
    const lateral = (taken[k] - (slots.length - 1) / 2) * LANE;
    const boat = createBoat({ ...place(onLine - rand() * 0.6, lateral, heading), ...rival });
    const cadence = steadyBeat(boat) * rival.pace; // seconds a stroke: about 97 a minute
    return racer(rival.name, boat, {
      ...rival,
      cadence,
      interval: cadence,
      next: 0.15 + rand() * 0.35, // reaction to the horn
      creep: 0,
      side: rand() < 0.5 ? -1 : 1, // which hip of a leader to hang on
      lane: lateral * 0.5,
      grid: lateral, // where they sat on the start line
    });
  });
  racers.unshift(player);
  return {
    course, racers, player, time: 0, rand, contacts: new Set(),
    gaps: [...open].map((k) => (k - (slots.length - 1) / 2) * LANE),
    start: { phase: 'line-up', timer: LINE_UP, wait: NUDGE, line: course.start, holds: 0, calls: ['line-up'] },
  };
}

export const started = (race) => race.start.phase === 'go';

// Bow position along the course.
const bowAt = (r) => r.loc.s + BOW;

// Runs the starter. Calls ('line-up', 'nudge', 'ready', 'go', 'hold') go to race.start.calls.
function starter(race, dt) {
  const st = race.start;
  if (st.phase === 'go') return;
  st.timer -= dt;
  const bow = bowAt(race.player);
  if (st.phase !== 'hold' && bow > st.line + JUMP) {
    // Jumped the start: hold everything, and move the line up to the jumper.
    Object.assign(st, { phase: 'hold', timer: 3, holds: st.holds + 1 });
    st.calls.push('hold');
  }
  const steady = race.player.boat.speed < 0.6;
  if (st.phase === 'hold') {
    st.line = Math.max(st.line, bow);
    const level = race.racers.every((r) => bowAt(r) > st.line - 1.5);
    if (st.timer <= 0 && level && steady) {
      Object.assign(st, { phase: 'line-up', timer: LINE_UP, wait: NUDGE });
      st.calls.push('line-up');
    }
  } else if (st.phase === 'line-up') {
    // The starter won't go until you're up on the line and sitting still.
    const ready = bow > st.line - ON_LINE && steady && race.racers.every((r) => bowAt(r) > st.line - ON_LINE);
    st.wait -= dt;
    if (st.timer <= 0 && ready) {
      Object.assign(st, { phase: 'ready', timer: READY[0] + race.rand() * (READY[1] - READY[0]) });
      st.calls.push('ready');
    } else if (st.wait <= 0) {
      st.wait = NUDGE;
      st.calls.push('nudge');
    }
  } else if (st.timer <= 0 && st.phase === 'ready') {
    st.phase = 'go';
    st.calls.push('go');
  }
}

// One fixed step. `input` drives the player. Returns { events, splashes }:
// the player's events ('stroke', 'weak', 'capsize', 'remount', 'bank', 'bump',
// 'finish') and the starter's calls ('line-up', 'nudge', 'ready', 'go', 'hold'), and
// how far away each rival stroke was, for the sound of the pack.
export function stepRace(race, dt, input) {
  const { course, racers, player } = race;
  starter(race, dt);
  const going = started(race);
  if (going) race.time += dt;
  const splashes = [];
  let events = [];

  const washes = racers.map((r) => totalWash(r, racers));
  racers.forEach((r, i) => {
    const intent = r.ai ? think(r, race) : { ...input };
    r.draft = washes[i].draft;
    const result = step(r.boat, dt, { ...intent, draft: r.draft, rock: washes[i].rock });
    // Holding water on the line (but you can paddle up to it from behind).
    if (!going && bowAt(r) > race.start.line - 4) r.boat.speed *= Math.exp(-0.6 * dt);
    r.loc = locate(course, r.boat.x, r.boat.z, r.loc.i);
    const w = widthAt(course, r.loc.s);
    if (bounceOffBank(r.boat, r.loc, w.left, w.right)) result.push('bank');
    if (r === player) events = result;
    else if (result.includes('stroke')) splashes.push(Math.hypot(r.boat.x - player.boat.x, r.boat.z - player.boat.z));
  });

  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      if (collide(race, i, j) && (racers[i] === player || racers[j] === player)) events.push('bump');
    }
  }

  for (const r of racers) {
    if (going && r.finish === null && r.loc.s >= course.finish) {
      r.finish = race.time;
      if (r === player) events.push('finish');
    }
  }
  events.push(...race.start.calls.splice(0));
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
  const push = (BOAT.impulse * power * 0.95) / interval;
  return (-0.02 + Math.sqrt(0.02 ** 2 + 4 * 0.067 * push)) / (2 * 0.067);
}

function think(r, race) {
  const { boat, ai, loc } = r;
  const { course, racers } = race;
  const lean = clamp(-(boat.roll * 2 + boat.rollRate * 0.6));
  if (!started(race)) {
    // On the line: hold position, or creep up level when the line moves.
    const behind = race.start.line - 0.4 - bowAt(r);
    const strokes = [];
    if (behind > 0 && boat.time >= ai.creep) {
      strokes.push(boat.lastSide === 'left' ? 'right' : 'left');
      ai.creep = boat.time + (behind > 1.5 ? 0.7 : 1.2);
    }
    return { strokes, rudder: steer(r, course, ai.grid, 10), lean };
  }

  const togo = course.finish - loc.s;
  // The rhythm they could keep up forever: anything quicker spends stamina.
  const steady = steadyBeat(boat);
  const tired = boat.stamina < 0.35;
  let cadence = ai.cadence;
  if (r.finish !== null) cadence = race.time - r.finish < 8 ? 0.9 : 0; // paddle off, then drift
  else if (togo < ai.kick && boat.stamina > 0.12) cadence *= 0.85;
  else if (loc.s < race.start.line + 100) cadence *= 0.93; // sprint off the line for a place on a wash
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
    ai.interval = limit(ai.interval - (target - boat.speed) * 0.003, tired ? cadence : cadence * 0.94, cadence * 1.4);
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
  // Stay off the banks, and get out from behind moored boats in good time.
  const room = roomAhead(course, loc.s, 30);
  lateral = limit(lateral, -(room.left - 2.2), room.right - 2.2);

  const strokes = [];
  if (cadence && race.time >= ai.next) {
    strokes.push(boat.lastSide === 'left' ? 'right' : 'left');
    ai.next = race.time + ai.interval * (1 + (race.rand() - 0.5) * 0.05);
  }

  return { strokes, rudder: steer(r, course, lateral, 18), lean };
}

// Rudder towards a point `ahead` metres down the river, `lateral` off the middle.
function steer({ boat, loc }, course, lateral, ahead) {
  const aim = pointAt(course, loc.s + ahead);
  const ax = aim.x - aim.tz * lateral;
  const az = aim.z + aim.tx * lateral;
  const err = wrap(Math.atan2(ax - boat.x, -(az - boat.z)) - boat.heading);
  return clamp(err * 3 - boat.yawRate * 0.5);
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
      boat.rhythm = Math.max(0, boat.rhythm - 0.3);
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
