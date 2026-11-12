/*
 * FRAMING NAILER: the automatic, shaped like a drum-fed submachine gun: a sculpted receiver with a top rail, a finned
 * barrel with a compensator, a vented handguard, a raked pistol grip, a wire-frame stock and a nail drum that spins as
 * it feeds. Neutral metal; the only colour is the RGB glow.
 */

import * as THREE from 'three';
import { box, at, bevelBox, lathePart, glowMaterial, makeGauge, sideProfile, tubePart } from '../../core/client/combat/viewmodel-parts.js';
import { MAT, makeArm, glowRing, makeHeat, rgbColor, rgbGlows } from './shared.js';
import { Firearm } from '../../core/client/combat/firearm.js';

/** The numbers: damage, speed, ammo, recoil, sights. */
export const config = {
  id: 'smg', name: 'FRAMING NAILER', type: 'firearm', auto: true, damage: 7, interval: 0.075, mag: 30, reserve: 120, maxReserve: 180,
  reloadTime: 1.5, spread: 0.02, pellets: 1, range: 90, critMul: 2, knockback: 1.2, stun: 0.05,
  camKick: 0.007, camYaw: 0.006, climb: 0.0045, kickZ: 0.014, kickRot: 0.035, flashSize: 0.22, worldLight: 18,
  heat: 2.5, tracerColor: 0x9ff3ff,
  ads: { x: 0, y: -0.08, z: -0.3, fovDrop: 14 },
};

// Side outlines in [z, y] (forward is -z). The sight tops are at y = 0.08 so ADS lines up.
const RECEIVER = [[-0.2, 0.05], [0.0, 0.058], [0.16, 0.055], [0.215, 0.04], [0.23, 0.0], [0.22, -0.03], [0.12, -0.045], [-0.2, -0.045], [-0.215, -0.01]];
const HANDGUARD = [[-0.2, 0.04], [-0.34, 0.026], [-0.345, -0.03], [-0.28, -0.062], [-0.2, -0.062]];
const GRIP = [[0.1, -0.04], [0.17, -0.04], [0.185, -0.162], [0.132, -0.165]];
const BUTT_PLATE = [[0.49, 0.03], [0.505, 0.03], [0.52, -0.1], [0.5, -0.108], [0.485, -0.09]];

function buildDrum() {
  const drum = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 12), MAT.alloy);
  shell.rotation.z = Math.PI / 2;
  const coreGlow = glowMaterial(0xffffff, 1.6);
  const window3 = new THREE.Mesh(new THREE.TorusGeometry(0.083, 0.006, 5, 14), coreGlow);
  window3.rotation.y = Math.PI / 2;
  window3.position.x = -0.031;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.075, 8), MAT.steel);
  hub.rotation.z = Math.PI / 2;
  drum.add(shell, window3, hub);
  for (let i = 0; i < 10; i++) { // nail slots round the rim
    const angle = (i / 10) * Math.PI * 2;
    const slot = bevelBox(0.064, 0.016, 0.02, MAT.steel, 0.003);
    slot.position.set(0, Math.sin(angle) * 0.098, Math.cos(angle) * 0.098);
    slot.rotation.x = -angle;
    drum.add(slot);
  }
  return { drum, coreGlow };
}

/** A barrel with cooling fins along its length and a slotted compensator at the tip. */
function finnedBarrel() {
  const profile = [[0.014, 0]];
  for (let z = 0.02; z < 0.15; z += 0.02) profile.push([0.014, z], [0.021, z + 0.002], [0.021, z + 0.01], [0.014, z + 0.012]);
  profile.push([0.014, 0.17], [0.018, 0.172], [0.018, 0.2], [0.012, 0.202], [0.012, 0.215]);
  return lathePart(profile, MAT.steel, 16);
}

