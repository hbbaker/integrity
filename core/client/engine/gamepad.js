/*
 * Controller support for pads that use the browser's "standard" layout (Xbox, PlayStation and most others:
 * Xbox A/B/X/Y = PlayStation Cross/Circle/Square/Triangle, all with the same button numbers).
 *
 * Buttons go through the bindings (see bindings.js): the pad reports "Pad<number>" controls to the
 * ActionInput, so players can remap them. Only the sticks and the menu buttons are fixed here:
 *   - the move stick and the look stick (a setting swaps them for a southpaw layout)
 *   - in menus: D-pad / left stick move a highlight, A presses, B goes back, START takes the game
 *
 * Two states:
 *   menu (not engaged): the pad drives the screens.
 *   engaged: the pad plays the game. Browsers give a pad no pointer lock, so `engaged` stands in for it.
 */

import { padControl } from './bindings.js';

/** Fixed standard-layout button numbers used for the menu controls and stick clicks. */
export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};

const TRIGGERS = new Set([PAD.LT, PAD.RT]);
const AXIS = { LEFT_X: 0, LEFT_Y: 1, RIGHT_X: 2, RIGHT_Y: 3 };
const FOCUS_CLASS = 'pad-focus';
const DEFAULT_MENU_SELECTOR = '.overlay button:not([disabled])';
const NAV_STICK_THRESHOLD = 0.6;
const CROSS_AXIS_WEIGHT = 2; // when moving the highlight, a target off to the side counts this much further away

/** Zero inside the dead zone, then rescaled so the output still reaches 1 at full tilt. */
export function applyDeadzone(x, y, deadzone) {
  const length = Math.hypot(x, y);
  if (length <= deadzone) return { x: 0, y: 0, length: 0 };
  const scaled = Math.min(1, (length - deadzone) / (1 - deadzone));
  return { x: (x / length) * scaled, y: (y / length) * scaled, length: scaled };
}

/** Names of the fields the move stick writes on the game's input state. */
const DEFAULT_FIELDS = {
  forward: 'forward', back: 'back', left: 'left', right: 'right',
  analogActive: 'analogActive', analogX: 'analogX', analogY: 'analogY',
};

export class GamepadInput {
  /**
   * @param deps {
   *   config:   { deadzone, moveThreshold, triggerThreshold, lookSpeed (rad/s), lookCurve, invertY, moveStick: 'left'|'right', navRepeat }
   *             (read live, so the settings screen can change it),
   *   actionInput, state,
   *   mouseSensitivity()  the player's current look sensitivity (radians per mouse pixel),
   *   look(dx, dy)        in mouse-pixel units, so the player's own sensitivity maths still applies,
   *   pause()             the pad paused the game,
   *   engage()            start controlling the game; returns true when it did,
   *   confirm(button)     A pressed on a highlighted menu button,
   *   back()              B pressed in a menu,
   *   fields, getPads,
   *   menuSelector        CSS selector (or a function returning one) for what the highlight can land on (default: the buttons in overlays),
   *   vibration()         true when the player wants rumble
   * }
   */
  constructor({
    config, actionInput, state, mouseSensitivity, look, pause, engage, confirm, back = () => {}, fields = DEFAULT_FIELDS, getPads,
    menuSelector = DEFAULT_MENU_SELECTOR, vibration = () => false,
  }) {
    this.config = config;
    this.actionInput = actionInput;
    this.state = state;
    this.mouseSensitivity = mouseSensitivity;
    this.fields = fields;
    this.menuSelector = menuSelector;
    this.vibration = vibration;
    this.pad = null; // the connected pad, for rumble
    this.actions = { look, pause, engage, confirm, back };
    this.getPads = getPads ?? (() => (navigator.getGamepads ? navigator.getGamepads() : []));
    this.engaged = false;
    this.connected = false;
    this.id = ''; // the pad's name, so the screens can show Xbox or PlayStation button labels
    this.heldMoves = {}; // last value the move stick wrote for each direction
    this.down = new Set(); // buttons down on the previous poll
    this.latched = new Map(); // control -> true while a latching action (sprint) is held on
    this.navClock = 0;
    this.navDirection = 0;
    this.focused = null;
  }

  /**
   * Read the pad once per rendered frame.
   * @param dt seconds since the last poll
   * @param canAct true while the player is alive and a game is running
   */
  poll(dt, canAct) {
    const pad = this._activePad();
    this.pad = pad;
    this.connected = Boolean(pad);
    if (!pad) {
      this.id = '';
      if (this.engaged || this.down.size) this.disengage(); // unplugged mid-game
      return;
    }
    this.id = pad.id;
    const { pressed, released } = this._changes(pad);
    if (this.engaged) {
      if (canAct) this._play(pad, pressed, released, dt);
      else this._releaseAll();
    } else {
      this._menu(pad, pressed, dt);
    }
  }

