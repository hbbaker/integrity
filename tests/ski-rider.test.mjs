/*
 * The rider controller: how skis and a board move on a slope (gravity, grip, turns, brake, air, trees).
 */
import { load, loadConfig, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { Heightfield } = await load('heightfield');
const { Rider, RIGHT_EDGE, LEFT_EDGE } = await load('ski-rider');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };

const CONFIG = await loadConfig();
const STEP = CONFIG.fixedStep;
const DEGREES = Math.PI / 180;
const REST = { steer: 0, tuck: 0, brake: 0 };
const TUCK = { steer: 0, tuck: 1, brake: 0 };
const BRAKE = { steer: 0, tuck: 0, brake: 1 };
const RIGHT = { steer: 1, tuck: 0, brake: 0 };

/** A course that is one flat slope falling toward -Z at `degrees`, with optional changes to its ground and obstacles. */
function makeCourse(degrees, { ground = () => 0, obstacles = [] } = {}) {
  const heightfield = new Heightfield({ minX: -150, minZ: -1500, cell: 1, columns: 300, rows: 1600 });
  const rise = Math.tan(degrees * DEGREES);
  heightfield.fill((x, z) => z * rise + ground(x, z));
  return { heightfield, obstacles, start: { x: 0, y: heightfield.heightAt(0, 0), z: 0, yaw: 0 } };
}
const makeRider = (course, ride = 'skis') => new Rider({ config: { ...CONFIG.ski.rider, ...CONFIG.ski.rides[ride] }, course });
const run = (rider, controls, seconds, each = null) => {
  for (let steps = Math.round(seconds / STEP); steps > 0; steps--) { // a whole number of steps: adding up 1/60 s drifts
    rider.step(STEP, controls);
    if (each) each(rider);
  }
};
const config = CONFIG.ski.rider;

// --- at rest ---
const gentle = makeRider(makeCourse(3));
run(gentle, REST, 5);
check(gentle.pos.x === 0 && gentle.pos.z === 0 && gentle.speed === 0, 'should stay exactly where it is when it rests on a gentle slope');
check(gentle.grounded && gentle.pos.y === gentle.course.heightfield.heightAt(0, 0), 'should rest on the snow');

// --- gravity, friction and drag ---
const slope = makeCourse(20);
const sliding = makeRider(slope);
let offSnow = 0;
let acrossSlope = 0;
const normal = new THREE.Vector3();
run(sliding, REST, 2, (rider) => {
  if (!rider.grounded) offSnow++;
  acrossSlope = Math.max(acrossSlope, Math.abs(rider.vel.dot(rider.course.heightfield.normalAt(rider.pos.x, rider.pos.z, normal))));
});
const freeFall = config.gravity * (Math.sin(20 * DEGREES) - config.friction * Math.cos(20 * DEGREES)) * 2;
check(sliding.speed > freeFall * 0.85 && sliding.speed < freeFall, `should speed up down a 20 degree slope a little slower than friction alone allows (${sliding.speed.toFixed(2)} of ${freeFall.toFixed(2)} m/s)`);
check(sliding.pos.z < -4 && Math.abs(sliding.pos.x) < 1e-6, 'should slide straight down the fall line when it is not steered');
check(offSnow === 0 && acrossSlope < 1e-6, 'should stay on the snow, moving along it, when the slope is even');
check(sliding.pos.y === slope.heightfield.heightAt(sliding.pos.x, sliding.pos.z), 'should be exactly on the ground that is drawn');

const upright = makeRider(slope);
const tucked = makeRider(slope);
run(upright, REST, 40);
run(tucked, TUCK, 40);
const terminal = Math.sqrt(config.gravity * (Math.sin(20 * DEGREES) - config.friction * Math.cos(20 * DEGREES)) / config.drag);
check(Math.abs(upright.speed - terminal) < 0.5, `should settle at the speed where drag meets gravity (${upright.speed.toFixed(1)} of ${terminal.toFixed(1)} m/s)`);
check(tucked.speed > upright.speed * 1.2, 'should go faster in a tuck');
check(tucked.speed <= config.maxSpeed, 'should never pass the speed limit');

