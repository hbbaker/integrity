/*
 * STOP SIGN: a road sign on a steel post, held upright by the post like a paddle and swung in a full overhead arc.
 * A red octagon with a white rim sits at the top; the post comes out of its bottom edge. The rim glows in the RGB
 * cycle and flares on a swing. The hit lands when the sign comes down, not when the button is pressed.
 */

import * as THREE from 'three';
import { at, lathePart, glowMaterial, box } from '../../core/client/combat/viewmodel-parts.js';
import { material } from '../../core/client/graphics/materials.js';
import { OVERHEAD_IMPACT_T } from '../../core/client/combat/swing-poses.js';
import { meleeStrike } from '../../core/client/combat/melee.js';
import { MAT, makeArm, rgbGlows } from './shared.js';
import { MeleeWeapon } from '../../core/client/combat/melee-weapon.js';

const SWING_TIME = 0.6; // seconds for the whole overhead swing

/** The numbers: damage, speed, ammo, recoil, sights. */
export const config = { id: 'stopsign', name: 'STOP SIGN', type: 'sign', melee: true, damage: 45, interval: 0.8, range: 3.2, cone: 1.0, knockback: 16, stun: 0.9, swingStyle: 'overhead', swingTime: SWING_TIME };

const SIGN_RADIUS = 0.17;
const SIGN_THICKNESS = 0.012;
const RIM_WIDTH = 0.018;
const OCTAGON_SIDES = 8;
const POST_BOTTOM = -0.1; // below the lower hand
const SIGN_CENTRE_Y = 0.6;
const POST_TOP = SIGN_CENTRE_Y - SIGN_RADIUS; // the post ends at the sign's bottom edge
const HOLD_TILT = -0.45; // radians: the sign leans forward from upright
const LOWER_HAND_Y = 0;
const UPPER_HAND_Y = 0.18;

/** A MeleeWeapon that swings the whole sign overhead; the strike lands when the sign comes down. */
export class StopSignWeapon extends MeleeWeapon {
  reset() {
    super.reset();
    this.strikeTimer = 0;
  }

  onDeselect(holder) {
    super.onDeselect(holder);
    this.strikeTimer = 0;
  }

  tryFire(holder) {
    holder.triggerBuffer = 0;
    holder.cooldown = this.cfg.interval;
    this.strikeTimer = SWING_TIME * OVERHEAD_IMPACT_T;
    holder.startMeleeAnim(false);
  }

  tick(holder, dt) {
    super.tick(holder, dt);
    if (this.strikeTimer <= 0) return;
    this.strikeTimer -= dt;
    if (this.strikeTimer <= 0) meleeStrike(holder, this.cfg);
  }
}

let signRed = null;
const getSignRed = () => (signRed ??= material(0xc8102e, { roughness: 0.45, metalness: 0.3 }));

/** A flat regular octagon (flat sides up and down) extruded to `depth`, centred, facing +Z. */
function octagonPlate(radius, depth, mat) {
  const shape = new THREE.Shape();
  for (let i = 0; i < OCTAGON_SIDES; i++) {
    const angle = ((i + 0.5) / OCTAGON_SIDES) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.translate(0, 0, -depth / 2);
  return new THREE.Mesh(geometry, mat);
}

function buildStopSign() {
  const root = new THREE.Group();
  const body = new THREE.Group(); // upright along +Y, leaned forward as a whole
  body.rotation.x = HOLD_TILT;
  const post = at(lathePart([[0.016, 0], [0.016, POST_TOP - POST_BOTTOM]], MAT.steel, 12), 0, POST_BOTTOM, 0);
  const foot = at(lathePart([[0.016, 0], [0.021, 0.012]], MAT.gunmetal, 12), 0, POST_BOTTOM, 0);
  post.rotation.x = Math.PI / 2; // lathePart runs along -Z: turn the post and foot to run up along +Y
  foot.rotation.x = Math.PI / 2;
  const signGroup = new THREE.Group();
  signGroup.position.set(0, SIGN_CENTRE_Y, 0);
  const rimMaterial = glowMaterial(0xffffff, 0.8);
  rimMaterial.name = 'stopsign-rim';
  const rim = octagonPlate(SIGN_RADIUS, SIGN_THICKNESS, rimMaterial);
  const face = octagonPlate(SIGN_RADIUS - RIM_WIDTH, SIGN_THICKNESS * 1.4, getSignRed());
  const word = box(0.17, 0.045, SIGN_THICKNESS * 1.6, rimMaterial); // the lit band across the middle
  const bolts = [[-0.03, -0.1], [0.03, -0.1]].map(([x, y]) => at(lathePart([[0.008, 0], [0.008, 0.01]], MAT.gunmetal, 8), x, y, 0.009));
  bolts.forEach((bolt) => { bolt.rotation.x = Math.PI / 2; });
  signGroup.add(rim, face, word, ...bolts);
  const glows = rgbGlows([[rimMaterial, 0.2]]);
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.3, -0.45, 1]), 0.02, LOWER_HAND_Y, 0.02);
  const leftArm = at(makeArm(-1, Math.PI / 2, [-0.3, -0.35, 1]), -0.02, UPPER_HAND_Y, 0.02);
  body.add(post, foot, signGroup, rightArm, leftArm);
  root.add(body);
  return {
    root, muzzle: null, home: { x: 0.22, y: -0.32, z: -0.45 },
    parts: { support: { object: leftArm, baseY: leftArm.position.y } },
    animate(dt, time, state) {
      glows(time);
      rimMaterial.emissiveIntensity = state.swing ? 5 : 0.7 + Math.sin(time * 3) * 0.3;
    },
  };
}

export const weapon = {
  config,
  holdable: { type: 'sign', class: StopSignWeapon },
  model: { build: buildStopSign },
};
