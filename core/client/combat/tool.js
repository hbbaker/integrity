/*
 * TOOL: a Holdable that is not a weapon: no ammo, no trigger of its own. A mode decides what the
 * trigger does with it (a shovel digs, a scanner scans). It is usually `hidden`, so it never shows
 * in the inventory menu, and the mode equips it directly.
 */

import { Holdable } from './holdable.js';

export class Tool extends Holdable {
  get melee() { return true; } // no aiming and no reloading while a tool is in hand

  /** A tool model animates while it swings. */
  modelState(holder) {
    return { swing: holder.swingT >= 0 };
  }
}
