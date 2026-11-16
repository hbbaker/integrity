import { ARMOR_PARTS, ARMOR_SLOTS, emptyEquipment } from './armor-parts.js';

/*
 * The equipped armor as it travels in a player's state message (key `ar`):
 * one digit per slot in ARMOR_SLOTS order. 0 is empty, n is the nth piece of that slot.
 */

/** The equipped pieces as a string of digits. */
export function encodeEquipment(equipped) {
  return ARMOR_SLOTS.map((slot) => ARMOR_PARTS[slot].findIndex((p) => p.id === equipped[slot]) + 1).join('');
}

/** The equipped ids for a string of digits. Anything missing or out of range is empty: the sender is not trusted. */
export function decodeEquipment(text) {
  const equipped = emptyEquipment();
  if (typeof text !== 'string') return equipped;
  ARMOR_SLOTS.forEach((slot, i) => {
    const n = Number(text[i]);
    if (Number.isInteger(n) && n >= 1 && ARMOR_PARTS[slot][n - 1]) equipped[slot] = ARMOR_PARTS[slot][n - 1].id;
  });
  return equipped;
}
