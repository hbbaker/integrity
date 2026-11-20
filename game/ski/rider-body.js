import * as THREE from 'three';
import { clamp, lerp } from '../../core/client/engine/math.js';
import { PoseSolver } from './pose-solver.js';
import { buildSki, buildBoard, buildPole, disposeModel } from './ride-models.js';
import { Ragdoll } from './ragdoll.js';

/*
 * RIDER BODY: what you see of the rider. Each frame it turns the game's third-person body to the ride's
 * frame, asks the pose solver for the pose, puts that pose on the body's bones, and places the ride
 * (skis and poles, or a board) and the blob shadow. It takes over the body through Cyborg's `poser`.
 *
 * In a crash the body is a ragdoll in the physics world: the pose then comes from the physics. Skis and
 * poles come off and tumble on their own. A board stays on: it is joined to both ankles.
 */

/** The collision layers of a crash: what is in each, and what each hits. */
export const CRASH_LAYERS = {
  ground: { layer: 0, hits: [1, 2] },
  body: { layer: 1, hits: [0] },
  loose: { layer: 2, hits: [0] }, // skis, poles, a board: they hit the snow, not the body
};

// The body model's measurements, used until the model has loaded (the ride needs its place from the first frame).
const FALLBACK_ANATOMY = {
  hipsHeight: 0.918, hipJointHeight: 0.857, hipJointHalfWidth: 0.084, ankleHeight: 0.097, thighLength: 0.374, shinLength: 0.387,
  spineHeight: 1.009, neckHeight: 1.378, headTopHeight: 1.643, shoulderHeight: 1.321, shoulderHalfWidth: 0.173,
  upperArmLength: 0.303, foreArmLength: 0.305,
};
const POLE_GRIP = 0.85; // how far the hands close: round a pole ...
const OPEN_GRIP = 0.3; // ... and with nothing in them
const SHADOW_LIFT = 0.03; // metres the blob shadow floats over the snow
const TUCK_BLEND_SPEED = 5; // m/s above the push speed over which "tuck" changes from a push to a real tuck
const SIDES = ['Left', 'Right'];
const SIDE_SIGN = { Left: -1, Right: 1 };
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

export class RiderBody {
  /**
   * @param deps {
   *   cyborg (the third-person body), rider (game/ski/rider.js), ride ('skis' or 'board'),
   *   config (CONFIG.ski.pose), crashConfig (CONFIG.ski.crash), pushSpeed (CONFIG.ski.rider.pushSpeed),
   *   heightfield (the course's ground), worldGroup (where things that come off the rider are drawn)
   * }
   */
  constructor({ cyborg, rider, ride, config, crashConfig, pushSpeed, heightfield, worldGroup }) {
    this.cyborg = cyborg;
    this.rider = rider;
    this.ride = ride;
    this.stance = config[ride];
    this.pushSpeed = pushSpeed;
    this.heightfield = heightfield;
    this.crashConfig = crashConfig;
    this.worldGroup = worldGroup;
    this.solver = new PoseSolver({ config, ride });
    this.anatomy = null;
    this.ragdoll = null; // set while the rider is down
    this.physics = null;
    this.loose = []; // { model, body }: what the physics moves on its own during a crash
    this.input = { edge: 0, tuck: 0, brake: 0, mountainEdge: rider.mountainEdge, grounded: true, accelSide: 0, accelFore: 0, popCharge: 0, spinRate: 0, flipRate: 0, grab: null };

    this.models = new THREE.Group();
    this.skis = ride === 'skis' ? { Left: buildSki(), Right: buildSki() } : null;
    this.poles = ride === 'skis' ? { Left: buildPole(), Right: buildPole() } : null;
    this.board = ride === 'board' ? buildBoard() : null;
    for (const model of [...Object.values(this.skis ?? {}), ...Object.values(this.poles ?? {}), this.board]) {
      if (model) this.models.add(model);
    }
    cyborg.root.add(this.models);

    this._turn = new THREE.Quaternion();
    this._inverse = new THREE.Quaternion();
    this._accel = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._pole = new THREE.Vector3();
    this._position = new THREE.Vector3();
    this._rotation = new THREE.Quaternion();
    this.pose = this.pose.bind(this);
    cyborg.poser = this.pose;
  }

