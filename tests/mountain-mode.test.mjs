/*
 * The mountain mode: the three hooks it adds to GameMode, and the ski run's start and stop on the real world and player.
 */
import { load, loadConfig, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { GameMode } = await load('game-mode');
const { ModeManager } = await load('mode-manager');
const { MountainMode } = await load('mountain-mode');
const { SkiRun } = await load('ski-run');
const { World } = await load('world');
const { loadPhysics } = await load('physics');
const { Player } = await load('player');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };

// --- the hooks ---
class PlainMode extends GameMode { constructor() { super('plain'); } }
const plain = new PlainMode();
check(plain.stepsPlayer === true && plain.look(1, 1) === false && plain.applyCamera(0, 0) === false, 'should leave the player and the camera to the game when a mode overrides nothing');
const manager = new ModeManager({ prepare: () => {}, cleanup: () => {} });
check(manager.stepsPlayer === true && manager.look(1, 1) === false && manager.applyCamera(0, 0) === false, 'should leave the player and the camera to the game when no mode runs');

const calls = [];
const fakeRun = {
  start: (options) => calls.push(['start', options]), stop: () => calls.push(['stop']), fixedUpdate: (dt, input) => calls.push(['fixed', dt, input]),
  update: () => calls.push(['update']), look: (dx, dy) => calls.push(['look', dx, dy]), applyCamera: (alpha, dt) => calls.push(['camera', alpha, dt]),
};
const CONFIG = await loadConfig();
const mode = manager.register(new MountainMode({ skiRun: fakeRun, config: CONFIG.ski }));
check(mode.setup.level === 'mountain' && mode.setup.invulnerable === true && mode.setup.fog === CONFIG.ski.fog, 'should ask for the empty mountain level, its own fog and no damage');
check(mode.stepsPlayer === false && mode.allowsInventory === false, 'should move the player itself and keep the character screen shut');
manager.start('mountain', { course: 'freeride' });
check(manager.stepsPlayer === false && manager.look(3, 4) === true && manager.applyCamera(0.5, 0.016) === true, 'should take the look input and the camera through the manager when it runs');
manager.fixedUpdate(0.016, 'input');
manager.update(0.016, { playing: true });
manager.stop('menu');
check(JSON.stringify(calls) === JSON.stringify([['start', { course: 'freeride' }], ['look', 3, 4], ['camera', 0.5, 0.016], ['fixed', 0.016, 'input'], ['update'], ['stop']]), 'should pass every event on to the ski run');

// --- the ski run on the real world and player ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 320);
const world = new World(scene, CONFIG);
const player = new Player(camera, world, CONFIG.player);
const log = [];
const hud = {
  active: false, dev: null, speed: null, time: null, finish: null, edge: null, alert: null, style: null, trick: null, load: null, stomp: null,
  setActive(active) { this.active = active; }, setDevText(text) { this.dev = text; },
  setSpeed(speed) { this.speed = speed; }, setEdge(edge) { this.edge = edge; }, setAlert(alert) { this.alert = alert; }, setStyle(style) { this.style = style; }, showTrick(trick) { this.trick = trick; }, setLoad(load, stomp) { this.load = load; this.stomp = stomp; }, setTime(time) { this.time = time; }, showFinish(time) { this.finish = time; },
};
// The third-person body, as far as the rider's body needs it (the model itself is not loaded here).
const cyborg = { root: new THREE.Group(), group: new THREE.Group(), shadow: new THREE.Object3D(), skin: null, poser: null, reset: () => log.push('cyborg-reset') };
const renderer = { shadowMap: { needsUpdate: false } };
const skiRun = new SkiRun({
  config: CONFIG.ski, playerConfig: CONFIG.player, handsIndex: CONFIG.weapons.handsIndex, menuLevel: 'waves',
  world, player, camera, renderer, skiHud: hud, cyborg, loadPhysics,
  weapons: { equipNow: (index) => log.push(`equip-${index}`) },
});
const input = { selectSlot: -1, reloadPressed: false, analogActive: false, forward: false, back: false, left: false, right: false, jumpHeld: false, jumpPressed: false, sprintHeld: false };
const step = (overrides = {}) => skiRun.fixedUpdate(1 / 60, { ...input, ...overrides });

