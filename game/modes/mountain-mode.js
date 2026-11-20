import { GameMode } from '../../core/client/modes/game-mode.js';

/**
 * MOUNTAIN: ride a course on skis or on a board. The rules are in game/rules/ski-run.js. The mode moves
 * the player itself, takes the look input for its chase camera, and places that camera.
 */
export class MountainMode extends GameMode {
  /** @param deps { skiRun, config } config = CONFIG.ski */
  constructor({ skiRun, config }) {
    super('mountain');
    this.skiRun = skiRun;
    this.config = config;
  }

  get setup() {
    return { level: 'mountain', fog: this.config.fog, invulnerable: true };
  }

  get stepsPlayer() { return false; }

  get allowsInventory() { return false; }

  /** `options` is { course } or null (start the last course again). */
  start(options) {
    this.skiRun.start(options);
  }

  stop() {
    this.skiRun.stop();
  }

  fixedUpdate(dt, input) {
    this.skiRun.fixedUpdate(dt, input);
  }

  update(dt) {
    this.skiRun.update(dt);
  }

  look(dx, dy) {
    this.skiRun.look(dx, dy);
    return true;
  }

  applyCamera(alpha, dt) {
    this.skiRun.applyCamera(alpha, dt);
    return true;
  }
}
