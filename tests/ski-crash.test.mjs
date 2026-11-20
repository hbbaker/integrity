/*
 * A crash in the physics world: the physics wrapper, the patch of ground that follows the body, and the ragdoll.
 */
import { load, loadConfig, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { loadPhysics } = await load('physics');
const { Heightfield } = await load('heightfield');
const { CrashGround } = await load('ski-crash-ground');
const { Ragdoll } = await load('ski-ragdoll');
const { PoseSolver } = await load('ski-pose-solver');
const { bendLimb } = await load('limb-ik');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const CONFIG = await loadConfig();
const STEP = CONFIG.fixedStep;
const GRAVITY = CONFIG.ski.rider.gravity;
const GROUND = { layer: 0, hits: [1, 2] };
const BODY = { layer: 1, hits: [0] };
const LOOSE = { layer: 2, hits: [0] };
const SURFACE = { density: 900, friction: 0.5 };
const NO_TURN = new THREE.Quaternion();
const ANATOMY = {
  hipsHeight: 0.918, hipJointHeight: 0.857, hipJointHalfWidth: 0.084, ankleHeight: 0.097, thighLength: 0.374, shinLength: 0.387,
  spineHeight: 1.009, neckHeight: 1.378, headTopHeight: 1.643, shoulderHeight: 1.321, shoulderHalfWidth: 0.173, upperArmLength: 0.303, foreArmLength: 0.305,
};
const factory = await loadPhysics();
check(factory === await loadPhysics(), 'should load the physics library once');

// --- the limb IK that the body model and the ragdoll share ---
const limb = bendLimb(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.4, 0), 0.4, 0.4, new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0));
check(Math.abs(limb.joint.distanceTo(new THREE.Vector3(0, 1, 0)) - 0.4) < 1e-9 && Math.abs(limb.joint.distanceTo(limb.end) - 0.4) < 1e-9 && limb.joint.z < -0.1, 'should bend a limb toward the hint, with both bones at their length');
const far = bendLimb(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -5, 0), 0.4, 0.4, new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0));
check(far.end.y > 0.19 && far.end.y < 0.21, 'should reach as far as the limb goes when the target is out of reach');

// --- the physics world ---
const flatGround = (world) => world.addGround({ positions: new Float32Array([-50, 0, -50, 50, 0, -50, -50, 0, 50, 50, 0, 50]), indices: new Uint32Array([0, 2, 1, 1, 2, 3]), friction: 0.5, ...GROUND });
const world = factory.createWorld(GRAVITY);
const floor = flatGround(world);
const at = new THREE.Vector3();
const turned = new THREE.Quaternion();
const run = (target, seconds) => { for (let steps = Math.round(seconds / STEP); steps > 0; steps--) target.step(STEP); };

const box = world.createBody({ position: new THREE.Vector3(0, 2, 0), rotation: NO_TURN });
world.addBox(box, { halfSize: { x: 0.2, y: 0.1, z: 0.2 }, centre: { x: 0, y: 0, z: 0 }, ...SURFACE, ...BODY });
run(world, 0.3);
world.read(box, at, turned);
check(Math.abs(at.y - (2 - 0.5 * GRAVITY * 0.3 * 0.3)) < 0.1, 'should drop a body under the gravity it was given');
run(world, 2);
world.read(box, at, turned);
check(Math.abs(at.y - 0.1) < 0.02 && world.speedOf(box) < 0.05, 'should rest a box on the ground');

const thrown = world.createBody({ position: new THREE.Vector3(5, 1, 0), rotation: NO_TURN, velocity: new THREE.Vector3(4, 0, 0), spin: new THREE.Vector3(0, 0, 3) });
world.addCapsule(thrown, { from: new THREE.Vector3(0, 0, 0), to: new THREE.Vector3(0, -0.4, 0), radius: 0.06, ...SURFACE, ...BODY });
world.step(STEP);
world.read(thrown, at, turned);
check(at.x > 5.05 && Math.abs(turned.w) < 1 && world.speedOf(thrown) > 3.5, 'should start a body with the speed and the spin it was given');

const passing = world.createBody({ position: new THREE.Vector3(0, 0.6, 0), rotation: NO_TURN });
world.addBox(passing, { halfSize: { x: 0.1, y: 0.1, z: 0.1 }, centre: { x: 0, y: 0, z: 0 }, ...SURFACE, ...LOOSE }); // LOOSE and BODY do not hit each other
run(world, 1.5);
world.read(passing, at, turned);
check(Math.abs(at.y - 0.1) < 0.02, 'should let two things pass through each other when their layers do not hit');

