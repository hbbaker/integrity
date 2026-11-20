/*
 * Seeded randomness for procedural content: the same seed always gives the same numbers, so
 * whatever is built from them (a texture, a level) is the same on every run.
 */

import { lerp } from './math.js';

const HASH_X = 374761393; // large odd numbers that spread neighbouring lattice points apart
const HASH_Y = 668265263;
const HASH_MIX = 1274126177;
const HALF_UINT32 = 2147483647.5; // maps an unsigned 32-bit integer onto [0, 2]
const LAYER_SHIFT = 37.7; // each noise layer reads a different part of the noise, so the layers do not line up

/** A small deterministic random generator: each call returns the next number in [0, 1). */
export function seededRandom(seed) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The fixed random value in [-1, 1] that belongs to one whole-number point. */
function latticeValue(ix, iy, seed) {
  let hash = Math.imul(ix, HASH_X) ^ Math.imul(iy, HASH_Y) ^ seed;
  hash = Math.imul(hash ^ (hash >>> 13), HASH_MIX);
  return ((hash ^ (hash >>> 16)) >>> 0) / HALF_UINT32 - 1;
}

/** Eases 0..1 with zero slope and zero curvature at both ends, so noise cells join without creases. */
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth 2D value noise: the returned noise(x, y) is in [-1, 1] and changes about once per unit. */
export function createValueNoise(seed) {
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const near = lerp(latticeValue(ix, iy, seed), latticeValue(ix + 1, iy, seed), fx);
    const far = lerp(latticeValue(ix, iy + 1, seed), latticeValue(ix + 1, iy + 1, seed), fx);
    return lerp(near, far, fy);
  };
}

/** A sum of noise layers at (x, y). `layers` is [{ wavelength, amplitude }], both in the caller's units. */
export function layeredNoise(noise, x, y, layers) {
  let sum = 0;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    sum += noise(x / layer.wavelength + i * LAYER_SHIFT, y / layer.wavelength - i * LAYER_SHIFT) * layer.amplitude;
  }
  return sum;
}
