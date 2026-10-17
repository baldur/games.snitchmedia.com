import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLS, ROWS, at, createGame, drop, undo, canDrop, legalMoves, isOver } from '../connect-four/game.js';
import { chooseMove, LEVELS } from '../connect-four/ai.js';

// Plays a string of column digits, e.g. '3344', red first. Fails on an illegal move.
function play(moves, game = createGame()) {
  let last = null;
  for (const ch of moves) {
    last = drop(game, Number(ch));
    assert.ok(last, `move ${ch} is legal`);
  }
  return { game, last };
}

// Puts discs, as [col, row, player = 1], straight onto the board along with the
// column heights, for positions that are awkward to reach by playing. Red to move.
function position(cells, heights) {
  const game = createGame();
  for (const [col, row, player = 1] of cells) game.cells[at(col, row)] = player;
  game.heights = heights;
  return game;
}

const cellsOf = (line) => line.map(({ col, row }) => `${col},${row}`).sort();
const steady = () => 0.99; // an rng that never blunders

test('discs stack from the bottom and players alternate', () => {
  const { game } = play('333');
  assert.equal(game.cells[at(3, 0)], 1);
  assert.equal(game.cells[at(3, 1)], 2);
  assert.equal(game.cells[at(3, 2)], 1);
  assert.equal(game.heights[3], 3);
  assert.equal(game.turn, 2);
});

test('a full column refuses more discs', () => {
  const { game } = play('000000');
  assert.equal(canDrop(game, 0), false);
  assert.equal(drop(game, 0), null);
  assert.deepEqual(legalMoves(game), [1, 2, 3, 4, 5, 6]);
  assert.equal(drop(game, 7), null, 'off the board');
  assert.equal(drop(game, -1), null, 'off the board');
  assert.equal(game.turn, 1, 'a refused move does not pass the turn');
});

test('horizontal win, reported with its cells', () => {
  const { game, last } = play('0011223');
  assert.deepEqual(last.events, ['drop', 'win']);
  assert.equal(game.winner, 1);
  assert.deepEqual(cellsOf(game.line), ['0,0', '1,0', '2,0', '3,0']);
  assert.equal(drop(game, 4), null, 'no moves after a win');
});

test('vertical win', () => {
  const { game } = play('0101010');
  assert.equal(game.winner, 1);
  assert.deepEqual(cellsOf(game.line), ['0,0', '0,1', '0,2', '0,3']);
});

test('three in a row is not a win', () => {
  const { game } = play('001122');
  assert.equal(game.winner, 0);
  assert.equal(isOver(game), false);
});

test('rising diagonal win', () => {
  const { game } = play('01122323363');
  assert.equal(game.winner, 1);
  assert.deepEqual(cellsOf(game.line), ['0,0', '1,1', '2,2', '3,3']);
});

test('falling diagonal win', () => {
  const { game } = play('65544343303'); // the rising one mirrored
  assert.equal(game.winner, 1);
  assert.deepEqual(cellsOf(game.line), ['3,3', '4,2', '5,1', '6,0']);
});

test('a diagonal is found when the last disc lands in the middle of it', () => {
  // The 2010 check only scanned diagonals from a few fixed starting cells.
  const { game } = play('01123363322'); // red ends on 2,2 between 1,1 and 3,3
  assert.equal(game.winner, 1);
  assert.deepEqual(cellsOf(game.line), ['0,0', '1,1', '2,2', '3,3']);
});

test('diagonals reaching the top corners count', () => {
  const game = position([[0, 5], [1, 4], [2, 3]], [6, 6, 6, 2, 0, 0, 0]);
  const { last } = play('3', game);
  assert.ok(last.events.includes('win'));
  assert.deepEqual(cellsOf(game.line), ['0,5', '1,4', '2,3', '3,2']);
});

test('lines never wrap around the edge of the board', () => {
  // 5,0 6,0 0,1 1,1 sit next to each other in the flat cell array, which a check
  // that ignores columns (like the 2010 one) would call four in a row.
  const game = position([[5, 0], [6, 0], [0, 1], [0, 0, 2], [1, 0, 2]], [2, 1, 0, 0, 0, 1, 1]);
  const { last } = play('1', game);
  assert.deepEqual(last.events, ['drop']);
  assert.equal(game.winner, 0);
});

test('one drop can complete two lines, and every cell of both is reported', () => {
  const game = position([[0, 3], [1, 3], [2, 3], [3, 0], [3, 1], [3, 2]], [4, 4, 4, 3, 0, 0, 0]);
  const { last } = play('3', game);
  assert.ok(last.events.includes('win'));
  assert.equal(game.line.length, 7);
  assert.deepEqual(game.line[0], { col: 3, row: 3 }, 'the played disc comes first');
});

test('filling the board without four in a row is a draw', () => {
  const moves = '541024050111106123344253402035233552466666';
  assert.equal(moves.length, COLS * ROWS);
  const { game, last } = play(moves);
  assert.deepEqual(last.events, ['drop', 'draw']);
  assert.equal(game.draw, true);
  assert.equal(game.winner, 0);
  assert.equal(isOver(game), true);
  assert.deepEqual(legalMoves(game), []);
});

test('undo takes back the last move', () => {
  const { game } = play('0011223');
  undo(game);
  assert.equal(game.winner, 0);
  assert.equal(game.turn, 1);
  assert.equal(game.cells[at(3, 0)], 0);
  assert.equal(game.heights[3], 0);
});

for (const level of ['medium', 'hard']) {
  test(`${level} AI takes an immediate win over blocking`, () => {
    // Red has 0,0 1,0 2,0 and yellow 6,0 6,1 6,2: both threaten, red to move.
    const { game } = play('061626');
    assert.equal(chooseMove(game, LEVELS[level], steady), 3);
  });

  test(`${level} AI blocks an immediate loss`, () => {
    // Red has 0,0 1,0 2,0; yellow, to move, has nothing better than 3.
    const { game } = play('06152');
    assert.equal(chooseMove(game, LEVELS[level], steady), 3);
  });

  test(`${level} AI blocks a threat on a diagonal`, () => {
    // Red has 0,0 1,1 2,2 and wins at 3,3, which yellow can fill right now.
    // Yellow's discs fill in underneath without lining up three of their own.
    const game = position([
      [0, 0], [1, 0, 2], [1, 1], [2, 0, 2], [2, 1, 2], [2, 2], [3, 0], [3, 1, 2], [3, 2],
    ], [1, 2, 3, 3, 0, 0, 0]);
    game.turn = 2;
    assert.equal(chooseMove(game, LEVELS[level], steady), 3);
  });
}

test('the AI never picks a full column', () => {
  const { game } = play('333333');
  for (let i = 0; i < 20; i++) assert.notEqual(chooseMove(game, LEVELS.easy), 3);
});

test('hard AI beats a random player', () => {
  let seed = 1;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 4; n++) {
    const game = createGame({ first: n % 2 ? 1 : 2 });
    while (!isOver(game)) {
      const moves = legalMoves(game);
      drop(game, game.turn === 1 ? chooseMove(game, LEVELS.hard, rng) : moves[Math.floor(rng() * moves.length)]);
    }
    assert.equal(game.winner, 1);
  }
});
