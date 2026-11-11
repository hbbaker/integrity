import * as THREE from 'three';
import { material } from '../../core/client/graphics/materials.js';
import { surfaceMaterial } from '../../core/client/graphics/surfaces.js';
import { box, at, lathePart, glowMaterial } from '../../core/client/combat/viewmodel-parts.js';

/*
 * What the weapon files share: the materials, the first-person hands and sleeves, and the RGB glow helpers.
 * Each weapon's own look is in its own file (nail-gun.js, rivet-blaster.js, ...).
 *
 * LOOK: every weapon (except the orange boring launcher) is made of neutral materials (gunmetal, steel, alloy, graphite, rubber) with real-looking
 * surface textures and height maps. The ONLY colour is the glowing accents, and those cycle through the RGB
 * spectrum (rgbColor): each glowing part has its own phase, so a weapon shows a rolling rainbow.
 */

const RGB_CYCLES_PER_SECOND = 0.12;
const RGB_SATURATION = 1;
const RGB_LIGHTNESS = 0.55;
const rgbScratch = new THREE.Color();

/**
 * The RGB glow colour at `time` seconds for a part with the given `phase` (0..1 shifts it round the spectrum).
 * The returned colour is shared and changes on the next call: copy it at once.
 */
export function rgbColor(phase, time) {
  const hue = (((time * RGB_CYCLES_PER_SECOND + phase) % 1) + 1) % 1;
  return rgbScratch.setHSL(hue, RGB_SATURATION, RGB_LIGHTNESS);
}

/** Make a list of [material, phase] glow parts follow the RGB cycle. Returns `tint(time)`; call it from `animate`. */
export function rgbGlows(entries) {
  return (time) => {
    for (const [glowMaterialPart, phase] of entries) glowMaterialPart.emissive.copy(rgbColor(phase, time));
  };
}

/** Built on first use, not on import, so config files can import the weapon files without a canvas. */
let materials = null;
let sharedGlows = null;

function createMaterials() {
  const built = {
    gunmetal: surfaceMaterial('parkerized', { color: '#2b2e32', metalness: 0.78, roughness: 0.52, bumpScale: 1.8 }), // coated steel: slides, receivers
    steel: surfaceMaterial('brushed', { color: '#a3a8ad', metalness: 0.95, roughness: 0.27, bumpScale: 1.4 }), // bare steel: barrels, bolts, blades
    alloy: surfaceMaterial('brushed', { color: '#5c6167', metalness: 0.88, roughness: 0.4, bumpScale: 1.6 }), // anodised aluminium: frames, handguards
    polymer: surfaceMaterial('weave', { color: '#1b1c1f', metalness: 0.15, roughness: 0.5, bumpScale: 2.4 }), // carbon-fibre stocks
    grip: surfaceMaterial('knurl', { color: '#1c1d20', metalness: 0.05, roughness: 0.82, bumpScale: 3 }), // diamond-cut grips
    ribbed: surfaceMaterial('ribbed', { color: '#222428', metalness: 0.3, roughness: 0.6, bumpScale: 3 }), // pump forend
    rubber: surfaceMaterial('rubber', { color: '#16171a', metalness: 0, roughness: 0.86, bumpScale: 3 }),
    orange: surfaceMaterial('plate', { color: '#ff6a00', glow: '#ffffff', metalness: 0.35, roughness: 0.46, bumpScale: 2.8, emissiveIntensity: 1.5 }), // safety-orange painted plate (the boring launcher only); its seam lights are tinted by the RGB cycle
    trace: surfaceMaterial('circuit', { color: '#101114', glow: '#ffffff', metalness: 0.5, roughness: 0.4, bumpScale: 3, emissiveIntensity: 1.7 }), // circuit traces: white glow map, tinted by the RGB cycle
    glove: material(0x0c0d0e, { metalness: 0.7, roughness: 0.4 }),
    sleeve: material(0x1a1c1e, { metalness: 0.75, roughness: 0.42 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xffffff, emissiveIntensity: 1.8, roughness: 0.4 }),
  };
  sharedGlows = rgbGlows([[built.trace, 0.0], [built.glow, 0.33], [built.orange, 0.66]]);
  return built;
}

/** The shared materials (never modified per instance, so one set serves every model). */
export const MAT = new Proxy({}, {
  get(target, name) {
    materials ??= createMaterials();
    return materials[name];
  },
});

/** Move the glow of the shared materials (sleeve rings, circuit traces) along the RGB cycle. Called every frame by the model wrapper. */
export function tickSharedGlow(time) {
  if (materials) sharedGlows(time);
}

/** Where each shoulder is in view space: down and out to the side, behind the camera, so a sleeve always runs out of the picture. */
const SHOULDER = { x: 0.34, y: -0.55, z: 0.5 };
const SLEEVE_BAND_DISTANCE = 0.14; // the glowing ring sits this far from the wrist

/**
 * Sleeve from the wrist (origin) toward the shoulder, wide end away from the hand. The HoldableSystem stretches it
 * every frame (see `userData.limb`) so it always joins the shoulder, whatever the hand does: raised for a reload,
 * thrown into a punch. `dir` only says which side the arm is on (and the sleeve's first shape).
 */
export function makeSleeve(dir) {
  const side = Math.sign(dir[0]) || 1;
  const direction = new THREE.Vector3(...dir).normalize();
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.046, 1, 10), MAT.sleeve); // unit length, stretched to the shoulder
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.067, 0.067, 0.02, 12), MAT.glow); // glowing RGB ring
  const group = new THREE.Group();
  group.add(sleeve, band);
  group.userData.limb = { sleeve, band, shoulder: [side * SHOULDER.x, SHOULDER.y, SHOULDER.z], bandDistance: SLEEVE_BAND_DISTANCE };
  sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction); // until the first frame
  sleeve.position.copy(direction).multiplyScalar(0.4);
  sleeve.scale.y = 0.8;
  band.quaternion.copy(sleeve.quaternion);
  band.position.copy(direction).multiplyScalar(SLEEVE_BAND_DISTANCE);
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

/** A glowing ring round a barrel. Its colour is set every frame from the RGB cycle (see rgbGlows). */
export function glowRing(radius, z, y, length = 0.01) {
  const ringMaterial = glowMaterial(0xffffff, 0.5);
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
