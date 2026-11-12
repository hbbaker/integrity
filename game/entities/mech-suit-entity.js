import * as THREE from 'three';
import { loadYBot } from '../assets/y-bot.js';
import { totalTime } from '../suit/enter-poses.js';
import { SUIT_MODE } from '../suit/suit-network.js';
import { SuitStage, facingYaw } from './suit-stage.js';
import { suitBodyOverrides } from '../suit/suit-body.js';
import { aggregateSuitStats } from '../suit/suit-stats.js';
import { buildBeaconBody } from '../weapons/suit-beacon.js';

/*
 * The suit in the world, and the player getting in and out of it.
 *
 *   stowed    no suit in the world
 *   dropping  the suit is falling out of the sky onto a beacon you threw
 *   standing  the empty suit stands where it landed
 *   entering  third-person step-in: the back and limbs open, the human walks in from behind, everything shuts
 *   piloted   the player wears the suit (the player's body is the suit)
 *   exiting   the same thing backwards: it opens and the human walks out of the back
 *   lifting   the suit is rising back into the sky after a recall beacon
 *
 * The suit is called with a handheld beacon (the character screen arms it, the fire button throws it): a deploy beacon
 * calls the suit down where it lands, a recall beacon sends a standing suit back up. The suit lands facing the way you
 * were facing, so its back is toward you.
 *
 * While you step in or out nothing can hurt you. In the suit your health is the suit's multiple of your own (CONFIG.suit
 * baseline `healthMul`), keeping the same fraction when you get in and out.
 */

const STATES = Object.freeze({
  STOWED: 'stowed', DROPPING: 'dropping', STANDING: 'standing', ENTERING: 'entering', PILOTED: 'piloted', EXITING: 'exiting', LIFTING: 'lifting',
});

/** The key presses and axes of a player who is doing nothing. */
export const IDLE_INPUT = {
  forward: false, back: false, left: false, right: false,
  sprintHeld: false, fireHeld: false, aimHeld: false, boardHeld: false, crouchHeld: false, leanLeft: false, leanRight: false,
  jumpPressed: false, slidePressed: false, sprintPressed: false, firePressed: false, ammoPressed: false,
  reloadPressed: false, meleePressed: false, interactPressed: false, selectSlot: -1, wheel: 0,
  analogActive: false, analogX: 0, analogY: 0,
};

const NETWORK_MODE = {
  [STATES.DROPPING]: SUIT_MODE.DROPPING, [STATES.STANDING]: SUIT_MODE.STANDING, [STATES.ENTERING]: SUIT_MODE.ENTERING,
  [STATES.PILOTED]: SUIT_MODE.PILOTED, [STATES.EXITING]: SUIT_MODE.EXITING, [STATES.LIFTING]: SUIT_MODE.LIFTING,
};

export const BEACON = Object.freeze({ DEPLOY: 'deploy', RECALL: 'recall' });
const BEACON_SCALE = 1.6; // the thrown beacon is drawn bigger than the one in the hand, so it can be seen from afar
const BEACON_START = 0.5; // metres in front of the eye where a thrown beacon starts
const BEACON_BLINK = 9; // blinks per second of a landed beacon
const BEACON_SPIN = 6; // radians per second of a beacon in the air

