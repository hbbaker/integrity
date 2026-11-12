import * as THREE from 'three';
import { group, mesh } from '../../assets/body-rig.js';

/* Suit boots. Each builder fills a leg pivot for one side; the sole sits at about -0.555 m, which is the ground. */

export const BOOTS = [
  {
    id: 'flat-treads',
    name: 'Flat Treads',
    stats: {},
    build: (M) => group(
      mesh(new THREE.BoxGeometry(0.16, 0.09, 0.28), M.armor, 0, -0.51, -0.05),
      mesh(new THREE.BoxGeometry(0.17, 0.03, 0.3), M.dark, 0, -0.54, -0.05),
      mesh(new THREE.BoxGeometry(0.12, 0.012, 0.05), M.glow, 0, -0.47, -0.18),
    ),
  },
  {
    id: 'heavy-stompers',
    name: 'Heavy Stompers',
    stats: {},
    build: (M) => group(
      mesh(new THREE.BoxGeometry(0.21, 0.12, 0.34), M.armor, 0, -0.49, -0.06),
      mesh(new THREE.BoxGeometry(0.22, 0.04, 0.36), M.dark, 0, -0.535, -0.06),
      mesh(new THREE.CylinderGeometry(0.085, 0.09, 0.08, 8), M.joint, 0, -0.43, 0),
    ),
  },
  {
    id: 'hover-pads',
    name: 'Hover Pads',
    stats: {},
    build: (M) => group(
      mesh(new THREE.BoxGeometry(0.15, 0.07, 0.26), M.armor, 0, -0.5, -0.05),
      mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.03, 12), M.dark, 0, -0.53, -0.04),
      mesh(new THREE.TorusGeometry(0.115, 0.012, 6, 16), M.glow, 0, -0.55, -0.04).rotateX(Math.PI / 2),
    ),
  },
  {
    id: 'spiked-cleats',
    name: 'Spiked Cleats',
    stats: {},
    build: (M) => group(
      mesh(new THREE.BoxGeometry(0.15, 0.09, 0.28), M.dark, 0, -0.51, -0.05),
      mesh(new THREE.BoxGeometry(0.15, 0.04, 0.1), M.armor, 0, -0.45, -0.1),
      mesh(new THREE.ConeGeometry(0.025, 0.06, 6), M.trim, -0.05, -0.525, -0.14).rotateX(Math.PI),
      mesh(new THREE.ConeGeometry(0.025, 0.06, 6), M.trim, 0.05, -0.525, -0.14).rotateX(Math.PI),
      mesh(new THREE.ConeGeometry(0.025, 0.06, 6), M.trim, -0.05, -0.525, 0.03).rotateX(Math.PI),
      mesh(new THREE.ConeGeometry(0.025, 0.06, 6), M.trim, 0.05, -0.525, 0.03).rotateX(Math.PI),
    ),
  },
];
