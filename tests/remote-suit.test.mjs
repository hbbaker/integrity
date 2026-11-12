/*
 * Mech suits in multiplayer: the suit fields of the state message, the local suit's network state,
 * and another player's avatar (the Y Bot, then the suit) following their state messages.
 */
import { readFile } from 'node:fs/promises';
import { load, loadConfig, installDomStubs, ROOT } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { World } = await load('world');
const { Player } = await load('player');
const { Weapons } = await load('weapons');
const { Enemies } = await load('enemies');
const { Cyborg } = await load('cyborg');
const { createEffects } = await load('effects');
const { RemotePlayers } = await load('remote-players');
const { MechSuit } = await load('mech-suit-entity');
const { SuitState } = await load('suit-state');
const { SUIT_PARTS, SUIT_SLOTS, defaultSelection } = await load('suit-parts');
const { SUIT_MODE, encodeSuit, decodeSuit, encodeSelection, decodeSelection } = await load('suit-network');
const { poseMessage } = await load('pose-message');
const { totalTime } = await load('enter-poses');
const { parseYBot } = await load('y-bot');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const noop = () => {};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const file = await readFile(`${ROOT}/game/assets/y-bot.fbx`);
const template = parseYBot(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const skinLoader = async () => template;

// ---- the message ----
const picked = { ...defaultSelection(), head: SUIT_PARTS.head[2].id, chest: SUIT_PARTS.chest[3].id, boots: SUIT_PARTS.boots[1].id };
const code = encodeSelection(picked);
check(code.length === SUIT_SLOTS.length && /^\d+$/.test(code), `the parts travel as a digit per slot (${code})`);
check(SUIT_SLOTS.every((slot) => decodeSelection(code)[slot] === picked[slot]), 'and come back as the same parts');
check(decodeSelection('9999').head === SUIT_PARTS.head[0].id && decodeSelection(undefined).legs === SUIT_PARTS.legs[0].id && decodeSelection('1')[SUIT_SLOTS[1]] === SUIT_PARTS[SUIT_SLOTS[1]][0].id, 'a bad or short code falls back to the first part of a slot');

const suit = { mode: SUIT_MODE.STANDING, x: 12.3456, z: -7.891, yaw: 2.5, selection: picked };
const wire = JSON.parse(JSON.stringify(encodeSuit(suit)));
const back = decodeSuit(wire);
check(back && back.mode === 1 && Math.abs(back.x - 12.35) < 0.006 && Math.abs(back.z + 7.89) < 0.006 && back.yaw === 2.5, 'the suit survives the trip as JSON, rounded to centimetres');
check(Object.keys(encodeSuit(null)).length === 0 && Object.keys(encodeSuit({ ...suit, mode: 0 })).length === 0, 'with no suit in play nothing is added to the message');
check(decodeSuit({}) === null && decodeSuit({ su: 9, sx: 1, sz: 1, sw: 0 }) === null && decodeSuit({ su: 1, sx: 'x', sz: 1, sw: 0 }) === null && decodeSuit({ su: 1, sx: Infinity, sz: 1, sw: 0 }) === null, 'a missing, odd or non-finite suit is read as no suit');

const CONFIG = await loadConfig();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 200);
const fx = createEffects(scene);
const world = new World(scene, CONFIG);
const player = new Player(camera, world, CONFIG.player);
const hud = new Proxy({ setSuitMode: noop, setPrompt: noop }, { get: (target, key) => target[key] ?? noop });
const audio = new Proxy({}, { get: () => noop });
const enemies = new Enemies({ cfg: CONFIG, scene, world, fx, player });
const weapons = new Weapons({ cfg: CONFIG, camera, mainScene: scene, world, enemies, player, fx, hud, audio });
const memory = new Map();
const suitState = new SuitState({ getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) });

check(poseMessage(player, weapons).su === undefined, 'a state message without a suit is as small as it was');
const withSuit = JSON.parse(JSON.stringify(poseMessage(player, weapons, suit)));
check(withSuit.su === 1 && withSuit.t === 's' && withSuit.x !== undefined && decodeSuit(withSuit).selection.head === picked.head, 'with a suit in play it rides in the state message');

