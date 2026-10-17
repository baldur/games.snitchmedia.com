import { createBoat, step, strokeRate, bounceOffBank, BOAT } from './sim.js';
import { practiceRiver, locate, headingAt, pointAt } from './course.js';
import { buildWorld } from './world.js';
import { kayakMesh, paddleMesh } from './meshes.js';
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
const BEST_KEY = 'snitchmedia:kayak:practice';

const canvas = document.getElementById('view');
const hud = document.getElementById('hud');
const menu = document.getElementById('menu');
const paused = document.getElementById('paused');
const finished = document.getElementById('finished');
const flash = document.getElementById('flash');
const els = Object.fromEntries(['clock', 'togo', 'speed', 'rate', 'stamina', 'needle', 'best', 'result', 'details', 'nogpu']
  .map((id) => [id, document.getElementById(id)]));

const controls = new Controls(canvas);
const course = practiceRiver();

let state = 'menu'; // 'menu' | 'countdown' | 'racing' | 'paused' | 'finished'
let resumeTo = 'racing';
let boat;
let loc;
let clock = 0; // race time; negative during the countdown
let renderer = null;
let meshes = null;
let best = null;
try { best = Number(localStorage.getItem(BEST_KEY)) || null; } catch {}

// --- race flow ---------------------------------------------------------------

function reset() {
  const start = course.start - 12;
  const p = pointAt(course, start);
  boat = createBoat({ x: p.x, z: p.z, heading: headingAt(course, start) });
  loc = locate(course, boat.x, boat.z);
  clock = -COUNTDOWN;
  controls.clear();
}

function start() {
  reset();
  state = 'countdown';
  hud.hidden = false;
}

function pause() {
  if (state !== 'racing' && state !== 'countdown') return;
  resumeTo = state;
  state = 'paused';
  openDialog(paused);
}

function finish() {
  state = 'finished';
  const record = best === null || clock < best;
  if (record) {
    best = clock;
    try { localStorage.setItem(BEST_KEY, String(best)); } catch {}
  }
  els.result.textContent = record ? `New best: ${formatTime(clock)}` : `Finished in ${formatTime(clock)}`;
  const caps = boat.capsizes ? `, ${boat.capsizes} capsize${boat.capsizes > 1 ? 's' : ''}` : ', no capsizes';
  els.details.textContent = `Best ${formatTime(best)}${caps}.`;
  tone({ freq: 523, to: 1046, duration: 0.5, type: 'triangle', gain: 0.15 });
  setTimeout(() => { if (state === 'finished') openDialog(finished); }, 1200);
}

function toMenu() {
  state = 'menu';
  hud.hidden = true;
  reset();
  els.best.textContent = best ? `Best time: ${formatTime(best)}` : '';
  openDialog(menu);
}

menu.addEventListener('cancel', (e) => e.preventDefault());
menu.addEventListener('close', () => { if (menu.returnValue) start(); });
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
};

function react(events) {
  for (const e of events) {
    sounds[e]?.();
    if (e === 'stroke') controls.rumble(0.25, 40);
    if (e === 'weak') show('Weak stroke', { small: true, hold: 0.5 });
    if (e === 'capsize') {
      show('Capsized!', { hold: BOAT.swimTime - 0.5 });
      controls.rumble(1, 400);
    }
    if (e === 'bank') controls.rumble(0.8, 150);
  }
}

// --- simulation --------------------------------------------------------------

let lastCount = Math.ceil(-clock);
function simulate(dt) {
  const input = controls.take();
  if (state === 'countdown') {
    input.strokes = []; // balance from the start, but no paddling before the gun
    clock += dt;
    const count = Math.ceil(-clock);
    if (count !== lastCount && count > 0) {
      show(String(count));
      tone({ freq: 440, duration: 0.15, type: 'square', gain: 0.08 });
    }
    lastCount = count;
    if (clock >= 0) {
      state = 'racing';
      show('Go!');
      tone({ freq: 880, duration: 0.4, type: 'square', gain: 0.1 });
    }
  } else if (state === 'racing') {
    clock += dt;
  } else if (state === 'finished') {
    // Over the line you glide to a stop; nobody should capsize after finishing.
    input.strokes = [];
    input.lean = Math.max(-1, Math.min(1, -(boat.roll * 2 + boat.rollRate * 0.6)));
  } else {
    return;
  }

  const events = step(boat, dt, input);
  loc = locate(course, boat.x, boat.z, loc.i);
  if (bounceOffBank(boat, loc, course.width / 2)) events.push('bank');
  react(events);
  if (state === 'racing' && loc.s >= course.finish) finish();
}