  /** Stand in the neutral stance at once (a new run, or a jump to another place). */
  reset() {
    this.solver.reset();
  }

  /** Cyborg calls this once per rendered frame, in place of its own posing. */
  pose(cyborg, dt, alpha) {
    if (this.ragdoll) {
      this._poseRagdoll(cyborg);
      return;
    }
    const { rider } = this;
    const turn = this._turn.slerpQuaternions(rider.prevOrientation, rider.orientation, alpha);
    cyborg.root.quaternion.copy(turn);

    const skin = cyborg.skin?.ready && cyborg.skin.active ? cyborg.skin : null;
    if (skin) this.anatomy ??= skin.anatomy();
    const accel = this._accel.copy(rider.accel).applyQuaternion(this._inverse.copy(turn).invert());
    const { input } = this;
    input.edge = rider.edge;
    input.mountainEdge = rider.mountainEdge;
    input.tuck = rider.controls.tuck * clamp((rider.speed - this.pushSpeed) / TUCK_BLEND_SPEED, 0, 1); // slow, "tuck" is a push
    input.brake = rider.controls.brake;
    input.grounded = rider.grounded;
    input.popCharge = rider.popCharge;
    input.spinRate = rider.spinRate;
    input.flipRate = rider.flipRate;
    input.grab = rider.controls.grab;
    input.accelSide = accel.x;
    input.accelFore = -accel.z;
    const pose = this.solver.update(dt, input, this.anatomy ?? FALLBACK_ANATOMY);

    this._placeRide(pose);
    if (skin) {
      skin.setGrip(this.poles ? POLE_GRIP : OPEN_GRIP);
      skin.driveBones(pose);
    }
    this._placeShadow(cyborg);
  }

  /** The skis under the feet and the poles in the hands, or the board under both feet. */
  _placeRide(pose) {
    if (this.board) {
      this.board.position.set(0, pose.ride.lift, 0);
      this.board.quaternion.copy(pose.ride.turn);
      return;
    }
    const { poleRest, poleTuck } = this.stance;
    const tuck = this.solver.tuck;
    for (const side of SIDES) {
      const foot = pose.feet[side];
      this.skis[side].position.copy(foot.sole);
      this.skis[side].quaternion.copy(foot.turn);
      const pole = this.poles[side];
      pole.position.copy(pose.hands[side].wrist);
      const along = this._pole.set(SIDE_SIGN[side] * lerp(poleRest.x, poleTuck.x, tuck), lerp(poleRest.y, poleTuck.y, tuck), lerp(poleRest.z, poleTuck.z, tuck));
      pole.quaternion.setFromUnitVectors(DOWN, along.normalize());
    }
  }

  /** The blob shadow lies on the snow under the rider, also when the rider is in the air above it. */
  _placeShadow(cyborg) {
    const { x, y, z } = cyborg.group.position;
    const normal = this.heightfield.normalAt(x, z, this._normal);
    cyborg.shadow.position.y = this.heightfield.heightAt(x, z) - y + SHADOW_LIFT;
    cyborg.shadow.quaternion.setFromUnitVectors(UP, normal);
  }

  /** The rider landed: the body folds by `share` (0..1 of the crash limit) and comes back up. */
  absorb(share) {
    this.solver.land(share);
  }

  /* -------------------------------- crash --------------------------------- */

  get down() {
    return this.ragdoll !== null;
  }

  /**
   * The rider goes down: from now on the physics moves the body, starting from the pose and the speed it has.
   * @param physics a PhysicsWorld that holds the ground
   * @param caught the edge that caught (-1 left, +1 right): the body is thrown over that side
   */
  crash(physics, caught) {
    const { rider, crashConfig } = this;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rider.orientation);
    const toss = right.clone().multiplyScalar(caught * rider.speed * crashConfig.tossSide);
    toss.y += crashConfig.tossUp;
    this.physics = physics;
    this.ragdoll = new Ragdoll({ physics, anatomy: this.anatomy ?? FALLBACK_ANATOMY, config: crashConfig.body, ...CRASH_LAYERS.body });
    this.ragdoll.spawn({ pose: this.solver.pose, origin: rider.pos, turn: rider.orientation, velocity: rider.vel, legsKeep: crashConfig.legsKeep, toss });