export class MechSuit {
  /**
   * @param {object} options
   * @param {THREE.Scene} options.scene
   * @param {import('../world/world.js').World} options.world
   * @param {import('../../core/client/character/player.js').Player} options.player
   * @param {import('../assets/cyborg.js').Cyborg} options.cyborg a rigged cyborg (the player's body)
   * @param {object} options.hud needs setSuitMode(on), setPrompt(text) and banner(text)
   * @param {import('../suit/suit-state.js').SuitState} options.suitState
   * @param {object} options.config CONFIG.suit
   * @param {object} options.playerConfig CONFIG.player
   * @param {() => string} [options.keyLabel] the name of the use key, for the prompt
   * @param {() => Promise<object | null>} [options.skinLoader] replaces the human model loader (tests)
   */
  constructor({ scene, world, player, cyborg, hud, suitState, config, playerConfig, keyLabel = () => 'V', skinLoader = loadYBot }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.cyborg = cyborg;
    this.hud = hud;
    this.suitState = suitState;
    this.config = config;
    this.playerConfig = playerConfig;
    this.keyLabel = keyLabel;

    this.state = STATES.STOWED;
    this.time = 0; // seconds into the step-in timeline
    this.direction = 1; // +1 entering, -1 exiting
    this.total = totalTime(config.enterTimes);
    this.walkStart = new THREE.Vector3(); // where the human stands behind the suit
    this.collider = null;
    this.previousView = false;
    this.armed = null; // which beacon is in hand: 'deploy', 'recall' or null
    this.beacon = null; // a thrown beacon: { mode, object, cap, position, velocity, yaw, flight, landed, timer }
    this.sky = null; // the suit's fall or rise: { kind: 'drop' | 'lift', time }

    this.stage = new SuitStage({ scene, world, config, selection: suitState.selection, skinLoader });
    this._aim = { origin: new THREE.Vector3(), forward: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
    this._step = new THREE.Vector3();
    this._direction = new THREE.Vector3();

    suitState.onChange(({ slot }) => this._onSuitChanged(slot));
  }

  /** What the stage shows: the suit, the human who walks into it, and where it stands. */
  get group() { return this.stage.group; }
  get body() { return this.stage.body; }
  get walker() { return this.stage.walker; }
  get position() { return this.stage.position; }
  get yaw() { return this.stage.yaw; }

  get busy() {
    return this.state === STATES.ENTERING || this.state === STATES.EXITING;
  }

  get piloted() {
    return this.state === STATES.PILOTED;
  }

  /** The beacon in hand ('deploy' or 'recall'), or null. */
  get armedMode() {
    return this.armed;
  }

  /** What the simulation should see as input this step: nothing, while the step-in plays. */
  filterInput(input) {
    return this.busy ? IDLE_INPUT : input;
  }

  /* ------------------------------ beacons -------------------------------- */

  /** True when a deploy beacon can be armed: you own the suit and it is in your pack. */
  canPlace() {
    return this.player.alive && this.suitState.owned && this.state === STATES.STOWED && !this.beacon;
  }

  /** True when a recall beacon can be armed: the empty suit is standing in the world. */
  canPickUp() {
    return this.player.alive && this.state === STATES.STANDING && !this.beacon;
  }

  /** Arm a beacon (BEACON.DEPLOY or BEACON.RECALL): the game then puts it in your hand. Returns false when it cannot be used now. */
  arm(mode) {
    const allowed = mode === BEACON.DEPLOY ? this.canPlace() : mode === BEACON.RECALL && this.canPickUp();
    if (allowed) this.armed = mode;
    return allowed;
  }

  disarm() {
    this.armed = null;
  }

  /** Throw the beacon in hand along your aim. Returns false when none is armed. */
  throwBeacon() {
    if (!this.armed) return false;
    const aim = this._aim;
    this.player.getAim(aim.origin, aim.forward, aim.right, aim.up);
    const { throwSpeed, throwLift } = this.config.beacon;
    const { object, cap } = this._beaconMesh();
    object.position.copy(aim.origin).addScaledVector(aim.forward, BEACON_START);
    this.scene.add(object);
    const velocity = aim.forward.clone().multiplyScalar(throwSpeed);
    velocity.y += throwLift;
    this.beacon = { mode: this.armed, object, cap, position: object.position, velocity, yaw: this.player.yaw, flight: 0, landed: false, timer: 0 };
    this.armed = null;
    return true;
  }

  _beaconMesh() {
    const { group, cap } = buildBeaconBody();
    const object = new THREE.Group();
    object.add(group);
    object.scale.setScalar(BEACON_SCALE);
    return { object, cap };
  }

  _removeBeacon() {
    if (!this.beacon) return;
    this.scene.remove(this.beacon.object);
    this.beacon.object.traverse((node) => { if (node.geometry) node.geometry.dispose(); });
    this.beacon = null;
  }

  /** Fly the beacon one step; it lands on the first thing it meets. */
  _flyBeacon(dt) {
    const beacon = this.beacon;
    const { gravity, maxFlight } = this.config.beacon;
    beacon.flight += dt;
    beacon.velocity.y -= gravity * dt;
    const step = this._step.copy(beacon.velocity).multiplyScalar(dt);
    const length = step.length();
    const hit = length > 1e-6 ? this.world.raycast(beacon.position, this._direction.copy(step).divideScalar(length), length) : Infinity;
    if (hit < length) {
      beacon.position.addScaledVector(step, hit / length);
      beacon.position.y = Math.max(beacon.position.y, this.world.groundHeight(beacon.position.x, beacon.position.z));
      beacon.landed = true;
      beacon.timer = 0;
      beacon.object.rotation.set(0, beacon.yaw, 0); // stands upright
    } else {
      beacon.position.add(step);
      beacon.object.rotation.x += BEACON_SPIN * dt;
      beacon.object.rotation.z += BEACON_SPIN * 0.6 * dt;
      if (beacon.flight > maxFlight || beacon.position.y < -50) this._removeBeacon();
    }
  }

  /** A landed beacon blinks, and then does its job. */
  _runBeacon(dt) {
    const beacon = this.beacon;
    beacon.timer += dt;
    beacon.cap.emissiveIntensity = 1 + 4 * (Math.sin(beacon.timer * BEACON_BLINK) > 0 ? 1 : 0);
    if (beacon.timer < this.config.beacon.landDelay) return;
    const { mode, position, yaw } = beacon;
    const x = position.x;
    const z = position.z;
    this._removeBeacon();
    if (mode === BEACON.DEPLOY) this.callDown(x, z, yaw);
    else this.sendUp();
  }

  /* ------------------------------- the sky -------------------------------- */

  /**
   * The suit falls out of the sky onto (x, z), facing `yaw`. It needs room: if something solid is there, nothing comes.
   * Returns true when the suit is on its way.
   */
  callDown(x, z, yaw) {
    if (this.state !== STATES.STOWED) return false;
    if (!this._hasRoom(x, z)) {
      this.hud.banner(this.config.beacon.noRoomBanner);
      return false;
    }
    this.stage.stand(x, z, yaw);
    this.sky = { kind: 'drop', time: 0 };
    this.state = STATES.DROPPING;
    this.suitState.place(x, z, yaw);
    return true;
  }

  /** Room for the suit: nothing solid in the way, and ground that is level under all of its feet (a crate top is fine, a crate edge is not). */
  _hasRoom(x, z) {
    const half = this._colliderWidth() / 2;
    const ground = this.world.groundHeight(x, z);
    if (this.world.isBlocked(x, z, half * 1.4, ground)) return false;
    const step = this.playerConfig.stepHeight;
    return [[-1, -1], [1, -1], [-1, 1], [1, 1]].every(([dx, dz]) => Math.abs(this.world.groundHeight(x + dx * half, z + dz * half) - ground) <= step);
  }

  /** The standing suit rises back into the sky. Returns false if it is not standing. */
  sendUp() {
    if (this.state !== STATES.STANDING) return false;
    this._removeCollider();
    this.sky = { kind: 'lift', time: 0 };
    this.state = STATES.LIFTING;
    this.hud.setPrompt(null);
    return true;
  }

  _land() {
    this.state = STATES.STANDING;
    this._addCollider();
    const { shake, shakeRange } = this.config.sky;
    const near = 1 - Math.hypot(this.player.pos.x - this.position.x, this.player.pos.z - this.position.z) / shakeRange;
    if (near > 0) this.player.shake = Math.max(this.player.shake, shake * near);
  }

  _colliderWidth() {
    return this.config.collider.width * this.config.scale;
  }

  _addCollider() {
    this._removeCollider();
    const { width, height } = this.config.collider;
    const size = width * this.config.scale;
    this.collider = this.world.addCollider(this.position.x, this.position.z, size, height * this.config.scale, size);
  }

  _removeCollider() {
    if (this.collider) this.world.removeCollider(this.collider);
    this.collider = null;
  }

  /* ----------------------------- getting in/out -------------------------- */

  _horizontalDistance() {
    return Math.hypot(this.player.pos.x - this.position.x, this.player.pos.z - this.position.z);
  }

  /** The use key: step in when standing next to the suit, step out when inside it. */
  interact() {
    const player = this.player;
    if (!player.alive || this.busy) return;
    if (this.state === STATES.STANDING && this._horizontalDistance() <= this.config.interactRadius && player.grounded) this._beginEnter();
    else if (this.state === STATES.PILOTED && player.grounded) this._beginExit();
  }

  _beginStep(direction) {
    const player = this.player;
    this.direction = direction;
    this.time = direction > 0 ? 0 : this.total;
    this.previousView = player.thirdPerson;
    player.thirdPerson = true;
    player.vel.set(0, 0, 0);
    player.shielded = true; // nothing can hurt you while you are getting in or out
    this.sky = null; // a landing that is still glowing is over
    this.stage.endSky();
    this.cyborg.suppressed = true;
    this.stage.showWalker(true);
    this.hud.setPrompt(null);
    this._setBody({ thirdPerson: { ...this.playerConfig.thirdPerson, dist: this.config.orbit.dist } }, null);
    this.group.visible = true;
  }

  /** Change the player's body, keeping the same fraction of health (the pool may have a different size). */
  _setBody(overrides, mods) {
    const player = this.player;
    const fraction = player.health / player.cfg.maxHealth;
    player.setBody(overrides, mods);
    player.health = fraction * player.cfg.maxHealth;
  }

  _wearBody() {
    const stats = aggregateSuitStats(this.suitState.selection, this.config.baseline);
    this._setBody(suitBodyOverrides(this.playerConfig, this.config.scale, stats.healthMul), stats);
  }

  _beginEnter() {
    this.walkStart.copy(this.player.pos);
    this._removeCollider(); // the suit is no longer an obstacle: the player is getting in
    this._beginStep(1);
    this.player.yaw = facingYaw(this.position.x - this.player.pos.x, this.position.z - this.player.pos.z);
    this.state = STATES.ENTERING;
  }

  _beginExit() {
    const player = this.player;
    this.state = STATES.EXITING; // before the state listeners run, so they do not refit the suit body
    this.hud.setSuitMode(false);
    this.cyborg.setSuit(null);
    this.suitState.setOccupied(false);
    this.stage.stand(player.pos.x, player.pos.z, this.cyborg.bodyYaw);
    this.suitState.place(player.pos.x, player.pos.z, this.stage.yaw);
    this._removeCollider(); // the step-out starts inside the suit
    this.stage.behind(this.config.walkBehind, this.walkStart); // behind it: the opposite way to where the suit faces
    this._beginStep(-1);
    player.yaw = this.yaw; // the camera looks at the suit's back, where the human comes out
    this.state = STATES.EXITING;
  }

  _finishEnter() {
    const player = this.player;
    this.stage.showWalker(false);
    this.group.visible = false; // the player's own body now wears the suit
    this.cyborg.suppressed = false;
    this.cyborg.setSuit(this.suitState.selection, this.config.scale);
    this.cyborg.bodyYaw = this.yaw;
    player.pos.copy(this.position);
    player.prevPos.copy(this.position);
    player.yaw = this.yaw;
    player.thirdPerson = this.previousView;
    player.shielded = false;
    this._wearBody();
    this.state = STATES.PILOTED;
    this.suitState.setOccupied(true);
    this.hud.setSuitMode(true);
  }

  _finishExit() {
    const player = this.player;
    this.stage.showWalker(false);
    this.cyborg.suppressed = false;
    this.cyborg.bodyYaw = this.yaw; // facing the suit they just left
    this._setBody(null, null);
    player.pos.copy(this.walkStart); // yaw stays as it was: looking at the suit
    player.prevPos.copy(this.walkStart);
    player.thirdPerson = this.previousView;
    player.shielded = false;
    this._addCollider();
    this.state = STATES.STANDING;
  }

  /** The player died inside the suit: it opens where they fell and they are out. */
  ejectOnDeath() {
    this.disarm();
    if (this.state !== STATES.PILOTED) return;
    this.state = STATES.STANDING; // before the state listeners run, so they do not refit the suit body
    this.hud.setSuitMode(false);
    this.cyborg.setSuit(null);
    this.player.setBody(null);
    this.suitState.setOccupied(false);
    this.stage.stand(this.player.pos.x, this.player.pos.z, this.cyborg.bodyYaw);
    this.suitState.place(this.position.x, this.position.z, this.yaw);
    this._addCollider();
  }

  /** Remove the suit from the world and put the player back in a plain body (new match, back to the menu). */
  clear() {
    if (this.state === STATES.PILOTED || this.busy) {
      this.hud.setSuitMode(false);
      this.cyborg.suppressed = false;
      this.cyborg.setSuit(null);
      this.player.setBody(null);
      this.player.shielded = false;
      if (this.busy) this.player.thirdPerson = this.previousView;
    }
    this._removeBeacon();
    this._removeCollider();
    this.stage.hide();
    this.armed = null;
    this.sky = null;
    this.state = STATES.STOWED;
    this.suitState.pickUp();
  }

  /* ------------------------------- updating ------------------------------ */

  /** Fixed step: fly the beacon, advance the sky, advance the step-in, and show the "use" prompt. */
  update(dt) {
    if (this.beacon) {
      if (this.beacon.landed) this._runBeacon(dt);
      else this._flyBeacon(dt);
    }
    if (this.sky) this._advanceSky(dt);
    if (this.busy) {
      this.time += dt * this.direction;
      if (this.direction > 0 && this.time >= this.total) this._finishEnter();
      else if (this.direction < 0 && this.time <= 0) this._finishExit();
      return;
    }
    const near = this.state === STATES.STANDING && this.player.alive && this._horizontalDistance() <= this.config.interactRadius;
    this.hud.setPrompt(near ? `${this.keyLabel()}  ENTER SUIT` : null);
  }

  _advanceSky(dt) {
    this.sky.time += dt;
    const { dropTime, liftTime } = this.config.sky;
    if (this.sky.kind === 'drop' && this.state === STATES.DROPPING && this.sky.time >= dropTime) this._land();
    if (this.sky.kind === 'lift' && this.sky.time >= liftTime) {
      this.sky = null;
      this.stage.hide();
      this.state = STATES.STOWED;
      this.suitState.pickUp();
    }
  }

  /** Every rendered frame: pose the suit and the walking human for the current time, and play the fall or rise. */
  animate() {
    if (this.busy) this.stage.pose(this.time, this.direction, this.walkStart);
    if (!this.sky) return;
    const done = this.sky.kind === 'drop' ? this.stage.drop(this.sky.time) : this.stage.lift(this.sky.time);
    if (done) this.sky = null;
  }

  /** What the other players need to know about the suit (see suit-network.js), or null when none is in play. */
  networkState() {
    const mode = NETWORK_MODE[this.state];
    if (!mode) return null;
    return { mode, x: this.position.x, z: this.position.z, yaw: this.yaw, selection: this.suitState.selection };
  }

  _onSuitChanged(slot) {
    if (slot) {
      this.stage.setPart(slot, this.suitState.selection[slot]);
      if (this.state === STATES.PILOTED) this.cyborg.setSuitPart(slot, this.suitState.selection[slot]);
    }
    if (this.state === STATES.PILOTED) this._wearBody();
  }
}
