/*
 * Bots with pistols: they raise the gun and shoot from a distance, walls stop their shots, and they use cover on their
 * own: run behind a tall box, crouch out of sight, stand to fire a burst, duck again, duck when hit or aimed at, and
 * move when flanked. Bots without pistols (and bots too close to shoot) still use their fists.
 */
import { load, loadConfig, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { World } = await load('world');
const { Player } = await load('player');
const { Enemies } = await load('enemies');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const noop = () => {};

const dt = 1 / 60;
const COVER = { x: 20, z: -14, top: 2.5 };
const ARRIVE_TEST = 0.6; // a tall box: x 18.75..21.25, z -15.25..-12.75

/** A fresh world with one player, a log of tracers and shots, and bots that shoot without error and always know where to hold. */
async function setup(tune = () => {}) {
  const CONFIG = await loadConfig();
  Object.assign(CONFIG.enemies.gun, { spread: 0, burst: [3, 3], aimTime: 0.3, holdDistance: [10, 10], coverSeekRate: 0, burstPause: [0.8, 0.8], interval: 0.2, peekTime: [3, 3], peeks: [2, 2], duckChance: 1 });
  tune(CONFIG);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 200);
  const world = new World(scene, CONFIG);
  const player = new Player(camera, world, CONFIG.player);
  const log = { tracers: [], shots: [] };
  const fx = {
    tracers: { spawn: (from, to) => log.tracers.push({ from: from.clone(), to: to.clone() }) },
    particles: { burst: noop, debris: noop, smoke: noop },
    bubbles: { spawn: noop },
  };
  const audio = { shootAt: (id, distance) => log.shots.push({ id, distance }) };
  const enemies = new Enemies({ cfg: CONFIG, scene, world, fx, player, audio });
  player.reset();
  player.invulnerable = false;
  const run = (seconds, each = noop) => { for (let i = 0; i < Math.ceil(seconds / dt); i++) { enemies.update(dt); each(i * dt); } };
  const spawn = (type, x, z) => {
    const bot = enemies._spawnAt(type, x, z, 1);
    bot.boot = 0;
    return bot;
  };
  const stand = (x, z) => { player.pos.set(x, 0, z); player.prevPos.copy(player.pos); };
  return { CONFIG, world, player, enemies, log, run, spawn, stand };
}

// ---- who has a pistol ----
{
  const { CONFIG, enemies, spawn, stand } = await setup();
  const types = CONFIG.enemies.types;
  check(['cable', 'technician', 'lineman', 'splicer', 'foreman', 'coneHead'].every((key) => types[key].gun), 'most bots carry a pistol');
  check(!types.router.gun && !types.jackhammer.gun, 'routers and jackhammers fight with their fists');
  stand(0, 0);
  const armed = spawn('cable', 0, -20);
  const bare = spawn('router', 5, -20);
  check(armed.gun && armed.gun.damage === CONFIG.enemies.gun.damage, 'a pistol bot has the shared pistol');
  check(spawn('technician', 9, -20).gun.damage === types.technician.gun.damage && types.technician.gun.damage !== CONFIG.enemies.gun.damage, 'and a type\'s own changes apply to it');
  check(bare.gun === null, 'a bot without one has none');
  const extras = (bot) => bot.arms.find((arm) => arm.side === 1).elbow.children.length;
  check(extras(armed) > extras(bare), 'a pistol is drawn in the right hand');
  check(enemies.alive.every((bot) => bot.root.visible), 'and they are all on the field');
}

