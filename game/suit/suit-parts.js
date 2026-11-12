import { SLOTS } from '../assets/body-rig.js';
import { HEADS } from './parts/head.js';
import { ARMS } from './parts/arms.js';
import { CHESTS } from './parts/chest.js';
import { LEGS } from './parts/legs.js';
import { BOOTS } from './parts/boots.js';

/*
 * The catalogue of suit parts. A part is { id, name, stats, build(materials, side) }.
 * `stats` is empty for now: it is where a part will add to the suit's baseline
 * numbers later (see suit-stats.js). All parts of a slot share one size and
 * attachment point, so any mix fits together.
 */

export const SUIT_SLOTS = SLOTS;

export const SUIT_PARTS = {
  head: HEADS,
  arms: ARMS,
  chest: CHESTS,
  legs: LEGS,
  boots: BOOTS,
};

export const SLOT_LABELS = { head: 'HEAD', arms: 'ARMS', chest: 'CHEST', legs: 'LEGS', boots: 'BOOTS' };

export function findPart(slot, id) {
  const part = SUIT_PARTS[slot]?.find((p) => p.id === id);
  if (!part) throw new Error(`Unknown suit part ${slot}/${id}`);
  return part;
}

/** The first part of every slot. */
export function defaultSelection() {
  return Object.fromEntries(SUIT_SLOTS.map((slot) => [slot, SUIT_PARTS[slot][0].id]));
}

/** Keep only valid ids from a saved selection; anything missing falls back to the default. */
export function sanitizeSelection(saved) {
  const selection = defaultSelection();
  for (const slot of SUIT_SLOTS) {
    if (saved && SUIT_PARTS[slot].some((p) => p.id === saved[slot])) selection[slot] = saved[slot];
  }
  return selection;
}

/** `{ slot: build }` for BodyRig.setKit. */
export function suitKit(selection) {
  return Object.fromEntries(SUIT_SLOTS.map((slot) => [slot, findPart(slot, selection[slot]).build]));
}
