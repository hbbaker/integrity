import * as THREE from 'three';

/*
 * One target list for Weapons: the bots (Enemies) and the other players
 * (RemotePlayers). It answers the same questions as Enemies (raycast, damage,
 * meleeTarget, bodyCenter) and routes each answer to the right owner, so the
 * weapon code does not care what it hit.
 */
export class Targets {
  constructor({ enemies, remotes }) {
    this.enemies = enemies;
    this.remotes = remotes;
    this.hit = { enemy: null, t: 0, crit: false };
    this._centre = new THREE.Vector3();
  }

  /** Bots dodge when you aim at them; forwarded as-is. */
  get aimThreat() {
    return this.enemies.aimThreat;
  }

  set aimThreat(value) {
    this.enemies.aimThreat = value;
  }

  /** The nearer of the bot hit and the player hit. `skip` is an optional Set of targets the ray passes through. Returns a shared object, like Enemies.raycast. */
  raycast(origin, dir, maxT, radius = 0, boost = 0, skip = null) {
    const botHit = this.enemies.raycast(origin, dir, maxT, radius, boost, skip);
    const limit = botHit ? botHit.t : maxT;
    const playerHit = this.remotes.list.length ? this.remotes.raycast(origin, dir, limit, radius, boost, skip) : null;
    const nearest = playerHit ?? botHit;
    if (!nearest) return null;
    this.hit.enemy = nearest.enemy;
    this.hit.t = nearest.t;
    this.hit.crit = nearest.crit;
    return this.hit;
  }

  damage(target, amount, options) {
    return target.isRemote
      ? this.remotes.damage(target, amount, options)
      : this.enemies.damage(target, amount, options);
  }

  /**
   * Drag a target (a bot, or another player over the network). `options`: { toward() -> point or null, speed, arrive, seconds }.
   * A bot is moved here; a player is told to pull themselves, and decides for themselves.
   */
  pull(target, options) {
    if (target.isRemote) this.remotes.pull(target, options);
    else this.enemies.pullToward(target, options);
  }

  /**
   * Skewer a target on something that moves (a drill head). `options`: { point() -> point or null, direction, speed, seconds }.
   * A bot hangs from `point`; a player is told to ride along `direction` at `speed` (their game moves them).
   */
  carry(target, options) {
    if (target.isRemote) this.remotes.pull(target, { speed: options.speed, seconds: options.seconds, direction: options.direction });
    else this.enemies.pinTo(target, options);
  }

  /** Let go of a dragged or skewered target. */
  release(target) {
    if (target.isRemote) this.remotes.release(target);
    else this.enemies.release(target);
  }

  meleeTarget(origin, forward, range, minCos) {
    const bot = this.enemies.meleeTarget(origin, forward, range, minCos);
    const player = this.remotes.list.length ? this.remotes.meleeTarget(origin, forward, range, minCos) : null;
    if (!bot || !player) return bot ?? player;
    return this._distanceTo(origin, player) < this._distanceTo(origin, bot) ? player : bot;
  }

  bodyCenter(target, out) {
    return target.isRemote ? this.remotes.bodyCenter(target, out) : this.enemies.bodyCenter(target, out);
  }

  _distanceTo(origin, target) {
    const centre = this.bodyCenter(target, this._centre);
    return Math.hypot(centre.x - origin.x, centre.y - origin.y, centre.z - origin.z);
  }
}