  /** Stop controlling the game: release every control and go back to menu mode. */
  disengage() {
    this._releaseAll();
    this.engaged = false;
  }

  /** The first connected pad with the standard layout. */
  _activePad() {
    for (const pad of this.getPads()) {
      if (pad && pad.connected && pad.mapping === 'standard') return pad;
    }
    return null;
  }

  /** Buttons that went down or up since the last poll. Triggers count as down past the trigger threshold. */
  _changes(pad) {
    const pressed = new Set();
    const released = new Set();
    const nowDown = new Set();
    pad.buttons.forEach((button, index) => {
      const isDown = TRIGGERS.has(index) ? (button.value ?? 0) >= this.config.triggerThreshold : Boolean(button.pressed);
      if (isDown) nowDown.add(index);
      if (isDown && !this.down.has(index)) pressed.add(index);
    });
    for (const index of this.down) if (!nowDown.has(index)) released.add(index);
    this.down = nowDown;
    return { pressed, released };
  }

  /* ------------------------------- playing -------------------------------- */

  _play(pad, pressed, released, dt) {
    for (const index of released) this._releaseButton(index);
    for (const index of pressed) {
      this._pressButton(index);
      if (!this.engaged) return; // a command (pause) handed control back
    }
    const { move, look } = this._sticks(pad);
    this._move(move);
    this._look(look, dt);
  }

  _pressButton(index) {
    const control = padControl(index);
    const latching = this._latchingAction(control);
    if (latching && this.latched.has(control)) { // a second press ends the latched hold
      this._unlatch(control);
      return;
    }
    this.actionInput.press(control, { gateOpen: true });
    if (latching) this.latched.set(control, true);
  }

  _releaseButton(index) {
    const control = padControl(index);
    if (this.latched.has(control)) return; // stays held until the stick is let go or the button is pressed again
    this.actionInput.release(control);
  }

  /** An action flagged `latchWhileMoving` (sprint) stays on after the button is released, until the stick centres. */
  _latchingAction(control) {
    return this.actionInput.bindings.actionsFor(control).some((id) => this.actionInput.bindings.byId.get(id).latchWhileMoving);
  }

  _unlatch(control) {
    this.latched.delete(control);
    this.actionInput.release(control);
  }

  /** The stick that moves and the stick that looks, each deadzoned. */
  _sticks(pad) {
    const left = applyDeadzone(pad.axes[AXIS.LEFT_X], pad.axes[AXIS.LEFT_Y], this.config.deadzone);
    const right = applyDeadzone(pad.axes[AXIS.RIGHT_X], pad.axes[AXIS.RIGHT_Y], this.config.deadzone);
    return this.config.moveStick === 'right' ? { move: right, look: left } : { move: left, look: right };
  }

  /** Move stick: four directions for the held-key logic, plus exact direction and throttle for walk speed. */
  _move(move) {
    const { fields, state, config } = this;
    const threshold = config.moveThreshold;
    this._holdMove(fields.forward, move.y < -threshold);
    this._holdMove(fields.back, move.y > threshold);
    this._holdMove(fields.left, move.x < -threshold);
    this._holdMove(fields.right, move.x > threshold);
    state[fields.analogActive] = move.length > 0;
    state[fields.analogX] = move.x;
    state[fields.analogY] = move.y;
    if (move.length === 0) for (const control of [...this.latched.keys()]) this._unlatch(control);
  }

  /** Look stick: turn rate in radians per second, with a curve so small pushes aim finely. */
  _look(stick, dt) {
    const { config } = this;
    if (stick.length === 0) return;
    const curved = stick.length ** config.lookCurve / stick.length;
    const radians = config.lookSpeed * dt;
    const invert = config.invertY ? -1 : 1;
    this.actions.look(
      (stick.x * curved * radians) / this.mouseSensitivity(),
      (stick.y * curved * radians * invert) / this.mouseSensitivity(),
    );
  }

  /** Write a move direction only when it changes, so a keyboard held at the same time is not cancelled. */
  _holdMove(field, value) {
    if (this.heldMoves[field] === value) return;
    this.heldMoves[field] = value;
    this.state[field] = value;
  }

  /** Let go of everything this pad holds (death, pause, unplugging). */
  _releaseAll() {
    for (const index of this.down) this.actionInput.release(padControl(index));
    for (const control of this.latched.keys()) this.actionInput.release(control);
    this.latched.clear();
    this.down = new Set();
    for (const [field, value] of Object.entries(this.heldMoves)) if (value) this.state[field] = false;
    this.heldMoves = {};
    this.state[this.fields.analogActive] = false;
  }

