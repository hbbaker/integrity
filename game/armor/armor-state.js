import { ARMOR_SLOTS, emptyEquipment, findArmorPart, sanitizeEquipment } from './armor-parts.js';

/*
 * Which armor piece the player has equipped in each slot. Saved between sessions.
 */

const STORAGE_KEY = 'oneshot.armor';

export class ArmorState {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.equipped = emptyEquipment();
    this.listeners = new Set();
    this._load();
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Equip a piece, or pass `null` to empty the slot. Listeners get `{ slot }`. */
  equip(slot, id) {
    if (!ARMOR_SLOTS.includes(slot)) throw new Error(`Unknown armor slot ${slot}`);
    if (id !== null) findArmorPart(slot, id);
    this.equipped[slot] = id;
    this._changed(slot);
  }

  _changed(slot) {
    this._save();
    for (const listener of this.listeners) listener({ slot });
  }

  _load() {
    try {
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? 'null');
      if (saved) this.equipped = sanitizeEquipment(saved);
    } catch {
      // Storage blocked or corrupt: start with nothing equipped.
    }
  }

  _save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.equipped));
    } catch {
      // Storage blocked: the choices are not remembered.
    }
  }
}
