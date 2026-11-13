import { pickSpawnPoint } from '../../core/client/character/spawn.js';
import { HealthRegen } from '../../core/client/character/regen.js';

/*
 * DEATHMATCH 1V1 VS BOT: the deathmatch rules played alone, as a duel. One gun-carrying bot
 * hunts you in the arena. Every time it spawns it picks a random weapon from config.loadouts.
 * You respawn when you die (with a short spell of protection), your health comes back by
 * itself, and the first side to reach the kill limit wins the match.
 *
 * The player is "YOU" and the bot is "BOT" on the scoreboard, so the same
 * K/D table and corner top-two as the online deathmatch apply.
 */

const PLAYER_ROW_ID = 1;
const BOTS_ROW_ID = 2;

export class BotMatch {
  /**
   * @param deps { config, arenaHalf, player, weapons, cyborg, enemies, world, scoreboard, hud }
   * config = CONFIG.botMatch
   */
  constructor({ config, arenaHalf, player, weapons, cyborg, enemies, world, scoreboard, hud }) {
    this.config = config;
    this.arenaHalf = arenaHalf;
    this.player = player;
    this.weapons = weapons;
    this.cyborg = cyborg;
    this.enemies = enemies;
    this.world = world;
    this.scoreboard = scoreboard;
    this.hud = hud;
    this.regen = new HealthRegen({ delay: config.regenDelay, rate: config.regenRate });
    this.active = false;
    this.kills = 0; // bots you have killed this match
    this.deaths = 0; // times the bots killed you: also the bots' kill count
    this.wins = 0;
    this.botWins = 0;
    this.over = false;
    this.winnerIsPlayer = false;
    this.respawnTimer = 0;
    this.protectTimer = 0;
    this.spawnTimer = 0;
    this.restartTimer = 0;
    this.botWeapon = ''; // name of the weapon the current bot carries
  }

  start() {
    this.active = true;
    this.weapons.infiniteAmmo = Boolean(this.config.unlimited);
    this.kills = 0;
    this.deaths = 0;
    this.wins = 0;
    this.botWins = 0;
    this.over = false;
    this.spawnTimer = 0;
    this.respawnTimer = 0;
    this.scoreboard.clearFeed();
    this.scoreboard.setMiniVisible(true);
    this.hud.setKills(0);
    this._spawnPlayer();
  }

  stop() {
    this.active = false;
    this.player.invulnerable = false;
    this.weapons.infiniteAmmo = false;
    this.scoreboard.setVisible(false);
    this.scoreboard.setMiniVisible(false);
    this.scoreboard.setRespawn(null);
    this.scoreboard.clearFeed();
  }

  /** Once per rendered frame while the match is running (also while you are dead and waiting to respawn). */
  update(dt, { boardHeld }) {
    if (!this.active) return;
    this._updateTimers(dt);
    this.regen.update(this.player, dt);
    this._spawnBots(dt);
    this.scoreboard.refresh(dt, boardHeld || !this.player.alive || this.over, this._rows(), null, this._title());
  }

  /** Called by main.js whenever one of your shots, punches or beams kills a bot. */
  onBotKilled() {
    if (!this.active) return;
    this.kills += 1;
    this.hud.setKills(this.kills);
    this.scoreboard.feed('YOU  ▸  BOT', true);
    if (this.kills >= this.config.killLimit && !this.over) this._end(true);
  }

  /** Called by main.js when your health reaches zero. */
  onPlayerDeath() {
    if (!this.active) return;
    this.deaths += 1;
    this.scoreboard.feed(`BOT (${this.botWeapon})  ▸  YOU`, false);
    this.respawnTimer = this.config.respawnTime;
    if (this.deaths >= this.config.killLimit && !this.over) this._end(false);
  }

  /* ------------------------------- internals ------------------------------- */

  _updateTimers(dt) {
    if (this.protectTimer > 0 && !this.config.unlimited) {
      this.protectTimer -= dt;
      if (this.protectTimer <= 0) this.player.invulnerable = false;
    }
    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      this.scoreboard.setRespawn(Math.max(1, Math.ceil(this.respawnTimer)));
      if (this.respawnTimer <= 0) this._spawnPlayer();
    }
    if (this.over) {
      this.restartTimer -= dt;
      if (this.restartTimer <= 0) this._newMatch();
    }
  }

  /** Keep `botCount` bots alive, adding one every spawnInterval seconds, each with a random weapon. */
  _spawnBots(dt) {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = this.config.spawnInterval;
    if (this.over || this.enemies.alive.length >= this.config.botCount) return;
    const { name, ...gun } = this._pickLoadout();
    if (this.enemies.spawnAtEdge(this.config.botType, this.config.speedMul, { gun })) {
      this.botWeapon = name;
      this.hud.banner(`BOT: ${name}`);
    }
  }

  _pickLoadout() {
    const { loadouts } = this.config;
    return loadouts[Math.floor(Math.random() * loadouts.length)];
  }

  /** Put the player on a fresh spot away from the bots, with a short spell of protection. */
  _spawnPlayer() {
    const others = this.enemies.alive.map((bot) => ({ x: bot.pos.x, z: bot.pos.z }));
    const spot = pickSpawnPoint({ world: this.world, half: this.arenaHalf, others });
    const { player } = this;
    player.spawnX = spot.x;
    player.spawnY = spot.y;
    player.spawnZ = spot.z;
    player.spawnYaw = spot.yaw;
    player.reset();
    this.weapons.reset();
    this.cyborg.reset();
    player.invulnerable = true; // lasts for spawnProtect seconds, or the whole match when unlimited
    this.protectTimer = this.config.spawnProtect;
    this.respawnTimer = 0;
    this.regen.reset(player.health);
    this.scoreboard.setRespawn(null);
  }

  _end(playerWon) {
    this.over = true;
    this.winnerIsPlayer = playerWon;
    this.restartTimer = this.config.matchRestartDelay;
    if (playerWon) this.wins += 1;
    else this.botWins += 1;
    this.hud.banner(playerWon ? 'YOU WIN' : 'BOT WINS');
  }

  _newMatch() {
    this.over = false;
    this.kills = 0;
    this.deaths = 0;
    this.enemies.clear();
    this.hud.setKills(0);
    this.hud.banner('NEW MATCH');
    this._spawnPlayer();
  }

  _title() {
    if (!this.over) return 'SCOREBOARD';
    return this.winnerIsPlayer ? 'YOU WIN' : 'BOT WINS';
  }

  _rows() {
    return [
      { id: PLAYER_ROW_ID, name: 'YOU', kills: this.kills, deaths: this.deaths, wins: this.wins, me: true },
      { id: BOTS_ROW_ID, name: 'BOT', kills: this.deaths, deaths: this.kills, wins: this.botWins, me: false },
    ];
  }
}