// ---- shooting from the open ----
{
  const { CONFIG, player, log, run, spawn, stand } = await setup();
  stand(6, 0);
  const bot = spawn('cable', 6, -22);
  const gun = bot.gun;
  let firstShotAt = null;
  let closest = Infinity;
  let aimedBeforeFiring = false;
  run(9, (t) => {
    closest = Math.min(closest, Math.hypot(bot.pos.x - 6, bot.pos.z));
    if (firstShotAt === null && log.tracers.length > 0) { firstShotAt = t; aimedBeforeFiring = bot.aimT >= gun.aimTime; }
  });
  check(log.tracers.length >= 6, `it shoots (${log.tracers.length} shots)`);
  check(closest > gun.minRange + 2 && closest <= bot.holdDist + 0.5, `it stops closing in and shoots from a distance (${closest.toFixed(1)} m)`);
  check(aimedBeforeFiring, 'it has the gun up before the first shot');
  check(player.health < CONFIG.player.maxHealth && (CONFIG.player.maxHealth - player.health) % gun.damage === 0, `shots hit for ${gun.damage} each (health ${player.health})`);
  check(log.shots.length === log.tracers.length && log.shots.every((shot) => shot.id === 'pistol'), 'each shot is heard');
  check(log.tracers.every((tracer) => Math.abs(tracer.from.y - (bot.pos.y + 1.28 * bot.def.scale)) < 0.6), 'from the height of its raised hand');
  check(bot.shooting, 'it is in its shooting stance');
}

// ---- timing: a burst, then a pause ----
{
  const { log, run, spawn, stand } = await setup();
  stand(6, 0);
  const bot = spawn('cable', 6, -9); // already in range
  const times = [];
  let seen = 0;
  run(6, (t) => { while (seen < log.tracers.length) { times.push(t); seen++; } });
  const gaps = times.slice(1).map((time, i) => time - times[i]);
  check(times.length >= 6 && gaps.some((gap) => gap > 0.7) && gaps.some((gap) => gap < 0.3), `shots come in bursts with pauses between (${gaps.map((gap) => gap.toFixed(2)).join(' ')})`);
  check(bot.alive !== false, 'and it is still a bot');
}

// ---- it misses, and walls stop its shots ----
{
  const { CONFIG, player, enemies, spawn, stand } = await setup((config) => { config.enemies.gun.spread = 0.06; });
  stand(6, 0);
  const bot = spawn('cable', 6, -12);
  let hits = 0;
  for (let i = 0; i < 200; i++) { const before = player.health; player.health = CONFIG.player.maxHealth; enemies._fire(bot); if (player.health < CONFIG.player.maxHealth) hits++; void before; }
  check(hits > 0 && hits < 100, `a wild shot often misses (${hits} of 200 hit)`);
}
{
  const { CONFIG, player, enemies, log, spawn, stand } = await setup();
  stand(COVER.x, 0);
  const bot = spawn('cable', COVER.x, COVER.z - 3.5); // behind the tall box
  bot.crouch = 0;
  log.tracers.length = 0;
  enemies._fire(bot);
  check(player.health === CONFIG.player.maxHealth, 'a shot at someone on the other side of a wall does no harm');
  const end = log.tracers[0].to;
  check(Math.abs(end.z - (COVER.z - 1.25)) < 0.5, `it stops at the wall (z ${end.z.toFixed(1)})`);
}

// ---- cover ----
{
  const { CONFIG, player, enemies, log, run, spawn, stand } = await setup();
  stand(16, -2);
  const bot = spawn('cable', COVER.x + 3, COVER.z - 7);
  check(enemies._seekCover(bot) && bot.state === 'cover', 'a bot runs for cover behind a tall box');
  check(bot.peeks === 2, 'and knows how many times it will peek');
  const states = new Set();
  const history = [];
  let hiddenWhileDown = true;
  let crouchedWhileDown = false;
  let standingWhileShooting = true;
  run(14, () => {
    states.add(bot.state);
    if (history.at(-1) !== bot.state) history.push(bot.state);
    if (bot.state === 'hide' && bot.crouch > 0.9) { crouchedWhileDown = true; if (!enemies._isHidden(bot)) hiddenWhileDown = false; }
    if (bot.state === 'peek' && bot.shooting && bot.aimT >= bot.gun.aimTime && bot.crouch > 0.3) standingWhileShooting = false;
  });
  check(states.has('cover') && states.has('hide') && states.has('peek'), `it runs to cover, hides and peeks (${history.join(' > ')})`);
  check(crouchedWhileDown && hiddenWhileDown, 'while it hides it is crouched and the box really hides it from you');
  check(log.tracers.length >= 3, `it shoots while it peeks (${log.tracers.length} shots)`);
  check(standingWhileShooting, 'standing up when it fires');
  check(history.filter((state) => state === 'peek').length >= 2, 'and it pops up more than once');
  check(player.health < CONFIG.player.maxHealth, 'the shots land');
}

