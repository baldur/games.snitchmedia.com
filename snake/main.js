import { createGame, step, turn, progress, COLS, ROWS, DIRS } from './game.js';
import { chooseDir } from './ai.js';
import { Controls, tiltSupported } from './controls.js';
import { BUTTON } from '../shared/input.js';
import { tone, isMuted, setMuted } from '../shared/audio.js';
import { fitCanvas, themeColors, reducedMotion } from '../shared/canvas.js';
import { openDialog, gamepadDialogs, soundToggle } from '../shared/dialogs.js';

const CELL = 20; // field units per grid cell
const W = COLS * CELL;
const H = ROWS * CELL;
const DEMO_RESTART = 1.5; // seconds the crashed demo snake lies there
const BEST_KEY = 'snitchmedia:snake:best';

const canvas = document.getElementById('field');
const ctx = fitCanvas(canvas, W, H);
const colors = themeColors({ field: '--field', ink: '--field-ink', dim: '--field-dim', accent: '--accent' });
const menu = document.getElementById('menu');
const paused = document.getElementById('paused');
const over = document.getElementById('over');
const status = document.getElementById('status');
const tiltButton = document.getElementById('tilt');

const controls = new Controls(canvas, (dir) => { if (state === 'playing') turn(game, dir); });

let game = createGame();
let state = 'menu'; // 'menu' | 'playing' | 'paused' | 'over'
let best = 0;
try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch {}

const sounds = {
  turn: () => tone({ freq: 180, duration: 0.02, type: 'triangle', gain: 0.05 }),
  eat: () => {
    const freq = 440 * 2 ** (Math.min(game.score, 36) / 24); // creeps up the scale as you grow
    tone({ freq, to: freq * 1.5, duration: 0.09, gain: 0.1 });
  },
  die: () => tone({ freq: 300, to: 55, duration: 0.55, type: 'sawtooth', gain: 0.12 }),
  win: () => tone({ freq: 330, to: 1320, duration: 0.8, type: 'triangle', gain: 0.15 }),
};

// --- attract mode ------------------------------------------------------------
// Behind the menu a demo snake plays itself. Its route planning runs in a module
// Worker, in honour of the 2010 version's collision-checking worker. If workers
// aren't available it thinks on the main thread instead.

let demo = createGame();
let demoRestart = 0;
let demoFed = 0; // tick of the demo's last bite: a nearly full board can leave it circling forever
let demoAsk = 0; // id of the latest question, so stale answers are ignored
let worker = null;
try {
  worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => { if (data.id === demoAsk) turn(demo, data.dir); };
  worker.onerror = () => { worker = null; askDemo(); };
} catch {}

function askDemo() {
  const question = { id: ++demoAsk, cols: demo.cols, rows: demo.rows, snake: demo.snake, food: demo.food, dir: demo.dir };
  if (worker) worker.postMessage(question);
  else turn(demo, chooseDir(question));
}

function stepDemo(dt) {
  if (demo.over) {
    demoRestart -= dt;
    if (demoRestart <= 0) {
      demo = createGame();
      demoFed = 0;
      askDemo();
    }
    return;
  }
  const ticks = demo.ticks;
  if (step(demo, dt).includes('eat')) demoFed = demo.ticks;
  if (demo.over || demo.ticks - demoFed > demo.cols * demo.rows * 2) {
    demo.over = true;
    demoRestart = DEMO_RESTART;
  } else if (demo.ticks !== ticks) {
    askDemo();
  }
}

// --- screen wake lock --------------------------------------------------------
// Keeps a phone from dimming mid-game. Held only while playing; the browser also
// drops it by itself when the tab is hidden.

let wakeLock = null;

async function keepAwake() {
  if (wakeLock || !navigator.wakeLock) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (state !== 'playing' || wakeLock) return lock.release();
    wakeLock = lock;
    lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
  } catch {} // refused, e.g. in battery saver mode
}

function allowSleep() {
  wakeLock?.release();
  wakeLock = null;
}

// --- game flow ---------------------------------------------------------------

function showScore() {
  status.textContent = `Score ${game.score} · Best ${Math.max(best, game.score)}`;
}

function start() {
  game = createGame();
  state = 'playing';
  controls.recalibrate();
  keepAwake();
  showScore();
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  allowSleep();
  openDialog(paused);
}

function resume() {
  state = 'playing';
  controls.recalibrate();
  keepAwake();
}

