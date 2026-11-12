import * as THREE from 'three';
import { loadYBot } from '../assets/y-bot.js';
import { totalTime } from '../suit/enter-poses.js';
import { defaultSelection } from '../suit/suit-parts.js';
import { SUIT_MODE } from '../suit/suit-network.js';
import { SuitStage } from './suit-stage.js';

/*
 * Another player's suit, shown from the suit fields of their state messages (see suit-network.js).
 *
 *   dropping   the suit is falling out of the sky onto their beacon
 *   standing   the empty suit stands where it landed, and is a solid obstacle
 *   entering   it opens and the human walks in from behind
 *   piloted    their body is the suit (the avatar takes the suit's look and size)
 *   exiting    the same thing backwards
 *   lifting    the suit is rising back into the sky
 *
 * The step-in is timed here from the moment the state changes, the same timeline their own game plays.
 * Each state message says everything, so a missed one costs nothing.
 */

export class RemoteSuit {
  /**
   * @param {object} options
   * @param {THREE.Scene} options.scene
   * @param {import('../world/world.js').World} options.world
   * @param {object} options.config CONFIG.suit
   * @param {import('../assets/cyborg.js').Cyborg} options.cyborg the avatar (a rigged cyborg)
   * @param {{ pos: THREE.Vector3 }} options.view the avatar's player view: where the human starts walking from
   * @param {() => Promise<object | null>} [options.skinLoader] replaces the human model loader (tests)
   */
  constructor({ scene, world, config, cyborg, view, skinLoader = loadYBot }) {
    this.world = world;
    this.config = config;
    this.cyborg = cyborg;
    this.view = view;
    this.selection = defaultSelection();
    this.stage = new SuitStage({ scene, world, config, selection: this.selection, skinLoader });
    this.mode = SUIT_MODE.NONE;
    this.time = 0;
    this.direction = 1;
    this.total = totalTime(config.enterTimes);
    this.walkStart = new THREE.Vector3();
    this.collider = null;
    this.sky = null; // the suit's fall or rise: { kind: 'drop' | 'lift', time }; a landing's glow carries on after "standing" arrives
  }

  /** How much bigger than a human this player is right now. */
  get scale() {
    return this.mode === SUIT_MODE.PILOTED ? this.config.scale : 1;
  }

  get busy() {
    return this.mode === SUIT_MODE.ENTERING || this.mode === SUIT_MODE.EXITING;
  }

  /** The suit from the latest state message: `{ mode, x, z, yaw, selection }` (see decodeSuit), or null for none. */
  apply(info) {
    if (info) this._fitParts(info.selection);
    const mode = info ? info.mode : SUIT_MODE.NONE;
    if (mode !== this.mode) this._change(mode, info);
    else if (mode === SUIT_MODE.STANDING && this._moved(info)) this._stand(info);
  }

  _fitParts(selection) {
    for (const slot of Object.keys(selection)) {
      if (selection[slot] === this.selection[slot]) continue;
      this.selection[slot] = selection[slot];
      this.stage.setPart(slot, selection[slot]);
      if (this.mode === SUIT_MODE.PILOTED) this.cyborg.setSuitPart(slot, selection[slot]);
    }
  }

  _moved(info) {
    return Math.hypot(info.x - this.stage.position.x, info.z - this.stage.position.z) > 0.01;
  }

  _change(mode, info) {
    if (this.mode === SUIT_MODE.PILOTED) this.cyborg.setSuit(null);
    if (this.busy) this.stage.showWalker(false);
    this.cyborg.suppressed = false;
    this._removeCollider();
    const was = this.mode;
    this.mode = mode;
    if (!(mode === SUIT_MODE.STANDING && was === SUIT_MODE.DROPPING)) this.sky = null;

    switch (mode) {
      case SUIT_MODE.DROPPING:
        this.stage.stand(info.x, info.z, info.yaw);
        this.sky = { kind: 'drop', time: 0 };
        break;
      case SUIT_MODE.LIFTING:
        this.stage.stand(info.x, info.z, info.yaw);
        this.sky = { kind: 'lift', time: 0 };
        break;
      case SUIT_MODE.STANDING:
        if (this.sky) this._addCollider(); // it has just landed: its glow carries on
        else this._stand(info);
        break;
      case SUIT_MODE.ENTERING:
        this.stage.stand(info.x, info.z, info.yaw);
        this._beginStep(1);
        this.walkStart.copy(this.view.pos); // they walk in from where they were standing
        break;
      case SUIT_MODE.EXITING:
        this.stage.stand(info.x, info.z, info.yaw);
        this._beginStep(-1);
        this.stage.behind(this.config.walkBehind, this.walkStart);
        break;
      case SUIT_MODE.PILOTED:
        this.stage.hide();
        this.cyborg.setSuit(this.selection, this.config.scale);
        this.cyborg.bodyYaw = info.yaw;
        break;
      default:
        this.stage.hide();
    }
  }

  _stand(info) {
    this.stage.stand(info.x, info.z, info.yaw);
    this._addCollider();
  }

  _beginStep(direction) {
    this.direction = direction;
    this.time = direction > 0 ? 0 : this.total;
    this.cyborg.suppressed = true; // the avatar's own body gives way to the walking human
    this.stage.showWalker(true);
  }

  _addCollider() {
    this._removeCollider();
    const { width, height } = this.config.collider;
    const size = width * this.config.scale;
    const { x, z } = this.stage.position;
    this.collider = this.world.addCollider(x, z, size, height * this.config.scale, size);
  }

  _removeCollider() {
    if (this.collider) this.world.removeCollider(this.collider);
    this.collider = null;
  }

  /** Advance the step-in. It waits at its end for the next state message to say what happened. */
  update(dt) {
    if (this.sky) this.sky.time += dt;
    if (!this.busy) return;
    this.time = THREE.MathUtils.clamp(this.time + dt * this.direction, 0, this.total);
  }

  /** Pose the suit and the human for this frame. */
  animate() {
    if (this.busy) this.stage.pose(this.time, this.direction, this.walkStart);
    if (!this.sky) return;
    const done = this.sky.kind === 'drop' ? this.stage.drop(this.sky.time) : this.stage.lift(this.sky.time);
    if (done) this.sky = null;
  }

  dispose() {
    this._removeCollider();
    this.stage.dispose();
  }
}
