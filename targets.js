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

  /** The nearer of the bot hit and the player hit. Returns a shared object, like Enemies.raycast. */
  raycast(origin, dir, maxT, radius = 0) {
    const botHit = this.enemies.raycast(origin, dir, maxT, radius);
    const limit = botHit ? botHit.t : maxT;
    const playerHit = this.remotes.list.length ? this.remotes.raycast(origin, dir, limit, radius) : null;
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