// ---- the local suit reports what it is doing ----
const cyborg = new Cyborg({ scene, player, weapons, rigged: true, skinLoader });
const mechSuit = new MechSuit({ scene, world, player, cyborg, hud, suitState, config: CONFIG.suit, playerConfig: CONFIG.player, skinLoader });
player.spawnX = 4;
player.spawnZ = 25;
player.reset();
const total = totalTime(CONFIG.suit.enterTimes);
const run = (seconds) => { for (let i = 0; i < Math.ceil(seconds / (1 / 60)); i++) mechSuit.update(1 / 60); };
const sky = CONFIG.suit.sky;
check(mechSuit.networkState() === null, 'with no suit in play the local suit reports nothing');
suitState.setOwned(true);
check(mechSuit.networkState() === null, 'an owned suit that is still in the pack reports nothing');
mechSuit.callDown(4, 18, 0);
const dropping = mechSuit.networkState();
check(dropping.mode === SUIT_MODE.DROPPING && dropping.selection.head === suitState.selection.head, 'a suit falling out of the sky reports dropping, where it lands, and its parts');
run(sky.dropTime + 0.1);
const standing = mechSuit.networkState();
check(standing.mode === SUIT_MODE.STANDING && Math.hypot(standing.x - mechSuit.position.x, standing.z - mechSuit.position.z) < 1e-9, 'once down it reports standing, and where');
player.pos.copy(mechSuit.position).add(new THREE.Vector3(0, 0, 3));
mechSuit.interact();
check(mechSuit.networkState().mode === SUIT_MODE.ENTERING, 'stepping in reports entering');
run(total + 0.5);
check(mechSuit.networkState().mode === SUIT_MODE.PILOTED, 'then worn');
mechSuit.interact();
check(mechSuit.networkState().mode === SUIT_MODE.EXITING, 'stepping out reports exiting');
run(total + 0.5);
check(mechSuit.networkState().mode === SUIT_MODE.STANDING, 'and then standing again');
mechSuit.sendUp();
check(mechSuit.networkState().mode === SUIT_MODE.LIFTING, 'a suit going back up reports lifting');
run(sky.liftTime + 0.1);
check(mechSuit.networkState() === null, 'and then nothing at all');

// ---- another player ----
const remotes = new RemotePlayers({ scene, fx, world, weapons, audio, config: CONFIG.multiplayer, suitConfig: CONFIG.suit, skinLoader });
remotes.sync([{ id: 1, name: 'ME' }, { id: 2, name: 'OTHER' }], 1);
const other = remotes.byId.get(2);
check(remotes.list.length === 1 && other.cyborg.skin !== null, 'another player is a rigged avatar');
await settle();
check(other.cyborg.skin.ready, 'it is drawn with the Y Bot');

let clock = 100;
const base = { t: 's', x: 20, y: 0, z: 20, yw: 0, pt: 0, vx: 0, vz: 0, g: 1, sl: 0, sp: 0, cr: 0, ln: 0, w: 1, a: 0, f: 0, r: 0, al: 1, hp: 100 };
const frames = (seconds) => {
  for (let i = 0; i < Math.ceil(seconds / (1 / 60)); i++) {
    clock += 1 / 60;
    remotes.receive(2, { ...base, ...currentExtra }, clock);
    remotes.update(1 / 60, clock, clock);
  }
};
let currentExtra = {};
const set = (extra) => { currentExtra = extra; };
const solids = world.solids.length;
const head = (height) => ({ origin: new THREE.Vector3(20, height, 24), dir: new THREE.Vector3(0, 0, -1) });

set({});
frames(0.5);
check(other.scale === 1 && !other.suit.stage.group.visible && other.cyborg.group.visible, 'a player with no suit is a human and no suit is shown');
const humanHigh = head(2.7);
check(remotes.raycast(humanHigh.origin, humanHigh.dir, 20) === null, 'a shot at 2.7 m passes over a human');

