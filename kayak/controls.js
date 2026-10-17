// Keyboard, gamepad, touch and tilt → paddle strokes, rudder and lean.
// Strokes are discrete events; rudder and lean are held amounts in -1..1.
//
// On a phone held sideways, turning it like a steering wheel shifts your
// weight (lean), from the motion sensors: keep the horizon level. Each touch strokes on its side of
// the screen, and sliding a finger that's down sideways works the rudder.
// Without the sensors (no permission, or a page not served over HTTPS on
// iOS), touch play keeps you upright automatically: see `assist`.
import { BUTTON } from '../shared/input.js';

// The one place to change the key layout.
export const KEYS = {
  strokeLeft: 'ArrowLeft',
  strokeRight: 'ArrowRight',
  leanLeft: 'KeyA',
  leanRight: 'KeyD',
  rudderLeft: 'KeyQ',
  rudderRight: 'KeyE',
};

const PAD = { LB: 4, RB: 5, LT: 6, RT: 7 };
const DEADZONE = 0.15;
const KEY_LEAN_RATE = 5; // keyboard lean eases in and out so taps can be gentle
const TILT_FULL = 0.3; // radians of phone turn (about 17 degrees) for a full lean
const TILT_DEAD = 0.02;
const DRAG_FULL = 0.14; // share of the screen width to slide for full rudder

export class Controls {
  #held = new Set();
  #strokes = [];
  #keyLean = 0;
  #prev = new Map(); // gamepad index -> previous pressed state per button
  #pad = null;
  #touching = false;
  #fingers = new Map(); // pointerId -> x where it came down
  #dragRudder = 0;
  #tilt = { on: false, zero: null, flip: 1, lean: 0, at: null };

  constructor(target) {
    addEventListener('keydown', (e) => {
      if (Object.values(KEYS).includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      if (e.code === KEYS.strokeLeft) this.#strokes.push('left');
      if (e.code === KEYS.strokeRight) this.#strokes.push('right');
      this.#held.add(e.code);
    });
    addEventListener('keyup', (e) => this.#held.delete(e.code));
    addEventListener('blur', () => this.#held.clear());

    // Touch: tap the left or right half of the screen to stroke on that side;
    // slide a finger that's down to steer.
    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      this.#touching = true;
      const rect = target.getBoundingClientRect();
      this.#strokes.push(e.clientX - rect.left < rect.width / 2 ? 'left' : 'right');
      this.#fingers.set(e.pointerId, e.clientX);
    });
    target.addEventListener('pointermove', (e) => {
      if (!this.#fingers.has(e.pointerId)) return;
      const dx = e.clientX - this.#fingers.get(e.pointerId);
      const full = target.getBoundingClientRect().width * DRAG_FULL;
      this.#dragRudder = clamp(Math.sign(dx) * Math.max(0, Math.abs(dx) - 8) / full);
    });
    const lift = (e) => {
      this.#fingers.delete(e.pointerId);
      if (!this.#fingers.size) this.#dragRudder = 0;
    };
    target.addEventListener('pointerup', lift);
    target.addEventListener('pointercancel', lift);
  }

  // Starts reading the motion sensors. Call it from a tap or click: iOS asks
  // for permission, and only allows asking in response to one.
  async enableTilt() {
    if (this.#tilt.on || !window.DeviceMotionEvent) return;
    try {
      if (DeviceMotionEvent.requestPermission && await DeviceMotionEvent.requestPermission() !== 'granted') return;
    } catch {
      return;
    }
    this.#tilt.on = true;
    addEventListener('devicemotion', (e) => this.#motion(e));
  }

  // Whatever way the phone is held right now counts as level.
  calibrate() {
    this.#tilt.zero = null;
  }

  // True while tilt is working: a sensor reading has arrived recently.
  get tilting() {
    return this.#tilt.on && this.#tilt.at !== null && performance.now() - this.#tilt.at < 1000;
  }

  // Touch play without tilt: main.js should balance the boat for the player.
  get assist() {
    return this.#touching && !this.tilting && !this.#pad;
  }

  #motion(e) {
    const g = e.accelerationIncludingGravity;
    if (g?.x == null) return;
    // Into screen axes (x right, y up), whichever way round the phone is.
    const angle = ((screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI) / 180;
    const sx = g.x * Math.cos(angle) - g.y * Math.sin(angle);
    const sy = g.x * Math.sin(angle) + g.y * Math.cos(angle);
    if (Math.hypot(sx, sy) < 2.5) return; // lying flat: no wheel to read
    const t = this.#tilt;
    // Browsers disagree on the sign of these readings; held up in front of
    // you, "up" should point up the screen.
    if (t.zero === null) t.flip = sy < 0 ? -1 : 1;
    const turn = Math.atan2(-sx * t.flip, sy * t.flip); // clockwise is positive
    if (t.zero === null) t.zero = turn;
    const d = Math.atan2(Math.sin(turn - t.zero), Math.cos(turn - t.zero));
    // The view rolls with the boat, so the natural move is to turn the phone
    // to keep the horizon level in your hands: turning it clockwise against a
    // roll to the right shifts your weight left.
    const target = clamp(-Math.sign(d) * Math.max(0, Math.abs(d) - TILT_DEAD) / TILT_FULL);
    t.lean += (target - t.lean) * 0.5; // sensors are noisy: smooth a little
    t.at = performance.now();
  }

  // Once per animation frame: reads gamepads. Returns buttons newly pressed, for menus.
  poll(dt) {
    const pressed = new Set();
    this.#pad = [...navigator.getGamepads()].find(Boolean) ?? null;
    if (this.#pad) {
      const prev = this.#prev.get(this.#pad.index) ?? [];
      const now = this.#pad.buttons.map((b) => b.value > 0.5 || b.pressed);
      now.forEach((down, i) => { if (down && !prev[i]) pressed.add(i); });
      this.#prev.set(this.#pad.index, now);
      if (pressed.has(PAD.LT) || pressed.has(PAD.LB)) this.#strokes.push('left');
      if (pressed.has(PAD.RT) || pressed.has(PAD.RB)) this.#strokes.push('right');
    }
    const target = (this.#held.has(KEYS.leanRight) ? 1 : 0) - (this.#held.has(KEYS.leanLeft) ? 1 : 0);
    const step = KEY_LEAN_RATE * dt;
    this.#keyLean += Math.max(-step, Math.min(step, target - this.#keyLean));
    return pressed;
  }

  // Everything since the last call: strokes are consumed, held inputs sampled.
  take() {
    const axis = (i) => {
      const v = this.#pad?.axes[i] ?? 0;
      return Math.abs(v) > DEADZONE ? v : 0;
    };
    const keyRudder = (this.#held.has(KEYS.rudderRight) ? 1 : 0) - (this.#held.has(KEYS.rudderLeft) ? 1 : 0);
    const strokes = this.#strokes;
    this.#strokes = [];
    return {
      strokes,
      rudder: clamp(keyRudder + axis(0) + this.#dragRudder),
      lean: clamp(this.#keyLean + axis(2) + (this.tilting ? this.#tilt.lean : 0)),
    };
  }

  clear() {
    this.#strokes = [];
  }

  rumble(strength = 0.4, duration = 60) {
    if (this.#pad?.vibrationActuator) {
      this.#pad.vibrationActuator.playEffect('dual-rumble', {
        duration, strongMagnitude: strength, weakMagnitude: strength * 0.5,
      }).catch(() => {});
    } else if (this.#touching) {
      navigator.vibrate?.(Math.round(duration / 3));
    }
  }
}

export { BUTTON };

function clamp(v) {
  return Math.max(-1, Math.min(1, v));
}
