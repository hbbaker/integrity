/*
 * The fiber reel: the player's pull, bots dragged to the shooter, the shooter pulled to an anchor,
 * letting go, misses, and the cable. Players on the network are covered in multiplayer.test.mjs.
 */
import { load, loadConfig, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { createEffects } = await load('effects');
const { World } = await load('world');
const { Player } = await load('player');
const { Enemies } = await load('enemies');
const { Weapons } = await load('weapons');
const { Targets } = await load('targets');
const { REEL_TUNING, FiberReel } = await load('fiber-reel');
const { GrappleWeapon } = await load('grapple-weapon');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const noop = () => {};

const CONFIG = await loadConfig();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 200);
const fx = createEffects(scene);
const world = new World(scene, CONFIG);
const player = new Player(camera, world, CONFIG.player);
const hud = new Proxy({}, { get: () => noop });
const calls = [];
const audio = new Proxy({}, { get: (target, key) => (...args) => calls.push([key, ...args]) });
const enemies = new Enemies({ cfg: CONFIG, scene, world, fx, player });
const remoteCalls = [];
const remoteTarget = { isRemote: true, alive: true, id: 7, pos: new THREE.Vector3(-12, 0, 5) };
const fakeRemotes = {
  list: [],
  raycast: () => ({ enemy: remoteTarget, t: 14, crit: false }),
  pull: (target, options) => remoteCalls.push(['pull', target.id, options.speed, options.seconds]),
  release: (target) => remoteCalls.push(['release', target.id]),
  bodyCenter: (target, out) => out.copy(target.pos).setY(1),
};
const weapons = new Weapons({ cfg: CONFIG, camera, mainScene: scene, envMap: null, world, enemies, player, fx, hud, audio });
weapons.enemies = new Targets({ enemies, remotes: fakeRemotes });

const input = { forward: 0, back: 0, left: 0, right: 0, sprintHeld: 0, fireHeld: 0, jumpPressed: 0, slidePressed: 0, sprintPressed: 0, firePressed: 0, reloadPressed: 0, meleePressed: 0, ammoPressed: 0, selectSlot: -1, wheel: 0, aimHeld: 0, crouchHeld: 0, leanLeft: 0, leanRight: 0 };
const dt = 1 / 60;
const step = (n = 1) => {
  for (let i = 0; i < n; i++) {
    player.update(dt, input);
    weapons.update(dt, input);
    enemies.update(dt);
    input.firePressed = 0; input.jumpPressed = 0; input.selectSlot = -1;
    player.pitch = 0; player.kickPitch = 0; player.kickYaw = 0;
  }
};
const place = (x, z, yaw = 0) => { player.reset(); player.pos.set(x, 0, z); player.prevPos.copy(player.pos); player.yaw = yaw; player.pitch = 0; player.invulnerable = true; };
const fire = () => { input.firePressed = 1; step(1); };
const reelIndex = CONFIG.weapons.list.findIndex((item) => item.id === 'reel');
const reel = weapons.slots[reelIndex];
const equip = () => { weapons.reset(); weapons.select(reelIndex); step(40); };

check(reel instanceof FiberReel && reel instanceof GrappleWeapon && reel.tuning === REEL_TUNING, 'the reel is a FiberReel and reads its numbers from fiber-reel.js');
check(['range', 'aimRadius', 'selfPullSpeed', 'targetPullSpeed', 'arriveDistance', 'maxSeconds', 'cooldown'].every((key) => typeof REEL_TUNING[key] === 'number'), 'every tunable number is in the reel file');
check(weapons.armory().some((entry) => entry.id === 'reel' && entry.range === REEL_TUNING.range), 'the reel shows in the inventory with its range');

