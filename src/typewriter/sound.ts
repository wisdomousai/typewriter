/**
 * The machine's sounds, made here rather than shipped: each is a short buffer of filtered
 * noise and damped tones worked out once, then played with a little wander in pitch and level
 * so no two strikes sound the same. The typewriter says what happened (a key went down, a bar
 * hit the platen, the carriage hit its stop) and where across the machine (pan, -1 to 1).
 *
 * Browsers only let sound start after the page has been touched or typed on: the context is
 * made then, and anything asked for before that is dropped.
 */
export type SoundName =
  | 'key'
  | 'space'
  | 'clack'
  | 'shift'
  | 'tick'
  | 'zip'
  | 'thunk'
  | 'ratchet'
  | 'lever'
  | 'bell'
  | 'tape'
  | 'tear';

export interface SoundEvent {
  name: SoundName;
  /** 0 to 1 and a bit: how hard. */
  gain?: number;
  /** Left (-1) to right (1). */
  pan?: number;
}

const RATE = 44100;

/** A tiny seeded generator, so the buffers are the same on every load. */
function noise(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 4294967296) * 2 - 1;
  };
}

/** A second-order band-pass (RBJ), run over the samples in place. */
function bandpass(x: Float32Array, freq: number, q: number) {
  const w = (2 * Math.PI * freq) / RATE;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
  return x;
}

/** A one-pole low-pass, in place. */
function lowpass(x: Float32Array, freq: number) {
  const k = 1 - Math.exp((-2 * Math.PI * freq) / RATE);
  let y = 0;
  for (let i = 0; i < x.length; i++) x[i] = y += k * (x[i] - y);
  return x;
}

/** Noise of a length, under an envelope (seconds in, gain out). */
function burst(seconds: number, env: (t: number) => number, seed: number) {
  const r = noise(seed);
  const x = new Float32Array(Math.ceil(seconds * RATE));
  for (let i = 0; i < x.length; i++) x[i] = r() * env(i / RATE);
  return x;
}

/** A damped tone, its pitch falling from f0 to f1 (a knock on wood or metal). */
function tone(seconds: number, f0: number, f1: number, decay: number) {
  const x = new Float32Array(Math.ceil(seconds * RATE));
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE;
    const f = f1 + (f0 - f1) * Math.exp(-t / (decay * 0.5));
    phase += (2 * Math.PI * f) / RATE;
    x[i] = Math.sin(phase) * Math.exp(-t / decay);
  }
  return x;
}

function mix(...parts: [Float32Array, number, number?][]) {
  const len = Math.max(...parts.map(([p, , at = 0]) => p.length + Math.round(at * RATE)));
  const out = new Float32Array(len);
  for (const [p, g, at = 0] of parts) {
    const o = Math.round(at * RATE);
    for (let i = 0; i < p.length; i++) out[o + i] += p[i] * g;
  }
  // A short fade at the end, so nothing clicks off.
  const fade = Math.min(out.length, 64);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}

const decay = (tau: number, attack = 0.0004) => (t: number) =>
  Math.min(1, t / attack) * Math.exp(-t / tau);

