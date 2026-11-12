/*
 * CABLE BOTS weapons. Every weapon lives in its own file in this folder and exports a `weapon`:
 *
 *   config    its entry in CONFIG.weapons.list (damage, ammo, recoil, sights: all its numbers)
 *   holdable  { type, class }: the Holdable class that runs it, under the name config.type uses
 *   model     { build(), held?, beamColor? }: how it looks in the hands
 *
 * To add a weapon: copy a file that is close to what you want (nail-gun.js for a gun, shovel.js for a tool,
 * fiber-reel.js for something with its own behaviour), then add it to WEAPONS below. The order is the order
 * of the list: index 0 is the always-available item (the gloves) and index 1 is what you start with.
 * A brand new kind of behaviour is a new class that extends Holdable (see core/client/combat/holdable.js).
 */

import { HoldableSystem } from '../../core/client/combat/holdable-system.js';
import { setArmsEnabled, tickSharedGlow } from './shared.js';
import { weapon as workGloves } from './work-gloves.js';
import { weapon as nailGun } from './nail-gun.js';
import { weapon as rivetBlaster } from './rivet-blaster.js';
import { weapon as framingNailer } from './framing-nailer.js';
import { weapon as arcTorch } from './arc-torch.js';
import { weapon as transitRifle } from './transit-rifle.js';
import { weapon as shovel } from './shovel.js';
import { weapon as fiberReel } from './fiber-reel.js';
import { weapon as boringLauncher } from './boring-launcher.js';
import { weapon as stopSign } from './stop-sign.js';
import { weapon as lastWord } from './last-word.js';
import { weapon as suitBeacon } from './suit-beacon.js';

/** In list order: the position here is the item's index everywhere (loadout slots, the wheel, the inventory). */
export const WEAPONS = [workGloves, nailGun, rivetBlaster, framingNailer, arcTorch, transitRifle, shovel, fiberReel, boringLauncher, stopSign, lastWord, suitBeacon];

/** CONFIG.weapons.list. */
export const WEAPON_LIST = WEAPONS.map((entry) => entry.config);

/** The `type` of a list entry -> the class that builds the item. */
export const HOLDABLE_TYPES = Object.fromEntries(WEAPONS.map((entry) => [entry.holdable.type, entry.holdable.class]));

/**
 * Model definitions by item id:
 *   build()       the first-person model
 *   held: false   the third-person character holds nothing for this item (the gloves)
 *   beamColor     for beam weapons: (power, outColor) -> colour
 */
export const HOLDABLE_MODELS = Object.fromEntries(WEAPONS.map((entry) => [entry.config.id, withSharedGlow(entry.model)]));

/** The same model definition, but every model it builds also moves the shared glow (sleeve rings, circuit traces) along the RGB cycle. */
function withSharedGlow(model) {
  return {
    ...model,
    build() {
      const built = model.build();
      const animate = built.animate;
      built.animate = (dt, time, state) => {
        tickSharedGlow(time);
        animate(dt, time, state);
      };
      return built;
    },
  };
}

/** An item model with no first-person hands or sleeves, for the third-person character to hold. Null when it holds nothing. */
export function buildHeldModel(id) {
  const def = HOLDABLE_MODELS[id];
  if (def.held === false) return null;
  setArmsEnabled(false);
  try {
    return def.build();
  } finally {
    setArmsEnabled(true);
  }
}

/** The core's HoldableSystem set up with this game's weapons. */
export class Weapons extends HoldableSystem {
  /** @param deps { cfg (the whole CONFIG), camera, mainScene, world, enemies, player, fx, hud, audio } */
  constructor({ cfg, ...services }) {
    super({ config: cfg.weapons, types: HOLDABLE_TYPES, models: HOLDABLE_MODELS, ...services });
  }
}
