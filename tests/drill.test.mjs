/*
 * The boring launcher: heads that fly, impale surfaces and become solid, skewer and carry bots and players,
 * ghost copies of other players' heads, the pinned pull, and the reload choreography.
 */
import { load, loadConfig, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { createEffects } = await load('effects');
const { World } = await load('world');
const { Player } = await load('player');
const { Enemies } = await load('enemies');
const { Weapons, HOLDABLE_MODELS } = await load('weapons');
const { Targets } = await load('targets');
const { BoringLauncher, DRILL_TUNING } = await load('boring-launcher');

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
const sounds = [];
const audio = new Proxy({}, { get: (target, key) => (...args) => sounds.push([key, ...args]) });
const enemies = new Enemies({ cfg: CONFIG, scene, world, fx, player });
const remoteCalls = [];
const remoteTarget = { isRemote: true, alive: true, hp: 100, id: 7, pos: new THREE.Vector3(-20, 0, 5) };
const fakeRemotes = {
  list: [],
  raycast: () => null,
  pull: (target, options) => remoteCalls.push(['pull', target.id, { ...options, direction: options.direction?.clone() }]),
  release: (target) => remoteCalls.push(['release', target.id]),
  damage: (target, amount) => { remoteCalls.push(['damage', target.id, amount]); return false; },
  bodyCenter: (target, out) => out.copy(target.pos).setY(1),
};
const weapons = new Weapons({ cfg: CONFIG, camera, mainScene: scene, envMap: null, world, enemies, player, fx, hud, audio });
weapons.enemies = new Targets({ enemies, remotes: fakeRemotes });
const sent = [];
weapons.onItemMessage = (message) => sent.push(message);

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
const drillIndex = CONFIG.weapons.list.findIndex((item) => item.id === 'drill');
const drill = weapons.slots[drillIndex];
const equip = () => { weapons.reset(); weapons.select(drillIndex); step(40); };
const fire = () => { input.firePressed = 1; step(1); };
const stepUntil = (done, limit = 200) => { for (let i = 0; i < limit && !done(); i++) step(1); };
const untilStuck = (limit = 400) => { for (let i = 0; i < limit && drill.heads.flying.length; i++) step(1); };
const spawnBot = (z) => { const bot = enemies._spawnAt('cable', -20, z, 1); bot.boot = 0; bot.attackCd = 99; bot.speed = 0; bot.hp = 1000; bot.dodgeCd = 1e9; return bot; };

check(drill instanceof BoringLauncher && drill.cfg.type === 'projectile', 'the drill launcher is a projectile weapon in the list');
check(weapons.armory().some((entry) => entry.id === 'drill'), 'and it shows in the inventory');
check(drill.aimable && drill.cfg.scope && drill.cfg.ads.fovDrop > 0, 'it can aim down its scope');
check(['speed', 'range', 'hitRadius', 'impactDamage', 'crushDamage', 'carrySeconds', 'stickSeconds', 'maxStuck'].every((key) => typeof DRILL_TUNING[key] === 'number'), 'every tunable number is in the launcher file');
check(DRILL_TUNING.carrySeconds === 3, 'a skewered target is carried for 3 seconds');

// --- firing and impaling a wall ---
equip();
place(-20, 20, 0);
check(drill.mag === 1 && drill.reserve === 4, 'it starts with one head loaded and four spare');
fire();
check(drill.mag === 0 && drill.heads.flying.length === 1, 'firing launches one head and empties the launcher');
check(sounds.some(([name, id]) => name === 'shoot' && id === 'drill'), 'and plays the launch sound');
check(sent.length === 1 && sent[0].t === 'dr' && sent[0].f.length === 3 && sent[0].d.length === 3, 'the launch is announced to other players');
const head = drill.heads.flying[0];
step(3);
check(head.pos.z < 19 && head.pos.z > 15 && Math.abs(head.pos.x + 20) < 0.5, `the head flies straight at the speed in the tuning (z ${head.pos.z.toFixed(1)})`);
untilStuck();
check(drill.heads.stuck.length === 1 && drill.heads.flying.length === 0, 'it impales the far wall and stays there');
check(sounds.some(([name]) => name === 'drillImpact'), 'with an impact sound');
step(3);
check(head.solids.length > 0, `the part sticking out becomes solid (${head.solids.length} boxes)`);
const box = head.solids[0];
const cx = (box.minX + box.maxX) / 2;
const cz = (box.minZ + box.maxZ) / 2;
check(world.isBlocked(cx, cz, 0.3, 0), 'a walker cannot pass through it');
check(world.groundHeight(cx, cz) === box.height && box.height > 0.3, `its top is a surface at ${box.height.toFixed(2)} m`);
player.reset(); player.pos.set(cx, box.height, cz); player.prevPos.copy(player.pos); player.invulnerable = true;
step(20);
check(player.grounded && Math.abs(player.pos.y - box.height) < 0.05, 'a player can stand on top of it');
check(world.raycast(new THREE.Vector3(cx, box.height + 1, cz), new THREE.Vector3(0, -1, 0), 5) < 1.2, 'and shots meet it too');

// --- it goes away; the oldest goes first ---
const stickBefore = DRILL_TUNING.stickSeconds;
DRILL_TUNING.stickSeconds = 0.5;
drill.heads.stuck[0].stuckLeft = 0.5;
place(-20, 25, 0);
step(40);
check(drill.heads.count === 0 && !world.solids.includes(box), 'after its time it vanishes and its solid goes with it');
DRILL_TUNING.stickSeconds = stickBefore;
DRILL_TUNING.maxStuck = 2;
for (let i = 0; i < 3; i++) {
  drill.heads.launch(new THREE.Vector3(-20, 1.5, 20), new THREE.Vector3(0, 0, -1), { ghost: true });
  for (let n = 0; n < 200 && drill.heads.flying.length; n++) step(1);
}
check(drill.heads.stuck.length === 2, 'only the newest few stay stuck (the oldest vanishes first)');
drill.heads.clear();
DRILL_TUNING.maxStuck = 6;
check(drill.heads.count === 0 && !world.solids.some((s) => s.height > 0.3 && s.minX > -21 && s.maxX < -19 && s.minZ < -20), 'clearing removes every head and every solid');

// --- the floor ---
drill.heads.launch(new THREE.Vector3(-20, 1.5, 10), new THREE.Vector3(0, -0.5, -1), { ghost: true });
for (let i = 0; i < 100 && drill.heads.flying.length; i++) step(1);
check(drill.heads.stuck.length === 1 && Math.abs(drill.heads.stuck[0].pos.y) < 0.05, 'a head fired at the ground sticks in the ground');
drill.heads.clear();

// --- nobody is trapped inside it ---
place(-20, 20, 0);
drill.heads.launch(new THREE.Vector3(-20, 1.5, 20), new THREE.Vector3(0, 0, -1), { ghost: true });
untilStuck();
const wall = drill.heads.stuck[0].pos.z;
drill.heads.clear();
place(-20, wall + 0.6, 0);
drill.heads.launch(new THREE.Vector3(-20, 1.5, wall + 8), new THREE.Vector3(0, 0, -1), { ghost: true });
for (let i = 0; i < 100 && drill.heads.flying.length; i++) step(1);
step(10);
const crowded = drill.heads.stuck[0];
check(crowded.solids.length === 0 && crowded.boxes.length > 0, 'a part waits while a player stands where it would appear');
place(-20, wall + 8, 0);
step(5);
check(crowded.solids.length > 0, 'and appears once they step away');
drill.heads.clear();

// --- skewering a bot ---
equip();
place(-20, 20, 0);
let bot = spawnBot(8);
fire();
stepUntil(() => bot.pin);
check(bot.pin && bot.hp === 1000 - DRILL_TUNING.impactDamage, `a bot that is hit is skewered and takes ${DRILL_TUNING.impactDamage} damage`);
const botZ = bot.pos.z;
step(6);
check(bot.pos.z < botZ - 2, 'and is carried along the head\'s path');
const headNow = drill.heads.flying[0];
check(headNow && Math.abs(bot.pos.z - headNow.pos.z) < 1.5, 'it hangs from the head');
untilStuck();
step(2);
check(!bot.pin && bot.hp === 1000 - DRILL_TUNING.impactDamage - DRILL_TUNING.crushDamage, `at the wall it is let go and takes ${DRILL_TUNING.crushDamage} crush damage`);
check(bot.stun > 0, 'and is dazed');
drill.heads.clear();
enemies.clear();

// --- the 3 second limit ---
const speedBefore = DRILL_TUNING.speed;
DRILL_TUNING.speed = 10;
equip();
place(-20, 20, 0);
bot = spawnBot(14);
fire();
stepUntil(() => bot.pin, 100);
step(5);
check(bot.pin, 'a skewered bot rides the head');
step(Math.round(DRILL_TUNING.carrySeconds / dt) + 10);
check(!bot.pin && drill.heads.flying.length === 1, 'after 3 seconds it is let go while the head flies on');
DRILL_TUNING.speed = speedBefore;
drill.heads.clear();
enemies.clear();

// --- a bot killed by the hit ---
equip();
place(-20, 20, 0);
bot = spawnBot(8);
bot.hp = 5;
fire();
stepUntil(() => bot.hp <= 0);
step(3);
check(bot.hp <= 0 && !drill.heads.flying[0]?.victims.length, 'a bot killed by the hit is not carried');
drill.heads.clear();
enemies.clear();

// --- several targets on one head ---
equip();
place(-20, 20, 0);
const first = spawnBot(10);
const second = spawnBot(2);
const third = spawnBot(-6);
fire();
stepUntil(() => first.pin);
check(first.pin && !second.pin, 'the first target is skewered and the next ones are not yet');
stepUntil(() => second.pin && third.pin);
check(first.pin && second.pin && third.pin, 'the head skewers every further target it meets, and the first stays on');
check(first.hp === 1000 - DRILL_TUNING.impactDamage && second.hp === 1000 - DRILL_TUNING.impactDamage && third.hp === 1000 - DRILL_TUNING.impactDamage, 'each takes the impact damage once');
step(3);
const headMulti = drill.heads.flying[0];
check(headMulti.victims.length === 3, 'the head carries all three');
check(first.pos.z < second.pos.z + 0.01 && Math.abs(first.pos.z - second.pos.z) > 0.3, 'they hang one behind the other along the shaft');
step(4);
check(first.hp === 1000 - DRILL_TUNING.impactDamage && headMulti.struck.size === 3, 'a target already on the head is not hit again');
untilStuck();
step(2);
const crushed = 1000 - DRILL_TUNING.impactDamage - DRILL_TUNING.crushDamage;
check(!first.pin && !second.pin && !third.pin && first.hp === crushed && second.hp === crushed && third.hp === crushed, 'at the wall all three are let go and slammed with the crush damage');
drill.heads.clear();
enemies.clear();

// each target has its own 3 second timer
DRILL_TUNING.speed = 10;
equip();
place(-20, 20, 0);
const early = spawnBot(14);
const late = spawnBot(10);
fire();
stepUntil(() => early.pin, 100);
stepUntil(() => late.pin, 100);
step(Math.round((DRILL_TUNING.carrySeconds - 0.6) / dt));
check(early.pin && late.pin, 'both are still riding just before the first one\'s time is up');
stepUntil(() => !early.pin, 200);
check(!early.pin && late.pin, 'the first is let go on its own time while the later one stays on');
stepUntil(() => !late.pin, 200);
check(!late.pin, 'and the later one is let go on its own time');
DRILL_TUNING.speed = speedBefore;
drill.heads.clear();
enemies.clear();

// a kill on the way does not stop the head
equip();
place(-20, 20, 0);
const doomed = spawnBot(10);
doomed.hp = 5;
const survivor = spawnBot(2);
fire();
stepUntil(() => survivor.pin);
check(doomed.hp <= 0 && survivor.pin, 'a head that kills one target carries on and skewers the next');
drill.heads.clear();
enemies.clear();

// players and bots on the same head
equip();
place(-20, 20, 0);
const botFirst = spawnBot(10);
fakeRemotes.list = [remoteTarget];
fakeRemotes.raycast = (origin, dir, maxT, radius, boost, skip) => (skip?.has(remoteTarget) || origin.z > 4 ? null : { enemy: remoteTarget, t: 0.2, crit: false });
remoteCalls.length = 0;
fire();
stepUntil(() => botFirst.pin && remoteCalls.some(([name]) => name === 'pull'));
check(botFirst.pin && remoteCalls.some(([name]) => name === 'pull'), 'a bot and a player can both be on the same head');
step(10);
check(remoteCalls.filter(([name]) => name === 'pull').length === 1, 'the player is sent the carry once');
untilStuck();
check(remoteCalls.filter(([name]) => name === 'release').length === 1 && !botFirst.pin, 'and both are released at the wall');
fakeRemotes.raycast = () => null;
fakeRemotes.list = [];
drill.heads.clear();
enemies.clear();

// --- a player is told to ride along ---
equip();
place(-20, 20, 0);
fakeRemotes.list = [remoteTarget];
fakeRemotes.raycast = () => ({ enemy: remoteTarget, t: 0.3, crit: false });
remoteCalls.length = 0;
fire();
step(2);
const pull = remoteCalls.find(([name]) => name === 'pull');
check(pull && pull[2].speed === DRILL_TUNING.speed && pull[2].seconds === DRILL_TUNING.carrySeconds && pull[2].direction.z < -0.9, 'a player that is hit is sent the head\'s direction, speed and time');
check(remoteCalls.some(([name, , amount]) => name === 'damage' && amount === DRILL_TUNING.impactDamage), 'and takes the impact damage');
fakeRemotes.raycast = () => null;
fakeRemotes.list = [];
untilStuck();
check(remoteCalls.some(([name]) => name === 'release'), 'and is released when the head meets the wall');
check(remoteCalls.some(([name, , amount]) => name === 'damage' && amount === DRILL_TUNING.crushDamage), 'after taking the crush damage');
drill.heads.clear();

// --- the carried player's own game ---
place(-20, 20, 0);
const ahead = () => ({ x: player.pos.x, y: player.pos.y + 0.9, z: player.pos.z - 50 });
player.pullToward(ahead, { speed: 20, arrive: 0, seconds: 3, pinned: true });
step(10);
input.jumpPressed = 1; step(1);
check(player.pulled && player.pos.z < 17, 'jumping does not free a player who is impaled');
for (let i = 0; i < 200 && player.pulled; i++) step(1);
check(!player.pulled && player.pos.z < -20, `it ends at the first thing they hit (z ${player.pos.z.toFixed(1)})`);

// --- other players' heads ---
equip();
place(-20, 20, 0);
bot = spawnBot(8);
const hpBefore = bot.hp;
weapons.onPeerMessage(3, { t: 'dr', f: [-20, 1.5, 20], d: [0, 0, -1] });
check(drill.heads.flying.length === 1 && drill.heads.flying[0].ghost, 'another player\'s launch message flies a copy of their head');
untilStuck();
check(drill.heads.stuck.length === 1 && bot.hp === hpBefore && !bot.pin, 'it sticks like the real one, but hits no one');
drill.heads.clear();
enemies.clear();
for (const bad of [{ t: 'dr' }, { t: 'dr', f: [NaN, 0, 0], d: [0, 0, -1] }, { t: 'dr', f: [0, 0, 0], d: [0, 0, 0] }, { t: 'dr', f: 'x', d: [0, 0, 1] }]) weapons.onPeerMessage(3, bad);
check(drill.heads.count === 0, 'bad launch messages are ignored');
weapons.onPeerMessage(3, { t: 'zz', f: [0, 1, 0], d: [0, 0, -1] });
check(drill.heads.count === 0, 'and so are other message types');

// --- heads fly on whatever you hold ---
equip();
place(-20, 20, 0);
fire();
weapons.select(1);
step(60);
check(drill.heads.stuck.length === 1 || drill.heads.flying.length === 1, 'a head keeps flying after you switch weapons');
untilStuck();
check(drill.heads.stuck.length === 1, 'and sticks');
weapons.reset();
check(drill.heads.count === 0, 'a reset clears every head');

// --- reloading ---
equip();
place(-20, 20, 0);
fire();
step(Math.round(0.9 / dt));
input.reloadPressed = 1; step(1); input.reloadPressed = 0;
check(drill.reloading, 'the reload control starts a reload');
const lift = (progress) => {
  drill.reloadTimer = drill.cfg.reloadTime * (1 - progress);
  const pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, supportDrop: 0 };
  drill.poseView(weapons, pose, dt, 0, weapons.models[drillIndex]);
  return pose;
};
check(lift(0.05).rx < lift(0.18).rx && lift(0.18).rx > 1.2, 'the launcher swings up to stand barrel up in front of the player');
check(lift(0.5).rx > 1.2 && lift(0.7).rx > 1.2, 'and stays up while it is loaded and primed');
check(lift(0.97).rx < 0.3, 'then comes back down to the shoulder');
const model = HOLDABLE_MODELS.drill.build();
const arm = model.parts.support.object;
const headOf = () => model.root.children.find((child) => child.scale.x === 0.32);
const live = (p, over = {}) => ({ reloadProgress: p, reloading: p > 0, rounds: 0, capacity: 1, ammo: 0, pulse: 0, aiming: 0, ...over });
model.animate(dt, 0, live(0));
check(!headOf().visible, 'after a shot the barrel is empty');
const restZ = arm.position.z;
model.animate(dt, 0, live(0.1));
check(!headOf().visible, 'the head is not there yet while the launcher swings up');
model.animate(dt, 0, live(0.22));
const highZ = headOf().position.z;
check(headOf().visible && highZ < -1.5, 'the next head appears above the muzzle');
model.animate(dt, 0, live(0.3));
const midZ = headOf().position.z;
model.animate(dt, 0, live(0.5));
const seatedZ = headOf().position.z;
check(highZ < midZ && midZ < seatedZ, 'and is lowered in from the top');
model.animate(dt, 0, live(0.3));
check(Math.abs(arm.position.z - (headOf().position.z + 0.2)) < 0.05 && Math.abs(arm.position.z - restZ) > 0.5, 'the off hand carries the head down');
const slide = model.root.children.find((child) => child.children.length === 1 && child.children[0].geometry.type === 'ExtrudeGeometry');
model.animate(dt, 0, live(0.55));
const slideRest = slide.position.z;
model.animate(dt, 0, live(0.7));
check(slide.position.z > slideRest + 0.1, 'the slide is pulled back to prime it');
check(arm.position.y > 0.1, 'by the off hand');
model.animate(dt, 0, live(0.8));
check(Math.abs(slide.position.z - slideRest) < 1e-6, 'and let go, so it snaps forward');
model.animate(dt, 0, live(0.95));
check(Math.abs(arm.position.z - restZ) < 0.1, 'the hand goes back to the foregrip');
model.animate(dt, 0, live(0, { rounds: 1, ammo: 1 }));
check(headOf().visible && Math.abs(headOf().position.z - seatedZ) < 1e-6, 'when loaded the head sits in the barrel');
step(Math.round(drill.cfg.reloadTime / dt) + 10);
check(!drill.reloading && drill.mag === 1 && drill.reserve === 3, 'the reload ends with a head loaded and one spare used');


