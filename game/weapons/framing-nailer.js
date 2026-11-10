/*
 * FRAMING NAILER: The automatic: a nail drum that spins as it feeds, an 8-cell gauge, a heat ring on the nose.
 */

import * as THREE from 'three';
import { box, at, bevelBox, lathePart, glowMaterial, makeGauge } from '../../core/client/combat/viewmodel-parts.js';
import { MAT, makeArm, glowRing, makeHeat } from './shared.js';
import { Firearm } from '../../core/client/combat/firearm.js';

/** The numbers: damage, speed, ammo, recoil, sights. */
export const config = {
  id: 'smg', name: 'FRAMING NAILER', type: 'firearm', auto: true, damage: 7, interval: 0.075, mag: 30, reserve: 120, maxReserve: 180,
  reloadTime: 1.5, spread: 0.02, pellets: 1, range: 90, critMul: 2, knockback: 1.2, stun: 0.05,
  camKick: 0.007, camYaw: 0.006, climb: 0.0045, kickZ: 0.014, kickRot: 0.035, flashSize: 0.22, worldLight: 18,
  heat: 2.5, tracerColor: 0x9ff3ff,
  ads: { x: 0, y: -0.08, z: -0.3, fovDrop: 14 },
};

function buildSmg() {
  const root = new THREE.Group();
  const mag = new THREE.Group(); // the nail coil: a drum below the receiver, spins as it feeds
  const drum = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 28), MAT.hazard);
  shell.rotation.z = Math.PI / 2;
  const coreGlow = glowMaterial(0x00f0ff, 1.6);
  const window3 = new THREE.Mesh(new THREE.TorusGeometry(0.083, 0.006, 8, 32), coreGlow);
  window3.rotation.y = Math.PI / 2;
  window3.position.x = -0.031;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.075, 16), MAT.steel);
  hub.rotation.z = Math.PI / 2;
  drum.add(shell, window3, hub);
  for (let i = 0; i < 10; i++) { // nail slots round the rim
    const angle = (i / 10) * Math.PI * 2;
    const slot = bevelBox(0.064, 0.016, 0.02, MAT.brass, 0.003);
    slot.position.set(0, Math.sin(angle) * 0.098, Math.cos(angle) * 0.098);
    slot.rotation.x = -angle;
    drum.add(slot);
  }
  mag.add(drum, at(bevelBox(0.04, 0.05, 0.14, MAT.brass, 0.006), 0, 0.1, -0.06));
  mag.position.set(0, -0.15, -0.05);
  const grip = at(bevelBox(0.055, 0.13, 0.065, MAT.rubber, 0.012), 0, -0.1, 0.13);
  grip.rotation.x = 0.15;
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.3, -0.45, 1]), 0.052, -0.1, 0.13);
  const leftArm = at(makeArm(-1, Math.PI, [-0.3, -0.35, 1]), 0, -0.07, -0.19); // under the nose
  const barrel = at(lathePart([[0.015, 0], [0.015, 0.2], [0.02, 0.2], [0.02, 0.215]], MAT.steel, 16), 0, 0.01, -0.3);
  const heat = glowRing(0.0215, 0xff7a1a, -0.34, 0.01, 0.01);
  const gauge = makeGauge(8, { pitch: 0.028 });
  gauge.group.position.set(-0.0365, 0.02, 0.15);
  root.add(
    at(bevelBox(0.07, 0.1, 0.4, MAT.hazard, 0.012), 0, 0, 0), // yellow housing
    at(bevelBox(0.074, 0.06, 0.2, MAT.metal, 0.01), 0, -0.01, -0.22), // nose
    barrel,
    heat.ring,
    mag,
    grip,
    at(bevelBox(0.045, 0.06, 0.2, MAT.rubber, 0.01), 0, 0, 0.3), // handle
    at(box(0.03, 0.03, 0.08, MAT.steel), 0, 0.065, -0.05), // rear sight
    at(box(0.01, 0.055, 0.01, MAT.steel), 0, 0.0525, -0.5), // front post
    at(bevelBox(0.072, 0.012, 0.15, MAT.orange, 0.004), 0, 0.052, -0.2),
    gauge.group,
    rightArm,
    leftArm,
  );
  const muzzle = at(new THREE.Object3D(), 0, 0.01, -0.5);
  root.add(muzzle);
  const cool = makeHeat();
  return {
    root, muzzle, home: { x: 0.2, y: -0.2, z: -0.4 },
    parts: { mag, magBaseY: mag.position.y, support: { object: leftArm, baseY: leftArm.position.y } },
    animate(dt, time, state) {
      gauge.update(state.ammo, time);
      const hot = cool(dt, state.pulse);
      heat.material.emissiveIntensity = 0.4 + hot * 7;
      drum.rotation.x += dt * (state.pulse > 0.05 ? 34 * state.pulse + 6 : 0); // spins while it feeds nails
      const low = state.ammo <= 0.25;
      coreGlow.emissive.setHex(low ? 0xff3b5c : 0x00f0ff);
      coreGlow.emissiveIntensity = (low ? 1.2 + Math.sin(time * 12) : 0.7 + state.ammo) + hot * 2;
    },
  };
}

export const weapon = {
  config,
  holdable: { type: 'firearm', class: Firearm },
  model: { build: buildSmg },
};
