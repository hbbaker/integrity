/*
 * The suit in the world: calling it down with a thrown beacon (and sending it back up), stepping in (the player becomes
 * the larger, slower, tougher suit), stepping out, being untouchable while doing so, and every way the suit can be
 * cleared away. The whole cycle runs on the open sandbox map too.
 */
import { load, loadConfig, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { World } = await load('world');
const { Player } = await load('player');
const { Weapons } = await load('weapons');
const { Enemies } = await load('enemies');
const { Cyborg } = await load('cyborg');
const { createEffects } = await load('effects');
const { MechSuit, IDLE_INPUT, BEACON } = await load('mech-suit-entity');
const { SuitState } = await load('suit-state');
const { SandboxMode } = await load('sandbox-mode');
const { enterTimeline, walkerPose, totalTime } = await load('enter-poses');
const { SUIT_PARTS } = await load('suit-parts');
const { aggregateSuitStats } = await load('suit-stats');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const noop = () => {};

const CONFIG = await loadConfig();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 200);
const fx = createEffects(scene);
const world = new World(scene, CONFIG);
const player = new Player(camera, world, CONFIG.player);
const hudLog = { suitMode: false, prompt: null, banners: [] };
const hud = new Proxy({
  setSuitMode: (on) => { hudLog.suitMode = on; }, setPrompt: (text) => { hudLog.prompt = text; }, banner: (text) => hudLog.banners.push(text),
}, { get: (target, key) => target[key] ?? noop });
const audio = new Proxy({}, { get: () => noop });
const enemies = new Enemies({ cfg: CONFIG, scene, world, fx, player });
const weapons = new Weapons({ cfg: CONFIG, camera, mainScene: scene, world, enemies, player, fx, hud, audio });
const cyborg = new Cyborg({ scene, player, weapons, rigged: true, skinLoader: async () => null }); // no model file here: the plain humanoid stands in
const memory = new Map();
const suitState = new SuitState({ getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) });
const suit = new MechSuit({ scene, world, player, cyborg, hud, suitState, config: CONFIG.suit, playerConfig: CONFIG.player, skinLoader: async () => null });

const dt = 1 / 60;
const run = (seconds) => { for (let i = 0; i < Math.ceil(seconds / dt); i++) suit.update(dt); };
const frames = (seconds) => { for (let i = 0; i < Math.ceil(seconds / dt); i++) { suit.update(dt); suit.animate(); } };
const total = totalTime(CONFIG.suit.enterTimes);
const sky = CONFIG.suit.sky;

// ---- the timeline ----
const start = enterTimeline(0, CONFIG.suit.enterTimes);
const middle = enterTimeline(CONFIG.suit.enterTimes.open + CONFIG.suit.enterTimes.step / 2, CONFIG.suit.enterTimes);
const end = enterTimeline(total, CONFIG.suit.enterTimes);
check(start.open === 0 && start.step === 0, 'at the start the suit is shut and the walk has not begun');
check(middle.open === 1 && middle.step > 0.4 && middle.step < 0.6, 'half way through the walk the suit is wide open');
check(end.open === 0 && end.step === 1, 'at the end the suit is shut and the walk is done');
check(walkerPose(0).travel === 0 && walkerPose(1).travel === 1 && Math.abs(walkerPose(0).swing) < 1e-9 && Math.abs(walkerPose(1).swing) < 1e-9, 'the human starts standing behind the suit and ends standing inside it');
check(CONFIG.suit.scale >= 1.5, 'the suit is much bigger than the human');
check(CONFIG.suit.baseline.healthMul === 3 && aggregateSuitStats({ head: SUIT_PARTS.head[0].id, arms: SUIT_PARTS.arms[0].id, chest: SUIT_PARTS.chest[0].id, legs: SUIT_PARTS.legs[0].id, boots: SUIT_PARTS.boots[0].id }).healthMul === 3, 'a suit has three times the health by default');