// --- the player's pull (no weapon) ---
place(-20, 0, 0);
player.pullToward({ x: -20, y: 0.9, z: -20 }, { speed: 10, arrive: 1.5, seconds: 5 });
step(30);
check(player.pulled && player.pos.z < -4 && player.pos.z > -6, `a pull carries the player toward the point at its speed (z ${player.pos.z.toFixed(2)})`);
check(!player.grounded || player.pos.y < 0.1, 'a pull along the ground keeps the player on it');
step(120);
check(!player.pulled && player.pos.z < -17.5 && player.pos.z > -19.5, `the pull stops within the arrive distance (z ${player.pos.z.toFixed(2)})`);
place(-20, 0, 0);
player.pullToward({ x: -20, y: 8, z: -6 }, { speed: 12, arrive: 1, seconds: 5 });
step(25);
check(player.pos.y > 2, `a pull toward a high point lifts the player off the ground (y ${player.pos.y.toFixed(2)})`);
player.cancelPull(); input.jumpPressed = 0;
step(180);
check(player.pos.y < 8 && player.grounded === true, 'after letting go the player falls back down');
place(-20, 0, 0);
player.pullToward({ x: -20, y: 0.9, z: -25 }, { speed: 5, seconds: 9 });
step(10);
input.jumpPressed = 1; step(1);
check(!player.pulled, 'jumping lets go of a pull');
place(-20, 0, 0);
player.pullToward({ x: -20, y: 0.9, z: -25 }, { speed: 5, seconds: 0.2 });
step(30);
check(!player.pulled, 'a pull gives up when its time runs out');
place(-20, 0, 0);
let moving = { x: -20, y: 0.9, z: -10 };
player.pullToward(() => moving, { speed: 8, arrive: 1, seconds: 9 });
step(10);
moving = null; step(1);
check(!player.pulled, 'a pull whose target goes away stops');
place(-20, 0, 0);
player.pullToward({ x: 0, y: 0.9, z: 20 }, { speed: 6, seconds: 9 });
player.pos.set(0, 0, 28.4); player.prevPos.copy(player.pos);
player.pullToward({ x: 0, y: 0.9, z: 40 }, { speed: 6, seconds: 9 }); // pushing into the arena wall
step(40);
check(!player.pulled, 'a pull that pushes into a wall gives up');
place(-20, 0, 0);
player.pullToward({ x: -20, y: 0.9, z: -20 }, { speed: 10, seconds: 5 });
player.health = 0.0001; player.invulnerable = false; player.takeDamage(10);
check(!player.alive && !player.pulled, 'dying ends a pull');

// --- bots dragged to the shooter ---
equip();
place(-12, 20, 0);
let bot = enemies._spawnAt('cable', -12, 8, 1); bot.boot = 0; bot.attackCd = 99; bot.speed = 0; bot.hp = 1e9; bot.dodgeCd = 1e9;
const gap = () => Math.hypot(bot.pos.x - player.pos.x, bot.pos.z - player.pos.z);
const gapBefore = gap();
calls.length = 0;
fire();
check(reel.hooked && reel.hook.kind === 'target' && bot.pull && calls.some(([name]) => name === 'grapple'), 'firing at a bot hooks it and plays the sound');
step(20);
check(gap() < gapBefore - 4, `the bot is dragged toward the player (${gapBefore.toFixed(1)} m -> ${gap().toFixed(1)} m)`);
for (let i = 0; i < 80 && bot.pull; i++) step(1);
step(1); // the weapon notices the pull is over on its next step
check(!bot.pull && !reel.hooked && gap() <= REEL_TUNING.arriveDistance + 0.4, `the drag stops beside the player (${gap().toFixed(2)} m)`);
check(bot.stun > 0, 'the bot is dazed when it arrives');

// --- letting go early, the cooldown ---
bot.stun = 0;
bot = enemies._spawnAt('cable', -12, 6, 1); bot.boot = 0; bot.attackCd = 99; bot.speed = 0; bot.hp = 1e9;
step(Math.round(REEL_TUNING.cooldown / dt) + 5);
REEL_TUNING.targetPullSpeed = 2; // a slow drag, so there is time to let go
fire();
check(reel.hooked, 'hooked again once the cooldown is over');
fire();
check(reel.hooked, 'firing during the cooldown does nothing');
step(Math.round(REEL_TUNING.cooldown / dt) + 5);
fire();
check(!reel.hooked && !bot.pull, 'firing again after the cooldown lets go');
REEL_TUNING.targetPullSpeed = 18;
bot.hp = 0;

