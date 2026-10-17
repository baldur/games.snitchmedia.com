import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, H, WIN_SCORE } from '../pong/game.js';

const STEP = 1 / 120;
const idle = { axis: 0, target: null };

function play(leftIntent, seconds = 3600) {
  const game = createGame({ solo: true });
  const events = [];
  for (let t = 0; t < seconds && game.winner === null; t += STEP) {
    events.push(...step(game, STEP, [leftIntent(game), idle]));
    assert.ok(game.ball.y >= 0 && game.ball.y <= H, 'ball stays inside the field');
  }
  return { game, events };
}

test('a paddle that tracks the ball perfectly never concedes', () => {
  const { game } = play((g) => ({ axis: 0, target: g.ball.y }));
  assert.equal(game.winner, 0);
  assert.equal(game.paddles[1].score, 0);
});

test('an idle player loses to the CPU', () => {
  const { game, events } = play(() => idle);
  assert.equal(game.winner, 1);
  assert.equal(game.paddles[1].score, WIN_SCORE);
  assert.equal(events.filter((e) => e === 'win').length, 1);
});

test('edge hits send the ball off at a steep angle', () => {
  const game = createGame({ solo: false });
  game.serveIn = 0;
  Object.assign(game.ball, { x: 60, y: game.paddles[0].y + 40, vx: -400, vy: 0 });
  let events = [];
  while (!events.includes('paddle0')) events = step(game, STEP, [idle, idle]);
  assert.ok(game.ball.vx > 0);
  assert.ok(game.ball.vy / game.ball.vx > 0.8, 'tip of the paddle deflects steeply');
});
