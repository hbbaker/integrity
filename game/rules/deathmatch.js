import { pickSpawnPoint } from '../../core/client/character/spawn.js';
import { poseMessage } from '../entities/pose-message.js';
import { HealthRegen } from '../../core/client/character/regen.js';

/*
 * The deathmatch rules and the network traffic that goes with them.
 *
 * Each player simulates only themselves. Messages (short keys, JSON):
 *   s   state     my position, aim, pose and weapon, sent sendHz times a second
 *   sh  shot      tracers (sent by Weapons through onShot)
 *   ml  melee     swing animation
 *   h   hit       "I hit player `to` for `d`": the victim applies it to themself
 *   pl  pull      "I grappled player `to`: pull yourself toward me at `v` m/s for up to `s` seconds" (`c`: let go)
 *   d   died      "I died; `by` was the last player to hurt me"
 *   sc  scores    the lowest-id player shares the table (kills, deaths, wins) when someone joins
 *   pk  pickup    a crate appeared (a death drop, or the lowest-id player's map spawn)
 *   pc  collected a crate was picked up: remove it everywhere
 * Because the victim decides when they die, everyone derives the scoreboard
 * from the same `d` messages. This trusts every client: fine on a home network.
 */

const MAX_HIT_DAMAGE = 400; // one sniper crit is 240; reject anything absurd
const MAX_PULL_SPEED = 40; // m/s: a grapple message asking for more is clamped
const MAX_PULL_SECONDS = 6;
const PULL_ARRIVE_DISTANCE = 1.8; // a grappled player stops this close to whoever hooked them
const CARRY_TARGET_DISTANCE = 50; // metres ahead: a carried player is steered at a point this far along the drill's path
const CARRY_BODY_HEIGHT = 0.9; // the player's body centre above their feet (matches the pull's own height)
const PULL_TARGET_HEIGHT = 0.9; // metres above the hooker's feet: where the victim is pulled to
const AMMO_SHARE = 0.6; // of the crates the spawner makes, this share is ammo and the rest health
const PICKUP_ID_STRIDE = 1e6; // pickup ids are playerId * stride + counter, so they never clash
const round2 = (value) => Math.round(value * 100) / 100;

export class Deathmatch {
  /**
   * @param deps { config, arenaHalf, net, player, weapons, cyborg, remotes, world, scoreboard, hud }
   * config = CONFIG.multiplayer
   */
  constructor({ config, arenaHalf, net, player, weapons, cyborg, remotes, world, scoreboard, hud, pickups }) {
    this.config = config;
    this.arenaHalf = arenaHalf;
    this.net = net;
    this.player = player;
    this.weapons = weapons;
    this.cyborg = cyborg;
    this.remotes = remotes;
    this.world = world;
    this.scoreboard = scoreboard;
    this.hud = hud;
    this.pickups = pickups;
    this.active = false;
    this.scores = new Map(); // id -> { kills, deaths }
    this.names = new Map(); // id -> name; kept after a player leaves so the kill feed can still name them
    this.knownIds = new Set();
    this.lastAttacker = 0;
    this.respawnTimer = 0;
    this.protectTimer = 0;
    this.sendTimer = 0;
    this.restartTimer = 0;
    this.over = false;
    this.winnerId = 0;
    this.regen = new HealthRegen({ delay: config.regenDelay, rate: config.regenRate });
    this.spawnTimer = 0;
    this.pickupSeq = 0;
  }

