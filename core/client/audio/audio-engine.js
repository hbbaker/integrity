/*
 * Tiny Web Audio synth, with no samples: every sound is an oscillator sweep and/or a filtered noise burst.
 * The AudioContext is created on the first user gesture (browsers block audio before that).
 * A game extends this class with its own sounds (see game/audio.js) using _tone and _noise.
 */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.muted = false;
    this.bus = null; // where tones and noise go: master, or a quieter gain for distant sounds
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      this.noise = this._makeNoiseBuffer();
      this.bus = this.master;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.45;
    return this.muted;
  }

  _makeNoiseBuffer() {
    const length = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Oscillator that sweeps f0 -> f1 with a fast decay envelope. */
  _tone(type, f0, f1, duration, gain, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + duration);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(amp).connect(this.bus);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  /** Filtered noise burst with a decay envelope. */
  _noise(duration, filterType, f0, f1, gain, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + duration);
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(amp).connect(this.bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + duration + 0.02);
  }

  /**
   * Run `play()` so everything it makes is quieter the further away it is: gain 1 / (1 + distance / range).
   * `range` is the distance at which the sound is half as loud.
   */
  playAt(distance, range, play) {
    if (!this.ctx || this.muted) return;
    const gain = this.ctx.createGain();
    gain.gain.value = 1 / (1 + distance / range);
    gain.connect(this.master);
    this.bus = gain;
    play();
    this.bus = this.master;
  }
}
