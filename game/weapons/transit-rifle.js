/*
 * TRANSIT RIFLE: the sniper, shaped like a precision bolt-action rifle: a cylindrical action with a bolt handle, a long
 * tapered barrel with a muzzle brake, a stock with a cheek rise and a recoil pad, a detachable magazine and a
 * scope with turrets. The scope lens brightens as you aim. Neutral metal and graphite; the only colour is the RGB glow.
 */

import * as THREE from 'three';
import { barrelPart, at, bevelBox, lathePart, glowMaterial, makeGauge, sideProfile, tubePart } from '../../core/client/combat/viewmodel-parts.js';
import { MAT, makeArm, glowRing, makeHeat, rgbColor, rgbGlows } from './shared.js';
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

// Side outlines in [z, y] (forward is -z).
const STOCK = [[0.18, 0.0], [0.28, 0.012], [0.36, 0.052], [0.5, 0.06], [0.6, 0.052], [0.625, 0.045], [0.63, -0.095], [0.6, -0.125], [0.5, -0.085], [0.38, -0.072], [0.3, -0.085], [0.2, -0.05]];
const PISTOL_GRIP = [[0.17, -0.04], [0.255, -0.04], [0.27, -0.15], [0.205, -0.155]];
const FOREND = [[-0.43, 0.0], [-0.43, -0.045], [-0.3, -0.058], [-0.1, -0.066], [0.12, -0.07], [0.19, -0.05], [0.19, 0.0]];
const MAGAZINE = [[-0.03, -0.03], [0.07, -0.03], [0.075, -0.14], [-0.025, -0.145]];
const RECOIL_PAD = [[0.628, 0.045], [0.645, 0.04], [0.65, -0.098], [0.62, -0.128], [0.6, -0.125]];

function buildScope(lens, rail) {
  const scope = new THREE.Group();
  scope.add(
    at(lathePart([[0.026, 0], [0.026, 0.3]], MAT.gunmetal), 0, 0.09, 0.15), // main tube
    at(lathePart([[0.026, 0], [0.036, 0.015], [0.036, 0.09], [0.03, 0.09]], MAT.gunmetal), 0, 0.09, -0.145), // objective bell
    at(lathePart([[0.03, 0], [0.026, 0.03]], MAT.gunmetal), 0, 0.09, 0.15), // eyepiece flare
    at(barrelPart(0.03, 0.02, lens), 0, 0.09, -0.24),
    at(barrelPart(0.022, 0.02, lens), 0, 0.09, 0.15),
    at(lathePart([[0.011, 0], [0.011, 0.02], [0.013, 0.02], [0.013, 0.026]], MAT.steel, 14), 0, 0.116, 0.0), // elevation turret
    at(lathePart([[0.011, 0], [0.011, 0.02], [0.013, 0.02], [0.013, 0.026]], MAT.steel, 14), 0.026, 0.09, 0.0), // windage turret
    at(bevelBox(0.02, 0.04, 0.04, MAT.steel, 0.005), 0, 0.057, -0.08), // rings
    at(bevelBox(0.02, 0.04, 0.04, MAT.steel, 0.005), 0, 0.057, 0.08),
    at(new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.004, 0.26), rail), 0, 0.118, 0.02), // laser-level strip on the scope
  );
  scope.children[5].rotation.x = Math.PI / 2; // the elevation turret points up
  scope.children[6].rotation.y = -Math.PI / 2; // the windage turret sticks out sideways
  return scope;
}

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
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.3, -0.45, 1]), 0.05, -0.09, 0.225);
  const barrel = at(lathePart([[0.019, 0], [0.019, 0.12], [0.014, 0.4], [0.014, 0.75]], MAT.gunmetal, 16), 0, 0.02, -0.145);
  const brake = at(lathePart([[0.021, 0], [0.021, 0.02], [0.016, 0.02], [0.016, 0.03], [0.021, 0.03], [0.021, 0.05], [0.016, 0.05], [0.016, 0.06], [0.021, 0.06], [0.021, 0.09]], MAT.steel, 16), 0, 0.02, -0.855);
  const heat = glowRing(0.0215, -0.8, 0.02, 0.012);
  const rail = glowMaterial(0xffffff, 1.2);
  const forendLight = glowMaterial(0xffffff, 1.2);
  const gauge = makeGauge(5, { pitch: 0.036, size: [0.004, 0.014, 0.024], color: (time) => rgbColor(0.5, time) });
  gauge.group.position.set(-0.0275, -0.005, 0.4);
  const glows = rgbGlows([[heat.material, 0], [rail, 0.3], [forendLight, 0.6]]);
  const guard = tubePart([[0, -0.07, 0.1], [0, -0.108, 0.12], [0, -0.118, 0.155], [0, -0.108, 0.19], [0, -0.07, 0.205]], 0.0045, MAT.gunmetal);
  root.add(
    barrel, // long barrel
    brake, // muzzle brake
    heat.ring,
    at(lathePart([[0.026, 0], [0.026, 0.3]], MAT.gunmetal), 0, 0.012, -0.06), // the cylindrical action
    at(bevelBox(0.03, 0.012, 0.26, MAT.alloy, 0.003), 0, 0.044, 0.0), // scope base rail
    at(sideProfile(FOREND, 0.056, MAT.polymer, 0.012), 0, 0, 0),
    at(sideProfile(STOCK, 0.05, MAT.polymer, 0.012), 0, 0, 0),
    at(sideProfile(PISTOL_GRIP, 0.05, MAT.grip, 0.01), 0, 0, 0),
    at(sideProfile(RECOIL_PAD, 0.052, MAT.rubber, 0.004), 0, 0, 0),
    at(sideProfile(MAGAZINE, 0.04, MAT.gunmetal, 0.006), 0, 0, 0),
    guard,
    at(bevelBox(0.008, 0.028, 0.01, MAT.steel, 0.003), 0, -0.07, 0.15), // trigger
    buildScope(lens, rail),
    at(new THREE.Mesh(new THREE.BoxGeometry(0.0014, 0.012, 0.3), forendLight), -0.0285, -0.02, -0.14), // light strip along the forend
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
      glows(time);
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