// --- aiming down the scope ---
{
  const modelNow = weapons.models[drillIndex];
  weapons.reset(); weapons.select(drillIndex); step(40);
  let tube = null;
  modelNow.root.traverse((o) => { if (o.position.y === -drill.cfg.ads.y && o.position.z === 0.3) tube = o; });
  check(Boolean(tube), 'the scope tube sits at the height the aim pose centres on the view');
  weapons.adsBlend = 0;
  drill.poseView(weapons, { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, supportDrop: 0 }, dt, 0, modelNow);
  check(modelNow.root.visible, 'hip-firing shows the launcher');
  weapons.adsBlend = 1;
  drill.poseView(weapons, { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, supportDrop: 0 }, dt, 0, modelNow);
  check(!modelNow.root.visible, 'fully aimed, the launcher is out of the picture behind the scope overlay');
  weapons.adsBlend = 0;
  drill.poseView(weapons, { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, supportDrop: 0 }, dt, 0, modelNow);
  check(modelNow.root.visible, 'and comes back when the aim is released');
  const frames = (n) => { for (let i = 0; i < n; i++) { step(1); weapons.updateView(dt, i * dt); } };
  input.aimHeld = 1; frames(40);
  check(weapons.aiming && weapons.adsBlend > 0.9 && player.zoom > 20, `holding aim raises the scope and zooms the view (${player.zoom.toFixed(0)} degrees)`);
  input.aimHeld = 0; frames(60);
  check(!weapons.aiming && player.zoom < 1, 'letting go drops it again');
}


