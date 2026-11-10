/*
 * Player settings: a flat list of named values (sliders, switches, choices) with ranges,
 * defaults, change notification and saving. The game supplies the definitions
 * (game/ui/settings-defs.js) and decides what each value does.
 *
 * A definition: { id, label, group, type: 'range' | 'toggle' | 'choice', default,
 *                 min, max, step (range), choices: [{ value, label }] (choice) }
 */

const STORAGE_VERSION = 1;

export class SettingsModel {
  /** @param options { storage, storageKey }; storage is { getItem, setItem } and may be missing or throw. */
  constructor(definitions, { storage = null, storageKey = 'settings' } = {}) {
    this.definitions = definitions;
    this.byId = new Map(definitions.map((definition) => [definition.id, definition]));
    this.storage = storage;
    this.storageKey = storageKey;
    this.values = new Map(definitions.map((definition) => [definition.id, definition.default]));
    this.listeners = new Set();
    this._load();
  }

  get(id) {
    return this.values.get(id);
  }

  /** Set a value, clamped or checked against its definition. Returns the value now in use. */
  set(id, value) {
    const definition = this.byId.get(id);
    if (!definition) return undefined;
    const accepted = this._coerce(definition, value);
    if (accepted === this.values.get(id)) return accepted;
    this.values.set(id, accepted);
    this._changed(id);
    return accepted;
  }

  reset(id = null) {
    for (const definition of this.definitions) {
      if (id === null || definition.id === id) this.values.set(definition.id, definition.default);
    }
    this._changed(id);
  }

  /** Called with the changed id (null when many changed). Returns an unsubscribe function. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _coerce(definition, value) {
    switch (definition.type) {
      case 'toggle':
        return Boolean(value);
      case 'choice':
        return definition.choices.some((choice) => choice.value === value) ? value : definition.default;
      default: {
        const number = Number(value);
        if (!Number.isFinite(number)) return definition.default;
        const clamped = Math.min(definition.max, Math.max(definition.min, number));
        return definition.step ? Math.round(clamped / definition.step) * definition.step : clamped;
      }
    }
  }

  _changed(id) {
    this._save();
    for (const listener of this.listeners) listener(id);
  }

  _save() {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.storageKey, JSON.stringify({ version: STORAGE_VERSION, values: Object.fromEntries(this.values) }));
    } catch {
      // Storage can be blocked; the settings then last for this session only.
    }
  }

  _load() {
    if (!this.storage) return;
    let saved;
    try {
      saved = JSON.parse(this.storage.getItem(this.storageKey) ?? 'null');
    } catch {
      return;
    }
    if (!saved || saved.version !== STORAGE_VERSION || typeof saved.values !== 'object') return;
    for (const [id, value] of Object.entries(saved.values)) {
      const definition = this.byId.get(id);
      if (definition) this.values.set(id, this._coerce(definition, value));
    }
  }
}
