import * as THREE from 'three';
import { group, mesh } from '../../assets/body-rig.js';

/* Suit legs. Each builder fills a hip pivot for one side (-1 left, 1 right) and reaches about 0.46 m down to the ankle. */

export const LEGS = [
  {
    id: 'straight-greaves',
    name: 'Straight Greaves',
    stats: {},
    build: (M, side) => group(
      mesh(new THREE.BoxGeometry(0.16, 0.27, 0.17), M.dark, 0, -0.13, 0),
      mesh(new THREE.SphereGeometry(0.085, 8, 6), M.joint, 0, -0.28, 0),
      mesh(new THREE.BoxGeometry(0.14, 0.27, 0.16), M.armor, 0, -0.4, 0),
      mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), M.glow, side * 0.055, -0.29, -0.09),
    ),
  },
  {
    id: 'digitigrade',
    name: 'Digitigrade',
    stats: {},
    build: (M) => group(
      mesh(new THREE.BoxGeometry(0.15, 0.26, 0.16), M.armor, 0, -0.12, -0.04).rotateX(0.35),
      mesh(new THREE.SphereGeometry(0.08, 8, 6), M.joint, 0, -0.25, -0.09),
      mesh(new THREE.BoxGeometry(0.11, 0.28, 0.12), M.dark, 0, -0.38, -0.04).rotateX(-0.35),
      mesh(new THREE.BoxGeometry(0.09, 0.05, 0.1), M.glow, 0, -0.25, -0.15),
    ),
  },
  {
    id: 'armored-skirt',
    name: 'Armored Skirt',
    stats: {},
    build: (M, side) => group(
      mesh(new THREE.BoxGeometry(0.16, 0.27, 0.17), M.dark, 0, -0.13, 0),
      mesh(new THREE.BoxGeometry(0.2, 0.3, 0.04), M.armor, 0, -0.14, -0.1).rotateX(-0.12), // front tasset
      mesh(new THREE.BoxGeometry(0.04, 0.28, 0.2), M.armor, side * 0.1, -0.13, 0), // side plate
      mesh(new THREE.SphereGeometry(0.085, 8, 6), M.joint, 0, -0.28, 0),
      mesh(new THREE.BoxGeometry(0.14, 0.27, 0.16), M.dark, 0, -0.4, 0),
      mesh(new THREE.BoxGeometry(0.15, 0.05, 0.06), M.trim, 0, -0.3, -0.1),
    ),
  },
  {
    id: 'piston-legs',
    name: 'Piston Legs',
    stats: {},
    build: (M) => group(
      mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.28, 8), M.dark, 0, -0.14, 0),
      mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), M.trim, 0.07, -0.2, -0.04),
      mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), M.trim, -0.07, -0.2, -0.04),
      mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 8), M.joint, 0, -0.28, 0).rotateZ(Math.PI / 2),
      mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.27, 8), M.armor, 0, -0.4, 0),
      mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.025, 8), M.glow, 0, -0.34, 0),
    ),
  },
];