function buildSmg() {
  const root = new THREE.Group();
  const mag = new THREE.Group(); // the nail coil: a drum below the receiver, spins as it feeds
  const { drum, coreGlow } = buildDrum();
  mag.add(drum, at(sideProfile([[-0.03, 0.03], [0.03, 0.03], [0.034, 0.1], [-0.034, 0.1]], 0.04, MAT.alloy, 0.006), 0, 0, 0)); // the feed neck up to the receiver
  mag.position.set(0, -0.15, -0.05);
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.3, -0.45, 1]), 0.052, -0.1, 0.145);
  const leftArm = at(makeArm(-1, Math.PI, [-0.3, -0.35, 1]), 0, -0.085, -0.19); // under the handguard
  const barrel = at(finnedBarrel(), 0, 0.01, -0.3);
  const heat = glowRing(0.0215, -0.34, 0.01, 0.01);
  const gauge = makeGauge(8, { pitch: 0.028, color: (time) => rgbColor(0.5, time) });
  gauge.group.position.set(-0.0325, 0.012, 0.15);
  const stripe = glowMaterial(0xffffff, 1.5);
  const sightDot = glowMaterial(0xffffff, 2.4);
  const glows = rgbGlows([[heat.material, 0], [coreGlow, 0.25], [stripe, 0.55], [sightDot, 0.8]]);
  const guard = tubePart([[0, -0.045, 0.02], [0, -0.08, 0.03], [0, -0.09, 0.07], [0, -0.08, 0.1], [0, -0.045, 0.108]], 0.0042, MAT.gunmetal);
  const stockWires = [-1, 1].map((side) => tubePart([[side * 0.022, 0.02, 0.22], [side * 0.024, 0.02, 0.36], [side * 0.026, -0.0, 0.47], [side * 0.026, -0.07, 0.497]], 0.0055, MAT.steel));
  root.add(
    at(sideProfile(RECEIVER, 0.06, MAT.gunmetal, 0.01), 0, 0, 0),
    at(sideProfile(HANDGUARD, 0.066, MAT.alloy, 0.012), 0, 0, 0),
    ...[0, 1, 2, 3].map((i) => at(box(0.0016, 0.012, 0.03, MAT.rubber), 0.0334, -0.01, -0.22 - i * 0.04)), // handguard vents
    at(box(0.0014, 0.004, 0.14, stripe), 0.0305, 0.036, -0.02), // glow inlay on the receiver
    at(box(0.022, 0.008, 0.28, MAT.alloy), 0, 0.062, 0.0), // top rail
    barrel,
    heat.ring,
    mag,
    at(sideProfile(GRIP, 0.05, MAT.grip, 0.008), 0, 0, 0),
    guard,
    at(bevelBox(0.008, 0.026, 0.01, MAT.steel, 0.003), 0, -0.065, 0.058), // trigger
    ...stockWires,
    at(sideProfile(BUTT_PLATE, 0.05, MAT.rubber, 0.005), 0, 0, 0),
    at(bevelBox(0.008, 0.018, 0.06, MAT.gunmetal, 0.003), -0.012, 0.067, 0.0), // rear sight, left blade
    at(bevelBox(0.008, 0.018, 0.06, MAT.gunmetal, 0.003), 0.012, 0.067, 0.0), // rear sight, right blade (tops at y 0.076)
    at(box(0.005, 0.006, 0.002, sightDot), -0.012, 0.07, 0.031), // rear dots, on the faces of the blades
    at(box(0.005, 0.006, 0.002, sightDot), 0.012, 0.07, 0.031),
    at(bevelBox(0.012, 0.04, 0.02, MAT.gunmetal, 0.003), 0, 0.045, -0.495), // front post base
    at(bevelBox(0.006, 0.03, 0.006, MAT.steel, 0.001), 0, 0.065, -0.495), // front post: its top is the sight line
    at(box(0.004, 0.005, 0.002, sightDot), 0, 0.074, -0.4915), // its dot
    gauge.group,
    rightArm,
    leftArm,
  );
  const muzzle = at(new THREE.Object3D(), 0, 0.01, -0.52);
  root.add(muzzle);
  const cool = makeHeat();
  return {
    root, muzzle, home: { x: 0.2, y: -0.2, z: -0.4 },
    parts: { mag, magBaseY: mag.position.y, support: { object: leftArm, baseY: leftArm.position.y } },
    animate(dt, time, state) {
      glows(time);
      gauge.update(state.ammo, time);
      const hot = cool(dt, state.pulse);
      heat.material.emissiveIntensity = 0.4 + hot * 7;
      drum.rotation.x += dt * (state.pulse > 0.05 ? 34 * state.pulse + 6 : 0); // spins while it feeds nails
      const low = state.ammo <= 0.25;
      if (low) coreGlow.emissive.setHex(0xff3b5c);
      coreGlow.emissiveIntensity = (low ? 1.2 + Math.sin(time * 12) : 0.7 + state.ammo) + hot * 2;
    },
  };
}

export const weapon = {
  config,
  holdable: { type: 'firearm', class: Firearm },
  model: { build: buildSmg },
};
