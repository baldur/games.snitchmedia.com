// Connect Four rules. Pure state: no DOM, so it can run under Node and in a Worker.
// The board is a flat array of COLS x ROWS cells, indexed by `at(col, row)` with
// row 0 at the bottom. A cell holds 0 (empty), 1 or 2 (the player whose disc it is).

export const COLS = 7;
export const ROWS = 6;
export const CONNECT = 4;

// The four line directions as [dCol, dRow]: horizontal, vertical, both diagonals.
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

export const at = (col, row) => row * COLS + col;

export function createGame({ first = 1 } = {}) {
  return {
    cells: new Array(COLS * ROWS).fill(0),
    heights: new Array(COLS).fill(0), // discs already in each column
    turn: first,
    moves: [], // columns played, in order
    winner: 0,
    line: [], // winning cells as { col, row }
    draw: false,
  };
}

export const other = (player) => 3 - player;

export const isOver = (game) => game.winner !== 0 || game.draw;

export function canDrop(game, col) {
  return !isOver(game) && Number.isInteger(col) && col >= 0 && col < COLS && game.heights[col] < ROWS;
}

export function legalMoves(game) {
  const moves = [];
  for (let col = 0; col < COLS; col++) if (canDrop(game, col)) moves.push(col);
  return moves;
}

// Drops the current player's disc into `col`. Returns null for an illegal move,
// otherwise { col, row, player, events } where events is a list of
// 'drop' | 'win' | 'draw' for the UI to turn into sound.
export function drop(game, col) {
  if (!canDrop(game, col)) return null;
  const row = game.heights[col]++;
  const player = game.turn;
  game.cells[at(col, row)] = player;
  game.moves.push(col);
  const events = ['drop'];

  const line = winningLine(game.cells, col, row);
  if (line.length) {
    game.winner = player;
    game.line = line;
    events.push('win');
  } else if (game.moves.length === COLS * ROWS) {
    game.draw = true;
    events.push('draw');
  } else {
    game.turn = other(player);
  }
  return { col, row, player, events };
}

// Takes back the last move.
export function undo(game) {
  const col = game.moves.pop();
  if (col === undefined) return;
  const row = --game.heights[col];
  game.turn = game.cells[at(col, row)];
  game.cells[at(col, row)] = 0;
  game.winner = 0;
  game.line = [];
  game.draw = false;
}

// How many of the same player's discs run from (col, row) in one direction,
// not counting the starting cell. Stops at the board edge, so lines never wrap.
function run(cells, col, row, dc, dr) {
  const player = cells[at(col, row)];
  let n = 0;
  for (let c = col + dc, r = row + dr; c >= 0 && c < COLS && r >= 0 && r < ROWS; c += dc, r += dr) {
    if (cells[at(c, r)] !== player) break;
    n++;
  }
  return n;
}

// True if the disc at (col, row) completes four or more in a row. Only lines
// through that disc can be new, so this is all a move ever needs to check.
export function connects(cells, col, row) {
  if (!cells[at(col, row)]) return false;
  for (const [dc, dr] of DIRECTIONS) {
    if (1 + run(cells, col, row, dc, dr) + run(cells, col, row, -dc, -dr) >= CONNECT) return true;
  }
  return false;
}

// Every cell in a winning line through (col, row), or [] if there is none. A
// single drop can finish more than one line (or a line of five), so this returns
// all of them, starting with the played disc.
export function winningLine(cells, col, row) {
  const line = [];
  if (!cells[at(col, row)]) return line;
  for (const [dc, dr] of DIRECTIONS) {
    const ahead = run(cells, col, row, dc, dr);
    const behind = run(cells, col, row, -dc, -dr);
    if (1 + ahead + behind < CONNECT) continue;
    for (let i = -behind; i <= ahead; i++) {
      if (i !== 0) line.push({ col: col + i * dc, row: row + i * dr });
    }
  }
  return line.length ? [{ col, row }, ...line] : line;
}