set(encodeSuit({ mode: SUIT_MODE.DROPPING, x: 24, z: 20, yaw: 1.2, selection: picked }));
frames(0.1);
check(other.suit.stage.group.visible && other.suit.stage.group.position.y > sky.height * 0.8 && other.suit.stage.beam.visible, 'when they call a suit down, it falls out of the sky at their end too, in a pillar of light');
check(world.solids.length === solids, 'and is not solid until it lands');
frames(sky.dropTime / 2);
check(other.suit.stage.group.position.y < sky.height * 0.8 && other.suit.stage.group.position.y > 0, 'it falls');
set(encodeSuit({ mode: SUIT_MODE.STANDING, x: 24, z: 20, yaw: 1.2, selection: picked }));
frames(sky.dropTime / 2 + 0.05);
check(other.suit.stage.group.visible && Math.abs(other.suit.stage.group.position.y) < 1e-6 && world.solids.length === solids + 1, 'then it stands, solid');
check(other.suit.stage.ring.visible || other.suit.sky !== null, 'and the glow of the landing carries on after their message says standing');
frames(sky.beamLinger + 0.3);
check(!other.suit.stage.beam.visible && !other.suit.stage.ring.visible, 'until it has died away');
set(encodeSuit({ mode: SUIT_MODE.LIFTING, x: 24, z: 20, yaw: 1.2, selection: picked }));
frames(sky.liftTime / 2);
check(other.suit.stage.group.position.y > 1 && other.suit.stage.beam.visible && world.solids.length === solids, 'when they recall it, it rises in a pillar of light and stops being solid');
set({});
frames(0.2);
check(!other.suit.stage.group.visible && !other.suit.stage.beam.visible, 'and is gone');

set(encodeSuit({ mode: SUIT_MODE.STANDING, x: 24, z: 20, yaw: 1.2, selection: picked }));
frames(0.3);
check(other.suit.stage.group.visible && Math.hypot(other.suit.stage.position.x - 24, other.suit.stage.position.z - 20) < 1e-6 && Math.abs(other.suit.stage.yaw - 1.2) < 1e-6, 'their standing suit appears where they put it');
check(world.solids.length === solids + 1, 'and it is a solid you cannot walk through');
check(other.cyborg.group.visible && !other.suit.stage.walker.root.visible, 'the player is still a human beside it');
check(SUIT_SLOTS.every((slot) => other.suit.selection[slot] === picked[slot]), 'it shows the parts they chose');
set(encodeSuit({ mode: SUIT_MODE.STANDING, x: 24, z: 20, yaw: 1.2, selection: { ...picked, head: SUIT_PARTS.head[1].id } }));
frames(0.2);
check(other.suit.selection.head === SUIT_PARTS.head[1].id && other.suit.stage.body.headMount.children.length === 1, 'changing a part changes it on their suit');

set(encodeSuit({ mode: SUIT_MODE.ENTERING, x: 24, z: 20, yaw: 1.2, selection: picked }));
frames(0.05);
check(other.cyborg.suppressed && other.suit.stage.walker.root.visible && world.solids.length === solids, 'when they step in, their body gives way to a walking human and the suit stops being solid');
const standHead = head(1.5);
check(remotes.raycast(standHead.origin, standHead.dir, 20) === null, 'a player stepping into a suit cannot be shot: they are untouchable');
const startOfWalk = other.suit.stage.walker.root.position.clone();
frames(CONFIG.suit.enterTimes.open + CONFIG.suit.enterTimes.step / 2);
check(Math.abs(other.suit.stage.body.hatch.hinge.rotation.y) > 1.5, 'the back hatch is open as the human walks in');
const middleOfWalk = other.suit.stage.walker.root.position;
check(middleOfWalk.distanceTo(startOfWalk) > 0.5 && middleOfWalk.distanceTo(other.suit.stage.position) > 0.1, 'the human is part way to the suit');
check(Math.hypot(startOfWalk.x - 20, startOfWalk.z - 20) < 0.6, 'having started from where the player was standing');
frames(total);
check(other.suit.time === total && other.suit.busy, 'the step-in waits at its end until they say they are in');

