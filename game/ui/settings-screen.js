import { FAMILIES, SLOT_COUNT, controlLabel } from '../../core/client/engine/bindings.js';

/*
 * The SETTINGS screen: rebind keys, mouse buttons and pad buttons, pick a pad layout, and adjust
 * sensitivity. Every control is a button (sliders are minus / plus buttons), so the screen works
 * with a mouse, a keyboard or a pad alone.
 *
 * Rebinding: click a slot, then press the new key, mouse button or pad button. Escape cancels; so does waiting.
 * A control can trigger one action per family, so binding a taken control moves it, and the screen says so.
 */

const CAPTURE_TIMEOUT_MS = 6000; // a pad cannot press "cancel" while it is being asked for a button, so waiting cancels
const TABS = [
  { id: 'keyboard', label: 'KEYBOARD & MOUSE' },
  { id: 'gamepad', label: 'GAMEPAD' },
  { id: 'sensitivity', label: 'SENSITIVITY & VIEW' },
];
const EMPTY_SLOT = '—';

function make(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(className, text, onClick) {
  const element = make('button', className, text);
  element.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return element;
}

export class SettingsScreen {
  /**
   * @param deps {
   *   bindings, settings, actionInput,
   *   actions (the action table), actionGroups, settingDefs, settingGroups, presets (pad layouts),
   *   padLabels() -> { Pad0: 'A', ... } for the connected pad,
   *   onClose()
   * }
   */
  constructor({ bindings, settings, actionInput, actions, actionGroups, settingDefs, settingGroups, presets, padLabels, onClose }) {
    Object.assign(this, { bindings, settings, actionInput, actions, actionGroups, settingDefs, settingGroups, presets, padLabels, onClose });
    const $ = (id) => document.getElementById(id);
    this.el = {
      overlay: $('overlay-settings'), tabs: $('settings-tabs'), message: $('settings-message'),
      body: $('settings-body'), reset: $('settings-reset'), back: $('settings-back'),
    };
    this.tab = 'keyboard';
    this.isOpen = false;
    this.capturing = null; // { button } while waiting for a control
    this.captureTimer = 0;
    this.refreshers = [];

    this.el.overlay.addEventListener('click', (event) => event.stopPropagation());
    this.el.back.addEventListener('click', (event) => {
      event.stopPropagation();
      this.close();
    });
    this.el.reset.addEventListener('click', (event) => {
      event.stopPropagation();
      this._resetTab();
    });
    this._buildTabs();
    bindings.subscribe(() => this.refresh());
    settings.subscribe(() => this.refresh());
  }

  open() {
    this.isOpen = true;
    this.el.overlay.style.display = 'flex';
    this._showTab(this.tab);
  }

  close() {
    this._stopCapture();
    this.isOpen = false;
    this.el.overlay.style.display = 'none';
    this.onClose();
  }

  /** Escape: cancel a rebind first, then leave the screen. Returns true (the key was used). */
  onEscape() {
    if (this.capturing) this._stopCapture();
    else this.close();
    return true;
  }

  /** Update every label from the current bindings and settings (no rebuild, so a pad's highlight stays put). */
  refresh() {
    for (const update of this.refreshers) update();
  }

  /* -------------------------------- tabs ---------------------------------- */

  _buildTabs() {
    this.tabButtons = TABS.map((tab) => {
      const element = button('panel menu-btn set-tab', tab.label, () => this._showTab(tab.id));
      this.el.tabs.appendChild(element);
      return { id: tab.id, element };
    });
  }

  _showTab(id) {
    this._stopCapture();
    this.tab = id;
    this.message('');
    for (const tab of this.tabButtons) tab.element.classList.toggle('active', tab.id === id);
    this.el.body.replaceChildren();
    this.refreshers = [];
    if (id === 'sensitivity') this._buildSensitivity();
    else this._buildBindings(id === 'keyboard' ? FAMILIES.KEYBOARD : FAMILIES.GAMEPAD);
    this.refresh();
  }

  _resetTab() {
    if (this.tab === 'sensitivity') this.settings.reset();
    else this.bindings.reset(this.tab === 'keyboard' ? FAMILIES.KEYBOARD : FAMILIES.GAMEPAD);
    this.message('RESET TO DEFAULTS');
  }

  message(text) {
    this.el.message.textContent = text;
  }

  /* ------------------------------- bindings ------------------------------- */

  _buildBindings(family) {
    const { body } = this.el;
    if (family === FAMILIES.GAMEPAD) {
      const row = make('div', 'set-row');
      row.appendChild(make('span', 'set-label', 'LAYOUT'));
      for (const name of Object.keys(this.presets)) {
        row.appendChild(button('panel set-btn', name, () => {
          this.bindings.applyPreset(name, family);
          this.message(`LAYOUT: ${name}`);
        }));
      }
      body.appendChild(row);
      body.appendChild(make('div', 'set-note', 'THE STICKS MOVE AND LOOK. SWAP THEM UNDER SENSITIVITY.'));
    }
    for (const group of this.actionGroups) {
      const actions = this.actions.filter((action) => action.group === group);
      if (!actions.length) continue;
      body.appendChild(make('h3', '', group));
      for (const action of actions) body.appendChild(this._bindingRow(action, family));
    }
  }

  _bindingRow(action, family) {
    const row = make('div', 'set-row');
    row.appendChild(make('span', 'set-label', action.label));
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const slotButton = button('panel set-btn set-slot', EMPTY_SLOT, () => this._beginCapture(slotButton, action, family, slot));
      row.appendChild(slotButton);
      this.refreshers.push(() => {
        if (this.capturing?.button === slotButton) return;
        const control = this.bindings.slots(action.id, family)[slot];
        slotButton.textContent = control ? controlLabel(control, this.padLabels()) : EMPTY_SLOT;
      });
    }
    row.appendChild(button('panel set-btn set-clear', 'CLEAR', () => {
      for (let slot = 0; slot < SLOT_COUNT; slot++) this.bindings.clear(action.id, family, slot);
    }));
    return row;
  }

  _beginCapture(slotButton, action, family, slot) {
    this._stopCapture();
    this.capturing = { button: slotButton };
    slotButton.textContent = family === FAMILIES.GAMEPAD ? 'PRESS A BUTTON…' : 'PRESS A KEY…';
    this.message(`${action.label}: PRESS THE NEW CONTROL. ESC CANCELS.`);
    this.captureTimer = setTimeout(() => this._stopCapture(), CAPTURE_TIMEOUT_MS);
    this.actionInput.beginCapture(family, (control) => {
      clearTimeout(this.captureTimer);
      this.capturing = null;
      const taken = this.bindings.assign(action.id, family, slot, control);
      const names = taken.map((id) => this.actions.find((entry) => entry.id === id).label);
      this.message(names.length ? `${controlLabel(control, this.padLabels())} MOVED FROM ${names.join(', ')}` : '');
      this.refresh();
    });
  }

  _stopCapture() {
    if (!this.capturing) return;
    clearTimeout(this.captureTimer);
    this.actionInput.cancelCapture();
    this.capturing = null;
    this.refresh();
  }

  /* ----------------------------- sensitivity ------------------------------ */

  _buildSensitivity() {
    for (const group of this.settingGroups) {
      this.el.body.appendChild(make('h3', '', group));
      for (const definition of this.settingDefs.filter((entry) => entry.group === group)) {
        this.el.body.appendChild(this._settingRow(definition));
      }
    }
  }

  _settingRow(definition) {
    const row = make('div', 'set-row');
    row.appendChild(make('span', 'set-label', definition.label));
    const value = make('span', 'set-value');
    const { settings } = this;
    if (definition.type === 'range') {
      row.appendChild(button('panel set-btn', '−', () => settings.set(definition.id, settings.get(definition.id) - definition.step)));
      row.appendChild(value);
      row.appendChild(button('panel set-btn', '+', () => settings.set(definition.id, settings.get(definition.id) + definition.step)));
      const decimals = (String(definition.step).split('.')[1] ?? '').length;
      this.refreshers.push(() => { value.textContent = Number(settings.get(definition.id)).toFixed(decimals); });
    } else {
      const toggle = button('panel set-btn set-wide', '', () => settings.set(definition.id, this._nextValue(definition)));
      row.appendChild(toggle);
      this.refreshers.push(() => { toggle.textContent = this._valueLabel(definition); });
    }
    return row;
  }

  _valueLabel(definition) {
    const current = this.settings.get(definition.id);
    if (definition.type === 'toggle') return current ? 'ON' : 'OFF';
    return definition.choices.find((choice) => choice.value === current)?.label ?? String(current);
  }

  /** The value a toggle or choice cycles to when pressed. */
  _nextValue(definition) {
    const current = this.settings.get(definition.id);
    if (definition.type === 'toggle') return !current;
    const at = definition.choices.findIndex((choice) => choice.value === current);
    return definition.choices[(at + 1) % definition.choices.length].value;
  }
}