check(skiRun.active === false, 'should not be active before a run starts');
player.thirdPerson = false;
world.build('mountain');
check(world.group.children.length === 0, 'should build an empty level for the mountain, with no floor and no walls');
skiRun.start({ course: 'freeride' });
const course = skiRun.course;
check(skiRun.active && world.group.children.includes(skiRun.scene.group), 'should put the course in the world when a run starts');
check(player.pos.x === course.start.x && player.pos.z === course.start.z && player.pos.y === course.heightfield.heightAt(course.start.x, course.start.z), 'should stand the rider on the snow at the start gate');
check(player.yaw === course.start.yaw && player.vel.length() === 0, 'should face the rider down the course, at rest');
check(player.thirdPerson === true && player.thirdPersonVisible, 'should show the rider from outside');
check(log.includes(`equip-${CONFIG.weapons.handsIndex}`) && log.includes('cyborg-reset'), 'should empty the hands of the rider and turn the body to the new heading');
check(camera.far === CONFIG.ski.camera.far && hud.active === true && hud.dev === null, 'should see further, show the mountain HUD, and show no developer line');
check(renderer.shadowMap.needsUpdate === true && world.sun.target.position.distanceTo(player.pos) < CONFIG.ski.shadow.step, 'should aim the shadows at the rider');

skiRun.applyCamera(1, 1 / 60);
check(camera.position.z > player.pos.z && camera.position.y > course.heightfield.heightAt(camera.position.x, camera.position.z), 'should place the camera behind the rider and above the snow');
const before = camera.position.clone();
skiRun.look(250, 0);
skiRun.applyCamera(1, 1 / 60);
check(camera.position.distanceTo(before) > 0.01, 'should orbit the camera when the player looks around');

// developer markers
step({ selectSlot: 2 });
check(player.pos.z === course.start.z, 'should ignore the marker keys when developer mode is off');
skiRun.setDevMode(true);
check(hud.dev.includes('1 START') && hud.dev.includes(`${course.markers.length} ${course.markers.at(-1).name}`), 'should list the marker keys when developer mode is on');
renderer.shadowMap.needsUpdate = false;
step({ selectSlot: 2 });
check(player.pos.z === course.markers[2].z && player.prevPos.equals(player.pos), 'should jump the rider to a marker when its key is pressed in developer mode');
check(renderer.shadowMap.needsUpdate === true, 'should draw the shadows again where the rider landed');
step({ selectSlot: 9 });
check(Math.abs(player.pos.z - course.markers[2].z) < 1, 'should not jump anywhere when the key has no marker');
renderer.shadowMap.needsUpdate = false;
skiRun.update(1 / 60);
check(renderer.shadowMap.needsUpdate === false, 'should not draw the shadows again when the rider did not move');
step();

// --- riding ---
skiRun.start({ course: 'freeride', ride: 'board' });
check(skiRun.rideId === 'board' && cyborg.poser !== null && cyborg.root.children.length === 1, 'should give the body to the rider and put the chosen ride under it when a run starts');
const gate = skiRun.course.start;
for (let i = 0; i < 120; i++) step();
check(player.pos.z === gate.z && skiRun.time === 0 && skiRun.started === false, 'should wait at the start gate, with the clock at zero, until the rider pushes off');
for (let i = 0; i < 240; i++) step({ forward: true });
check(player.pos.z < gate.z - 5 && player.vel.length() > 3 && skiRun.started, 'should push off down the course when forward is held');
check(player.pos.equals(skiRun.rider.pos) && player.yaw === skiRun.rider.heading && player.vel.equals(skiRun.rider.vel), 'should move the game\'s player with the rider');
check(Math.abs(skiRun.time - 4) < 0.2, `should run the clock from the moment the rider moves (${skiRun.time.toFixed(2)} s)`);
skiRun.update(1 / 60);
check(hud.speed === skiRun.rider.speed && hud.time === skiRun.time, 'should show the speed and the time');
check(hud.edge === 'HEELSIDE', 'should name the edge of a board that has not turned yet as heelside');
for (let i = 0; i < 40; i++) step({ right: true });
skiRun.update(1 / 60);
check(hud.edge === 'TOESIDE', 'should name the edge toeside when a regular-stance board carves to the right');
for (let i = 0; i < 60; i++) step({ left: true });
skiRun.update(1 / 60);
check(hud.edge === 'HEELSIDE', 'should name the edge heelside when it carves to the left, also at low speed');
const headingBefore = skiRun.rider.heading;
for (let i = 0; i < 30; i++) step({ right: true });
check(skiRun.rider.heading < headingBefore, 'should carve to the right when right is held');
for (let i = 0; i < 30; i++) step({ analogActive: true, analogX: -1, analogY: 0 });
check(skiRun.rider.controls.steer === -1 && skiRun.rider.controls.tuck === 0, 'should steer with the move stick');
step({ analogActive: true, analogX: 0, analogY: -1 });
check(skiRun.rider.controls.tuck === 1 && skiRun.rider.controls.brake === 0, 'should tuck when the stick is pushed forward');
step({ analogActive: true, analogX: 0, analogY: 1 });
check(skiRun.rider.controls.brake === 1 && skiRun.rider.controls.tuck === 0, 'should brake when the stick is pulled back');
skiRun.applyCamera(1, 1 / 60);
check(camera.position.distanceTo(player.pos) < CONFIG.ski.camera.distance * 3, 'should keep the camera with the moving rider');

