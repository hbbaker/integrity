/*
 * The game loop: a fixed-timestep simulation with interpolated rendering.
 *
 * Each animation frame: the game's `beginFrame` says whether the simulation should run (the pointer is
 * locked, a match is on, ...); if so, `fixedUpdate` runs in fixed steps to catch up with real time; then
 * `endFrame` (per-frame work such as HUD and mode updates) and `render(alpha, dt)`, where alpha is how
 * far between two simulation steps the picture is, so motion stays smooth at any frame rate.
 */

export class GameLoop {
  /**
   * @param options { fixedStep, maxFrameDelta, maxStepsPerFrame } seconds, seconds, count
   * @param hooks { beginFrame(dt) -> playing, fixedUpdate(step), endFrame(dt, playing), render(alpha, dt) }
   */
  constructor({ fixedStep, maxFrameDelta, maxStepsPerFrame }, hooks) {
    this.fixedStep = fixedStep;
    this.maxFrameDelta = maxFrameDelta; // clamp so a tab switch cannot cause a giant catch-up
    this.maxStepsPerFrame = maxStepsPerFrame;
    this.hooks = hooks;
    this.time = 0; // seconds of real time the loop has run
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.frame = this.frame.bind(this);
  }

  start() {
    requestAnimationFrame(this.frame);
  }

  /** Forget unspent time (a new level starts: no steps should be owed). */
  resetAccumulator() {
    this.accumulator = 0;
  }

  frame(now) {
    requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.lastTime) / 1000, this.maxFrameDelta);
    this.lastTime = now;
    this.time += dt;

    const playing = this.hooks.beginFrame(dt);
    let alpha = 1;
    if (playing) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= this.fixedStep && steps < this.maxStepsPerFrame) {
        this.hooks.fixedUpdate(this.fixedStep);
        this.accumulator -= this.fixedStep;
        steps += 1;
      }
      if (steps === this.maxStepsPerFrame) this.accumulator = 0; // way behind: drop the backlog
      alpha = this.accumulator / this.fixedStep;
    }
    this.hooks.endFrame(dt, playing);
    this.hooks.render(alpha, dt);
  }
}
