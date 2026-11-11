/*
 * CABLE BOTS sound effects, built on the core's synth (core/client/audio/audio-engine.js).
 * Press M to mute.
 */
import { AudioEngine } from '../core/client/audio/audio-engine.js';

// Two-tone pairs used for the dial-up "handshake" (roughly DTMF keypad tones).
const DIAL_LOW = [697, 770, 852, 941];
const DIAL_HIGH = [1209, 1336, 1477];

// Distance at which a remote gunshot is half as loud.
const DISTANT_SOUND_RANGE = 14;

export class AudioFX extends AudioEngine {
  constructor() {
    super();
    this._beam = null; // nodes of the running raygun hum
  }

  shoot(id) {
    switch (id) {
      case 'pistol':
        this._noise(0.09, 'lowpass', 3500, 600, 0.9);
        this._tone('square', 420, 70, 0.11, 0.35);
        break;
      case 'shotgun':
        this._noise(0.32, 'lowpass', 2200, 200, 1.2);
        this._tone('sawtooth', 160, 35, 0.3, 0.5);
        break;
      case 'sniper':
        this._noise(0.5, 'lowpass', 5000, 150, 1.4);
        this._tone('sawtooth', 220, 28, 0.45, 0.6);
        this._tone('sine', 90, 25, 0.5, 0.7);
        this._noise(0.05, 'highpass', 4000, 3000, 0.8); // sharp crack
        break;
      case 'smg':
        this._noise(0.05, 'bandpass', 3200, 900, 0.7);
        this._tone('square', 320, 90, 0.06, 0.22);
        break;
      case 'drill':
        this._noise(0.5, 'lowpass', 1800, 120, 1.3);
        this._tone('sawtooth', 140, 40, 0.5, 0.55);
        this._tone('square', 70, 180, 0.35, 0.3, 0.05); // the motor spooling up
        break;
      default:
        break;
    }
  }

  /** A drill head biting into a surface: a hard thud, a grinding rasp and a ring. Quieter with `distance` metres. */
  drillImpact(distance = 0) {
    this.playAt(distance, DISTANT_SOUND_RANGE, () => {
      this._tone('sine', 110, 40, 0.3, 0.7);
      this._noise(0.4, 'bandpass', 700, 250, 0.9);
      this._tone('square', 900, 300, 0.25, 0.2, 0.04);
    });
  }

  /** A gunshot heard from `distance` metres away: quieter the further it is. */
  shootAt(id, distance) {
    this.playAt(distance, DISTANT_SOUND_RANGE, () => this.shoot(id));
  }

  /** The fiber reel firing: a hiss of cable paying out and a quick rising zip. */
  grapple() {
    this._noise(0.22, 'bandpass', 900, 5200, 0.7);
    this._tone('sawtooth', 220, 880, 0.18, 0.3);
    this._tone('square', 1400, 300, 0.12, 0.15, 0.1);
  }

  /** A shovel biting into earth: a dull thump and a scrape. Deeper layers sound lower. */
  dig(depthInches = 6) {
    const low = Math.max(60, 150 - depthInches * 0.6);
    this._tone('sine', low * 1.6, low * 0.5, 0.14, 0.5);
    this._noise(0.18, 'bandpass', 900, 300, 0.45);
  }

  /** The same sound from another player, quieter with distance. */
  digAt(distance, depthInches) {
    this.playAt(distance, DISTANT_SOUND_RANGE, () => this.dig(depthInches));
  }

  /** A buried line was hit: a harsh zap and a thud. */
  strike() {
    this._tone('sawtooth', 320, 50, 0.35, 0.55);
    this._tone('square', 120, 40, 0.4, 0.4);
    this._noise(0.3, 'lowpass', 2500, 200, 0.7);
  }

  punch(hit) {
    if (hit) {
      this._noise(0.09, 'lowpass', 700, 150, 1.0);
      this._tone('sine', 180, 45, 0.14, 0.7);
    } else {
      this._noise(0.14, 'bandpass', 500, 2200, 0.35); // whoosh
    }
  }

  dry() {
    this._tone('square', 1500, 1200, 0.03, 0.15);
  }

  /** Reload mechanism ticks. */
  click(kind = 'mag') {
    if (kind === 'pump') {
      this._noise(0.05, 'highpass', 1500, 800, 0.5);
      this._tone('square', 300, 150, 0.07, 0.25, 0.05);
    } else if (kind === 'shell') {
      this._tone('square', 900, 500, 0.04, 0.2);
      this._noise(0.03, 'highpass', 3000, 2000, 0.3);
    } else {
      this._noise(0.035, 'highpass', 2500, 1500, 0.5);
      this._tone('square', 700, 350, 0.05, 0.18);
    }
  }