// the edge names on skis
skiRun.start({ ride: 'skis' });
for (let i = 0; i < 240; i++) step({ forward: true });
for (let i = 0; i < 40; i++) step({ right: true });
skiRun.update(1 / 60);
check(hud.edge === 'RIGHT EDGE', 'should name the edges of skis left and right');
skiRun.start({ ride: 'board' });
for (let i = 0; i < 240; i++) step({ forward: true });

// --- pop and tricks (docs/adr/0012) ---
await skiRun.physicsReady;
skiRun.start({ ride: 'board' });
const flatSpot = { x: 0, z: skiRun.course.heightfield.maxZ - 1283 }; // the flat just above the finish line
skiRun.rider.reset(flatSpot, 0);
for (let i = 0; i < 40; i++) step({ jumpHeld: true });
check(skiRun.rider.grounded && skiRun.rider.popCharge === 1, 'should charge a pop while jump is held');
step();
check(!skiRun.rider.grounded, 'should pop when jump is released');
const cameraYaw = skiRun.chase.yawOffset;
skiRun.look(300, 0);
check(skiRun.chase.yawOffset === cameraYaw, 'should not orbit the camera with the mouse in the air');
step();
check(skiRun.rider.spinRate < -3, 'should spin to the right from a flick of the mouse to the right in the air');
step({ sprintHeld: true, forward: true });
check(skiRun.rider.controls.grab === 'indy' && skiRun.rider.flipRate === 0, 'should grab with sprint and a direction in the air, and not flip from that direction');
step({ sprintHeld: true, right: true });
check(skiRun.rider.controls.grab === 'tail', 'should pick the grab from the direction');
step({ sprintHeld: true });
check(skiRun.rider.controls.grab === null, 'should grab nothing with no direction');
// a full spin with a grab, timed to the air a full pop gives
skiRun.rider.reset(flatSpot, 0);
for (let i = 0; i < 40; i++) step({ jumpHeld: true });
step();
const airTime = (2 * skiRun.rider.vel.y) / CONFIG.ski.rider.gravity;
let trickLanding = null;
for (let i = 0; i < 200 && !trickLanding; i++) { skiRun.rider.spinRate = -(2 * Math.PI) / airTime; step({ sprintHeld: true, back: true }); trickLanding = skiRun.rider.landed; }
check(trickLanding && !trickLanding.crash && skiRun.crash === null, 'should land a full spin with a grab');
check(/360 MUTE {2}\+\d+/.test(hud.trick) && skiRun.style > 0 && hud.style === skiRun.style, `should name the landed trick and add its style points (${hud.trick})`);
skiRun.update(CONFIG.ski.tricks.bannerTime + 0.1);
check(hud.trick === null, 'should take the trick name down after a moment');
skiRun.look(300, 0);
check(skiRun.chase.yawOffset !== cameraYaw, 'should orbit the camera with the mouse again on the snow');
// a landing on the head
skiRun.rider.reset(flatSpot, 0);
const styleBefore = skiRun.style;
for (let i = 0; i < 40; i++) step({ jumpHeld: true });
step();
for (let i = 0; i < 200 && !skiRun.crash && !skiRun.rider.landed; i++) { skiRun.rider.flipRate = Math.PI / airTime; step(); }
check(skiRun.crash !== null && skiRun.body.down && skiRun.style === styleBefore, 'should crash, with no points, when the rider lands on the head');
step({ reloadPressed: true });
check(skiRun.style === 0 && hud.style === 0, 'should start the style points again with a new run');

