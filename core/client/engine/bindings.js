/*
 * Control bindings: which keys, mouse buttons and pad buttons trigger which game action.
 *
 * The game supplies the action table (see game/ui/actions.js); this class owns the
 * rest: the current layout, rebinding with conflict handling, presets, reset, change
 * notification and saving. Nothing here knows what an action does.
 *
 * A *control* is one string:
 *   keyboard  KeyboardEvent.code   "KeyW", "Space", "ShiftLeft"
 *   mouse     "Mouse0" (left), "Mouse1", "Mouse2" (right), "WheelUp", "WheelDown"
 *   pad       "Pad0".."Pad16"      the browser's standard layout button numbers
 * Keyboard and mouse share one family ("keyboard"), the pad is the other ("gamepad"). Each
 * action has SLOT_COUNT slots per family, so there is a primary and a secondary control.
 */

export const FAMILIES = { KEYBOARD: 'keyboard', GAMEPAD: 'gamepad' };
export const SLOT_COUNT = 2;

const PAD_PREFIX = 'Pad';
const STORAGE_VERSION = 1;

/** Which family a control string belongs to. */
export function familyOf(control) {
  return control.startsWith(PAD_PREFIX) ? FAMILIES.GAMEPAD : FAMILIES.KEYBOARD;
}

export const padControl = (buttonIndex) => `${PAD_PREFIX}${buttonIndex}`;

const KEY_NAMES = {
  Space: 'SPACE', Tab: 'TAB', Enter: 'ENTER', Backspace: 'BACKSPACE', Escape: 'ESC', CapsLock: 'CAPS LOCK',
  ShiftLeft: 'LEFT SHIFT', ShiftRight: 'RIGHT SHIFT', ControlLeft: 'LEFT CTRL', ControlRight: 'RIGHT CTRL',
  AltLeft: 'LEFT ALT', AltRight: 'RIGHT ALT', ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
};
const MOUSE_NAMES = ['LEFT MOUSE', 'MIDDLE MOUSE', 'RIGHT MOUSE'];

/** A readable label for a control ("KeyW" -> "W", "Mouse0" -> "LEFT MOUSE"). `padLabels` maps "Pad0" to "A" or "CROSS". */
export function controlLabel(control, padLabels = {}) {
  if (control.startsWith(PAD_PREFIX)) return padLabels[control] ?? control.replace(PAD_PREFIX, 'BUTTON ');
  if (control.startsWith('Mouse')) return MOUSE_NAMES[Number(control.slice(5))] ?? `MOUSE ${control.slice(5)}`;
  if (control === 'WheelUp') return 'WHEEL UP';
  if (control === 'WheelDown') return 'WHEEL DOWN';
  return KEY_NAMES[control] ?? control.replace(/^(Key|Digit|Numpad)/, '').toUpperCase();
}

/** Per-action layout: { keyboard: [c1, c2], gamepad: [c1, c2] } with null for an empty slot. */
function emptyLayout() {
  return { [FAMILIES.KEYBOARD]: new Array(SLOT_COUNT).fill(null), [FAMILIES.GAMEPAD]: new Array(SLOT_COUNT).fill(null) };
}

function fitSlots(list = []) {
  const slots = new Array(SLOT_COUNT).fill(null);
  list.slice(0, SLOT_COUNT).forEach((control, index) => { slots[index] = control ?? null; });
  return slots;
}

export class Bindings {
  /**
   * @param actions [{ id, label, group, defaults: { keyboard: [...], gamepad: [...] } }, ...]
   * @param options { storage, storageKey, presets }
   *   storage: { getItem, setItem } (localStorage or a test double); may be missing or throw.
   *   presets: { NAME: { actionId: { gamepad: [...] } } }, partial layouts laid over the defaults.
   */
  constructor(actions, { storage = null, storageKey = 'bindings', presets = {} } = {}) {
    this.actions = actions;
    this.byId = new Map(actions.map((action) => [action.id, action]));
    this.storage = storage;
    this.storageKey = storageKey;
    this.presets = presets;
    this.layout = new Map();
    this.index = new Map(); // "family:control" -> [action ids]
    this.listeners = new Set();
    this._resetAll();
    this._load();
  }

