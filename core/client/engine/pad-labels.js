/*
 * Names for the standard-layout pad buttons: Xbox letters or PlayStation shapes, chosen from the pad's id
 * string. Used wherever the game shows a button to the player (settings, hints).
 */

import { padControl } from './bindings.js';

const XBOX = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'VIEW', 'MENU', 'L3', 'R3', 'D-PAD UP', 'D-PAD DOWN', 'D-PAD LEFT', 'D-PAD RIGHT', 'GUIDE'];
const PLAYSTATION = ['CROSS', 'CIRCLE', 'SQUARE', 'TRIANGLE', 'L1', 'R1', 'L2', 'R2', 'SHARE', 'OPTIONS', 'L3', 'R3', 'D-PAD UP', 'D-PAD DOWN', 'D-PAD LEFT', 'D-PAD RIGHT', 'PS'];
const PLAYSTATION_IDS = /playstation|dualshock|dualsense|054c|sony/i; // 054c is Sony's USB vendor id

/** True when the pad id looks like a PlayStation controller. */
export function isPlayStationPad(id) {
  return PLAYSTATION_IDS.test(id ?? '');
}

/** { Pad0: 'A', Pad1: 'B', ... } for the connected pad (Xbox names when it is not known). */
export function padLabels(id) {
  const names = isPlayStationPad(id) ? PLAYSTATION : XBOX;
  return Object.fromEntries(names.map((name, index) => [padControl(index), name]));
}
