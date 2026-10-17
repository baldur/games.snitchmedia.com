// Keyboard, gamepad and touch → paddle strokes, rudder and lean.
// Strokes are discrete events; rudder and lean are held amounts in -1..1.
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

export class Controls {
  #held = new Set();
  #strokes = [];
  #keyLean = 0;
  #prev = new Map(); // gamepad index -> previous pressed state per button
  #pad = null;
  #touching = false;

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

    // Touch: tap the left or right half of the screen to stroke on that side.
    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      this.#touching = true;
      const rect = target.getBoundingClientRect();
      this.#strokes.push(e.clientX - rect.left < rect.width / 2 ? 'left' : 'right');
    });
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
      rudder: clamp(keyRudder + axis(0)),
      lean: clamp(this.#keyLean + axis(2)),
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
