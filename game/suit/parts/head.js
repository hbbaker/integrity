import * as THREE from 'three';
import { group, mesh } from '../../assets/body-rig.js';

/* Suit heads. Each builder fills the head pivot (origin at the neck); the helm sits about 0.3 m wide. */

const neck = (M) => mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), M.joint, 0, -0.02, 0);

export const HEADS = [
  {
    id: 'standard-helm',
    name: 'Standard Helm',
    stats: {},
    build: (M) => group(
      neck(M),
      mesh(new THREE.BoxGeometry(0.32, 0.3, 0.32), M.armor, 0, 0.15, 0),
      mesh(new THREE.BoxGeometry(0.26, 0.05, 0.02), M.glow, 0, 0.17, -0.165), // visor slit
      mesh(new THREE.BoxGeometry(0.34, 0.04, 0.34), M.trim, 0, 0.3, 0), // brow ridge
    ),
  },
  {
    id: 'cyclops',
    name: 'Cyclops',
    stats: {},
    build: (M) => group(
      neck(M),
      mesh(new THREE.SphereGeometry(0.18, 10, 8), M.armor, 0, 0.17, 0),
      mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 12), M.glow, 0, 0.18, -0.17).rotateX(Math.PI / 2), // single lens
      mesh(new THREE.TorusGeometry(0.09, 0.015, 6, 14), M.trim, 0, 0.18, -0.17),
    ),
  },
  {
    id: 'crest',
    name: 'Crest',
    stats: {},
    build: (M) => group(
      neck(M),
      mesh(new THREE.BoxGeometry(0.3, 0.27, 0.3), M.armor, 0, 0.14, 0),
      mesh(new THREE.BoxGeometry(0.04, 0.22, 0.36), M.trim, 0, 0.38, 0.02), // tall fin
      mesh(new THREE.BoxGeometry(0.11, 0.035, 0.02), M.glow, -0.07, 0.15, -0.155).rotateZ(-0.25), // angled eyes
      mesh(new THREE.BoxGeometry(0.11, 0.035, 0.02), M.glow, 0.07, 0.15, -0.155).rotateZ(0.25),
    ),
  },
  {
    id: 'dome',
    name: 'Dome',
    stats: {},
    build: (M) => group(
      neck(M),
      mesh(new THREE.SphereGeometry(0.19, 12, 10), M.armor, 0, 0.17, 0),
      mesh(new THREE.TorusGeometry(0.195, 0.014, 6, 20), M.glow, 0, 0.17, 0).rotateX(Math.PI / 2), // sensor ring
      mesh(new THREE.BoxGeometry(0.2, 0.03, 0.02), M.dark, 0, 0.12, -0.185),
    ),
  },
];
