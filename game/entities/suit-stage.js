import * as THREE from 'three';
import { BodyRig } from '../assets/body-rig.js';
import { HUMANOID_KIT, HUMANOID_MATERIALS } from '../assets/humanoid.js';
import { YBotSkin, loadYBot } from '../assets/y-bot.js';
import { createSuitBody, setSuitOpen, setSuitPart } from '../assets/mech-suit.js';
import { enterTimeline, walkerPose } from '../suit/enter-poses.js';

/*
 * What you see of a suit standing in the world: the suit itself, and the human who walks into it
 * (or out of it) while its back and limbs are open. Used for your own suit (MechSuit) and for every
 * other player's (RemoteSuit); neither the rules nor the network are in here, only the looks.
 *
 * The suit is placed with `stand`, then `pose` poses everything for a moment on the step-in timeline.
 * `drop` and `lift` play the suit coming down from the sky (with a light pillar and a ring where it lands)
 * and going back up.
 */

const WALK_RUN = 0.6; // how brisk the human's walk is, on the scale the player's run uses (1 = a full run)

/** The camera yaw that looks along (dx, dz). */
export const facingYaw = (dx, dz) => Math.atan2(-dx, -dz);

export class SuitStage {
  /**
   * @param {object} options
   * @param {THREE.Scene} options.scene
   * @param {{ groundHeight(x: number, z: number): number }} options.world
   * @param {object} options.config CONFIG.suit
   * @param {Record<string, string>} options.selection the part in each slot
   * @param {() => Promise<object | null>} [options.skinLoader] replaces the human model loader (tests)
   */
  constructor({ scene, world, config, selection, skinLoader = loadYBot }) {
    this.scene = scene;
    this.world = world;
    this.config = config;
    this.position = new THREE.Vector3(); // where the suit stands (feet)
    this.yaw = 0; // the way the suit faces (a camera yaw)

    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.scale.setScalar(config.scale);
    scene.add(this.group);
    this.body = createSuitBody(selection);
    this.group.add(this.body.root);

    // The light pillar and the landing ring (additive, so they glow without hiding anything).
    const glow = () => new THREE.MeshBasicMaterial({ color: 0x66f6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9 * config.scale, 1.1 * config.scale, config.sky.height * 1.3, 16, 1, true), glow());
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2), glow());
    this.beam.visible = false;
    this.ring.visible = false;
    scene.add(this.beam, this.ring);

    this.walker = new BodyRig(HUMANOID_MATERIALS);
    this.walker.setKit(HUMANOID_KIT, HUMANOID_MATERIALS);
    this.walkerSkin = new YBotSkin(this.walker, { load: skinLoader });
    this.walker.root.visible = false;
    scene.add(this.walker.root);
  }

  /** Stand the closed suit at (x, z), facing `yaw`. */
  stand(x, z, yaw) {
    this.position.set(x, this.world.groundHeight(x, z), z);
    this.yaw = yaw;
    this.body.root.rotation.y = yaw;
    setSuitOpen(this.body, 0);
    this.group.position.copy(this.position);
    this.group.visible = true;
    this._pillar(0, 0, 0);
  }

  /** Take the suit, the walking human and the light out of sight. */
  hide() {
    this.group.visible = false;
    this.walker.root.visible = false;
    this.beam.visible = false;
    this.ring.visible = false;
  }

  /** Put out the light pillar and the ring (the suit is being stepped into). */
  endSky() {
    this.beam.visible = false;
    this.ring.visible = false;
  }

  /** Set the suit `offset` metres above its place, the pillar's brightness and how far the landing ring has spread (0 = none). */
  _pillar(offset, brightness, spread) {
    const { x, y, z } = this.position;
    this.group.position.set(x, y + offset, z);
    this.beam.visible = brightness > 0.01;
    this.beam.material.opacity = brightness;
    this.beam.position.set(x, y + this.config.sky.height * 0.55, z);
    this.ring.visible = spread > 0 && spread < 1;
    this.ring.material.opacity = (1 - spread) * 0.8;
    this.ring.scale.setScalar(this.config.scale * (1 + spread * 7));
    this.ring.position.set(x, y + 0.05, z);
  }

  /**
   * The suit falling out of the sky onto its place, `time` seconds after it started. It falls faster and faster,
   * lands, and the pillar and the ring fade. Returns true once all of that is over.
   */
  drop(time) {
    const { height, dropTime, beamLinger } = this.config.sky;
    const fall = Math.min(1, time / dropTime);
    const after = Math.max(0, time - dropTime) / beamLinger;
    this.group.visible = true;
    this._pillar(height * (1 - fall * fall), 0.85 * (1 - Math.min(1, after)), after);
    return after >= 1;
  }

  /** The suit rising back into the sky, `time` seconds after it started. Returns true once it is gone. */
  lift(time) {
    const { height, liftTime } = this.config.sky;
    const rise = Math.min(1, time / liftTime);
    this._pillar(height * rise * rise, 0.85, 0);
    if (rise < 1) return false;
    this.hide();
    return true;
  }

  showWalker(visible) {
    this.walker.root.visible = visible;
  }

  /** Where the human stands behind the suit: the opposite way to where it faces, `distance` metres away. */
  behind(distance, out = new THREE.Vector3()) {
    out.set(this.position.x + Math.sin(this.yaw) * distance, 0, this.position.z + Math.cos(this.yaw) * distance);
    out.y = this.world.groundHeight(out.x, out.z);
    return out;
  }

  /** Change one part of the suit. */
  setPart(slot, id) {
    setSuitPart(this.body, slot, id);
  }

  /**
   * Pose the suit and the walking human at `time` seconds into the step-in.
   * @param {number} direction +1 stepping in, -1 stepping out (the human then walks forward, facing away)
   * @param {THREE.Vector3} walkStart where the human stands behind the suit
   */
  pose(time, direction, walkStart) {
    const { open, step } = enterTimeline(time, this.config.enterTimes);
    setSuitOpen(this.body, open);
    const { travel, swing, phase, stride } = walkerPose(step);
    const human = this.walker;
    const x = THREE.MathUtils.lerp(walkStart.x, this.position.x, travel);
    const z = THREE.MathUtils.lerp(walkStart.z, this.position.z, travel);
    const towardSuit = facingYaw(this.position.x - walkStart.x, this.position.z - walkStart.z);
    human.root.position.set(x, this.world.groundHeight(x, z), z);
    human.root.rotation.set(0, direction > 0 ? towardSuit : towardSuit + Math.PI, 0); // walking out, they face away from the suit
    human.legL.pivot.rotation.x = swing * 0.7;
    human.legR.pivot.rotation.x = -swing * 0.7;
    human.armL.pivot.rotation.x = -swing * 0.5;
    human.armR.pivot.rotation.x = swing * 0.5;
    human.hips.position.y = Math.abs(swing) * 0.03;
    // Walking out, time runs backwards but the human walks forward (facing away), so their stride runs on.
    this.walkerSkin.sync({ phase: direction > 0 ? phase : -phase, run: WALK_RUN, stride, grounded: true, sliding: false, crouching: false, sprinting: false, falling: false });
  }

  /** Remove everything from the scene. */
  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.walker.root);
    this.scene.remove(this.beam);
    this.scene.remove(this.ring);
  }
}