// ---- the beacon ----
player.spawnX = 4; // open ground: the spawn point has a crate a few metres ahead, and buildings off to the side
player.spawnZ = 25;
player.reset();
suit.update(dt);
check(suit.state === 'stowed' && !suit.arm(BEACON.DEPLOY), 'without the suit equipped no beacon can be armed');
suitState.setOwned(true);
check(suit.canPlace() && !suit.canPickUp(), 'an owned suit in the pack can be called down, not recalled');
check(!suit.arm(BEACON.RECALL) && suit.armedMode === null, 'a recall beacon needs a suit out in the world');
check(!suit.throwBeacon(), 'with nothing in hand there is nothing to throw');
check(suit.arm(BEACON.DEPLOY) && suit.armedMode === BEACON.DEPLOY, 'a deploy beacon can be armed');
suit.disarm();
check(suit.armedMode === null, 'and put away again');

suit.arm(BEACON.DEPLOY);
check(suit.throwBeacon() && suit.armedMode === null && suit.beacon && !suit.beacon.landed, 'throwing sends the beacon into the air');
check(!suit.canPlace() && !suit.arm(BEACON.DEPLOY), 'and no second one can be armed while it is out');
const thrownFrom = player.pos.clone();
let airTime = 0;
while (suit.beacon && !suit.beacon.landed && airTime < 10) { suit.update(dt); airTime += dt; }
check(suit.beacon && suit.beacon.landed && airTime > 0.3 && airTime < CONFIG.suit.beacon.maxFlight, `the beacon arcs and lands (${airTime.toFixed(2)} s)`);
check(suit.beacon.position.z < thrownFrom.z - 3 && Math.abs(suit.beacon.position.y) < 0.2, 'it lands ahead of you, on the ground');
const landedAt = suit.beacon.position.clone();
check(suit.state === 'stowed', 'the suit waits for it to land');
run(CONFIG.suit.beacon.landDelay + 0.05);
check(suit.beacon === null && suit.state === 'dropping', 'after it has blinked there, the suit comes down');
check(Math.hypot(suit.position.x - landedAt.x, suit.position.z - landedAt.z) < 1e-6, 'right where the beacon lay');
check(Math.abs(Math.sin(suit.yaw - player.yaw)) < 1e-9 && Math.cos(suit.yaw - player.yaw) > 0, 'facing the way you were facing, so its back is toward you');
check(suitState.placed !== null && suit.networkState().mode === 5, 'the state records it and the other players are told it is dropping');
const solids = world.solids.length;
check(!suit.canPlace(), 'and it cannot be called again');

frames(0.05);
check(suit.group.visible && suit.group.position.y > sky.height * 0.9, `it starts high in the sky (${suit.group.position.y.toFixed(0)} m)`);
check(world.solids.length === solids, 'it is not solid while it is still falling');
frames(sky.dropTime / 2);
const halfway = suit.group.position.y;
check(halfway < sky.height * 0.9 && halfway > 0, `it falls (${halfway.toFixed(0)} m)`);
check(suit.stage.beam.visible && suit.stage.beam.material.opacity > 0.5, 'in a pillar of light');
player.shake = 0;
frames(sky.dropTime / 2 + 0.1);
check(suit.state === 'standing' && Math.abs(suit.group.position.y - suit.position.y) < 1e-6, 'it lands and stands');
check(world.solids.length === solids + 1, 'a solid obstacle');
check(player.shake > 0, 'with a jolt you feel');
check(suit.stage.ring.visible, 'and a ring of light spreads from the landing');
frames(sky.beamLinger + 0.2);
check(!suit.stage.beam.visible && !suit.stage.ring.visible && suit.sky === null, 'then the light dies away');
check(suit.networkState().mode === 1, 'and the other players are told it is standing');
suit.update(dt);
check(String(hudLog.prompt).includes('ENTER SUIT') || Math.hypot(player.pos.x - suit.position.x, player.pos.z - suit.position.z) > CONFIG.suit.interactRadius, 'you are only prompted to enter once you are near it');

