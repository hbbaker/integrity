/*
 * RIVET BLASTER: The shotgun: rivets (many pellets) or anchor bolts (one slug). TAB swaps them; a pump slides after each shot.
 */

import * as THREE from 'three';
import { box, at, bevelBox, lathePart, glowMaterial, makeGauge } from '../../core/client/combat/viewmodel-parts.js';
import { MAT, makeArm, glowRing, makeHeat } from './shared.js';
import { Firearm } from '../../core/client/combat/firearm.js';

/** The numbers: damage, speed, ammo, recoil, sights. */
export const config = {
  // TAB swaps shell type. The shells in the tube go back to reserve, and you must reload
  // (shell by shell) with the new type. Fields in ammoTypes override the shared ones.
  id: 'shotgun', name: 'RIVET BLASTER', type: 'firearm', pump: true, auto: false, interval: 0.8, mag: 6, critMul: 2,
  perShell: true, startTime: 0.3, shellTime: 0.42, endTime: 0.25,
  camYaw: 0.008, kickRot: 0.12, worldLight: 40, heat: 14,
  ads: { x: 0, y: -0.057, z: -0.28, fovDrop: 8 },
  defaultAmmo: 'buckshot',
  ammoTypes: {
    buckshot: {
      // 8 fat pellets (pelletRadius = how forgiving each pellet is), each with its own damage
      // number. Damage tapers from falloffStart to falloffEnd down to falloffMin.
      label: 'RIVETS', pickupKey: 'shotgun', reserve: 24, maxReserve: 36,
      damage: 11, pellets: 8, spread: 0.055, pelletRadius: 0.1, range: 60,
      falloffStart: 5, falloffEnd: 25, falloffMin: 0.15, pelletNumbers: true,
      knockback: 8, stun: 0.25, camKick: 0.05, climb: 0.004, kickZ: 0.045, flashSize: 0.5, tracerColor: 0xffb347,
    },
    slug: {
      // One heavy, accurate, long-range projectile.
      label: 'ANCHOR BOLT', pickupKey: 'slug', reserve: 8, maxReserve: 20,
      interval: 0.95, damage: 62, pellets: 1, spread: 0.007, pelletRadius: 0.04, range: 140,
      falloffStart: 30, falloffEnd: 90, falloffMin: 0.6, pelletNumbers: false,
      knockback: 14, stun: 0.35, camKick: 0.075, climb: 0.008, kickZ: 0.06, flashSize: 0.55, tracerColor: 0xffe9b0,
    },
  },
};

function buildShotgun() {
  const root = new THREE.Group();
  const pump = at(bevelBox(0.075, 0.06, 0.2, MAT.orange, 0.01), 0, -0.045, -0.25);
  const leftArm = at(makeArm(-1, Math.PI, [-0.3, -0.35, 1]), 0, -0.055, 0); // palm up, wrapped under the pump
  pump.add(leftArm);
  for (let i = 0; i < 4; i++) pump.add(at(bevelBox(0.079, 0.064, 0.009, MAT.rubber, 0.002), 0, 0, -0.07 + i * 0.047)); // grip bands
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.3, -0.45, 1]), 0.05, -0.09, 0.22);
  const barrel = at(lathePart([[0.022, 0], [0.022, 0.72], [0.026, 0.72], [0.026, 0.745], [0.019, 0.745]], MAT.metal), 0, 0.02, 0.07);
  const tube = at(lathePart([[0.018, 0], [0.018, 0.5], [0.022, 0.5], [0.022, 0.515], [0.014, 0.515]], MAT.steel), 0, -0.025, 0.07);
  const shroud = at(lathePart([[0.026, 0], [0.026, 0.12], [0.03, 0.12], [0.03, 0.135]], MAT.steel), 0, 0.02, -0.44);
  const heat = glowRing(0.0305, 0xff7a1a, -0.575, 0.02, 0.008);
  const lamp = glowMaterial(0x2a8bff, 1.6);
  const gauge = makeGauge(6, { pitch: 0.032, size: [0.004, 0.014, 0.022] });
  gauge.group.position.set(-0.0385, 0.012, 0.22);
  root.add(
    barrel,
    tube, // magazine tube
    at(bevelBox(0.075, 0.095, 0.3, MAT.hazard, 0.012), 0, 0, 0.1), // yellow housing
    pump,
    at(bevelBox(0.055, 0.12, 0.06, MAT.rubber, 0.012), 0, -0.085, 0.21), // pistol grip
    at(bevelBox(0.06, 0.11, 0.3, MAT.hazard, 0.014), 0, -0.03, 0.4), // stock
    at(bevelBox(0.062, 0.01, 0.1, MAT.rubber, 0.003), 0, 0.054, 0.1), // hazard stripe
    shroud,
    heat.ring,
    at(box(0.01, 0.015, 0.01, MAT.brass), 0, 0.045, -0.66), // bead sight
    at(bevelBox(0.03, 0.05, 0.05, MAT.hose, 0.008), 0.055, 0.0, 0.2), // air fitting on the side
    at(new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), lamp), 0.0795, 0.0, 0.2), // its status lamp
    gauge.group,
    rightArm,
  );
  const muzzle = at(new THREE.Object3D(), 0, 0.02, -0.68);
  root.add(muzzle);
  const cool = makeHeat();
  return {
    root, muzzle, home: { x: 0.2, y: -0.2, z: -0.4 },
    parts: { pump, pumpBaseZ: pump.position.z, support: { object: leftArm, baseY: leftArm.position.y } },
    animate(dt, time, state) {
      gauge.update(state.ammo, time);
      const hot = cool(dt, state.pulse);
      heat.material.emissiveIntensity = 0.4 + hot * 7;
      lamp.emissiveIntensity = state.reloading ? 2.5 + Math.sin(time * 20) : 1.2 + Math.sin(time * 3) * 0.5;
    },
  };
}

export const weapon = {
  config,
  holdable: { type: 'firearm', class: Firearm },
  model: { build: buildShotgun },
};
