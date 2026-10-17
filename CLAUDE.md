# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A collection of browser games for games.snitchmedia.com. The rule for the whole site: **only native web platform features. No libraries, no frameworks, no build step, no package.json.** Canvas, WebGPU, Web Audio, Gamepad, Workers, etc. are all fair game; jQuery, npm packages and bundlers are not. Every file is served as-is.

## Commands

```sh
python3 -m http.server 8000          # serve locally, then open http://localhost:8000
node --test                          # run all tests (Node's built-in runner, discovers tests/*.test.js)
node --test --test-name-pattern="idle player"   # run a single test by name
```

ES modules don't load over `file://`, so always test through the HTTP server. Hosting (formerly GitHub Pages, maybe S3/CloudFront later) is undecided, so keep all links relative (`../shared/site.css`, `pong/`) and the site works from any path.

## Layout

- `index.html`: landing page listing the modern games. Add new games here.
- `shared/`: things every modern game uses. `site.css` holds the color tokens (light/dark via `prefers-color-scheme`) and the base styles for buttons and `<dialog>`. `audio.js` is a Web Audio synth (`tone()`) that generates all sounds, so the site has no audio files, plus a mute setting persisted in localStorage.
- `<game>/`: one folder per modern game, with `index.html` loading a `type="module"` entry script.
- `classic/`: the original 2010–2011 "Dom Games" (jQuery 1.4.4, Blueprint CSS, divs moved with `setInterval`). It's kept as a museum and is intentionally **not** modernized. Only the dead Google Analytics snippet was removed. Don't apply the no-library rule or refactors here.
- `tests/`: Node tests for the pure simulation modules.

## Game architecture (Pong is the reference)

Pong is split so the simulation can be tested without a browser. Follow the same split for new games:

- `game.js`: pure state and maths in fixed field units (800×500). No DOM access. `step(game, dt, intents)` advances the game and returns event names (`'paddle0'`, `'wall'`, `'score1'`, `'win'`…). The UI layer turns those into sound and haptics, so the simulation never touches audio.
- `input.js`: normalizes keyboard (`e.code`), pointer (touch drag / mouse hover, side chosen by which half of the canvas) and the Gamepad API into a per-side `{ axis, target }` intent. The most recent input source wins. `poll()` must be called once per animation frame and returns gamepad buttons newly pressed that frame, which drive dialog navigation.
- `main.js`: a rAF loop with a **fixed 1/120 s simulation step** (accumulator), so physics don't depend on refresh rate. The canvas is backed at `devicePixelRatio` through a `ResizeObserver` and drawn in field units via `setTransform`. Draw colors come from the CSS custom properties. Menus, pause and game over are native `<dialog>` elements, and flow is driven by their `returnValue` in `close` handlers. The game auto-pauses on `visibilitychange` and respects `prefers-reduced-motion`.