/** Every sound, as samples at RATE. */
const RECIPES: Record<SoundName, () => Float32Array> = {
  // A key going down: a soft plastic thock and the lever under it.
  key: () =>
    mix(
      [lowpass(burst(0.03, decay(0.004), 1), 2400), 0.9],
      [tone(0.06, 210, 130, 0.014), 0.45],
    ),
  space: () =>
    mix(
      [lowpass(burst(0.04, decay(0.006), 2), 1600), 1],
      [tone(0.09, 150, 95, 0.022), 0.5],
    ),
  // The typebar hits the platen through the ribbon: a hard, bright crack with the frame's
  // ring behind it.
  clack: () =>
    mix(
      [bandpass(burst(0.05, decay(0.0035), 3), 2900, 0.9), 2.4],
      [bandpass(burst(0.05, decay(0.012), 4), 900, 1.4), 0.9],
      [tone(0.12, 340, 260, 0.03), 0.28],
      [tone(0.09, 1450, 1420, 0.018), 0.07],
    ),
  // The basket drops for Shift: a heavy, dull clunk.
  shift: () =>
    mix([lowpass(burst(0.08, decay(0.02), 5), 700), 1], [tone(0.12, 120, 80, 0.035), 0.6]),
  // The escapement lets the carriage on one step.
  tick: () => mix([bandpass(burst(0.012, decay(0.0012), 6), 4200, 1.5), 1.3]),
  // One tooth of the escapement rack as the carriage runs back (played in a fast row).
  zip: () => mix([bandpass(burst(0.008, decay(0.001), 7), 3300, 2), 0.9]),
  // The carriage hits its margin stop.
  thunk: () =>
    mix(
      [lowpass(burst(0.12, decay(0.018), 8), 900), 1.2],
      [tone(0.2, 110, 70, 0.05), 0.8],
      [bandpass(burst(0.06, decay(0.006), 9), 2100, 1.2), 0.5],
    ),
  // The platen's ratchet clicks over a line.
  ratchet: () =>
    mix(
      [bandpass(burst(0.02, decay(0.002), 10), 1800, 1.6), 1.2],
      [tone(0.03, 780, 700, 0.006), 0.25],
    ),
  // The return lever thrown.
  lever: () =>
    mix([lowpass(burst(0.06, decay(0.01), 11), 1500), 0.8], [tone(0.08, 260, 180, 0.02), 0.4]),
  // The bell: a small dome, struck once, its partials dying at their own speeds.
  bell: () => {
    const f = 2350;
    return mix(
      [tone(1.6, f, f, 0.5), 0.5],
      [tone(1.6, f * 1.003, f * 1.003, 0.45), 0.35],
      [tone(0.9, f * 2.76, f * 2.76, 0.18), 0.22],
      [tone(0.5, f * 5.4, f * 5.4, 0.07), 0.1],
      [bandpass(burst(0.01, decay(0.001), 12), 6000, 1), 0.3],
    );
  },
  // The correction tape rubbed over a letter.
  tape: () => {
    const x = burst(0.14, (t) => Math.sin(Math.PI * Math.min(1, t / 0.14)) ** 2, 13);
    return mix([bandpass(x, 1700, 0.7), 0.6], [bandpass(burst(0.01, decay(0.001), 14), 2600, 1), 0.5]);
  },
  // Paper pulled out of the machine: a dry rip, crackling.
  tear: () => {
    const r = noise(15);
    const len = 0.5;
    const x = burst(len, (t) => {
      const shape = Math.min(1, t / 0.03) * Math.max(0, 1 - t / len) ** 0.6;
      return shape * (0.35 + 0.65 * Math.max(0, r()) ** 3);
    }, 16);
    return mix([bandpass(x, 2400, 0.6), 1.4], [lowpass(burst(len, (t) => Math.max(0, 1 - t / len) * 0.3, 17), 500), 0.6]);
  },
};

/** Least time between two of a sound (s): a fast run of strikes doesn't pile up into noise. */
const SPACING: Partial<Record<SoundName, number>> = {
  clack: 0.012,
  key: 0.012,
  tick: 0.01,
  zip: 0.004,
  ratchet: 0.02,
  thunk: 0.08,
  bell: 0.25,
};

export class Sounds {
  /** 0 is silent. */
  volume = 0.7;
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private buffers = new Map<SoundName, AudioBuffer>();
  private last = new Map<SoundName, number>();
  private off = new AbortController();

  constructor() {
    if (typeof window === 'undefined') return;
    const wake = () => this.start();
    for (const type of ['pointerdown', 'keydown', 'touchend'])
      window.addEventListener(type, wake, { capture: true, signal: this.off.signal });
  }

  /** Make the context (on a touch or a key: browsers won't before). */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Context =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    const ctx = (this.ctx = new Context());
    // A gentle limiter, so a burst of strikes can't clip.
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -10;
    limit.knee.value = 8;
    limit.ratio.value = 6;
    limit.attack.value = 0.002;
    limit.release.value = 0.12;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(limit).connect(ctx.destination);
    for (const [name, make] of Object.entries(RECIPES) as [SoundName, () => Float32Array][]) {
      const samples = make();
      const buffer = ctx.createBuffer(1, samples.length, RATE);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(name, buffer);
    }
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  play(e: SoundEvent) {
    const ctx = this.ctx;
    if (!ctx || !this.out || this.volume <= 0 || ctx.state !== 'running') return;
    const buffer = this.buffers.get(e.name);
    if (!buffer) return;
    const now = ctx.currentTime;
    const gap = SPACING[e.name] ?? 0;
    if (now - (this.last.get(e.name) ?? -1) < gap) return;
    this.last.set(e.name, now);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    // No two alike: a little pitch and level wander.
    src.playbackRate.value = 1 + (Math.random() - 0.5) * (e.name === 'bell' ? 0.01 : 0.09);
    const gain = ctx.createGain();
    gain.gain.value = (e.gain ?? 1) * (0.88 + Math.random() * 0.24);
    let node: AudioNode = src.connect(gain);
    if (e.pan && ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, e.pan));
      node = node.connect(pan);
    }
    node.connect(this.out);
    src.start();
  }

  dispose() {
    this.off.abort();
    void this.ctx?.close();
    this.ctx = null;
  }
}