// --- rendering ---------------------------------------------------------------

const frameData = new Float32Array(48);
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

function paddlePose(b) {
  const t = b.time - b.paddle.at;
  const dir = b.paddle.side === 'left' ? 1 : -1;
  // At rest the paddle sits low across the deck, just out of view. Each stroke
  // lifts it into a diagonal: the working blade plants by the bow and pulls back.
  const REST = { y: 0.16, z: -0.6 };
  let tilt = 0;
  let y = REST.y;
  let z = REST.z;
  let yaw = 0;
  if (b.paddle.side && t < BOAT.strokeTime) {
    const p = t / BOAT.strokeTime;
    const arc = Math.sin(Math.PI * Math.min(1, p * 1.15));
    tilt = dir * 0.72 * arc;
    y = REST.y + 0.24 * arc;
    z = -1.0 + 1.2 * p;
    yaw = dir * 0.35 * (1 - 2 * p);
  } else if (b.paddle.side && t < BOAT.strokeTime + 0.25) {
    const e = 1 - (1 - (t - BOAT.strokeTime) / 0.25) ** 2;
    z = 0.2 + (REST.z - 0.2) * e;
  }
  return multiply(translation(0, y, z), multiply(rotationZ(tilt), rotationY(yaw)));
}

function render(time) {
  const fr = boatFrame(boat);
  const model = basis(fr.right, fr.up, fr.back, fr.pos);
  renderer.place(meshes.kayak, [model]);
  renderer.place(meshes.paddle, [multiply(model, paddlePose(boat))]);

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
  renderer.draw(frameData, [meshes.world, meshes.kayak, meshes.paddle]);
}

function updateHud(dt) {
  if (flashTimer > 0) {
    flashTimer -= dt;
    if (flashTimer <= 0) flash.classList.remove('show');
  }
  document.body.classList.toggle('capsized', boat.swim > 0);
  if (hud.hidden) return;
  els.clock.textContent = formatTime(Math.max(0, clock));
  els.togo.textContent = `${Math.max(0, Math.ceil(course.finish - loc.s))} m`;
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
    // Behind the menu the boat just sits there, gently rocking.
    if (state === 'menu') boat.time += dt;
  }
  updateHud(dt);
  render(now / 1000);
  requestAnimationFrame(frame);
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

function normalize(v) {
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
}

// --- start up ----------------------------------------------------------------

// Lets automated playtests read the race from outside: open the page with #debug.
if (location.hash === '#debug') window.kayak = { get boat() { return boat; }, get loc() { return loc; }, course, get state() { return state; } };

reset();
toMenu();
try {
  renderer = await createRenderer(canvas);
  meshes = {
    world: renderer.createMesh(buildWorld(course)),
    kayak: renderer.createMesh(kayakMesh({ deck: [0.9, 0.2, 0.16], hull: [0.95, 0.93, 0.88], stripe: [0.97, 0.97, 0.95] })),
    paddle: renderer.createMesh(paddleMesh({ shaft: [0.22, 0.23, 0.26], blade: [1, 0.82, 0.2] })),
  };
  renderer.place(meshes.world, [translation(0, 0, 0)]);
  requestAnimationFrame(frame);
} catch (err) {
  els.nogpu.hidden = false;
  els.nogpu.textContent = `${err.message} Kayak needs WebGPU: try a current version of Chrome, Edge, Safari or Firefox.`;
  menu.querySelector('form button').disabled = true;
}