// ---- a tall box: it leans out past the edge, shoots, and steps back ----
{
  const { enemies, log, run, spawn, stand } = await setup();
  stand(16, -2);
  const bot = spawn('cable', COVER.x, COVER.z - 2.4);
  enemies._seekCover(bot);
  let home = null;
  let farthest = 0;
  let outToTheSide = false;
  let backHome = false;
  run(16, () => {
    if (bot.state === 'hide' && !bot.returning && !home && bot.crouch > 0.9) home = bot.pos.clone();
    if (!home) return;
    const away = Math.hypot(bot.pos.x - home.x, bot.pos.z - home.z);
    if (bot.state === 'peek') {
      farthest = Math.max(farthest, away);
      outToTheSide ||= Math.abs(bot.pos.x - home.x) > 1;
    }
    if (bot.state === 'hide' && !bot.returning && farthest > 1 && away < ARRIVE_TEST) backHome = true;
  });
  check(home !== null, 'it takes cover behind the tall box');
  check(farthest > 1 && outToTheSide, `a box too tall to shoot over: it leans out past the side (${farthest.toFixed(1)} m)`);
  check(log.tracers.length >= 3 && log.tracers.every((tracer) => Math.abs(tracer.from.x - home.x) > 0.5 || Math.abs(tracer.from.z - home.z) > 0.5), 'and the shots come from out there, not from behind the box');
  check(backHome, 'then it steps back to where it was hiding');
}

// ---- it ducks when hit and when aimed at ----
{
  const { enemies, spawn, stand } = await setup();
  stand(16, -2);
  const bot = spawn('cable', COVER.x, COVER.z - 2.5);
  bot.state = 'peek'; bot.peekT = 5; bot.volley = 3; bot.peeks = 3; bot.aimT = 1; bot.crouch = 0;
  enemies.damage(bot, 1, { dirX: 0, dirZ: 1, knock: 0, stun: 0 });
  check(bot.state === 'hide', 'hit while it stands up to shoot, it ducks back down');
  check(bot.peeks === 2, 'and that counts as a peek');
}
{
  const { enemies, spawn, stand, player, run } = await setup();
  stand(16, -2);
  const bot = spawn('cable', COVER.x, COVER.z - 2.5);
  bot.state = 'peek'; bot.peekT = 9; bot.volley = 9; bot.peeks = 3; bot.aimT = 0; bot.crouch = 0; bot.hp = 1e6;
  enemies.aimThreat = true;
  player.getAim = (origin, direction, right, up) => { // aiming straight at the bot's chest
    origin.set(player.pos.x, 1.65, player.pos.z);
    direction.set(bot.pos.x - origin.x, bot.pos.y + 1.15 - origin.y, bot.pos.z - origin.z).normalize();
    right.set(1, 0, 0);
    up.set(0, 1, 0);
  };
  let ducked = false;
  run(1, () => { if (bot.state === 'hide') ducked = true; });
  check(ducked, 'when you hold your aim on it as it stands up, it ducks');
}
{
  const { enemies, spawn, stand, player, run } = await setup((config) => { config.enemies.gun.duckChance = 0; });
  stand(16, -2);
  const bot = spawn('cable', COVER.x, COVER.z - 2.5);
  bot.state = 'peek'; bot.peekT = 9; bot.volley = 9; bot.peeks = 3; bot.hp = 1e6;
  enemies.aimThreat = true;
  player.getAim = (origin, direction, right, up) => { origin.set(player.pos.x, 1.65, player.pos.z); direction.set(bot.pos.x - origin.x, bot.pos.y + 1.15 - origin.y, bot.pos.z - origin.z).normalize(); right.set(1, 0, 0); up.set(0, 1, 0); };
  let ducked = false;
  run(1, () => { if (bot.state === 'hide') ducked = true; });
  check(!ducked, 'a bot with no nerve for ducking stays up');
}

