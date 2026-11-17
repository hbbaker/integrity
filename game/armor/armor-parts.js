import { SLOTS } from '../assets/body-rig.js';

/*
 * The catalogue of armor pieces. A piece is { id, name, armor, model }.
 * `armor` is the fraction of damage it removes. `model` says where its asset is and how it
 * fits the body (see helmet-model.js). The pieces of a slot are listed in a fixed
 * order: the network sends a piece as its position in that list, plus one.
 */

export const ARMOR_SLOTS = SLOTS;

export const ARMOR_PARTS = {
  head: [{
    id: 'test-helmet',
    name: 'Test Helmet',
    armor: 0.1,
    model: {
      folder: new URL('../assets/test_helmet_textured/', import.meta.url).href,
      obj: 'textured.obj',
      mtl: 'textured.mtl',
      height: 0.27, // metres: the Y Bot head (chin 1.40 m to top 1.64 m) is not drawn while this is worn, so the helmet is the head
      lift: -0.11, // metres above the neck pivot (1.52 m): negative puts the base at the chin, about 1.41 m
      turn: Math.PI, // radians about the vertical axis: the file's front faces +Z, the body faces -Z
    },
  }],
  arms: [],
  chest: [{
    id: 'test-chestplate',
    name: 'Test Chestplate',
    armor: 0.2,
    model: {
      folder: new URL('../assets/test_chest_textured/', import.meta.url).href,
      obj: 'textured.obj',
      mtl: 'textured.mtl',
      height: 0.45, // metres: waist to shoulders on the Y Bot, which keeps its own torso under the plate
      lift: 0.1, // metres above the torso pivot (0.9 m): the base sits at the waist, about 1.0 m
      turn: Math.PI, // radians about the vertical axis: assumed to face +Z like the helmet, the body faces -Z
    },
  }],
  legs: [],
  boots: [],
};

export function findArmorPart(slot, id) {
  const part = ARMOR_PARTS[slot]?.find((p) => p.id === id);
  if (!part) throw new Error(`Unknown armor piece ${slot}/${id}`);
  return part;
}

/** Nothing equipped in any slot. */
export function emptyEquipment() {
  return Object.fromEntries(ARMOR_SLOTS.map((slot) => [slot, null]));
}

/** Keep only valid ids from a saved record; anything else becomes empty. */
export function sanitizeEquipment(saved) {
  const equipped = emptyEquipment();
  for (const slot of ARMOR_SLOTS) {
    if (saved && ARMOR_PARTS[slot].some((p) => p.id === saved[slot])) equipped[slot] = saved[slot];
  }
  return equipped;
}

/** The damage fraction removed by everything equipped, never above `cap`. */
export function damageReduction(equipped, cap) {
  const total = ARMOR_SLOTS.reduce((sum, slot) => (equipped[slot] ? sum + findArmorPart(slot, equipped[slot]).armor : sum), 0);
  return Math.min(total, cap);
}
