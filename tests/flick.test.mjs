/*
 * Flick forgiveness: the faster the view is turning when you shoot, the bigger the hit volumes get,
 * so a quickscope that lands just beside a target still counts. Tuned in CONFIG.weapons.flick.
 */
import { load, loadConfig, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { createEffects } = await load('effects');
const { World } = await load('world');
const { Player } = await load('player');
const { Enemies, raySphere } = await load('enemies');
const { Weapons } = await load('weapons');
const { Targets } = await load('targets');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const noop = () => {};

// --- raySphere: the boost multiplies the distance-based growth ---
const origin = new THREE.Vector3(0, 0, 0);
const forward = new THREE.Vector3(0, 0, -1);
const missBy = (offset, boost) => raySphere(origin, forward, offset, 0, -20, 0.36, boost) >= 0;
check(missBy(0.47, 0) && !missBy(0.5, 0), 'without a boost a sphere grows by 0.006 m per metre (0.12 m at 20 m)');
check(missBy(0.59, 1) && !missBy(0.63, 1), 'a boost of 1 doubles that growth (0.24 m at 20 m)');
check(missBy(0.3, 0.5) && raySphere(origin, forward, 0.3, 0, -20, 0.36) >= 0, 'the boost defaults to none');

const CONFIG = await loadConfig();
const flick = CONFIG.weapons.flick;
check(flick && ['minSpeed', 'fullSpeed', 'maxBoost', 'maxExtraRadius', 'hipShare', 'memory'].every((key) => typeof flick[key] === 'number'), 'every flick tuning number is in the weapons config');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 200);
const fx = createEffects(scene);
const world = new World(scene, CONFIG);
const player = new Player(camera, world, CONFIG.player);
const hud = new Proxy({}, { get: () => noop });
const audio = new Proxy({}, { get: () => noop });
const enemies = new Enemies({ cfg: CONFIG, scene, world, fx, player });
const weapons = new Weapons({ cfg: CONFIG, camera, mainScene: scene, envMap: null, world, enemies, player, fx, hud, audio });
weapons.enemies = new Targets({ enemies, remotes: { list: [], raycast: () => null } });

const input = { forward: 0, back: 0, left: 0, right: 0, sprintHeld: 0, fireHeld: 0, jumpPressed: 0, slidePressed: 0, sprintPressed: 0, firePressed: 0, reloadPressed: 0, meleePressed: 0, ammoPressed: 0, selectSlot: -1, wheel: 0, aimHeld: 0, crouchHeld: 0, leanLeft: 0, leanRight: 0 };
const dt = 1 / 60;
const step = () => { player.update(dt, input); weapons.update(dt, input); input.firePressed = 0; };
const sniper = CONFIG.weapons.list.findIndex((item) => item.id === 'sniper');
const sensitivity = CONFIG.player.mouseSensitivity;

/** Standing in the clear lane x = -20 aiming at a bot's chest 20 m away, with the bot `offset` metres to the side. */
function setup(offset, ads) {
  enemies.clear();
  player.reset(); player.pos.set(-20, 0, 22); player.prevPos.copy(player.pos); player.yaw = 0; player.pitch = -Math.atan(0.45 / 20); player.invulnerable = true;
  weapons.reset(); weapons.select(sniper);
  weapons.slots[sniper].cfg.spread = 0; // shots go exactly where aimed, so a hit or miss comes only from the hit volumes
  for (let i = 0; i < 40; i++) step();
  weapons.adsBlend = ads ? 1 : 0;
  const bot = enemies._spawnAt('cable', -20 + offset, 2, 1);
  bot.boot = 0; bot.attackCd = 99; bot.speed = 0; bot.hp = 1e6;
  return bot;
}
/** Turn the view back and forth at `rate` rad/s for six steps, ending exactly where it started. */
function wiggle(rate) {
  const dx = (rate * dt) / sensitivity; // zoom scale is 1 at the hip
  const yaw = player.yaw;
  for (let i = 0; i < 6; i++) { player.look(i < 3 ? dx : -dx, 0); step(); }
  return Math.abs(player.yaw - yaw) < 1e-9;
}
const shootAndCheck = (bot) => { const hp = bot.hp; input.firePressed = 1; step(); return bot.hp < hp; };

