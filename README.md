# Snitchmedia Games

Small games built with nothing but the web platform. No libraries, no frameworks, no build step: every file in this repo is exactly what the browser runs.

## The story

In 2010 I started a little collection called **Dom Games**: Snake, Pong, Bricks, Connect Four and Tic Tac Toe, built out of plain `<div>`s moved around the page. The point was to see how far the browser alone could go as a game platform. Back then that meant jQuery, `setInterval` and a then-very-new Web Worker doing Snake's collision checks. Some of it worked, some of it didn't (my own commit message for Bricks admits to "performance troubles"), and then the project sat untouched for about fifteen years.

Browsers have changed enormously since. A page can now read gamepads, synthesize sound, vibrate a phone, draw with the GPU, run code off the main thread, talk peer-to-peer and work offline, all without a single library. So in 2026 the project is coming back with the same question, asked again: **what can you build with just the browser?**

The originals are preserved, untouched apart from removing a long-dead analytics snippet, in [`classic/`](classic/). Each game gets rebuilt from scratch with modern web APIs, and the two versions link to each other so you can compare.

## How it's being made

The 2026 revival is being built in collaboration with [Claude Code](https://claude.com/claude-code), Anthropic's AI coding agent. I set the direction and the constraints, play the games and decide what stays, and Claude does much of the reading, writing and testing of the code. Part of the fun is seeing how a fifteen-year-old hobby project and an AI pair programmer get on. [`CLAUDE.md`](CLAUDE.md) holds the project rules the agent works from.

## The games

| Game | Status | Platform features |
| --- | --- | --- |
| [Pong](pong/) | Rebuilt 2026 | Canvas 2D, Gamepad API, Web Audio, Pointer Events, Vibration, `<dialog>` |
| [Snake](classic/snake/) | Classic only | Web Worker |
| [Bricks](classic/bricks/) | Classic only | |
| [Connect Four](classic/connect_four/) | Classic only | |
| [Tic Tac Toe](tic-tac-toe/) | Rebuilt 2026 | Zero JavaScript: CSS `:has()` and `:checked` state machine, `@property` animations, container queries, form reset |

## The rules

- Only native web platform features. Canvas, WebGPU, Web Audio, Workers and friends are all in.
- No libraries, no npm, no bundler, no transpiler. ES modules loaded straight from the server.
- Sounds are generated in code, not loaded from files.
- It should work on a phone as well as with a keyboard or gamepad.

## Running it locally

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>. ES modules don't load from `file://`, so you do need a server, but any static file server will do.

Game logic is kept free of the DOM so it can be tested with Node's built-in test runner:

```sh
node --test
```