const upper = world.createBody({ position: new THREE.Vector3(-5, 3, 0), rotation: NO_TURN });
const lower = world.createBody({ position: new THREE.Vector3(-5, 2.5, 0), rotation: NO_TURN, velocity: new THREE.Vector3(3, 0, 2) });
for (const part of [upper, lower]) world.addCapsule(part, { from: new THREE.Vector3(0, 0, 0), to: new THREE.Vector3(0, -0.5, 0), radius: 0.05, ...SURFACE, ...BODY });
world.joinBall(upper, new THREE.Vector3(0, -0.5, 0), lower, new THREE.Vector3(0, 0, 0));
run(world, 0.4);
const upperEnd = new THREE.Vector3();
world.read(upper, at, turned);
upperEnd.set(0, -0.5, 0).applyQuaternion(turned).add(at);
world.read(lower, at, turned);
check(upperEnd.distanceTo(at) < 0.02, 'should hold two joined bodies together at the joint');

world.removeStatic(floor);
world.removeBody(thrown);
run(world, 1);
world.read(box, at, turned);
check(at.y < -1, 'should let things fall when the ground is taken away');
let badLayer = false;
try { world.addBox(box, { halfSize: { x: 1, y: 1, z: 1 }, centre: { x: 0, y: 0, z: 0 }, ...SURFACE, layer: 16, hits: [0] }); } catch { badLayer = true; }
check(badLayer, 'should refuse a collision layer outside 0..15');
world.dispose();

// --- the ground of a crash ---
const SLOPE = 15 * Math.PI / 180;
const heightfield = new Heightfield({ minX: -100, minZ: -400, cell: 1, columns: 200, rows: 500 });
heightfield.fill((x, z) => 150 + z * Math.tan(SLOPE));
const tree = { kind: 'tree', x: 0, y: heightfield.heightAt(0, -8), z: -8, radius: 0.5, height: 9 };
const course = { heightfield, obstacles: [tree, { kind: 'rock', x: 90, y: heightfield.heightAt(90, -300), z: -300, radius: 1, height: 1 }] };
const physics = factory.createWorld(GRAVITY);
const groundConfig = CONFIG.ski.crash.ground;
const ground = new CrashGround({ physics, course, config: groundConfig, ...GROUND });
ground.follow(0, 0);
check(ground.statics.length === 2, 'should put the snow and the tree that is near into the physics world, and not the rock that is far away');
const first = ground.centre;
ground.follow(groundConfig.halfCells - groundConfig.marginCells - 1, 0);
check(ground.centre === first, 'should keep the patch while the body is well inside it');
ground.follow(groundConfig.halfCells - groundConfig.marginCells + 1, 0);
check(ground.centre !== first && ground.statics.length === 2, 'should move the patch when the body comes near its edge');
ground.follow(0, 0);

const ball = physics.createBody({ position: new THREE.Vector3(3.3, heightfield.heightAt(3.3, 2.6) + 1, 2.6), rotation: NO_TURN });
physics.addBox(ball, { halfSize: { x: 0.1, y: 0.1, z: 0.1 }, centre: { x: 0, y: 0, z: 0 }, density: 900, friction: 5, ...BODY });
run(physics, 1.5);
physics.read(ball, at, turned);
check(Math.abs(at.y - 0.1 / Math.cos(SLOPE) - heightfield.heightAt(at.x, at.z)) < 0.03, 'should hold a body on exactly the snow that the heightfield gives');
const roller = physics.createBody({ position: new THREE.Vector3(0, heightfield.heightAt(0, -2) + 0.4, -2), rotation: NO_TURN, velocity: new THREE.Vector3(0, 0, -6) });
physics.addCapsule(roller, { from: new THREE.Vector3(-0.2, 0, 0), to: new THREE.Vector3(0.2, 0, 0), radius: 0.3, density: 900, friction: 0.1, ...BODY });
run(physics, 2);
physics.read(roller, at, turned);
check(at.z > tree.z - tree.radius - 0.3 || Math.abs(at.x) > tree.radius, 'should stop a body at a tree, or turn it aside');
physics.removeBody(ball);
physics.removeBody(roller);

