import { BOAT, HULLS, strokeRate } from './sim.js';
import { practiceRiver, raceRiver } from './course.js';
import { createRace, stepRace, standings, DIVISION_9 } from './race.js';
import { buildWorld } from './world.js';
import { kayakMesh, paddleMesh, paddlerMesh, limbMesh, SEAT, SHOULDER } from './meshes.js';
import { createRenderer } from './render.js';
import { perspective, view, basis, multiply, translation, rotationY, rotationZ } from './mat4.js';
import { Controls, BUTTON, TILT_REFLEX, TILT_FULL, TILT_SETTLE } from './controls.js';
import { tone, noise, isMuted, setMuted } from '../shared/audio.js';
import { openDialog, gamepadDialogs, soundToggle } from '../shared/dialogs.js';

const STEP = 1 / 120;
const EYE_HEIGHT = 0.78;
const FOV_Y = (62 * Math.PI) / 180;
const MIN_FOV_X = (75 * Math.PI) / 180;
const HULL_KEY = 'snitchmedia:kayak:hull';
const FORM_KEY = 'snitchmedia:kayak:form'; // sessionStorage: this visit only, for now

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
  { deck: [0.85, 0.85, 0.82], hull: [0.92, 0.92, 0.9], stripe: [0.8, 0.1, 0.3], top: [0.8, 0.1, 0.3], skin: [0.7, 0.5, 0.38], cap: [0.85, 0.85, 0.82] },
  { deck: [0.15, 0.45, 0.2], hull: [0.95, 0.95, 0.95], stripe: [0.95, 0.95, 0.95], top: [0.95, 0.6, 0.1], skin: [0.9, 0.74, 0.62], cap: [0.15, 0.45, 0.2] },
  { deck: [0.3, 0.3, 0.75], hull: [0.95, 0.93, 0.88], stripe: [0.95, 0.4, 0.1], top: [0.3, 0.3, 0.75], skin: [0.5, 0.34, 0.24], cap: [0.95, 0.4, 0.1] },
  { deck: [0.98, 0.9, 0.3], hull: [0.95, 0.95, 0.95], stripe: [0.2, 0.5, 0.9], top: [0.2, 0.5, 0.9], skin: [0.86, 0.66, 0.52], cap: [0.98, 0.9, 0.3] },
];

const canvas = document.getElementById('view');
const hud = document.getElementById('hud');
const menu = document.getElementById('menu');
const paused = document.getElementById('paused');
const finished = document.getElementById('finished');
const flash = document.getElementById('flash');
const els = Object.fromEntries(['clock', 'togo', 'pos', 'wash', 'speed', 'rate', 'stamina', 'rhythm', 'needle', 'rudder', 'cueL', 'cueR', 'best', 'result', 'details', 'standings', 'nogpu']
  .map((id) => [id, document.getElementById(id)]));

const controls = new Controls(canvas);

let state = 'menu'; // 'menu' | 'start' (on the line) | 'racing' | 'paused' | 'finished'
let resumeTo = 'racing';
let mode = MODES.race;
let race;
let liveries; // racer -> index into LIVERIES and meshes.racers
let hull = 'club';
try { if (HULLS[localStorage.getItem(HULL_KEY)]) hull = localStorage.getItem(HULL_KEY); } catch {}
let renderer = null;
let meshes = null;

// --- race flow ---------------------------------------------------------------

function reset() {
  const f = form();
  race = createRace(mode.course, {
    rivals: mode.rivals,
    seed: (Math.random() * 2 ** 31) | 0,
    you: { hull, power: 1 + f, endurance: 1 + f * 1.5 },
  });
  // Practice also sharpens your feel for the beat.
  const h = race.player.boat.hull;
  race.player.boat.hull = { ...h, rhythmSlop: h.rhythmSlop * (1 + f * 2) };
  let next = 1;
  liveries = new Map(race.racers.map((r) => [r, r === race.player ? 0 : next++]));
  controls.clear();
}

function start() {
  reset();
  controls.calibrate();
  state = 'start';
  hud.hidden = false;
  hud.classList.toggle('solo', race.racers.length === 1);
}