// --- push and brake ---
const flat = makeRider(makeCourse(0));
run(flat, TUCK, 6);
check(flat.speed > config.pushSpeed * 0.8 && flat.speed <= config.pushSpeed + 1e-6, 'should push off up to the push speed when "tuck" is held on flat ground');
run(flat, REST, 30);
check(flat.speed === 0, 'should glide to a stop on flat ground');
const braking = makeRider(slope);
run(braking, REST, 3);
const before = braking.speed;
run(braking, BRAKE, 4);
check(before > 8 && braking.speed < 1e-9, 'should stop on a 20 degree slope, and stay stopped, when the brake is held');

// --- turning ---
const turning = makeRider(slope);
run(turning, REST, 2);
run(turning, RIGHT, 0.6);
check(turning.heading < -0.3 && turning.pos.x > 0.5, 'should turn the ride to the right and travel that way when it is steered right');
check(turning.edge > 0.5, 'should roll onto the right edge in a right turn');
const turnRate = (seconds) => {
  const rider = makeRider(slope);
  run(rider, REST, seconds);
  const from = rider.heading;
  run(rider, RIGHT, 0.25);
  return (from - rider.heading) / 0.25;
};
check(turnRate(1) > turnRate(8) * 1.5, 'should turn wider when it goes faster');
const lateral = makeRider(slope);
run(lateral, REST, 8);
const speedIn = lateral.speed;
run(lateral, RIGHT, 0.25);
check(turnRate(8) * speedIn <= lateral.config.maxLateralAccel * 1.05, 'should pull no harder in a turn than the ride allows');
const boardTurn = (() => { const rider = makeRider(slope, 'board'); run(rider, REST, 8); const from = rider.heading; run(rider, RIGHT, 0.25); return from - rider.heading; })();
check(boardTurn < turnRate(8) * 0.25, 'should turn wider on a board than on skis at the same speed');
const across = makeRider(slope);
across.heading = -Math.PI / 2; // the ride points across the slope
run(across, REST, 3);
check(across.pos.x === 0 && across.pos.z === 0, 'should hold on its edges when the ride rests across a steep slope');
const skewed = makeRider(slope);
run(skewed, REST, 3);
skewed.heading = 0.6; // the ride is knocked round, but still travels down the fall line
run(skewed, REST, 2.5);
check(Math.abs(skewed.heading - skewed.travelYaw) < 0.08, 'should swing the ride round to point the way it travels when it is not steered');
const spinning = makeRider(slope);
run(spinning, RIGHT, 6);
check(Math.abs(spinning.heading) <= Math.PI, 'should keep the heading between -PI and PI');

// --- the mountain edge (docs/adr/0008) ---
const LEFT = { steer: -1, tuck: 0, brake: 0 };
const fresh = makeRider(slope);
check(fresh.mountainEdge === CONFIG.ski.rides.skis.startEdge && makeRider(slope, 'board').mountainEdge === CONFIG.ski.rides.board.startEdge, 'should start on the edge that the ride names');
const carver = makeRider(slope);
run(carver, REST, 2);
run(carver, RIGHT, 0.5);
check(carver.mountainEdge === RIGHT_EDGE, 'should be on the right edge in a right carve');
run(carver, LEFT, 0.35);
check(carver.heading < 0 && carver.mountainEdge === LEFT_EDGE, 'should change to the left edge as soon as a left carve is set, before the ride crosses the fall line');
const straightened = makeRider(slope);
run(straightened, REST, 2);
run(straightened, RIGHT, 0.4);
run(straightened, REST, 3); // the ride swings back down the fall line, flat
check(Math.abs(straightened.edge) < 0.05 && straightened.mountainEdge === RIGHT_EDGE, 'should remember the last edge when the ride runs flat down the fall line');
const traverse = (heading) => { const rider = makeRider(slope); rider.heading = heading; run(rider, REST, 0.1); return rider; };
check(traverse(-Math.PI / 2).mountainEdge === RIGHT_EDGE, 'should be on the right edge when the flat ride lies across the slope with its right side to the mountain');
check(traverse(Math.PI / 2).mountainEdge === LEFT_EDGE, 'should be on the left edge when its left side is to the mountain');
const level = makeRider(makeCourse(0));
level.heading = -Math.PI / 2;
run(level, REST, 0.5);
check(level.mountainEdge === CONFIG.ski.rides.skis.startEdge, 'should keep its edge on level ground, where no side is to the mountain');
const airborne = makeRider(makeCourse(15, { ground: (x, z) => (z < -60 ? -6 : 0) }));
run(airborne, RIGHT, 1);
let edgeAtTakeOff = null;
let changedInAir = false;
run(airborne, REST, 8, (rider) => {
  if (rider.grounded) { edgeAtTakeOff = rider.mountainEdge; return; }
  if (rider.mountainEdge !== edgeAtTakeOff) changedInAir = true;
});
check(!changedInAir, 'should keep its edge while it is in the air');

