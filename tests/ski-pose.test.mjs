/*
 * The rider's body: the pose solver's output for fixed rider states, and the body model posed directly from it.
 */
import { readFile } from 'node:fs/promises';
import { load, loadConfig, installDomStubs, ROOT } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { BodyRig } = await load('body-rig');
const { HUMANOID_KIT, HUMANOID_MATERIALS } = await load('humanoid');
const { YBotSkin, parseYBot } = await load('y-bot');
const { PoseSolver } = await load('ski-pose-solver');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

const CONFIG = await loadConfig();
const config = CONFIG.ski.pose;
const STEP = 1 / 60;
const ANATOMY = { hipsHeight: 0.92, ankleHeight: 0.1 };
const LEFT_EDGE = -1;
const RIGHT_EDGE = 1;
const REST = { edge: 0, tuck: 0, brake: 0, mountainEdge: LEFT_EDGE, grounded: true, accelSide: 0, accelFore: 0, popCharge: 0, spinRate: 0, flipRate: 0, grab: null };
/** The pose a rider settles into when `input` is held. Vectors and turns are copied, because the solver reuses them. */
function settled(ride, input, anatomy = ANATOMY) {
  const solver = new PoseSolver({ config, ride });
  let pose;
  for (let i = 0; i < 300; i++) pose = solver.update(STEP, { ...REST, ...input }, anatomy);
  return { solver, pose };
}
const up = (turn) => new THREE.Vector3(0, 1, 0).applyQuaternion(turn);
const facing = (turn) => new THREE.Vector3(0, 0, -1).applyQuaternion(turn);

// --- 1. stance, on skis ---
const skis = config.skis;
const neutral = settled('skis', {}).pose;
check(near(neutral.feet.Left.ankle.x, skis.feet.Left.x) && near(neutral.feet.Right.ankle.x, skis.feet.Right.x) && near(neutral.feet.Left.ankle.y, ANATOMY.ankleHeight), 'should stand the feet on the skis, an ankle height above the snow, when the rider goes straight');
check(near(neutral.hips.offset.y, -skis.hipDrop) && near(neutral.hips.offset.x, 0), 'should lower the hips by the stance height');
check(up(neutral.chest).z < -0.2 && near(up(neutral.chest).x, 0), 'should fold the torso forward');
check(facing(neutral.head).z < -0.95, 'should keep the head facing down the hill');
check(neutral.hands.Left.wrist.x < -0.2 && neutral.hands.Right.wrist.x > 0.2 && neutral.hands.Left.wrist.z < 0, 'should hold the hands apart and in front');
check(near(neutral.ride.roll, 0) && near(neutral.ride.lift, 0), 'should keep the skis flat when the rider goes straight');

const tucked = settled('skis', { tuck: 1 }).pose;
check(near(tucked.hips.offset.y, -skis.tuckHipDrop, 1e-3) && up(tucked.chest).z < up(neutral.chest).z - 0.3, 'should sit lower and fold further forward in a tuck');
check(Math.abs(tucked.hands.Left.wrist.x) < Math.abs(neutral.hands.Left.wrist.x), 'should bring the hands together in a tuck');
// The brake uses the mountain edge (docs/adr/0008): a hockey stop toward that edge's side.
const brakeRight = settled('skis', { brake: 1, mountainEdge: RIGHT_EDGE }).pose;
const brakeLeft = settled('skis', { brake: 1, mountainEdge: LEFT_EDGE }).pose;
check(near(brakeRight.ride.yaw, -skis.skidYaw, 1e-3) && near(brakeRight.ride.roll, -skis.brakeEdge, 1e-3), 'should swing the skis to the right, onto their right edge, when the rider brakes on the right edge');
check(near(brakeLeft.ride.yaw, skis.skidYaw, 1e-3) && near(brakeLeft.ride.roll, skis.brakeEdge, 1e-3), 'should swing the skis to the left, onto their left edge, when the rider brakes on the left edge');
check(near(brakeRight.feet.Left.yaw, brakeRight.feet.Right.yaw) && brakeRight.hips.offset.y < neutral.hips.offset.y - 0.05, 'should keep the skis parallel and sit lower in a brake');
check(facing(brakeRight.head).z < -0.95 && facing(brakeRight.chest).x < facing(brakeRight.hips.turn).x, 'should keep the head down the hill, and the chest turned less than the hips, in a brake');
const flying = settled('skis', { grounded: false }).pose;
check(flying.hips.offset.y > neutral.hips.offset.y + config.airExtend * 0.9, 'should lengthen the legs in the air');

