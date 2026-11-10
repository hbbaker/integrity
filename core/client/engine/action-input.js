/*
 * Turns control presses (from the keyboard, mouse or a pad) into game input, through the bindings.
 *
 * The game's `state` object (the `input` the player and weapons read) gets plain fields.
 * What each action writes is described by the action table, so this file has no game words:
 *
 *   hold: 'fieldName'    true while any control bound to the action is down
 *   press: 'fieldName'   set to `value` (default true) on each press; the game clears it once handled
 *   command: true        also reported to `onCommand(actionId, { down, gateOpen })`, even when the gate is shut
 *
 * `gateOpen` says whether the game is accepting actions (pointer locked or pad engaged, player alive).
 * While it is shut, hold and press actions are ignored; releases always go through, so nothing sticks.
 */

import { familyOf } from './bindings.js';

export class ActionInput {
  /** @param deps { bindings, state, onCommand(actionId, info) } */
  constructor({ bindings, state, onCommand = () => {} }) {
    this.bindings = bindings;
    this.state = state;
    this.onCommand = onCommand;
    this.down = new Map(); // action id -> Set of controls holding it
    this.capture = null; // { family, callback } while the settings screen waits for a control
  }

  /**
   * A control went down. Returns true when it did something (so the caller can stop the browser's default).
   * While capturing a new binding the control is handed to the capture callback instead.
   */
  press(control, { gateOpen = true } = {}) {
    if (this.capture && familyOf(control) === this.capture.family) {
      const { callback } = this.capture;
      this.capture = null;
      callback(control);
      return true;
    }
    const actionIds = this.bindings.actionsFor(control);
    let used = false;
    for (const actionId of actionIds) {
      const action = this.bindings.byId.get(actionId);
      if (action.command) {
        this.onCommand(actionId, { down: true, gateOpen });
        used = true;
      }
      if (!gateOpen) continue;
      if (action.hold) this._hold(actionId, action, control);
      if (action.press) this.state[action.press] = action.value ?? true;
      used = used || Boolean(action.hold || action.press);
    }
    return used;
  }

  release(control) {
    for (const actionId of this.bindings.actionsFor(control)) {
      const action = this.bindings.byId.get(actionId);
      if (action.hold) this._unhold(actionId, action, control);
      if (action.command) this.onCommand(actionId, { down: false, gateOpen: true });
    }
  }

  /** Let go of everything (focus lost, pointer lock changed, death). */
  releaseAll() {
    for (const [actionId, controls] of this.down) {
      const action = this.bindings.byId.get(actionId);
      if (action?.hold) this.state[action.hold] = false;
      controls.clear();
    }
  }

  /** Ask for the next control in a family; `callback(control)` runs once. Cancel with cancelCapture(). */
  beginCapture(family, callback) {
    this.capture = { family, callback };
  }

  cancelCapture() {
    this.capture = null;
  }

  get capturing() {
    return this.capture !== null;
  }

  _hold(actionId, action, control) {
    if (!this.down.has(actionId)) this.down.set(actionId, new Set());
    this.down.get(actionId).add(control);
    this.state[action.hold] = true;
  }

  _unhold(actionId, action, control) {
    const controls = this.down.get(actionId);
    controls?.delete(control);
    if (!controls || controls.size === 0) this.state[action.hold] = false;
  }
}
