/*
 * Deathmatch spawn choice: try random open ground spots and take the one
 * farthest from every other player, so you rarely respawn in someone's face.
 */

const PLAYER_RADIUS = 0.6; // clearance a spawn needs around it
const FLAT_GROUND = 0.3; // only spawn on ground-level floor, not on top of props

/**
 * @param options { world, half, others: [{x, z}], tries, margin }
 * Returns { x, y, z, yaw } with the player facing the arena centre.
 */
export function pickSpawnPoint({ world, half, others, tries = 40, margin = 4 }) {
  const reach = half - margin;
  let best = { x: 0, z: reach, score: -1 };
  for (let i = 0; i < tries; i++) {
    const x = (Math.random() * 2 - 1) * reach;
    const z = (Math.random() * 2 - 1) * reach;
    if (world.groundHeight(x, z) > FLAT_GROUND || world.isBlocked(x, z, PLAYER_RADIUS, 0)) continue;
    const score = others.length ? Math.min(...others.map((o) => Math.hypot(o.x - x, o.z - z))) : Math.random();
    if (score > best.score) best = { x, z, score };
  }
  return { x: best.x, y: world.groundHeight(best.x, best.z), z: best.z, yaw: Math.atan2(best.x, best.z) };
}
