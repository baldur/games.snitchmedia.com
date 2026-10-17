import { createGame, step, W, H, paddleSize, ballSize } from './game.js';
import { Input, BUTTON } from '../shared/input.js';
import { tone, isMuted, setMuted } from '../shared/audio.js';
import { fitCanvas, themeColors, reducedMotion } from '../shared/canvas.js';
import { openDialog, gamepadDialogs, soundToggle } from '../shared/dialogs.js';

const STEP = 1 / 120; // fixed simulation step, independent of display refresh rate
const TRAIL = 6;

const canvas = document.getElementById('field');
const ctx = fitCanvas(canvas, W, H);
const colors = themeColors({ field: '--field', ink: '--field-ink', dim: '--field-dim' });
const menu = document.getElementById('menu');
const paused = document.getElementById('paused');
const over = document.getElementById('over');
const winnerText = document.getElementById('winner');
const status = document.getElementById('status');

const input = new Input(canvas, {
  keys: { KeyW: [0, -1], KeyS: [0, 1], ArrowUp: [1, -1], ArrowDown: [1, 1] },
  axis: 'y',
  length: H,
  sideBy: 'x',
});

let game = createGame({ solo: true });
let state = 'menu'; // 'menu' | 'playing' | 'paused' | 'over'
let trail = [];

const sounds = {
  paddle0: () => tone({ freq: 480, duration: 0.06 }),
  paddle1: () => tone({ freq: 520, duration: 0.06 }),
  wall: () => tone({ freq: 260, duration: 0.05, gain: 0.08 }),
  score0: () => tone({ freq: 660, to: 990, duration: 0.25, type: 'triangle', gain: 0.18 }),
  score1: () => tone({ freq: 660, to: 990, duration: 0.25, type: 'triangle', gain: 0.18 }),
  win: () => tone({ freq: 330, to: 1320, duration: 0.6, type: 'sawtooth', gain: 0.1 }),
};

// --- game flow ---------------------------------------------------------------

function start(solo) {
  game = createGame({ solo });
  trail = [];
  state = 'playing';
  status.textContent = solo ? 'You are the left paddle.' : '';
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  openDialog(paused);
}

function finish() {
  state = 'over';
  const [left, right] = game.paddles;
  winnerText.textContent = game.solo
    ? (game.winner === 0 ? 'You win!' : 'The computer wins')
    : `${game.winner === 0 ? 'Left' : 'Right'} player wins!`;
  winnerText.textContent += ` ${left.score}–${right.score}`;
  openDialog(over);
}

function toMenu() {
  state = 'menu';
  game = createGame({ solo: true });
  status.textContent = '';
  openDialog(menu);
}

menu.addEventListener('cancel', (e) => e.preventDefault()); // nowhere to go back to
menu.addEventListener('close', () => {
  if (menu.returnValue) start(menu.returnValue === '1');
});
paused.addEventListener('close', () => {
  if (paused.returnValue === 'menu') toMenu();
  else state = 'playing'; // Resume button or Escape
});
over.addEventListener('cancel', (e) => e.preventDefault());
over.addEventListener('close', () => {
  if (over.returnValue === 'again') start(game.solo);
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
  status.textContent = `Gamepad connected: ${e.gamepad.id.split('(')[0].trim()}`;
});

function handleGamepad(pressed) {
  if (pressed.has(BUTTON.START) && paused.open) {
    paused.close('resume');
    return;
  }
  if (!gamepadDialogs([menu, paused, over], pressed) && pressed.has(BUTTON.START)) pause();
}

// --- rendering ---------------------------------------------------------------

function draw() {
  ctx.fillStyle = colors.field;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = colors.dim;
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 16]);
  ctx.beginPath();
  ctx.moveTo(W / 2, 8);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = colors.dim;
  ctx.font = `bold 72px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(game.paddles[0].score, W / 4, 28);
  ctx.fillText(game.paddles[1].score, (W * 3) / 4, 28);

  ctx.fillStyle = colors.ink;
  for (const p of game.paddles) {
    ctx.fillRect(p.x, p.y - paddleSize.h / 2, paddleSize.w, paddleSize.h);
  }

  const b = game.ball;
  const s = ballSize;
  if (!reducedMotion.matches) {
    trail.forEach((t, i) => {
      ctx.globalAlpha = ((i + 1) / (trail.length + 1)) * 0.35;
      ctx.fillRect(t.x - s / 2, t.y - s / 2, s, s);
    });
    ctx.globalAlpha = 1;
  }
  // Blink the ball while it waits to be served.
  if (game.serveIn <= 0 || Math.floor(game.serveIn * 6) % 2 === 0) {
    ctx.fillRect(b.x - s / 2, b.y - s / 2, s, s);
  }
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
      const intents = [input.read(0, game.solo), input.read(1, game.solo)];
      for (const event of step(game, STEP, intents)) {
        sounds[event]();
        if (event === 'paddle0') input.rumble(0, game.solo);
        if (event === 'paddle1' && !game.solo) input.rumble(1, false);
        if (event.startsWith('score')) trail = [];
      }
      if (game.winner !== null) {
        finish();
        break;
      }
    }
    trail.push({ x: game.ball.x, y: game.ball.y });
    if (trail.length > TRAIL) trail.shift();
  } else {
    acc = 0;
  }

  draw();
  requestAnimationFrame(frame);
}

openDialog(menu);
requestAnimationFrame(frame);