function pause() {
  if (state !== 'racing' && state !== 'start') return;
  resumeTo = state;
  state = 'paused';
  openDialog(paused);
}

// Session form: every race paddled makes you a little stronger, fitter and
// steadier on the beat, up to about 10%. Only for this visit, for now.
function training() {
  try { return JSON.parse(sessionStorage.getItem(FORM_KEY)) ?? { km: 0, races: 0 }; } catch { return { km: 0, races: 0 }; }
}
function form() {
  return 0.1 * (1 - Math.exp(-training().km / 6));
}
function train(km) {
  const t = training();
  t.km += km;
  t.races++;
  try { sessionStorage.setItem(FORM_KEY, JSON.stringify(t)); } catch {}
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

  const before = form();
  train((mode.course.finish - mode.course.start) / 1000);
  const gained = form() - before;

  const caps = race.player.boat.capsizes;
  const capsText = caps ? `${caps} capsize${caps > 1 ? 's' : ''}` : 'no capsizes';
  if (solo) {
    els.result.textContent = record ? `New best: ${formatTime(time)}` : `Finished in ${formatTime(time)}`;
    els.details.textContent = `Best ${formatTime(best.time)}, ${capsText}.`;
  } else {
    els.result.textContent = place === 1 ? 'You won!' : `You came ${ordinal(place)}`;
    els.details.textContent = `${formatTime(time)}, ${capsText}. Best ${ordinal(best.place)}, ${formatTime(best.time)}.`;
  }
  els.details.textContent += ` Form up ${(gained * 100).toFixed(1)}% to +${(form() * 100).toFixed(1)}%.`;
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
  const t = training();
  if (t.races) lines.push(`Form this session: +${(form() * 100).toFixed(1)}% after ${t.races} race${t.races > 1 ? 's' : ''}`);
  els.best.textContent = lines.filter(Boolean).join(' · ');
  openDialog(menu);
}

// The hull picker: radio buttons in the menu, remembered between visits.
for (const radio of menu.querySelectorAll('input[name="hull"]')) {
  radio.checked = radio.value === hull;
  radio.addEventListener('change', () => {
    hull = radio.value;
    try { localStorage.setItem(HULL_KEY, hull); } catch {}
  });
}

// Phones: the race buttons are the tap that lets us ask for the motion
// sensors, and for full screen held sideways where the browser allows it.
const phone = matchMedia('(pointer: coarse)');
menu.querySelector('form').addEventListener('click', (e) => {
  if (!e.target.closest('button') || !phone.matches) return;
  controls.enableTilt();
  if (document.fullscreenEnabled && !document.fullscreenElement) {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {});
  }
});
// Leaving: out of full screen, then back to wherever you came from (the game
// may be hosted where ../ isn't a games list), or else to ../.
function leave() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (document.referrer && history.length > 1) history.back();
  else location.href = '../';
}
for (const link of document.querySelectorAll('a.leave')) {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    leave();
  });
}
// The phone's back gesture first takes you out of full screen: pause there,
// so the pause screen's Leave button is one tap away.
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) pause();
});

// Turned upright mid-race: pause, and the pause screen says to turn it back.
matchMedia('(orientation: portrait) and (pointer: coarse)').addEventListener('change', (e) => {
  if (e.matches) pause();
});

