import { GrappleWeapon } from '../../core/client/combat/grapple-weapon.js';

/*
 * FIBER REEL: the grapple. Fire at a bot or another player to drag them to you; fire at a wall or the
 * floor to pull yourself to that spot. Fire again while the cable is out to let go; jumping lets go too
 * (and keeps your speed).
 *
 * TUNE THE REEL HERE. The generic grapple behaviour is in core/client/combat/grapple-weapon.js.
 */
export const REEL_TUNING = {
  range: 40, // metres the cable reaches
  aimRadius: 0.3, // metres of forgiveness when hooking a bot or player (bigger = easier)
  selfPullSpeed: 24, // m/s you fly toward a wall or the floor
  targetPullSpeed: 18, // m/s a bot or player is dragged toward you
  arriveDistance: 1.6, // metres: the pull stops this far from its goal
  maxSeconds: 2.5, // a pull gives up after this long, however far it is
  cooldown: 1.0, // seconds before the next shot, or before you can let go
  missSeconds: 0.18, // how long the cable shows when it hits nothing
  cableColor: 0xc89bff, // fibre purple
  cableRadius: 0.012, // metres
};

export class FiberReel extends GrappleWeapon {
  get tuning() {
    return REEL_TUNING;
  }
}
