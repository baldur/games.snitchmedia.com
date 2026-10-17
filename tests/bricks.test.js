import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, bricksLeft, W, H, BRICK, PADDLE, BALL, LIVES, LEVELS, COLS } from '../bricks/game.js';

const STEP = 1 / 120;
const idle = { axis: 0, target: null, launch: false };
const launch = { ...idle, launch: true };

const types = (events) => events.map((e) => e.type);

// Puts the ball in flight at (x, y) with the given velocity.
function fire(game, x, y, vx, vy) {
  game.stuck = false;
  Object.assign(game.ball, { x, y, vx, vy });
}

function runUntil(game, type, intent = idle, seconds = 10) {
  const events = [];
  for (let t = 0; t < seconds; t += STEP) {
    events.push(...step(game, STEP, typeof intent === 'function' ? intent(game) : intent));
    if (types(events).includes(type)) return events;
  }
  assert.fail(`no '${type}' event within ${seconds}s`);
}

test('every layout is COLS wide and only uses known characters', () => {
  for (const layout of LEVELS) {
    for (const line of layout) assert.match(line, new RegExp(`^[.1-9]{${COLS}}$`));
  }
});

test('the ball rides the paddle until launched, then goes up', () => {
  const game = createGame();
  for (let i = 0; i < 60; i++) step(game, STEP, { ...idle, axis: 1 });
  assert.ok(game.stuck);
  assert.equal(game.ball.x, game.paddle.x);
  assert.ok(game.paddle.x > W / 2, 'paddle moved right');

  assert.deepEqual(types(step(game, STEP, launch)), ['launch']);
  assert.ok(!game.stuck);
  assert.ok(game.ball.vy < 0);
});

test('a brick breaks and scores', () => {
  const game = createGame({ levels: [['1..........1']] });
  fire(game, BRICK.left + BRICK.w / 2, 300, 0, -400);
  const events = runUntil(game, 'brick');
  const hit = events.find((e) => e.type === 'brick').brick;
  assert.equal(hit.col, 0);
  assert.equal(hit.hits, 0);
  assert.equal(game.score, 10);
  assert.equal(bricksLeft(game), 1);
  assert.ok(game.ball.vy > 0, 'ball bounced back down');
});

test('multi-hit bricks crack before they break', () => {
  const game = createGame({ levels: [['3..........1']] });
  const x = BRICK.left + BRICK.w / 2;
  for (const expected of ['crack', 'crack', 'brick']) {
    fire(game, x, 300, 0, -400);
    assert.deepEqual(types(runUntil(game, expected)), [expected]);
  }
  assert.equal(game.bricks[0].hits, 0);
  assert.equal(game.score, 30, 'a 3-hit brick is worth three times as much');
});

test('missing the ball costs a life, and the last one ends the game', () => {
  const game = createGame();
  for (let life = LIVES; life > 0; life--) {
    fire(game, 20, H - 30, 0, 400);
    game.paddle.x = W - PADDLE.w / 2;
    const events = runUntil(game, 'lost', { ...idle, axis: 1 });
    assert.equal(game.lives, life - 1);
    if (life > 1) {
      assert.ok(game.stuck, 'ball is back on the paddle');
      assert.ok(!types(events).includes('over'));
    } else {
      assert.ok(types(events).includes('over'));
    }
  }
  assert.ok(game.over);
  assert.deepEqual(step(game, STEP, launch), [], 'nothing happens after game over');
});

test('breaking the last brick clears the level and loads the next', () => {
  const levels = [['.....1......'], ['111111111111', '111111111111']];
  const game = createGame({ levels });
  fire(game, BRICK.left + 5.5 * BRICK.w, 300, 0, -400);
  const events = runUntil(game, 'clear');
  assert.deepEqual(types(events), ['brick', 'clear']);
  assert.equal(game.level, 2);
  assert.equal(bricksLeft(game), 24);
  assert.ok(game.stuck);
  assert.equal(game.score, 10 + 100);
  assert.ok(game.speed > BALL.speed, 'later levels start faster');
});

test('layouts loop after the last level', () => {
  const game = createGame({ levels: [['1']] });
  fire(game, BRICK.left + BRICK.w / 2, 300, 0, -400);
  runUntil(game, 'clear');
  assert.equal(game.level, 2);
  assert.equal(bricksLeft(game), 1);
});

test('no tunneling, even far beyond max speed', () => {
  const row = '111111111111';
  const bottom = BRICK.top + BRICK.h;
  for (const speed of [BALL.max, BALL.max * 5, BALL.max * 40]) {
    for (let i = 0; i < 40; i++) {
      const game = createGame({ levels: [[row, '............']] });
      const angle = (i / 39 - 0.5) * 2.2; // up to ~63 degrees either side
      fire(game, 100 + i * 15, bottom + 30, Math.sin(angle) * speed, -Math.cos(angle) * speed);
      let broke = false;
      for (let s = 0; s < 240 && !broke; s++) {
        broke = types(step(game, STEP, idle)).includes('brick');
        if (!broke) assert.ok(game.ball.y - BALL.r >= bottom - 1e-6, `ball got past the wall at speed ${speed}`);
      }
      assert.ok(broke, 'ball hit a brick');
      assert.equal(bricksLeft(game), COLS - 1, 'exactly one brick broke');
      assert.ok(game.ball.vy > 0);
    }
  }
});

test('ball speed is capped', () => {
  const game = createGame();
  game.speed = BALL.max;
  fire(game, BRICK.left + BRICK.w / 2, 400, 0, -BALL.max);
  runUntil(game, 'brick');
  assert.ok(Math.hypot(game.ball.vx, game.ball.vy) <= BALL.max + 1e-6);
});

test('where the ball lands on the paddle sets the bounce angle', () => {
  const bounce = (offset) => {
    const game = createGame({ levels: [['1']] });
    fire(game, game.paddle.x + offset, PADDLE.y - 60, 0, 400);
    runUntil(game, 'paddle');
    return game.ball;
  };
  const centre = bounce(0);
  assert.ok(Math.abs(centre.vx) < 1e-9 && centre.vy < 0, 'centre goes straight up');
  const tip = bounce(PADDLE.w / 2);
  assert.ok(tip.vx > 0 && tip.vx / -tip.vy > 1.2, 'right tip deflects steeply right');
  const otherTip = bounce(-PADDLE.w / 2);
  assert.ok(otherTip.vx < 0, 'left tip deflects left');
});

test('a player who keeps the ball in play clears the first level', () => {
  const game = createGame();
  let t = 0;
  const steer = (g) => ({ axis: 0, target: g.ball.x + Math.sin(t * 0.7) * 40, launch: g.stuck });
  for (; t < 900 && game.level === 1; t += STEP) {
    step(game, STEP, steer(game));
    const b = game.ball;
    assert.ok(b.x >= BALL.r - 1e-6 && b.x <= W - BALL.r + 1e-6, 'ball stays inside the walls');
    assert.ok(b.y >= BALL.r - 1e-6, 'ball stays under the ceiling');
  }
  assert.equal(game.lives, LIVES, 'never missed');
  assert.equal(game.level, 2);
});