// --- 2. carve lean and 6. feet on the rolled ride ---
const right = settled('skis', { edge: 1 }).pose;
const left = settled('skis', { edge: -1 }).pose;
check(near(right.ride.roll, -config.maxEdge) && right.ride.lift > 0, 'should roll the skis onto the right edge, and lift their middle, in a full right turn');
check(right.hips.offset.x > 0.3 && near(right.hips.offset.x, -left.hips.offset.x, 1e-6), 'should lean the hips into the turn, the same amount to either side');
check(up(right.hips.turn).x > up(right.chest).x && up(right.chest).x > up(right.head).x && up(right.head).x > 0, 'should lean the hips most, the chest less and the head least');
check(right.feet.Right.ankle.z < right.feet.Left.ankle.z, 'should run the inside ski ahead in a turn');
check(right.feet.Right.sole.y < right.feet.Left.sole.y && right.feet.Right.sole.y >= 0, 'should keep the inside ski low and both skis out of the snow when the ride is rolled');
check(up(right.feet.Left.turn).distanceTo(new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), right.ride.roll)) < 1e-6, 'should keep the feet flat on the rolled skis');
check(right.feet.Left.knee.x > neutral.feet.Left.knee.x, 'should drive the knees into the turn');

// --- 5. sway ---
const pushed = new PoseSolver({ config, ride: 'skis' });
let tip = 0;
let furthest = 0;
for (let i = 0; i < 20; i++) tip = up(pushed.update(STEP, { ...REST, accelSide: 10 }, ANATOMY).chest).x;
check(tip < -0.01, 'should tip the chest away from a sudden push to the side');
for (let i = 0; i < 400; i++) furthest = Math.min(furthest, up(pushed.update(STEP, REST, ANATOMY).chest).x);
check(Math.abs(up(pushed.pose.chest).x) < 1e-3, 'should bring the chest back when the push ends');
const steady = settled('skis', { accelSide: 1000 }).pose;
check(Math.asin(-up(steady.chest).x) <= config.sway.max + 1e-6, 'should limit how far the chest sways');
pushed.update(STEP, { ...REST, accelFore: 10, tuck: 1 }, ANATOMY);
pushed.reset();
check(pushed.tuck === 0 && pushed.swayFore.value === 0, 'should return to the neutral stance at once when it is reset');

// --- 3. tricks (docs/adr/0012) ---
const AIRBORNE = { grounded: false };
const charged = settled('skis', { popCharge: 1 }).pose;
check(charged.hips.offset.y < neutral.hips.offset.y - config.popCrouch * 0.9, 'should sink the body as the pop charges');
const plainAir = settled('skis', AIRBORNE).pose;
const spinning = settled('skis', { ...AIRBORNE, spinRate: config.trick.maxSpin }).pose;
check(spinning.feet.Left.sole.y > plainAir.feet.Left.sole.y + config.trick.tuckLift * 0.9 && spinning.hips.offset.y < plainAir.hips.offset.y + 0.01, 'should pull the ride up under the body in a fast spin, and not lift the body');
check(facing(spinning.chest).x < -0.3 && facing(spinning.head).x < facing(spinning.chest).x, 'should lead a spin to the left with the chest, and more with the head');
check(facing(settled('skis', { ...AIRBORNE, spinRate: -config.trick.maxSpin }).pose.chest).x > 0.3, 'should lead a spin to the right the other way');
const inFlip = settled('skis', { ...AIRBORNE, flipRate: config.trick.tuckFlip }).pose;
check(inFlip.feet.Left.sole.y > plainAir.feet.Left.sole.y + config.trick.tuckLift * 0.9, 'should tuck in a flip');
check(settled('skis', { spinRate: config.trick.maxSpin, grab: 'indy' }).pose.feet.Left.sole.y < 0.01, 'should not tuck or grab on the snow');
for (const ride of ['skis', 'board']) {
  for (const [id, grab] of Object.entries(config[ride].grabs)) {
    const { pose } = settled(ride, { ...AIRBORNE, grab: id });
    const point = new THREE.Vector3(grab.point.x, grab.point.y, grab.point.z).applyQuaternion(pose.ride.turn);
    point.y += pose.ride.lift;
    const other = grab.hand === 'Left' ? 'Right' : 'Left';
    const free = settled(ride, { ...AIRBORNE, grab: id }).pose.hands[other].wrist.clone();
    const noGrab = settled(ride, { ...AIRBORNE, flipRate: 99 }).pose; // tucked, with no grab
    check(pose.hands[grab.hand].wrist.distanceTo(point) < 0.01 && free.distanceTo(noGrab.hands[grab.hand].wrist) > 0.2, `should take the ${grab.hand.toLowerCase()} hand to the ride for the ${id} grab on ${ride === 'skis' ? 'skis' : 'a board'}, and leave the other hand`);
  }
}
const released = new PoseSolver({ config, ride: 'board' });
for (let i = 0; i < 120; i++) released.update(STEP, { ...REST, ...AIRBORNE, grab: 'tail' }, ANATOMY);
const held = released.pose.hands.Right.wrist.clone();
released.update(STEP, { ...REST, ...AIRBORNE }, ANATOMY);
check(released.pose.hands.Right.wrist.distanceTo(held) < 0.25 && released.pose.hands.Right.wrist.distanceTo(held) > 0.001, 'should let go of a grab smoothly, not in one frame');