// no room: the suit does not come down on top of something solid
suit.clear();
check(suit.state === 'stowed' && world.solids.length === solids, 'clearing takes the suit and its solid away');
hudLog.banners.length = 0;
check(!suit.callDown(-14, -15, 0) && suit.state === 'stowed' && hudLog.banners.length === 1, 'a beacon that lands on the edge of a building calls nothing down, and says so');
check(!suit.callDown(0, 24, 0) === false && (suit.clear(), true), 'while open ground is fine');
suitState.setOwned(true);

// ---- stepping in ----
suit.callDown(4, 18, 0);
frames(sky.dropTime + sky.beamLinger + 0.3);
check(suit.state === 'standing', 'a suit is standing for the step-in');
const baseCfg = player.cfg;
player.thirdPerson = false;
player.health = 100;
const standingSolids = world.solids.length;
player.pos.copy(suit.position).add(new THREE.Vector3(0, 0, 3)); // next to it, at the back
suit.interact();
check(suit.state === 'entering' && suit.busy, 'using it starts the step in');
check(suit.filterInput({ forward: true }) === IDLE_INPUT, 'the player cannot act while the step-in plays');
check(player.shielded === true, 'and cannot be hurt while it does');
player.takeDamage(50);
check(player.health === 100, `a hit does nothing in that time (${player.health})`);
check(player.thirdPerson === true && cyborg.suppressed === true, 'the view goes third person and the player body hides');
check(world.solids.length === standingSolids - 1, 'the suit stops being an obstacle while the player steps in');
suit.animate();
check(suit.stage.walker.root.visible, 'a walking human is drawn');
run(total / 2);
check(suit.state === 'entering', 'half way through, the step-in is still going');
suit.animate();
check(Math.abs(suit.body.hatch.hinge.rotation.y) > 1.5, 'the back hatch is swung wide open mid-step');
check(suit.body.shells.length === 4 && suit.body.shells.every((shell) => Math.abs(shell.hinge.rotation.y) > 1), 'the rear shells of both arms and both legs are open');
check(suit.body.armL.pivot.rotation.z < -0.5 && suit.body.armR.pivot.rotation.z > 0.5 && suit.body.legL.pivot.rotation.z < -0.2 && suit.body.legR.pivot.rotation.z > 0.2, 'the arms swing out and the legs apart');
check(player.shielded === true, 'still untouchable half way in');
run(total);
check(suit.state === 'piloted' && suitState.occupied && hudLog.suitMode, 'at the end the player is in the suit and the HUD switches to the hologram');
check(player.shielded === false, 'the shield comes down once they are in');
check(player.thirdPerson === false, 'the view the player had before is back');
check(!suit.stage.walker.root.visible && cyborg.suppressed === false, 'the walking human is gone and the body shows again');
check(Math.abs(cyborg.group.scale.x - CONFIG.suit.scale) < 1e-9, 'the player body is the suit, a lot bigger than the human');
check(player.cfg !== baseCfg && Math.abs(player.cfg.radius - CONFIG.player.radius * CONFIG.suit.scale) < 1e-9, 'the hit cylinder grew with the suit');
check(player.movementMods && player.movementMods.speedMul === CONFIG.suit.baseline.speedMul, 'the suit slowdown applies');
check(Math.hypot(player.pos.x - suit.position.x, player.pos.z - suit.position.z) < 1e-6, 'the player stands where the suit stood');
check(suit.filterInput({ forward: true }).forward === true, 'input works again once inside');
check(cyborg.armR.hand.children.includes(cyborg.socket) && cyborg.socket.children.length > 0, 'the weapon socket stays in the hand when the suit goes on');

// ---- three times the health ----
check(player.cfg.maxHealth === CONFIG.player.maxHealth * 3 && player.health === CONFIG.player.maxHealth * 3, `in the suit you have ${player.health} health, three times your own`);
player.takeDamage(100);
check(player.health === 200 && player.alive, 'a hit that would have killed you takes a third of it');
player.takeDamage(250);
check(!player.alive && player.health === 0, 'and the suit still falls eventually');
player.alive = true;
player.health = player.cfg.maxHealth / 2;
player.heal(1000);
check(player.health === player.cfg.maxHealth, 'healing fills the bigger pool');
player.health = player.cfg.maxHealth * 0.4;