// --- edge catching (docs/adr/0009) ---
const BRAKE_RIGHT = { steer: 1, tuck: 0, brake: 1 };
const BRAKE_LEFT = { steer: -1, tuck: 0, brake: 1 };
/** Ride until the rider is fast, on its right edge. */
const fastOnRightEdge = (ride = 'skis') => { const rider = makeRider(makeCourse(25), ride); run(rider, REST, 4); run(rider, RIGHT, 0.4); return rider; };
const catches = (rider, controls, seconds) => { let caught = 0; run(rider, controls, seconds, (r) => { if (r.caught !== 0 && caught === 0) caught = r.caught; }); return caught; };

const cleanCarve = fastOnRightEdge();
check(catches(cleanCarve, RIGHT, 3) === 0 && cleanCarve.catchLoad === 0, 'should never catch an edge in a steady carve');
const cleanBrake = fastOnRightEdge();
check(cleanBrake.mountainEdge === RIGHT_EDGE && catches(cleanBrake, BRAKE, 0.5) === 0 && cleanBrake.catchLoad === 0, 'should brake safely on the edge it is on');
check(catches(fastOnRightEdge(), BRAKE_RIGHT, 0.5) === 0, 'should brake safely when the player holds the same edge');
const wrongEdge = fastOnRightEdge();
run(wrongEdge, BRAKE, 0.1);
const caughtEdge = catches(wrongEdge, BRAKE_LEFT, 0.5);
check(caughtEdge === LEFT_EDGE, 'should catch the left edge when the player sets it during a brake on the right edge');
check(wrongEdge.mountainEdge === RIGHT_EDGE, 'should stay on the edge the brake began on, whatever the player steers');
check(catches(fastOnRightEdge('board'), BRAKE_LEFT, 0.6) === LEFT_EDGE, 'should catch the heel edge of a board when it is set during a toeside brake');

const slowWrong = makeRider(makeCourse(4));
run(slowWrong, TUCK, 3);
run(slowWrong, RIGHT, 0.4);
check(slowWrong.speed < config.catchMinSpeed && catches(slowWrong, BRAKE_LEFT, 1) === 0, 'should never catch an edge at low speed');

// Rule 1 (docs/adr/0010): an edge change that is too fast.
const SWITCH = CONFIG.ski.rides.board.edgeChangeTime;
const changeEdge = (ride, pause) => { const rider = fastOnRightEdge(ride); if (pause > 0) run(rider, REST, pause); return { rider, caught: catches(rider, LEFT, 0.5) }; };
check(changeEdge('board', 0).caught === LEFT_EDGE, 'should catch the new edge when the player goes straight from one edge to the other at speed');
check(changeEdge('skis', 0).caught === LEFT_EDGE, 'should catch the new edge on skis too');
check(changeEdge('board', SWITCH - 2 * STEP).caught === LEFT_EDGE, 'should catch when the moment between the edges is shorter than the ride needs');
check(changeEdge('board', SWITCH + 2 * STEP).caught === 0, 'should change edge safely when there is a moment with no steering between the edges');
const slowChange = makeRider(makeCourse(4));
run(slowChange, TUCK, 3);
run(slowChange, RIGHT, 0.4);
check(slowChange.speed < config.catchMinSpeed && catches(slowChange, LEFT, 0.5) === 0, 'should change edge straight across safely at low speed');
const tapped = makeRider(makeCourse(25));
run(tapped, REST, 4);
run(tapped, RIGHT, 2 * STEP); // a tap: the ride is not on the right edge yet
check(catches(tapped, LEFT, 0.3) === 0, 'should not catch after a tap that never set the first edge');
const sameSide = fastOnRightEdge();
run(sameSide, REST, 2 * STEP);
check(catches(sameSide, RIGHT, 0.5) === 0, 'should not catch when the player lets go and takes the same edge again');
const stick = fastOnRightEdge();
check(catches(stick, { steer: -0.2, tuck: 0, brake: 0 }, 0.3) === 0, 'should not count a small push of the stick to the other side as a demand for that edge');

