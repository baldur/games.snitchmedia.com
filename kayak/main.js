import { BOAT, strokeRate } from './sim.js';
import { practiceRiver, raceRiver } from './course.js';
import { createRace, stepRace, standings, DIVISION_9 } from './race.js';
import { buildWorld } from './world.js';
import { kayakMesh, paddleMesh, paddlerMesh, limbMesh, SEAT, SHOULDER } from './meshes.js';
import { createRenderer } from './render.js';
import { perspective, view, basis, multiply, translation, rotationY, rotationZ } from './mat4.js';
import { Controls, BUTTON } from './controls.js';
import { tone, noise, isMuted, setMuted } from '../shared/audio.js';
import { openDialog, gamepadDialogs, soundToggle } from '../shared/dialogs.js';

const STEP = 1 / 120;
const EYE_HEIGHT = 0.78;
const FOV_Y = (62 * Math.PI) / 180;
const MIN_FOV_X = (75 * Math.PI) / 180;
const COUNTDOWN = 3;

const MODES = {
  race: { course: raceRiver(6), rivals: DIVISION_9, bestKey: 'snitchmedia:kayak:div9' },
  practice: { course: practiceRiver(), rivals: [], bestKey: 'snitchmedia:kayak:practice' },
};

// Boat and club colours; the player is always the first.
const LIVERIES = [
  { deck: [0.9, 0.2, 0.16], hull: [0.95, 0.93, 0.88], stripe: [0.97, 0.97, 0.95] },
  { deck: [0.12, 0.35, 0.8], hull: [0.95, 0.95, 0.95], stripe: [0.95, 0.85, 0.2], top: [0.95, 0.8, 0.15], skin: [0.85, 0.65, 0.5], cap: [0.1, 0.25, 0.7] },
  { deck: [0.95, 0.95, 0.92], hull: [0.92, 0.92, 0.9], stripe: [0.1, 0.6, 0.4], top: [0.1, 0.55, 0.35], skin: [0.6, 0.42, 0.3], cap: [0.95, 0.95, 0.95] },
  { deck: [0.98, 0.75, 0.1], hull: [0.95, 0.93, 0.88], stripe: [0.2, 0.2, 0.2], top: [0.15, 0.15, 0.18], skin: [0.92, 0.75, 0.62], cap: [0.98, 0.75, 0.1] },
  { deck: [0.55, 0.15, 0.6], hull: [0.95, 0.95, 0.95], stripe: [0.95, 0.95, 0.95], top: [0.6, 0.2, 0.65], skin: [0.75, 0.55, 0.4], cap: [0.95, 0.95, 0.95] },
  { deck: [0.1, 0.1, 0.12], hull: [0.9, 0.9, 0.88], stripe: [0.9, 0.2, 0.2], top: [0.85, 0.15, 0.15], skin: [0.42, 0.28, 0.2], cap: [0.1, 0.1, 0.1] },
  { deck: [0.2, 0.7, 0.85], hull: [0.95, 0.95, 0.95], stripe: [0.95, 0.95, 0.95], top: [0.95, 0.95, 0.95], skin: [0.9, 0.72, 0.58], cap: [0.2, 0.7, 0.85] },
  { deck: [0.95, 0.45, 0.1], hull: [0.95, 0.93, 0.88], stripe: [0.1, 0.1, 0.1], top: [0.3, 0.3, 0.32], skin: [0.88, 0.68, 0.55], cap: [0.95, 0.45, 0.1] },
];

const canvas = document.getElementById('view');
const hud = document.getElementById('hud');
const menu = document.getElementById('menu');
const paused = document.getElementById('paused');
const finished = document.getElementById('finished');
const flash = document.getElementById('flash');
const els = Object.fromEntries(['clock', 'togo', 'pos', 'wash', 'speed', 'rate', 'stamina', 'needle', 'best', 'result', 'details', 'standings', 'nogpu']
  .map((id) => [id, document.getElementById(id)]));

const controls = new Controls(canvas);

let state = 'menu'; // 'menu' | 'countdown' | 'racing' | 'paused' | 'finished'
let resumeTo = 'racing';
let mode = MODES.race;
let race;
let liveries; // racer -> index into LIVERIES and meshes.racers
let countdown = 0;
let renderer = null;
let meshes = null;

// --- race flow ---------------------------------------------------------------

