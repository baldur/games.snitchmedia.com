// Bricks simulation. Pure state and maths: no DOM, so it can run under Node for tests.
// Units are field units on an 800x600 field; time is in seconds.

export const W = 800;
export const H = 600;
export const LIVES = 3;
export const COLS = 12;

export const BRICK = { w: 60, h: 24, top: 84, left: (W - COLS * 60) / 2 };
export const PADDLE = { w: 104, h: 14, y: H - 44, speed: 720, chase: 2400 };
export const BALL = { r: 7, speed: 380, levelUp: 35, speedup: 1.012, max: 900 };
const MAX_ANGLE = Math.PI / 3; // bounce angle from vertical at the very tip of the paddle
const LAUNCH_ANGLE = 0.3;
const MAX_BOUNCES = 8; // collisions resolved per step before the rest of the move is dropped
const CLEAR_BONUS = 100;
const EPS = 1e-9;

// One string per row, COLS wide. '.' is empty, a digit is how many hits the brick takes.
// After the last layout the game loops back to the first, with a faster ball.
export const LEVELS = [
  [
    '222222222222',
    '111111111111',
    '111111111111',
    '111111111111',
    '111111111111',
    '111111111111',
  ],
  [
    '.....22.....',
    '....2112....',
    '...211112...',
    '..21111112..',
    '.2111111112.',
    '211111111112',
  ],
  [
    '..1......1..',
    '...1....1...',
    '..22222222..',
    '.22.2222.22.',
    '222222222222',
    '2.22222222.2',
    '2.2......2.2',
    '...33..33...',
  ],
  [
    '333333333333',
    '3..........3',
    '3.11111111.3',
    '3.12222221.3',
    '3.11111111.3',
    '3..........3',
    '3333....3333',
  ],
];

// levels: layouts to play, LEVELS unless a test wants something smaller.
export function createGame({ levels = LEVELS } = {}) {
  const game = {
    levels,
    level: 1,
    score: 0,
    lives: LIVES,
    paddle: { x: W / 2 },
    ball: { x: W / 2, y: 0, vx: 0, vy: 0 },
    stuck: true, // ball rides on the paddle until launched
    speed: BALL.speed,
    rows: 0,
    bricks: [],
    over: false,
  };
  loadLevel(game);
  return game;
}

// intent: { axis, target, launch } from the input layer. Returns the events that
// happened, for sound, haptics and particles. Each is { type } plus details:
// 'launch' | 'paddle' | 'wall' | 'crack' (brick) | 'brick' (brick) | 'clear' | 'lost' | 'over'.
export function step(game, dt, intent) {
  const events = [];
  if (game.over) return events;

  movePaddle(game.paddle, intent, dt);
  if (game.stuck) {
    stickToPaddle(game);
    if (intent.launch) launch(game, events);
    return events;
  }

  moveBall(game, dt, events);
  if (!game.stuck && game.ball.y - BALL.r > H) loseLife(game, events);
  return events;
}

export function brickAt(game, row, col) {
  if (row < 0 || row >= game.rows || col < 0 || col >= COLS) return null;
  const brick = game.bricks[row * COLS + col];
  return brick && brick.hits > 0 ? brick : null;
}

export function bricksLeft(game) {
  return game.bricks.filter((b) => b && b.hits > 0).length;
}

function loadLevel(game) {
  const layout = game.levels[(game.level - 1) % game.levels.length];
  game.rows = layout.length;
  game.bricks = [];
  layout.forEach((line, row) => {
    for (let col = 0; col < COLS; col++) {
      const hits = Number(line[col]) || 0;
      game.bricks.push(hits ? {
        row, col, hits, max: hits,
        x: BRICK.left + col * BRICK.w,
        y: BRICK.top + row * BRICK.h,
        w: BRICK.w,
        h: BRICK.h,
      } : null);
    }
  });
  resetBall(game);
}

function baseSpeed(game) {
  return Math.min(BALL.max, BALL.speed + (game.level - 1) * BALL.levelUp);
}

function resetBall(game) {
  game.stuck = true;
  game.speed = baseSpeed(game);
  stickToPaddle(game);
}

function stickToPaddle(game) {
  Object.assign(game.ball, { x: game.paddle.x, y: PADDLE.y - BALL.r, vx: 0, vy: 0 });
}

function launch(game, events) {
  const angle = (Math.random() * 2 - 1) * LAUNCH_ANGLE;
  game.ball.vx = Math.sin(angle) * game.speed;
  game.ball.vy = -Math.cos(angle) * game.speed;
  game.stuck = false;
  events.push({ type: 'launch' });
}

function loseLife(game, events) {
  game.lives--;
  events.push({ type: 'lost' });
  if (game.lives <= 0) {
    game.over = true;
    events.push({ type: 'over' });
  } else {
    resetBall(game);
  }
}

// Swept movement: find the earliest thing the ball touches along this step's path,
// move to it, bounce, and carry on with what's left of the step. However fast the
// ball goes it can't skip over a brick, because nothing is sampled, only intersected.
function moveBall(game, dt, events) {
  const b = game.ball;
  let left = 1; // fraction of this step still to travel
  for (let i = 0; i < MAX_BOUNCES && left > 0; i++) {
    const dx = b.vx * dt * left;
    const dy = b.vy * dt * left;
    const hit = firstHit(game, b.x, b.y, dx, dy);
    if (!hit) {
      b.x += dx;
      b.y += dy;
      return;
    }
    b.x += dx * hit.t;
    b.y += dy * hit.t;
    left *= 1 - hit.t;

    if (hit.paddle) {
      bounceOffPaddle(game);
      events.push({ type: 'paddle' });
      continue;
    }
    if (hit.nx && b.vx * hit.nx < 0) b.vx = -b.vx;
    if (hit.ny && b.vy * hit.ny < 0) b.vy = -b.vy;
    if (!hit.brick) {
      events.push({ type: 'wall' });
      continue;
    }
    if (hitBrick(game, hit.brick, events)) return; // level cleared, ball is back on the paddle
  }
}

