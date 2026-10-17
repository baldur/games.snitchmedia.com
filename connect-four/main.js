import { COLS, ROWS, at, createGame, drop, canDrop, other } from './game.js';
import { BUTTON } from '../shared/input.js';
import { tone, isMuted, setMuted } from '../shared/audio.js';
import { reducedMotion } from '../shared/canvas.js';
import { openDialog, gamepadDialogs, soundToggle } from '../shared/dialogs.js';

const NAMES = { 1: 'Red', 2: 'Yellow' };
const HUMAN = 1; // against the computer you are always red
const MIN_THINK = 450; // ms; an instant reply feels abrupt, so the computer pauses at least this long
const STICK = 0.5; // how far a stick has to tilt to count as a d-pad press

const board = document.getElementById('board');
const status = document.getElementById('status');
const menu = document.getElementById('menu');
const over = document.getElementById('over');
const result = document.getElementById('result');
const players = [...document.querySelectorAll('.player')];

const worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });

let game = createGame();
let level = null; // 'easy' | 'medium' | 'hard', or null for two players
let first = 1;
let state = 'menu'; // 'menu' | 'turn' | 'dropping' | 'thinking' | 'over'
let session = 0; // bumped on every new game, so stale animations and replies are dropped
let selected = Math.floor(COLS / 2);
let previewing = false; // whether the landing preview is shown (hover, focus, keys, gamepad)
let source = 'mouse'; // what made the last move: 'mouse' | 'touch' | 'pen' | 'key' | 'pad'
let pad = null; // the gamepad used last, for rumble
const discs = new Map(); // cell index -> disc element

const sounds = {
  drop: (row) => tone({ freq: 260 - row * 18, to: 90, duration: 0.12, type: 'triangle', gain: 0.25 }),
  full: () => tone({ freq: 110, duration: 0.08, gain: 0.08 }),
  win: () => [523, 659, 784, 1047].forEach((freq, i) => {
    setTimeout(() => tone({ freq, duration: 0.18, type: 'triangle', gain: 0.18 }), i * 110);
  }),
  lose: () => tone({ freq: 440, to: 140, duration: 0.6, type: 'sawtooth', gain: 0.08 }),
  draw: () => tone({ freq: 392, to: 262, duration: 0.45, type: 'triangle', gain: 0.15 }),
};

// --- board -------------------------------------------------------------------

const columns = Array.from({ length: COLS }, (_, col) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'col';
  button.dataset.col = col;
  board.append(button);
  return button;
});
const ghost = document.createElement('span');

const cpuTurn = () => level !== null && game.turn !== HUMAN;
const nameOf = (player) => (level === null ? NAMES[player] : player === HUMAN ? 'You' : 'The computer');

function render() {
  const turn = state === 'turn' || state === 'thinking' || state === 'dropping';
  columns.forEach((button, col) => {
    const free = ROWS - game.heights[col];
    button.setAttribute('aria-label', `Column ${col + 1}, ${free ? `${free} of ${ROWS} free` : 'full'}`);
    button.setAttribute('aria-disabled', String(!free));
    button.tabIndex = col === selected ? 0 : -1;
    button.classList.toggle('selected', previewing && col === selected && state === 'turn');
  });
  players.forEach((li, i) => {
    const player = i + 1;
    li.classList.toggle('active', turn && game.turn === player);
    li.classList.toggle('thinking', state === 'thinking' && game.turn === player);
    li.classList.toggle('won', game.winner === player);
    li.querySelector('small').textContent = level === null ? `Player ${player}`
      : player === HUMAN ? 'You' : state === 'thinking' ? 'Thinking' : 'Computer';
  });
  board.classList.toggle('over', game.winner !== 0);

  // The preview: a faint disc where the current player's next disc would land.
  if (state === 'turn' && previewing && canDrop(game, selected)) {
    ghost.className = `disc ghost p${game.turn}`;
    ghost.style.gridRow = ROWS - game.heights[selected];
    columns[selected].append(ghost);
  } else {
    ghost.remove();
  }
}

function select(col, { focus = false } = {}) {
  selected = Math.max(0, Math.min(COLS - 1, col));
  previewing = true;
  if (focus) columns[selected].focus();
  render();
}

function clearBoard() {
  for (const disc of discs.values()) disc.remove();
  discs.clear();
}

