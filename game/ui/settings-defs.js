/*
 * CABLE BOTS player settings: sliders, switches and choices for the settings screen.
 * `default` of the sensitivities is a multiplier of the value in game/main.js CONFIG, so 1 = as designed.
 * settings-apply.js turns the values into CONFIG changes.
 */

export const SETTING_GROUPS = ['VIEW', 'MOUSE', 'GAMEPAD'];

export const SETTING_DEFS = [
  { id: 'fov', label: 'FIELD OF VIEW', group: 'VIEW', type: 'range', min: 60, max: 110, step: 1, default: 75 },

  { id: 'mouseSensitivity', label: 'MOUSE SENSITIVITY', group: 'MOUSE', type: 'range', min: 0.2, max: 3, step: 0.05, default: 1 },
  { id: 'adsSensitivity', label: 'AIM-DOWN-SIGHTS SENSITIVITY', group: 'MOUSE', type: 'range', min: 0.2, max: 1.5, step: 0.05, default: 0.9 },
  { id: 'invertMouseY', label: 'INVERT MOUSE Y', group: 'MOUSE', type: 'toggle', default: false },

  { id: 'padLookSpeed', label: 'LOOK SPEED', group: 'GAMEPAD', type: 'range', min: 1, max: 8, step: 0.1, default: 3.6 },
  { id: 'padLookCurve', label: 'LOOK CURVE (HIGHER = FINER AIM)', group: 'GAMEPAD', type: 'range', min: 1, max: 3, step: 0.1, default: 1.8 },
  { id: 'padDeadzone', label: 'STICK DEAD ZONE', group: 'GAMEPAD', type: 'range', min: 0.05, max: 0.4, step: 0.01, default: 0.18 },
  { id: 'padTriggerThreshold', label: 'TRIGGER PRESS POINT', group: 'GAMEPAD', type: 'range', min: 0.1, max: 0.9, step: 0.05, default: 0.35 },
  { id: 'padInvertY', label: 'INVERT LOOK Y', group: 'GAMEPAD', type: 'toggle', default: false },
  { id: 'padVibration', label: 'VIBRATION', group: 'GAMEPAD', type: 'toggle', default: true },
  {
    id: 'padMoveStick', label: 'MOVE STICK', group: 'GAMEPAD', type: 'choice', default: 'left',
    choices: [{ value: 'left', label: 'LEFT STICK' }, { value: 'right', label: 'RIGHT STICK (SOUTHPAW)' }],
  },
];
