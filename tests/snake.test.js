import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, tick, turn, progress } from '../snake/game.js';
import { chooseDir, findPath } from '../snake/ai.js';

// A game with a hand-placed snake (head first) and food, heading right.
function setup(snake, food = null, { cols = 10, rows = 8 } = {}) {
  const game = createGame({ cols, rows });
  game.snake = snake.map(([x, y]) => ({ x, y }));
  game.food = food && { x: food[0], y: food[1] };
  return game;
}

const cells = (game) => game.snake.map((s) => [s.x, s.y]);

test('the snake moves one cell per interval, whatever the frame rate', () => {
  const game = setup([[3, 2], [2, 2], [1, 2]]);
  const interval = game.interval;
  for (let t = 0; t < interval * 0.9; t += 1 / 240) step(game, 1 / 240);
  assert.deepEqual(cells(game), [[3, 2], [2, 2], [1, 2]], 'no move before a full interval');
  assert.ok(progress(game) > 0.8 && progress(game) < 1);
  step(game, interval * 0.2);
  assert.deepEqual(cells(game), [[4, 2], [3, 2], [2, 2]]);
  step(game, interval * 2);
  assert.equal(game.snake[0].x, 6, 'a long frame catches up with every missed move');
});

test('eating grows the snake, scores, speeds up and moves the food', () => {
  const game = setup([[3, 2], [2, 2], [1, 2]], [4, 2]);
  const interval = game.interval;
  assert.deepEqual(tick(game), ['eat']);
  assert.deepEqual(cells(game), [[4, 2], [3, 2], [2, 2], [1, 2]]);
  assert.equal(game.score, 1);
  assert.ok(game.interval < interval);
  assert.equal(game.prevTail, null, 'the tail stayed put');
  assert.ok(!game.snake.some((s) => s.x === game.food.x && s.y === game.food.y), 'new food is on a free cell');
  tick(game);
  assert.equal(game.snake.length, 4, 'grows by one per bite');
});

test('hitting a wall ends the game', () => {
  const game = setup([[9, 2], [8, 2], [7, 2]]);
  assert.deepEqual(tick(game), ['die']);
  assert.ok(game.over);
  assert.deepEqual(cells(game), [[9, 2], [8, 2], [7, 2]], 'the snake stops where it crashed');
  assert.deepEqual(step(game, 10), [], 'nothing happens after death');
});

test('running into its own body ends the game, but following the tail is fine', () => {
  // A loop: heading up from (2,3) into (2,2), which is part of the body.
  const crash = setup([[2, 3], [3, 3], [3, 2], [2, 2], [1, 2]]);
  crash.dir = 'left';
  turn(crash, 'up');
  assert.deepEqual(tick(crash), ['turn', 'die']);

  // A tight square where the head moves into the cell the tail is leaving.
  const chase = setup([[2, 3], [3, 3], [3, 2], [2, 2]]);
  chase.dir = 'left';
  turn(chase, 'up');
  assert.deepEqual(tick(chase), ['turn']);
  assert.ok(!chase.over);
});

test('the snake cannot reverse into itself', () => {
  const game = setup([[3, 2], [2, 2], [1, 2]]);
  assert.equal(turn(game, 'left'), false);
  assert.equal(turn(game, 'right'), false, 'same direction is a no-op');
  tick(game);
  assert.equal(game.dir, 'right');
  assert.ok(!game.over);
});

test('quick double turns are queued and applied one per move', () => {
  const game = setup([[3, 2], [2, 2], [1, 2]]);
  assert.ok(turn(game, 'up'));
  assert.ok(turn(game, 'left'), 'checked against the queued turn, not the current direction');
  assert.equal(turn(game, 'right'), false, 'reversing the queued turn is rejected');
  tick(game);
  assert.deepEqual(cells(game)[0], [3, 1]);
  tick(game);
  assert.deepEqual(cells(game)[0], [2, 1]);
  assert.equal(game.dir, 'left');
});

test('the input queue is bounded', () => {
  const game = setup([[3, 2], [2, 2], [1, 2]]);
  assert.ok(turn(game, 'up'));
  assert.ok(turn(game, 'left'));
  assert.ok(turn(game, 'down'));
  assert.equal(turn(game, 'right'), false);
});

test('filling the board wins', () => {
  const game = setup([[1, 0], [0, 0], [0, 1]], [1, 1], { cols: 2, rows: 2 });
  turn(game, 'down');
  assert.deepEqual(tick(game), ['turn', 'eat', 'win']);
  assert.ok(game.won && game.over);
});

test('the pathfinder finds the food around the body', () => {
  // Snake lying across the middle, food on the other side of it.
  const snake = [[5, 3], [4, 3], [3, 3], [2, 3], [1, 3], [0, 3]].map(([x, y]) => ({ x, y }));
  const path = findPath({ cols: 8, rows: 6 }, snake, { x: 2, y: 4 });
  assert.ok(path);
  assert.deepEqual(path.at(-1), { x: 2, y: 4 });
  for (const p of path) {
    assert.ok(p.x >= 0 && p.y >= 0 && p.x < 8 && p.y < 6, 'stays on the board');
  }
});

test('the pathfinder never steers into a wall', () => {
  // Head in the top-right corner going right: only down (or left, the neck) remains.
  const state = {
    cols: 6, rows: 6, dir: 'right', food: { x: 0, y: 0 },
    snake: [[5, 0], [4, 0], [3, 0]].map(([x, y]) => ({ x, y })),
  };
  assert.equal(chooseDir(state), 'down');
});

test('the demo AI plays well: it eats a lot and never crashes', () => {
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const game = createGame({ cols: 12, rows: 8, random });
  for (let i = 0; i < 20000 && !game.over; i++) {
    turn(game, chooseDir(game));
    tick(game);
  }
  assert.ok(!game.over || game.won, 'only a full board ends its game');
  assert.ok(game.score >= 30, `scored ${game.score}`);
});
