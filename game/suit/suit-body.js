/*
 * How the suit changes the player's body. The hit cylinder, eye heights and step height all grow with the
 * suit, so it feels (and collides) like the larger frame, and the health pool is the player's own times the
 * suit's health multiple.
 */

const SCALED_KEYS = ['radius', 'eyeHeight', 'slideEyeHeight', 'crouchEyeHeight', 'stepHeight'];

/** Overrides for `Player.setBody`: the player's own numbers times the suit scale, and the suit's health. */
export function suitBodyOverrides(playerCfg, scale, healthMul = 1) {
  return { ...Object.fromEntries(SCALED_KEYS.map((key) => [key, playerCfg[key] * scale])), maxHealth: playerCfg.maxHealth * healthMul };
}