  hitBeep(crit) {
    if (crit) {
      this._tone('square', 1400, 1700, 0.06, 0.2);
      this._tone('square', 1800, 2100, 0.06, 0.18, 0.05);
    } else {
      this._tone('square', 880, 700, 0.05, 0.16);
    }
  }

  enemyKill() {
    this._tone('square', 700, 500, 0.07, 0.2);
    this._tone('square', 500, 300, 0.07, 0.2, 0.07);
    this._tone('square', 300, 120, 0.12, 0.2, 0.14);
    this._noise(0.15, 'lowpass', 1800, 300, 0.4);
  }

  hurt() {
    this._tone('sawtooth', 240, 70, 0.25, 0.45);
    this._noise(0.12, 'lowpass', 900, 200, 0.5);
  }

  /** Continuous raygun hum: detuned saw + square through a low-pass, tremolo'd by an LFO. */
  beamStart() {
    if (!this.ctx || this.muted || this._beam) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.3, t + 0.06);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2000;
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = 140;
    const square = ctx.createOscillator();
    square.type = 'square';
    square.frequency.value = 281;
    const squareGain = ctx.createGain();
    squareGain.gain.value = 0.3;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 26;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.1;
    lfo.connect(lfoGain).connect(amp.gain);
    saw.connect(filter);
    square.connect(squareGain).connect(filter);
    filter.connect(amp).connect(this.master);
    saw.start(t);
    square.start(t);
    lfo.start(t);
    this._beam = { saw, square, lfo, amp, filter };
  }

  /** Pitch and brightness fall with beam power, so you can hear it weaken. */
  beamSet(power) {
    if (!this._beam) return;
    const t = this.ctx.currentTime;
    this._beam.saw.frequency.setTargetAtTime(70 + power * 75, t, 0.05);
    this._beam.square.frequency.setTargetAtTime(141 + power * 150, t, 0.05);
    this._beam.filter.frequency.setTargetAtTime(600 + power * 1700, t, 0.05);
  }

  beamStop() {
    if (!this._beam) return;
    const { saw, square, lfo, amp } = this._beam;
    this._beam = null;
    const t = this.ctx.currentTime;
    amp.gain.cancelScheduledValues(t);
    amp.gain.setTargetAtTime(0.0001, t, 0.04);
    for (const osc of [saw, square, lfo]) osc.stop(t + 0.25);
  }

  /** Rising whine while the raygun recharges a cell. */
  recharge(duration) {
    this._tone('sine', 160, 1200, duration, 0.2);
    this._tone('triangle', 80, 600, duration, 0.18);
  }

  pickup() {
    this._tone('sine', 600, 1200, 0.12, 0.3);
    this._tone('sine', 900, 1500, 0.12, 0.25, 0.08);
  }

  jump() {
    this._tone('sine', 220, 420, 0.1, 0.12);
  }

  land(impact) {
    this._noise(0.08, 'lowpass', 500, 120, Math.min(0.6, impact * 0.04));
  }

  /** Grabbing a ledge: a short scrape and a low grunt-like thump as you pull up. */
  mantle() {
    this._noise(0.25, 'bandpass', 700, 300, 0.3);
    this._tone('sine', 140, 70, 0.2, 0.35, 0.1);
  }

  slide() {
    this._noise(0.6, 'bandpass', 1800, 400, 0.25);
  }

  /** Dial-up modem screech: keypad tones, then a sweeping square wobble. */
  deathDialup() {
    if (!this.ctx || this.muted) return;
    for (let i = 0; i < 10; i++) {
      const low = DIAL_LOW[i % DIAL_LOW.length];
      const high = DIAL_HIGH[(i * 2) % DIAL_HIGH.length];
      this._tone('sine', low, low, 0.07, 0.18, i * 0.1);
      this._tone('sine', high, high, 0.07, 0.18, i * 0.1);
    }
    this._tone('sine', 2100, 2100, 0.5, 0.18, 1.1); // answer tone
    for (let i = 0; i < 14; i++) {
      const f = 1200 + Math.random() * 1800;
      this._tone('square', f, f * (0.7 + Math.random() * 0.6), 0.09, 0.14, 1.6 + i * 0.09);
    }
    this._noise(1.2, 'bandpass', 900, 3000, 0.35, 1.6);
  }
}
