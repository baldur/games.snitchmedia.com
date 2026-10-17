// Turns keyboard, pointer and gamepad state into per-paddle intent.
// A side is driven either by an axis (-1..1, keys and sticks) or by an absolute
// target y (pointer drag), whichever was touched most recently.

const KEYS = {
  KeyW: [0, -1],
  KeyS: [0, 1],
  ArrowUp: [1, -1],
  ArrowDown: [1, 1],
};

const DEADZONE = 0.2;
const BUTTON = { A: 0, START: 9, UP: 12, DOWN: 13 };

export class Input {
  #held = new Set();
  #pointers = new Map(); // pointerId -> { xFrac, y }
  #pads = [];
  #prevButtons = new Map(); // gamepad index -> pressed[]
  #lastSource = ['keys', 'keys'];
  #axisAt = [0, 0];

  constructor(canvas, fieldHeight) {
    this.canvas = canvas;
    this.fieldHeight = fieldHeight;

    addEventListener('keydown', (e) => {
      if (e.code in KEYS) {
        this.#held.add(e.code);
        this.#lastSource[KEYS[e.code][0]] = 'keys';
        e.preventDefault();
      }
    });
    addEventListener('keyup', (e) => this.#held.delete(e.code));
    addEventListener('blur', () => this.#held.clear());

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.#trackPointer(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      // Mouse hover steers too; touch only counts while the finger is down.
      if (e.pointerType === 'mouse' || this.#pointers.has(e.pointerId)) this.#trackPointer(e);
    });
    const release = (e) => this.#pointers.delete(e.pointerId);
    canvas.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') release(e); });
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') release(e); });
  }

  #trackPointer(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.#pointers.set(e.pointerId, {
      xFrac: (e.clientX - rect.left) / rect.width,
      y: ((e.clientY - rect.top) / rect.height) * this.fieldHeight,
      type: e.pointerType,
      at: performance.now(),
    });
  }

  #sideOf(xFrac, solo) {
    return solo || xFrac < 0.5 ? 0 : 1;
  }

  #padFor(side, solo) {
    return solo ? this.#pads[0] : this.#pads[side];
  }

  // Call once per animation frame. Returns the gamepad buttons that went down this frame.
  poll() {
    this.#pads = [...navigator.getGamepads()].filter(Boolean);
    const pressed = new Set();
    for (const pad of this.#pads) {
      const prev = this.#prevButtons.get(pad.index) ?? [];
      pad.buttons.forEach((b, i) => { if (b.pressed && !prev[i]) pressed.add(i); });
      this.#prevButtons.set(pad.index, pad.buttons.map((b) => b.pressed));
    }
    return pressed;
  }

  // { axis, target } for one paddle; target is a field y or null.
  read(side, solo) {
    const axis = this.#axis(side, solo);
    if (axis) this.#axisAt[side] = performance.now();

    // A held touch always steers; a resting mouse only until a key or stick is used.
    for (const p of this.#pointers.values()) {
      if (this.#sideOf(p.xFrac, solo) !== side) continue;
      if (p.type !== 'mouse' || p.at > this.#axisAt[side]) {
        this.#lastSource[side] = p.type === 'touch' ? 'touch' : 'mouse';
        return { axis: 0, target: p.y };
      }
    }
    return { axis, target: null };
  }

  #axis(side, solo) {
    let axis = 0;
    for (const code of this.#held) {
      const [keySide, dir] = KEYS[code];
      if (keySide === side || solo) axis += dir;
    }

    const pad = this.#padFor(side, solo);
    if (pad) {
      const stick = pad.axes[1] ?? 0;
      const padAxis = (Math.abs(stick) > DEADZONE ? stick : 0)
        + (pad.buttons[BUTTON.DOWN]?.pressed ? 1 : 0)
        - (pad.buttons[BUTTON.UP]?.pressed ? 1 : 0);
      if (padAxis) this.#lastSource[side] = 'pad';
      axis += padAxis;
    }
    return Math.max(-1, Math.min(1, axis));
  }

  // A short buzz on whatever the player on this side is holding.
  rumble(side, solo) {
    const source = this.#lastSource[side];
    if (source === 'pad') {
      this.#padFor(side, solo)?.vibrationActuator?.playEffect('dual-rumble', {
        duration: 40, strongMagnitude: 0.5, weakMagnitude: 0.3,
      }).catch(() => {});
    } else if (source === 'touch') {
      navigator.vibrate?.(12);
    }
  }
}

export { BUTTON };
