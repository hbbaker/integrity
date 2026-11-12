/*
 * The state message a player sends about themselves ~20 times a second, in short keys
 * (RemotePlayers reads it). Shared by every multiplayer mode so the avatars look the same.
 * The mech suit (see suit-network.js) rides along in it when the player has one in play.
 */

import { encodeSuit } from '../suit/suit-network.js';

const round2 = (value) => Math.round(value * 100) / 100;

/** @param suit what MechSuit.networkState() returns (null for no suit) */
export function poseMessage(player, weapons, suit = null) {
  return {
    t: 's',
    x: round2(player.pos.x), y: round2(player.pos.y), z: round2(player.pos.z),
    yw: round2(player.yaw), pt: round2(player.pitch),
    vx: round2(player.vel.x), vz: round2(player.vel.z),
    g: player.grounded ? 1 : 0, sl: player.sliding ? 1 : 0, sp: player.sprinting ? 1 : 0,
    cr: player.crouching ? 1 : 0, ln: round2(player.lean),
    w: weapons.index, a: round2(weapons.adsBlend), f: weapons.beamOn ? 1 : 0, r: weapons.reloading ? 1 : 0,
    al: player.alive ? 1 : 0, hp: Math.round(player.health),
    ...encodeSuit(suit),
  };
}
