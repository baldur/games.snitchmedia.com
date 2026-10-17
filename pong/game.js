// Pong simulation. Pure state and maths: no DOM, so it can run under Node for tests.
// Units are field units on an 800x500 field; time is in seconds.

export const W = 800;
export const H = 500;
export const WIN_SCORE = 11;

const PADDLE = { w: 12, h: 84, inset: 28, speed: 560, chase: 1600 };
const BALL = { size: 12, serve: 430, max: 1150, speedup: 1.06 };
const MAX_ANGLE = Math.PI * 0.3; // bounce angle at the very tip of a paddle
const SERVE_DELAY = 0.9;
const CPU = { speed: 380, wobble: 0.4 };

export function createGame({ solo }) {
  return {
    solo,
    paddles: [
      { x: PADDLE.inset, y: H / 2, score: 0 },
      { x: W - PADDLE.inset - PADDLE.w, y: H / 2, score: 0 },
    ],
    ball: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
    serveIn: SERVE_DELAY,
    serveDir: Math.random() < 0.5 ? -1 : 1,
    cpuAim: 0,
    winner: null,
  };
}

export const paddleSize = { w: PADDLE.w, h: PADDLE.h };
export const ballSize = BALL.size;

// intents: [{ axis, target }, { axis, target }] from the input layer; the CPU
// replaces the right one in solo games. Returns the events that happened, for
// sound and haptics: 'paddle0' | 'paddle1' | 'wall' | 'score0' | 'score1' | 'win'.
export function step(game, dt, intents) {
  const events = [];
  if (game.winner !== null) return events;

  const right = game.solo ? cpuIntent(game) : intents[1];
  movePaddle(game.paddles[0], intents[0], dt);
  movePaddle(game.paddles[1], right, dt, game.solo ? CPU.speed : PADDLE.speed);

  if (game.serveIn > 0) {
    game.serveIn -= dt;
    if (game.serveIn <= 0) serve(game);
    return events;
  }

  const b = game.ball;
  const r = BALL.size / 2;
  const prevX = b.x;
  const prevY = b.y;
  b.x += b.vx * dt;
  b.y += b.vy * dt;

  if (b.y - r < 0 && b.vy < 0) { b.y = r; b.vy = -b.vy; events.push('wall'); }
  if (b.y + r > H && b.vy > 0) { b.y = H - r; b.vy = -b.vy; events.push('wall'); }

  // Swept test against each paddle's front face, so a fast ball can't tunnel through.
  const [left, rightPaddle] = game.paddles;
  const leftFace = left.x + PADDLE.w;
  const rightFace = rightPaddle.x;
  if (b.vx < 0 && prevX - r >= leftFace && b.x - r < leftFace) {
    const t = (prevX - r - leftFace) / (prevX - b.x);
    if (bounce(game, left, prevY + (b.y - prevY) * t, 1)) {
      b.x = leftFace + r;
      events.push('paddle0');
    }
  } else if (b.vx > 0 && prevX + r <= rightFace && b.x + r > rightFace) {
    const t = (rightFace - prevX - r) / (b.x - prevX);
    if (bounce(game, rightPaddle, prevY + (b.y - prevY) * t, -1)) {
      b.x = rightFace - r;
      events.push('paddle1');
    }
  }

  const scorer = b.x + r < 0 ? 1 : b.x - r > W ? 0 : null;
  if (scorer !== null) {
    const p = game.paddles[scorer];
    p.score++;
    events.push(`score${scorer}`);
    if (p.score >= WIN_SCORE) {
      game.winner = scorer;
      events.push('win');
    }
    // Next serve goes towards the player who just lost the point.
    game.serveDir = scorer === 0 ? 1 : -1;
    game.serveIn = SERVE_DELAY;
    Object.assign(b, { x: W / 2, y: H / 2, vx: 0, vy: 0 });
  }
  return events;
}

function serve(game) {
  const angle = (Math.random() * 2 - 1) * Math.PI * 0.18;
  game.ball.vx = Math.cos(angle) * BALL.serve * game.serveDir;
  game.ball.vy = Math.sin(angle) * BALL.serve;
  game.cpuAim = randomAim();
}

// Where on the paddle the ball lands sets the outgoing angle; every hit speeds it up.
function bounce(game, paddle, hitY, dir) {
  const reach = PADDLE.h / 2 + BALL.size / 2;
  const offset = (hitY - paddle.y) / reach;
  if (Math.abs(offset) > 1) return false;
  const b = game.ball;
  const speed = Math.min(Math.hypot(b.vx, b.vy) * BALL.speedup, BALL.max);
  const angle = offset * MAX_ANGLE;
  b.vx = Math.cos(angle) * speed * dir;
  b.vy = Math.sin(angle) * speed;
  b.y = hitY;
  if (dir === 1) game.cpuAim = randomAim();
  return true;
}

function movePaddle(p, intent, dt, speed = PADDLE.speed) {
  if (intent.target !== null) {
    const max = Math.max(speed, PADDLE.chase) * dt;
    p.y += Math.max(-max, Math.min(max, intent.target - p.y));
  } else {
    p.y += intent.axis * speed * dt;
  }
  p.y = Math.max(PADDLE.h / 2, Math.min(H - PADDLE.h / 2, p.y));
}

// Chases the ball with a capped speed and a deliberate aiming error, picked
// fresh on every return, so it's beatable with steep angles and fast rallies.
function cpuIntent(game) {
  const b = game.ball;
  const p = game.paddles[1];
  const incoming = b.vx > 0 && b.x > W * 0.3;
  const goal = incoming ? b.y + game.cpuAim : H / 2;
  const diff = goal - p.y;
  return { axis: Math.abs(diff) < 6 ? 0 : Math.sign(diff) * Math.min(1, Math.abs(diff) / 40), target: null };
}

function randomAim() {
  return (Math.random() * 2 - 1) * PADDLE.h * CPU.wobble;
}
