/*
 * SHOVEL: the DIG SITE tool, shaped like a round-point spade: a pointed steel blade with a centre ridge and rolled
 * top edge, a socket, a fibreglass shaft and a D-grip. Hidden: it is not in the inventory and never in a loadout
 * slot. Its blade edge lights up in the RGB cycle and flares on a swing.
 */

import * as THREE from 'three';
import { at, lathePart, glowMaterial, tubePart } from '../../core/client/combat/viewmodel-parts.js';
import { MAT, makeArm, rgbGlows } from './shared.js';
import { Tool } from '../../core/client/combat/tool.js';

// The shovel is the DIG SITE tool. Hidden: it is not in the inventory and never in a loadout slot.
/** The numbers: damage, speed, ammo, recoil, sights. */
export const config = { id: 'shovel', name: 'SHOVEL', type: 'tool', melee: true, hidden: true, damage: 0, interval: 0.6, range: 0, cone: 0, knockback: 0, stun: 0 };

const BLADE_TILT = -0.3; // the tip is lower than the socket
const BLADE_OUTLINE = [[-0.03, 0], [-0.085, 0.05], [-0.09, 0.14], [-0.06, 0.22], [0, 0.265], [0.06, 0.22], [0.09, 0.14], [0.085, 0.05], [0.03, 0]]; // [x, along the blade]
const BLADE_THICKNESS = 0.005;

/** The spade blade: a flat pointed plate, seen from above, extruded thin. Its length runs along -Z. */
function buildBlade() {
  const shape = new THREE.Shape();
  BLADE_OUTLINE.forEach(([x, along], i) => (i === 0 ? shape.moveTo(x, along) : shape.lineTo(x, along)));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: BLADE_THICKNESS, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.003, bevelSegments: 2, curveSegments: 4 });
  geometry.translate(0, 0, -BLADE_THICKNESS / 2);
  geometry.rotateX(-Math.PI / 2); // along the blade becomes -Z; the thickness becomes Y
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 8, uv.getY(i) * 8);
  return new THREE.Mesh(geometry, MAT.steel);
}

function buildShovel() {
  const root = new THREE.Group();
  const shaft = at(lathePart([[0.017, 0], [0.017, 1.0]], MAT.polymer, 14), 0, 0, 0.25);
  const handle = tubePart([[-0.1, 0, 0.26], [-0.105, 0.045, 0.26], [-0.05, 0.075, 0.26], [0.05, 0.075, 0.26], [0.105, 0.045, 0.26], [0.1, 0, 0.26]], 0.014, MAT.grip); // D-grip over the top
  const socket = at(lathePart([[0.017, 0], [0.027, 0.03], [0.027, 0.1], [0.014, 0.15]], MAT.gunmetal, 16), 0, 0, -0.66);
  const bladeGroup = new THREE.Group();
  bladeGroup.position.set(0, 0, -0.74);
  bladeGroup.rotation.x = BLADE_TILT;
  const edge = glowMaterial(0xffffff, 0.6);
  edge.name = 'shovel-edge';
  const edgeTip = tubePart(BLADE_OUTLINE.slice(3, 6).map(([x, along]) => [x * 0.985, BLADE_THICKNESS, -along * 0.985]), 0.0032, edge, 14); // lit cutting edge along the point
  const ridge = at(lathePart([[0.006, 0], [0.006, 0.2]], MAT.gunmetal, 8), 0, BLADE_THICKNESS, -0.02);
  bladeGroup.add(buildBlade(), edgeTip, ridge);
  const glows = rgbGlows([[edge, 0.1]]);
  const leftArm = at(makeArm(-1, Math.PI, [-0.3, -0.35, 1]), 0, -0.03, -0.18); // palm up under the shaft
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.3, -0.45, 1]), 0.04, -0.03, 0.2);
  root.add(shaft, handle, socket, bladeGroup, rightArm, leftArm);
  return {
    root, muzzle: null, home: { x: 0.2, y: -0.22, z: -0.4 },
    parts: { support: { object: leftArm, baseY: leftArm.position.y } },
    animate(dt, time, state) {
      glows(time);
      edge.emissiveIntensity = state.swing ? 5 : 0.8 + Math.sin(time * 3) * 0.3;
    },
  };
}

export const weapon = {
  config,
  holdable: { type: 'tool', class: Tool },
  model: { build: buildShovel },
};