// Adds the disc for a move and lets it fall into place. Resolves once it has landed.
async function placeDisc({ col, row, player }) {
  const disc = document.createElement('span');
  disc.className = `disc p${player}`;
  disc.style.gridRow = ROWS - row;
  columns[col].append(disc);
  discs.set(at(col, row), disc);
  if (reducedMotion.matches) {
    sounds.drop(row);
    return;
  }

  // Fall from just above the column, a little faster than real gravity, with one small bounce.
  const fall = disc.offsetTop + disc.offsetHeight;
  const duration = 180 + Math.sqrt(ROWS - row) * 110;
  const bounce = disc.offsetHeight * 0.15;
  const animation = disc.animate([
    { transform: `translateY(${-fall}px)`, easing: 'cubic-bezier(0.55, 0, 1, 0.45)' },
    { transform: 'translateY(0)', offset: 0.72, easing: 'ease-out' },
    { transform: `translateY(${-bounce}px)`, offset: 0.86, easing: 'ease-in' },
    { transform: 'translateY(0)' },
  ], { duration });
  setTimeout(() => sounds.drop(row), duration * 0.72);
  await animation.finished.catch(() => {});
}

// --- game flow ---------------------------------------------------------------

function start(choice) {
  session++;
  level = choice === '2' ? null : choice;
  game = createGame({ first });
  first = other(first); // whoever went second starts the next game
  clearBoard();
  state = 'turn';
  previewing = false;
  selected = Math.floor(COLS / 2);
  render();
  announceTurn();
  nextTurn();
}

function announceTurn(prefix = '') {
  const who = level === null ? `${NAMES[game.turn]} to play.`
    : cpuTurn() ? 'The computer is thinking…' : 'Your turn.';
  status.textContent = `${prefix}${who}`;
}

async function tryMove(col, from) {
  if (state !== 'turn' || cpuTurn()) return;
  if (!canDrop(game, col)) {
    sounds.full();
    status.textContent = `Column ${col + 1} is full.`;
    return;
  }
  source = from;
  if (from === 'touch') navigator.vibrate?.(15);
  if (from === 'pad') {
    pad?.vibrationActuator?.playEffect('dual-rumble', { duration: 40, strongMagnitude: 0.4, weakMagnitude: 0.3 }).catch(() => {});
  }
  if (from === 'touch' || from === 'mouse' || from === 'pen') selected = col;
  if (from === 'touch') previewing = false; // no hover on touch, so no preview either
  await play(col);
}

async function play(col) {
  const token = session;
  const move = drop(game, col);
  state = 'dropping';
  render();
  await placeDisc(move);
  if (token !== session) return;

  const who = level === null ? NAMES[move.player] : move.player === HUMAN ? 'You' : 'The computer';
  const played = `${who} dropped ${level === null ? 'a disc ' : ''}in column ${col + 1}. `;
  if (move.events.includes('win')) return finish(played);
  if (move.events.includes('draw')) return finish(played);
  state = 'turn';
  render();
  announceTurn(played);
  nextTurn();
}

let request = 0;
let askedAt = 0;

function nextTurn() {
  if (!cpuTurn()) return;
  state = 'thinking';
  render();
  askedAt = performance.now();
  worker.postMessage({
    id: ++request,
    game: { cells: game.cells, heights: game.heights, turn: game.turn },
    level,
  });
}

worker.addEventListener('message', ({ data: { id, col } }) => {
  if (id !== request || state !== 'thinking') return;
  const token = session;
  setTimeout(() => {
    if (token === session && state === 'thinking') play(col);
  }, Math.max(0, MIN_THINK - (performance.now() - askedAt)));
});
worker.addEventListener('error', () => {
  status.textContent = 'The computer player failed to load.';
});

function finish(played) {
  state = 'over';
  const token = session;
  for (const { col, row } of game.line) discs.get(at(col, row))?.classList.add('win');
  render();

  let text;
  if (game.draw) {
    text = 'It’s a draw';
    sounds.draw();
  } else if (level === null) {
    text = `${NAMES[game.winner]} wins!`;
    sounds.win();
  } else {
    text = game.winner === HUMAN ? 'You win!' : 'The computer wins';
    (game.winner === HUMAN ? sounds.win : sounds.lose)();
  }
  status.textContent = `${played}${text}${text.endsWith('!') ? '' : '.'}`;
  result.textContent = text;
  // Leave a moment to see the winning four before the dialog covers the board.
  setTimeout(() => { if (token === session && state === 'over') openDialog(over); }, reducedMotion.matches ? 600 : 1400);
}

