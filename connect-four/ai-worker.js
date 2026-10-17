// Runs the computer's search off the main thread, so the page stays responsive
// while it thinks. Message in: { id, game: { cells, heights, turn }, level }.
// Message out: { id, col }. The id lets the page ignore replies for a game it has left.

import { chooseMove, LEVELS } from './ai.js';

addEventListener('message', ({ data: { id, game, level } }) => {
  postMessage({ id, col: chooseMove(game, LEVELS[level] ?? LEVELS.medium) });
});
