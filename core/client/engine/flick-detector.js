/*
 * FLICK DETECTOR: tells a quick, deliberate flick of the mouse or a stick from ordinary movement.
 * Feed it every look movement; it adds them up over a short moment, and when that sum is large enough it
 * reports one flick: left, right, up or down, with a strength. Then it rests for a moment, so one hand
 * movement is one flick.
 */

export class FlickDetector {
  /**
   * @param config {
   *   window (seconds the movement is added up over), threshold (movement that counts as a flick),
   *   full (movement of a full-strength flick), cooldown (seconds of rest after a flick)
   * } Movement is in the units of the look input (pixels for a mouse).
   */
  constructor(config) {
    this.config = config;
    this.reset();
  }

  /** Forget the movement so far. */
  reset() {
    this.sumX = 0;
    this.sumY = 0;
    this.rest = 0;
  }

  /** A look movement: `dx` to the right, `dy` down. */
  add(dx, dy) {
    if (this.rest > 0) return;
    this.sumX += dx;
    this.sumY += dy;
  }

  /**
   * Once per step. Returns null, or one flick: { x, y, strength }. Only the stronger direction counts:
   * x is -1 (left) or +1 (right) with y 0, or y is -1 (up) or +1 (down) with x 0. `strength` is 0..1.
   */
  update(dt) {
    const c = this.config;
    if (this.rest > 0) {
      this.rest -= dt;
      return null;
    }
    const horizontal = Math.abs(this.sumX) >= Math.abs(this.sumY);
    const size = horizontal ? Math.abs(this.sumX) : Math.abs(this.sumY);
    if (size < c.threshold) {
      const keep = Math.exp(-dt / c.window); // old movement fades: only a quick one adds up
      this.sumX *= keep;
      this.sumY *= keep;
      return null;
    }
    const flick = {
      x: horizontal ? Math.sign(this.sumX) : 0,
      y: horizontal ? 0 : Math.sign(this.sumY),
      strength: Math.min(1, (size - c.threshold) / (c.full - c.threshold)),
    };
    this.reset();
    this.rest = c.cooldown;
    return flick;
  }
}
