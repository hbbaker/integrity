/*
 * NAIL GUN: the sidearm, shaped like a modern pistol: a slide with a sloped nose and rear serrations, a frame with a
 * trigger guard and a raked knurled grip, three-dot sights, an ammo gauge on the frame and a muzzle ring that flares
 * on each shot. Neutral gunmetal; the only colour is the RGB glow.
 */

import * as THREE from 'three';
import { box, at, bevelBox, lathePart, makeGauge, sideProfile, tubePart } from '../../core/client/combat/viewmodel-parts.js';
import { MAT, makeArm, glowRing, makeHeat, rgbColor, rgbGlows } from './shared.js';
import { Firearm } from '../../core/client/combat/firearm.js';

/** The numbers: damage, speed, ammo, recoil, sights. */
export const config = {
  id: 'pistol', name: 'NAIL GUN', type: 'firearm', auto: false, damage: 24, interval: 0.2, mag: 12, reserve: 60, maxReserve: 96,
  reloadTime: 1.0, spread: 0.004, pellets: 1, range: 120, critMul: 2, knockback: 2.5, stun: 0.1,
  camKick: 0.018, camYaw: 0.004, climb: 0.002, kickZ: 0.022, kickRot: 0.07, flashSize: 0.3, worldLight: 25,
  heat: 5, tracerColor: 0xfff27a,
  ads: { x: 0, y: -0.093, z: -0.32, fovDrop: 12 }, // fovDrop = degrees of zoom
};

// Side outlines in [z, y] (forward is -z). The sight tops are at y = 0.083 so ADS lines up.
const SLIDE = [[0.078, 0.012], [0.082, 0.064], [0.072, 0.07], [-0.232, 0.07], [-0.254, 0.058], [-0.258, 0.012]];
const FRAME = [[-0.2, 0.012], [-0.2, -0.016], [-0.12, -0.019], [0.0, -0.02], [0.052, -0.165], [0.115, -0.165], [0.088, 0.0], [0.08, 0.012]];
const GRIP_PANEL = [[0.022, -0.032], [0.054, -0.152], [0.108, -0.152], [0.092, -0.032]];

function buildPistol() {
  const root = new THREE.Group();
  const grip = at(sideProfile(GRIP_PANEL, 0.056, MAT.grip, 0.008), 0, 0, 0);
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.25, -0.5, 1]), 0.052, -0.09, 0.07);
  const leftArm = at(makeArm(-1, Math.PI / 2, [-0.25, -0.5, 1]), -0.052, -0.11, 0.06);
  const piston = at(lathePart([[0.009, 0], [0.009, 0.05], [0.012, 0.05], [0.012, 0.065]], MAT.steel, 12), 0, 0.04, 0.115); // recoils on every shot
  const nozzle = at(lathePart([[0.014, 0], [0.014, 0.02], [0.019, 0.022], [0.019, 0.03], [0.013, 0.034], [0.013, 0.046]], MAT.steel), 0, 0.04, -0.254);
  const heat = glowRing(0.0198, -0.272, 0.04, 0.008);
  const stripe = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xffffff, emissiveIntensity: 1.6 });
  const sightDot = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xffffff, emissiveIntensity: 2.4 });
  const gauge = makeGauge(6, { pitch: 0.022, color: (time) => rgbColor(0.5, time) });
  gauge.group.position.set(-0.0268, -0.002, -0.04);
  const glows = rgbGlows([[heat.material, 0], [stripe, 0.2], [sightDot, 0.6]]);
  const guard = tubePart([[0, -0.019, -0.04], [0, -0.058, -0.045], [0, -0.066, -0.08], [0, -0.058, -0.115], [0, -0.019, -0.125]], 0.0042, MAT.gunmetal);
  const slideSide = (side) => [
    at(box(0.0014, 0.004, 0.17, stripe), side * 0.0258, 0.032, -0.07), // glow inlay along the slide
    ...[0, 1, 2, 3, 4].map((i) => at(box(0.0016, 0.05, 0.003, MAT.rubber), side * 0.0258, 0.04, 0.03 + i * 0.009)), // rear serrations
  ];
  root.add(
    at(sideProfile(SLIDE, 0.05, MAT.gunmetal, 0.007), 0, 0, 0),
    at(sideProfile(FRAME, 0.046, MAT.alloy, 0.006), 0, 0, 0),
    grip,
    at(bevelBox(0.05, 0.012, 0.072, MAT.gunmetal, 0.004), 0, -0.17, 0.0865), // magazine baseplate
    guard,
    at(bevelBox(0.008, 0.026, 0.01, MAT.steel, 0.003), 0, -0.035, -0.092), // trigger
    nozzle,
    heat.ring,
    piston,
    at(bevelBox(0.008, 0.016, 0.01, MAT.gunmetal, 0.002), 0, 0.078, -0.24), // front sight post
    at(new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 6), sightDot), 0, 0.08, -0.2455),
    at(bevelBox(0.008, 0.013, 0.012, MAT.gunmetal, 0.002), -0.0125, 0.0765, 0.05), // rear sight, left blade
    at(bevelBox(0.008, 0.013, 0.012, MAT.gunmetal, 0.002), 0.0125, 0.0765, 0.05), // rear sight, right blade
    at(new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 6), sightDot), -0.0125, 0.079, 0.0435),
    at(new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 6), sightDot), 0.0125, 0.079, 0.0435),
    at(lathePart([[0.008, 0], [0.008, 0.06]], MAT.rubber, 10), 0, -0.172, 0.1), // air hose stub under the grip
    ...slideSide(-1),
    ...slideSide(1),
    gauge.group,
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
      glows(time);
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
