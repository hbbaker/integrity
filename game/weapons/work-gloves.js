/*
 * WORK GLOVES: black tactical gloves with hard metal knuckle guards and finger rolls. Always available (its own key),
 * the last stop of the weapon wheel. The knuckle lines glow in the RGB cycle and flare on a punch.
 */

import * as THREE from 'three';
import { at, bevelBox, glowMaterial } from '../../core/client/combat/viewmodel-parts.js';
import { MAT, makeSleeve, rgbGlows } from './shared.js';
import { MeleeWeapon } from '../../core/client/combat/melee-weapon.js';

/** The numbers: damage, speed, ammo, recoil, sights. */
export const config = { id: 'fists', name: 'WORK GLOVES', type: 'melee', melee: true, damage: 20, interval: 0.3, range: 2.6, cone: 0.78, knockback: 9, stun: 0.45 };

const FINGER_COUNT = 4;

function buildFists() {
  const root = new THREE.Group();
  const hands = [];
  const knuckles = glowMaterial(0xffffff, 1);
  for (const side of [-1, 1]) {
    const hand = new THREE.Group();
    hand.add(
      bevelBox(0.085, 0.07, 0.11, MAT.glove, 0.016), // palm and back of the hand
      at(bevelBox(0.09, 0.02, 0.03, MAT.gunmetal, 0.006), 0, 0.03, -0.062), // hard knuckle guard
      at(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.005, 0.008), knuckles), 0, 0.042, -0.062), // glowing knuckle line
      at(bevelBox(0.03, 0.04, 0.06, MAT.glove, 0.01), -side * 0.05, 0.0, -0.01), // thumb
    );
    for (let i = 0; i < FINGER_COUNT; i++) { // curled finger rolls across the front
      const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.012, 4, 8), MAT.glove);
      finger.rotation.z = Math.PI / 2;
      finger.position.set(-0.03 + i * 0.02, -0.005, -0.06);
      hand.add(finger);
    }
    hand.add(makeSleeve([side * 0.2, -0.3, 1]));
    hand.position.set(side * 0.2, -0.22, -0.38);
    hand.userData.base = hand.position.clone();
    hand.userData.side = side;
    root.add(hand);
    hands.push(hand);
  }
  const glows = rgbGlows([[knuckles, 0]]);
  return {
    root, muzzle: null, home: { x: 0, y: 0, z: 0 }, parts: { hands },
    animate(dt, time, state) {
      glows(time);
      knuckles.emissiveIntensity = state.swing ? 6 : 0.9 + Math.sin(time * 2.5) * 0.4;
    },
  };
}

export const weapon = {
  config,
  holdable: { type: 'melee', class: MeleeWeapon },
  model: { build: buildFists, held: false },
};