  start() {
    this.active = true;
    this.scores.clear();
    this.knownIds.clear();
    this.over = false;
    this.sendTimer = 0;
    this.respawnTimer = 0;
    this.scoreboard.clearFeed();
    this.scoreboard.setMiniVisible(true);
    this.onRoster(this.net.players);
    this.weapons.onShot = (index, from, ends) => this._send({
      t: 'sh', w: index, f: [round2(from.x), round2(from.y), round2(from.z)],
      e: ends.map((end) => [round2(end[0]), round2(end[1]), round2(end[2])]),
    });
    this.weapons.onMelee = (fists) => this._send({ t: 'ml', fists: fists ? 1 : 0 });
    this.weapons.onItemMessage = (message) => this._send(message);
    this.remotes.onDamage = (target, amount) => this._send({ t: 'h', to: target.id, d: round2(amount) });
    this.remotes.onPull = (target, options) => this._send(options
      ? {
        t: 'pl', to: target.id, v: round2(options.speed), s: round2(options.seconds),
        ...(options.direction ? { d: [round2(options.direction.x), round2(options.direction.y), round2(options.direction.z)] } : {}),
      }
      : { t: 'pl', to: target.id, c: 1 });
    this.pickups.clear();
    this.pickups.onCollected = (item) => this._send({ t: 'pc', id: item.netId });
    this.spawnTimer = this.config.pickupInterval;
    this._spawn();
    this.hud.setKills(0);
  }

  stop() {
    this.active = false;
    this.weapons.onShot = null;
    this.weapons.onMelee = null;
    this.weapons.onItemMessage = null;
    this.remotes.onDamage = null;
    this.remotes.onPull = null;
    this.pickups.onCollected = null;
    this.pickups.clear();
    this.player.invulnerable = false;
    this.scoreboard.setVisible(false);
    this.scoreboard.setMiniVisible(false);
    this.scoreboard.setRespawn(null);
    this.scoreboard.setPing(null);
    this.scoreboard.clearFeed();
  }

  /** Per rendered frame, whether or not the player is alive. */
  update(dt, { boardHeld }) {
    if (!this.active) return;
    this._updateTimers(dt);
    this.regen.update(this.player, dt);
    this._updatePickupSpawner(dt);
    this.sendTimer -= dt;
    if (this.sendTimer <= 0) {
      this.sendTimer += 1 / this.config.sendHz;
      this._sendState();
    }
    this.scoreboard.setPing(this.net.latency);
    this._updateBoard(dt, boardHeld || !this.player.alive || this.over);
  }

  /** Called by main.js when the local player's health reaches zero. */
  onLocalDeath() {
    this._send({ t: 'd', by: this.lastAttacker });
    this._registerKill(this.lastAttacker, this.net.id);
    this.respawnTimer = this.config.respawnTime;
    this._dropLoot();
  }

  /** The server roster changed: track names and scores, and share the table with newcomers. */
  onRoster(players) {
    const ids = new Set(players.map((player) => player.id));
    const newcomers = players.filter((player) => !this.knownIds.has(player.id));
    for (const player of players) {
      this.names.set(player.id, player.name);
      if (!this.scores.has(player.id)) this.scores.set(player.id, { kills: 0, deaths: 0, wins: 0 });
    }
    for (const id of this.scores.keys()) if (!ids.has(id)) this.scores.delete(id);
    const hadPlayers = this.knownIds.size > 0;
    this.knownIds = ids;

    const iAmLowest = ids.size > 1 && Math.min(...ids) === this.net.id;
    if (this.active && hadPlayers && newcomers.length && iAmLowest) this._shareScores();
  }

  /** A relayed game message that is about the match (not shots or state: RemotePlayers takes those). */
  onMessage(from, message) {
    if (!this.active) return;
    switch (message.t) {
      case 'h':
        if (message.to === this.net.id) this._takeHit(from, message.d);
        break;
      case 'pl':
        if (message.to === this.net.id) this._takePull(from, message);
        break;
      case 'd':
        if (this.names.has(message.by) || message.by === 0) this._registerKill(message.by, from);
        break;
      case 'sc':
        this._mergeScores(message.s);
        break;
      case 'pk':
        this._placeRemotePickup(message);
        break;
      case 'pc':
        this.pickups.removeById(message.id);
        break;
      default:
        this.weapons.onPeerMessage(from, message); // items may use their own message types (a launched drill)
        break;
    }
  }