function reset() {
  race = createRace(mode.course, { rivals: mode.rivals, seed: (Math.random() * 2 ** 31) | 0 });
  let next = 1;
  liveries = new Map(race.racers.map((r) => [r, r === race.player ? 0 : next++]));
  countdown = COUNTDOWN;
  controls.clear();
}

function start() {
  reset();
  state = 'countdown';
  hud.hidden = false;
  hud.classList.toggle('solo', race.racers.length === 1);
}

function pause() {
  if (state !== 'racing' && state !== 'countdown') return;
  resumeTo = state;
  state = 'paused';
  openDialog(paused);
}

// Race time as shown: stretched by the course's warp (see course.js).
const shown = (t) => t * mode.course.warp;

function loadBest() {
  try { return JSON.parse(localStorage.getItem(mode.bestKey)) ?? null; } catch { return null; }
}

function finish() {
  state = 'finished';
  const table = standings(race);
  const place = table.indexOf(race.player) + 1;
  const time = shown(race.player.finish);
  const solo = race.racers.length === 1;
  let best = loadBest();
  if (typeof best === 'number') best = { time: best }; // stage 1 stored a bare time
  const record = !best || time < best.time;
  if (record || (!solo && place < (best.place ?? Infinity))) {
    best = { time: Math.min(time, best?.time ?? Infinity), place: Math.min(place, best?.place ?? Infinity) };
    try { localStorage.setItem(mode.bestKey, JSON.stringify(best)); } catch {}
  }

  const caps = race.player.boat.capsizes;
  const capsText = caps ? `${caps} capsize${caps > 1 ? 's' : ''}` : 'no capsizes';
  if (solo) {
    els.result.textContent = record ? `New best: ${formatTime(time)}` : `Finished in ${formatTime(time)}`;
    els.details.textContent = `Best ${formatTime(best.time)}, ${capsText}.`;
  } else {
    els.result.textContent = place === 1 ? 'You won!' : `You came ${ordinal(place)}`;
    els.details.textContent = `${formatTime(time)}, ${capsText}. Best ${ordinal(best.place)}, ${formatTime(best.time)}.`;
  }
  // Rivals still out on the course get the time they're on track for.
  els.standings.replaceChildren(...table.map((r) => {
    const li = document.createElement('li');
    const t = r.finish ?? race.time + (mode.course.finish - r.loc.s) / Math.max(r.boat.speed, 2);
    li.textContent = `${r.name} ${formatTime(shown(t), 0)}`;
    if (r === race.player) li.className = 'you';
    return li;
  }));
  els.standings.hidden = solo;
  tone({ freq: 523, to: 1046, duration: 0.5, type: 'triangle', gain: 0.15 });
  setTimeout(() => { if (state === 'finished') openDialog(finished); }, 1500);
}

function toMenu() {
  state = 'menu';
  hud.hidden = true;
  reset();
  const lines = Object.entries(MODES).map(([name, m]) => {
    let b;
    try { b = JSON.parse(localStorage.getItem(m.bestKey)); } catch {}
    if (b == null) return '';
    if (typeof b === 'number') b = { time: b };
    return name === 'race' ? `Division 9 best: ${ordinal(b.place)}, ${formatTime(b.time)}` : `Practice best: ${formatTime(b.time)}`;
  });
  els.best.textContent = lines.filter(Boolean).join(' · ');
  openDialog(menu);
}

menu.addEventListener('cancel', (e) => e.preventDefault());
menu.addEventListener('close', () => {
  if (!MODES[menu.returnValue]) return;
  mode = MODES[menu.returnValue];
  if (renderer) useWorld();
  start();
});
paused.addEventListener('close', () => {
  if (paused.returnValue === 'menu') toMenu();
  else if (paused.returnValue === 'restart') start();
  else state = resumeTo;
});
finished.addEventListener('close', () => {
  if (finished.returnValue === 'again') start();
  else toMenu();
});