// --- the ragdoll ---
const solver = new PoseSolver({ config: CONFIG.ski.pose, ride: 'skis' });
let pose;
for (let i = 0; i < 120; i++) pose = solver.update(STEP, { edge: 0.6, tuck: 0.3, brake: 0, mountainEdge: 1, grounded: true, accelSide: 0, accelFore: 0, popCharge: 0, spinRate: 0, flipRate: 0, grab: null }, ANATOMY);
const ragdoll = new Ragdoll({ physics, anatomy: ANATOMY, config: CONFIG.ski.crash.body, ...BODY });
check(!ragdoll.active, 'should not be in the world before it is spawned');
const origin = new THREE.Vector3(20, heightfield.heightAt(20, 0), 0);
const heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
const inWorld = (point) => point.clone().applyQuaternion(heading).add(origin);
ground.follow(origin.x, origin.z);
ragdoll.spawn({ pose, origin, turn: heading, velocity: new THREE.Vector3(0, -3, -12), legsKeep: 0.45, toss: new THREE.Vector3(2, 1.6, 0) });
const start = ragdoll.read();
const fromRig = (point) => point.clone().add(ragdoll.origin);
check(ragdoll.active && Object.keys(ragdoll.parts).length === 11, 'should be eleven joined parts');
check(['Left', 'Right'].every((side) => fromRig(start.feet[side].ankle).distanceTo(inWorld(pose.feet[side].ankle)) < 0.01), 'should start with the ankles where the rider had them');
check(['Left', 'Right'].every((side) => fromRig(start.hands[side].wrist).distanceTo(inWorld(pose.hands[side].wrist)) < 0.01), 'should start with the wrists where the rider had them');
check(Math.abs(ragdoll.origin.y + ANATOMY.hipsHeight - inWorld(new THREE.Vector3(0, ANATOMY.hipsHeight, 0).add(pose.hips.offset)).y) < 1e-3 && start.hips.offset.length() === 0, 'should start with the hips where the rider had them');
check(start.hips.turn.angleTo(heading.clone().multiply(pose.hips.turn)) < 1e-3, 'should start with the hips turned as the rider had them');
check(['Left', 'Right'].every((side) => ragdoll.ankleWorld(side, new THREE.Vector3()).distanceTo(fromRig(start.feet[side].ankle)) < 1e-6), 'should give the ankles in the world, for a board to hold');

let finite = true;
let lowest = Infinity;
let furthestApart = 0;
const pelvisAt = new THREE.Vector3();
const chestAt = new THREE.Vector3();
for (let i = 0; i < 300; i++) {
  physics.step(STEP);
  const now = ragdoll.read();
  ground.follow(ragdoll.origin.x, ragdoll.origin.z);
  finite &&= Number.isFinite(ragdoll.origin.x + now.feet.Left.ankle.y + now.hands.Right.wrist.z);
  lowest = Math.min(lowest, ragdoll.origin.y + ANATOMY.hipsHeight - heightfield.heightAt(ragdoll.origin.x, ragdoll.origin.z));
  physics.read(ragdoll.parts.pelvis, pelvisAt, turned);
  physics.read(ragdoll.parts.chest, chestAt, turned);
  furthestApart = Math.max(furthestApart, pelvisAt.distanceTo(chestAt));
}
check(finite, 'should stay finite through a tumble');
check(lowest > 0, `should keep the pelvis above the snow (lowest: ${lowest.toFixed(2)} m)`);
check(Math.abs(furthestApart - (ANATOMY.spineHeight - ANATOMY.hipsHeight)) < 0.03, 'should keep the chest joined to the pelvis');
check(ragdoll.origin.z < -3, 'should carry on down the hill');
check(ragdoll.speed < 1.5, `should come to rest on a 15 degree slope (${ragdoll.speed.toFixed(2)} m/s after 5 s)`);
ragdoll.spawn({ pose, origin, turn: heading, velocity: new THREE.Vector3(), legsKeep: 1, toss: new THREE.Vector3() });
check(Object.keys(ragdoll.parts).length === 11 && Math.abs(ragdoll.origin.x - origin.x) < 0.5, 'should start again from the new place when it is spawned twice');
ragdoll.remove();
ragdoll.remove();
check(!ragdoll.active, 'should leave the world when it is removed');
ground.dispose();
check(ground.statics.length === 0 && ground.centre === null, 'should take the ground out of the physics world when it is disposed');
physics.dispose();

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