// ---- flanked ----
{
  const { enemies, spawn, stand, run } = await setup();
  stand(20, 4); // north of the box (the bot is south of it)
  const bot = spawn('cable', COVER.x, COVER.z - 2.4);
  bot.state = 'hide'; bot.hideT = 30; bot.checkT = 0; bot.peeks = 3; bot.crouch = 1;
  stand(20 + 0.1, -22); // the player walks round to the bot's side of the box: the box no longer hides it
  const hiddenNow = enemies._isHidden(bot);
  let left = false;
  run(1.5, () => { if (bot.state !== 'hide') left = true; });
  check(!hiddenNow && left, 'when you flank a bot the box stops hiding, and it moves');
}
{
  const { enemies, spawn, stand, run } = await setup();
  stand(20, 4);
  const bot = spawn('cable', COVER.x, COVER.z - 2.4);
  bot.state = 'hide'; bot.hideT = 30; bot.checkT = 0; bot.peeks = 3; bot.crouch = 1;
  run(2);
  check(bot.state === 'hide' && enemies._isHidden(bot), 'while the box still hides it, it stays down');
}

// ---- peeks used up: it moves on ----
{
  const { enemies, spawn, stand, run } = await setup((config) => { config.enemies.gun.peeks = [1, 1]; config.enemies.gun.peekTime = [0.6, 0.6]; config.enemies.hideTime = [0.5, 0.5]; });
  stand(16, -2);
  const bot = spawn('cable', COVER.x, COVER.z - 2.4);
  enemies._seekCover(bot);
  const coverSpots = new Set([`${bot.coverX.toFixed(1)},${bot.coverZ.toFixed(1)}`]);
  run(12, () => { if (bot.state === 'cover') coverSpots.add(`${bot.coverX.toFixed(1)},${bot.coverZ.toFixed(1)}`); });
  check(coverSpots.size >= 2 || bot.state !== 'hide', `after its peeks it goes to other cover (${coverSpots.size} spots)`);
}

// ---- no line, no shot ----
{
  const { player, spawn, stand, run, log, CONFIG } = await setup();
  stand(COVER.x, 0);
  const bot = spawn('cable', COVER.x, COVER.z - 3.5);
  bot.crouch = 0;
  let shooting = false;
  run(2, () => { if (bot.shooting) shooting = true; });
  check(!shooting && log.tracers.length === 0 && player.health === CONFIG.player.maxHealth, 'a bot with a wall between you does not shoot at it');
}
{
  const { player, spawn, stand, run, log } = await setup();
  stand(6, 0);
  const bot = spawn('cable', 6, -9);
  bot.boot = 5;
  run(3);
  check(log.tracers.length === 0, 'a bot that is still booting does not shoot');
  bot.boot = 0;
  bot.stun = 3;
  run(2);
  check(log.tracers.length === 0, 'and neither does a stunned one');
  bot.stun = 0;
  player.alive = false;
  run(2);
  check(log.tracers.length === 0, 'and nobody shoots a player who is already down');
}

// ---- fists still work ----
{
  const { CONFIG, player, spawn, stand, run, log } = await setup((config) => { config.enemies.types.cable.damage = 12; });
  stand(6, 0);
  spawn('cable', 6, -1.2); // too close to shoot
  run(3);
  check(player.health < CONFIG.player.maxHealth && log.tracers.length === 0, 'a bot that is too close uses its fists, not the pistol');
}
{
  const { CONFIG, player, spawn, stand, run, log } = await setup((config) => { config.enemies.types.router.damage = 6; });
  stand(6, 0);
  spawn('router', 6, -10);
  run(8);
  check(player.health < CONFIG.player.maxHealth && log.tracers.length === 0, 'a router closes in and uses its fists');
}

// ---- the arm and the gun in the animation ----
{
  const { enemies, spawn, stand, run } = await setup();
  stand(6, 0);
  const bot = spawn('cable', 6, -9);
  run(2);
  for (let i = 0; i < 30; i++) enemies.animate(1, i * dt, dt);
  const right = bot.arms.find((arm) => arm.side === 1);
  const left = bot.arms.find((arm) => arm.side === -1);
  check(right.shoulder.rotation.x < -1.2 && left.shoulder.rotation.x > right.shoulder.rotation.x, 'the gun arm is raised level while it shoots');
  bot.shooting = false;
  bot.state = 'hide';
  for (let i = 0; i < 90; i++) enemies.animate(1, i * dt, dt);
  check(bot.aimBlend < 0.05 && right.shoulder.rotation.x > -1.2, 'and comes down when it stops');
}

process.exit(fails ? 1 : 0);
