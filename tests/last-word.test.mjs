/*
 * The Ole Reliable revolver: six rounds, full auto with a delay after every pull, and a bigger hit volume on the hip.
 */
import { load, loadConfig, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { createEffects } = await load('effects');
const { World } = await load('world');
const { Player } = await load('player');
const { Enemies } = await load('enemies');
const { Weapons } = await load('weapons');

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
const audio = new Proxy({}, { get: () => noop });
const enemies = new Enemies({ cfg: CONFIG, scene, world, fx, player });
const weapons = new Weapons({ cfg: CONFIG, camera, mainScene: scene, world, enemies, player, fx, hud, audio });

const input = { forward: 0, back: 0, left: 0, right: 0, sprintHeld: 0, fireHeld: 0, jumpPressed: 0, slidePressed: 0, sprintPressed: 0, firePressed: 0, reloadPressed: 0, meleePressed: 0, ammoPressed: 0, selectSlot: -1, wheel: 0, aimHeld: 0, crouchHeld: 0, leanLeft: 0, leanRight: 0 };
const dt = 1 / 60;
const TWIRL_MID = 0.35;
const step = (n = 1) => {
  for (let i = 0; i < n; i++) {
    player.update(dt, input);
    weapons.update(dt, input);
    input.firePressed = 0; input.selectSlot = -1;
    player.pitch = 0; player.kickPitch = 0; player.kickYaw = 0;
  }
};

const index = CONFIG.weapons.list.findIndex((item) => item.id === 'revolver');
const gun = weapons.slots[index];
weapons.reset();
weapons.select(index);
step(40);
player.reset();
player.invulnerable = true;
step(1);

check(gun.cfg.mag === 6 && gun.mag === 6, 'it holds six rounds');
check(gun.cfg.auto === true && gun.cfg.fireDelay > 0, 'it is full auto, with a delay on every shot');

input.fireHeld = 1;
step(1);
check(gun.mag === 6, 'the shot does not leave on the pull: it waits for the delay');
step(Math.ceil(gun.cfg.fireDelay / dt) + 2);
check(gun.mag === 5, 'the shot leaves after the delay');
const cycleSteps = Math.ceil((gun.cfg.fireDelay + gun.cfg.interval) / dt) + 3;
step(cycleSteps * 2);
check(gun.mag <= 3, 'holding the trigger keeps firing (full auto)');
input.fireHeld = 0;

const shotsInASecond = (aiming) => {
  weapons.adsBlend = aiming; // the view update that smooths this does not run in a test: set it
  gun.mag = 100; gun.reserve = 30; gun.reloading = false; gun.delayTimer = 0; weapons.cooldown = 0;
  input.fireHeld = 1;
  step(60);
  input.fireHeld = 0;
  return 100 - gun.mag;
};
const hipShots = shotsInASecond(0);
const sightShots = shotsInASecond(1);
check(hipShots > sightShots * 1.4, `the hip fires faster than the sights (${hipShots} against ${sightShots} shots in a second)`);
weapons.adsBlend = 0;

const onSights = gun.cfg.pelletRadius;
weapons.adsBlend = 0;
check(Math.abs(gun._hitRadius(weapons, gun.cfg) - gun.cfg.hipPelletRadius) < 1e-9, 'on the hip the hit volume is the big one');
weapons.adsBlend = 1;
check(Math.abs(gun._hitRadius(weapons, gun.cfg) - onSights) < 1e-9, 'on the sights it is the small one');
check(gun.cfg.hipPelletRadius > 3 * onSights, 'the hip volume is much bigger than the sights volume');

// --- the model: reload and draw animations ---
const { HOLDABLE_MODELS } = await load('weapons');
const { SHOT_DELAY, SHOT_INTERVAL } = await load('last-word');
check(SHOT_DELAY > 0 && SHOT_DELAY < 0.1 && gun.cfg.fireDelay === SHOT_DELAY && gun.cfg.interval === SHOT_INTERVAL, 'the shot delay is a tuned number in the weapon file, and it is short');
const model = HOLDABLE_MODELS.revolver.build();
const state = (over) => ({ rounds: 2, capacity: 6, ammo: 1 / 3, pulse: 0, aiming: 0, reloading: false, reloadProgress: 0, equipAge: Infinity, swing: false, ...over });
const parts = [];
model.root.traverse((object) => parts.push(object));
const shellMeshes = parts.filter((object) => object.name === 'shell');
const crane = model.root.getObjectByName('crane');
check(shellMeshes.length === 6 && crane, 'the model has a crane for the cylinder and six shells');
let time = 0;
const animate = (over) => { time += dt; model.animate(dt, time, state(over)); };
animate({});
check(crane.rotation.z === 0 && shellMeshes.every((mesh) => !mesh.visible), 'idle: the cylinder is closed and no shells show');
animate({ reloading: true, reloadProgress: 0.5 });
check(crane.rotation.z > 1, 'mid reload: the cylinder is swung out');
const shown = [];
model.root.traverse((object) => { if (shellMeshes.includes(object)) shown.push(object.visible); });
check(shown.some(Boolean), 'and shells are on show while they drop or go back in');
animate({ reloading: true, reloadProgress: 0.3 });
check(shellMeshes.some((mesh) => mesh.visible), 'the spent shells slide out early in the reload');
animate({ reloading: true, reloadProgress: 0.99 });
check(Math.abs(crane.rotation.z) < 0.05 && shellMeshes.every((mesh) => !mesh.visible), 'end of reload: shut again, nothing left showing');
const twirl = model.root.getObjectByName('twirl');
animate({ equipAge: TWIRL_MID });
check(Math.abs(twirl.rotation.x) > 0.5 && Math.abs(twirl.rotation.x) < 6, 'drawing: the gun is turning round the grip');
animate({ equipAge: 10 });
check(Math.abs(Math.sin(twirl.rotation.x)) < 1e-6 && Math.abs(Math.cos(twirl.rotation.x) - 1) < 1e-6, 'after the twirl the gun sits upright again');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
