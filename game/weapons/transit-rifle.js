/*
 * TRANSIT RIFLE: The sniper: a surveyor's rifle with a scope that brightens as you aim, a 5-cell gauge and a lit forend.
 */

import * as THREE from 'three';
import { barrelPart, at, bevelBox, lathePart, glowMaterial, makeGauge } from '../../core/client/combat/viewmodel-parts.js';
import { MAT, makeArm, glowRing, makeHeat } from './shared.js';
import { Firearm } from '../../core/client/combat/firearm.js';

/** The numbers: damage, speed, ammo, recoil, sights. */
export const config = {
  // Bolt-action surveyor's transit rifle (the sniper). `scope` hides the gun and draws a scope overlay while aiming; fovDrop is the zoom.
  // It is very accurate when aimed, but the hip shot wanders (spread).
  id: 'sniper', name: 'TRANSIT RIFLE', type: 'firearm', auto: false, boltAction: true, scope: true, damage: 96, interval: 0.9,
  mag: 5, reserve: 20, maxReserve: 40, reloadTime: 2.4, spread: 0.05, adsSpreadCut: 0.99, adsAccurateAt: 0.55, adsSpeed: 24, pellets: 1, range: 250, critMul: 2.5,
  knockback: 16, stun: 0.5, camKick: 0.07, camYaw: 0.01, climb: 0.012, kickZ: 0.06, kickRot: 0.12,
  flashSize: 0.5, worldLight: 40, heat: 16, tracerColor: 0xbfe8ff,
  ads: { x: 0, y: -0.09, z: -0.25, fovDrop: 52 },
};

function buildSniper() {
  const root = new THREE.Group();
  const lens = new THREE.MeshStandardMaterial({ color: 0x2a6bff, metalness: 0.3, roughness: 0.05, emissive: 0x0a2a88, emissiveIntensity: 0.6 });
  const boltHandle = new THREE.Group(); // slides back and lifts when cycled
  boltHandle.add(
    at(lathePart([[0.008, 0], [0.008, 0.07]], MAT.steel, 10), 0.045, -0.02, 0),
    at(new THREE.Mesh(new THREE.SphereGeometry(0.016, 14, 10), MAT.steel), 0.08, -0.03, 0),
  );
  boltHandle.children[0].rotation.set(0, 0, Math.PI / 2); // lay the arm along X
  boltHandle.position.set(0, 0.02, 0.12);
  const leftArm = at(makeArm(-1, Math.PI, [-0.3, -0.35, 1]), 0, -0.1, -0.25); // palm up under the forend
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.3, -0.45, 1]), 0.05, -0.09, 0.22);
  const barrel = at(lathePart([[0.014, 0], [0.014, 0.75]], MAT.metal, 16), 0, 0.02, -0.145);
  const brake = at(lathePart([[0.021, 0], [0.021, 0.02], [0.016, 0.02], [0.016, 0.03], [0.021, 0.03], [0.021, 0.05], [0.016, 0.05], [0.016, 0.06], [0.021, 0.06], [0.021, 0.09]], MAT.steel, 16), 0, 0.02, -0.855);
  const heat = glowRing(0.0215, 0xff7a1a, -0.8, 0.02, 0.012);
  const tube = at(lathePart([[0.026, 0], [0.026, 0.3]], MAT.metal), 0, 0.09, 0.15);
  const bell = at(lathePart([[0.026, 0], [0.036, 0.015], [0.036, 0.09], [0.03, 0.09]], MAT.metal), 0, 0.09, -0.145);
  const rail = glowMaterial(0x00f0ff, 1.2);
  const gauge = makeGauge(5, { pitch: 0.036, size: [0.004, 0.014, 0.024] });
  gauge.group.position.set(-0.031, 0.01, 0.2);
  root.add(
    barrel, // long barrel
    brake, // muzzle brake
    heat.ring,
    at(bevelBox(0.06, 0.09, 0.36, MAT.hazard, 0.012), 0, 0, 0.08), // receiver
    at(bevelBox(0.056, 0.07, 0.34, MAT.hazard, 0.012), 0, -0.02, -0.3), // forend
    at(bevelBox(0.05, 0.1, 0.07, MAT.metal, 0.008), 0, -0.085, 0.0), // magazine
    at(bevelBox(0.05, 0.12, 0.055, MAT.rubber, 0.012), 0, -0.085, 0.21), // grip
    at(bevelBox(0.055, 0.12, 0.34, MAT.hazard, 0.014), 0, -0.02, 0.45), // stock
    at(bevelBox(0.058, 0.03, 0.12, MAT.orange, 0.008), 0, 0.075, 0.5), // cheek rest
    // Scope: a tube on two mounts with a bigger objective bell at the front.
    tube,
    bell,
    at(barrelPart(0.03, 0.02, lens), 0, 0.09, -0.24),
    at(barrelPart(0.022, 0.02, lens), 0, 0.09, 0.15),
    at(bevelBox(0.02, 0.04, 0.04, MAT.steel, 0.005), 0, 0.057, -0.08),
    at(bevelBox(0.02, 0.04, 0.04, MAT.steel, 0.005), 0, 0.057, 0.08),
    at(new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.004, 0.26), rail), 0, 0.118, 0.02), // laser-level strip on the scope
    at(new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.012, 0.3), rail), -0.0285, -0.02, -0.3), // light strip along the forend
    gauge.group,
    boltHandle,
    rightArm,
    leftArm,
  );
  const muzzle = at(new THREE.Object3D(), 0, 0.02, -0.96);
  root.add(muzzle);
  const cool = makeHeat();
  return {
    root, muzzle, home: { x: 0.2, y: -0.2, z: -0.4 },
    parts: { bolt: boltHandle, boltBaseZ: boltHandle.position.z, support: { object: leftArm, baseY: leftArm.position.y } },
    animate(dt, time, state) {
      gauge.update(state.ammo, time);
      const hot = cool(dt, state.pulse);
      heat.material.emissiveIntensity = 0.4 + hot * 8;
      lens.emissiveIntensity = 0.6 + state.aiming * 1.8 + Math.sin(time * 2) * 0.1;
      rail.emissiveIntensity = 0.8 + state.aiming * 2 + Math.sin(time * 4) * 0.3;
    },
  };
}

export const weapon = {
  config,
  holdable: { type: 'firearm', class: Firearm },
  model: { build: buildSniper },
};