document.getElementById('pause').addEventListener('click', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
soundToggle(document.getElementById('sound'), { isMuted, setMuted });
addEventListener('keydown', (e) => {
  if ((e.code === 'KeyP' || e.code === 'Escape') && (state === 'racing' || state === 'countdown')) {
    e.preventDefault();
    pause();
  }
});

function handleGamepad(pressed) {
  if (pressed.has(BUTTON.START) && paused.open) {
    paused.close('resume');
    return;
  }
  if (!gamepadDialogs([menu, paused, finished], pressed) && pressed.has(BUTTON.START)) pause();
}

// --- feedback ----------------------------------------------------------------

let flashTimer = 0;
function show(text, { small = false, hold = 0.8 } = {}) {
  flash.textContent = text;
  flash.classList.toggle('small', small);
  flash.classList.add('show');
  flashTimer = hold;
}

const sounds = {
  stroke: () => {
    noise({ freq: 700 + Math.random() * 300, to: 300, q: 0.8, duration: 0.25, gain: 0.1 });
    tone({ freq: 85, to: 60, duration: 0.06, type: 'sine', gain: 0.06 });
  },
  weak: () => noise({ freq: 1800, to: 900, q: 1.2, duration: 0.12, gain: 0.05 }),
  capsize: () => {
    noise({ freq: 1600, to: 180, q: 0.7, duration: 1.3, gain: 0.3, type: 'lowpass' });
    tone({ freq: 220, to: 55, duration: 0.8, type: 'triangle', gain: 0.12 });
  },
  remount: () => noise({ freq: 600, to: 300, q: 0.7, duration: 0.4, gain: 0.08 }),
  bank: () => {
    noise({ freq: 400, to: 120, q: 0.6, duration: 0.3, gain: 0.15, type: 'lowpass' });
    tone({ freq: 70, duration: 0.12, type: 'sine', gain: 0.1 });
  },
  bump: () => {
    tone({ freq: 180, to: 110, duration: 0.09, type: 'triangle', gain: 0.14 });
    noise({ freq: 900, to: 400, q: 1, duration: 0.15, gain: 0.08 });
  },
};

function react({ events, splashes }) {
  for (const e of events) {
    sounds[e]?.();
    if (e === 'stroke') controls.rumble(0.25, 40);
    if (e === 'weak') show('Weak stroke', { small: true, hold: 0.5 });
    if (e === 'capsize') {
      show('Capsized!', { hold: BOAT.swimTime - 0.5 });
      controls.rumble(1, 400);
    }
    if (e === 'bank') controls.rumble(0.8, 150);
    if (e === 'bump') controls.rumble(0.6, 120);
    if (e === 'finish') finish();
  }
  // The pack around you: nearby blades are louder.
  for (const d of splashes) {
    if (d < 25) noise({ freq: 600 + Math.random() * 400, to: 280, q: 0.8, duration: 0.2, gain: 0.07 * Math.min(1, 3 / d) ** 1.5 });
  }
}

// --- simulation --------------------------------------------------------------

let lastCount = COUNTDOWN;
function simulate(dt) {
  const input = controls.take();
  const boat = race.player.boat;
  if (state === 'countdown') {
    countdown -= dt;
    const count = Math.ceil(countdown);
    if (count !== lastCount && count > 0) {
      show(String(count));
      tone({ freq: 440, duration: 0.15, type: 'square', gain: 0.08 });
    }
    lastCount = count;
    if (countdown <= 0) {
      state = 'racing';
      show('Go!');
      tone({ freq: 880, duration: 0.4, type: 'square', gain: 0.1 });
    }
  } else if (state === 'finished') {
    // Over the line you glide to a stop; nobody should capsize after finishing.
    input.strokes = [];
    input.lean = Math.max(-1, Math.min(1, -(boat.roll * 2 + boat.rollRate * 0.6)));
  } else if (state !== 'racing') {
    return;
  }
  react(stepRace(race, dt, input, { started: state !== 'countdown' }));
}

// --- rendering ---------------------------------------------------------------

const frameData = new Float32Array(80);
const SUN = normalize([0.35, 0.42, -0.84]);

function boatFrame(b) {
  const h = b.heading;
  const f = [Math.sin(h), 0, -Math.cos(h)];
  const r = [Math.cos(h), 0, Math.sin(h)];
  // During a capsize the boat rolls right over, then rights itself.
  let roll = b.roll;
  if (b.swim > 0) {
    const t = BOAT.swimTime - b.swim;
    const over = Math.min(1, t / 0.5) * Math.min(1, b.swim / 0.6);
    roll = Math.sign(b.roll || 1) * (BOAT.capsize + (1.9 - BOAT.capsize) * over);
  }
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  const up = [s * r[0], c, s * r[2]];
  const right = [c * r[0], -s, c * r[2]];
  return { f, up, right, back: f.map((v) => -v), pos: [b.x, 0, b.z] };
}

// Where the paddle is in boat space. Seen from the cockpit (`firstPerson`) it
// rests low across the deck, just out of view, and each stroke lifts it into a
// diagonal: the working blade plants by the bow and pulls back. Rivals hold it
// higher, in front of the chest, and windmill it through every stroke.
function paddlePose(b, firstPerson) {
  const t = b.time - b.paddle.at;
  const dir = b.paddle.side === 'left' ? 1 : -1;
  const rest = firstPerson ? { y: 0.16, z: -0.6 } : { y: 0.5, z: -0.3 };
  const lift = firstPerson ? 0.24 : 0.1;
  const reach = firstPerson ? [-1.0, 0.2] : [-0.75, 0.15];
  let tilt = 0;
  let y = rest.y;
  let z = rest.z;
  let yaw = 0;
  if (b.paddle.side && t < BOAT.strokeTime) {
    const p = t / BOAT.strokeTime;
    const arc = Math.sin(Math.PI * Math.min(1, p * 1.15));
    tilt = dir * (firstPerson ? 0.72 : 0.6) * arc;
    y = rest.y + lift * arc;
    z = reach[0] + (reach[1] - reach[0]) * p;
    yaw = dir * 0.35 * (1 - 2 * p);
  } else if (b.paddle.side && t < BOAT.strokeTime + 0.25) {
    const e = 1 - (1 - (t - BOAT.strokeTime) / 0.25) ** 2;
    z = reach[1] + (rest.z - reach[1]) * e;
  }
  return { matrix: multiply(translation(0, y, z), multiply(rotationZ(tilt), rotationY(yaw))), yaw };
}

// An arm from shoulder to hand (both in boat space), as a stretched limbMesh.
function limb(model, from, to) {
  const d = to.map((v, i) => v - from[i]);
  const n = normalize(d);
  const a = normalize(Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [-n[2], 0, n[0]]);
  const b = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
  return multiply(model, basis(a.map((v) => v * 0.075), b.map((v) => v * 0.075), d, from));
}

function placeRacers() {
  const paddles = [];
  for (const r of race.racers) {
    const fr = boatFrame(r.boat);
    const model = basis(fr.right, fr.up, fr.back, fr.pos);
    const set = meshes.racers[liveries.get(r)];
    renderer.place(set.kayak, [model]);
    const pose = paddlePose(r.boat, r === race.player);
    paddles.push(multiply(model, pose.matrix));
    if (r === race.player) continue;
    // The paddler twists with the stroke; hands stay on the shaft.
    const twist = rotationY(pose.yaw * 0.7);
    renderer.place(set.body, [multiply(model, multiply(translation(0, 0, SEAT), twist))]);
    const arms = [-1, 1].map((side) => {
      const c = Math.cos(pose.yaw * 0.7);
      const s = Math.sin(pose.yaw * 0.7);
      const shoulder = [side * SHOULDER.x * c, SHOULDER.y, SEAT - side * SHOULDER.x * s];
      return limb(model, shoulder, apply(pose.matrix, [side * 0.36, 0, 0]));
    });
    renderer.place(set.arms, arms);
  }
  renderer.place(meshes.paddle, paddles);
}

function render(time) {
  placeRacers();
  const boat = race.player.boat;
  const fr = boatFrame(boat);

  // Eye just behind the cockpit, pitched down a touch to see the bow.
  const bob = 0.012 * Math.sin(boat.time * 7) * Math.min(1, boat.speed / 3);
  const lift = boat.swim > 0 ? -0.45 : 0;
  const eye = fr.pos.map((p, i) => p + fr.up[i] * (EYE_HEIGHT + bob + lift) + fr.back[i] * 0.15);
  const pitch = 0.11;
  const fwd = normalize(fr.f.map((v, i) => v * Math.cos(pitch) - fr.up[i] * Math.sin(pitch)));
  const up = normalize(fr.up.map((v, i) => v * Math.cos(pitch) + fr.f[i] * Math.sin(pitch)));
  // Portrait screens widen the vertical view so the horizontal one stays usable.
  const aspect = renderer.aspect;
  const tanY = Math.max(Math.tan(FOV_Y / 2), Math.tan(MIN_FOV_X / 2) / aspect);
  const proj = perspective(2 * Math.atan(tanY), aspect, 0.05, 2500);

  frameData.set(multiply(proj, view(eye, fr.right, up, fwd)), 0);
  frameData.set([...eye, time], 16);
  frameData.set([...fr.right, tanY * aspect], 20);
  frameData.set([...up, tanY], 24);
  frameData.set([...fwd, 0], 28);
  frameData.set([...SUN, 0], 32);
  frameData.set([0.3, 0.52, 0.84, 0], 36);
  frameData.set([0.78, 0.85, 0.9, 0.0016], 40);
  frameData.set([0.07, 0.2, 0.24, 0], 44);
  for (let i = 0; i < 8; i++) {
    const b = race.racers[i]?.boat;
    frameData.set(b && b.swim <= 0 ? [b.x, b.z, b.heading, b.speed] : [0, 0, 0, 0], 48 + i * 4);
  }
  const list = [meshes.worlds.get(mode)];
  for (const r of race.racers) {
    const set = meshes.racers[liveries.get(r)];
    list.push(set.kayak);
    if (r !== race.player) list.push(set.body, set.arms);
  }
  list.push(meshes.paddle);
  renderer.draw(frameData, list);
}

function updateHud(dt) {
  if (flashTimer > 0) {
    flashTimer -= dt;
    if (flashTimer <= 0) flash.classList.remove('show');
  }
  const { boat, loc } = race.player;
  document.body.classList.toggle('capsized', boat.swim > 0);
  if (hud.hidden) return;
  const { course } = race;
  const togo = Math.max(0, Math.min(course.finish - course.start, course.finish - loc.s)) * course.warp;
  els.clock.textContent = formatTime(shown(race.player.finish ?? race.time));
  els.togo.textContent = course.warp > 1 ? `${(togo / 1000).toFixed(2)} km` : `${Math.ceil(togo)} m`;
  els.pos.textContent = `${ordinal(standings(race).indexOf(race.player) + 1)} / ${race.racers.length}`;
  els.wash.classList.toggle('on', race.player.draft > 0.3 && state === 'racing');
  els.speed.textContent = (boat.speed * 3.6).toFixed(1);
  els.rate.textContent = strokeRate(boat);
  els.stamina.style.transform = `scaleX(${boat.stamina.toFixed(3)})`;
  const angle = Math.max(-1.1, Math.min(1.1, boat.roll / BOAT.capsize)) * 90;
  els.needle.style.transform = `rotate(${angle.toFixed(1)}deg)`;
}

// --- main loop ---------------------------------------------------------------

let last = performance.now();
let acc = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  handleGamepad(controls.poll(dt));
  if (state === 'countdown' || state === 'racing' || state === 'finished') {
    acc += dt;
    while (acc >= STEP) {
      acc -= STEP;
      simulate(STEP);
    }
  } else {
    acc = 0;
    // Behind the menu the boats just sit there, gently rocking.
    if (state === 'menu') for (const r of race.racers) r.boat.time += dt;
  }
  updateHud(dt);
  render(now / 1000);
  requestAnimationFrame(frame);
}

