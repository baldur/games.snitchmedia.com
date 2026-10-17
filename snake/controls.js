// Snake steering. Unlike Pong's axis input, Snake wants discrete turns, so keyboard,
// swipes, the gamepad d-pad or stick and (opt-in) phone tilt all end up as one call:
// onTurn('up' | 'down' | 'left' | 'right'). Gamepad and tilt are edge-triggered, so
// holding a direction turns once.

import { BUTTON } from '../shared/input.js';

const KEYS = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};
const PAD = [[BUTTON.UP, 'up'], [BUTTON.DOWN, 'down'], [BUTTON.LEFT, 'left'], [BUTTON.RIGHT, 'right']];
const SWIPE = 24; // CSS pixels of finger travel that count as a swipe
const STICK = 0.5;
const TILT = { on: 12, off: 7 }; // degrees away from the resting angle, with hysteresis

// Tilt is only offered on touch devices that have the orientation API at all.
export const tiltSupported = typeof DeviceOrientationEvent !== 'undefined'
  && matchMedia('(pointer: coarse)').matches;

export class Controls {
  source = 'keys'; // device used for the latest turn: 'keys' | 'touch' | 'pad' | 'tilt'
  #onTurn;
  #swipe = null; // { id, x, y } of the finger being tracked
  #prevButtons = new Map(); // gamepad index -> pressed[]
  #stick = new Map(); // gamepad index -> direction the stick last pointed
  #pad = null; // gamepad that turned last, for rumble
  #tilt = null; // { rest, dir } while tilt steering is on

  constructor(canvas, onTurn) {
    this.#onTurn = onTurn;

    addEventListener('keydown', (e) => {
      if (!(e.code in KEYS)) return;
      e.preventDefault();
      this.#emit(KEYS[e.code], 'keys');
    });

    // A swipe turns as soon as it has travelled far enough, then starts measuring
    // again from there, so one continuous gesture can make several turns.
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.#swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointermove', (e) => {
      const s = this.#swipe;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return;
      this.#emit(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'),
        e.pointerType === 'mouse' ? 'keys' : 'touch');
      Object.assign(s, { x: e.clientX, y: e.clientY });
    });
    const release = (e) => { if (this.#swipe?.id === e.pointerId) this.#swipe = null; };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  #emit(dir, source) {
    this.source = source;
    this.#onTurn(dir);
  }

  // Call once per animation frame. Turns on newly pressed d-pad buttons or a stick
  // that moved into a new direction, and returns the buttons that went down this
  // frame (for dialogs and pause).
  poll() {
    const pressed = new Set();
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      const prev = this.#prevButtons.get(pad.index) ?? [];
      pad.buttons.forEach((b, i) => { if (b.pressed && !prev[i]) pressed.add(i); });
      this.#prevButtons.set(pad.index, pad.buttons.map((b) => b.pressed));

      const turns = PAD.filter(([b]) => pad.buttons[b]?.pressed && !prev[b]).map(([, dir]) => dir);
      const [x = 0, y = 0] = pad.axes;
      const stick = Math.max(Math.abs(x), Math.abs(y)) < STICK ? null
        : Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
      if (stick && stick !== this.#stick.get(pad.index)) turns.push(stick);
      this.#stick.set(pad.index, stick);

      for (const dir of turns) {
        this.#pad = pad;
        this.#emit(dir, 'pad');
      }
    }
    return pressed;
  }

  // A short buzz on whatever the player is holding.
  rumble(strength = 0.5) {
    if (this.source === 'pad') {
      this.#pad?.vibrationActuator?.playEffect('dual-rumble', {
        duration: 50, strongMagnitude: strength, weakMagnitude: strength * 0.6,
      }).catch(() => {});
    } else if (this.source === 'touch' || this.source === 'tilt') {
      navigator.vibrate?.(15);
    }
  }

  // --- tilt ------------------------------------------------------------------

  get tilting() { return this.#tilt !== null; }

  // Must be called from a user gesture: iOS only grants orientation access from one.
  // Resolves to whether tilt steering is now on.
  async enableTilt() {
    if (!tiltSupported) return false;
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function'
        && await DeviceOrientationEvent.requestPermission() !== 'granted') return false;
    } catch {
      return false;
    }
    if (!this.#tilt) addEventListener('deviceorientation', this.#onOrientation);
    this.#tilt = { rest: null, dir: null };
    return true;
  }

  disableTilt() {
    removeEventListener('deviceorientation', this.#onOrientation);
    this.#tilt = null;
  }

  // The next reading becomes the neutral angle, so the phone can be held however
  // is comfortable. Called whenever play starts or resumes.
  recalibrate() {
    if (this.#tilt) this.#tilt = { rest: null, dir: null };
  }

  #onOrientation = (e) => {
    const t = this.#tilt;
    if (!t || e.beta === null || e.gamma === null) return;
    // gamma tips the right edge down, beta tips the bottom edge down: the way a
    // marble on the screen would roll, in the device's portrait frame. Rotate that
    // into the screen's frame so landscape works too.
    const a = ((screen.orientation?.angle ?? 0) * Math.PI) / 180;
    const x = e.gamma * Math.cos(a) + e.beta * Math.sin(a);
    const y = -e.gamma * Math.sin(a) + e.beta * Math.cos(a);
    if (!t.rest) {
      t.rest = { x, y };
      return;
    }
    const dx = x - t.rest.x;
    const dy = y - t.rest.y;
    const amount = Math.max(Math.abs(dx), Math.abs(dy));
    if (amount < TILT.off) t.dir = null;
    if (amount < TILT.on) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    if (dir === t.dir) return;
    t.dir = dir;
    this.#emit(dir, 'tilt');
  };
}