// Rule 2 (docs/adr/0010): the wrong edge for the slope.
const GRACE = config.wrongEdgeGrace;
/** A rider that travels across a slope: `heading` -PI/2 points to the right, with the right side to the mountain. */
const traversing = (degrees, heading) => { const rider = makeRider(makeCourse(degrees)); rider.heading = heading; rider.vel.set(-Math.sin(heading), 0, -Math.cos(heading)).multiplyScalar(14); return rider; };
const HOLD_LEFT = { steer: -0.35, tuck: 0, brake: 0 }; // enough to set the edge, too little to bring the ride round quickly
const onWrongEdge = traversing(30, -Math.PI / 2);
let wrongCaught = 0;
let wrongAt = 0;
let warned = false;
for (let t = 0; t < 2 && wrongCaught === 0; t += STEP) { onWrongEdge.step(STEP, HOLD_LEFT); wrongCaught = onWrongEdge.caught; wrongAt = t; warned ||= onWrongEdge.catchShare >= config.catchWarn; }
check(wrongCaught === LEFT_EDGE, 'should catch the downhill edge when the rider stays on it across a steep slope');
check(wrongAt >= GRACE - 0.05 && wrongAt < GRACE + 0.5 && warned, `should allow the grace time first, and warn before the catch (it caught after ${wrongAt.toFixed(2)} s)`);
check(catches(traversing(30, -Math.PI / 2), { steer: 0.35, tuck: 0, brake: 0 }, 2) === 0, 'should hold safely on the edge toward the mountain');
check(catches(traversing(30, Math.PI / 2), { steer: 0.35, tuck: 0, brake: 0 }, 2) === RIGHT_EDGE && catches(traversing(30, Math.PI / 2), HOLD_LEFT, 2) === 0, 'should treat the two directions across the slope alike');
check(catches(traversing(10, -Math.PI / 2), HOLD_LEFT, 2) === 0, 'should allow either edge on a gentle slope');
const turnIn = traversing(30, -0.9); // about 50 degrees off the fall line
check(catches(turnIn, LEFT, 2) === 0 && turnIn.heading > 0, 'should let a normal turn down the hill pass, though it starts on the downhill edge');
const linked = makeRider(makeCourse(26));
run(linked, REST, 4);
let linkedCaught = 0;
for (let t = 0; t < 8 && linkedCaught === 0; t += STEP) { const phase = t % 1.2; linked.step(STEP, { steer: phase < 0.15 ? 0 : (Math.floor(t / 1.2) % 2 ? 1 : -1), tuck: 0, brake: 0 }); linkedCaught = linked.caught; }
check(linkedCaught === 0, 'should link clean turns down a steep slope with no catch');
const interrupted = traversing(30, -Math.PI / 2);
run(interrupted, HOLD_LEFT, GRACE * 0.6);
run(interrupted, REST, 0.3);
check(interrupted.wrongEdgeTime === 0 && interrupted.caught === 0, 'should start the grace again when the rider comes off the wrong edge');

// A held edge earns grace for the next one (docs/adr/0011).
const BONUS = config.wrongEdgeBonus;
const HOLD_RIGHT = { steer: 0.35, tuck: 0, brake: 0 };
const committed = traversing(26, -0.8);
run(committed, HOLD_RIGHT, 0.15);
check(committed.holdShare === 0, 'should earn nothing from an edge that was held only for a moment');
run(committed, RIGHT, config.edgeHoldFull + 0.3);
check(committed.holdShare === 1, 'should earn the whole bonus from an edge that was held long enough');
const committedHeading = committed.heading;
const committedSpeed = committed.speed;
run(committed, REST, 0.12);
const committedCaught = catches(committed, LEFT, 2);
check(committed.wrongEdgeGrace > GRACE + BONUS * 0.7 && committed.wrongEdgeGrace <= GRACE + BONUS, `should give the new edge a long grace after a held edge and a prompt change (${committed.wrongEdgeGrace.toFixed(2)} s)`);
/** The same place, heading and speed as the committed rider had at its edge change, but with no edge held before. */
const sameTurn = () => { const rider = traversing(26, committedHeading); rider.vel.setLength(committedSpeed); return rider; };
const rushed = sameTurn();
const rushedCaught = catches(rushed, LEFT, 2);
check(rushed.wrongEdgeGrace === GRACE, 'should give only the base grace when no edge was held before');
check(committedCaught === 0 && rushedCaught === LEFT_EDGE, 'should let the committed rider make a turn that catches the edge of a rider who held nothing');
const hesitant = traversing(26, -0.8);
run(hesitant, RIGHT, config.edgeHoldFull + 0.3);
run(hesitant, REST, config.edgeHoldFull + 0.2); // too long with the ride flat
hesitant.step(STEP, LEFT);
run(hesitant, LEFT, 0.3);
check(hesitant.wrongEdgeGrace === GRACE, 'should lose what the held edge earned when the rider waits too long between the edges');
const partial = traversing(26, -0.8);
run(partial, RIGHT, (config.edgeHoldMin + config.edgeHoldFull) / 2 + 0.1);
run(partial, REST, 0.12);
run(partial, LEFT, 0.3);
check(partial.wrongEdgeGrace > GRACE && partial.wrongEdgeGrace < GRACE + BONUS, 'should earn part of the bonus from a shorter hold');
partial.reset({ x: 0, z: 0 }, 0);
check(partial.wrongEdgeGrace === GRACE && partial.holdShare === 0, 'should forget the hold when the rider is reset');

