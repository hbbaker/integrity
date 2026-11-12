import { BodyRig } from './body-rig.js';
import { HUMANOID_MATERIALS } from './humanoid.js';
import { YBotSkin, loadYBot } from './y-bot.js';

/*
 * The first-person arms: the Y Bot's arms and hands (nothing else is drawn), reaching from behind the
 * camera to wherever the item model wants its hands. The model keeps animating plain hand positions
 * (a sway, a punch); each frame the arms are solved with IK to put the wrists there.
 *
 * Everything is in the viewmodel's space, where the camera is at the origin looking down -Z.
 */

const SCALE = 1.7; // first-person arms are drawn big, as in any shooter, so a punch can reach
const SHOULDER_Y = -0.5; // the shoulders sit below the screen and just behind the camera
const SHOULDER_Z = 0.05;
const FIST = 1;
const PALM_IN = 1.2; // radians: knuckles forward, thumbs up

export class YBotViewArms {
  /** @param {{ load?: Function, onReady?: () => void }} [options] `onReady` runs when the model has loaded and the arms can be shown */
  constructor({ load = loadYBot, onReady = null } = {}) {
    this.body = new BodyRig(HUMANOID_MATERIALS); // an empty rig: the skin needs a frame of reference to hang on
    this.object = this.body.root;
    this.object.scale.setScalar(SCALE);
    this.object.visible = false; // until the model has loaded
    this.onReady = onReady;
    this.skin = new YBotSkin(this.body, { load, armsOnly: true, onReady: () => this._ready() });
  }

  get ready() {
    return this.skin.ready;
  }

  _ready() {
    const shoulder = this.skin.restShoulder('Right');
    this.object.position.set(0, SHOULDER_Y - shoulder.y * SCALE, SHOULDER_Z - shoulder.z * SCALE);
    this.skin.setGrip(FIST);
    this.object.visible = true;
    this.onReady?.();
  }

  /** Put the left and right wrists on two positions in the viewmodel's space. Call after the item's hands have been placed this frame. */
  follow(left, right) {
    if (!this.skin.ready) return;
    this.skin.reach('Left', left, { roll: PALM_IN });
    this.skin.reach('Right', right, { roll: PALM_IN });
  }
}
