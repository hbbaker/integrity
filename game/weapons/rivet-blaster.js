/*
 * RIVET BLASTER: the shotgun: rivets (many pellets) or anchor bolts (one slug). TAB swaps them; a pump slides after each shot.
 * Shaped like a pump-action shotgun: a long barrel over a magazine tube, a ribbed pump forend, a receiver with an
 * ejection port, and a raked stock with a recoil pad. Neutral metal and graphite; the only colour is the RGB glow.
 */

import * as THREE from 'three';
import { box, at, bevelBox, lathePart, glowMaterial, makeGauge, sideProfile, tubePart } from '../../core/client/combat/viewmodel-parts.js';
import { MAT, makeArm, glowRing, makeHeat, rgbColor, rgbGlows } from './shared.js';
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

// Side outlines in [z, y] (forward is -z).
const RECEIVER = [[-0.06, 0.05], [0.2, 0.05], [0.235, 0.04], [0.242, -0.03], [0.2, -0.046], [0.0, -0.046], [-0.06, -0.04]];
const STOCK = [[0.235, 0.046], [0.4, 0.04], [0.57, 0.024], [0.6, 0.018], [0.612, -0.1], [0.585, -0.112], [0.45, -0.06], [0.34, -0.07], [0.29, -0.095], [0.24, -0.098], [0.215, -0.085], [0.215, 0.0]];
const RECOIL_PAD = [[0.6, 0.018], [0.618, 0.018], [0.63, -0.102], [0.613, -0.106]];
const PUMP = [[-0.1, 0.014], [0.1, 0.014], [0.106, -0.012], [0.09, -0.036], [-0.085, -0.041], [-0.106, -0.02]];

function buildShotgun() {
  const root = new THREE.Group();
  const pump = at(sideProfile(PUMP, 0.064, MAT.ribbed, 0.008), 0, -0.045, -0.25);
  const leftArm = at(makeArm(-1, Math.PI, [-0.3, -0.35, 1]), 0, -0.055, 0); // palm up, wrapped under the pump
  pump.add(leftArm);
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.3, -0.45, 1]), 0.05, -0.09, 0.25);
  const barrel = at(lathePart([[0.021, 0], [0.021, 0.72], [0.024, 0.72], [0.024, 0.745], [0.018, 0.745]], MAT.gunmetal), 0, 0.02, 0.07);
  const rib = at(box(0.007, 0.004, 0.62, MAT.steel), 0, 0.0445, -0.35); // ventilated rib: the sight plane, below the bead
  const tube = at(lathePart([[0.017, 0], [0.017, 0.5], [0.021, 0.5], [0.021, 0.515], [0.014, 0.515]], MAT.steel), 0, -0.025, 0.07);
  const shroud = at(lathePart([[0.025, 0], [0.025, 0.12], [0.029, 0.12], [0.029, 0.135]], MAT.alloy), 0, 0.02, -0.44);
  const heat = glowRing(0.0295, -0.575, 0.02, 0.008);
  const lamp = glowMaterial(0xffffff, 1.6);
  const stripe = glowMaterial(0xffffff, 1.4);
  const gauge = makeGauge(6, { pitch: 0.032, size: [0.004, 0.014, 0.022], color: (time) => rgbColor(0.5, time) });
  gauge.group.position.set(-0.0305, 0.0, 0.2);
  const glows = rgbGlows([[heat.material, 0], [lamp, 0.3], [stripe, 0.6]]);
  const guard = tubePart([[0, -0.046, 0.1], [0, -0.082, 0.11], [0, -0.09, 0.15], [0, -0.082, 0.19], [0, -0.046, 0.2]], 0.0045, MAT.gunmetal);
  root.add(
    barrel,
    rib,
    tube, // magazine tube
    at(sideProfile(RECEIVER, 0.056, MAT.gunmetal, 0.01), 0, 0, 0),
    at(box(0.0016, 0.026, 0.07, MAT.rubber), 0.0288, 0.02, 0.09), // ejection port
    at(box(0.0014, 0.004, 0.16, stripe), 0.0289, -0.012, 0.09), // glow inlay under the port
    pump,
    at(sideProfile(STOCK, 0.05, MAT.polymer, 0.01), 0, 0, 0),
    at(sideProfile(RECOIL_PAD, 0.052, MAT.rubber, 0.004), 0, 0, 0),
    guard,
    at(bevelBox(0.008, 0.026, 0.01, MAT.steel, 0.003), 0, -0.068, 0.15), // trigger
    shroud,
    heat.ring,
    at(new THREE.Mesh(new THREE.SphereGeometry(0.0065, 10, 8), lamp), 0, 0.0505, -0.66), // bead sight, a glowing bead
    at(new THREE.Mesh(new THREE.SphereGeometry(0.0065, 10, 8), MAT.steel), 0, 0.0465, -0.66),
    at(new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), lamp), 0.0295, -0.012, 0.24), // status lamp on the receiver
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
      glows(time);
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