// ---- changing a part while inside ----
const armsBefore = cyborg.armL.sleeve.children[0];
suitState.setPart('arms', 'heavy-pauldrons');
check(cyborg.armL.sleeve.children[0] !== armsBefore && cyborg.armL.sleeve.children.length === 1, 'fitting a part while inside changes the worn suit');
check(Math.abs(player.health - player.cfg.maxHealth * 0.4) < 1e-6, 'and does not change your health');

// ---- stepping out ----
player.thirdPerson = false;
suit.interact();
check(suit.state === 'exiting' && !hudLog.suitMode && !suitState.occupied, 'using it from inside starts the step out and the HUD goes back');
check(player.shielded === true, 'untouchable on the way out too');
check(Math.abs(player.health - CONFIG.player.maxHealth * 0.4) < 1e-6 && player.cfg.maxHealth === CONFIG.player.maxHealth, `your own health is back, in the same proportion (${player.health.toFixed(0)} of ${player.cfg.maxHealth})`);
check(Math.abs(cyborg.group.scale.x - 1) < 1e-9 && cyborg.suppressed, 'the player is a plain human again (drawn by the walker)');
run(total + 0.5);
check(suit.state === 'standing' && suit.group.visible, 'the empty suit stays standing');
check(player.shielded === false, 'the shield is down again');
check(player.cfg === baseCfg && player.movementMods === null, 'the player has the plain body and normal movement back');
check(world.solids.length === standingSolids, 'the standing suit is an obstacle again');
const away = Math.hypot(player.pos.x - suit.position.x, player.pos.z - suit.position.z);
check(Math.abs(away - CONFIG.suit.walkBehind) < 0.01, 'the player ends up behind the suit, where they got in');
const outBack = (player.pos.x - suit.position.x) * -Math.sin(suit.yaw) + (player.pos.z - suit.position.z) * -Math.cos(suit.yaw);
check(outBack < -1, 'they came out of its back, not its front');
check(player.thirdPerson === false && cyborg.suppressed === false, 'the view is restored and the body shows');
check(cyborg.armR.hand.children.includes(cyborg.socket) && cyborg.socket.children.length > 0, 'and when it comes off again');
player.health = 100;
player.takeDamage(10);
check(player.health === 90, 'and a hit hurts again');

// ---- recalling it ----
check(suit.canPickUp() && !suit.canPlace(), 'a standing suit can be recalled');
check(suit.arm(BEACON.RECALL) && suit.throwBeacon(), 'a recall beacon is thrown the same way');
let recallAir = 0;
while (suit.beacon && !suit.beacon.landed && recallAir < 10) { suit.update(dt); recallAir += dt; }
check(suit.state === 'standing' && suit.beacon.landed, 'the suit waits while the beacon lands');
run(CONFIG.suit.beacon.landDelay + 0.05);
check(suit.state === 'lifting' && suit.beacon === null, 'then it rises');
check(world.solids.length === standingSolids - 1, 'and is not an obstacle any more');
check(suit.networkState().mode === 6 && !suit.canPickUp(), 'the other players are told it is rising');
frames(sky.liftTime / 2);
const rising = suit.group.position.y - suit.position.y;
check(rising > 1 && suit.stage.beam.visible, `it rises in a pillar of light (${rising.toFixed(0)} m up)`);
frames(sky.liftTime / 2 + 0.2);
check(suit.state === 'stowed' && !suit.group.visible && !suit.stage.beam.visible, 'and is gone into the sky');
check(suitState.placed === null && suitState.owned && suit.networkState() === null, 'back in your pack, and owned');
check(suit.canPlace(), 'ready to be called down again');

// ---- dying inside, and other ways it goes away ----
suit.callDown(4, 18, 0);
frames(sky.dropTime + sky.beamLinger + 0.3);
player.pos.copy(suit.position).add(new THREE.Vector3(0, 0, 1.5));
player.health = 100;
suit.interact();
run(total + 0.5);
check(suit.state === 'piloted' && player.cfg.maxHealth === 300, 'the suit can be entered again');
suit.ejectOnDeath();
check(suit.state === 'standing' && !suitState.occupied && player.cfg === baseCfg, 'dying inside throws the player out of a standing suit');

