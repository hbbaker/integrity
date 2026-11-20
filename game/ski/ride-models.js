import * as THREE from 'three';
import { material } from '../../core/client/graphics/materials.js';

/*
 * The things a rider stands on and holds: a ski, a board, a pole. Procedural, like the rest of the
 * game's models. Each builder takes a `look` (sizes in metres, colours), so a kit piece is one look.
 *
 * Model space: a ski or board lies on y = 0 with its nose toward -Z, and the rider's foot goes at the
 * origin (a ski) or at the two binding points (a board). A pole hangs down from its grip at the origin.
 */

export const DEFAULT_LOOKS = {
  ski: { length: 1.7, width: 0.095, thickness: 0.014, tipLength: 0.2, tipRise: 0.5, footFromTail: 0.78, top: 0xff6a00, binding: 0x1d2421 },
  board: { length: 1.5, width: 0.28, thickness: 0.02, endRise: 0.22, bindingSpread: 0.26, top: 0x7a3cff, binding: 0x1d2421 },
  pole: { length: 1.15, radius: 0.009, gripLength: 0.14, gripRadius: 0.017, basketRadius: 0.045, basketFromTip: 0.07, shaft: 0xcfd3d6, grip: 0x1d2421 },
};

const BINDING = { width: 0.075, height: 0.05, length: 0.3 }; // a boot plate
const ROUND_SIDES = 12;

function part(geometry, partMaterial, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, partMaterial);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

/** One ski. Its turned-up tip is at -Z. */
export function buildSki(look = DEFAULT_LOOKS.ski) {
  const group = new THREE.Group();
  const top = material(look.top, { roughness: 0.4, metalness: 0.3 });
  const dark = material(look.binding, { roughness: 0.6 });
  const flatLength = look.length - look.tipLength;
  const tail = look.footFromTail; // z of the tail end
  group.add(part(new THREE.BoxGeometry(look.width, look.thickness, flatLength), top, 0, look.thickness / 2, tail - flatLength / 2));
  const tip = part(new THREE.BoxGeometry(look.width, look.thickness, look.tipLength), top);
  tip.geometry.translate(0, look.thickness / 2, -look.tipLength / 2); // hinge at its back edge
  tip.position.set(0, 0, tail - flatLength);
  tip.rotation.x = look.tipRise;
  group.add(tip, part(new THREE.BoxGeometry(BINDING.width, BINDING.height, BINDING.length), dark, 0, look.thickness + BINDING.height / 2, 0));
  return group;
}

/** A snowboard: both ends turn up, and a binding sits each side of the middle. */
export function buildBoard(look = DEFAULT_LOOKS.board) {
  const group = new THREE.Group();
  const top = material(look.top, { roughness: 0.4, metalness: 0.3 });
  const dark = material(look.binding, { roughness: 0.6 });
  const radius = look.width / 2;
  const flatLength = look.length - look.width;
  group.add(part(new THREE.BoxGeometry(look.width, look.thickness, flatLength), top, 0, look.thickness / 2, 0));
  for (const end of [-1, 1]) {
    const cap = part(new THREE.CylinderGeometry(radius, radius, look.thickness, ROUND_SIDES, 1, false, 0, Math.PI), top);
    cap.geometry.rotateY(end < 0 ? Math.PI / 2 : -Math.PI / 2); // the round side points out along the board
    cap.geometry.translate(0, look.thickness / 2, 0);
    cap.position.set(0, 0, end * flatLength / 2);
    cap.rotation.x = -end * look.endRise;
    group.add(cap);
    const binding = part(new THREE.BoxGeometry(BINDING.length, BINDING.height, BINDING.width * 1.6), dark, 0, look.thickness + BINDING.height / 2, end * look.bindingSpread);
    group.add(binding);
  }
  return group;
}

/** A ski pole. It hangs along -Y from the grip. */
export function buildPole(look = DEFAULT_LOOKS.pole) {
  const group = new THREE.Group();
  const shaft = material(look.shaft, { roughness: 0.35, metalness: 0.7 });
  const dark = material(look.grip, { roughness: 0.7 });
  group.add(
    part(new THREE.CylinderGeometry(look.radius, look.radius * 0.6, look.length, 6), shaft, 0, -look.length / 2, 0),
    part(new THREE.CylinderGeometry(look.gripRadius, look.gripRadius, look.gripLength, 8), dark, 0, -look.gripLength / 2 + 0.02, 0),
    part(new THREE.CylinderGeometry(look.basketRadius, look.basketRadius, 0.006, 8), dark, 0, -look.length + look.basketFromTip, 0),
  );
  return group;
}

/** Free the geometries and materials of a model that one of the builders made. */
export function disposeModel(model) {
  const materials = new Set();
  model.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry.dispose();
    materials.add(node.material);
  });
  for (const used of materials) used.dispose();
  model.removeFromParent();
}
