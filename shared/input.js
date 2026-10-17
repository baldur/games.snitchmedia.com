// Turns keyboard, pointer and gamepad state into per-player "paddle" intent for
// games where each player steers along one axis (Pong vertically, Bricks horizontally).
// A side is driven either by an axis (-1..1, keys and sticks) or by an absolute
// target position (pointer drag), whichever was used most recently.

const DEADZONE = 0.2;

// Standard-mapping gamepad button indices.
export const BUTTON = { A: 0, B: 1, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

export class Input {
  #held = new Set();
  #pointers = new Map(); // pointerId -> { frac, pos, type, at }
  #pads = [];
  #prevButtons = new Map(); // gamepad index -> pressed[]
  #lastSource = [];
  #axisAt = [];

  // canvas:  element that receives pointer input
  // keys:    { [KeyboardEvent.code]: [side, direction] }
  // axis:    'x' | 'y', the direction paddles move in
  // length:  field size along `axis`, so pointer positions come back in field units
  // sideBy:  'x' | 'y' | null, which half of the canvas a pointer lands in picks the side
  constructor(canvas, { keys, axis, length, sideBy = null }) {
    Object.assign(this, { canvas, keys, axis, length, sideBy });

    addEventListener('keydown', (e) => {
      if (e.code in keys) {
        this.#held.add(e.code);
        this.#lastSource[keys[e.code][0]] = 'keys';
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
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    this.#pointers.set(e.pointerId, {
      frac: this.sideBy === 'y' ? fy : fx,
      pos: (this.axis === 'x' ? fx : fy) * this.length,
      type: e.pointerType,
      at: performance.now(),
    });
  }

  #sideOf(frac, solo) {
    return solo || !this.sideBy || frac < 0.5 ? 0 : 1;
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

  // { axis, target } for one player; target is a field position or null.
  // In solo games every key and the first gamepad drive side 0.
  read(side, solo = true) {
    const axis = this.#axis(side, solo);
    if (axis) this.#axisAt[side] = performance.now();

    // A held touch always steers; a resting mouse only until a key or stick is used.
    for (const p of this.#pointers.values()) {
      if (this.#sideOf(p.frac, solo) !== side) continue;
      if (p.type !== 'mouse' || p.at > (this.#axisAt[side] ?? 0)) {
        this.#lastSource[side] = p.type === 'touch' ? 'touch' : 'mouse';
        return { axis: 0, target: p.pos };
      }
    }
    return { axis, target: null };
  }

  #axis(side, solo) {
    let axis = 0;
    for (const code of this.#held) {
      const [keySide, dir] = this.keys[code];
      if (keySide === side || solo) axis += dir;
    }

    const pad = this.#padFor(side, solo);
    if (pad) {
      const [stickIndex, minus, plus] = this.axis === 'x'
        ? [0, BUTTON.LEFT, BUTTON.RIGHT]
        : [1, BUTTON.UP, BUTTON.DOWN];
      const stick = pad.axes[stickIndex] ?? 0;
      const padAxis = (Math.abs(stick) > DEADZONE ? stick : 0)
        + (pad.buttons[plus]?.pressed ? 1 : 0)
        - (pad.buttons[minus]?.pressed ? 1 : 0);
      if (padAxis) this.#lastSource[side] = 'pad';
      axis += padAxis;
    }
    return Math.max(-1, Math.min(1, axis));
  }

  // A short buzz on whatever the player on this side is holding.
  rumble(side, solo = true, strength = 0.5) {
    const source = this.#lastSource[side];
    if (source === 'pad') {
      this.#padFor(side, solo)?.vibrationActuator?.playEffect('dual-rumble', {
        duration: 40, strongMagnitude: strength, weakMagnitude: strength * 0.6,
      }).catch(() => {});
    } else if (source === 'touch') {
      navigator.vibrate?.(12);
    }
  }
}
