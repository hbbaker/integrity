import { surfaceMaterial } from '../../core/client/graphics/surfaces.js';
import { xboxMaterial } from '../../core/client/graphics/materials.js';
import * as THREE from 'three';
import { BodyRig, group, mesh } from './body-rig.js';
import { findPart, suitKit } from '../suit/suit-parts.js';

/*
 * The mech suit body: a BodyRig dressed with the chosen suit parts. It is the same
 * skeleton as the grey human, so the same pose code drives either; the suit is just
 * scaled up by CONFIG.suit.scale where it is placed in a scene.
 */

export const SUIT_MATERIALS = {
  armor: surfaceMaterial('plate', { color: '#4d5560', glow: '#00f0ff', metalness: 0.75, roughness: 0.42, bumpScale: 2.4 }),
  dark: surfaceMaterial('brushed', { color: '#15181b', metalness: 0.85, roughness: 0.34, bumpScale: 2 }),
  joint: surfaceMaterial('brushed', { color: '#39403d', metalness: 0.9, roughness: 0.3, bumpScale: 1.8 }),
  trim: surfaceMaterial('brushed', { color: '#a7adb3', metalness: 0.9, roughness: 0.3, bumpScale: 1.5 }),
  glow: xboxMaterial({ color: 0x04121a, emissive: 0x00f0ff, emissiveIntensity: 1.8, roughness: 0.4, metalness: 0.2 }),
};

const HINGE_X = 0.27; // the back hatch is hinged on the wearer's right
const HATCH_ANGLE = 2.0; // radians the back hatch swings open (out to the back)
const REAR_Z = 0.05; // chest pieces further back than this ride on the hatch
const LIMB_SHELL_ANGLE = 1.7; // radians the rear shell of a limb swings open
const ARM_SPREAD = 1.0; // radians the arms swing out to the sides
const LEG_SPLAY = 0.4; // radians the legs swing apart
const HEAD_TIP = -0.45; // radians the head tips forward, out of the way of the open back

/** The hollow the pilot steps into: the inside face of the front shell, lit by two strips. */
function buildCavity() {
  return group(
    mesh(new THREE.BoxGeometry(0.46, 0.44, 0.02), SUIT_MATERIALS.dark, 0, 0.27, 0.01),
    mesh(new THREE.BoxGeometry(0.3, 0.03, 0.01), SUIT_MATERIALS.glow, 0, 0.38, 0.025),
    mesh(new THREE.BoxGeometry(0.3, 0.03, 0.01), SUIT_MATERIALS.glow, 0, 0.18, 0.025),
  );
}

/** A panel on a vertical hinge. `side` (-1 left, 1 right) is where the hinge is; opening swings it out to the back. */
function hingedPanel(side, hingeX, y, z, width, height, depth, material, glowMaterial) {
  const hinge = new THREE.Group();
  hinge.position.set(hingeX, y, z);
  hinge.add(
    mesh(new THREE.BoxGeometry(width, height, depth), material, -side * width / 2, 0, 0),
    mesh(new THREE.BoxGeometry(width * 0.6, 0.02, depth + 0.01), glowMaterial, -side * width / 2, height * 0.25, 0),
  );
  return { hinge, side, angle: LIMB_SHELL_ANGLE };
}

/** Remove everything the suit added to a body (hatch and shells), leaving the plain skeleton. */
export function clearSuitExtras(body) {
  for (const extra of body.suitExtras ?? []) {
    extra.hinge.traverse((node) => { if (node.geometry) node.geometry.dispose(); });
    extra.hinge.removeFromParent();
  }
  body.suitExtras = [];
  body.shells = [];
  body.hatch = null;
}

/** Add the opening parts to a bare body: the back hatch and a rear shell on each arm and leg. */
function addSuitExtras(body) {
  clearSuitExtras(body);
  const hatchHinge = new THREE.Group();
  hatchHinge.position.x = HINGE_X;
  const hatchMount = new THREE.Group();
  hatchMount.position.x = -HINGE_X;
  hatchHinge.add(hatchMount);
  const cavity = buildCavity();
  body.torso.add(cavity, hatchHinge);
  body.hatch = { hinge: hatchHinge, mount: hatchMount, side: 1, angle: HATCH_ANGLE };
  body.suitExtras.push({ hinge: hatchHinge }, { hinge: cavity });
  body.shells = [];
  for (const arm of body.arms) {
    const shell = hingedPanel(arm.side, arm.side * 0.075, -0.3, 0.075, 0.15, 0.42, 0.03, SUIT_MATERIALS.armor, SUIT_MATERIALS.glow);
    arm.pivot.add(shell.hinge);
    body.suitExtras.push(shell);
    body.shells.push(shell);
  }
  for (const leg of body.legs) {
    const shell = hingedPanel(leg.side, leg.side * 0.07, -0.3, 0.09, 0.14, 0.5, 0.03, SUIT_MATERIALS.armor, SUIT_MATERIALS.glow);
    leg.pivot.add(shell.hinge);
    body.suitExtras.push(shell);
    body.shells.push(shell);
  }
}

/** Fit a chest: the front half stays on the torso, everything at the back rides on the hatch. */
function fitChest(body, build) {
  const whole = build(SUIT_MATERIALS, 0);
  const front = group();
  const rear = group();
  for (const child of [...whole.children]) (child.position.z > REAR_Z ? rear : front).add(child);
  body.setSlot('chest', () => front, SUIT_MATERIALS);
  for (const old of [...body.hatch.mount.children]) {
    old.traverse((node) => { if (node.geometry) node.geometry.dispose(); });
    body.hatch.mount.remove(old);
  }
  body.hatch.mount.add(rear);
}

/** Dress a body in the suit parts of `selection` (`{ head: id, arms: id, ... }`), with the hatch and shells. */
export function dressSuitBody(body, selection) {
  addSuitExtras(body);
  const kit = suitKit(selection);
  for (const slot of ['head', 'arms', 'legs', 'boots']) body.setSlot(slot, kit[slot], SUIT_MATERIALS);
  fitChest(body, kit.chest);
  setSuitOpen(body, 0);
}

/** A new body dressed in the suit. */
export function createSuitBody(selection) {
  const body = new BodyRig(SUIT_MATERIALS);
  dressSuitBody(body, selection);
  return body;
}

/** Open (1) or close (0) the suit: the back hatch and every limb shell swing open, the arms and legs spread, the head tips. */
export function setSuitOpen(body, amount) {
  if (!body.hatch) return;
  body.hatch.hinge.rotation.y = body.hatch.side * body.hatch.angle * amount;
  for (const shell of body.shells) shell.hinge.rotation.y = shell.side * shell.angle * amount;
  body.head.rotation.x = HEAD_TIP * amount;
  body.armL.pivot.rotation.z = -ARM_SPREAD * amount;
  body.armR.pivot.rotation.z = ARM_SPREAD * amount;
  body.legL.pivot.rotation.z = -LEG_SPLAY * amount;
  body.legR.pivot.rotation.z = LEG_SPLAY * amount;
}

/** Swap one slot of a suit body. */
export function setSuitPart(body, slot, id) {
  const part = findPart(slot, id);
  if (slot === 'chest') fitChest(body, part.build);
  else body.setSlot(slot, part.build, SUIT_MATERIALS);
}
