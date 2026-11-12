import { SUIT_PARTS, SUIT_SLOTS, defaultSelection } from './suit-parts.js';

/*
 * The suit as it travels in a player's state message (the 's' message, see pose-message.js).
 *
 *   su  what the suit is doing: 1 standing in the world, 2 being stepped into, 3 worn, 4 being stepped out of,
 *       5 falling out of the sky, 6 rising back into it (left out when the player has no suit in play)
 *   sx, sz, sw   where the suit stands, and the way it faces
 *   sc  the part in each slot as a digit per slot, in SUIT_SLOTS order: "01230"
 *
 * Every state message carries all of it, so a player who joins late, or a message that is lost, heals on the next one.
 */

export const SUIT_MODE = Object.freeze({ NONE: 0, STANDING: 1, ENTERING: 2, PILOTED: 3, EXITING: 4, DROPPING: 5, LIFTING: 6 });

const MODE_MAX = SUIT_MODE.LIFTING;
const round2 = (value) => Math.round(value * 100) / 100;

/** The part of each slot as a short string of digits. */
export function encodeSelection(selection) {
  return SUIT_SLOTS.map((slot) => Math.max(0, SUIT_PARTS[slot].findIndex((part) => part.id === selection[slot]))).join('');
}

/** The part ids for a string of digits; any slot that is missing or out of range gets its default part. */
export function decodeSelection(text) {
  const selection = defaultSelection();
  if (typeof text !== 'string') return selection;
  SUIT_SLOTS.forEach((slot, i) => {
    const part = SUIT_PARTS[slot][Number(text[i])];
    if (part) selection[slot] = part.id;
  });
  return selection;
}

/** @param {{ mode: number, x: number, z: number, yaw: number, selection: object } | null} suit */
export function encodeSuit(suit) {
  if (!suit || !suit.mode) return {};
  return { su: suit.mode, sx: round2(suit.x), sz: round2(suit.z), sw: round2(suit.yaw), sc: encodeSelection(suit.selection) };
}

/** The suit in a state message, or null for none. Anything odd is treated as no suit: a message from another player is not trusted. */
export function decodeSuit(message) {
  const mode = Math.trunc(Number(message?.su));
  if (!(mode >= SUIT_MODE.STANDING && mode <= MODE_MAX)) return null;
  const x = Number(message.sx);
  const z = Number(message.sz);
  const yaw = Number(message.sw);
  if (![x, z, yaw].every(Number.isFinite)) return null;
  return { mode, x, z, yaw, selection: decodeSelection(message.sc) };
}
