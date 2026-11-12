import { clamp } from '../../core/client/engine/math.js';

/*
 * Timing for stepping into the suit. Pure functions of elapsed time, like swing-poses.js.
 * Stepping out plays the same timeline backwards.
 *
 *   open   : the back hatch, the limb shells and the limbs swing open
 *   step   : the human walks into the suit from behind
 *   close  : everything swings shut around them
 */

const smooth = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

export function totalTime(times) {
  return times.open + times.step + times.close;
}

/**
 * @param {number} t seconds into the step-in
 * @param {{open: number, step: number, close: number}} times
 * @returns {{ open: number, step: number }} open: 0 shut .. 1 wide open; step: 0 .. 1 progress of the walk in
 */
export function enterTimeline(t, times) {
  const closeStart = times.open + times.step;
  const open = t < closeStart ? smooth(t / times.open) : 1 - smooth((t - closeStart) / times.close);
  return { open, step: clamp((t - times.open) / times.step, 0, 1) };
}

const STRIDES = 3; // full leg swings during the walk in

/**
 * Where the human is during the walk.
 * @param {number} step 0 .. 1 from `enterTimeline`
 * @returns {{ travel: number, swing: number, phase: number, stride: number }} travel: 0 at the start .. 1 inside the suit;
 *   swing: how far the legs and arms swing (0 when standing, fading in and out so the walk starts and stops softly);
 *   phase: where the human is in their stride, in radians; stride: 0 standing .. 1 walking
 */
export function walkerPose(step) {
  const travel = smooth(step);
  const stride = clamp(Math.sin(Math.PI * step) * 3, 0, 1);
  const phase = step * STRIDES * 2 * Math.PI;
  return { travel, swing: Math.sin(phase) * stride, phase, stride };
}