menu.addEventListener('cancel', (e) => e.preventDefault());
menu.addEventListener('close', () => {
  if (!MODES[menu.returnValue]) return;
  mode = MODES[menu.returnValue];
  if (renderer) useWorld();
  start();
});
paused.addEventListener('close', () => {
  if (paused.returnValue === 'leave') leave();
  else if (paused.returnValue === 'menu') toMenu();
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
  if ((e.code === 'KeyP' || e.code === 'Escape') && (state === 'racing' || state === 'start')) {
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
  // The starter: a horn for the off, a whistle for a jumped start.
  go: () => {
    tone({ freq: 233, duration: 0.9, type: 'sawtooth', gain: 0.12 });
    tone({ freq: 349, duration: 0.9, type: 'sawtooth', gain: 0.08 });
  },
  hold: () => {
    tone({ freq: 2600, to: 2400, duration: 0.25, type: 'sine', gain: 0.12 });
    setTimeout(() => tone({ freq: 2600, to: 2300, duration: 0.45, type: 'sine', gain: 0.12 }), 300);
  },
  bump: () => {
    tone({ freq: 180, to: 110, duration: 0.09, type: 'triangle', gain: 0.14 });
    noise({ freq: 900, to: 400, q: 1, duration: 0.15, gain: 0.08 });
  },
};

// The starter's voice, through the browser's own speech synthesis. Asking for
// the voices early saves a stall on the first call.
window.speechSynthesis?.getVoices();
function say(text) {
  if (isMuted() || !window.speechSynthesis) return;
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  u.pitch = 0.9;
  speechSynthesis.speak(u);
}

function react({ events, splashes }) {
  for (const e of events) {
    sounds[e]?.();
    if (e === 'stroke') controls.rumble(0.25, 40);
    if (e === 'weak') show('Weak stroke', { small: true, hold: 0.5 });
    if (e === 'capsize') {
      show('Capsized!', { hold: race.player.boat.hull.swimTime - 0.5 });
      controls.rumble(1, 400);
    }
    if (e === 'bank') controls.rumble(0.8, 150);
    if (e === 'bump') controls.rumble(0.6, 120);
    if (e === 'finish') finish();
    if (e === 'line-up') say(race.start.holds ? 'Back to the line' : 'Paddlers, come up to the line');
    if (e === 'nudge') say("Come on up to the line, please. We're waiting for you");
    if (e === 'ready') say('Are you ready?');
    if (e === 'hold') say('Hold it! Hold the line!');
    if (e === 'line-up') show(race.start.holds ? 'Come back up to the line' : race.racers.length > 1 ? 'Paddle up into a gap on the line' : 'Wait for the horn', { small: true, hold: 3 });
    if (e === 'nudge') show('Paddle up to the line and stop', { small: true, hold: 3 });
    if (e === 'ready') show('Are you ready?', { small: true, hold: 1 });
    if (e === 'go') {
      state = 'racing';
      show('Go!', { hold: 0.6 });
      controls.rumble(0.8, 300);
    }
    if (e === 'hold') {
      show('Hold the line! You jumped the start', { small: true, hold: 3 });
      controls.rumble(0.5, 200);
    }
  }
  // The pack around you: nearby blades are louder.
  for (const d of splashes) {
    if (d < 25) noise({ freq: 600 + Math.random() * 400, to: 280, q: 0.8, duration: 0.2, gain: 0.07 * Math.min(1, 3 / d) ** 1.5 });
  }
}

// --- simulation --------------------------------------------------------------

function simulate(dt) {
  const input = controls.take();
  const boat = race.player.boat;
  if (state === 'finished') {
    // Over the line you glide to a stop; nobody should capsize after finishing.
    input.strokes = [];
    input.lean = Math.max(-1, Math.min(1, -(boat.roll * 2 + boat.rollRate * 0.6)));
  } else if (state !== 'racing' && state !== 'start') {
    return;
  }
  if (controls.assist) input.lean = Math.max(-1, Math.min(1, input.lean - (boat.roll * 2 + boat.rollRate * 0.6)));
  else if (controls.tilting) input.lean = Math.max(-1, Math.min(1, input.lean - TILT_REFLEX * boat.rollRate));
  react(stepRace(race, dt, input));
}

// --- rendering ---------------------------------------------------------------

const frameData = new Float32Array(112);
const SUN = normalize([0.35, 0.42, -0.84]);

function boatFrame(b) {
  const h = b.heading;
  const f = [Math.sin(h), 0, -Math.cos(h)];
  const r = [Math.cos(h), 0, Math.sin(h)];
  // During a capsize the boat rolls right over, then rights itself.
  let roll = b.roll;
  if (b.swim > 0) {
    const t = b.hull.swimTime - b.swim;
    const over = Math.min(1, t / 0.5) * Math.min(1, b.swim / 0.6);
    roll = Math.sign(b.roll || 1) * (BOAT.capsize + (1.9 - BOAT.capsize) * over);
  }
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  const up = [s * r[0], c, s * r[2]];
  const right = [c * r[0], -s, c * r[2]];
  return { f, up, right, back: f.map((v) => -v), pos: [b.x, 0, b.z] };
}

// Where the player's paddle is in boat space, seen from the cockpit. It rests
// low across the deck, just out of view. A stroke reaches forward and spears
// the working blade in by the bow, then the blade holds in the water while
// the boat drives past it, back to the hip, where it lifts out to the side.
// Also returns `reach`: how far the paddler's body leans into the catch.
function paddlePose(b) {
  const t = b.time - b.paddle.at;
  const dir = b.paddle.side === 'left' ? 1 : -1; // working blade at -x for a left stroke
  const REST = { y: 0.16, z: -0.6, yaw: 0, tilt: 0 };
  // depth 0..1: how far the blade is buried.
  const pose = (p) => {
    const depth = p < 0.12 ? smooth(p / 0.12) : 1 - smooth((p - 0.8) / 0.2);
    const drive = smooth((p - 0.08) / 0.75);
    return {
      depth,
      tilt: dir * (0.3 + 0.5 * depth), // shaft steep, top hand high
      y: 0.2 + 0.26 * depth,
      z: -0.8 + 0.9 * drive, // hands come back past you as the boat runs on
      yaw: dir * (-0.45 + 0.6 * drive), // the working blade starts forward
    };
  };
  let p = REST;
  let reach = 0;
  if (b.paddle.side && t < BOAT.strokeTime) {
    p = pose(t / BOAT.strokeTime);
    reach = 1 - smooth(t / (BOAT.strokeTime * 0.6));
  } else if (b.paddle.side && t < BOAT.strokeTime + 0.3) {
    // Recovery: swing back to rest across the deck, ready for the other side.
    const from = pose(1);
    const k = smooth((t - BOAT.strokeTime) / 0.3);
    p = Object.fromEntries(Object.keys(REST).map((key) => [key, from[key] + (REST[key] - from[key]) * k]));
    reach = 0;
  }
  return {
    matrix: multiply(translation(0, p.y, p.z), multiply(rotationZ(p.tilt), rotationY(p.yaw))),
    reach,
  };
}

// A rival's paddle through a real stroke, in boat space. The blade is planted
// by the feet, stays put in the water while the boat runs past it (so in the
// boat's frame it slides back along the hull, a little outward, like a wing
// blade), exits by the hip and the paddle rolls over for the other side. The
// top hand stays high and the torso unwinds through each stroke.
const PADDLE_HALF = 0.85; // shaft centre to blade centre
function rivalPaddle(b) {
  const beat = Math.min(1.1, Math.max(0.45, b.beat ?? 0.65));
  const t = b.time - b.paddle.at;
  if (!b.paddle.side || b.swim > 0 || t > beat * 1.6) {
    return { matrix: frameFrom([0, 0.5, -0.3], [1, 0, 0]), twist: 0 };
  }
  const side = b.paddle.side === 'left' ? -1 : 1;
  const IN_WATER = 0.62;
  const p = Math.min(1, t / beat);
  // Pose with the `e`-side blade a fraction q through its pull.
  const pull = (e, q, dt) => {
    const dip = Math.sin(Math.PI * q);
    const blade = [e * (0.55 + 0.15 * q), -0.08 - 0.14 * dip, Math.min(0.3, -1.0 + Math.max(b.speed * dt, q * 0.9))];
    const centre = [e * 0.1, 0.42 + 0.05 * dip, blade[2] * 0.45 - 0.2];
    return { axis: normalize(blade.map((v, i) => (v - centre[i]) * e)), blade, e, twist: -e * 0.3 * (1 - 2 * q) };
  };
  let pose;
  if (p < IN_WATER) {
    pose = pull(side, p / IN_WATER, t);
  } else {
    // Out of the water: swing over to the catch on the other side.
    const from = pull(side, 1, beat * IN_WATER);
    const to = pull(-side, 0, 0);
    const k = smooth((p - IN_WATER) / (1 - IN_WATER));
    const axis = normalize(from.axis.map((v, i) => v + (to.axis[i] - v) * k));
    const centreFrom = from.blade.map((v, i) => v - from.axis[i] * from.e * PADDLE_HALF);
    const centreTo = to.blade.map((v, i) => v - to.axis[i] * to.e * PADDLE_HALF);
    const centre = centreFrom.map((v, i) => v + (centreTo[i] - v) * k);
    centre[1] += 0.12 * Math.sin(Math.PI * k); // lift the paddle clear as it rolls over
    return { matrix: frameFrom(centre, axis), twist: from.twist + (to.twist - from.twist) * k };
  }
  const centre = pose.blade.map((v, i) => v - pose.axis[i] * pose.e * PADDLE_HALF);
  return { matrix: frameFrom(centre, pose.axis), twist: pose.twist };
}

// Paddle matrix: shaft along `axis` (local x), centred on `centre`, blade faces
// turned towards the stern.
function frameFrom(centre, axis) {
  const back = [0, 0, 1];
  const d = back[0] * axis[0] + back[1] * axis[1] + back[2] * axis[2];
  const z = normalize(back.map((v, i) => v - d * axis[i]));
  const y = [z[1] * axis[2] - z[2] * axis[1], z[2] * axis[0] - z[0] * axis[2], z[0] * axis[1] - z[1] * axis[0]];
  return basis(axis, y, z, centre);
}

function smooth(x) {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
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
    renderer.place(kayakFor(r), [model]);
    if (r === race.player) {
      paddles.push(multiply(model, paddlePose(r.boat).matrix));
      continue;
    }
    // The paddler twists with the stroke; hands stay on the shaft.
    const pose = rivalPaddle(r.boat);
    paddles.push(multiply(model, pose.matrix));
    renderer.place(set.body, [multiply(model, multiply(translation(0, 0, SEAT), rotationY(pose.twist)))]);
    const arms = [-1, 1].map((side) => {
      const c = Math.cos(pose.twist);
      const s = Math.sin(pose.twist);
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

  // Eye just behind the cockpit, pitched down a touch to see the bow. You
  // lean into each catch, and the boat surges on under you as you drive.
  const bob = 0.012 * Math.sin(boat.time * 7) * Math.min(1, boat.speed / 3);
  const lift = boat.swim > 0 ? -0.45 : 0;
  const lean = 0.06 * paddlePose(boat).reach;
  const eye = fr.pos.map((p, i) => p + fr.up[i] * (EYE_HEIGHT + bob + lift - lean * 0.3) + fr.back[i] * (0.15 - lean));
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
  for (let i = 0; i < 16; i++) {
    const b = race.racers[i]?.boat;
    frameData.set(b && b.swim <= 0 ? [b.x, b.z, b.heading, b.speed] : [0, 0, 0, 0], 48 + i * 4);
  }
  const list = [meshes.worlds.get(mode)];
  for (const r of race.racers) {
    const set = meshes.racers[liveries.get(r)];
    list.push(kayakFor(r));
    if (r !== race.player) list.push(set.body, set.arms);
  }
  list.push(meshes.paddle);
  renderer.draw(frameData, list);
}

// Open the page with #tilt to see what the motion sensors are doing.
const tiltReadout = location.hash === '#tilt' ? document.getElementById('tiltdebug') : null;
const sensorPermissions = {};
if (tiltReadout) {
  tiltReadout.hidden = false;
  for (const name of ['accelerometer', 'gyroscope', 'magnetometer']) {
    navigator.permissions?.query({ name }).then((p) => {
      sensorPermissions[name] = p.state;
      p.onchange = () => { sensorPermissions[name] = p.state; };
    }).catch(() => { sensorPermissions[name] = 'unknown'; });
  }
}
let readoutTimer = 0;
function showTilt(dt) {
  readoutTimer -= dt;
  if (!tiltReadout || readoutTimer > 0) return;
  readoutTimer = 0.2;
  const d = controls.debug;
  const deg = (r) => (r == null ? '-' : `${((r * 180) / Math.PI).toFixed(1)}°`);
  const num = (v) => (v == null ? '-' : v.toFixed(1));
  const boat = race.player.boat;
  tiltReadout.textContent = [
    `secure page: ${isSecureContext}  permission: ${d.permission}`,
    `sensors: ${Object.entries(sensorPermissions).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`,
    `screen: ${screen.orientation?.type ?? '-'} ${screen.orientation?.angle ?? window.orientation ?? '-'}°`,
    `events: orientation ${d.orientations}, motion ${d.motions}  using: ${d.source}`,
    `beta ${num(d.beta)}  gamma ${num(d.gamma)}  accel ${d.accel ? d.accel.map(num).join(' ') : '-'}`,
    `turn ${deg(d.turn)}  level at ${deg(d.zero)}  -> lean ${controls.tiltLean?.toFixed(2) ?? 'none'}`,
    `tilting ${controls.tilting}  assist ${controls.assist}  roll ${deg(boat.roll)}`,
    `settings: full lean at ${deg(TILT_FULL)}, reflex ${TILT_REFLEX}, levels over ${TILT_SETTLE} s`,
  ].join('\n');
}

function updateHud(dt) {
  showTilt(dt);
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
  els.rhythm.style.transform = `scaleX(${boat.rhythm.toFixed(3)})`;
  els.rhythm.parentElement.classList.toggle('locked', boat.rhythm > 0.9);
  hud.classList.toggle('assisted', controls.assist);
  // On phones, the controls in a line until a little way into the race.
  hud.classList.toggle('helping', phone.matches && (state === 'start' || (state === 'racing' && race.time < 6)));
  showBeat(boat);
  els.rudder.style.transform = `translateX(${(controls.rudder * 39).toFixed(1)}px)`;
  const angle = Math.max(-1.1, Math.min(1.1, boat.roll / BOAT.capsize)) * 90;
  els.needle.style.transform = `rotate(${angle.toFixed(1)}deg)`;
}

// The beat cue: the side to stroke next lights up, and its ring closes in on
// the moment your beat says it's due (a racing 86 a minute until you have one).
function showBeat(boat) {
  const beat = Math.min(0.85, Math.max(0.62, boat.beat ?? 0.7));
  const since = boat.time - boat.lastStroke;
  const nextSide = boat.lastSide === 'left' ? 'right' : 'left';
  const waiting = since > beat * 1.8; // stopped: just show where to start
  const left = Math.max(0, beat - since);
  const window = beat * boat.hull.rhythmSlop;
  for (const [cue, side] of [[els.cueL, 'left'], [els.cueR, 'right']]) {
    const next = side === nextSide;
    cue.classList.toggle('next', next);
    cue.classList.toggle('now', next && !waiting && Math.abs(since - beat) < window);
    if (next) cue.firstElementChild.style.transform = `scale(${waiting ? 1 : (1 + 1.4 * left / beat).toFixed(3)})`;
  }
}

// --- main loop ---------------------------------------------------------------

let last = performance.now();
let acc = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  handleGamepad(controls.poll(dt));
  if (state === 'start' || state === 'racing' || state === 'finished') {
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

// Each racer's boat in their colours, built the first time that colour and
// hull width are needed.
function kayakFor(r) {
  const livery = liveries.get(r);
  const { beam } = r.boat.hull;
  const key = `${livery}:${beam}`;
  if (!meshes.kayaks.has(key)) meshes.kayaks.set(key, renderer.createMesh(kayakMesh({ ...LIVERIES[livery], beam })));
  return meshes.kayaks.get(key);
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
    get gpu() { return renderer?.stats; },
    get tilt() { return controls.tiltLean; },
  };
}

reset();
toMenu();
try {
  renderer = await createRenderer(canvas);
  meshes = {
    worlds: new Map(),
    paddle: renderer.createMesh(paddleMesh({ shaft: [0.22, 0.23, 0.26], blade: [1, 0.82, 0.2] }), LIVERIES.length),
    kayaks: new Map(),
    racers: LIVERIES.map((l, i) => ({
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
