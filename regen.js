/*
 * Health regeneration: after `delay` seconds without taking damage, health comes
 * back at `rate` per second. Shared by every mode that wants it.
 */
export class HealthRegen {
  /** @param settings { delay, rate } seconds of quiet before it starts, and health per second */
  constructor({ delay, rate }) {
    this.delay = delay;
    this.rate = rate;
    this.sinceDamage = 0;
    this.lastHealth = 0;
  }

  /** Call when the player spawns, so the first frame is not mistaken for damage. */
  reset(health) {
    this.sinceDamage = 0;
    this.lastHealth = health;
  }

  update(player, dt) {
    if (!player.alive) return;
    this.sinceDamage = player.health < this.lastHealth ? 0 : this.sinceDamage + dt;
    if (this.sinceDamage >= this.delay && player.health < player.cfg.maxHealth) {
      player.heal(this.rate * dt);
    }
    this.lastHealth = player.health;
  }
}
