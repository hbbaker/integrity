/*
 * A damped spring: a value that follows a target the way a weight on a spring would. Use it for motion
 * that must lag behind what drives it and then catch up (a body that sways, a view that settles).
 */

const MAX_SUBSTEP = 1 / 120; // seconds: a long frame is cut into steps this short, so the spring stays stable

export class DampedSpring {
  /**
   * @param frequency how fast it follows, in cycles per second
   * @param damping 1 settles with no overshoot; below 1 it overshoots and swings back
   * @param value where it starts
   */
  constructor(frequency, damping = 1, value = 0) {
    this.stiffness = (2 * Math.PI * frequency) ** 2;
    this.friction = 2 * damping * 2 * Math.PI * frequency;
    this.value = value;
    this.velocity = 0;
  }

  /** Put the spring at rest at `value`. */
  reset(value = 0) {
    this.value = value;
    this.velocity = 0;
  }

  /** Move toward `target` for `dt` seconds. Returns the new value. */
  step(target, dt) {
    for (let left = dt; left > 0; left -= MAX_SUBSTEP) {
      const slice = Math.min(left, MAX_SUBSTEP);
      this.velocity += (this.stiffness * (target - this.value) - this.friction * this.velocity) * slice;
      this.value += this.velocity * slice;
    }
    return this.value;
  }
}