    const slowed = rider.vel.clone().multiplyScalar(crashConfig.legsKeep);
    if (this.board) {
      const body = this._loosen(this.board, crashConfig.loose.board, slowed, null);
      const inverse = this.board.quaternion.clone().invert(); // the board is in the world group now: its own turn is its world turn
      for (const side of SIDES) { // both ankles stay in the bindings
        const ankle = this.ragdoll.ankleJoint(side);
        const onBoard = this.ragdoll.ankleWorld(side, new THREE.Vector3()).sub(this.board.position).applyQuaternion(inverse);
        physics.joinBall(body, onBoard, ankle.body, ankle.anchor);
      }
      return;
    }
    for (const side of SIDES) { // skis and poles come off, each thrown out to its own side
      const out = right.clone().multiplyScalar(SIDE_SIGN[side] * crashConfig.loose.scatter);
      const spin = new THREE.Vector3(SIDE_SIGN[side], 0.5, 0).applyQuaternion(rider.orientation).multiplyScalar(crashConfig.loose.spin);
      this._loosen(this.skis[side], crashConfig.loose.ski, slowed.clone().add(out), spin);
      this._loosen(this.poles[side], crashConfig.loose.pole, rider.vel.clone().add(out), spin);
    }
  }

  /** Hand a model to the physics: it leaves the body, moves to the world group, and gets a box of its own. */
  _loosen(model, box, velocity, spin) {
    const { physics, crashConfig, rider } = this;
    // The model was placed in the ride's frame; the world group is not moved or turned, so this is its place in the world.
    model.position.applyQuaternion(rider.orientation).add(rider.pos);
    model.quaternion.premultiply(rider.orientation);
    this.worldGroup.add(model);
    const { density, friction, linearDamping, angularDamping } = crashConfig.loose;
    const body = physics.createBody({ position: model.position, rotation: model.quaternion, velocity, spin, linearDamping, angularDamping });
    physics.addBox(body, { halfSize: box.halfSize, centre: box.centre, density, friction, ...CRASH_LAYERS.loose });
    this.loose.push({ model, body });
    return body;
  }

  /** Where the fallen body is now (the snow under its pelvis is near this point), and how fast it moves. */
  get downPosition() {
    this.ragdoll.read();
    return this.ragdoll.origin;
  }

  get downSpeed() {
    return this.ragdoll.speed;
  }

  /** The body, and what came off it, where the physics has them this frame. */
  _poseRagdoll(cyborg) {
    const pose = this.ragdoll.read();
    cyborg.group.position.copy(this.ragdoll.origin);
    cyborg.root.quaternion.identity();
    for (const { model, body } of this.loose) this.physics.read(body, model.position, model.quaternion);
    const skin = cyborg.skin?.ready && cyborg.skin.active ? cyborg.skin : null;
    if (skin) skin.driveBones(pose);
    this._placeShadow(cyborg);
  }

  /** The rider gets up: the physics lets go of the body, and the ride is back on the feet (and the poles in the hands). */
  recover() {
    if (!this.ragdoll) return;
    for (const { model, body } of this.loose) {
      this.physics.removeBody(body);
      this.models.add(model);
    }
    this.loose.length = 0;
    this.ragdoll.remove();
    this.ragdoll = null;
    this.physics = null;
    this.solver.reset();
  }

  /** Give the body back to the game and take the ride away. */
  dispose() {
    this.recover();
    const { cyborg } = this;
    cyborg.poser = null;
    cyborg.shadow.rotation.set(0, 0, 0);
    cyborg.root.quaternion.identity();
    for (const model of [...this.models.children]) disposeModel(model);
    this.models.removeFromParent();
  }
}
