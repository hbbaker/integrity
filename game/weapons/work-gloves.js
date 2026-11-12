/*
 * WORK GLOVES: bare fists. The arms are the character's own (the Y Bot's), reaching to two hand positions that sway and
 * punch. Always available (its own key), the last stop of the weapon wheel. Until the character model has loaded
 * (or if it cannot), the old black gloves with their glowing knuckle lines are drawn instead.
 */

import * as THREE from 'three';
import { at, bevelBox, glowMaterial } from '../../core/client/combat/viewmodel-parts.js';
import { MAT, makeSleeve, rgbGlows } from './shared.js';
import { MeleeWeapon } from '../../core/client/combat/melee-weapon.js';
import { YBotViewArms } from '../assets/y-bot-arms.js';

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
      const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.012, 2, 6), MAT.glove);
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
  const arms = new YBotViewArms({ onReady: () => hands.forEach((hand) => { hand.visible = false; }) }); // the gloves step aside for the real arms
  root.add(arms.object);
  const wrists = [new THREE.Vector3(), new THREE.Vector3()];
  return {
    root, muzzle: null, home: { x: 0, y: 0, z: 0 }, parts: { hands },
    /** Called once the hands have been placed for this frame: put the arms on them. */
    afterView() {
      arms.follow(hands[0].getWorldPosition(wrists[0]), hands[1].getWorldPosition(wrists[1]));
    },
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