// --- 4. the landing (docs/adr/0013) ---
const lander = new PoseSolver({ config, ride: 'skis' });
for (let i = 0; i < 120; i++) lander.update(STEP, REST, ANATOMY);
const standing = lander.pose.hips.offset.y;
lander.land(1);
let deepest = standing;
for (let i = 0; i < 30; i++) deepest = Math.min(deepest, lander.update(STEP, REST, ANATOMY).hips.offset.y);
check(deepest < standing - config.landing.crouch * 0.5, `should fold the body down after a hard landing (${(standing - deepest).toFixed(2)} m)`);
for (let i = 0; i < 240; i++) lander.update(STEP, REST, ANATOMY);
check(Math.abs(lander.pose.hips.offset.y - standing) < 0.01, 'should stand up again after the landing');
const soft = new PoseSolver({ config, ride: 'skis' });
for (let i = 0; i < 120; i++) soft.update(STEP, REST, ANATOMY);
soft.land(0.2);
let softDeepest = standing;
for (let i = 0; i < 30; i++) softDeepest = Math.min(softDeepest, soft.update(STEP, REST, ANATOMY).hips.offset.y);
check(softDeepest > deepest + 0.05 && softDeepest < standing, 'should fold less after a soft landing');
soft.land(1);
soft.reset();
check(soft.update(STEP, REST, ANATOMY).hips.offset.y > standing - 0.02, 'should forget the landing when it is reset');

// --- the board ---
const board = config.board;
const riding = settled('board', {}).pose;
check(near(riding.feet.Left.ankle.z, board.feet.Left.z) && near(riding.feet.Right.ankle.z, board.feet.Right.z) && near(riding.feet.Left.ankle.x, 0), 'should stand the feet along the board, the left foot in front');
check(facing(riding.hips.turn).x > 0.8 && facing(riding.chest).x < facing(riding.hips.turn).x && facing(riding.head).z < -0.9, 'should turn the body to the side on a board, the chest less, and keep the head down the hill');
check(riding.feet.Left.knee.x > 0.9, 'should point the knees the way the toes point');
const TOE_EDGE = CONFIG.ski.rides.board.toeEdge;
const heelBrake = settled('board', { brake: 1, mountainEdge: -TOE_EDGE }).pose;
const toeBrake = settled('board', { brake: 1, mountainEdge: TOE_EDGE }).pose;
const edgeDown = (pose) => new THREE.Vector3(1, 0, 0).applyQuaternion(pose.ride.turn).y; // below zero: the right (toe) edge is the low one
check(near(toeBrake.ride.yaw, -TOE_EDGE * board.skidYaw, 1e-3) && edgeDown(toeBrake) * TOE_EDGE < -0.3, 'should swing the nose toward the toes and dig in the toe edge when the rider brakes toeside');
check(near(heelBrake.ride.yaw, TOE_EDGE * board.skidYaw, 1e-3) && edgeDown(heelBrake) * TOE_EDGE > 0.3, 'should swing the nose toward the heels and dig in the heel edge when the rider brakes heelside');
check(Math.abs(toeBrake.feet.Left.ankle.x) > 0.15 && near(toeBrake.feet.Left.ankle.x, -heelBrake.feet.Left.ankle.x, 1e-3), 'should swing the board across the slope, to opposite sides for the two edges');
const flipping = new PoseSolver({ config, ride: 'board' });
for (let i = 0; i < 300; i++) flipping.update(STEP, { ...REST, brake: 1, mountainEdge: -TOE_EDGE }, ANATOMY);
const yawBefore = flipping.pose.ride.yaw;
flipping.update(STEP, { ...REST, brake: 1, mountainEdge: TOE_EDGE }, ANATOMY);
check(Math.abs(flipping.pose.ride.yaw - yawBefore) < 0.3, 'should swing the board round smoothly, not jump, when the edge changes during a brake');
const carveBrake = settled('board', { brake: 1, edge: 1, mountainEdge: RIGHT_EDGE }).pose;
check(carveBrake.ride.roll >= -config.maxEdge - 1e-9, 'should never roll the ride past its full edge');
const boardRight = settled('board', { edge: 1 }).pose;
check(boardRight.hips.offset.x > 0.3 && near(boardRight.ride.roll, -config.maxEdge), 'should lean a board rider into a turn like a skier');

