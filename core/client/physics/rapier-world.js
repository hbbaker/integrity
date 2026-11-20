import * as THREE from 'three';

/*
 * PHYSICS WORLD: rigid bodies, joints and static ground, simulated by Rapier. This is the only file
 * that knows the library (see the game's import map for where it comes from); everything else uses
 * the small interface below, with THREE vectors and quaternions.
 *
 * The library is loaded on demand: loadPhysics() resolves to a factory for worlds, and rejects if the
 * library cannot load. A game can then run without it and say so.
 *
 * Collision layers: a collider is in one `layer` and collides with the layers in its `hits` list.
 */

const LIBRARY = '@dimforge/rapier3d-compat';
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const MEMBERSHIP_SHIFT = 16; // Rapier packs "what I am" into the high 16 bits and "what I hit" into the low 16
const MAX_LAYERS = 16;

let libraryPromise = null;

/** Load the physics library (once). Resolves to { createWorld(gravity) }. */
export function loadPhysics() {
  libraryPromise ??= import(LIBRARY).then(async (module) => {
    const rapier = module.default ?? module;
    await rapier.init();
    return { createWorld: (gravity) => new PhysicsWorld(rapier, gravity) };
  });
  return libraryPromise;
}

function layerBits(layer, hits) {
  const bit = (index) => {
    if (!Number.isInteger(index) || index < 0 || index >= MAX_LAYERS) throw new Error(`a collision layer must be 0..${MAX_LAYERS - 1}, got ${index}`);
    return 1 << index;
  };
  return (bit(layer) << MEMBERSHIP_SHIFT) | hits.reduce((mask, index) => mask | bit(index), 0);
}

export class PhysicsWorld {
  /** Use loadPhysics().createWorld(gravity): `gravity` is metres per second squared, downward. */
  constructor(rapier, gravity) {
    this.rapier = rapier;
    this.world = new rapier.World({ x: 0, y: -gravity, z: 0 });
    this._turn = new THREE.Quaternion();
    this._along = new THREE.Vector3();
    this._middle = new THREE.Vector3();
  }

  /** Advance the simulation by `dt` seconds. */
  step(dt) {
    this.world.timestep = dt;
    this.world.step();
  }

  /* ------------------------------- bodies -------------------------------- */

  /**
   * A moving body with no shape yet (add shapes with addCapsule / addBox).
   * @param options { position, rotation (Quaternion), velocity, spin (radians per second, a Vector3),
   *   linearDamping, angularDamping }. Position and rotation are needed; the rest defaults to zero.
   */
  createBody({ position, rotation, velocity = null, spin = null, linearDamping = 0, angularDamping = 0 }) {
    const description = this.rapier.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
      .setLinearDamping(linearDamping)
      .setAngularDamping(angularDamping);
    if (velocity) description.setLinvel(velocity.x, velocity.y, velocity.z);
    if (spin) description.setAngvel({ x: spin.x, y: spin.y, z: spin.z });
    return this.world.createRigidBody(description);
  }

  /** `surface` is { density (kg per cubic metre), friction, layer, hits }. */
  _shape(description, body, { density, friction, layer, hits }) {
    description.setDensity(density).setFriction(friction).setCollisionGroups(layerBits(layer, hits));
    return this.world.createCollider(description, body);
  }

  /** A capsule on a body, between two points in the body's own frame. */
  addCapsule(body, { from, to, radius, ...surface }) {
    const along = this._along.copy(to).sub(from);
    const length = along.length();
    const middle = this._middle.copy(from).add(to).multiplyScalar(0.5);
    const turn = this._turn.setFromUnitVectors(Y_AXIS, along.divideScalar(length));
    const description = this.rapier.ColliderDesc.capsule(length / 2, radius)
      .setTranslation(middle.x, middle.y, middle.z)
      .setRotation({ x: turn.x, y: turn.y, z: turn.z, w: turn.w });
    return this._shape(description, body, surface);
  }

  /** A box on a body: `halfSize` each way from `centre`, in the body's own frame. */
  addBox(body, { halfSize, centre, ...surface }) {
    const description = this.rapier.ColliderDesc.cuboid(halfSize.x, halfSize.y, halfSize.z).setTranslation(centre.x, centre.y, centre.z);
    return this._shape(description, body, surface);
  }

  /** Join two bodies at a point (given in each body's own frame): they can turn any way about it. */
  joinBall(bodyA, anchorA, bodyB, anchorB) {
    return this.world.createImpulseJoint(this.rapier.JointData.spherical(anchorA, anchorB), bodyA, bodyB, true);
  }

  /** Join two bodies with a hinge about `axis` (in body A's frame), turning between `min` and `max` radians. */
  joinHinge(bodyA, anchorA, bodyB, anchorB, axis, min, max) {
    const joint = this.world.createImpulseJoint(this.rapier.JointData.revolute(anchorA, anchorB, axis), bodyA, bodyB, true);
    joint.setLimits(min, max);
    return joint;
  }

  /** Where a body is: writes `position` and `rotation`. */
  read(body, position, rotation) {
    const at = body.translation();
    const turn = body.rotation();
    position.set(at.x, at.y, at.z);
    rotation.set(turn.x, turn.y, turn.z, turn.w);
  }

  /** How fast a body moves, in metres per second. */
  speedOf(body) {
    const velocity = body.linvel();
    return Math.hypot(velocity.x, velocity.y, velocity.z);
  }

  /** Take a body away, with its shapes and joints. */
  removeBody(body) {
    this.world.removeRigidBody(body);
  }

  /* ------------------------------- statics ------------------------------- */

  /** Fixed ground from triangles: `positions` (x, y, z for each corner) and `indices` (three corners for each triangle). */
  addGround({ positions, indices, friction, layer, hits }) {
    const description = this.rapier.ColliderDesc.trimesh(positions, indices).setFriction(friction).setCollisionGroups(layerBits(layer, hits));
    return this.world.createCollider(description);
  }

  /** A fixed upright cylinder standing on `base`. */
  addPillar({ base, radius, height, friction, layer, hits }) {
    const description = this.rapier.ColliderDesc.cylinder(height / 2, radius)
      .setTranslation(base.x, base.y + height / 2, base.z).setFriction(friction).setCollisionGroups(layerBits(layer, hits));
    return this.world.createCollider(description);
  }

  /** A fixed ball. */
  addBoulder({ centre, radius, friction, layer, hits }) {
    const description = this.rapier.ColliderDesc.ball(radius)
      .setTranslation(centre.x, centre.y, centre.z).setFriction(friction).setCollisionGroups(layerBits(layer, hits));
    return this.world.createCollider(description);
  }

  /** Take away something that addGround, addPillar or addBoulder made. */
  removeStatic(collider) {
    this.world.removeCollider(collider, false);
  }

  /** Free the library's memory for this world. The world cannot be used after this. */
  dispose() {
    this.world.free();
  }
}