const afterCatch = fastOnRightEdge();
run(afterCatch, BRAKE, 0.1);
catches(afterCatch, BRAKE_LEFT, 0.5);
afterCatch.step(STEP, REST);
check(afterCatch.caught === 0, 'should report a catch for one step only');

// --- the ride's frame ---
const framed = makeRider(slope);
run(framed, REST, 1);
const up = new THREE.Vector3(0, 1, 0).applyQuaternion(framed.orientation);
const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(framed.orientation);
slope.heightfield.normalAt(framed.pos.x, framed.pos.z, normal);
check(up.distanceTo(normal) < 1e-3, 'should stand the ride square on the slope');
check(ahead.z < 0 && ahead.y < 0 && Math.abs(ahead.x) < 1e-6, 'should point the ride down the hill');
check(framed.accel.length() > 1 && framed.accel.z < 0, 'should report how its velocity changes, for the body to sway with');

// --- the air ---
const cliff = makeCourse(15, { ground: (x, z) => (z < -60 ? -6 : 0) }); // the ground drops 6 m at z = -60
const jumper = makeRider(cliff);
let airSteps = 0;
let landing = 0;
let longestAir = 0;
run(jumper, REST, 9, (rider) => {
  if (!rider.grounded) airSteps++;
  longestAir = Math.max(longestAir, rider.airTime);
  landing = Math.max(landing, rider.landingSpeed);
});
check(airSteps > 20 && jumper.grounded && jumper.pos.z < -70, `should fly off a cliff and land below it (${airSteps} steps in the air)`);
check(longestAir > 0.3 && jumper.airTime === 0, `should count the time in the air (${longestAir.toFixed(2)} s), and clear it on landing`);
check(landing > 3, `should report how hard it landed (${landing.toFixed(1)} m/s into the snow)`);
const rolling = makeCourse(15, { ground: (x, z) => Math.sin(z * 0.05) * 1.5 }); // long gentle rolls
const roller = makeRider(rolling);
let rollAir = 0;
run(roller, REST, 12, (rider) => { if (!rider.grounded) rollAir++; });
check(rollAir === 0 && roller.pos.z < -100, 'should stay glued to the snow over gentle rolls');

// --- pop, spins, flips and the landing (docs/adr/0012) ---
const POP = { steer: 0, tuck: 0, brake: 0, pop: true, grab: null };
const AIR = { steer: 0, tuck: 0, brake: 0, pop: false, grab: null };
const flatCourse = makeCourse(0);
/** Charge a pop for `seconds` on level ground and release it. Returns the rider just after take-off. */
const popped = (seconds, ride = 'skis') => { const rider = makeRider(flatCourse, ride); run(rider, TUCK, 3); run(rider, POP, seconds); rider.step(STEP, AIR); return rider; };
/** Step until the rider lands (or 5 s pass); returns the landing record and the greatest height reached. */
const flyOut = (rider, controls = AIR) => { let landed = null; let height = 0; for (let i = 0; i < 300 && !landed; i++) { rider.step(STEP, controls); height = Math.max(height, rider.pos.y - rider.course.heightfield.heightAt(rider.pos.x, rider.pos.z)); landed = rider.landed; } return { landed, height }; };

