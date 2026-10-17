// Snake simulation. Pure state and rules on a grid: no DOM, so it can run under Node for tests.
// Positions are whole cells ({ x, y }, origin top left); time is in seconds.

export const COLS = 24;
export const ROWS = 16;

const START_LENGTH = 4;
const SPEED = { start: 0.16, min: 0.065, factor: 0.97 }; // seconds per move, shrinks with every bite
const QUEUE = 3; // turns that can be typed ahead of the snake

export const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

// `random` is injectable so tests can place food deterministically.
export function createGame({ cols = COLS, rows = ROWS, random = Math.random } = {}) {
  const x = Math.floor(cols / 3);
  const y = Math.floor(rows / 2);
  const snake = Array.from({ length: START_LENGTH }, (_, i) => ({ x: x - i, y }));
  const game = {
    cols, rows, random,
    snake, // head first
    prevTail: { x: x - START_LENGTH, y }, // where the tail was before the last move, null if it grew
    dir: 'right', // direction of the last move
    queue: [], // turns waiting for the next moves
    food: null,
    score: 0,
    interval: SPEED.start,
    timer: 0, // time since the last move
    ticks: 0,
    over: false,
    won: false,
  };
  game.food = placeFood(game);
  return game;
}

// Queues a turn. Turns are checked against the last queued direction, so a quick
// "up, left" while heading right both register, but "left" alone (a reversal) doesn't.
export function turn(game, dir) {
  if (game.over || !(dir in DIRS) || game.queue.length >= QUEUE) return false;
  const last = game.queue.at(-1) ?? game.dir;
  if (dir === last || dir === OPPOSITE[last]) return false;
  game.queue.push(dir);
  return true;
}

// Accumulates time and moves once per interval, so speed doesn't depend on frame
// rate. Returns the events that happened, for sound and haptics:
// 'turn' | 'eat' | 'die' | 'win'.
export function step(game, dt) {
  const events = [];
  game.timer += dt;
  while (!game.over && game.timer >= game.interval) {
    game.timer -= game.interval;
    events.push(...tick(game));
  }
  return events;
}

// How far (0..1) the snake is between its previous and current cells, for drawing.
export function progress(game) {
  return game.over ? 1 : Math.min(1, game.timer / game.interval);
}

// One move of the snake.
export function tick(game) {
  const events = [];
  if (game.over) return events;

  const next = game.queue.shift();
  if (next) {
    game.dir = next;
    events.push('turn');
  }
  const v = DIRS[game.dir];
  const head = { x: game.snake[0].x + v.x, y: game.snake[0].y + v.y };
  const eating = game.food !== null && same(head, game.food);

  // The tail moves out of the way this tick unless the snake grows, so chasing
  // your own tail closely is allowed.
  const body = eating ? game.snake : game.snake.slice(0, -1);
  if (!inside(game, head) || body.some((s) => same(s, head))) {
    game.over = true;
    game.queue = [];
    events.push('die');
    return events;
  }

  game.snake.unshift(head);
  game.prevTail = eating ? null : game.snake.pop();
  game.ticks++;

  if (eating) {
    game.score++;
    game.interval = Math.max(SPEED.min, game.interval * SPEED.factor);
    game.food = placeFood(game);
    events.push('eat');
    if (game.food === null) {
      game.over = true;
      game.won = true;
      events.push('win');
    }
  }
  return events;
}

// A random free cell, or null when the snake fills the board.
export function placeFood(game) {
  const taken = new Set(game.snake.map((s) => s.y * game.cols + s.x));
  const free = [];
  for (let i = 0; i < game.cols * game.rows; i++) if (!taken.has(i)) free.push(i);
  if (!free.length) return null;
  const i = free[Math.floor(game.random() * free.length)];
  return { x: i % game.cols, y: Math.floor(i / game.cols) };
}

function inside(game, p) {
  return p.x >= 0 && p.y >= 0 && p.x < game.cols && p.y < game.rows;
}

function same(a, b) {
  return a.x === b.x && a.y === b.y;
}
