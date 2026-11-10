/*
 * In the air: a sprint cannot be started, and crouching slams the player straight down with no sideways speed.
 */
import { load, loadConfig, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { World } = await load('world');
const { Player } = await load('player');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };

const CONFIG = await loadConfig();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 200);
const world = new World(scene, CONFIG);
const player = new Player(camera, world, CONFIG.player);
let slams = 0;
player.onSlam = () => { slams += 1; };

const input = { forward: 0, back: 0, left: 0, right: 0, sprintHeld: 0, jumpPressed: 0, slidePressed: 0, sprintPressed: 0, crouchHeld: 0, analogActive: false };
const dt = 1 / 60;
const run = (steps, each) => { for (let i = 0; i < steps; i++) { player.update(dt, input); input.jumpPressed = 0; input.slidePressed = 0; input.sprintPressed = 0; each?.(); } };
const start = () => {
  player.reset(); player.pos.set(-20, 0, 10); player.prevPos.copy(player.pos); player.yaw = 0; slams = 0;
  Object.assign(input, { forward: 0, back: 0, left: 0, right: 0, sprintHeld: 0, jumpPressed: 0, slidePressed: 0, sprintPressed: 0, crouchHeld: 0 });
};
const jump = () => { input.jumpPressed = 1; run(1); };
const speed = () => Math.hypot(player.vel.x, player.vel.z);

// --- no sprint start in the air ---
start(); input.forward = 1; run(20); jump(); run(5);
check(!player.grounded && !player.sprinting, 'walking and jumping: not sprinting');
input.sprintHeld = 1; input.sprintPressed = 1; run(3);
check(!player.grounded && !player.sprinting, 'pressing sprint in the air does not start a sprint');
const airSpeed = speed();
run(5);
check(speed() <= airSpeed + 1e-6 && speed() < CONFIG.player.sprintSpeed - 1, 'and the player does not speed up to sprint speed');
run(120);
check(player.grounded && player.sprinting, 'after landing, the held sprint starts');

start(); input.forward = 1; input.sprintHeld = 1; run(30);
check(player.sprinting, 'a sprint on the ground works');
jump(); run(5);
check(!player.grounded && player.sprinting && speed() > CONFIG.player.sprintSpeed - 1, 'a sprint you jumped with carries on in the air');
input.sprintHeld = 0; run(2); input.sprintHeld = 1; input.sprintPressed = 1; run(2);
check(!player.grounded && !player.sprinting, 'but once it is let go in the air, it cannot be restarted');
run(120);
check(player.grounded && player.sprinting, 'it starts again on the ground');

// --- the slam ---
start(); input.forward = 1; input.sprintHeld = 1; run(30); jump(); run(16);
const before = speed();
input.crouchHeld = 1; input.slidePressed = 1; run(1);
check(slams === 1 && before > 8, 'crouching in the air is a slam (while running fast)');
check(speed() < before * 0.95 && speed() > 0.5 && player.vel.y > -3, `momentum is dampened, not cut at once (${before.toFixed(1)} -> ${speed().toFixed(1)} m/s), and the fall starts gently (${player.vel.y.toFixed(1)} m/s)`);
const x = player.pos.x; const z = player.pos.z;
input.forward = 1; input.left = 1;
let airborneSteps = 0; let fastest = 0; let sideways = 0;
for (let i = 0; i < 90 && !player.grounded; i++) { run(1); if (!player.grounded) { airborneSteps += 1; fastest = Math.max(fastest, -player.vel.y); } sideways = Math.max(sideways, Math.abs(player.vel.x)); }
check(airborneSteps >= 3 && fastest <= CONFIG.player.slamSpeed + 0.01, `the fall builds up but never passes slamSpeed (${fastest.toFixed(1)} m/s)`);
check(sideways < 1e-6, 'the player cannot steer while slamming (no sideways push from the held keys)');
check(player.grounded && !player.slamming, 'it ends on landing');
check(player.crouching && Math.hypot(player.pos.x - x, player.pos.z - z) < 2, `the player lands in a crouch close to where they slammed (${Math.hypot(player.pos.x - x, player.pos.z - z).toFixed(2)} m away)`);
const slideAway = Math.hypot(player.pos.x - x, player.pos.z - z);
check(slideAway < before / CONFIG.player.slamDamping + 0.5, 'and never farther than the damped momentum allows');

start(); input.crouchHeld = 1; input.slidePressed = 1; run(5);
check(slams === 0 && player.crouching, 'crouching on the ground is not a slam');
start(); input.forward = 1; input.sprintHeld = 1; run(30); input.crouchHeld = 1; input.slidePressed = 1; run(1);
check(slams === 0 && player.sliding, 'sprint then crouch on the ground still slides');

start(); input.forward = 1; run(15); jump(); run(5);
input.crouchHeld = 1; input.slidePressed = 1; run(1); const first = slams;
input.slidePressed = 1; run(1);
check(first === 1 && slams === 1, 'a second press in the same fall does not slam again');
run(80);

start(); input.forward = 1; run(15); jump(); run(5);
player.pullToward({ x: -20, y: 5, z: 0 }, { speed: 6, seconds: 2 });
input.crouchHeld = 1; input.slidePressed = 1; run(1);
check(slams === 0, 'a grapple pull is not turned into a slam');
player.cancelPull();

start(); input.forward = 1; run(15); jump(); run(5);
input.crouchHeld = 1; input.slidePressed = 1; run(1);
player.takeDamage(1e6);
check(!player.alive && !player.slamming, 'dying ends a slam');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
