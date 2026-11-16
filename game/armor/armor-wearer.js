import { findArmorPart } from './armor-parts.js';
import { loadArmorModel } from './armor-model.js';

/*
 * Puts the equipped armor on a BodyRig. `wear` is cheap to call every frame or every
 * network message: it only loads and swaps a slot when the equipped piece changed.
 * Models load in the background; a piece that is replaced before it arrives is dropped.
 * A skinned body that is given draws without its own head while a helmet is worn, and gets it back when the helmet comes off.
 */

export class ArmorWearer {
  /**
   * @param {import('../assets/body-rig.js').BodyRig} body
   * @param {(piece: object) => Promise<import('three').Object3D>} [loadModel] replaces the model loader (tests)
   * @param {{ setHeadVisible(visible: boolean): void } | null} [skin] the skinned model on this body, if there is one
   */
  constructor(body, loadModel = loadArmorModel, skin = null) {
    this.body = body;
    this.loadModel = loadModel;
    this.skin = skin;
    this.wanted = {}; // slot -> piece id that should be on the body
  }

  /** @param {Record<string, string | null>} equipped ArmorState.equipped, or the decoded `ar` key */
  wear(equipped) {
    for (const slot of this.body.armorSlots()) {
      const id = equipped[slot] ?? null;
      if (this.wanted[slot] === id || (id === null && this.wanted[slot] === undefined)) continue;
      this.wanted[slot] = id;
      if (id === null) this._take(slot);
      else this._fit(slot, findArmorPart(slot, id));
    }
  }

  _put(slot, model) {
    this.body.setArmor(slot, model);
    if (slot === 'head') this.skin?.setHeadVisible(false);
  }

  _take(slot) {
    this.body.setArmor(slot, null);
    if (slot === 'head') this.skin?.setHeadVisible(true);
  }

  async _fit(slot, piece) {
    try {
      const model = await this.loadModel(piece);
      if (this.wanted[slot] === piece.id) this._put(slot, model);
    } catch (error) {
      console.error(`Armor model ${piece.id} failed to load`, error);
    }
  }
}
