/*
 * Keyboard, mouse and pointer-lock input. It reports controls to an ActionInput; which action a control
 * triggers comes from the bindings, so there are no key codes in this file except Escape,
 * which the browser reserves for releasing the pointer.
 */

const ESCAPE = 'Escape';
const WHEEL_UP = 'WheelUp';
const WHEEL_DOWN = 'WheelDown';

export class DeviceInput {
  /**
   * @param deps {
   *   actionInput,
   *   gateOpen(): true while the game accepts actions (pointer locked, player alive),
   *   ignoreEvent(event): true for events that are not for the game (typing in a text field),
   *   onEscape(event): true if handled (a menu closes); capture is cancelled before this is asked,
   *   onLook(dx, dy): mouse movement while the gate is open,
   *   target: the event target (document),
   * }
   */
  constructor({ actionInput, gateOpen, ignoreEvent = () => false, onEscape = () => false, onLook = () => {}, target = document }) {
    this.actionInput = actionInput;
    this.gateOpen = gateOpen;
    this.ignoreEvent = ignoreEvent;
    this.onEscape = onEscape;
    this.onLook = onLook;
    this.target = target;
  }

  attach() {
    const { target } = this;
    target.addEventListener('keydown', (event) => this._keyDown(event));
    target.addEventListener('keyup', (event) => this.actionInput.release(event.code));
    target.addEventListener('mousedown', (event) => this._mouseDown(event));
    target.addEventListener('mouseup', (event) => this.actionInput.release(`Mouse${event.button}`));
    target.addEventListener('contextmenu', (event) => event.preventDefault());
    target.addEventListener('wheel', (event) => this._wheel(event), { passive: true });
    target.addEventListener('mousemove', (event) => {
      if (this.gateOpen() && !this.actionInput.capturing) this.onLook(event.movementX, event.movementY);
    });
  }

  _keyDown(event) {
    if (this.ignoreEvent(event)) return;
    if (event.code === ESCAPE) {
      this.actionInput.cancelCapture();
      if (this.onEscape(event)) event.preventDefault();
      return;
    }
    if (event.repeat) {
      if (this.gateOpen() || this.actionInput.capturing) event.preventDefault();
      return;
    }
    if (this.actionInput.press(event.code, { gateOpen: this.gateOpen() })) event.preventDefault();
  }

  _mouseDown(event) {
    if (this.actionInput.capturing) {
      this.actionInput.press(`Mouse${event.button}`);
      return;
    }
    if (!this.gateOpen()) return;
    this.actionInput.press(`Mouse${event.button}`);
  }

  /** A wheel notch is a press and an instant release of "WheelUp" or "WheelDown". */
  _wheel(event) {
    const control = event.deltaY < 0 ? WHEEL_UP : WHEEL_DOWN;
    if (!this.gateOpen() && !this.actionInput.capturing) return;
    this.actionInput.press(control);
    this.actionInput.release(control);
  }
}