// --- steering a head in mid-air ---
{
  const angleOf = (drillHead, vector) => drillHead.dir.angleTo(vector);
  const straight = new THREE.Vector3(0, 0, -1);
  sent.length = 0;
  equip();
  place(-20, 20, 0);
  input.fireHeld = 1;
  fire();
  const steered = drill.heads.flying[0];
  check(typeof steered.guide === 'function', 'a head fired by the player can be steered');
  player.yaw = 0.6; // look to one side while still holding fire
  step(30);
  check(angleOf(steered, straight) > 0.1, `holding fire and looking aside bends the head's path (${angleOf(steered, straight).toFixed(2)} rad)`);
  check(angleOf(steered, straight) <= DRILL_TUNING.guideTurnRate * 0.55 + 0.05, 'but only slowly: it cannot turn faster than the turn rate');
  const bent = steered.dir.clone();
  input.fireHeld = 0;
  step(20);
  check(steered.dir.angleTo(bent) < 0.03 && steered.guide === null, 'letting go of fire straightens its course: it flies on in the direction it had');
  check(sent.filter((m) => m.t === 'ds' && m.i === steered.id).length >= 2, 'steering is announced to other players, with the final heading when guidance ends');
  const lastSteer = sent.filter((m) => m.t === 'ds').at(-1);
  check(Math.abs(lastSteer.d[0] - bent.x) < 0.03 && Math.abs(lastSteer.d[2] - bent.z) < 0.03, 'the last announcement carries the heading it flies on with');
  drill.heads.clear();

  // without holding fire nothing bends
  equip();
  place(-20, 20, 0);
  input.fireHeld = 0;
  fire();
  const unguided = drill.heads.flying[0];
  player.yaw = 0.6;
  step(30);
  check(angleOf(unguided, straight) < 0.05, 'a head you do not hold fire for flies straight, wherever you look');
  drill.heads.clear();

  // a quarter turn takes time, and there is a time limit
  equip();
  place(-20, 20, 0);
  input.fireHeld = 1;
  fire();
  const slow = drill.heads.flying[0];
  player.yaw = 1.4;
  const turnBefore = DRILL_TUNING.speed;
  DRILL_TUNING.speed = 1; // slow, so it is still flying after a few seconds
  step(60);
  check(angleOf(slow, straight) <= DRILL_TUNING.guideTurnRate * 1.0 + 0.1, `in one second it turns no more than the turn rate (${angleOf(slow, straight).toFixed(2)} rad)`);
  step(Math.round(DRILL_TUNING.guideSeconds / dt));
  check(slow.guide === null, 'steering stops after the guide time');
  DRILL_TUNING.speed = turnBefore;
  input.fireHeld = 0;
  drill.heads.clear();

  // putting the launcher away stops steering
  equip();
  place(-20, 20, 0);
  input.fireHeld = 1;
  fire();
  weapons.select(1);
  step(30);
  check(drill.heads.flying[0]?.guide === null || drill.heads.stuck.length === 1, 'switching weapons ends the steering');
  input.fireHeld = 0;
  drill.heads.clear();

  // a skewered bot follows the new heading
  equip();
  place(-20, 20, 0);
  const rider = spawnBot(12);
  input.fireHeld = 1;
  fire();
  stepUntil(() => rider.pin);
  player.yaw = 0.8;
  step(40);
  const carrier = drill.heads.flying[0];
  check(carrier && rider.pin && Math.abs(rider.pos.x - carrier.pos.x) < 1.5 && Math.abs(rider.pos.z - carrier.pos.z) < 1.5 && carrier.dir.x !== 0, 'a bot on the head goes where the head is steered');
  input.fireHeld = 0;
  drill.heads.clear();
  enemies.clear();

  // a player on the head is told every new direction
  equip();
  place(-20, 20, 0);
  fakeRemotes.list = [remoteTarget];
  fakeRemotes.raycast = (origin, dir, maxT, radius, boost, skip) => (skip?.has(remoteTarget) ? null : { enemy: remoteTarget, t: 0.2, crit: false });
  remoteCalls.length = 0;
  input.fireHeld = 1;
  fire();
  stepUntil(() => remoteCalls.some(([name]) => name === 'pull'));
  player.yaw = 0.8;
  step(40);
  const pulls = remoteCalls.filter(([name]) => name === 'pull');
  check(pulls.length >= 3 && pulls.at(-1)[2].direction.x !== pulls[0][2].direction.x, `the carried player is sent the new direction as it changes (${pulls.length} messages)`);
  check(pulls.at(-1)[2].seconds < DRILL_TUNING.carrySeconds, 'with the time they have left');
  fakeRemotes.raycast = () => null;
  fakeRemotes.list = [];
  input.fireHeld = 0;
  drill.heads.clear();

  // ghosts follow the steering messages
  equip();
  place(-20, 20, 0);
  weapons.onPeerMessage(3, { t: 'dr', i: 5, f: [-20, 1.5, 20], d: [0, 0, -1] });
  const ghost = drill.heads.flying[0];
  step(10);
  weapons.onPeerMessage(3, { t: 'ds', i: 5, f: [ghost.pos.x, ghost.pos.y, ghost.pos.z], d: [0.5, 0, -0.866] });
  check(ghost.dir.x > 0.45 && Math.abs(ghost.dir.length() - 1) < 1e-6, 'a steering message turns the copy of that player\'s head');
  const x = ghost.pos.x;
  step(10);
  check(ghost.pos.x > x + 1, 'and it flies the new way');
  weapons.onPeerMessage(4, { t: 'ds', i: 5, f: [0, 1, 0], d: [-1, 0, 0] });
  weapons.onPeerMessage(3, { t: 'ds', i: 99, f: [0, 1, 0], d: [-1, 0, 0] });
  weapons.onPeerMessage(3, { t: 'ds', i: 5, f: [0, 1, 0], d: [0, 0, 0] });
  weapons.onPeerMessage(3, { t: 'ds', i: 5, f: [NaN, 1, 0], d: [1, 0, 0] });
  check(ghost.dir.x > 0.45 && Math.abs(ghost.pos.x - x) < 20, 'steering from another player, for an unknown head, or with bad numbers is ignored');
  weapons.onPeerMessage(3, { t: 'ds', i: 5, f: [ghost.pos.x + 30, 1, ghost.pos.z], d: [0.5, 0, -0.866] });
  check(Math.abs(ghost.pos.x - (x + 30)) < 25, 'a copy that has drifted far from its shooter\'s head jumps back to it');
  untilStuck();
  weapons.onPeerMessage(3, { t: 'ds', i: 5, f: [0, 1, 0], d: [-1, 0, 0] });
  check(drill.heads.stuck.length === 1 && drill.heads.stuck[0].dir.x > 0.45, 'steering a copy that has already stuck does nothing');
  drill.heads.clear();
  check(drill.heads.ghosts.size === 0, 'a removed copy is forgotten');
}

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
