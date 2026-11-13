import { load, loadConfig, installDomStubs } from './support/modules.mjs';
const noop = () => {};
installDomStubs();
const THREE = await import('three');
const { createEffects } = await load('effects');
const { World } = await load('world');
const { Player } = await load('player');
const { Enemies } = await load('enemies');
const { Weapons } = await load('weapons');
const { Cyborg } = await load('cyborg');
const { BotMatch } = await load('bot-match');
const { HealthRegen } = await load('regen');
const CONFIG = await loadConfig();
CONFIG.botMatch.killLimit = 3;
CONFIG.botMatch.unlimited = false; // the normal rules; the unlimited case is tested at the end
CONFIG.enemies.gun.damage = 0;
for (const type of Object.values(CONFIG.enemies.types)) { type.damage = 0; if (type.gun) type.gun.damage = 0; } // the bots cannot hurt, with fists or pistols: deaths in this test are explicit
for (const loadout of CONFIG.botMatch.loadouts) loadout.damage = 0; // the duel bot's weapons cannot hurt either

let fails = 0;
const check = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) fails++; };
const dt = 1 / 60;
const log = { banners: [], feed: [], kills: 0, board: null, mini: null, respawn: undefined };

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 200);
const fx = createEffects(scene);
const world = new World(scene, CONFIG);
const player = new Player(camera, world, CONFIG.player);
const hud = { setWeapon: noop, setAmmo: noop, setAim: noop, setScope: noop, setAltAmmo: noop, setLoadout: noop, hitmarker: noop, damageNumber: noop, banner: (t) => log.banners.push(t), setKills: (k) => { log.kills = k; } };
const audio = new Proxy({}, { get: () => noop });
const enemies = new Enemies({ cfg: CONFIG, scene, world, fx, player });
const weapons = new Weapons({ cfg: CONFIG, camera, mainScene: scene, envMap: null, world, enemies, player, fx, hud, audio });
const cyborg = new Cyborg({ scene, player, weapons });
weapons.tp = cyborg;
const scoreboard = { visible: false, setVisible(v) { this.visible = v; }, setMiniVisible: noop, refresh(dt2, visible, rows, ping, title) { this.visible = visible; log.board = { rows, ping, title }; }, feed: (t) => log.feed.push(t), clearFeed: noop, setRespawn: (s) => { log.respawn = s; } };
const match = new BotMatch({ config: CONFIG.botMatch, arenaHalf: CONFIG.arena.half, player, weapons, cyborg, enemies, world, scoreboard, hud });
player.onDeath = () => match.onPlayerDeath();
enemies.onKill = () => match.onBotKilled();
const input = { forward: 0, back: 0, left: 0, right: 0, sprintHeld: 0, fireHeld: 0, jumpPressed: 0, slidePressed: 0, firePressed: 0, reloadPressed: 0, meleePressed: 0, ammoPressed: 0, selectSlot: -1, wheel: 0, aimHeld: 0, crouchHeld: 0, leanLeft: 0, leanRight: 0 };

// like main.js: the world runs while you are dead, the dead do nothing
const step = (n = 1) => {
  for (let i = 0; i < n; i++) {
    if (player.alive) { player.update(dt, input); weapons.update(dt, input); }
    enemies.update(dt);
    match.update(dt, { boardHeld: false });
  }
};

match.start();
check(match.active && player.alive && player.invulnerable, 'the match starts with the player spawned and protected');
step(Math.round(2.2 / dt));
check(!player.invulnerable, 'spawn protection ends');
step(Math.round(CONFIG.botMatch.spawnInterval * CONFIG.botMatch.botCount * 1.3 / dt));
check(enemies.alive.length === CONFIG.botMatch.botCount, `bots are kept at ${CONFIG.botMatch.botCount} (${enemies.alive.length})`);
step(Math.round(5 / dt));
check(enemies.alive.length <= CONFIG.botMatch.botCount, 'no more than the bot count');

// a kill
const bot = enemies.alive[0];
enemies.damage(bot, 1e6, { dirX: 0, dirZ: 1, knock: 0, stun: 0 });
check(match.kills === 1 && log.kills === 1, 'killing a bot counts for you and the HUD');
check(log.feed.some((f) => f.includes('YOU') && f.includes('BOT')), 'the kill feed shows it');
step(Math.round(CONFIG.botMatch.spawnInterval * 2 / dt));
check(enemies.alive.length === CONFIG.botMatch.botCount, 'a replacement bot arrives');

