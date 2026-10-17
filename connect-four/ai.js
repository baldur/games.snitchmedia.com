// Computer opponent: negamax minimax with alpha-beta pruning. Pure, so it runs in
// the worker (ai-worker.js) and under Node for tests. It searches on its own copy
// of the board, placing and lifting discs in place to avoid allocating per node.

import { COLS, ROWS, CONNECT, at, connects, other } from './game.js';

// depth: plies searched. blunder: chance of playing a random legal move instead.
export const LEVELS = {
  easy: { depth: 2, blunder: 0.35 },
  medium: { depth: 5, blunder: 0.05 },
  hard: { depth: 9, blunder: 0 },
};

const ORDER = [3, 2, 4, 1, 5, 0, 6]; // centre first: better moves first means more cut-offs
const CENTRE = 3;
const WIN = 1_000_000;
const WEIGHTS = [0, 1, 5, 40]; // value of a window holding 0..3 of one player's discs and no others

// Every run of four cells on the board, as lists of cell indices.
const WINDOWS = [];
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const endCol = col + dc * (CONNECT - 1);
      const endRow = row + dr * (CONNECT - 1);
      if (endCol >= COLS || endRow < 0 || endRow >= ROWS) continue;
      WINDOWS.push(Array.from({ length: CONNECT }, (_, i) => at(col + i * dc, row + i * dr)));
    }
  }
}

// Static score of a position from `player`'s point of view: open windows that
// could still become four, plus a bonus for discs in the centre column, which
// takes part in the most lines.
export function evaluate(cells, player) {
  let score = 0;
  for (const window of WINDOWS) {
    let mine = 0;
    let theirs = 0;
    for (const i of window) {
      if (cells[i] === player) mine++;
      else if (cells[i]) theirs++;
    }
    if (!theirs) score += WEIGHTS[mine];
    else if (!mine) score -= WEIGHTS[theirs];
  }
  for (let row = 0; row < ROWS; row++) {
    const c = cells[at(CENTRE, row)];
    if (c) score += c === player ? 3 : -3;
  }
  return score;
}

// Best achievable score for `player` (to move), searching `depth` more plies.
// Wins score WIN minus the ply they happen on, so sooner wins and later losses rank higher.
function negamax(cells, heights, player, depth, alpha, beta, ply, filled) {
  // Any immediate win beats everything else, so check those before searching deeper.
  for (const col of ORDER) {
    const row = heights[col];
    if (row === ROWS) continue;
    cells[at(col, row)] = player;
    const won = connects(cells, col, row);
    cells[at(col, row)] = 0;
    if (won) return WIN - ply;
  }
  if (filled + 1 >= COLS * ROWS) return 0; // the last disc can't win (checked above), so a draw
  if (depth === 0) return evaluate(cells, player);

  for (const col of ORDER) {
    const row = heights[col];
    if (row === ROWS) continue;
    cells[at(col, row)] = player;
    heights[col]++;
    const score = -negamax(cells, heights, other(player), depth - 1, -beta, -alpha, ply + 1, filled + 1);
    heights[col]--;
    cells[at(col, row)] = 0;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return alpha;
}

// Scores every legal move for the player to move in `game`. Returns [{ col, score }].
// Each move is searched against the best score so far minus one, which still prunes
// hard but keeps ties exact, so the caller can pick fairly between equal moves.
export function scoreMoves(game, depth) {
  const cells = game.cells.slice();
  const heights = game.heights.slice();
  const player = game.turn;
  const filled = heights.reduce((a, b) => a + b, 0);
  const results = [];
  let best = -Infinity;
  for (const col of ORDER) {
    const row = heights[col];
    if (row === ROWS) continue;
    cells[at(col, row)] = player;
    heights[col]++;
    let score;
    if (connects(cells, col, row)) score = WIN;
    else if (filled + 1 === COLS * ROWS) score = 0;
    else if (depth <= 1) score = -evaluate(cells, other(player));
    else score = -negamax(cells, heights, other(player), depth - 1, -Infinity, -(best - 1), 1, filled + 1);
    heights[col]--;
    cells[at(col, row)] = 0;
    results.push({ col, score });
    if (score > best) best = score;
  }
  return results;
}

// The column the computer plays. `game` only needs { cells, heights, turn }, so
// a structured-clone copy from the main thread works. `rng` is injectable for tests.
export function chooseMove(game, { depth, blunder = 0 }, rng = Math.random) {
  const scored = scoreMoves(game, depth);
  if (!scored.length) return -1;
  if (rng() < blunder) return scored[Math.floor(rng() * scored.length)].col;
  const best = Math.max(...scored.map((m) => m.score));
  const top = scored.filter((m) => m.score === best);
  return top[Math.floor(rng() * top.length)].col;
}
