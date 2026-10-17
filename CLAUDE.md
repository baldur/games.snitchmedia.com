# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A collection of browser games for games.snitchmedia.com. The rule for the whole site: **only native web platform features. No libraries, no frameworks, no build step, no package.json.** Canvas, WebGPU, Web Audio, Gamepad, Workers, etc. are all fair game; jQuery, npm packages and bundlers are not. Every file is served as-is.

**The one exception is WebAssembly.** A game may compile Rust (or C, Zig, …) to a `.wasm` file, because wasm is itself a web standard whose text format could in principle be written by hand. Conditions:
- The source lives next to the committed `.wasm`, with a one-line rebuild command documented there (e.g. `cargo build --release --target wasm32-unknown-unknown`).
- No `wasm-bindgen`, `wasm-pack` or generated JS glue. Export plain functions and load them with `WebAssembly.instantiateStreaming`, plus a few hand-written lines of JS.
- Only use it where it earns its place (heavy simulation, search, DSP). If plain JS is fast enough, use plain JS.

The collection deliberately covers a range of techniques, from zero-JS CSS (Tic Tac Toe) and DOM (Connect Four) through canvas and WebGPU to wasm. Pick the technique that best shows off what the browser can do for each game.

## Commands

```sh
python3 -m http.server 8000          # serve locally, then open http://localhost:8000
node --test                          # run all tests (Node's built-in runner, discovers tests/*.test.js)
node --test --test-name-pattern="idle player"   # run a single test by name
```

ES modules don't load over `file://`, so always test through the HTTP server. Hosting (formerly GitHub Pages, maybe S3/CloudFront later) is undecided, so keep all links relative (`../shared/site.css`, `pong/`) and the site works from any path.

## Layout

- `index.html`: landing page listing the modern games. Add new games here.
- `shared/`: things every modern game uses. Reach for these before writing new plumbing:
  - `site.css`: color tokens (light/dark via `prefers-color-scheme`) and base styles for buttons, `<kbd>` and `<dialog>`.
  - `game.css`: game page layout (header bar, one `#field` canvas, a `.status` line). Set `--aspect` on `#field` to match the game's field units.
  - `audio.js`: Web Audio synth. `tone({ freq, to, duration, type, gain })` generates every sound, so the site has no audio files. Also holds a mute setting persisted in localStorage.
  - `input.js`: `Input` merges keyboard, pointer and Gamepad API input into per-player `{ axis, target }` for games where each player steers along one axis. Also exports `BUTTON` (standard gamepad button indices) and has `poll()` (buttons newly pressed this frame) and `rumble()`.
  - `canvas.js`: `fitCanvas()` (high-DPI backing plus a `setTransform` so you draw in field units), `themeColors()` (reads CSS tokens and follows color-scheme changes) and `reducedMotion`.
  - `dialogs.js`: `openDialog()`, `gamepadDialogs()` (d-pad and A navigation inside an open `<dialog>`) and `soundToggle()`.
- `favicon.svg`: linked from every modern page.
- `<game>/`: one folder per modern game, with `index.html` loading a `type="module"` entry script.
- `classic/`: the original 2010–2011 "Dom Games" (jQuery 1.4.4, Blueprint CSS, divs moved with `setInterval`). It's kept as a museum and is intentionally **not** modernized. Only the dead Google Analytics snippet was removed. Don't apply the no-library rule or refactors here.
- `tests/`: Node tests for the pure simulation modules.

## Game architecture (Pong is the reference)

Pong is split so the simulation can be tested without a browser. Follow the same split for new games:

- `game.js`: pure state and maths in fixed field units (800×500). No DOM access. `step(game, dt, intents)` advances the game and returns event names (`'paddle0'`, `'wall'`, `'score1'`, `'win'`…). The UI layer turns those into sound and haptics, so the simulation never touches audio.
- `main.js`: wires the shared modules together. Input comes from `shared/input.js` (the most recent input source wins, and `poll()` must be called once per animation frame). It runs a rAF loop with a **fixed 1/120 s simulation step** (accumulator), so physics don't depend on refresh rate. It draws through `fitCanvas` in field units, with colors from the CSS tokens. Menus, pause and game over are native `<dialog>` elements, and flow is driven by their `returnValue` in `close` handlers. The game auto-pauses on `visibilitychange` and respects `prefers-reduced-motion`.

Kayak is the exception to the canvas-in-a-box layout: a full-screen WebGPU view with its own renderer (`kayak/render.js`, `shaders.js`, `mat4.js`) and procedurally built meshes (`meshes.js`, `world.js`). Its physics (`sim.js`), course geometry (`course.js`) and pack racing (`race.js`: the starter and false starts, rival AI, wash drafting, hull collisions, standings) are DOM-free and tested; a whole race can be simulated headlessly in Node. Race courses have a `warp`: the HUD shows distances and times 4× longer than what is actually paddled, so a 6 km race (shown as about 28 minutes) plays in about 7, while speeds and stroke rates stay real (about 97 strokes a minute racing, a little over 110 sprinting). Courses vary in width along the way (`widthAt`), and moored narrowboats count as bank. Speed comes from rhythm (a steady alternating beat) as much as cadence; hull types (`HULLS` in `sim.js`) trade speed for stability. Session form (stronger, fitter, steadier on the beat after each race) lives in `sessionStorage` for now. On phones, turning the phone shifts your weight (`controls.js`, DeviceMotion; iOS only allows it over HTTPS, and without it touch play gets a balance assist). The renderer lowers its resolution when the GPU falls behind. Open `kayak/#debug` to expose `window.kayak` (race, boat, location, course, state, GPU stats) for scripted playtests.

Every game should cover the same baseline: keyboard, touch and gamepad controls; generated sound with the shared mute toggle; a link between the modern page and its `classic/` original (if one exists), in the header and also inside the start menu's `.dialog-links` (a modal `<dialog>` makes the header unclickable); a row on the landing page; and a row in the README's games table.
