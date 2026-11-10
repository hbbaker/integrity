/*
 * A short-range strike: a forgiving cone pick with a wall check, damage applied at once.
 * Used by the quick-melee control (any item in hand) and by melee weapons.
 */

/** profile: { damage, range, cone, knockback, stun } */
export function meleeStrike(holder, profile) {
  const { player, enemies, world, audio, hud, fx } = holder;
  player.getAim(holder._origin, holder._fwd, holder._right, holder._up);
  const target = enemies.meleeTarget(holder._origin, holder._fwd, profile.range, profile.cone);

  let connected = false;
  if (target) {
    const centre = enemies.bodyCenter(target, holder._tmp);
    const dist = holder._origin.distanceTo(centre);
    holder._dir.subVectors(centre, holder._origin).divideScalar(dist || 1);
    connected = world.raycast(holder._origin, holder._dir, dist) >= dist - 0.3; // not behind a wall
  }

  if (!connected) {
    audio.punch(false);
    return;
  }

  const scale = target.def.scale;
  holder._to.copy(holder._tmp).addScaledVector(holder._dir, -0.45 * scale); // impact point on the near surface
  const flat = Math.hypot(holder._fwd.x, holder._fwd.z) || 1;
  const killed = enemies.damage(target, profile.damage, {
    dirX: holder._fwd.x / flat, dirZ: holder._fwd.z / flat, knock: profile.knockback, stun: profile.stun,
  });
  hud.damageNumber(holder._to, profile.damage, 'melee');
  hud.hitmarker(false, killed);
  fx.particles.burst(holder._to, 0xffffff, 7, 4.5, 0.09, 0.3, 8);
  player.addRecoil(0.012, (Math.random() - 0.5) * 0.02, 0);
  audio.punch(true);
  if (killed) audio.enemyKill();
  else audio.hitBeep(false);
}