set(encodeSuit({ mode: SUIT_MODE.PILOTED, x: 24, z: 20, yaw: 1.2, selection: picked }));
frames(0.3);
check(!other.cyborg.suppressed && !other.suit.stage.group.visible && !other.suit.stage.walker.root.visible, 'once they are in, the stage clears');
check(Math.abs(other.cyborg.group.scale.x - CONFIG.suit.scale) < 1e-9 && other.scale === CONFIG.suit.scale, 'their avatar is the suit, a lot bigger than a human');
check(other.cyborg.skin.wrapper.visible === false && other.cyborg.body.hatch !== null, 'and wears the parts they chose instead of the Y Bot');
check(other.cyborg.body.pelvisMount.visible === true, 'with its own hips');
const suitedHigh = head(2.7);
check(remotes.raycast(suitedHigh.origin, suitedHigh.dir, 20) !== null, 'a shot at 2.7 m now hits them: their hit volumes grew with the suit');
const midBody = remotes.meleeTarget(new THREE.Vector3(20, 2.4, 24), new THREE.Vector3(0, 0, -1), 4.5, 0.8);
check(midBody === other, 'and a melee swing at their middle finds them');
set(encodeSuit({ mode: SUIT_MODE.PILOTED, x: 24, z: 20, yaw: 1.2, selection: { ...picked, arms: SUIT_PARTS.arms[3].id } }));
frames(0.2);
check(other.cyborg.armL.sleeve.children.length === 1 && other.suit.selection.arms === SUIT_PARTS.arms[3].id, 'a part changed while they wear it is changed on the avatar');

set(encodeSuit({ mode: SUIT_MODE.EXITING, x: 24, z: 20, yaw: 1.2, selection: picked }));
frames(0.05);
check(other.scale === 1 && Math.abs(other.cyborg.group.scale.x - 1) < 1e-9 && other.cyborg.suppressed && other.suit.stage.walker.root.visible, 'stepping out, they are a human again, walking out of the suit');
const exitHead = head(1.5);
check(remotes.raycast(exitHead.origin, exitHead.dir, 20) === null, 'and untouchable on the way out too');
frames(total * 0.6);
const outOfSuit = other.suit.stage.walker.root.position;
const behind = (outOfSuit.x - 24) * Math.sin(1.2) + (outOfSuit.z - 20) * Math.cos(1.2);
check(behind > 0.5, 'out of its back');
set(encodeSuit({ mode: SUIT_MODE.STANDING, x: 24, z: 20, yaw: 1.2, selection: picked }));
frames(0.2);
check(!other.cyborg.suppressed && other.cyborg.group.visible && world.solids.length === solids + 1, 'and the empty suit stands solid again');

set({});
frames(0.3);
check(!other.suit.stage.group.visible && world.solids.length === solids, 'when their message carries no suit, it is gone and leaves nothing solid behind');

set(encodeSuit({ mode: SUIT_MODE.STANDING, x: 30, z: 30, yaw: 0, selection: picked }));
frames(0.2);
const before = world.solids.length;
remotes.sync([{ id: 1, name: 'ME' }], 1);
check(remotes.list.length === 0 && world.solids.length === before - 1, 'a player who leaves takes their suit with them');

set({});
remotes.sync([{ id: 1, name: 'ME' }, { id: 3, name: 'THIRD' }], 1);
remotes.receive(3, { ...base, su: 3, sx: 5, sz: 5, sw: 0, sc: '0000' }, clock + 1);
remotes.update(1 / 60, clock + 1, clock + 2);
check(remotes.byId.get(3).scale === CONFIG.suit.scale, 'a player who joins while someone is in a suit sees it at once');

// the game's own setup: suit settings and no custom model loader (a join once crashed here)
const real = new RemotePlayers({ scene, fx, world, weapons, audio, config: CONFIG.multiplayer, suitConfig: CONFIG.suit });
let joined = true;
try { real.sync([{ id: 1, name: 'ME' }, { id: 9, name: 'NINE' }], 1); } catch (error) { joined = false; console.log(error.message); }
check(joined && real.list.length === 1 && real.byId.get(9).suit !== null && real.byId.get(9).cyborg.skin !== null, 'a player joining with the game\'s own settings and the real model loader works');
real.receive(9, { ...base, su: 1, sx: 3, sz: 3, sw: 0, sc: '0000' }, 1);
check(real.byId.get(9).suit.stage.group.visible, 'and their suit shows');
real.clear();

// without suit settings, nothing about suits is shown
const plain = new RemotePlayers({ scene, fx, world, weapons, audio, config: CONFIG.multiplayer });
plain.sync([{ id: 7, name: 'X' }], 1);
plain.receive(7, { ...base, su: 3, sx: 1, sz: 1, sw: 0, sc: '0000' }, 1);
check(plain.byId.get(7).suit === null && plain.byId.get(7).scale === 1, 'without suit settings the suit fields are ignored');

process.exit(fails ? 1 : 0);