const charging = makeRider(flatCourse);
run(charging, POP, config.popChargeTime / 2);
check(charging.grounded && charging.popCharge > 0.4 && charging.popCharge < 0.6, 'should charge the pop while the control is held, and stay on the snow');
run(charging, POP, config.popChargeTime);
check(charging.popCharge === 1, 'should stop charging at a full pop');
const full = popped(config.popChargeTime + 0.1);
check(!full.grounded && full.vel.y > config.popSpeedMax * 0.9 && full.popCharge === 0, 'should leave the snow when the control is released');
const fullFlight = flyOut(full);
const tapFlight = flyOut(popped(STEP));
const expected = config.popSpeedMax ** 2 / (2 * config.gravity);
check(Math.abs(fullFlight.height - expected) < 0.15, `should rise as high as a full pop gives (${fullFlight.height.toFixed(2)} of ${expected.toFixed(2)} m)`);
check(tapFlight.height > 0.1 && tapFlight.height < fullFlight.height / 2, 'should make a small hop from a tap');
check(fullFlight.landed && !fullFlight.landed.crash && fullFlight.landed.spin === 0 && fullFlight.landed.flip === 0 && full.grounded, 'should land a plain pop cleanly');
full.step(STEP, AIR);
check(full.landed === null, 'should report a landing for one step only');
const inAir = popped(0.3);
run(inAir, POP, 0.3);
check(inAir.popCharge === 0, 'should not charge a pop in the air');
const lipCourse = makeCourse(15, { ground: (x, z) => (z < -60 ? -6 : 0) });
const late = makeRider(lipCourse);
let leftAt = null;
for (let i = 0; i < 600 && leftAt === null; i++) { late.step(STEP, late.pos.z < -50 ? POP : REST); if (!late.grounded) leftAt = late.vel.y; }
late.step(STEP, POP);
late.step(STEP, AIR); // released just after the lip
check(late.vel.y > leftAt + config.popSpeedMin, 'should still pop when the control is released just after the ride left the snow at a lip');

// spins and flips
const spinner = popped(0.6);
spinner.flick(1, 0);
check(spinner.spinRate === -config.flickSpin, 'should start a spin to the right from a flick to the right');
const headingBefore = spinner.heading;
run(spinner, AIR, 0.2);
check(spinner.heading < headingBefore - 1 && spinner.air.spin < -1, 'should keep turning at its spin rate in the air');
spinner.flick(1, 0);
spinner.flick(1, 0);
spinner.flick(1, 0);
check(spinner.spinRate === -config.maxSpinRate, 'should spin faster with each flick, up to the fastest spin');
const flipper = popped(0.6);
flipper.flick(0, 1);
run(flipper, AIR, 0.1);
const noseUp = new THREE.Vector3(0, 0, -1).applyQuaternion(flipper.orientation).y;
check(flipper.flipRate === config.flickFlip && flipper.air.flip > 0.5 && noseUp > 0.3, 'should start a back flip from a flick down (a pull back): the nose comes up');
const nudged = popped(0.6);
run(nudged, { ...AIR, steer: -1, tuck: 1 }, 0.3);
check(nudged.spinRate > 2 && nudged.flipRate < -2, 'should nudge a spin with left and right, and a front flip with forward, in the air');
const grabbing = popped(0.6);
run(grabbing, { ...AIR, steer: -1, tuck: 1, grab: 'indy' }, 0.3);
check(grabbing.spinRate === 0 && grabbing.flipRate === 0 && Math.abs(grabbing.air.grabs.indy - 0.3) < 0.02, 'should time a grab, and not turn the ride from the directions that pick it');
const onSnow = makeRider(flatCourse);
onSnow.flick(1, 1);
check(onSnow.spinRate === 0 && onSnow.flipRate === 0, 'should ignore a flick on the snow');