  /* -------------------------------- menus --------------------------------- */

  _menu(pad, pressed, dt) {
    if (this.actionInput.capture?.family === 'gamepad') { // the settings screen is waiting for a button
      for (const index of pressed) if (this.actionInput.press(padControl(index))) break;
      return;
    }
    if (pressed.has(PAD.START) && this.actions.engage()) return;
    this._moveHighlight(pad, pressed, dt);
    if (pressed.has(PAD.B)) this.actions.back();
    if (!pressed.has(PAD.A)) return;
    const button = this.focused && isVisible(this.focused) ? this.focused : null;
    if (button) this.actions.confirm(button);
    else this.actions.engage();
  }

  /** D-pad or left stick: move the highlight to the nearest target in that direction. Holding the stick repeats. */
  _moveHighlight(pad, pressed, dt) {
    const stick = applyDeadzone(pad.axes[AXIS.LEFT_X], pad.axes[AXIS.LEFT_Y], this.config.deadzone);
    const isDown = (index) => this.down.has(index);
    let dx = 0;
    let dy = 0;
    if (isDown(PAD.LEFT)) dx = -1;
    else if (isDown(PAD.RIGHT)) dx = 1;
    else if (isDown(PAD.UP)) dy = -1;
    else if (isDown(PAD.DOWN)) dy = 1;
    else if (Math.abs(stick.x) > NAV_STICK_THRESHOLD && Math.abs(stick.x) >= Math.abs(stick.y)) dx = Math.sign(stick.x);
    else if (Math.abs(stick.y) > NAV_STICK_THRESHOLD) dy = Math.sign(stick.y);
    const fresh = [PAD.UP, PAD.DOWN, PAD.LEFT, PAD.RIGHT].some((index) => pressed.has(index));
    this.navClock -= dt;
    if (dx === 0 && dy === 0) {
      this.navDirection = '';
      return;
    }
    const direction = `${dx},${dy}`;
    if (!fresh && direction === this.navDirection && this.navClock > 0) return;
    this.navDirection = direction;
    this.navClock = this.config.navRepeat;
    this._step(dx, dy);
  }

  _targets() {
    const selector = typeof this.menuSelector === 'function' ? this.menuSelector() : this.menuSelector;
    return [...document.querySelectorAll(selector)].filter(isVisible);
  }

  /** Land on the nearest target in direction (dx, dy). Without layout (no sizes known) it steps through them in order. */
  _step(dx, dy) {
    const targets = this._targets();
    if (targets.length === 0) return;
    const at = targets.indexOf(this.focused);
    const forward = dx + dy > 0;
    if (at === -1) {
      this.setFocus(targets[forward ? 0 : targets.length - 1]);
      return;
    }
    const nearest = nearestInDirection(targets, at, dx, dy);
    if (nearest !== -1) {
      this.setFocus(targets[nearest]);
      return;
    }
    this.setFocus(targets[(at + (forward ? 1 : -1) + targets.length) % targets.length]); // nothing that way: wrap around
  }

  setFocus(button) {
    this.focused?.classList.remove(FOCUS_CLASS);
    this.focused = button;
    button?.classList.add(FOCUS_CLASS);
  }

  clearFocus() {
    this.setFocus(null);
  }

  /** A short rumble, if the player wants one and the pad can. `weak` and `strong` are motor strengths 0..1. */
  rumble(seconds, weak, strong) {
    const actuator = this.pad?.vibrationActuator;
    if (!actuator || !this.vibration()) return;
    actuator.playEffect('dual-rumble', { duration: seconds * 1000, weakMagnitude: weak, strongMagnitude: strong }).catch(() => {});
  }
}

function isVisible(element) {
  return element.getClientRects().length > 0;
}

function centre(element) {
  const rect = element.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 };
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, known: rect.width > 0 || rect.height > 0 };
}

/** Index of the target closest in direction (dx, dy) from targets[at], or -1 when none lies that way or no layout is known. */
function nearestInDirection(targets, at, dx, dy) {
  const from = centre(targets[at]);
  if (!from.known) return -1;
  let best = -1;
  let bestScore = Infinity;
  targets.forEach((target, index) => {
    if (index === at) return;
    const to = centre(target);
    const along = (to.x - from.x) * dx + (to.y - from.y) * dy;
    if (along <= 1) return; // not in that direction
    const across = Math.abs((to.x - from.x) * dy) + Math.abs((to.y - from.y) * dx);
    const score = along + CROSS_AXIS_WEIGHT * across;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}
