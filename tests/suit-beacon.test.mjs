/*
 * The suit beacon item: hidden from the inventory, thrown with the fire button, and held by the character.
 */
import { readFile } from 'node:fs/promises';
import { load, loadConfig, installDomStubs, ROOT } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { World } = await load('world');
const { Player } = await load('player');
const { Weapons, buildHeldModel, WEAPONS } = await load('weapons');
const { Enemies } = await load('enemies');
const { Cyborg } = await load('cyborg');
const { createEffects } = await load('effects');
const { BeaconTool, weapon } = await load('suit-beacon');
const { parseYBot, preloadYBot } = await load('y-bot');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const noop = () => {};

const file = await readFile(`${ROOT}/game/assets/y-bot.fbx`);
const template = parseYBot(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
preloadYBot(template);

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

const index = CONFIG.weapons.list.findIndex((item) => item.id === 'beacon');
check(index === CONFIG.weapons.list.length - 1 && WEAPONS.at(-1).config.id === 'beacon', 'the beacon is last in the list, so no other item moved');
check(weapons.slots[index] instanceof BeaconTool && weapons.slots[index].hidden, 'it is a hidden tool');
check(!weapons.armory().some((entry) => entry.id === 'beacon'), 'it is not in the inventory');
check(!weapons.loadout.includes(index) && weapons.handsIndex !== index, 'and in no slot');
check(weapon.config.type === 'beacon' && weapon.model.build && buildHeldModel('beacon') !== null, 'it has a model for your hand and for the character to hold');

// ---- throwing ----
let throws = 0;
weapons.onBeaconThrow = () => { throws++; };
const idle = { forward: 0, back: 0, left: 0, right: 0, sprintHeld: 0, fireHeld: 0, jumpPressed: 0, slidePressed: 0, sprintPressed: 0, firePressed: 0, reloadPressed: 0, meleePressed: 0, ammoPressed: 0, selectSlot: -1, wheel: 0, aimHeld: 0, crouchHeld: 0, leanLeft: 0, leanRight: 0 };
const step = (input = idle, n = 1) => { for (let i = 0; i < n; i++) { player.update(1 / 60, input); weapons.update(1 / 60, input); } };
weapons.reset();
weapons.select(index);
step(idle, 40);
check(weapons.index === index, 'it can be put in the hand');
step({ ...idle, firePressed: 1 });
check(throws === 1, 'the fire button throws it');
check(weapons.swingT >= 0 || weapons.cooldown > 0, 'with a throwing motion');
step({ ...idle, firePressed: 1 });
check(throws === 1, 'a second press straight away does nothing');
step(idle, 60);
step({ ...idle, firePressed: 1 });
check(throws === 2, 'it can be thrown again after a moment');
weapons.select(1);
step(idle, 40);
step({ ...idle, firePressed: 1 });
check(throws === 2, 'once it is put away the fire button fires the other item');

// ---- the character holds it ----
const cyborg = new Cyborg({ scene, player, weapons, rigged: true, skinLoader: async () => template });
await new Promise((resolve) => setTimeout(resolve, 0));
player.thirdPerson = true;
player.tpBlend = 1;
weapons.reset();
weapons.select(index);
step(idle, 40);
cyborg.update(1 / 60, 1, 0);
const gun = cyborg.guns[index];
check(gun && gun.holder.visible && cyborg.skin.ready, 'the character holds the beacon');
const socket = cyborg.socket.getWorldPosition(new THREE.Vector3());
const hand = cyborg.skin.wristWorld('Right', new THREE.Vector3());
check(socket.distanceTo(hand) < 0.01, 'in the right hand');
check(cyborg.skin.grip < 1 && cyborg.skin.grip > 0, 'with the fingers closed round it');

process.exit(fails ? 1 : 0);
