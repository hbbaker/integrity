import * as THREE from 'three';
import { bendLimb } from '../assets/limb-ik.js';

/*
 * RAGDOLL: the rider's body as eleven rigid parts in the physics world (pelvis, chest, head, two thighs,
 * two shins, two upper arms, two forearms), joined where a body is joined. It starts in the pose the
 * rider had at the crash, and from then on the physics moves it. Each frame it gives back a pose in
 * the form the body model takes (YBotSkin.driveBones).
 *
 * Every part's own frame has +Y along the part toward its parent joint (so a limb hangs along -Y), and
 * its origin at that joint. A knee or an elbow is a hinge about the part's X axis.
 */

const SIDES = ['Left', 'Right'];
const SIDE_SIGN = { Left: -1, Right: 1 };
const RIGHT = new THREE.Vector3(1, 0, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);
const ZERO = new THREE.Vector3();
const KNEE_LIMITS = [-2.5, 0.05]; // radians: a knee folds one way only (the shin goes back)
const ELBOW_LIMITS = [-0.05, 2.6];
const STRAIGHT_LIMB = 1e-4; // below this, the two bones of a limb count as in one line

/** The turn of a part whose length runs along `direction` and whose hinge axis is as near to `hinge` as that allows. */
function partTurn(direction, hinge, out) {
  const y = direction.clone().negate();
  const x = hinge.clone().addScaledVector(y, -hinge.dot(y)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** A direction at right angles to `direction`, as near to `wanted` as that allows. */
function acrossFrom(direction, wanted) {
  const across = wanted.clone().addScaledVector(direction, -wanted.dot(direction));
  if (across.lengthSq() < STRAIGHT_LIMB) across.set(direction.y, -direction.x, 0); // `wanted` runs along the limb: any side will do
  return across.normalize();
}

export class Ragdoll {
  /**
   * @param deps { physics (a PhysicsWorld), anatomy (the body's measurements: YBotSkin.anatomy()),
   *   config (CONFIG.ski.crash.body), layer, hits (the body's collision layer and what it hits) }
   */
  constructor({ physics, anatomy, config, layer, hits }) {
    this.physics = physics;
    this.anatomy = anatomy;
    this.config = config;
    this.surface = { density: config.density, friction: config.friction, layer, hits };
    this.parts = null; // name -> physics body, while the ragdoll is in the world
    this.origin = new THREE.Vector3(); // where the body model's rig stands this frame (world)
    this.pose = {
      hips: { offset: new THREE.Vector3(), turn: new THREE.Quaternion() },
      chest: new THREE.Quaternion(),
      head: new THREE.Quaternion(),
      feet: Object.fromEntries(SIDES.map((side) => [side, { ankle: new THREE.Vector3(), turn: new THREE.Quaternion(), knee: new THREE.Vector3() }])),
      hands: Object.fromEntries(SIDES.map((side) => [side, { wrist: new THREE.Vector3(), roll: 0, elbow: new THREE.Vector3() }])),
    };
    this._position = new THREE.Vector3();
    this._parent = new THREE.Vector3();
    this._turn = new THREE.Quaternion();
  }

  get active() {
    return this.parts !== null;
  }

  /**
   * Put the body into the world in a pose.
   * @param start {
   *   pose (as the pose solver gives it, in the rig's frame), origin, turn (where the rig stands and how it is turned, world),
   *   velocity (m/s, world), legsKeep (share of the velocity the legs keep: the snow caught them),
   *   toss (Vector3, m/s added to the chest and head)
   * }
   */
  spawn({ pose, origin, turn, velocity, legsKeep, toss }) {
    if (this.parts) this.remove();
    const a = this.anatomy;
    const toWorld = (point) => point.applyQuaternion(turn).add(origin);
    const worldTurn = (local) => turn.clone().multiply(local);
    const hipsTurn = worldTurn(pose.hips.turn);
    const chestTurn = worldTurn(pose.chest);
    const headTurn = worldTurn(pose.head);
    const hips = toWorld(new THREE.Vector3(0, a.hipsHeight, 0).add(pose.hips.offset));
    const spineUp = a.spineHeight - a.hipsHeight;
    const spine = new THREE.Vector3(0, spineUp, 0).applyQuaternion(hipsTurn).add(hips);
    const neckUp = a.neckHeight - a.spineHeight;
    const neck = new THREE.Vector3(0, neckUp, 0).applyQuaternion(chestTurn).add(spine);
    const shoulderUp = a.shoulderHeight - a.spineHeight;
    const hipDown = a.hipJointHeight - a.hipsHeight;
    const upperVelocity = velocity.clone().add(toss);
    const lowerVelocity = velocity.clone().multiplyScalar(legsKeep);
    const { linearDamping, angularDamping, radius } = this.config;
    const body = (position, rotation, partVelocity) => this.physics.createBody({ position, rotation, velocity: partVelocity, linearDamping, angularDamping });
    const capsule = (part, fromY, toY, partRadius) => this.physics.addCapsule(part, { from: new THREE.Vector3(0, fromY, 0), to: new THREE.Vector3(0, toY, 0), radius: partRadius, ...this.surface });

    const parts = {};
    parts.pelvis = body(hips, hipsTurn, lowerVelocity);
    capsule(parts.pelvis, hipDown, spineUp, radius.pelvis);
    parts.chest = body(spine, chestTurn, upperVelocity);
    capsule(parts.chest, radius.chest * 0.5, shoulderUp, radius.chest);
    parts.head = body(neck, headTurn, upperVelocity);
    capsule(parts.head, radius.head * 0.6, a.headTopHeight - a.neckHeight - radius.head, radius.head);
    this.physics.joinBall(parts.pelvis, new THREE.Vector3(0, spineUp, 0), parts.chest, ZERO);
    this.physics.joinBall(parts.chest, new THREE.Vector3(0, neckUp, 0), parts.head, ZERO);

    for (const side of SIDES) {
      const sign = SIDE_SIGN[side];
      // A leg: hip joint -> knee -> ankle, bent the way the pose bends it.
      const hipJointLocal = new THREE.Vector3(sign * a.hipJointHalfWidth, hipDown, 0);
      const hipJoint = hipJointLocal.clone().applyQuaternion(hipsTurn).add(hips);
      const foot = pose.feet[side];
      const leg = bendLimb(hipJoint, toWorld(foot.ankle.clone()), a.thighLength, a.shinLength, foot.knee.clone().applyQuaternion(turn), FORWARD.clone().applyQuaternion(turn));
      const bodyRight = RIGHT.clone().applyQuaternion(hipsTurn);
      const kneeAxis = new THREE.Vector3().crossVectors(leg.lower, leg.upper); // toward the body's right when the shin folds back
      if (kneeAxis.lengthSq() < STRAIGHT_LIMB) kneeAxis.copy(bodyRight);
      const thighTurn = partTurn(leg.upper, kneeAxis, new THREE.Quaternion());
      const shinTurn = partTurn(leg.lower, kneeAxis, new THREE.Quaternion());
      const thigh = parts[`thigh${side}`] = body(hipJoint, thighTurn, lowerVelocity);
      const shin = parts[`shin${side}`] = body(leg.joint, shinTurn, lowerVelocity);
      capsule(thigh, 0, -a.thighLength, radius.thigh);
      capsule(shin, 0, -a.shinLength, radius.shin);
      this.physics.joinBall(parts.pelvis, hipJointLocal, thigh, ZERO);
      this.physics.joinHinge(thigh, new THREE.Vector3(0, -a.thighLength, 0), shin, ZERO, RIGHT, ...KNEE_LIMITS);

      // An arm: shoulder -> elbow -> wrist.
      const shoulderLocal = new THREE.Vector3(sign * a.shoulderHalfWidth, shoulderUp, 0);
      const shoulder = shoulderLocal.clone().applyQuaternion(chestTurn).add(spine);
      const elbowHint = new THREE.Vector3(sign, -1, 0).applyQuaternion(chestTurn); // out and down
      const arm = bendLimb(shoulder, toWorld(pose.hands[side].wrist.clone()), a.upperArmLength, a.foreArmLength, elbowHint, bodyRight.clone().multiplyScalar(sign));
      const elbowAxis = new THREE.Vector3().crossVectors(arm.upper, arm.lower);
      if (elbowAxis.lengthSq() < STRAIGHT_LIMB) elbowAxis.copy(acrossFrom(arm.upper, FORWARD.clone().applyQuaternion(chestTurn)));
      const upperArm = parts[`upperArm${side}`] = body(shoulder, partTurn(arm.upper, elbowAxis, new THREE.Quaternion()), upperVelocity);
      const foreArm = parts[`foreArm${side}`] = body(arm.joint, partTurn(arm.lower, elbowAxis, new THREE.Quaternion()), upperVelocity);
      capsule(upperArm, 0, -a.upperArmLength, radius.arm);
      capsule(foreArm, 0, -a.foreArmLength, radius.arm);
      this.physics.joinBall(parts.chest, shoulderLocal, upperArm, ZERO);
      this.physics.joinHinge(upperArm, new THREE.Vector3(0, -a.upperArmLength, 0), foreArm, ZERO, RIGHT, ...ELBOW_LIMITS);
    }
    this.parts = parts;
    this.read();
  }

  /** The world position of the end of a limb's lower part (an ankle or a wrist). */
  _endOf(part, length, out) {
    this.physics.read(part, this._position, this._turn);
    return out.set(0, -length, 0).applyQuaternion(this._turn).add(this._position);
  }

  /** An ankle in the world: something that holds the feet (a board) joins on here. */
  ankleWorld(side, out) {
    return this._endOf(this.parts[`shin${side}`], this.anatomy.shinLength, out);
  }

  /** The shin of one side, to join something to its ankle: { body, anchor (the ankle in the shin's own frame) }. */
  ankleJoint(side) {
    return { body: this.parts[`shin${side}`], anchor: new THREE.Vector3(0, -this.anatomy.shinLength, 0) };
  }

  /** How fast the body moves (its pelvis), in metres per second. */
  get speed() {
    return this.physics.speedOf(this.parts.pelvis);
  }

  /**
   * Read the physics into `pose` and `origin`: the pose is in a rig that stands at `origin` and is not turned.
   * Returns the pose.
   */
  read() {
    const { physics, parts, pose, origin } = this;
    const a = this.anatomy;
    physics.read(parts.pelvis, this._position, pose.hips.turn);
    origin.copy(this._position);
    origin.y -= a.hipsHeight;
    pose.hips.offset.set(0, 0, 0);
    physics.read(parts.chest, this._position, pose.chest);
    physics.read(parts.head, this._position, pose.head);
    for (const side of SIDES) {
      const foot = pose.feet[side];
      physics.read(parts[`thigh${side}`], this._parent, this._turn);
      physics.read(parts[`shin${side}`], this._position, foot.turn);
      foot.knee.copy(this._position).sub(this._parent); // from the hip joint to the knee: the way the knee points
      foot.ankle.set(0, -a.shinLength, 0).applyQuaternion(foot.turn).add(this._position).sub(origin);

      const hand = pose.hands[side];
      physics.read(parts[`upperArm${side}`], this._parent, this._turn);
      physics.read(parts[`foreArm${side}`], this._position, this._turn);
      hand.elbow.copy(this._position).sub(this._parent);
      hand.wrist.set(0, -a.foreArmLength, 0).applyQuaternion(this._turn).add(this._position).sub(origin);
    }
    return pose;
  }

  /** Take the body out of the world. */
  remove() {
    if (!this.parts) return;
    for (const part of Object.values(this.parts)) this.physics.removeBody(part);
    this.parts = null;
  }
}
