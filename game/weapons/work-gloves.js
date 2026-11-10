/*
 * WORK GLOVES: bare hands with hi-vis knuckle guards. Always available (its own key), the last stop of the weapon wheel.
 * Knuckle lines flare green on a punch.
 */

import * as THREE from 'three';
import { at, bevelBox, glowMaterial } from '../../core/client/combat/viewmodel-parts.js';
import { MAT, makeSleeve } from './shared.js';
import { MeleeWeapon } from '../../core/client/combat/melee-weapon.js';

/** The numbers: damage, speed, ammo, recoil, sights. */
export const config = { id: 'fists', name: 'WORK GLOVES', type: 'melee', melee: true, damage: 20, interval: 0.3, range: 2.6, cone: 0.78, knockback: 9, stun: 0.45 };

function buildFists() {
  const root = new THREE.Group();
  const hands = [];
  const knuckles = glowMaterial(0x3dff9a, 1);
  for (const side of [-1, 1]) {
    const hand = new THREE.Group();
    hand.add(
      bevelBox(0.085, 0.085, 0.11, MAT.glove, 0.016), // fist
      at(bevelBox(0.09, 0.02, 0.03, MAT.hazard, 0.005), 0, 0.035, -0.06), // hi-vis knuckle guard
      at(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.006, 0.008), knuckles), 0, 0.047, -0.06), // glowing knuckle line
      at(bevelBox(0.03, 0.04, 0.06, MAT.glove, 0.01), -side * 0.05, 0.0, -0.01),
    );
    hand.add(makeSleeve([side * 0.2, -0.3, 1]));
    hand.position.set(side * 0.2, -0.22, -0.38);
    hand.userData.base = hand.position.clone();
    hand.userData.side = side;
    root.add(hand);
    hands.push(hand);
  }
  return {
    root, muzzle: null, home: { x: 0, y: 0, z: 0 }, parts: { hands },
    animate(dt, time, state) {
      knuckles.emissiveIntensity = state.swing ? 6 : 0.9 + Math.sin(time * 2.5) * 0.4;
    },
  };
}

export const weapon = {
  config,
  holdable: { type: 'melee', class: MeleeWeapon },
  model: { build: buildFists, held: false },
};