  /* ------------------------------- internals ------------------------------- */

  _send(message) {
    this.net.send(message);
  }

  _sendState() {
    this._send(poseMessage(this.player, this.weapons));
  }

  _updateTimers(dt) {
    if (this.protectTimer > 0) {
      this.protectTimer -= dt;
      if (this.protectTimer <= 0) this.player.invulnerable = false;
    }
    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      this.scoreboard.setRespawn(Math.max(1, Math.ceil(this.respawnTimer)));
      if (this.respawnTimer <= 0) this._spawn();
    }
    if (this.over) {
      this.restartTimer -= dt;
      if (this.restartTimer <= 0) this._newMatch();
    }
  }

  /** The lowest-id player acts as the spawner, so each crate is created once. */
  _updatePickupSpawner(dt) {
    const players = this.net.players;
    if (players.length === 0 || Math.min(...players.map((p) => p.id)) !== this.net.id) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = this.config.pickupInterval;
    const lying = this.pickups.positions();
    if (lying.length >= this.config.pickupMax) return;
    const spot = pickSpawnPoint({ world: this.world, half: this.arenaHalf, others: lying });
    this._dropPickup(Math.random() < AMMO_SHARE ? 'ammo' : 'health', spot.x, spot.y, spot.z);
  }

  /** What a dead player leaves behind: ammo always, sometimes a health case. */
  _dropLoot() {
    const { x, y, z } = this.player.pos;
    this._dropPickup('ammo', x + 0.4, y, z);
    if (Math.random() < this.config.dropHealthChance) this._dropPickup('health', x - 0.4, y, z);
  }

  /** Create a crate here and tell everyone else to create the same one. */
  _dropPickup(kind, x, y, z) {
    this.pickupSeq += 1;
    const id = this.net.id * PICKUP_ID_STRIDE + this.pickupSeq;
    this.pickups.place(kind, x, y, z, id, this.config.pickupLife);
    this._send({ t: 'pk', id, k: kind, x: round2(x), y: round2(y), z: round2(z) });
  }

  _placeRemotePickup(message) {
    const { id, k, x, y, z } = message;
    const valid = (k === 'ammo' || k === 'health') && [id, x, y, z].every(Number.isFinite);
    if (valid) this.pickups.place(k, x, y, z, id, this.config.pickupLife);
  }

  _updateBoard(dt, visible) {
    const winner = this.over ? this.names.get(this.winnerId) : null;
    this.scoreboard.refresh(dt, visible, this._rows(), this.net.latency, winner ? `${winner} WINS` : 'SCOREBOARD');
  }

  _rows() {
    return this.net.players.map((player) => {
      const score = this.scores.get(player.id) ?? { kills: 0, deaths: 0, wins: 0 };
      return { id: player.id, name: player.name, kills: score.kills, deaths: score.deaths, wins: score.wins, me: player.id === this.net.id };
    });
  }

  /** Put the local player on a fresh spawn point, with a short spell of protection. */
  _spawn() {
    const others = this.remotes.list
      .filter((remote) => remote.alive && remote.hasState)
      .map((remote) => ({ x: remote.pos.x, z: remote.pos.z }));
    const spot = pickSpawnPoint({ world: this.world, half: this.arenaHalf, others });
    const { player } = this;
    player.spawnX = spot.x;
    player.spawnY = spot.y;
    player.spawnZ = spot.z;
    player.spawnYaw = spot.yaw;
    player.reset();
    this.weapons.reset();
    this.cyborg.reset();
    player.invulnerable = true;
    this.protectTimer = this.config.spawnProtect;
    this.lastAttacker = 0;
    this.respawnTimer = 0;
    this.regen.reset(player.health);
    this.scoreboard.setRespawn(null);
    this._sendState();
  }

  _takeHit(from, damage) {
    const amount = Math.min(Math.max(Number(damage) || 0, 0), MAX_HIT_DAMAGE);
    if (!amount || !this.player.alive || this.player.invulnerable) return;
    this.lastAttacker = from;
    this.player.takeDamage(amount, this.remotes.byId.get(from)?.pos);
  }

  /** Another player's grapple hit me: pull myself toward them (or let go). Their cable is a request, so it is clamped. */
  _takePull(from, message) {
    if (message.c) {
      this.player.cancelPull();
      return;
    }
    if (!this.player.alive || this.player.invulnerable) return; // no grappling people who just spawned
    const speed = Math.min(Math.max(Number(message.v) || 0, 0), MAX_PULL_SPEED);
    const seconds = Math.min(Math.max(Number(message.s) || 0, 0), MAX_PULL_SECONDS);
    if (!speed || !seconds) return;
    if (Array.isArray(message.d)) {
      this._takeCarry(message.d, speed, seconds);
      return;
    }
    const hooker = this.remotes.byId.get(from);
    this.player.pullToward(
      () => (hooker?.alive ? { x: hooker.pos.x, y: hooker.pos.y + PULL_TARGET_HEIGHT, z: hooker.pos.z } : null),
      { speed, arrive: PULL_ARRIVE_DISTANCE, seconds },
    );
  }

  /** Impaled on a drill head: carried along its path at its speed until time runs out or something solid is hit. */
  _takeCarry(direction, speed, seconds) {
    const [dx, dy, dz] = direction.map((value) => Number(value) || 0);
    const length = Math.hypot(dx, dy, dz);
    if (!length) return;
    const { player } = this;
    const reach = CARRY_TARGET_DISTANCE / length;
    player.pullToward(
      () => ({ x: player.pos.x + dx * reach, y: player.pos.y + CARRY_BODY_HEIGHT + dy * reach, z: player.pos.z + dz * reach }),
      { speed, arrive: 0, seconds, pinned: true },
    );
  }

  _registerKill(killerId, victimId) {
    const victim = this.scores.get(victimId);
    if (victim) victim.deaths += 1;
    const killer = killerId && killerId !== victimId ? this.scores.get(killerId) : null;
    if (killer) killer.kills += 1;

    const victimName = this.names.get(victimId) ?? '???';
    const mine = killerId === this.net.id;
    this.scoreboard.feed(killer ? `${this.names.get(killerId)}  ▸  ${victimName}` : `${victimName} DIED`, mine);
    if (killerId === this.net.id || victimId === this.net.id) {
      this.hud.setKills(this.scores.get(this.net.id)?.kills ?? 0);
    }
    if (killer && killer.kills >= this.config.killLimit && !this.over) this._endMatch(killerId);
  }

  _endMatch(winnerId) {
    this.over = true;
    this.winnerId = winnerId;
    const winner = this.scores.get(winnerId);
    if (winner) winner.wins += 1;
    this.restartTimer = this.config.matchRestartDelay;
    this.hud.banner(`${this.names.get(winnerId) ?? '???'} WINS`);
  }

  _newMatch() {
    this.over = false;
    this.winnerId = 0;
    for (const score of this.scores.values()) { // wins are kept: they count across matches
      score.kills = 0;
      score.deaths = 0;
    }
    this.hud.setKills(0);
    this.hud.banner('NEW MATCH');
    this._spawn();
  }

  _shareScores() {
    const table = [...this.scores].map(([id, score]) => [id, score.kills, score.deaths, score.wins]);
    this._send({ t: 'sc', s: table });
  }

  _mergeScores(table) {
    if (!Array.isArray(table)) return;
    for (const entry of table) {
      const [id, kills, deaths, wins] = entry;
      if (this.scores.has(id) && [kills, deaths, wins].every(Number.isFinite)) {
        this.scores.set(id, { kills, deaths, wins });
      }
    }
    this.hud.setKills(this.scores.get(this.net.id)?.kills ?? 0);
  }
}
