/*
 * SHOVEL: The DIG SITE tool. Hidden: it is not in the inventory and never in a loadout slot. Its edge lights up on a swing.
 */

import * as THREE from 'three';
import { at, bevelBox, lathePart, glowMaterial } from '../../core/client/combat/viewmodel-parts.js';
import { MAT, makeArm } from './shared.js';
import { Tool } from '../../core/client/combat/tool.js';

// The shovel is the DIG SITE tool. Hidden: it is not in the inventory and never in a loadout slot.
/** The numbers: damage, speed, ammo, recoil, sights. */
export const config = { id: 'shovel', name: 'SHOVEL', type: 'tool', melee: true, hidden: true, damage: 0, interval: 0.6, range: 0, cone: 0, knockback: 0, stun: 0 };

function buildShovel() {
  const root = new THREE.Group();
  const shaft = at(lathePart([[0.017, 0], [0.017, 1.0]], MAT.wood, 12), 0, 0, 0.25);
  const handle = at(bevelBox(0.2, 0.03, 0.03, MAT.wood, 0.01), 0, 0, 0.26); // D-grip across the top
  const blade = at(bevelBox(0.17, 0.012, 0.24, MAT.steel, 0.004), 0, -0.01, -0.84); // steel blade, tilted down
  blade.rotation.x = 0.35;
  const collar = at(bevelBox(0.045, 0.045, 0.1, MAT.steel, 0.01), 0, 0, -0.74); // socket where the blade meets the shaft
  const edge = glowMaterial(0x00f0ff, 0.6);
  const edgeStrip = at(new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.008, 0.01), edge), 0, -0.047, -0.953); // lit cutting edge
  edgeStrip.rotation.x = 0.35;
  const leftArm = at(makeArm(-1, Math.PI, [-0.3, -0.35, 1]), 0, -0.03, -0.18); // palm up under the shaft
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.3, -0.45, 1]), 0.04, -0.03, 0.2);
  root.add(shaft, handle, collar, blade, edgeStrip, rightArm, leftArm);
  return {
    root, muzzle: null, home: { x: 0.2, y: -0.22, z: -0.4 },
    parts: { support: { object: leftArm, baseY: leftArm.position.y } },
    animate(dt, time, state) {
      edge.emissiveIntensity = state.swing ? 5 : 0.8 + Math.sin(time * 3) * 0.3;
    },
  };
}

export const weapon = {
  config,
  holdable: { type: 'tool', class: Tool },
  model: { build: buildShovel },
};
