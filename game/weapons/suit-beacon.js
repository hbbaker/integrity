/*
 * SUIT BEACON: a squat black canister with a glowing cap, an aerial and a hazard band. Hidden: it is not in the
 * inventory and never in a loadout slot. The character screen puts it in your hand (to call the suit down, or to
 * send it back up); the fire button throws it, and the game puts your last item back in your hand.
 */

import * as THREE from 'three';
import { at, glowMaterial } from '../../core/client/combat/viewmodel-parts.js';
import { MAT, makeArm, rgbGlows } from './shared.js';
import { Tool } from '../../core/client/combat/tool.js';

/** The numbers. */
export const config = { id: 'beacon', name: 'SUIT BEACON', type: 'beacon', melee: true, hidden: true, damage: 0, interval: 0.6, range: 0, cone: 0, knockback: 0, stun: 0 };

const THROW_COOLDOWN = 0.6; // seconds before the beacon can be thrown again (a failed throw keeps it in hand)

/** The beacon is a tool whose trigger throws it: the game decides what the throw does (`holder.onBeaconThrow`). */
export class BeaconTool extends Tool {
  fixedUpdate(holder, dt, input) {
    if (!input.firePressed || holder.cooldown > 0) return;
    holder.cooldown = THROW_COOLDOWN;
    holder.swingTool(); // the throwing motion, shown to the other players too
    holder.onBeaconThrow?.();
  }
}

/** The canister, with its origin where the hand holds it. It stands upright. */
export function buildBeaconBody() {
  const group = new THREE.Group();
  const cap = glowMaterial(0xffffff, 1);
  group.add(
    at(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.046, 0.2, 10), MAT.gunmetal), 0, 0.1, 0),
    at(new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.03, 10), MAT.orange), 0, 0.06, 0), // hazard band
    at(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.04, 10), cap), 0, 0.22, 0), // lit cap
    at(new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 6), MAT.steel), 0.025, 0.3, 0), // aerial
    at(new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), cap), 0.025, 0.38, 0),
    at(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.015, 10), MAT.steel), 0, 0.005, 0), // base ring
  );
  return { group, cap };
}

function buildBeacon() {
  const root = new THREE.Group();
  const { group: body, cap } = buildBeaconBody();
  body.position.set(0, -0.1, 0);
  const arm = at(makeArm(1, -Math.PI / 2, [0.3, -0.45, 1]), 0.03, -0.06, 0.02); // the right hand round the canister
  root.add(body, arm);
  const glows = rgbGlows([[cap, 0]]);
  return {
    root, muzzle: null, home: { x: 0.2, y: -0.2, z: -0.4 },
    parts: {},
    animate(dt, time, state) {
      glows(time);
      cap.emissiveIntensity = state.swing ? 6 : 1.2 + Math.sin(time * 4) * 0.6;
    },
  };
}

export const weapon = {
  config,
  holdable: { type: 'beacon', class: BeaconTool },
  model: { build: buildBeacon },
};