// --- the gravity load and the stomp (docs/adr/0013) ---
const LIMIT = CONFIG.ski.landing.crashLimit;
/** Put the rider in the air `height` metres above the flat, falling, and step until it lands or crashes. `each(step number)` gives the input. */
const dropFrom = (height, each = () => ({})) => {
  skiRun.rider.reset(flatSpot, 0);
  step({ jumpHeld: true });
  step(); // a tap: the rider is in the air
  skiRun.rider.pos.y += height;
  skiRun.rider.vel.y = 0;
  let landing = null;
  for (let i = 0; i < 400 && !landing && !skiRun.crash; i++) { step(each(skiRun.rider)); landing = skiRun.rider.landed; }
  return landing;
};
const secondsToSnow = (rider) => { const gap = rider.pos.y - skiRun.course.heightfield.heightAt(rider.pos.x, rider.pos.z); const g = CONFIG.ski.rider.gravity; return (rider.vel.y + Math.sqrt(rider.vel.y ** 2 + 2 * g * gap)) / g; };
let pressed = false;
const stompLate = (rider) => { const press = !pressed && secondsToSnow(rider) < CONFIG.ski.landing.stompWindow * 0.6; pressed ||= press; return { jumpPressed: press, jumpHeld: press }; };

dropFrom(1);
check(skiRun.crash === null && hud.trick === null, 'should land a small drop with no words');
dropFrom(LIMIT * 0.6, () => { skiRun.update(1 / 60); return {}; });
skiRun.update(1 / 60);
check(hud.load === null && hud.stomp === false, 'should hide the gravity bar on the snow');
skiRun.rider.reset(flatSpot, 0);
step({ jumpHeld: true });
step();
skiRun.rider.pos.y += LIMIT * 0.5;
step();
skiRun.update(1 / 60);
check(hud.load > 0.4 && hud.load < 0.7, `should show the gravity load in the air, as a share of the limit (${hud.load?.toFixed(2)})`);
step({ jumpPressed: true, jumpHeld: true });
skiRun.update(1 / 60);
check(hud.stomp === true, 'should show that the stomp was used');
dropFrom(LIMIT * 0.85);
check(skiRun.crash === null && hud.trick === 'SKETCHY', 'should call a drop near the limit sketchy');
const SPEED_IN = 10; // m/s along the flat before the drop
skiRun.rider.reset(flatSpot, 0);
skiRun.rider.vel.set(0, 0, -SPEED_IN);
step({ jumpHeld: true });
step();
skiRun.rider.pos.y += LIMIT * 0.85;
for (let i = 0; i < 400 && !skiRun.rider.landed; i++) step();
check(Math.hypot(skiRun.rider.vel.x, skiRun.rider.vel.z) < SPEED_IN * 0.75, 'should lose speed in a sketchy landing');
dropFrom(LIMIT + 1);
check(skiRun.crash !== null && skiRun.body.down, 'should crash a drop over the limit when there is no stomp');
step({ reloadPressed: true });
pressed = false;
dropFrom(LIMIT + 1, stompLate);
check(skiRun.crash === null && hud.trick === 'STOMPED', `should survive the same drop with a stomp just before the snow (${hud.trick})`);
pressed = false;
dropFrom(LIMIT + 1, () => { const press = !pressed; pressed = true; return { jumpPressed: press, jumpHeld: press }; });
check(skiRun.crash !== null, 'should crash when the stomp was pressed too early');
step({ reloadPressed: true });
const tooBig = LIMIT + CONFIG.ski.landing.stompAbsorb + 1.5;
pressed = false;
dropFrom(tooBig, stompLate);
check(skiRun.crash !== null, 'should crash a drop that is too big for a stomp alone');
step({ reloadPressed: true });
pressed = false;
const fall = Math.sqrt((2 * tooBig) / CONFIG.ski.rider.gravity);
dropFrom(tooBig, (rider) => { rider.flipRate = (2 * Math.PI) / (fall + 0.02); rider.spinRate = 0; return { ...stompLate(rider), sprintHeld: true, forward: true }; });
check(skiRun.crash === null && /^STOMPED {2}BACKFLIP INDY {2}\+\d+$/.test(hud.trick), `should survive that drop when the stomp comes after a flip with a grab (${hud.trick})`);
const stompedPoints = skiRun.style;
check(stompedPoints > CONFIG.ski.tricks.pointsPerFlip * (1 + CONFIG.ski.landing.stompedBonus), 'should give more style points for a stomped trick');
step({ reloadPressed: true });

