import { createGame, step, W, H, PADDLE, BALL, LIVES } from './game.js';
import { createGpuParticles } from './particles-gpu.js';
import { create2dParticles } from './particles-2d.js';
import { Input, BUTTON } from '../shared/input.js';
import { tone, isMuted, setMuted } from '../shared/audio.js';
import { fitCanvas, themeColors, reducedMotion } from '../shared/canvas.js';
import { openDialog, gamepadDialogs, soundToggle } from '../shared/dialogs.js';

const STEP = 1 / 120; // fixed simulation step, independent of display refresh rate
const TRAIL = 5;
const BEST_KEY = 'snitchmedia:bricks:best';
const BANNER_TIME = 1.6;

// Brick colors by row, top to bottom. The field is dark in both themes, so these don't switch.
const ROW_COLORS = ['#ff5d73', '#ff8f4d', '#ffc94d', '#9be15d', '#3fd6a8', '#45b8ff', '#7c8cff', '#c77dff'];
const ROW_RGB = ROW_COLORS.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));
// Pentatonic steps, so brick hits up the wall climb a pleasant scale.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

const canvas = document.getElementById('field');
const fx = document.getElementById('fx');
const ctx = fitCanvas(canvas, W, H);
const colors = themeColors({ field: '--field', ink: '--field-ink', dim: '--field-dim' });
const menu = document.getElementById('menu');
const paused = document.getElementById('paused');
const over = document.getElementById('over');
const result = document.getElementById('result');
const bestText = [...document.querySelectorAll('.best')];
const status = document.getElementById('status');

const input = new Input(canvas, {
  keys: { ArrowLeft: [0, -1], ArrowRight: [0, 1], KeyA: [0, -1], KeyD: [0, 1] },
  axis: 'x',
  length: W,
});

let game = createGame();
let state = 'menu'; // 'menu' | 'playing' | 'paused' | 'over'
let trail = [];
let launchQueued = false;
let banner = { text: '', time: 0 };
let message = '';
let best = 0;
try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch {}

// --- particles: WebGPU when the browser has it, Canvas 2D otherwise ---------------

let particles = await pickParticles();

async function pickParticles() {
  try {
    const gpu = await createGpuParticles(fx, W, H);
    if (gpu) {
      gpu.lost.then(() => {
        if (particles !== gpu) return;
        particles = useFallback();
        renderStatus();
      });
      return gpu;
    }
  } catch {} // no usable adapter or device: fall through
  return useFallback();
}

function useFallback() {
  fx.hidden = true;
  return create2dParticles(W, H);
}

function burst(brick, scale) {
  if (reducedMotion.matches) return;
  const { vx, vy } = game.ball;
  particles.burst(brick, ROW_RGB[brick.row % ROW_RGB.length], Math.round(particles.perBrick * scale), { vx, vy });
}

function renderStatus() {
  const fxLabel = `Particles: ${particles.label}${reducedMotion.matches ? ' (off for reduced motion)' : ''}`;
  status.textContent = [message, fxLabel].filter(Boolean).join(' · ');
}
reducedMotion.addEventListener('change', renderStatus);

// --- sound and haptics -------------------------------------------------------

function brickTone(brick, gain = 0.1) {
  const note = SCALE[Math.max(0, Math.min(SCALE.length - 1, game.rows - 1 - brick.row))];
  tone({ freq: 330 * 2 ** (note / 12), duration: 0.09, type: 'square', gain });
}

const effects = {
  launch: () => tone({ freq: 360, to: 520, duration: 0.07, type: 'triangle', gain: 0.08 }),
  paddle: () => {
    tone({ freq: 220, duration: 0.06, gain: 0.1 });
    input.rumble(0, true, 0.25);
  },
  wall: () => tone({ freq: 160, duration: 0.04, gain: 0.06 }),
  crack: ({ brick }) => {
    tone({ freq: 140, to: 90, duration: 0.08, type: 'sawtooth', gain: 0.08 });
    brickTone(brick, 0.05);
    burst(brick, 0.15);
    input.rumble(0, true, 0.35);
  },
  brick: ({ brick }) => {
    brickTone(brick);
    burst(brick, 1);
    input.rumble(0, true, 0.5);
  },
  clear: () => {
    [523, 659, 784, 1047].forEach((freq, i) => {
      setTimeout(() => tone({ freq, duration: 0.14, type: 'triangle', gain: 0.14 }), i * 90);
    });
    showBanner(`Level ${game.level}`);
    trail = [];
  },
  lost: () => {
    tone({ freq: 420, to: 90, duration: 0.45, type: 'sawtooth', gain: 0.1 });
    input.rumble(0, true, 1);
    trail = [];
  },
  over: () => tone({ freq: 300, to: 60, duration: 0.9, type: 'triangle', gain: 0.16 }),
};

// --- game flow ---------------------------------------------------------------

function start() {
  game = createGame();
  trail = [];
  launchQueued = false;
  state = 'playing';
  showBanner('Level 1');
  setMessage('');
}

function showBanner(text) {
  banner = { text, time: BANNER_TIME };
}

function setMessage(text) {
  message = text;
  renderStatus();
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  openDialog(paused);
}

function finish() {
  state = 'over';
  const record = game.score > best;
  if (record) {
    best = game.score;
    try { localStorage.setItem(BEST_KEY, String(best)); } catch {}
  }
  result.textContent = record
    ? `New best: ${game.score}!`
    : `Score ${game.score}, reached level ${game.level}.`;
  renderBest();
  openDialog(over);
}