function formatTime(t, digits = 1) {
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(digits).padStart(digits ? 3 + digits : 2, '0');
  return `${m}:${s}`;
}

function ordinal(n) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

function apply(m, [x, y, z]) {
  return [0, 1, 2].map((i) => m[i] * x + m[4 + i] * y + m[8 + i] * z + m[12 + i]);
}

function normalize(v) {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
}

// The scenery is built the first time each course is raced.
function useWorld() {
  if (meshes.worlds.has(mode)) return;
  const world = renderer.createMesh(buildWorld(mode.course));
  renderer.place(world, [translation(0, 0, 0)]);
  meshes.worlds.set(mode, world);
}

// --- start up ----------------------------------------------------------------

// Lets automated playtests read the race from outside: open the page with #debug.
if (location.hash === '#debug') {
  window.kayak = {
    get race() { return race; },
    get boat() { return race.player.boat; },
    get loc() { return race.player.loc; },
    get course() { return race.course; },
    get state() { return state; },
  };
}

reset();
toMenu();
try {
  renderer = await createRenderer(canvas);
  meshes = {
    worlds: new Map(),
    paddle: renderer.createMesh(paddleMesh({ shaft: [0.22, 0.23, 0.26], blade: [1, 0.82, 0.2] }), LIVERIES.length),
    racers: LIVERIES.map((l, i) => ({
      kayak: renderer.createMesh(kayakMesh(l)),
      body: i ? renderer.createMesh(paddlerMesh(l)) : null,
      arms: i ? renderer.createMesh(limbMesh(l.top), 2) : null,
    })),
  };
  useWorld();
  requestAnimationFrame(frame);
} catch (err) {
  els.nogpu.hidden = false;
  els.nogpu.textContent = `${err.message} Kayak needs WebGPU: try a current version of Chrome, Edge, Safari or Firefox.`;
  for (const b of menu.querySelectorAll('form button')) b.disabled = true;
}
