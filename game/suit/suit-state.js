import { defaultSelection, sanitizeSelection, SUIT_SLOTS, findPart } from './suit-parts.js';

/*
 * What the player has done with the suit: whether they own it, which part sits in
 * each slot, where it stands in the world and whether they are inside it.
 * Only the owned flag and the part choices are saved between sessions.
 */

const STORAGE_KEY = 'oneshot.suit';

export class SuitState {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.owned = false;
    this.selection = defaultSelection();
    this.placed = null; // { x, z, yaw } while a suit stands in the world
    this.occupied = false; // the player is inside it
    this.listeners = new Set();
    this._load();
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setOwned(owned) {
    this.owned = owned;
    this._changed();
  }

  /** Fit one part. `changed` listeners get `{ slot }` so a model can rebuild only that slot. */
  setPart(slot, id) {
    if (!SUIT_SLOTS.includes(slot)) throw new Error(`Unknown suit slot ${slot}`);
    findPart(slot, id);
    this.selection[slot] = id;
    this._changed(slot);
  }

  place(x, z, yaw) {
    this.placed = { x, z, yaw };
    this._changed();
  }

  pickUp() {
    this.placed = null;
    this.occupied = false;
    this._changed();
  }

  setOccupied(occupied) {
    this.occupied = occupied;
    this._changed();
  }

  _changed(slot = null) {
    this._save();
    for (const listener of this.listeners) listener({ slot });
  }

  _load() {
    try {
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? 'null');
      if (!saved) return;
      this.owned = saved.owned === true;
      this.selection = sanitizeSelection(saved.selection);
    } catch {
      // Storage blocked or corrupt: start with the defaults.
    }
  }

  _save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({ owned: this.owned, selection: this.selection }));
    } catch {
      // Storage blocked: the choices simply are not remembered.
    }
  }
}