// --- the player measures how fast the view turns ---
player.reset();
for (let i = 0; i < 12; i++) { player.look(10, 0); player.update(dt, input); }
const expected = (10 * sensitivity) / dt;
check(Math.abs(player.viewTurnRate - expected) < expected * 0.02, `the turn rate is radians turned per second (${player.viewTurnRate.toFixed(2)} vs ${expected.toFixed(2)})`);
for (let i = 0; i < 12; i++) player.update(dt, input);
check(player.viewTurnRate === 0, 'and falls to zero when the view stops');
player.look(10, 0); player.update(dt, input); const burst = player.viewTurnRate;
player.look(10, 0); player.update(dt, input); player.look(10, 0); player.update(dt, input); player.update(dt, input);
check(burst > 0 && player.viewTurnRate > 0, 'a window of recent steps is averaged (a gap between redraws does not zero it)');
player.reset(); player.addRecoil(0.05, 0.05, 0.01); for (let i = 0; i < 6; i++) player.update(dt, input);
check(player.viewTurnRate === 0, 'recoil is not counted as the player turning');

// --- shots just beside a bot ---
const OFFSET = 0.57; // beyond the normal chest hit volume (0.36 + 0.12 at 20 m), inside the flick bonus
let bot = setup(OFFSET, true);
check(!shootAndCheck(bot), 'with the view still, a shot 0.57 m beside the chest misses');

bot = setup(OFFSET, true);
check(wiggle(10), 'the test flick returns the aim to where it started');
check(weapons.flickSpeed >= 9, `a flick of 10 rad/s is remembered (${weapons.flickSpeed.toFixed(1)})`);
check(shootAndCheck(bot), 'the same shot right after a fast flick on the sights hits');

bot = setup(OFFSET, false);
wiggle(10);
check(!shootAndCheck(bot), 'without the sights up only a share of the bonus applies, so it still misses');

bot = setup(OFFSET, true);
wiggle(1);
check(!shootAndCheck(bot), 'a slow turn (below minSpeed) adds nothing');

bot = setup(OFFSET, true);
wiggle(10);
for (let i = 0; i < 30; i++) step();
check(weapons.flickSpeed < flick.minSpeed && !shootAndCheck(bot), 'half a second later the flick is forgotten');

bot = setup(0.72, true);
wiggle(10);
check(!shootAndCheck(bot), 'the bonus is limited: a shot well wide still misses');

// --- the numbers are tuneable and read live ---
const saved = { ...flick };
weapons.cfg.flick.maxBoost = 0; weapons.cfg.flick.maxExtraRadius = 0;
bot = setup(OFFSET, true); wiggle(10);
check(!shootAndCheck(bot), 'with the bonus set to zero a flick changes nothing');
weapons.cfg.flick.maxBoost = 3; weapons.cfg.flick.maxExtraRadius = 0.2;
bot = setup(0.95, true); wiggle(10);
check(shootAndCheck(bot), 'a bigger bonus forgives a bigger miss');
Object.assign(weapons.cfg.flick, saved);
const half = weapons.cfg.flick.fullSpeed / 2 + weapons.cfg.flick.minSpeed / 2;
weapons.flickSpeed = half; weapons.adsBlend = 1;
const middle = weapons.flickForgiveness();
weapons.flickSpeed = weapons.cfg.flick.fullSpeed;
const full = weapons.flickForgiveness();
check(middle.boost > 0 && middle.boost < full.boost && Math.abs(full.boost - saved.maxBoost) < 1e-9 && Math.abs(full.extra - saved.maxExtraRadius) < 1e-9, 'the bonus ramps up smoothly to its maximum');
weapons.adsBlend = 0;
check(Math.abs(weapons.flickForgiveness().boost - saved.maxBoost * saved.hipShare) < 1e-9, 'at the hip the bonus is hipShare of the maximum');
delete weapons.cfg.flick;
check(weapons.flickForgiveness().boost === 0 && weapons.flickForgiveness().extra === 0, 'with no flick section there is no bonus');
weapons.cfg.flick = saved;

// --- the boost reaches bots and players through the target list ---
const seen = [];
const spy = new Targets({
  enemies: { raycast: (...args) => { seen.push(['bot', ...args.slice(3)]); return null; }, aimThreat: false },
  remotes: { list: [{}], raycast: (...args) => { seen.push(['player', ...args.slice(3)]); return null; } },
});
spy.raycast(origin, forward, 50, 0.1, 0.8);
check(JSON.stringify(seen) === JSON.stringify([['bot', 0.1, 0.8], ['player', 0.1, 0.8]]), 'the target list passes the boost to both bots and remote players');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
