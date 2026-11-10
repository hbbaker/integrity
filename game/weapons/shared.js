import * as THREE from 'three';
import { material } from '../../core/client/graphics/materials.js';
import { surfaceMaterial } from '../../core/client/graphics/surfaces.js';
import { box, at, lathePart, glowMaterial } from '../../core/client/combat/viewmodel-parts.js';

/*
 * What the weapon files share: the materials, the first-person hands and sleeves, and two small glow helpers.
 * Each weapon's own look is in its own file (nail-gun.js, rivet-blaster.js, ...).
 */

/** Built on first use, not on import, so config files can import the weapon files without a canvas. */
let materials = null;

function createMaterials() {
  return {
    metal: surfaceMaterial('brushed', { color: '#30343a', metalness: 0.85, roughness: 0.38, bumpScale: 2.2 }),
    steel: surfaceMaterial('brushed', { color: '#80868e', metalness: 0.9, roughness: 0.3, bumpScale: 1.6 }),
    polymer: surfaceMaterial('weave', { color: '#1f2126', metalness: 0.2, roughness: 0.55, bumpScale: 2.5 }),
    wood: material(0x6b4423, { roughness: 0.65 }),
    brass: material(0xb08a2e, { metalness: 0.9, roughness: 0.3 }),
    accent: surfaceMaterial('circuit', { color: '#2a1466', glow: ['#00f0ff', '#ff2bd6', '#3dff9a'], metalness: 0.4, roughness: 0.45, bumpScale: 3, emissiveIntensity: 1.8 }), // telecom circuitry that glows
    hazard: surfaceMaterial('plate', { color: '#f2c200', glow: '#3dff9a', metalness: 0.35, roughness: 0.42, bumpScale: 2.8 }), // construction-yellow armour plating with seam lights
    orange: surfaceMaterial('plate', { color: '#ff6a00', glow: '#ff2bd6', metalness: 0.3, roughness: 0.45, bumpScale: 2.8 }),
    rubber: surfaceMaterial('rubber', { color: '#15161a', metalness: 0, roughness: 0.85, bumpScale: 3 }),
    hose: material(0x1f6fd6, { roughness: 0.5 }), // air hose
    glove: material(0x0b0d0c, { metalness: 0.85, roughness: 0.34 }), // black cybernetic hand
    sleeve: material(0x1d2421, { metalness: 0.8, roughness: 0.4 }), // dark armoured forearm
    glow: new THREE.MeshStandardMaterial({ color: 0x04120a, emissive: 0x2dff6a, emissiveIntensity: 1.8, roughness: 0.4 }),
  };
}

/** The shared materials (never modified per instance, so one set serves every model). */
export const MAT = new Proxy({}, {
  get(target, name) {
    materials ??= createMaterials();
    return materials[name];
  },
});

/** Jacket sleeve from the wrist (origin) along `dir` (gun space), wide end away from the hand. */
export function makeSleeve(dir) {
  const length = 0.8;
  const direction = new THREE.Vector3(...dir).normalize();
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.046, length, 10), MAT.sleeve);
  // The cylinder's +Y axis is its wide (elbow) end; point it along `direction`.
  sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  sleeve.position.copy(direction).multiplyScalar(length / 2);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.067, 0.067, 0.02, 12), MAT.glow); // glowing green ring
  band.quaternion.copy(sleeve.quaternion);
  band.position.copy(direction).multiplyScalar(0.14);
  const group = new THREE.Group();
  group.add(sleeve, band);
  return group;
}

/**
 * First-person arm: a black cybernetic hand (palm, curled fingers, thumb) plus an armoured
 * forearm that runs from the wrist back toward the camera and out of the frame.
 *
 * The group's origin is the wrist. `palmRoll` rotates the hand about Z so the palm
 * can face a vertical grip (+/- 90 degrees) or wrap under a horizontal barrel
 * (180 degrees). `sleeveDir` is the sleeve's direction in the gun's space; it is
 * a separate child so it is NOT rotated with the hand.
 */
let armsEnabled = true; // false while building the third-person copies (the cyborg has its own arms)

/** Turn the first-person hands on or off for the models built next. */
export function setArmsEnabled(enabled) {
  armsEnabled = enabled;
}

export function makeArm(side, palmRoll, sleeveDir) {
  const arm = new THREE.Group();
  if (!armsEnabled) return arm;
  const hand = new THREE.Group();
  hand.add(box(0.08, 0.045, 0.095, MAT.glove));
  const fingers = at(box(0.08, 0.04, 0.055, MAT.glove), 0, -0.027, -0.07);
  fingers.rotation.x = 0.7; // curled around whatever is being held
  const thumb = at(box(0.024, 0.028, 0.06, MAT.glove), -side * 0.05, 0.005, -0.03);
  thumb.rotation.y = side * 0.4;
  hand.add(fingers, thumb, at(box(0.05, 0.008, 0.05, MAT.glow), 0, 0.027, 0)); // knuckle light
  hand.rotation.z = palmRoll;
  arm.add(hand);

  arm.add(makeSleeve(sleeveDir));
  return arm;
}

/** A glowing ring round a barrel. */
export function glowRing(radius, color, z, y, length = 0.01) {
  const ringMaterial = glowMaterial(color, 0.5);
  const ring = at(lathePart([[radius, 0], [radius, length]], ringMaterial), 0, y, z);
  return { ring, material: ringMaterial };
}

/** Heat that jumps on a shot and cools: the glow after firing. */
export function makeHeat() {
  let heat = 0;
  return (dt, pulse) => {
    heat = Math.max(heat * Math.exp(-dt * 2.5), pulse);
    return heat;
  };
}