// --- a bot that dies while hooked ---
enemies.clear();
bot = enemies._spawnAt('cable', -12, 8, 1); bot.boot = 0; bot.attackCd = 99; bot.speed = 0; bot.hp = 1e9;
step(Math.round(REEL_TUNING.cooldown / dt) + 5);
fire();
bot.hp = 0;
step(2);
check(!reel.hooked, 'the hook drops when the bot dies');
enemies.clear();

// --- hooking a wall: the player flies to the anchor ---
equip();
place(-20, 0, 0);
const startZ = player.pos.z;
fire();
check(reel.hooked && reel.hook.kind === 'anchor' && player.pulled, 'firing at a wall hooks the anchor and pulls the player');
check(Math.abs(reel.hook.point.z - -30) < 1.5, `the anchor is where the cable hit the wall (z ${reel.hook.point.z.toFixed(1)})`);
step(30);
check(player.pos.z < startZ - 8, `the player flies toward the anchor (z ${startZ} -> ${player.pos.z.toFixed(1)})`);
step(90);
check(!reel.hooked && !player.pulled && player.pos.z < -26, `the player stops at the wall (z ${player.pos.z.toFixed(1)})`);

// --- the floor: aim down ---
equip();
place(-20, 10, 0);
const aimDown = () => { player.pitch = -0.5; };
aimDown(); input.firePressed = 1; player.update(dt, input); weapons.update(dt, input);
check(reel.hooked && reel.hook.kind === 'anchor', 'firing at the floor hooks it too');
player.cancelPull(); reel.cease(weapons);

// --- a miss ---
equip();
place(-12, 20, 0);
player.pitch = 0.6;
input.firePressed = 1; player.update(dt, input); weapons.update(dt, input);
check(!reel.hooked && reel.missTime > 0, 'firing at the sky hooks nothing and shows the cable briefly');
weapons.updateView(dt, 1);
check(reel.cable.visible, 'the cable is drawn while it flies out');
step(Math.round(REEL_TUNING.missSeconds / dt) + 3);
weapons.updateView(dt, 1);
check(reel.missTime <= 0 && !reel.cable.visible, 'and hidden once it falls back');

// --- the cable while hooked ---
equip();
place(-20, 0, 0);
fire();
weapons.updateView(dt, 1);
check(reel.cable.visible && reel.cable.scale.z > 5, `the cable stretches to the anchor (${reel.cable.scale.z.toFixed(1)} m)`);
const radius = reel.cable.scale.x;
check(Math.abs(radius - REEL_TUNING.cableRadius) < 1e-9, 'its thickness is a tuning number');
const spoolBefore = weapons.models[reelIndex].root.children.find((child) => child.children?.length > 3)?.rotation.x ?? 0;
step(2); weapons.updateView(dt, 1);
const spoolAfter = weapons.models[reelIndex].root.children.find((child) => child.children?.length > 3)?.rotation.x ?? 0;
check(spoolAfter < spoolBefore, 'the spool spins while the cable is out');

// --- switching away lets go ---
weapons.select(1); step(2);
check(!reel.hooked && !player.pulled && !reel.cable.visible, 'switching to another item lets go of the cable');

// --- a remote player: the target system is asked, not moved here ---
equip();
place(-12, 20, 0);
fakeRemotes.list = [remoteTarget];
remoteCalls.length = 0;
fire();
check(reel.hooked && reel.hook.target === remoteTarget && remoteCalls[0]?.[0] === 'pull' && remoteCalls[0][2] === REEL_TUNING.targetPullSpeed, 'hooking a remote player asks their game to pull them at the tuned speed');
step(Math.round(REEL_TUNING.cooldown / dt) + 5);
fire();
check(remoteCalls.some(([kind]) => kind === 'release') && !reel.hooked, 'letting go tells their game to stop');
fire();
remoteTarget.alive = false; step(2);
check(!reel.hooked, 'the hook drops when the remote player dies');
fakeRemotes.list = [];

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
