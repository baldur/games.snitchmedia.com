// Pathfinding for the attract-mode demo snake. Pure functions over plain grid data,
// so the Web Worker can import it and Node can test it.
//
// Strategy: breadth-first search to the food, but only take that path if the snake
// could still reach its own tail after eating (otherwise it may be boxing itself in).
// If not, stall by chasing the tail the long way round, and as a last resort move
// towards the most open space.

import { DIRS } from './game.js';

const STEPS = Object.entries(DIRS);

// state: { cols, rows, snake: [{ x, y }] head first, food: { x, y } | null, dir }
// Returns 'up' | 'down' | 'left' | 'right'.
export function chooseDir({ cols, rows, snake, food, dir }) {
  const grid = { cols, rows };
  const head = snake[0];

  if (food) {
    const path = findPath(grid, snake, food);
    if (path && canReachTail(grid, afterPath(snake, path))) return dirBetween(head, path[0]);
  }

  let best = null;
  for (const [name, v] of STEPS) {
    const cell = { x: head.x + v.x, y: head.y + v.y };
    if (!isFree(grid, snake, cell, 1)) continue;
    const eats = food !== null && cell.x === food.x && cell.y === food.y;
    const moved = [cell, ...snake].slice(0, snake.length + (eats ? 1 : 0));
    const tail = findPath(grid, moved, moved.at(-1));
    const option = {
      name,
      safe: tail !== null,
      // Far from the tail means more room to wander before catching up with it.
      reach: tail ? tail.length : openSpace(grid, moved),
    };
    if (!best || option.safe > best.safe || (option.safe === best.safe && option.reach > best.reach)) {
      best = option;
    }
  }
  return best?.name ?? dir; // boxed in: carry on and accept fate
}

// Shortest list of cells from the snake's head to `goal` (excluding the head), or null.
// Body segments count as free once the snake has moved far enough for them to clear.
export function findPath(grid, snake, goal) {
  const start = snake[0];
  const key = (p) => p.y * grid.cols + p.x;
  const from = new Map([[key(start), null]]);
  let frontier = [start];
  for (let moves = 1; frontier.length; moves++) {
    const next = [];
    for (const p of frontier) {
      for (const [, v] of STEPS) {
        const cell = { x: p.x + v.x, y: p.y + v.y };
        const k = key(cell);
        if (from.has(k)) continue;
        if (!isFree(grid, snake, cell, moves)) continue;
        from.set(k, p);
        if (cell.x === goal.x && cell.y === goal.y) return walkBack(from, key, cell);
        next.push(cell);
      }
    }
    frontier = next;
  }
  return null;
}

// Whether `cell` is on the board and empty after `moves` moves (without growing).
// Segment i is gone once moves >= length - i, which makes the tail free right away.
export function isFree(grid, snake, cell, moves) {
  if (cell.x < 0 || cell.y < 0 || cell.x >= grid.cols || cell.y >= grid.rows) return false;
  const i = snake.findIndex((s) => s.x === cell.x && s.y === cell.y);
  return i === -1 || moves >= snake.length - i;
}

function walkBack(from, key, cell) {
  const path = [];
  for (let p = cell; from.get(key(p)) !== null; p = from.get(key(p))) path.unshift(p);
  return path;
}

// The snake after following `path`, growing by one at the end where the food is.
function afterPath(snake, path) {
  return [...path].reverse().concat(snake).slice(0, snake.length + 1);
}

function canReachTail(grid, snake) {
  return findPath(grid, snake, snake.at(-1)) !== null;
}

function openSpace(grid, snake) {
  const seen = new Set();
  const stack = [snake[0]];
  while (stack.length) {
    const p = stack.pop();
    for (const [, v] of STEPS) {
      const cell = { x: p.x + v.x, y: p.y + v.y };
      const k = cell.y * grid.cols + cell.x;
      if (seen.has(k) || !isFree(grid, snake, cell, 1)) continue;
      seen.add(k);
      stack.push(cell);
    }
  }
  return seen.size;
}

function dirBetween(a, b) {
  return STEPS.find(([, v]) => a.x + v.x === b.x && a.y + v.y === b.y)[0];
}
