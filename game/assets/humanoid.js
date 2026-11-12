import * as THREE from 'three';
import { surfaceMaterial } from '../../core/client/graphics/surfaces.js';
import { ARM_LEN, group as part, mesh } from './body-rig.js';

/*
 * The plain grey placeholder human. One flat grey skin on simple shapes, so the
 * body reads as "a person" until real character art exists. It is a kit for
 * BodyRig: one builder per slot, same proportions as the suit parts it sits in.
 */

let materials = null;

function createMaterials() {
  return {
    skin: surfaceMaterial('rubber', { color: '#9a9ea3', roughness: 0.85, metalness: 0, bumpScale: 1 }),
    dark: surfaceMaterial('rubber', { color: '#6f7378', roughness: 0.9, metalness: 0, bumpScale: 1 }),
    joint: surfaceMaterial('rubber', { color: '#82868b', roughness: 0.9, metalness: 0, bumpScale: 1 }),
  };
}

/** The grey skin, dark grey and joint grey. Made on first use, so importing this needs no canvas. */
export const HUMANOID_MATERIALS = new Proxy({}, {
  get(target, name) {
    materials ??= createMaterials();
    return materials[name];
  },
});

export const HUMANOID_KIT = {
  head: (M) => part(
    mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), M.joint, 0, -0.02, 0), // neck
    mesh(new THREE.SphereGeometry(0.15, 10, 8), M.skin, 0, 0.17, 0), // head
  ),
  chest: (M) => part(
    mesh(new THREE.BoxGeometry(0.5, 0.52, 0.28), M.skin, 0, 0.27, 0),
    mesh(new THREE.SphereGeometry(0.09, 8, 6), M.joint, -0.28, 0.46, 0), // shoulder balls
    mesh(new THREE.SphereGeometry(0.09, 8, 6), M.joint, 0.28, 0.46, 0),
  ),
  arms: (M) => ({
    sleeve: part(
      mesh(new THREE.CylinderGeometry(0.055, 0.045, ARM_LEN, 8), M.skin, 0, -ARM_LEN / 2, 0),
      mesh(new THREE.SphereGeometry(0.05, 8, 6), M.joint, 0, -ARM_LEN * 0.5, 0), // elbow
    ),
    hand: part(mesh(new THREE.BoxGeometry(0.09, 0.1, 0.11), M.skin)),
  }),
  legs: (M) => part(
    mesh(new THREE.BoxGeometry(0.15, 0.27, 0.16), M.skin, 0, -0.13, 0), // thigh
    mesh(new THREE.SphereGeometry(0.075, 8, 6), M.joint, 0, -0.28, 0), // knee
    mesh(new THREE.BoxGeometry(0.12, 0.26, 0.14), M.dark, 0, -0.41, 0), // shin
  ),
  boots: (M) => part(mesh(new THREE.BoxGeometry(0.15, 0.08, 0.27), M.dark, 0, -0.51, -0.05)),
};
