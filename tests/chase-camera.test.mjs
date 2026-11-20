/*
 * The mountain mode's chase camera: behind and above the rider, orbited by the look input, never under the snow.
 */
import { load, loadConfig, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { ChaseCamera } = await load('chase-camera');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

const CONFIG = await loadConfig();
const config = CONFIG.ski.camera;
const SENSITIVITY = 0.002;
const REST_FOV = 75;
const STEP = 1 / 60;
const make = (groundHeight = () => 0) => {
  const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 500);
  return { camera, chase: new ChaseCamera({ camera, config, groundHeight, sensitivity: () => SENSITIVITY, fov: () => REST_FOV }) };
};
const rider = (speed = 0) => ({ x: 0, y: 0, z: 0, heading: 0, speed }); // heading 0 faces -Z
const orbitPoint = new THREE.Vector3(0, config.lookHeight, 0);
const run = (chase, subject, seconds) => { for (let t = 0; t < seconds; t += STEP) chase.update(STEP, subject); };

// --- at rest behind the rider ---
const { camera, chase } = make();
chase.update(STEP, rider());
check(near(camera.position.x, 0) && camera.position.z > 0, 'should sit straight behind the rider when the view was not moved');
check(camera.position.y > config.lookHeight, 'should sit above the point that it orbits');
check(near(camera.position.distanceTo(orbitPoint), config.distance), 'should be at the configured distance when the ground is level');
const forward = camera.getWorldDirection(new THREE.Vector3());
check(forward.z < 0 && forward.y < 0, 'should look down the slope past the rider');

// --- zoom ---
const zoomed = make();
zoomed.chase.update(STEP, rider(), 2);
check(near(zoomed.camera.position.distanceTo(orbitPoint), config.distance * 2), 'should be twice as far away when the zoom is 2');

// --- orbit ---
chase.look(300, 0);
chase.update(STEP, rider());
run(chase, rider(), 2);
check(camera.position.x < -1, 'should swing to the left side when the player looks right');
check(camera.getWorldDirection(new THREE.Vector3()).x > 0, 'should then look toward the right');
const beforeUp = camera.position.y;
chase.look(0, -100);
run(chase, rider(), 2);
check(camera.position.y < beforeUp, 'should come down when the player looks up');
chase.look(0, -100000);
check(near(chase.pitch, config.minPitch), 'should stop at the lowest pitch');
chase.look(0, 100000);
check(near(chase.pitch, config.maxPitch), 'should stop at the highest pitch');

// --- the swing back behind the rider ---
const still = make();
still.chase.look(400, 0);
run(still.chase, rider(0), 10);
check(near(still.chase.yawOffset, -400 * SENSITIVITY), 'should keep the view where the player put it when the rider stands still');
const moving = make();
moving.chase.look(400, 0);
run(moving.chase, rider(config.returnFullSpeed), config.returnDelay * 0.9);
check(near(moving.chase.yawOffset, -400 * SENSITIVITY), 'should wait for the return delay when the rider moves');
run(moving.chase, rider(config.returnFullSpeed), 6);
check(Math.abs(moving.chase.yawOffset) < 0.01 && Math.abs(moving.chase.pitch - config.pitch) < 0.01, 'should swing back behind the rider when the rider moves and the view is left alone');

// --- the snow ---
const hill = make((x, z) => (z > 2 ? 30 : 0)); // a wall of snow behind the rider
hill.chase.update(STEP, rider());
check(hill.camera.position.y >= 30 + config.clearance, 'should rise above the snow when the ground behind the rider is high');
const bump = make((x, z) => (z > 2 && z < 4 ? 5 : 0)); // a bump between the rider and the camera
bump.chase.update(STEP, rider());
const level = make();
level.chase.update(STEP, rider());
check(bump.camera.position.y > level.camera.position.y, 'should rise when ground between the camera and the rider would hide the rider');

// --- the view widens with speed ---
const slow = make();
slow.chase.update(STEP, rider(0));
check(slow.camera.fov === REST_FOV, 'should use the view angle from the settings when the rider is at rest');
const quick = make();
quick.chase.update(STEP, rider(0));
run(quick.chase, rider(config.speedFovFull), 5);
check(near(quick.camera.fov, REST_FOV + config.speedFov, 0.01), 'should widen the view by the configured angle at full speed');
run(quick.chase, rider(config.speedFovFull * 3), 5);
check(quick.camera.fov <= REST_FOV + config.speedFov + 1e-6, 'should not widen the view further above that speed');

// --- placement ---
const far = make();
far.chase.update(STEP, rider());
const jumped = { ...rider(), x: 500, z: -500 };
far.chase.update(STEP, jumped);
check(far.camera.position.x < 400, 'should glide toward a rider that moved, not jump');
far.chase.reset();
far.chase.update(STEP, jumped);
check(near(far.camera.position.x, 500) && far.chase.yawOffset === 0, 'should place the camera behind the rider at once when it is reset');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
