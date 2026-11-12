/*
 * Suit movement: the baseline slowdown and input delay, part stats adding to it,
 * and the player honouring both.
 */
import { load, loadConfig, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { World } = await load('world');
const { Player } = await load('player');
const { aggregateSuitStats } = await load('suit-stats');
const { SUIT_PARTS, defaultSelection } = await load('suit-parts');
const { suitBodyOverrides } = await load('suit-body');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };

const CONFIG = await loadConfig();
const baseline = CONFIG.suit.baseline;
const selection = defaultSelection();

const plain = aggregateSuitStats(selection, baseline);
check(plain.speedMul === baseline.speedMul && plain.jumpDelay === baseline.jumpDelay && plain.slideDelay === baseline.slideDelay, 'parts with no stats leave the baseline as it is');
check(baseline.speedMul < 1 && baseline.jumpDelay > 0 && baseline.slideDelay > 0, 'the baseline is slower and has a delay on jump and slide');

const head = SUIT_PARTS.head[0];
head.stats = { speedMul: 0.1, jumpDelay: -0.05 };
const boosted = aggregateSuitStats(selection, baseline);
head.stats = {};
check(Math.abs(boosted.speedMul - (baseline.speedMul + 0.1)) < 1e-9, 'a part stat adds to the speed');
check(Math.abs(boosted.jumpDelay - (baseline.jumpDelay - 0.05)) < 1e-9, 'a part stat can shorten the jump delay');
head.stats = { speedMul: -5, jumpDelay: -5 };
const clamped = aggregateSuitStats(selection, baseline);
head.stats = {};
check(clamped.speedMul > 0 && clamped.jumpDelay === 0, 'stats can never make the suit stand still or jump before the press');

const overrides = suitBodyOverrides(CONFIG.player, CONFIG.suit.scale);
check(Math.abs(overrides.radius - CONFIG.player.radius * CONFIG.suit.scale) < 1e-9 && overrides.eyeHeight > CONFIG.player.eyeHeight, 'the suit body is bigger than the human one');

// ---- the player ----
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 200);
const world = new World(scene, CONFIG);
const dt = 1 / 60;
const idle = () => ({ forward: false, back: false, left: false, right: false, sprintHeld: false, jumpPressed: false, slidePressed: false, sprintPressed: false, crouchHeld: false, aimHeld: false, leanLeft: false, leanRight: false, analogActive: false });

function makePlayer(mods) {
  const player = new Player(camera, world, CONFIG.player);
  player.setBody(null, mods);
  return player;
}
function topSpeed(player) {
  const input = { ...idle(), forward: true };
  for (let i = 0; i < 20; i++) player.update(dt, input); // long enough to reach full speed, short enough not to hit a wall
  return player.speed;
}

const human = topSpeed(makePlayer(null));
const suit = topSpeed(makePlayer({ ...plain }));
check(Math.abs(suit / human - plain.speedMul) < 0.02, `walking is ${plain.speedMul} times as fast in the suit (${suit.toFixed(2)} vs ${human.toFixed(2)})`);

function stepsUntilAirborne(player) {
  for (let i = 0; i < 10; i++) player.update(dt, idle()); // settle on the ground
  const press = { ...idle(), jumpPressed: true };
  player.update(dt, press);
  for (let steps = 1; steps < 120; steps++) {
    if (player.vel.y > 1) return steps;
    player.update(dt, idle());
  }
  return Infinity;
}
const humanJump = stepsUntilAirborne(makePlayer(null));
const suitJump = stepsUntilAirborne(makePlayer({ ...plain }));
const expectedExtra = Math.round(plain.jumpDelay / dt);
check(humanJump <= 2, 'a human jumps on the press');
check(Math.abs(suitJump - humanJump - expectedExtra) <= 1, `the suit jumps ${suitJump - humanJump} steps later (about ${expectedExtra})`);

const slider = makePlayer({ ...plain });
const sprint = { ...idle(), forward: true, sprintHeld: true };
for (let i = 0; i < 60; i++) slider.update(dt, sprint);
slider.update(dt, { ...sprint, slidePressed: true });
check(!slider.sliding, 'the slide does not start on the press');
let slideSteps = 0;
while (!slider.sliding && slideSteps < 60) { slider.update(dt, sprint); slideSteps++; }
check(slider.sliding && Math.abs(slideSteps - Math.round(plain.slideDelay / dt)) <= 2, `the slide starts after the delay (${slideSteps} steps)`);

const reset = makePlayer({ ...plain });
reset.setBody(null);
check(reset.movementMods === null && reset.cfg === CONFIG.player, 'setBody(null) gives back the plain body');

process.exit(fails ? 1 : 0);