function toMenu() {
  openDialog(menu);
}

menu.addEventListener('cancel', (e) => {
  if (state === 'menu') e.preventDefault(); // nothing to go back to yet
});
menu.addEventListener('close', () => {
  if (menu.returnValue) start(menu.returnValue);
});
over.addEventListener('close', () => {
  if (over.returnValue === 'again') start(level ?? '2');
  else if (over.returnValue === 'menu') toMenu();
  else status.textContent += ' Press New game to play again.'; // Escape: stay and look at the board
});

document.getElementById('new').addEventListener('click', toMenu);
soundToggle(document.getElementById('sound'), { isMuted, setMuted });

// --- input -------------------------------------------------------------------

board.addEventListener('pointerdown', (e) => { source = e.pointerType || 'mouse'; });
board.addEventListener('click', (e) => {
  const button = e.target.closest('.col');
  // A click with no pointer behind it (detail 0) came from Enter, Space or a screen reader.
  if (button) tryMove(Number(button.dataset.col), e.detail === 0 ? 'key' : source);
});
board.addEventListener('pointermove', (e) => {
  const button = e.target.closest('.col');
  if (e.pointerType !== 'mouse' || !button) return;
  const col = Number(button.dataset.col);
  if (col !== selected || !previewing) select(col);
});
board.addEventListener('pointerleave', (e) => {
  if (e.pointerType !== 'mouse' || board.contains(document.activeElement)) return;
  previewing = false;
  render();
});
board.addEventListener('focusin', (e) => {
  const button = e.target.closest('.col');
  if (button) select(Number(button.dataset.col));
});
board.addEventListener('focusout', (e) => {
  if (board.contains(e.relatedTarget)) return;
  previewing = false;
  render();
});

addEventListener('keydown', (e) => {
  if (menu.open || over.open || e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key;
  if (key === 'Escape') {
    e.preventDefault(); // keep this Escape from also closing the dialog it opens
    toMenu();
  } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
    e.preventDefault();
    select(selected + (key === 'ArrowLeft' ? -1 : 1), { focus: true });
  } else if (key === 'Home' || key === 'End') {
    e.preventDefault();
    select(key === 'Home' ? 0 : COLS - 1, { focus: true });
  } else if (/^[1-9]$/.test(key) && Number(key) <= COLS) {
    if (e.repeat) return;
    select(Number(key) - 1, { focus: true });
    tryMove(selected, 'key');
  } else if (key === 'ArrowDown' || ((key === 'Enter' || key === ' ') && e.target === document.body)) {
    // On a focused column Enter and Space are left to the button, which clicks.
    e.preventDefault();
    if (!e.repeat) tryMove(selected, 'key');
  }
});

// Gamepads are polled every frame; a button counts once, on the frame it goes down.
// Tilting a stick past STICK counts as a d-pad press, so either can pick a column.
const held = new Map(); // gamepad index -> pressed[] (with the stick as two extra buttons)

function pollGamepads() {
  const pressed = new Set();
  for (const p of navigator.getGamepads?.() ?? []) {
    if (!p) continue;
    const x = p.axes[0] ?? 0;
    const now = [...p.buttons.map((b) => b.pressed), x < -STICK, x > STICK];
    const prev = held.get(p.index) ?? [];
    now.forEach((down, i) => {
      if (!down || prev[i]) return;
      pressed.add(i === p.buttons.length ? BUTTON.LEFT : i === p.buttons.length + 1 ? BUTTON.RIGHT : i);
      pad = p;
    });
    held.set(p.index, now);
  }
  return pressed;
}

function frame() {
  const pressed = pollGamepads();
  if (pressed.size && !gamepadDialogs([menu, over], pressed)) {
    if (pressed.has(BUTTON.START)) toMenu();
    if (pressed.has(BUTTON.LEFT)) select(selected - 1);
    if (pressed.has(BUTTON.RIGHT)) select(selected + 1);
    if (pressed.has(BUTTON.A) || pressed.has(BUTTON.DOWN)) tryMove(selected, 'pad');
  }
  requestAnimationFrame(frame);
}

render();
openDialog(menu);
requestAnimationFrame(frame);