// --- a crash (docs/adr/0009) ---
await skiRun.physicsReady;
skiRun.start({ ride: 'skis' });
const crashCourse = skiRun.course;
const openBowl = (course) => ({ x: 40, z: course.heightfield.maxZ - 130 }); // an even slope with no lip below it
skiRun.rider.reset(openBowl(crashCourse), 0);
for (let i = 0; i < 200; i++) step({ forward: true });
for (let i = 0; i < 25; i++) step({ right: true });
const speedBefore = skiRun.rider.speed;
check(speedBefore > CONFIG.ski.rider.catchMinSpeed && skiRun.crash === null, 'should ride the steeps without a crash');
for (let i = 0; i < 6; i++) step({ back: true });
skiRun.update(1 / 60);
check(hud.alert === null, 'should give no warning in a clean brake');
let crashedAfter = null;
for (let i = 0; i < 40 && crashedAfter === null; i++) { step({ back: true, left: true }); if (skiRun.crash) crashedAfter = i; }
check(crashedAfter !== null && skiRun.body.down, 'should crash, with the body in the physics world, when the other edge is set during a brake');
skiRun.update(1 / 60);
check(hud.alert === 'CRASH', 'should show the crash');
check(cyborg.root.children[0].children.length === 0 && skiRun.scene.group.children.filter((child) => skiRun.body.loose.some((loose) => loose.model === child)).length === 4, 'should take both skis and both poles off the rider in a crash');
const clockAtCrash = skiRun.time;
const fellAt = player.pos.clone();
for (let i = 0; i < 30; i++) step({ forward: true, right: true });
cyborg.poser(cyborg, 1 / 60, 1);
check(player.pos.distanceTo(fellAt) > 1 && Math.abs(player.pos.y - crashCourse.heightfield.heightAt(player.pos.x, player.pos.z)) < 1e-6, 'should carry the game\'s player along the snow with the tumbling body');
check(cyborg.group.position.distanceTo(player.pos) < 1.5 && cyborg.root.quaternion.w === 1, 'should draw the body where the physics has it');
check(skiRun.time > clockAtCrash, 'should let the clock run during a crash');
skiRun.applyCamera(1, 1 / 60);
check(camera.position.distanceTo(player.pos) < CONFIG.ski.camera.distance * 3, 'should keep the camera on the fallen rider');
let downSteps = 30;
while (skiRun.crash && downSteps < 60 * (CONFIG.ski.crash.maxTime + 1)) { step(); downSteps++; }
check(skiRun.crash === null && downSteps / 60 >= CONFIG.ski.crash.minTime && downSteps / 60 <= CONFIG.ski.crash.maxTime + 0.1, `should get the rider up between the shortest and the longest time down (${(downSteps / 60).toFixed(1)} s)`);
check(!skiRun.body.down && skiRun.rider.speed === 0 && skiRun.rider.pos.distanceTo(player.pos) < 1e-6 && cyborg.root.children[0].children.length === 4, 'should stand the rider up at rest where the body stopped, with skis and poles back');
skiRun.update(1 / 60);
check(hud.alert === null && skiRun.rider.pos.z < fellAt.z, 'should clear the warning, further down the hill than the crash');

// a board stays on
skiRun.start({ ride: 'board' });
skiRun.rider.reset(openBowl(skiRun.course), 0);
for (let i = 0; i < 200; i++) step({ forward: true });
for (let i = 0; i < 25; i++) step({ right: true });
for (let i = 0; i < 60 && !skiRun.crash; i++) step({ back: true, left: i > 5 });
check(skiRun.body.down && skiRun.body.loose.length === 1, 'should keep the board as one thing in a crash');
for (let i = 0; i < 45; i++) step();
cyborg.poser(cyborg, 1 / 60, 1);
const boardModel = skiRun.body.loose[0].model;
const ankles = ['Left', 'Right'].map((side) => skiRun.body.ragdoll.ankleWorld(side, new THREE.Vector3()));
check(ankles.every((ankle) => ankle.distanceTo(boardModel.position) < 0.6), 'should keep both ankles on the board while the body tumbles');
step({ reloadPressed: true });
check(skiRun.crash === null && !skiRun.body.down && player.pos.z === skiRun.course.start.z && hud.alert === null, 'should end the crash when "start again" is pressed');

