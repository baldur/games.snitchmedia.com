// Tiny Web Audio synth: every sound is generated, so there are no audio files to load.
// Browsers only allow audio after a user gesture, so the context is created lazily
// on the first pointer or key press.

const STORAGE_KEY = 'snitchmedia:muted';

let ctx = null;
let muted = false;
try { muted = localStorage.getItem(STORAGE_KEY) === '1'; } catch {}

function unlock() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
}
for (const type of ['pointerdown', 'keydown']) {
  addEventListener(type, unlock, { capture: true });
}

export function isMuted() { return muted; }

export function setMuted(value) {
  muted = value;
  try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0'); } catch {}
}

// A single enveloped oscillator. `to` slides the pitch over the duration.
export function tone({ freq, to = freq, duration = 0.08, type = 'square', gain = 0.12 }) {
  if (muted || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const osc = new OscillatorNode(ctx, { type, frequency: freq });
  const amp = new GainNode(ctx, { gain });
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, t + duration);
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration);
}

// Filtered white noise with a decaying envelope: splashes, wind, crowds.
// `to` sweeps the filter frequency over the duration.
let noiseBuffer = null;
export function noise({ freq = 1000, to = freq, q = 1, duration = 0.2, gain = 0.15, type = 'bandpass' }) {
  if (muted || !ctx || ctx.state !== 'running') return;
  if (!noiseBuffer) {
    noiseBuffer = new AudioBuffer({ length: ctx.sampleRate, sampleRate: ctx.sampleRate });
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime;
  const src = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer, loop: true });
  const filter = new BiquadFilterNode(ctx, { type, frequency: freq, Q: q });
  const amp = new GainNode(ctx, { gain });
  if (to !== freq) filter.frequency.exponentialRampToValueAtTime(to, t + duration);
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(filter).connect(amp).connect(ctx.destination);
  src.start(t, Math.random());
  src.stop(t + duration);
}