function toMenu() {
  state = 'menu';
  game = createGame();
  renderBest();
  openDialog(menu);
}

function renderBest() {
  for (const el of bestText) el.textContent = best ? `Best score: ${best}` : '';
}

menu.addEventListener('cancel', (e) => e.preventDefault()); // nowhere to go back to
menu.addEventListener('close', () => {
  if (menu.returnValue) start();
});
paused.addEventListener('close', () => {
  if (paused.returnValue === 'menu') toMenu();
  else state = 'playing'; // Resume button or Escape
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
  if (e.code === 'Space' && state === 'playing') {
    e.preventDefault(); // no page scroll, and no clicking whichever button has focus
    launchQueued = true;
  }
  if (e.repeat) return;
  if ((e.code === 'KeyP' || e.code === 'Escape') && state === 'playing') {
    e.preventDefault(); // keep this Escape from also closing the dialog it opens
    pause();
  }
});
addEventListener('keyup', (e) => { if (e.code === 'Space' && state === 'playing') e.preventDefault(); });
canvas.addEventListener('pointerdown', () => { if (state === 'playing') launchQueued = true; });

addEventListener('gamepadconnected', (e) => {
  setMessage(`Gamepad connected: ${e.gamepad.id.split('(')[0].trim()}`);
});

function handleGamepad(pressed) {
  if (pressed.has(BUTTON.START) && paused.open) {
    paused.close('resume');
    return;
  }
  if (gamepadDialogs([menu, paused, over], pressed)) return;
  if (pressed.has(BUTTON.START)) pause();
  if (pressed.has(BUTTON.A) && state === 'playing') launchQueued = true;
}

// --- rendering ---------------------------------------------------------------

function draw() {
  ctx.fillStyle = colors.field;
  ctx.fillRect(0, 0, W, H);

  drawHud();
  drawBricks();

  ctx.fillStyle = colors.ink;
  const p = game.paddle;
  ctx.beginPath();
  ctx.roundRect(p.x - PADDLE.w / 2, PADDLE.y, PADDLE.w, PADDLE.h, PADDLE.h / 2);
  ctx.fill();

  const b = game.ball;
  if (!reducedMotion.matches) {
    trail.forEach((t, i) => {
      ctx.globalAlpha = ((i + 1) / (trail.length + 1)) * 0.3;
      dot(t.x, t.y, BALL.r);
    });
    ctx.globalAlpha = 1;
  }
  if (!game.over) dot(b.x, b.y, BALL.r);

  particles.draw(ctx);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (banner.time > 0) {
    ctx.globalAlpha = Math.min(1, banner.time * 2);
    ctx.fillStyle = colors.ink;
    ctx.font = 'bold 48px ui-monospace, Menlo, monospace';
    ctx.fillText(banner.text, W / 2, H * 0.58);
    ctx.globalAlpha = 1;
  }
  if (state === 'playing' && game.stuck) {
    ctx.fillStyle = colors.dim;
    ctx.font = '18px ui-monospace, Menlo, monospace';
    ctx.fillText('Space, tap or (A) to launch', W / 2, H * 0.7);
  }
}

function drawHud() {
  ctx.fillStyle = colors.ink;
  ctx.globalAlpha = 0.5;
  ctx.font = 'bold 22px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(String(game.score).padStart(5, '0'), 40, 40);
  ctx.textAlign = 'center';
  ctx.fillText(`LEVEL ${game.level}`, W / 2, 40);
  // Lives left, as little paddles. The one in play doesn't count.
  for (let i = 0; i < LIVES; i++) {
    ctx.globalAlpha = i < game.lives - 1 ? 0.5 : 0.12;
    ctx.beginPath();
    ctx.roundRect(W - 40 - (i + 1) * 34 + 4, 36, 28, 8, 4);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawBricks() {
  for (const brick of game.bricks) {
    if (!brick || brick.hits <= 0) continue;
    const x = brick.x + 2;
    const y = brick.y + 2;
    const w = brick.w - 4;
    const h = brick.h - 4;
    ctx.fillStyle = ROW_COLORS[brick.row % ROW_COLORS.length];
    ctx.globalAlpha = brick.max > 1 && brick.hits < brick.max ? 0.55 + 0.45 * (brick.hits / brick.max) : 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 3);
    ctx.fill();
    // One inset outline per extra hit the brick can still take.
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = colors.field;
    ctx.lineWidth = 2;
    for (let i = 1; i < brick.hits; i++) {
      ctx.strokeRect(x + i * 4, y + i * 4, w - i * 8, h - i * 8);
    }
    ctx.globalAlpha = 1;
  }
}

function dot(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// --- main loop ---------------------------------------------------------------

let last = performance.now();
let acc = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  handleGamepad(input.poll());

  if (state === 'playing') {
    acc += dt;
    while (acc >= STEP) {
      acc -= STEP;
      const intent = { ...input.read(0), launch: launchQueued };
      launchQueued = false;
      for (const event of step(game, STEP, intent)) effects[event.type](event);
      if (game.over) {
        finish();
        break;
      }
    }
    banner.time = Math.max(0, banner.time - dt);
    trail.push({ x: game.ball.x, y: game.ball.y });
    if (trail.length > TRAIL || game.stuck) trail.shift();
  } else {
    acc = 0;
  }

  particles.update(state === 'paused' ? 0 : dt, { ...game.ball, r: BALL.r });
  draw();
  requestAnimationFrame(frame);
}

renderStatus();
renderBest();
openDialog(menu);
requestAnimationFrame(frame);
