/** Small numeric helpers shared by every module (each used to keep its own copy). */

export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
export const lerp = (from, to, t) => from + (to - from) * t;
/** Frame-rate independent smoothing toward a target; `rate` is per second. */
export const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
export const easeInOut = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - (1 - t) * (1 - t);

export function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}