// Returns true when that was the last brick of the level.
function hitBrick(game, brick, events) {
  brick.hits--;
  setSpeed(game, game.speed * BALL.speedup);
  if (brick.hits > 0) {
    events.push({ type: 'crack', brick });
    return false;
  }
  game.score += 10 * brick.max;
  events.push({ type: 'brick', brick });
  if (bricksLeft(game) > 0) return false;

  game.score += CLEAR_BONUS * game.level;
  game.level++;
  events.push({ type: 'clear' });
  loadLevel(game);
  return true;
}

function setSpeed(game, speed) {
  const b = game.ball;
  const scale = Math.min(speed, BALL.max) / Math.hypot(b.vx, b.vy);
  game.speed = Math.min(speed, BALL.max);
  b.vx *= scale;
  b.vy *= scale;
}

// Where on the paddle the ball lands sets the outgoing angle, like Pong.
function bounceOffPaddle(game) {
  const b = game.ball;
  const reach = PADDLE.w / 2 + BALL.r;
  const offset = Math.max(-1, Math.min(1, (b.x - game.paddle.x) / reach));
  const angle = offset * MAX_ANGLE;
  b.vx = Math.sin(angle) * game.speed;
  b.vy = -Math.cos(angle) * game.speed;
}

// Earliest contact along (dx, dy) as { t (0..1), nx, ny, brick?, paddle? }, or null.
// The ball is treated as a point against walls and boxes grown by its radius.
function firstHit(game, x, y, dx, dy) {
  const r = BALL.r;
  let best = null;
  const consider = (hit) => { if (hit && (!best || hit.t < best.t)) best = hit; };

  if (dx < 0 && x + dx < r) consider({ t: clamp01((r - x) / dx), nx: 1, ny: 0 });
  if (dx > 0 && x + dx > W - r) consider({ t: clamp01((W - r - x) / dx), nx: -1, ny: 0 });
  if (dy < 0 && y + dy < r) consider({ t: clamp01((r - y) / dy), nx: 0, ny: 1 });

  // Only the paddle's top face matters: once the ball is below it, it's lost.
  const face = PADDLE.y - r;
  if (dy > 0 && y <= face + EPS && y + dy >= face) {
    const t = clamp01((face - y) / dy);
    if (Math.abs(x + dx * t - game.paddle.x) <= PADDLE.w / 2 + r) consider({ t, paddle: true });
  }

  const minX = Math.min(x, x + dx) - r;
  const maxX = Math.max(x, x + dx) + r;
  const minY = Math.min(y, y + dy) - r;
  const maxY = Math.max(y, y + dy) + r;
  for (const brick of game.bricks) {
    if (!brick || brick.hits <= 0) continue;
    if (brick.x > maxX || brick.x + brick.w < minX || brick.y > maxY || brick.y + brick.h < minY) continue;
    const hit = sweepBox(x, y, dx, dy, brick.x - r, brick.y - r, brick.x + brick.w + r, brick.y + brick.h + r);
    if (hit) consider(solidFace(game, brick, hit, dy));
  }
  return best;
}

// Slab test of a moving point against a box. Only entering hits count, so a ball
// that's touching a box and moving away from it is free to go.
function sweepBox(x, y, dx, dy, x0, y0, x1, y1) {
  const [txIn, txOut] = slab(x, dx, x0, x1);
  const [tyIn, tyOut] = slab(y, dy, y0, y1);
  const tIn = Math.max(txIn, tyIn);
  const tOut = Math.min(txOut, tyOut);
  if (tIn >= tOut || tIn < -EPS || tIn > 1) return null;
  return {
    t: Math.max(0, tIn),
    nx: txIn >= tyIn - EPS ? (dx > 0 ? -1 : 1) : 0,
    ny: tyIn >= txIn - EPS ? (dy > 0 ? -1 : 1) : 0,
  };
}

function slab(p, d, lo, hi) {
  if (d === 0) return p > lo && p < hi ? [-Infinity, Infinity] : [Infinity, -Infinity];
  const a = (lo - p) / d;
  const b = (hi - p) / d;
  return a < b ? [a, b] : [b, a];
}

// A side shared with a neighbouring brick can't really be hit (the ball would have
// to come from inside the neighbour), so a hit there is a top or bottom hit.
function solidFace(game, brick, hit, dy) {
  if (hit.nx && brickAt(game, brick.row, brick.col + hit.nx)) {
    hit.nx = 0;
    hit.ny = dy > 0 ? -1 : 1;
  }
  if (hit.ny && hit.nx && brickAt(game, brick.row + hit.ny, brick.col)) hit.ny = 0;
  hit.brick = brick;
  return hit;
}

function movePaddle(p, intent, dt) {
  if (intent.target !== null) {
    const max = PADDLE.chase * dt;
    p.x += Math.max(-max, Math.min(max, intent.target - p.x));
  } else {
    p.x += intent.axis * PADDLE.speed * dt;
  }
  p.x = Math.max(PADDLE.w / 2, Math.min(W - PADDLE.w / 2, p.x));
}

function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}
