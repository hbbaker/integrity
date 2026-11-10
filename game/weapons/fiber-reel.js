/*
 * FIBER REEL: the grapple. Fire at a bot or another player to drag them to you; fire at a wall or the
 * floor to pull yourself to that spot. Fire again while the cable is out to let go; jumping lets go too
 * (and keeps your speed).
 *
 * TUNE THE REEL HERE: the numbers are REEL_TUNING below. The generic grapple behaviour is in
 * core/client/combat/grapple-weapon.js.
 */

import * as THREE from 'three';
import { at, bevelBox, lathePart, makeGauge } from '../../core/client/combat/viewmodel-parts.js';
import { MAT, makeArm, glowRing } from './shared.js';
import { GrappleWeapon } from '../../core/client/combat/grapple-weapon.js';

export const REEL_TUNING = {
  range: 40, // metres the cable reaches
  aimRadius: 0.3, // metres of forgiveness when hooking a bot or player (bigger = easier)
  selfPullSpeed: 24, // m/s you fly toward a wall or the floor
  targetPullSpeed: 18, // m/s a bot or player is dragged toward you
  arriveDistance: 1.6, // metres: the pull stops this far from its goal
  maxSeconds: 2.5, // a pull gives up after this long, however far it is
  cooldown: 1.0, // seconds before the next shot, or before you can let go
  missSeconds: 0.18, // how long the cable shows when it hits nothing
  cableColor: 0xc89bff, // fibre purple
  cableRadius: 0.012, // metres
};

export class FiberReel extends GrappleWeapon {
  get tuning() {
    return REEL_TUNING;
  }
}

/** The weapon's entry in CONFIG.weapons.list (its own numbers are REEL_TUNING above). */
export const config = { id: 'reel', name: 'FIBER REEL', type: 'grapple' };

/** The fiber reel: a yellow launcher with a spool of glowing fibre on top that spins while the cable is out. */
function buildFiberReel() {
  const root = new THREE.Group();
  const grip = at(bevelBox(0.055, 0.15, 0.07, MAT.rubber, 0.012), 0, -0.085, 0.045);
  grip.rotation.x = 0.2;
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.25, -0.5, 1]), 0.052, -0.09, 0.05);
  const leftArm = at(makeArm(-1, Math.PI / 2, [-0.25, -0.5, 1]), -0.052, -0.11, 0.04);

  const spool = new THREE.Group(); // spins about the X axis
  const fibre = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 20), MAT.accent);
  fibre.rotation.z = Math.PI / 2;
  spool.add(fibre);
  for (const side of [-1, 1]) {
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.01, 20), MAT.steel);
    flange.rotation.z = Math.PI / 2;
    flange.position.x = side * 0.04;
    spool.add(flange);
  }
  spool.add(at(bevelBox(0.075, 0.012, 0.03, MAT.orange, 0.003), 0, 0.06, 0)); // a marker, so the spin is visible
  spool.position.set(0, 0.105, -0.07);

  const nozzle = at(lathePart([[0.024, 0], [0.024, 0.12], [0.034, 0.125], [0.034, 0.155], [0.022, 0.16]], MAT.steel), 0, 0.03, -0.27);
  const ring = glowRing(0.0345, 0xc89bff, -0.375, 0.03, 0.01);
  const gauge = makeGauge(6, { pitch: 0.03, size: [0.004, 0.012, 0.02], color: 0xc89bff });
  gauge.group.position.set(-0.0365, 0.03, 0.04);

  root.add(
    spool,
    at(bevelBox(0.07, 0.09, 0.3, MAT.hazard, 0.012), 0, 0.03, -0.1), // yellow housing
    at(bevelBox(0.074, 0.02, 0.1, MAT.orange, 0.005), 0, 0.0, -0.05), // orange band
    grip,
    nozzle,
    ring.ring,
    at(lathePart([[0.01, 0], [0.01, 0.07]], MAT.hose, 10), 0, -0.16, 0.115), // air hose stub under the grip
    gauge.group,
    rightArm,
    leftArm,
  );
  const muzzle = at(new THREE.Object3D(), 0, 0.03, -0.39);
  root.add(muzzle);
  return {
    root, muzzle, home: { x: 0.2, y: -0.2, z: -0.42 },
    parts: { support: { object: leftArm, baseY: leftArm.position.y } },
    animate(dt, time, state) {
      if (state.active) {
        spool.rotation.x -= dt * 16;
        gauge.chase(time);
        ring.material.emissiveIntensity = 3 + Math.sin(time * 30);
      } else {
        gauge.update(1, time); // all cells lit: a full reel
        ring.material.emissiveIntensity = 0.6 + Math.sin(time * 2) * 0.3;
      }
    },
  };
}

export const weapon = {
  config,
  holdable: { type: 'grapple', class: FiberReel },
  model: { build: buildFiberReel },
};
