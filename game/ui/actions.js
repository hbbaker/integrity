/*
 * CABLE BOTS action table: every command the player can bind, and its default keys and buttons.
 * The core reads this through Bindings and ActionInput (core/client/engine); it never names an action.
 *
 * Fields:
 *   hold       input field that is true while a bound control is down
 *   press      input field set on each press (the game loop clears it once handled); `value` is what it is set to
 *   command    also tell main.js (menus, view toggle, mute); see onCommand there
 *   latchWhileMoving   on a pad the action stays on after the button is released until the move stick is let go
 * Controls: keyboard "KeyW", mouse "Mouse0" / "WheelUp", pad "Pad0".. (standard layout numbers; labels in pad-labels.js).
 * The sticks are not here: they move and look, and the move stick can be swapped in the settings.
 */

export const ACTION_GROUPS = ['MOVEMENT', 'COMBAT', 'WEAPONS', 'VIEW', 'GAME'];

export const ACTIONS = [
  { id: 'forward', label: 'MOVE FORWARD', group: 'MOVEMENT', hold: 'forward', defaults: { keyboard: ['KeyW', 'ArrowUp'], gamepad: [] } },
  { id: 'back', label: 'MOVE BACK', group: 'MOVEMENT', hold: 'back', defaults: { keyboard: ['KeyS', 'ArrowDown'], gamepad: [] } },
  { id: 'left', label: 'MOVE LEFT', group: 'MOVEMENT', hold: 'left', defaults: { keyboard: ['KeyA', 'ArrowLeft'], gamepad: [] } },
  { id: 'right', label: 'MOVE RIGHT', group: 'MOVEMENT', hold: 'right', defaults: { keyboard: ['KeyD', 'ArrowRight'], gamepad: [] } },
  { id: 'sprint', label: 'SPRINT', group: 'MOVEMENT', hold: 'sprintHeld', press: 'sprintPressed', latchWhileMoving: true, defaults: { keyboard: ['ShiftLeft', 'ShiftRight'], gamepad: ['Pad10'] } },
  { id: 'jump', label: 'JUMP', group: 'MOVEMENT', press: 'jumpPressed', defaults: { keyboard: ['Space'], gamepad: ['Pad0'] } },
  { id: 'crouch', label: 'CROUCH / SLIDE', group: 'MOVEMENT', hold: 'crouchHeld', press: 'slidePressed', defaults: { keyboard: ['KeyC', 'ControlLeft'], gamepad: ['Pad1'] } },
  { id: 'leanLeft', label: 'LEAN LEFT', group: 'MOVEMENT', hold: 'leanLeft', defaults: { keyboard: ['KeyQ'], gamepad: ['Pad4'] } },
  { id: 'leanRight', label: 'LEAN RIGHT', group: 'MOVEMENT', hold: 'leanRight', defaults: { keyboard: ['KeyE'], gamepad: ['Pad5'] } },

  { id: 'fire', label: 'FIRE / DIG', group: 'COMBAT', hold: 'fireHeld', press: 'firePressed', defaults: { keyboard: ['Mouse0'], gamepad: ['Pad7'] } },
  { id: 'aim', label: 'AIM', group: 'COMBAT', hold: 'aimHeld', defaults: { keyboard: ['Mouse2'], gamepad: ['Pad6'] } },
  { id: 'reload', label: 'RELOAD', group: 'COMBAT', press: 'reloadPressed', defaults: { keyboard: ['KeyR'], gamepad: ['Pad2'] } },
  { id: 'melee', label: 'MELEE', group: 'COMBAT', press: 'meleePressed', defaults: { keyboard: ['KeyF'], gamepad: ['Pad11'] } },

  { id: 'nextWeapon', label: 'NEXT WEAPON', group: 'WEAPONS', press: 'wheel', value: 1, defaults: { keyboard: ['WheelDown'], gamepad: ['Pad3', 'Pad15'] } },
  { id: 'prevWeapon', label: 'PREVIOUS WEAPON', group: 'WEAPONS', press: 'wheel', value: -1, defaults: { keyboard: ['WheelUp'], gamepad: ['Pad14'] } },
  { id: 'ammoSwap', label: 'SWAP AMMO TYPE', group: 'WEAPONS', press: 'ammoPressed', defaults: { keyboard: ['Tab'], gamepad: ['Pad12'] } },
  { id: 'slot1', label: 'WEAPON SLOT 1', group: 'WEAPONS', press: 'selectSlot', value: 0, command: true, defaults: { keyboard: ['Digit1'], gamepad: [] } },
  { id: 'slot2', label: 'WEAPON SLOT 2', group: 'WEAPONS', press: 'selectSlot', value: 1, command: true, defaults: { keyboard: ['Digit2'], gamepad: [] } },
  { id: 'slot3', label: 'WEAPON SLOT 3', group: 'WEAPONS', press: 'selectSlot', value: 2, command: true, defaults: { keyboard: ['Digit3'], gamepad: [] } },
  { id: 'slot4', label: 'WORK GLOVES', group: 'WEAPONS', press: 'selectSlot', value: 3, command: true, defaults: { keyboard: ['Digit4'], gamepad: [] } },

  { id: 'toggleView', label: 'FIRST / THIRD PERSON', group: 'VIEW', command: true, defaults: { keyboard: ['KeyT'], gamepad: ['Pad13'] } },
  { id: 'scoreboard', label: 'SCOREBOARD (HOLD)', group: 'VIEW', hold: 'boardHeld', defaults: { keyboard: ['KeyG'], gamepad: ['Pad8'] } },

  { id: 'inventory', label: 'INVENTORY', group: 'GAME', command: true, defaults: { keyboard: ['KeyI'], gamepad: [] } },
  { id: 'pause', label: 'PAUSE', group: 'GAME', command: true, defaults: { keyboard: [], gamepad: ['Pad9'] } },
  { id: 'mute', label: 'MUTE SOUND', group: 'GAME', command: true, defaults: { keyboard: ['KeyM'], gamepad: [] } },
];

/** Pad layouts the settings screen offers besides DEFAULT (applied over the defaults). */
export const PAD_PRESETS = {
  DEFAULT: {},
  'BUMPER JUMPER': { // jump and crouch move to the bumpers; the face buttons reload and lean
    jump: { gamepad: ['Pad4'] },
    crouch: { gamepad: ['Pad5'] },
    reload: { gamepad: ['Pad0'] },
    leanLeft: { gamepad: ['Pad2'] },
    leanRight: { gamepad: ['Pad1'] },
  },
};