function finish() {
  state = 'over';
  allowSleep();
  const record = game.score > best;
  if (record) {
    best = game.score;
    try { localStorage.setItem(BEST_KEY, String(best)); } catch {}
  }
  document.getElementById('result').textContent = game.won ? 'You filled the board!' : 'Game over';
  document.getElementById('result-detail').textContent = `Score ${game.score}. ${record ? 'New best!' : `Best ${best}.`}`;
  showScore();
  openDialog(over);
}

function toMenu() {
  state = 'menu';
  allowSleep();
  status.textContent = '';
  document.getElementById('best').textContent = best ? `Best: ${best}` : '';
  openDialog(menu);
}

if (!tiltSupported) tiltButton.remove();
let tiltRequest = Promise.resolve(false);
// The permission prompt has to come straight from the tap, so ask in the click
// handler and only wait for the answer once the dialog has closed.
tiltButton.addEventListener('click', () => { tiltRequest = controls.enableTilt(); });

menu.addEventListener('cancel', (e) => e.preventDefault()); // nowhere to go back to
menu.addEventListener('close', async () => {
  if (menu.returnValue === 'tilt') {
    const ok = await tiltRequest;
    start();
    status.textContent = ok ? 'Tilt steering on. Tip the phone to turn.' : 'Tilt steering isn’t available, swipe instead.';
  } else if (menu.returnValue === 'play') {
    controls.disableTilt();
    start();
  }
});
paused.addEventListener('close', () => {
  if (paused.returnValue === 'menu') toMenu();
  else resume(); // Resume button or Escape
});
over.addEventListener('cancel', (e) => e.preventDefault());
over.addEventListener('close', () => {
  if (over.returnValue === 'again') start();
  else toMenu();
});

document.getElementById('pause').addEventListener('click', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
soundToggle(document.getElementById('sound'), { isMuted, setMuted });

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if ((e.code === 'KeyP' || e.code === 'Escape') && state === 'playing') {
    e.preventDefault(); // keep this Escape from also closing the dialog it opens
    pause();
  }
});

addEventListener('gamepadconnected', (e) => {
  if (state !== 'playing') status.textContent = `Gamepad connected: ${e.gamepad.id.split('(')[0].trim()}`;
});

function handleGamepad(pressed) {
  if (pressed.has(BUTTON.START) && paused.open) {
    paused.close('resume');
    return;
  }
  if (!gamepadDialogs([menu, paused, over], pressed) && pressed.has(BUTTON.START)) pause();
}

// --- rendering ---------------------------------------------------------------

const center = (p) => ({ x: (p.x + 0.5) * CELL, y: (p.y + 0.5) * CELL });
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function draw(g, now) {
  ctx.fillStyle = colors.field;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = colors.dim;
  for (let y = 0; y < g.rows; y++) {
    for (let x = 0; x < g.cols; x++) ctx.fillRect((x + 0.5) * CELL - 1, (y + 0.5) * CELL - 1, 2, 2);
  }

  if (g === game) {
    ctx.font = 'bold 120px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(g.score, W / 2, H / 2);
  }

  if (g.food) {
    const f = center(g.food);
    const pulse = reducedMotion.matches ? 0 : Math.sin(now / 160) * 1.2;
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(f.x, f.y, CELL * 0.32 + pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  // The body is drawn as one thick line through the cell centres. Only the two
  // ends are interpolated: the head slides from the neck into its new cell and the
  // tail slides out of the cell it just left, so corners stay sharp.
  const t = progress(g);
  const cells = g.snake.map(center);
  const points = [lerp(cells[1], cells[0], t), ...cells.slice(1)];
  if (g.prevTail) points.push(lerp(center(g.prevTail), cells.at(-1), t));

  const dead = g.over && !g.won;
  ctx.strokeStyle = dead ? colors.accent : colors.ink;
  ctx.lineWidth = CELL * 0.7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();

  const head = points[0];
  const v = DIRS[g.dir];
  ctx.fillStyle = colors.field;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(head.x + v.x * 3 - v.y * 4 * side, head.y + v.y * 3 + v.x * 4 * side, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- main loop ---------------------------------------------------------------

let last = performance.now();

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  handleGamepad(controls.poll());

  if (state === 'menu') {
    stepDemo(dt);
  } else if (state === 'playing') {
    for (const event of step(game, dt)) {
      sounds[event]();
      if (event === 'eat') {
        controls.rumble();
        showScore();
      }
    }
    if (game.over) finish();
  }

  draw(state === 'menu' ? demo : game, now);
  requestAnimationFrame(frame);
}

toMenu();
askDemo();
requestAnimationFrame(frame);
