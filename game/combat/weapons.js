/*
 * CABLE BOTS weapons: the core's HoldableSystem set up with this game's item types and models.
 * New kinds of holdable go in HOLDABLE_TYPES (a class that extends Holdable) and new looks in
 * game/assets/holdable-models.js; the list of items itself is CONFIG.weapons.list in game/main.js.
 */

import { HoldableSystem } from '../../core/client/combat/holdable-system.js';
import { BeamWeapon } from '../../core/client/combat/beam-weapon.js';
import { Firearm } from '../../core/client/combat/firearm.js';
import { MeleeWeapon } from '../../core/client/combat/melee-weapon.js';
import { Tool } from '../../core/client/combat/tool.js';
import { FiberReel } from './fiber-reel.js';
import { HOLDABLE_MODELS } from '../assets/holdable-models.js';

/** The `type` of a CONFIG.weapons.list entry -> the class that builds the item. */
export const HOLDABLE_TYPES = {
  firearm: Firearm,
  beam: BeamWeapon,
  melee: MeleeWeapon,
  tool: Tool,
  grapple: FiberReel,
};

export class Weapons extends HoldableSystem {
  /** @param deps { cfg (the whole CONFIG), camera, mainScene, envMap, world, enemies, player, fx, hud, audio } */
  constructor({ cfg, ...services }) {
    super({ config: cfg.weapons, types: HOLDABLE_TYPES, models: HOLDABLE_MODELS, ...services });
  }
}
