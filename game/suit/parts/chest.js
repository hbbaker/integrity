import * as THREE from 'three';
import { group, mesh } from '../../assets/body-rig.js';

/*
 * Suit chests. Each builder fills the torso pivot (origin at the waist); the torso core is about 0.54 x 0.5 x 0.3 m.
 * Anything behind z = 0.05 is cut off and rides on the suit's back hatch, so keep the back of a chest out there.
 */

const shell = (M) => mesh(new THREE.BoxGeometry(0.54, 0.5, 0.15), M.dark, 0, 0.27, -0.075); // the front half
const rear = (M) => mesh(new THREE.BoxGeometry(0.54, 0.5, 0.15), M.dark, 0, 0.27, 0.075); // the back half, on the hatch
const collar = (M) => mesh(new THREE.BoxGeometry(0.3, 0.08, 0.2), M.joint, 0, 0.55, 0);

export const CHESTS = [
  {
    id: 'plate-cuirass',
    name: 'Plate Cuirass',
    stats: {},
    build: (M) => group(
      shell(M), rear(M), collar(M),
      mesh(new THREE.BoxGeometry(0.46, 0.38, 0.06), M.armor, 0, 0.3, -0.17),
      mesh(new THREE.BoxGeometry(0.46, 0.38, 0.06), M.armor, 0, 0.3, 0.17),
      mesh(new THREE.BoxGeometry(0.4, 0.03, 0.07), M.glow, 0, 0.12, -0.17),
    ),
  },
  {
    id: 'reactor-core',
    name: 'Reactor Core',
    stats: {},
    build: (M) => group(
      shell(M), rear(M), collar(M),
      mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 14), M.glow, 0, 0.32, -0.18).rotateX(Math.PI / 2),
      mesh(new THREE.TorusGeometry(0.14, 0.02, 6, 16), M.trim, 0, 0.32, -0.18),
      mesh(new THREE.BoxGeometry(0.46, 0.1, 0.05), M.armor, 0, 0.5, -0.16),
      mesh(new THREE.BoxGeometry(0.34, 0.25, 0.1), M.armor, 0, 0.3, 0.19), // back vent block
    ),
  },
  {
    id: 'cargo-rack',
    name: 'Cargo Rack',
    stats: {},
    build: (M) => group(
      shell(M), rear(M), collar(M),
      mesh(new THREE.BoxGeometry(0.42, 0.3, 0.05), M.armor, 0, 0.3, -0.17),
      mesh(new THREE.BoxGeometry(0.1, 0.32, 0.26), M.armor, -0.31, 0.22, 0), // side pods
      mesh(new THREE.BoxGeometry(0.1, 0.32, 0.26), M.armor, 0.31, 0.22, 0),
      mesh(new THREE.BoxGeometry(0.4, 0.04, 0.16), M.trim, 0, 0.5, 0.25), // back rack rails
      mesh(new THREE.BoxGeometry(0.4, 0.04, 0.16), M.trim, 0, 0.1, 0.25),
      mesh(new THREE.BoxGeometry(0.34, 0.3, 0.12), M.dark, 0, 0.3, 0.26),
    ),
  },
  {
    id: 'ribbed-frame',
    name: 'Ribbed Frame',
    stats: {},
    build: (M) => group(
      collar(M),
      mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), M.joint, 0, 0.27, 0.1), // spine
      ...[0.08, 0.18, 0.28, 0.38, 0.48].map((y) => mesh(new THREE.BoxGeometry(0.52, 0.03, 0.28), M.armor, 0, y, 0)),
      mesh(new THREE.BoxGeometry(0.03, 0.5, 0.03), M.trim, -0.25, 0.27, -0.13),
      mesh(new THREE.BoxGeometry(0.03, 0.5, 0.03), M.trim, 0.25, 0.27, -0.13),
      mesh(new THREE.SphereGeometry(0.07, 8, 6), M.glow, 0, 0.3, -0.04),
    ),
  },
];
