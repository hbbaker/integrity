import { CONFIG } from '../config.js';
import { SUIT_SLOTS, findPart } from './suit-parts.js';

/*
 * What a suit does to the player's movement. Every suit starts from the baseline in
 * CONFIG.suit.baseline; each fitted part adds its own `stats` on top. Parts carry no
 * stats yet, so for now the result is the baseline.
 *
 * Fields: speedMul (multiplies walk / sprint / slide speed), jumpDelay and slideDelay
 * (seconds between the button press and the action), healthMul (the suit's health as a multiple of the player's own).
 */

export const SUIT_STAT_KEYS = ['speedMul', 'jumpDelay', 'slideDelay', 'healthMul'];

export function aggregateSuitStats(selection, baseline = CONFIG.suit.baseline) {
  const total = { ...baseline };
  for (const slot of SUIT_SLOTS) {
    const stats = findPart(slot, selection[slot]).stats;
    for (const key of SUIT_STAT_KEYS) total[key] += stats[key] ?? 0;
  }
  total.speedMul = Math.max(0.1, total.speedMul);
  total.jumpDelay = Math.max(0, total.jumpDelay);
  total.slideDelay = Math.max(0, total.slideDelay);
  total.healthMul = Math.max(0.1, total.healthMul);
  return total;
}
