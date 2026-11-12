import * as THREE from 'three';
import { ARM_LEN, group, mesh } from '../../assets/body-rig.js';

/*
 * Suit arms. Each builder returns { sleeve, hand } for one side (-1 left, 1 right).
 * The sleeve hangs from the shoulder pivot down to ARM_LEN and is stretched along Y to reach;
 * the hand sits at the wrist.
 */

const sleeveCore = (M, radius) => mesh(new THREE.CylinderGeometry(radius, radius * 0.9, ARM_LEN * 0.9, 8), M.dark, 0, -ARM_LEN * 0.45, 0);
const flattened = (m) => {
  m.scale.set(1.1, 0.8, 1.1);
  return m;
};
const fist =(M, size) => mesh(new THREE.BoxGeometry(size, size, size * 1.15), M.dark);

export const ARMS = [
  {
    id: 'slim-plates',
    name: 'Slim Plates',
    stats: {},
    build: (M) => ({
      sleeve: group(
        sleeveCore(M, 0.055),
        mesh(new THREE.BoxGeometry(0.12, ARM_LEN * 0.34, 0.13), M.armor, 0, -ARM_LEN * 0.25, 0),
        mesh(new THREE.SphereGeometry(0.06, 8, 6), M.joint, 0, -ARM_LEN * 0.5, 0),
        mesh(new THREE.BoxGeometry(0.1, ARM_LEN * 0.3, 0.11), M.armor, 0, -ARM_LEN * 0.75, 0),
      ),
      hand: group(fist(M, 0.1), mesh(new THREE.BoxGeometry(0.06, 0.012, 0.07), M.glow, 0, 0.055, 0)),
    }),
  },
  {
    id: 'heavy-pauldrons',
    name: 'Heavy Pauldrons',
    stats: {},
    build: (M, side) => ({
      sleeve: group(
        sleeveCore(M, 0.075),
        flattened(mesh(new THREE.SphereGeometry(0.17, 10, 8), M.armor, side * 0.06, 0.04, 0)),
        mesh(new THREE.TorusGeometry(0.15, 0.02, 6, 14), M.trim, side * 0.06, 0.0, 0).rotateX(Math.PI / 2),
        mesh(new THREE.SphereGeometry(0.075, 8, 6), M.joint, 0, -ARM_LEN * 0.5, 0),
        mesh(new THREE.BoxGeometry(0.15, ARM_LEN * 0.3, 0.16), M.armor, 0, -ARM_LEN * 0.75, 0),
      ),
      hand: group(fist(M, 0.13)),
    }),
  },
  {
    id: 'piston-arms',
    name: 'Piston Arms',
    stats: {},
    build: (M) => ({
      sleeve: group(
        sleeveCore(M, 0.04),
        mesh(new THREE.CylinderGeometry(0.018, 0.018, ARM_LEN * 0.55, 6), M.trim, 0.06, -ARM_LEN * 0.3, 0.04),
        mesh(new THREE.CylinderGeometry(0.018, 0.018, ARM_LEN * 0.55, 6), M.trim, -0.06, -ARM_LEN * 0.3, 0.04),
        mesh(new THREE.SphereGeometry(0.065, 8, 6), M.joint, 0, -ARM_LEN * 0.5, 0),
        mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 8), M.glow, 0, -ARM_LEN * 0.12, 0),
        mesh(new THREE.CylinderGeometry(0.065, 0.06, 0.2, 8), M.armor, 0, -ARM_LEN * 0.78, 0),
      ),
      hand: group(fist(M, 0.09), mesh(new THREE.BoxGeometry(0.11, 0.02, 0.05), M.trim, 0, 0.06, 0)),
    }),
  },
  {
    id: 'gauntlet-blocks',
    name: 'Gauntlet Blocks',
    stats: {},
    build: (M) => ({
      sleeve: group(
        sleeveCore(M, 0.05),
        mesh(new THREE.SphereGeometry(0.06, 8, 6), M.joint, 0, -ARM_LEN * 0.5, 0),
        mesh(new THREE.BoxGeometry(0.17, ARM_LEN * 0.42, 0.19), M.armor, 0, -ARM_LEN * 0.74, 0),
        mesh(new THREE.BoxGeometry(0.18, 0.025, 0.2), M.glow, 0, -ARM_LEN * 0.55, 0),
      ),
      hand: group(fist(M, 0.15), mesh(new THREE.BoxGeometry(0.1, 0.02, 0.04), M.trim, 0, 0.08, -0.04)),
    }),
  },
];