// without the physics library
const bareRun = new SkiRun({
  config: CONFIG.ski, playerConfig: CONFIG.player, handsIndex: CONFIG.weapons.handsIndex, menuLevel: 'waves',
  world, player, camera, renderer, skiHud: hud, cyborg, weapons: { equipNow: () => {} },
  loadPhysics: () => Promise.reject(new Error('offline')),
});
const realError = console.error;
let reported = '';
console.error = (message) => { reported = message; };
await bareRun.physicsReady;
console.error = realError;
check(/physics library did not load/.test(reported), 'should say so when the physics library cannot load');
skiRun.stop();
bareRun.start({ ride: 'skis' });
const bareStep = (overrides = {}) => bareRun.fixedUpdate(1 / 60, { ...input, ...overrides });
bareRun.rider.reset(openBowl(bareRun.course), 0);
for (let i = 0; i < 200; i++) bareStep({ forward: true });
for (let i = 0; i < 25; i++) bareStep({ right: true });
for (let i = 0; i < 60 && !bareRun.crash; i++) bareStep({ back: true, left: i > 5 });
const stoppedAt = bareRun.rider.pos.clone();
check(bareRun.crash !== null && !bareRun.body.down, 'should still crash, with no ragdoll, when there is no physics library');
for (let i = 0; i < 60 * CONFIG.ski.crash.minTime + 5; i++) bareStep({ forward: true });
check(bareRun.crash === null && bareRun.rider.pos.distanceTo(stoppedAt) < 1, 'should then get the rider up where it crashed');
bareRun.stop();
skiRun.start({ ride: 'board' });
for (let i = 0; i < 240; i++) step({ forward: true });

// the finish
skiRun.rider.reset({ x: 0, z: skiRun.course.finish.z + 0.5 }, 0); // on the snow, just above the finish line
skiRun.rider.vel.set(0, 0, -10);
const clock = skiRun.time;
for (let i = 0; i < 30; i++) step({ forward: true });
check(skiRun.finished && hud.finish !== null && Math.abs(hud.finish - clock) < 0.2, 'should stop the clock and show the time when the rider crosses the finish');
for (let i = 0; i < 300; i++) step({ forward: true });
check(skiRun.time === hud.finish && skiRun.rider.speed < 0.5, 'should brake the rider to a stop after the finish, whatever is held');

// start again
step({ reloadPressed: true });
check(player.pos.z === gate.z && skiRun.time === 0 && !skiRun.finished && !skiRun.started && hud.finish === null && player.vel.length() === 0, 'should put the rider back at the start gate, with a new clock, when "start again" is pressed');
let badRide = false;
try { skiRun.start({ ride: 'sled' }); } catch (error) { badRide = /no ride "sled"/.test(error.message); }
check(badRide, 'should refuse a ride that does not exist');

// restart, then leave
skiRun.start(null);
check(skiRun.course !== course && skiRun.courseId === 'freeride' && skiRun.rideId === 'board' && player.pos.z === skiRun.course.start.z, 'should build the last course again, with the last ride, when a run restarts without a choice');
check(cyborg.root.children.length === 1, 'should leave one ride under the body after a restart');
skiRun.stop();
check(skiRun.active === false && player.thirdPerson === false && camera.far === 320 && hud.active === false, 'should give back the view, the draw distance and the combat HUD when the run stops');
check(cyborg.poser === null && cyborg.root.children.length === 0, 'should give the body back to the game and take the ride away when the run stops');
check(world.group.children.length > 0 && player.pos.y === 0 && world.sun.target.position.length() === 0, 'should put the arena and the player back when the run stops');
skiRun.stop();
check(skiRun.active === false, 'should do nothing when it is stopped twice');
let refused = false;
try { skiRun.start({ course: 'nowhere' }); } catch (error) { refused = /no course "nowhere"/.test(error.message); }
check(refused && skiRun.active === false, 'should refuse a course that does not exist');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