// landings: a cliff gives time for a full turn
const bigDrop = makeCourse(15, { ground: (x, z) => (z < -60 ? -14 : 0) });
/** Ride off the big drop and call `inAir(rider, seconds in the air)` on each step up there; returns the landing. */
const dropWith = (each, ride = 'skis') => { const rider = makeRider(bigDrop, ride); let landed = null; for (let i = 0; i < 900 && !landed; i++) { rider.step(STEP, AIR); if (!rider.grounded) each(rider); if (rider.landed?.time > 0.3) landed = rider.landed; } return { rider, landed }; }; // a hop of a step or two on the lip itself does not count
/** Turn at a steady rate that makes `turns` whole turns of spin and `flips` of flip in the time the drop gives. */
const airSeconds = dropWith(() => {}).landed.time;
const steady = (turns, flips) => (rider) => { rider.spinRate = (turns * 2 * Math.PI) / airSeconds; rider.flipRate = (flips * 2 * Math.PI) / airSeconds; };
check(airSeconds > 0.8, `should give enough air off the big drop to turn (${airSeconds.toFixed(2)} s)`);
const clean360 = dropWith(steady(1, 0)).landed;
check(!clean360.crash && !clean360.switch && Math.abs(Math.abs(clean360.spin) - 2 * Math.PI) < 0.3, 'should land a full spin cleanly');
const cleanFlip = dropWith(steady(0, 1));
check(!cleanFlip.landed.crash && Math.abs(cleanFlip.landed.flip - 2 * Math.PI) < 0.3, 'should land a full back flip cleanly');
cleanFlip.rider.step(STEP, AIR);
check(new THREE.Vector3(0, 1, 0).applyQuaternion(cleanFlip.rider.orientation).y > 0.9 && cleanFlip.rider.air.flip === 0, 'should stand the ride the right way up again after a landed flip');
const halfFlip = dropWith(steady(0, 0.5)).landed;
check(halfFlip.crash, 'should crash a landing on the head');
const sideways = dropWith(steady(0.25, 0)).landed;
check(sideways.crash && sideways.side !== 0, 'should crash a landing sideways, and say which side led');
const to180 = dropWith(steady(0.5, 0));
check(!to180.landed.crash && to180.landed.switch, 'should hold a landing backward, and call it switch');
run(to180.rider, REST, 3);
const offAfter = to180.rider.heading - to180.rider.travelYaw;
check(Math.abs(Math.atan2(Math.sin(offAfter), Math.cos(offAfter))) > Math.PI - 0.2 && to180.rider.speed > 10, `should ride on backward after a switch landing, tail first, and keep its speed (${to180.rider.speed.toFixed(1)} m/s)`);
const pathBefore = to180.rider.travelYaw;
run(to180.rider, RIGHT, 0.5);
const pathTurn = to180.rider.travelYaw - pathBefore;
check(Math.atan2(Math.sin(pathTurn), Math.cos(pathTurn)) < -0.1 && to180.rider.caught === 0, 'should still turn the path to the right when right is held while riding switch');
const nearly = dropWith(steady(1 - (config.landSpinTolerance * 0.8) / (2 * Math.PI), 0)).landed;
check(!nearly.crash, 'should forgive a spin that is a little short');
const drift = dropWith(() => {}, 'board').landed;
check(!drift.crash && drift.spin === 0, 'should land a plain drop on a board cleanly');

