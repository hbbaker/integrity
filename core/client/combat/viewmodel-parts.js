/*
 * Small mesh helpers for building first-person models. They are plain geometry: the look
 * (materials, colours, hands) belongs to the game's model builders.
 */
import * as THREE from 'three';

export function box(width, height, depth, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
}

/** A cylinder laid along -Z, the way a barrel points. */
export function barrelPart(radius, length, mat) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), mat);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

/** Position an object and return it, so parts can be listed inline. */
export function at(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}