player.pos.set(suit.position.x + 20, 0, suit.position.z);
suit.update(dt);
check(hudLog.prompt === null, 'no prompt from far away');
suit.interact();
check(suit.state === 'standing', 'it cannot be entered from far away');
suit.arm(BEACON.RECALL);
check(suit.armedMode === BEACON.RECALL, 'a recall beacon in hand...');
suit.ejectOnDeath();
check(suit.armedMode === null, '...is put away when you die');

player.reset();
suit.arm(BEACON.RECALL);
suit.throwBeacon();
const sceneChildren = scene.children.length;
suit.clear();
check(suit.beacon === null && scene.children.length === sceneChildren - 1, 'clearing takes a beacon in the air out of the world');
check(suit.state === 'stowed' && player.cfg === baseCfg && !cyborg.suppressed && !suit.stage.walker.root.visible && !player.shielded, 'clearing leaves everything put back');
check(world.solids.length === solids - 1 || world.solids.length <= standingSolids - 1, 'and no obstacle behind');

suitState.setOwned(true);
suit.callDown(4, 18, 0);
frames(0.3);
suit.clear();
check(suit.state === 'stowed' && suit.sky === null && !suit.group.visible && !suit.stage.beam.visible, 'clearing a suit that is still falling stops it');

suit.callDown(4, 18, 0);
frames(sky.dropTime + sky.beamLinger + 0.3);
player.pos.copy(suit.position).add(new THREE.Vector3(0, 0, 1.5));
suit.interact();
run(0.5);
suit.clear();
check(suit.state === 'stowed' && player.cfg === baseCfg && !cyborg.suppressed && !player.shielded, 'clearing mid-step puts everything back, including the shield');

// ---- the same cycle in the sandbox ----
check(new SandboxMode({ config: CONFIG.sandbox }).allowsInventory === true, 'the sandbox lets you open the character screen');
world.build('sandbox');
player.spawnX = 0;
player.spawnZ = CONFIG.sandbox.half - 30;
player.reset();
player.invulnerable = true; // what the sandbox sets
suitState.setOwned(true);
check(suit.arm(BEACON.DEPLOY) && suit.throwBeacon(), 'in the sandbox: a beacon can be thrown');
let sandboxAir = 0;
while (suit.beacon && !suit.beacon.landed && sandboxAir < 10) { suit.update(dt); sandboxAir += dt; }
run(CONFIG.suit.beacon.landDelay + 0.05);
check(suit.state === 'dropping', 'the suit drops there');
frames(sky.dropTime + sky.beamLinger + 0.3);
check(suit.state === 'standing', 'and stands');
player.pos.copy(suit.position).add(new THREE.Vector3(0, 0, 2));
player.health = 100;
suit.interact();
check(suit.state === 'entering' && player.shielded && player.invulnerable, 'you step in (the sandbox\'s own invulnerability is not disturbed)');
run(total + 0.5);
check(suit.state === 'piloted' && player.invulnerable === true && player.cfg.maxHealth === 300 && player.health === 300, 'and wear it, with its health');
player.takeDamage(40);
check(player.health === 300, 'while the sandbox still cannot hurt you');
suit.interact();
run(total + 0.5);
check(suit.state === 'standing' && player.invulnerable === true && player.shielded === false && player.health === 100, 'you step out, and the sandbox is as it was');
check(suit.arm(BEACON.RECALL) && suit.throwBeacon(), 'a recall beacon goes the same way');
let recallSandboxAir = 0;
while (suit.beacon && !suit.beacon.landed && recallSandboxAir < 10) { suit.update(dt); recallSandboxAir += dt; }
run(CONFIG.suit.beacon.landDelay + 0.05);
frames(sky.liftTime + 0.2);
check(suit.state === 'stowed' && suit.canPlace(), 'and the suit goes back up into the sky');

process.exit(fails ? 1 : 0);