// --- the gravity load and the stomp (docs/adr/0013) ---
const STOMP = { ...AIR, stomp: true };
const plainPop = flyOut(popped(config.popChargeTime + 0.1)).landed;
check(Math.abs(plainPop.load - expected) < 0.15 && plainPop.stompAge === null, `should count the greatest height above the snow as the gravity load (${plainPop.load.toFixed(2)} m for a full pop)`);
const cliffDrop = dropWith(() => {}).landed;
check(cliffDrop.load > 12 && cliffDrop.load < 15.5, `should load a 14 m cliff with about its height (${cliffDrop.load.toFixed(1)} m)`);
const steepHop = (() => { const rider = makeRider(makeCourse(30)); run(rider, REST, 3); run(rider, POP, 0.2); rider.step(STEP, AIR); return flyOut(rider).landed; })();
check(steepHop.load < 2.5 && steepHop.time > 0.5, `should not load a small hop on a steep slope much, though the rider falls far along the hill (${steepHop.load.toFixed(2)} m)`);
check(plainPop.uprightShare === 0 && plainPop.sidewaysShare < 0.05, 'should report a square landing as square');
const crooked = dropWith(steady(1 - (config.landSpinTolerance * 0.5) / (2 * Math.PI), 0)).landed;
check(crooked.sidewaysShare > 0.3 && crooked.sidewaysShare < 0.7 && !crooked.crash, 'should report how much of the tolerance a crooked landing used');
/** Drop off the big cliff and press the stomp when `when(rider)` first says so. */
const stompWhen = (when) => { let pressed = false; const rider = makeRider(bigDrop); let landed = null; for (let i = 0; i < 900 && !landed; i++) { const press = !rider.grounded && !pressed && when(rider); pressed ||= press; rider.step(STEP, press ? STOMP : AIR); if (rider.landed?.time > 0.3) landed = rider.landed; } return landed; };
const lateStomp = stompWhen((rider) => rider.airTime > airSeconds - 0.1);
check(lateStomp.stompAge > 0.05 && lateStomp.stompAge < 0.15, `should report how long before the snow the stomp was pressed (${lateStomp.stompAge.toFixed(2)} s)`);
const earlyStomp = stompWhen((rider) => rider.airTime > 0.1);
check(earlyStomp.stompAge > airSeconds - 0.2, 'should report an early stomp as early');
const twice = (() => { const rider = makeRider(bigDrop); let landed = null; for (let i = 0; i < 900 && !landed; i++) { const early = !rider.grounded && rider.airTime > 0.1 && rider.airTime < 0.13; const late = !rider.grounded && rider.airTime > airSeconds - 0.1; rider.step(STEP, early || late ? STOMP : AIR); if (rider.landed?.time > 0.3) landed = rider.landed; } return landed; })();
check(twice.stompAge > airSeconds - 0.2, 'should count only the first stomp press of an air time');
const heldStomp = popped(0.5);
run(heldStomp, AIR, 0.3);
flyOut(heldStomp, { ...AIR, pop: true }); // the control is pressed in the air and held through the landing
run(heldStomp, { ...AIR, pop: true }, 0.3);
check(heldStomp.grounded && heldStomp.popCharge === 0, 'should not charge a pop from a stomp that is still held after the landing');
heldStomp.step(STEP, AIR);
run(heldStomp, POP, 0.2);
check(heldStomp.popCharge > 0, 'should charge a pop again once the control was let go');

// --- trees, rocks and the edge of the course ---
const tree = { kind: 'tree', x: 0, y: 0, z: -40, radius: 0.3, height: 8 };
tree.y = makeCourse(20).heightfield.heightAt(0, -40);
const forest = makeCourse(20, { obstacles: [tree] });
const crasher = makeRider(forest);
let closest = Infinity;
let hardest = 0;
let speedBefore = 0;
run(crasher, REST, 6, (rider) => {
  closest = Math.min(closest, Math.hypot(rider.pos.x - tree.x, rider.pos.z - tree.z));
  if (rider.bonk > hardest) hardest = rider.bonk;
  if (hardest === 0) speedBefore = rider.speed;
});
check(closest >= tree.radius + config.bodyRadius - 1e-6, 'should never be inside a tree');
check(hardest > 5 && hardest <= speedBefore + 1, `should report how hard it hit the tree (${hardest.toFixed(1)} m/s)`);
const rock = { kind: 'rock', x: 0, y: cliff.heightfield.heightAt(0, -63), z: -63, radius: 1, height: 1.1 };
const overRock = makeRider({ ...cliff, obstacles: [rock] });
let rockHit = 0;
run(overRock, REST, 9, (rider) => { rockHit = Math.max(rockHit, rider.bonk); });
check(rockHit === 0 && overRock.pos.z < -70, `should pass over a rock when it flies above it (hit ${rockHit.toFixed(1)}, z ${overRock.pos.z.toFixed(0)})`);
const edge = makeRider(slope);
edge.heading = -Math.PI / 2;
edge.pos.x = slope.heightfield.maxX - 5;
run(edge, { steer: 0, tuck: 1, brake: 0 }, 6);
check(edge.pos.x <= slope.heightfield.maxX - config.edgeMargin + 1e-9, 'should stop at the edge of the course');

// --- reset ---
jumper.reset({ x: 10, z: -20 }, 0.5);
jumper.mountainEdge = RIGHT_EDGE;
jumper.reset({ x: 10, z: -20 }, 0.5);
check(jumper.mountainEdge === CONFIG.ski.rides.skis.startEdge && jumper.pos.x === 10 && jumper.speed === 0 && jumper.heading === 0.5 && jumper.grounded && jumper.edge === 0 && jumper.prevPos.equals(jumper.pos), 'should stand still at the new place when it is reset');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