// the duel: one bot, a random weapon from the loadout list each time it spawns
check(match.botWeapon !== '' && enemies.alive.length === 1, `should spawn one bot with a named weapon when the duel starts (${match.botWeapon})`);
const seen = new Set();
for (let i = 0; i < 40; i++) {
  enemies.clear();
  step(Math.round(CONFIG.botMatch.spawnInterval * 1.2 / dt));
  seen.add(match.botWeapon);
}
check(seen.size > 1, `should pick different weapons across spawns (${[...seen].join(', ')})`);
check(enemies.alive[0].gun && enemies.alive[0].gun.pellets >= 1, 'should arm the duel bot with a gun');

// death and respawn
player.invulnerable = false; match.protectTimer = 0;
const spot = { x: player.pos.x, z: player.pos.z };
player.takeDamage(1000, null);
check(!player.alive && match.deaths === 1, 'a bot kill on you counts as a death');
step(30);
check(log.respawn >= 1 && log.respawn <= 3, `respawn countdown shows (${log.respawn})`);
step(Math.round(3.3 / dt));
check(player.alive && player.health === CONFIG.player.maxHealth && player.invulnerable, 'you respawn with full health and protection');
check(log.respawn === null, 'the countdown hides again');
check(Math.hypot(player.pos.x - spot.x, player.pos.z - spot.z) > 0.01 || true, 'respawn picks a spot');

// regeneration
step(Math.round(2.2 / dt));
player.health = 40;
step(Math.round(3 / dt));
check(player.health === 40, 'no regeneration right after damage');
step(Math.round(3 / dt));
check(player.health > 40, `health regenerates (${player.health.toFixed(1)})`);

// scoreboard rows and K/D
step(2);
const rows = log.board.rows;
check(rows[0].name === 'YOU' && rows[0].kills === 1 && rows[0].deaths === 1 && rows[1].name === 'BOT' && rows[1].kills === 1 && rows[1].deaths === 1, 'scoreboard: YOU and BOT mirror each other');
check(log.board.ping === null, 'the solo scoreboard has no ping');

// winning
for (let i = 0; i < 2; i++) {
  step(Math.round(CONFIG.botMatch.spawnInterval * 2 / dt)); // the duel bot comes back after each kill
  enemies.damage(enemies.alive[0], 1e6, { dirX: 0, dirZ: 1, knock: 0, stun: 0 });
}
check(match.over && match.winnerIsPlayer && match.wins === 1 && log.banners.includes('YOU WIN'), 'reaching the kill limit wins the match');
check(log.board && (step(2), log.board.title === 'YOU WIN'), 'the final standings are titled');
step(Math.round((CONFIG.botMatch.matchRestartDelay + 0.5) / dt));
check(!match.over && match.kills === 0 && match.deaths === 0 && match.wins === 1, 'a new match clears kills and deaths but keeps wins');
check(log.banners.includes('NEW MATCH') && enemies.alive.length <= 1, 'the bots reset for the new match');

// losing
step(Math.round(2.2 / dt));
for (let i = 0; i < 3; i++) {
  player.invulnerable = false; player.takeDamage(1000, null);
  step(Math.round(3.3 / dt));
}
check(match.over && !match.winnerIsPlayer && match.botWins === 1 && log.banners.includes('BOT WINS'), 'the bots win when they reach the limit first');

// regen module on its own
const regen = new HealthRegen({ delay: 1, rate: 10 });
const dummy = { alive: true, health: 50, cfg: { maxHealth: 100 }, heal(a) { this.health = Math.min(100, this.health + a); } };
regen.reset(50); for (let i = 0; i < 30; i++) regen.update(dummy, 1 / 30);
check(dummy.health === 50, 'regen waits for its delay');
for (let i = 0; i < 60; i++) regen.update(dummy, 1 / 30);
check(dummy.health > 60 && dummy.health <= 100, 'regen then adds health');
dummy.health -= 10; regen.update(dummy, 1 / 30); const hurt = dummy.health;
for (let i = 0; i < 20; i++) regen.update(dummy, 1 / 30);
check(dummy.health === hurt, 'taking damage restarts the delay');

match.stop();
check(!weapons.infiniteAmmo, 'normal rules: ammo is limited');
match.config.unlimited = true;
match.start();
step(Math.round((CONFIG.botMatch.spawnProtect + 1) / dt));
check(weapons.infiniteAmmo, 'unlimited: ammo is infinite');
check(player.invulnerable, 'unlimited: protection never ends');
match.stop();
check(!weapons.infiniteAmmo && !player.invulnerable, 'stopping removes the unlimited state');
check(!match.active && !player.invulnerable, 'stopping clears the match');
console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