// --- the body model, posed directly ---
const file = await readFile(`${ROOT}/game/assets/y-bot.fbx`);
const template = parseYBot(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const body = new BodyRig(HUMANOID_MATERIALS);
body.setKit(HUMANOID_KIT, HUMANOID_MATERIALS);
const skin = new YBotSkin(body, { load: async () => template });
check(skin.anatomy() === null, 'should have no measurements while the model loads');
skin.driveBones(neutral); // must not throw before the model is there
await new Promise((resolve) => setTimeout(resolve, 0));
const anatomy = skin.anatomy();
check(anatomy.hipsHeight > 0.85 && anatomy.hipsHeight < 1 && anatomy.ankleHeight > 0.05 && anatomy.ankleHeight < 0.15 && near(anatomy.legLength, anatomy.hipJointHeight - anatomy.ankleHeight, 0.02), 'should measure the hips, the ankles and the legs of the loaded model');
const at = (name) => { body.root.updateWorldMatrix(true, true); return skin.model.getObjectByName(`mixamorig${name}`).getWorldPosition(new THREE.Vector3()); };
const drive = (ride, input) => { const { pose } = settled(ride, input, anatomy); skin.driveBones(pose); return pose; };

for (const [ride, label, input] of [['skis', 'straight', {}], ['skis', 'in a tuck', { tuck: 1 }], ['skis', 'in a right turn', { edge: 1 }], ['board', 'straight', {}], ['board', 'in a left turn', { edge: -1 }], ['board', 'braking', { brake: 1 }]]) {
  const pose = drive(ride, input);
  const feetOff = Math.max(at('LeftFoot').distanceTo(pose.feet.Left.ankle), at('RightFoot').distanceTo(pose.feet.Right.ankle));
  const handsOff = Math.max(at('LeftHand').distanceTo(pose.hands.Left.wrist), at('RightHand').distanceTo(pose.hands.Right.wrist));
  check(feetOff < 0.005 && handsOff < 0.005, `should put the ankles and wrists where the pose asks, on ${ride === 'skis' ? 'skis' : 'a board'} ${label} (${feetOff.toFixed(4)} m, ${handsOff.toFixed(4)} m off)`);
}
for (const ride of ['skis', 'board']) {
  for (const [id, grab] of Object.entries(config[ride].grabs)) {
    const pose = drive(ride, { grounded: false, grab: id });
    const handOff = at(`${grab.hand}Hand`).distanceTo(pose.hands[grab.hand].wrist);
    const feetOff = Math.max(at('LeftFoot').distanceTo(pose.feet.Left.ankle), at('RightFoot').distanceTo(pose.feet.Right.ankle));
    check(handOff < 0.04 && feetOff < 0.005, `should bring the hand of the model to the ride in the ${id} grab on ${ride === 'skis' ? 'skis' : 'a board'} (${handOff.toFixed(3)} m off)`);
  }
}
const straight = drive('skis', {});
check(at('LeftLeg').z < at('LeftUpLeg').z - 0.05 && at('RightLeg').z < at('RightUpLeg').z - 0.05, 'should bend the knees forward on skis');
check(near(at('Hips').y, anatomy.hipsHeight + straight.hips.offset.y, 0.005), 'should move the hips by the offset of the pose');
check(at('Head').y > at('Hips').y + 0.4 && at('Head').z < at('Hips').z, 'should carry the head above and ahead of the hips');
const tuckedBody = drive('skis', { tuck: 1 });
check(at('Head').y < anatomy.hipsHeight + 0.15 && near(at('Hips').y, anatomy.hipsHeight + tuckedBody.hips.offset.y, 0.005), 'should fold the model small in a tuck');
drive('board', {});
check(at('LeftLeg').x > at('LeftUpLeg').x && at('RightLeg').x > at('RightUpLeg').x, 'should bend the knees toward the toes on a board');

const farFoot = settled('skis', {}, anatomy).pose;
farFoot.feet.Left.ankle.set(-3, 0.1, 0); // out of reach
skin.driveBones(farFoot);
const reach = at('LeftFoot').distanceTo(at('LeftUpLeg'));
check(near(reach, anatomy.legLength, 0.01), 'should stretch the leg straight toward a foot that is out of reach');
skin.sync();
check(near(at('Hips').y, anatomy.hipsHeight, 0.02) && near(at('LeftFoot').x, -anatomy.hipJointHalfWidth, 0.03), 'should stand the model up again when the rig poses it after a direct pose');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