  /** Controls (no empty slots) bound to an action in a family. */
  controlsFor(actionId, family) {
    return this.slots(actionId, family).filter(Boolean);
  }

  /** The SLOT_COUNT slots (nulls included) of an action in a family. */
  slots(actionId, family) {
    return this.layout.get(actionId)?.[family] ?? new Array(SLOT_COUNT).fill(null);
  }

  /** Action ids bound to a control. Used on every input event, so it reads a prebuilt index. */
  actionsFor(control) {
    return this.index.get(`${familyOf(control)}:${control}`) ?? [];
  }

  /**
   * Put `control` in a slot. If another action in the same family already uses it, that action
   * loses it (a control triggers one action per family). Returns the actions that lost it.
   */
  assign(actionId, family, slot, control) {
    if (!this.byId.has(actionId) || slot < 0 || slot >= SLOT_COUNT || familyOf(control) !== family) return [];
    const displaced = [];
    for (const [otherId, layout] of this.layout) {
      layout[family].forEach((existing, otherSlot) => {
        if (existing !== control || (otherId === actionId && otherSlot === slot)) return;
        layout[family][otherSlot] = null;
        if (otherId !== actionId) displaced.push(otherId);
      });
    }
    this.layout.get(actionId)[family][slot] = control;
    this._changed();
    return displaced;
  }

  clear(actionId, family, slot) {
    const layout = this.layout.get(actionId);
    if (!layout || slot < 0 || slot >= SLOT_COUNT) return;
    layout[family][slot] = null;
    this._changed();
  }

  /** Back to the game's defaults: one action, or (no id) every action in the family. */
  reset(family, actionId = null) {
    for (const action of this.actions) {
      if (actionId !== null && action.id !== actionId) continue;
      this.layout.get(action.id)[family] = fitSlots(action.defaults?.[family]);
    }
    this._changed();
  }

  /** Defaults, then the preset's changes on top. Applies to one family. */
  applyPreset(name, family) {
    const preset = this.presets[name];
    if (!preset) return false;
    this.reset(family);
    for (const [actionId, byFamily] of Object.entries(preset)) {
      if (this.layout.has(actionId) && byFamily[family]) this.layout.get(actionId)[family] = fitSlots(byFamily[family]);
    }
    this._changed();
    return true;
  }

  /** Called with no arguments after any change. Returns an unsubscribe function. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /* ------------------------------ internals ------------------------------ */

  _resetAll() {
    for (const action of this.actions) {
      const layout = emptyLayout();
      for (const family of Object.values(FAMILIES)) layout[family] = fitSlots(action.defaults?.[family]);
      this.layout.set(action.id, layout);
    }
    this._reindex();
  }

  _reindex() {
    this.index.clear();
    for (const [actionId, layout] of this.layout) {
      for (const family of Object.values(FAMILIES)) {
        for (const control of layout[family]) {
          if (!control) continue;
          const key = `${family}:${control}`;
          this.index.set(key, [...(this.index.get(key) ?? []), actionId]);
        }
      }
    }
  }

  _changed() {
    this._reindex();
    this._save();
    for (const listener of this.listeners) listener();
  }

  _save() {
    if (!this.storage) return;
    const data = { version: STORAGE_VERSION, layout: Object.fromEntries(this.layout) };
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(data));
    } catch {
      // Private windows and blocked storage throw; the layout then lasts for this session only.
    }
  }

  /** Read a saved layout. Unknown actions and malformed entries are ignored, so an old save never breaks. */
  _load() {
    if (!this.storage) return;
    let saved;
    try {
      saved = JSON.parse(this.storage.getItem(this.storageKey) ?? 'null');
    } catch {
      return;
    }
    if (!saved || saved.version !== STORAGE_VERSION || typeof saved.layout !== 'object') return;
    for (const [actionId, byFamily] of Object.entries(saved.layout)) {
      if (!this.layout.has(actionId) || typeof byFamily !== 'object') continue;
      for (const family of Object.values(FAMILIES)) {
        if (!Array.isArray(byFamily[family])) continue;
        const valid = byFamily[family].map((control) => (typeof control === 'string' && familyOf(control) === family ? control : null));
        this.layout.get(actionId)[family] = fitSlots(valid);
      }
    }
    this._reindex();
  }
}
