/*
 * MELEE WEAPON: a Weapon with no ammo that strikes on the trigger (fists, a wrench, a bat).
 */

import { Weapon } from './weapon.js';
import { meleeStrike } from './melee.js';

export class MeleeWeapon extends Weapon {
  pull(holder, dt, input) {
    this._fireIfWanted(holder, input);
  }

  tryFire(holder) {
    const c = this.cfg;
    holder.triggerBuffer = 0;
    holder.cooldown = c.interval;
    meleeStrike(holder, c);
    holder.startMeleeAnim(true);
  }
}
