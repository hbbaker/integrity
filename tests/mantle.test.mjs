/*
 * Mantling: in the air, pushing into a ledge that is too high to jump onto pulls the player up and over it.
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
const material = new THREE.MeshBasicMaterial();
let mantles = 0;
player.onMantle = () => { mantles += 1; };

// Ledges in the clear lane x = -20, each far apart along z; their near faces are at z = centre + 2.
const ledge = (z, height, depth = 4) => world.addBlock(-20, z, 4, height, depth, material);
ledge(-5, 1.9);
ledge(-12, 3.5);
ledge(-19, 0.25);
ledge(-26, 1.9, 0.3); // too thin to stand on

const input = { forward: 0, back: 0, left: 0, right: 0, sprintHeld: 0, jumpPressed: 0, slidePressed: 0, sprintPressed: 0, crouchHeld: 0, analogActive: false };
const dt = 1 / 60;
const run = (steps, each) => { for (let i = 0; i < steps; i++) { player.update(dt, input); input.jumpPressed = 0; each?.(); } };
const start = (z) => { player.reset(); player.pos.set(-20, 0, z); player.prevPos.copy(player.pos); player.yaw = 0; mantles = 0; input.forward = 0; input.jumpPressed = 0; };
/** Run up to a ledge face and jump into it. */
const jumpAt = (faceZ, pressForward = true) => {
  start(faceZ + 2.2);
  input.forward = pressForward ? 1 : 0;
  run(5);
  input.jumpPressed = 1;
  run(150);
};

check(CONFIG.player.mantleMaxHeight > 1.5, 'mantling is on in the game config');

start(-0.8); input.forward = 1; run(5); input.jumpPressed = 1;
let began = false;
for (let i = 0; i < 150; i++) { run(1); if (player.mantle) began = true; else if (began) break; } // stop the moment the climb ends
check(mantles === 1, 'jumping at a 1.9 m ledge starts exactly one mantle');
check(Math.abs(player.pos.y - 1.9) < 0.01 && player.grounded, `the player ends standing on the ledge (y ${player.pos.y.toFixed(2)})`);
check(player.pos.z < -3.2, `and over its edge (z ${player.pos.z.toFixed(2)})`);
check(player.vel.length() < 0.5 && player.mantle === null, 'the climb leaves no stray speed');

// During the climb: rising, no gravity, controls ignored.
start(-0.8); input.forward = 1; run(5); input.jumpPressed = 1;
let sawMantle = false;
let maxY = 0;
for (let i = 0; i < 150; i++) { run(1); if (player.mantle) { sawMantle = true; maxY = Math.max(maxY, player.pos.y); } }
check(sawMantle && maxY > 1.0, 'the climb takes several frames and passes through the air');
check(mantles === 1, 'only one mantle per jump');

// Timing
start(-0.8); input.forward = 1; run(5); input.jumpPressed = 1;
let frames = 0; let started = false;
for (let i = 0; i < 150; i++) { run(1); if (player.mantle) { started = true; frames += 1; } else if (started) break; }
check(Math.abs(frames * dt - CONFIG.player.mantleTime) < 0.05, `the climb lasts mantleTime (${(frames * dt).toFixed(2)} s)`);

// Not every case mantles
jumpAt(-10);
check(mantles === 0 && player.pos.y < 0.5, 'a 3.5 m wall is out of reach: no mantle');
jumpAt(-17);
check(mantles === 0, 'a 0.25 m kerb is just a step: no mantle');
check(player.pos.z < -17, 'the player walks onto the kerb');
jumpAt(-3, false);
check(mantles === 0, 'jumping at a ledge without pushing forward does not mantle');
jumpAt(-24);
check(mantles === 0, 'a ledge too thin to stand on is not grabbed');

// Not while grounded: walking into a tall wall just stops
start(1); input.forward = 1; run(120);
check(mantles === 0 && player.pos.y === 0, 'walking into a wall on the ground does not mantle');

// Turned off in config
const saved = CONFIG.player.mantleMaxHeight;
player.cfg.mantleMaxHeight = 0;
jumpAt(-3);
check(mantles === 0 && player.pos.y < 0.5, 'setting mantleMaxHeight to 0 turns mantling off');
player.cfg.mantleMaxHeight = saved;

// The grapple and mantle together: pulled players do not mantle mid-pull
start(-0.8); input.forward = 1;
player.pullToward({ x: -20, y: 2.5, z: -2 }, { speed: 8, arrive: 1, seconds: 3 });
let mantledWhilePulled = false;
for (let i = 0; i < 40; i++) { run(1); if (player.pulled && player.mantle) mantledWhilePulled = true; }
check(!mantledWhilePulled, 'a grapple pull is not interrupted by a mantle');

// Dying ends a mantle
start(-0.8); input.forward = 1; run(5); input.jumpPressed = 1;
for (let i = 0; i < 200 && !player.mantle; i++) run(1);
check(player.mantle !== null, 'a mantle is in progress');
player.takeDamage(1e6);
check(!player.alive && player.mantle === null, 'dying ends a mantle');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
