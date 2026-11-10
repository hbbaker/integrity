/*
 * NAIL GUN: The sidearm: yellow housing, a strip of nails, a 6-cell ammo gauge on the side, a nozzle ring that flares on each shot.
 */

import * as THREE from 'three';
import { box, at, bevelBox, lathePart, makeGauge } from '../../core/client/combat/viewmodel-parts.js';
import { MAT, makeArm, glowRing, makeHeat } from './shared.js';
import { Firearm } from '../../core/client/combat/firearm.js';

/** The numbers: damage, speed, ammo, recoil, sights. */
export const config = {
  id: 'pistol', name: 'NAIL GUN', type: 'firearm', auto: false, damage: 24, interval: 0.2, mag: 12, reserve: 60, maxReserve: 96,
  reloadTime: 1.0, spread: 0.004, pellets: 1, range: 120, critMul: 2, knockback: 2.5, stun: 0.1,
  camKick: 0.018, camYaw: 0.004, climb: 0.002, kickZ: 0.022, kickRot: 0.07, flashSize: 0.3, worldLight: 25,
  heat: 5, tracerColor: 0xfff27a,
  ads: { x: 0, y: -0.093, z: -0.32, fovDrop: 12 }, // fovDrop = degrees of zoom
};

function buildPistol() {
  const root = new THREE.Group();
  const grip = at(bevelBox(0.055, 0.15, 0.07, MAT.rubber, 0.012), 0, -0.085, 0.045);
  grip.rotation.x = 0.2;
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.25, -0.5, 1]), 0.052, -0.09, 0.05);
  const leftArm = at(makeArm(-1, Math.PI / 2, [-0.25, -0.5, 1]), -0.052, -0.11, 0.04);
  const strip = at(bevelBox(0.03, 0.04, 0.2, MAT.brass, 0.006), 0, -0.04, -0.1); // strip of nails
  strip.rotation.x = -0.12;
  const piston = at(lathePart([[0.011, 0], [0.011, 0.05], [0.014, 0.05], [0.014, 0.065]], MAT.steel, 12), 0, 0.04, 0.115); // recoils on every shot
  const nose = at(lathePart([[0.016, 0], [0.016, 0.02], [0.023, 0.022], [0.023, 0.034], [0.015, 0.038], [0.015, 0.05]], MAT.steel), 0, 0.04, -0.245);
  const heat = glowRing(0.0245, 0xff7a1a, -0.272, 0.04, 0.008);
  const gauge = makeGauge(6, { pitch: 0.022 });
  gauge.group.position.set(-0.0335, 0.05, 0.03);
  root.add(
    at(bevelBox(0.062, 0.07, 0.3, MAT.hazard, 0.01), 0, 0.04, -0.1), // yellow housing
    at(bevelBox(0.064, 0.012, 0.12, MAT.orange, 0.004), 0, 0.072, -0.05), // orange cap, below the sight line
    at(bevelBox(0.058, 0.045, 0.26, MAT.metal, 0.008), 0, -0.002, -0.08), // frame
    grip,
    strip,
    at(box(0.01, 0.02, 0.01, MAT.steel), 0, 0.083, -0.24), // front sight
    at(box(0.032, 0.02, 0.012, MAT.steel), 0, 0.083, 0.05), // rear sight (tops of both sights line up for ADS)
    nose,
    heat.ring,
    piston,
    at(lathePart([[0.01, 0], [0.01, 0.07]], MAT.hose, 10), 0, -0.16, 0.115), // air hose stub under the grip
    gauge.group,
    ...[0, 1, 2].map((i) => at(bevelBox(0.003, 0.03, 0.007, MAT.rubber, 0.001), -0.0315, 0.035, -0.06 - i * 0.02)), // vents
    rightArm,
    leftArm,
  );
  const muzzle = at(new THREE.Object3D(), 0, 0.04, -0.3);
  root.add(muzzle);
  const cool = makeHeat();
  return {
    root, muzzle, home: { x: 0.2, y: -0.2, z: -0.42 },
    parts: { support: { object: leftArm, baseY: leftArm.position.y } },
    animate(dt, time, state) {
      gauge.update(state.ammo, time);
      const hot = cool(dt, state.pulse);
      heat.material.emissiveIntensity = 0.4 + hot * 7;
      piston.position.z = 0.115 + state.pulse * 0.025;
    },
  };
}

export const weapon = {
  config,
  holdable: { type: 'firearm', class: Firearm },
  model: { build: buildPistol },
};
