import * as THREE from 'three';
import { material, xboxMaterial } from '../../core/client/graphics/materials.js';
import { surfaceMaterial } from '../../core/client/graphics/surfaces.js';
import { MuzzleFlash } from '../../core/client/graphics/particles.js';
import { buildHeldModel } from '../weapons/index.js';
import { clamp, lerp, damp, easeInOut } from '../../core/client/engine/math.js';
import { swingPose } from '../../core/client/combat/swing-poses.js';
import { BodyRig } from './body-rig.js';
import { HUMANOID_KIT, HUMANOID_MATERIALS } from './humanoid.js';
import { clearSuitExtras, dressSuitBody, setSuitPart as fitSuitPart } from './mech-suit.js';
import { YBotSkin, loadYBot } from './y-bot.js';

/*
 * The third-person character: a green-and-black cybernetic robot (black plating,
 * green armour panels, glowing green visor, chest core, joints and cable runs).
 * Built from a handful of low-segment primitives and posed procedurally every
 * frame. It holds a copy of whichever gun is equipped.
 *
 * Model space: feet at y = 0, facing -Z (like the guns). Yaw uses the same convention
 * as the camera, so `root.rotation.y = yaw` turns it to face a camera yaw.
 */

const shortest = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const ARM_LEN = 0.62;
const SHOULDER_X = 0.37;
const SHOULDER_Y = 1.32;
const GUN_SCALE = 1.25;
const LEAN_BODY_ANGLE = 0.45; // radians the torso tips at a full lean
const SWING_TORSO_SHARE = 0.75; // how much of the item's swing rotation the rig takes (the jab used 0.35 / 0.7 of its own)
const SHOULDER_GUN = 'drill'; // the boring launcher rests on the shoulder; every other gun is carried in front of the body
const CARRY_OFFSET = new THREE.Vector3(-0.04, -0.3, -0.3); // a carried gun's right hand, from the right shoulder, in the body's frame: low, out in front
const RAISED_ARM = 0.75; // how much of the rig's arm the right hand uses when the gun is raised to aim (less than all bends the elbow)
const GRIP_REACH = 0.97; // how much of a straight arm the support hand is asked to use
const MAX_CARRY_PULL = 0.3; // metres a carried gun may be drawn back so the left hand can reach the front grip
const MAX_SHOULDER_PULL = 0.7; // ... and the launcher, which ends up on the shoulder
const Y_BOT_GUN_SCALE = 1; // third-person guns are drawn this size on the Y Bot (the cyborg's bigger hands take GUN_SCALE)
const GUN_GRIP = 0.55; // how far the fingers close round a gun (1 is a fist)
const FIST_GRIP = 1;
const GUN_PALM_IN = 1.1; // radians: both palms turn in toward the gun
const LEAN_BODY_SHIFT = 0.3; // metres the torso slides sideways at a full lean

// Where each hand grips a gun, in the gun model's own space (matches the first-person arms).
const GRIPS = {
  pistol: { right: [0.052, -0.09, 0.05], left: [-0.052, -0.11, 0.04] },
  revolver: { right: [0.05, -0.1, 0.14], left: [-0.05, -0.11, 0.13] },
  shotgun: { right: [0.05, -0.09, 0.22], left: [0, -0.1, -0.25] },
  smg: { right: [0.052, -0.1, 0.13], left: [0, -0.07, -0.19] },
  sniper: { right: [0.05, -0.09, 0.22], left: [0, -0.1, -0.25] },
  drill: { right: [0.045, -0.15, 0.1], left: [-0.04, -0.15, -0.18] },
  reel: { right: [0.052, -0.09, 0.05], left: [-0.052, -0.11, 0.04] },
  shovel: { right: [0.04, -0.03, 0.2], left: [0, -0.03, -0.18] },
  beacon: { right: [0, -0.04, 0], left: [-0.01, -0.06, -0.05] },
  stopsign: { right: [0, 0, 0], left: [0, 0.16, -0.08] },
  raygun: { right: [0.052, -0.11, 0.085], left: [0, -0.085, -0.1] },
};

const glow = (hex, intensity) => xboxMaterial({
  color: 0x04120a, emissive: hex, emissiveIntensity: intensity, roughness: 0.4, metalness: 0.2,
});

const MAT = {
  black: surfaceMaterial('brushed', { color: '#101214', metalness: 0.85, roughness: 0.34, bumpScale: 2 }),
  plate: surfaceMaterial('plate', { color: '#1d2421', glow: '#00f0ff', metalness: 0.8, roughness: 0.4, bumpScale: 2.6 }),
  green: surfaceMaterial('plate', { color: '#16a03c', glow: '#3dff9a', metalness: 0.55, roughness: 0.42, bumpScale: 2.6 }), // painted armour panels with seam lights
  joint: surfaceMaterial('brushed', { color: '#39403d', metalness: 0.9, roughness: 0.3, bumpScale: 1.8 }),
  glow: glow(0x2dff6a, 1.8), // visor, core, light strips
  hat: surfaceMaterial('plate', { color: '#f2c200', glow: '#3dff9a', roughness: 0.4, metalness: 0.2, bumpScale: 2.2 }), // hard hat
  vest: surfaceMaterial('weave', { color: '#ff6a00', roughness: 0.6, metalness: 0.1, bumpScale: 2.5 }), // hi-vis vest
  reflect: material(0xdfe3e6, { metalness: 0.6, roughness: 0.3 }), // reflective bands
  leather: surfaceMaterial('rubber', { color: '#4a3420', roughness: 0.8, metalness: 0, bumpScale: 3 }), // tool belt
  cable: surfaceMaterial('circuit', { color: '#3a1d8a', glow: ['#8a4dff', '#00f0ff', '#ff2bd6'], roughness: 0.5, metalness: 0.2, bumpScale: 3, emissiveIntensity: 2 }), // fibre wound on the reel: it glows
};

// Soft radial falloff so the blob shadow has no hard black edge.
function makeShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.45)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
const shadowMaterial = new THREE.MeshBasicMaterial({
  map: makeShadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
});
const shadowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

function mesh(geometry, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, mat);
  m.position.set(x, y, z);
  return m;
}

/** An arm hanging from a shoulder pivot: a stretchable armoured limb with a glowing band, and a hand at the end. */
function makeArm(side) {
  const pivot = new THREE.Group();
  pivot.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
  pivot.rotation.order = 'YXZ';
  const sleeve = new THREE.Group(); // scaled along Y to reach a target
  sleeve.add(
    mesh(new THREE.CylinderGeometry(0.055, 0.05, ARM_LEN * 0.8, 8), MAT.black, 0, -ARM_LEN * 0.4, 0),
    mesh(new THREE.BoxGeometry(0.11, ARM_LEN * 0.34, 0.12), MAT.green, 0, -ARM_LEN * 0.28, 0), // upper armour
    mesh(new THREE.SphereGeometry(0.06, 8, 6), MAT.joint, 0, -ARM_LEN * 0.5, 0), // elbow
    mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.025, 8), MAT.glow, 0, -ARM_LEN * 0.7, 0), // glowing band
    mesh(new THREE.CylinderGeometry(0.065, 0.06, 0.18, 8), MAT.plate, 0, -ARM_LEN * 0.78, 0), // forearm guard
  );
  const hand = new THREE.Group();
  hand.position.y = -ARM_LEN;
  hand.add(
    mesh(new THREE.BoxGeometry(0.1, 0.1, 0.12), MAT.black),
    mesh(new THREE.BoxGeometry(0.06, 0.012, 0.07), MAT.glow, 0, 0.055, 0), // knuckle light
  );
  pivot.add(sleeve, hand);
  return { pivot, sleeve, hand };
}

function makeLeg(side) {
  const pivot = new THREE.Group();
  pivot.position.set(side * 0.13, 0.56, 0);
  pivot.add(
    mesh(new THREE.BoxGeometry(0.15, 0.27, 0.16), MAT.black, 0, -0.13, 0), // thigh
    mesh(new THREE.SphereGeometry(0.08, 8, 6), MAT.joint, 0, -0.28, 0), // knee
    mesh(new THREE.BoxGeometry(0.13, 0.26, 0.15), MAT.green, 0, -0.41, 0), // shin armour
    mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), MAT.glow, side * 0.05, -0.29, -0.085), // piston light
    mesh(new THREE.BoxGeometry(0.16, 0.09, 0.28), MAT.black, 0, -0.51, -0.05), // foot
    mesh(new THREE.BoxGeometry(0.12, 0.012, 0.05), MAT.glow, 0, -0.47, -0.18), // toe light
  );
  return pivot;
}

/** The original cyborg look: black plating, green panels, hard hat and vest. Fills the pivots on `owner`. */
function buildCyborgBody(owner) {
  owner.root = new THREE.Group();
  owner.root.rotation.order = 'YXZ';

  owner.hips = new THREE.Group();
  owner.root.add(owner.hips);
  owner.legL = makeLeg(-1);
  owner.legR = makeLeg(1);
  owner.hips.add(
    owner.legL, owner.legR,
    mesh(new THREE.BoxGeometry(0.42, 0.2, 0.28), MAT.black, 0, 0.62, 0), // pelvis
    mesh(new THREE.BoxGeometry(0.44, 0.03, 0.3), MAT.glow, 0, 0.72, 0), // belt light
    mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.22, 8), MAT.joint, 0, 0.8, 0), // waist
  );

  owner.torso = new THREE.Group();
  owner.torso.position.y = 0.9;
  owner.hips.add(owner.torso);
  const core = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 8), MAT.glow, 0, 0.32, -0.19); // chest core
  core.rotation.x = Math.PI / 2; // the disc faces forward
  owner.torso.add(
    mesh(new THREE.BoxGeometry(0.54, 0.5, 0.3), MAT.black, 0, 0.27, 0), // chest
    mesh(new THREE.BoxGeometry(0.42, 0.32, 0.05), MAT.green, 0, 0.3, -0.16), // front armour plate
    core,
    mesh(new THREE.BoxGeometry(0.3, 0.08, 0.2), MAT.plate, 0, 0.55, 0), // collar
    // Hi-vis vest over the chest: front panel, back panel and two reflective bands round the body.
    mesh(new THREE.BoxGeometry(0.56, 0.3, 0.02), MAT.vest, 0, 0.2, -0.155),
    mesh(new THREE.BoxGeometry(0.56, 0.3, 0.02), MAT.vest, 0, 0.2, 0.155),
    mesh(new THREE.BoxGeometry(0.57, 0.04, 0.32), MAT.reflect, 0, 0.14, 0),
    mesh(new THREE.BoxGeometry(0.57, 0.04, 0.32), MAT.reflect, 0, 0.27, 0),
  );
  owner.hips.add(mesh(new THREE.BoxGeometry(0.46, 0.06, 0.3), MAT.leather, 0, 0.66, 0)); // tool belt
  for (const x of [-0.17, 0.12]) owner.hips.add(mesh(new THREE.BoxGeometry(0.08, 0.1, 0.06), MAT.leather, x, 0.61, -0.16));

  // Back pack with glowing vents; it tilts with movement.
  owner.pack = new THREE.Group();
  owner.pack.position.set(0, 0.35, 0.2);
  owner.pack.add(
    mesh(new THREE.BoxGeometry(0.34, 0.4, 0.12), MAT.plate, 0, 0, 0.04),
    mesh(new THREE.BoxGeometry(0.26, 0.03, 0.02), MAT.glow, 0, 0.1, 0.11),
    mesh(new THREE.BoxGeometry(0.26, 0.03, 0.02), MAT.glow, 0, 0.02, 0.11),
    mesh(new THREE.BoxGeometry(0.26, 0.03, 0.02), MAT.glow, 0, -0.06, 0.11),
  );
  // Cable reel strapped on top of the pack: two flanges and a wound fibre core.
  for (const x of [-0.08, 0.08]) {
    owner.pack.add(mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.02, 8), MAT.reflect, x, 0.28, 0.06).rotateZ(Math.PI / 2));
  }
  owner.pack.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 8), MAT.cable, 0, 0.28, 0.06).rotateZ(Math.PI / 2));
  owner.torso.add(owner.pack);

  // Head (pivot at the neck): boxy skull, glowing visor, side sensors and an antenna.
  owner.head = new THREE.Group();
  owner.head.position.y = 0.62;
  owner.torso.add(owner.head);
  owner.head.add(
    mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), MAT.joint, 0, -0.02, 0), // neck
    mesh(new THREE.BoxGeometry(0.3, 0.27, 0.3), MAT.black, 0, 0.14, 0), // skull
    mesh(new THREE.SphereGeometry(0.19, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), MAT.hat, 0, 0.27, 0), // hard hat dome
    mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 10), MAT.hat, 0, 0.27, -0.03), // brim, longer at the front
    mesh(new THREE.BoxGeometry(0.04, 0.03, 0.34), MAT.hat, 0, 0.455, 0), // ridge
    mesh(new THREE.BoxGeometry(0.24, 0.07, 0.02), MAT.glow, 0, 0.16, -0.155), // visor
    mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 8), MAT.joint, -0.17, 0.14, 0).rotateZ(Math.PI / 2), // ears
    mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 8), MAT.joint, 0.17, 0.14, 0).rotateZ(Math.PI / 2),
    mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6), MAT.joint, 0.1, 0.4, 0.06), // antenna
    mesh(new THREE.SphereGeometry(0.02, 8, 6), MAT.glow, 0.1, 0.52, 0.06),
  );

  // Aim rig: both arms (and the gun) pitch together around the shoulders.
  owner.rig = new THREE.Group();
  owner.rig.position.y = 0;
  owner.rig.rotation.order = 'YXZ';
  owner.torso.add(owner.rig);
  owner.rig.position.set(0, SHOULDER_Y - 0.9, 0);
  owner.armL = makeArm(-1);
  owner.armR = makeArm(1);
  for (const arm of [owner.armL, owner.armR]) {
    arm.pivot.position.y = 0;
    owner.rig.add(arm.pivot);
  }
  for (const side of [-1, 1]) { // shoulder joints with a glowing ring
    const pad = mesh(new THREE.SphereGeometry(0.11, 8, 6), MAT.joint, side * (SHOULDER_X + 0.02), SHOULDER_Y - 0.9 + 0.04, 0);
    pad.scale.set(1.15, 1, 1.1);
    const ring = mesh(new THREE.TorusGeometry(0.115, 0.012, 4, 10), MAT.glow, side * (SHOULDER_X + 0.02), SHOULDER_Y - 0.9 + 0.04, 0);
    ring.rotation.y = Math.PI / 2;
    owner.torso.add(pad, ring);
  }
}

/** The shared humanoid skeleton (grey human or mech suit). Fills the same pivots on `owner`. */
function buildRiggedBody(owner) {
  const body = new BodyRig(HUMANOID_MATERIALS);
  body.setKit(HUMANOID_KIT, HUMANOID_MATERIALS);
  owner.body = body;
  owner.root = body.root;
  owner.hips = body.hips;
  owner.torso = body.torso;
  owner.head = body.head;
  owner.pack = body.pack;
  owner.rig = body.rig;
  owner.legL = body.legL.pivot;
  owner.legR = body.legR.pivot;
  owner.armL = body.armL;
  owner.armR = body.armR;
}

export class Cyborg {
  /** `rigged` builds the human (the Y Bot, swappable to the suit) instead of the green cyborg. `skinLoader` replaces the model loader (tests). */
  constructor({ scene, player, weapons, flashLight = true, rigged = false, skinLoader = loadYBot }) {
    this.player = player;
    this.weapons = weapons;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    // Blob shadow: follows the feet only (the real shadow map is static).
    this.shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    this.shadow.scale.setScalar(1.3);
    this.shadow.position.y = 0.02;
    this.group.add(this.shadow);

    if (rigged) buildRiggedBody(this);
    else buildCyborgBody(this);
    this.skin = rigged ? new YBotSkin(this.body, { load: skinLoader }) : null; // draws the human once the model has loaded
    this.group.add(this.root);

    // Gun in the right hand: one copy per weapon, only the equipped one shown.
    this.socket = new THREE.Group();
    this.armR.hand.add(this.socket);
    this.guns = weapons.cfg.list.map((cfg) => {
      const model = buildHeldModel(cfg.id);
      if (!model) return null;
      const grip = GRIPS[cfg.id];
      const holder = new THREE.Group();
      holder.scale.setScalar(rigged ? Y_BOT_GUN_SCALE : GUN_SCALE);
      model.root.position.set(-grip.right[0], -grip.right[1], -grip.right[2]); // wrist at the socket
      model.root.visible = true;
      holder.add(model.root);
      holder.visible = false;
      const leftGrip = new THREE.Object3D(); // where the left hand should end up
      leftGrip.position.set(...grip.left).sub(new THREE.Vector3(...grip.right));
      holder.add(leftGrip);
      this.socket.add(holder);
      return { id: cfg.id, model, holder, leftGrip };
    });
    this.flash = new MuzzleFlash();
    if (!flashLight) this.flash.group.remove(this.flash.light); // many remote players: no extra scene lights
    this.flashHost = null;

    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this.reset();
  }

  reset() {
    this.suppressed = false; // true while something else (the suit's climb-in) draws the body
    this.bodyYaw = this.player.yaw;
    this.phase = 0;
    this.fireT = 0;
    this.reloadBlend = 0;
    this.fallT = 0;
    this.stride = 0;
    this.heldIndex = -2;
    this.aimW = 0;
  }

  /** Rigged bodies only: wear the suit parts in `selection` at `scale`, or pass null to go back to the grey human. */
  setSuit(selection, scale = 1) {
    if (selection) dressSuitBody(this.body, selection);
    else {
      clearSuitExtras(this.body);
      this.body.setKit(HUMANOID_KIT, HUMANOID_MATERIALS);
    }
    this.skin?.setActive(!selection);
    this.group.scale.setScalar(selection ? scale : 1);
  }

  /** Rigged bodies only: swap one suit slot while the suit is worn. */
  setSuitPart(slot, id) {
    fitSuitPart(this.body, slot, id);
  }

  /** World position of the current gun's muzzle (call after update() this frame). */
  muzzleWorld(out) {
    const gun = this.guns[this.weapons.index];
    if (gun && gun.model.muzzle) return gun.model.muzzle.getWorldPosition(out);
    return out.copy(this.player.pos).setY(this.player.pos.y + 1.3);
  }

  /** Raygun core animation etc., driven by the same state as the first-person model. */
  animateGun(index, dt, time, state) {
    const gun = this.guns[index];
    if (gun && gun.model.animate) gun.model.animate(dt, time, state);
  }

  _showGun(index) {
    this.heldIndex = index;
    this.guns.forEach((g, i) => { if (g) g.holder.visible = i === index; });
    const gun = this.guns[index];
    if (gun && gun.model.muzzle) {
      gun.model.muzzle.add(this.flash.group);
      const tint = this.weapons.slots[index].cfg.flashTint;
      this.flash.setColor(tint ?? 0xffffff, tint ?? 0xffb23d);
    } else {
      this.flash.group.removeFromParent();
    }
  }

  update(dt, alpha, time) {
    const player = this.player;
    const weapons = this.weapons;
    const show = player.thirdPersonVisible;
    this.group.visible = show && !this.suppressed;
    if (!show || this.suppressed) return;

    // --- Placement ---
    this.group.position.set(
      lerp(player.prevPos.x, player.pos.x, alpha), lerp(player.prevPos.y, player.pos.y, alpha), lerp(player.prevPos.z, player.pos.z, alpha),
    );
    const idx = weapons.index;
    if (idx !== this.heldIndex) this._showGun(idx);
    const gun = this.guns[idx];
    const armed = !!gun;

    // --- Intent: how raised is the gun, and which way are we facing? ---
    const firing = weapons.beamOn || weapons.cooldown > 0.06;
    this.fireT = firing ? 1.2 : Math.max(0, this.fireT - dt);
    const aimW = armed ? Math.max(weapons.adsBlend, Math.min(1, this.fireT), weapons.reloading ? 0.6 : 0) : 0;
    this.aimW = damp(this.aimW, aimW, 12, dt);

    const speed = player.speed;
    const moving = speed > 0.6;
    const facing = this.aimW > 0.15 || !armed && this.fireT > 0;
    let targetYaw = this.bodyYaw;
    if (facing) targetYaw = player.yaw;
    else if (moving) targetYaw = Math.atan2(-player.vel.x, -player.vel.z);
    this.bodyYaw += shortest(targetYaw - this.bodyYaw) * (1 - Math.exp(-(facing ? 14 : 9) * dt));

    // --- Locomotion ---
    const grounded = player.grounded;
    const run = clamp(speed / 6.5, 0, 1.6);
    if (grounded && !player.sliding) this.phase += speed * dt * 2.1;
    const swing = Math.sin(this.phase) * 0.75 * Math.min(1, run);
    this.stride = damp(this.stride, grounded && !player.sliding ? 1 : 0, 10, dt);
    let legL = swing * this.stride;
    let legR = -swing * this.stride;
    let hipY = Math.abs(Math.sin(this.phase)) * 0.035 * Math.min(1, run) * this.stride;
    let lean = player.sprinting ? -0.3 : -0.1 * Math.min(1, run);
    if (!grounded && !player.sliding) { // jump / fall: tuck
      legL = -0.7;
      legR = 0.25;
      lean = -0.1;
    }
    if (player.sliding) { // slide: low, legs out front, leaning back
      hipY = -0.34;
      legL = -1.25;
      legR = -0.95;
      lean = 0.5;
    } else if (player.crouching && grounded) { // crouch: hips down, knees forward, a touch of stride when moving
      hipY = -0.3;
      legL = -0.85 + swing * 0.3;
      legR = -0.65 - swing * 0.3;
      lean = -0.12;
    }
    this.hips.position.y = damp(this.hips.position.y, hipY, 16, dt);
    this.legL.rotation.x = legL;
    this.legR.rotation.x = legR;
    const sideLean = -(player.lean ?? 0) * LEAN_BODY_ANGLE; // Q / E: the upper body tips toward the lean
    this.torso.rotation.set(lean, Math.sin(this.phase) * 0.12 * Math.min(1, run) * (1 - this.aimW), sideLean);
    this.torso.position.x = (player.lean ?? 0) * LEAN_BODY_SHIFT;
    const breathe = Math.sin(time * 1.8) * 0.012;
    this.torso.position.y = 0.9 + breathe;
    this.head.rotation.x = -clamp(player.pitch, -0.8, 0.8) * 0.5 - lean * 0.6;
    this.head.rotation.y = clamp(shortest(player.yaw - this.bodyYaw), -0.7, 0.7) * 0.6 * (1 - this.aimW);
    this.pack.rotation.x = Math.min(1, run) * 0.08 + (player.sliding ? 0.1 : 0) + (grounded ? 0 : 0.1);

    // --- Arms ---
    const A = this.armL;
    const B = this.armR;
    this.reloadBlend = damp(this.reloadBlend, weapons.reloading ? 1 : 0, 10, dt);
    const forward = Math.PI / 2;

    if (armed) {
      // Gun up: both arms forward, pitched with the camera; lowered to a low-ready carry when idle.
      const kick = weapons.kick;
      const pitch = clamp(player.pitch + player.kickPitch, -1.2, 1.2);
      let rigX = pitch * this.aimW - 0.4 * (1 - this.aimW) + kick.r * 0.7 - 0.9 * weapons.switchAmount;
      let rigY = clamp(shortest(player.yaw - this.bodyYaw), -0.9, 0.9) * this.aimW;
      let rigZ = 0.3 * this.reloadBlend * (gun.id === 'shotgun' ? 1 : 0.4);
      if (weapons.swingT >= 0) { // a whole-item swing: the torso follows the item's rise and fall
        const swing = swingPose(weapons.swingStyle, weapons.swingT);
        rigX += swing.rx * SWING_TORSO_SHARE;
        rigY += swing.ry * SWING_TORSO_SHARE;
      }
      this.rig.rotation.set(rigX, rigY, rigZ);
      this.rig.position.z = kick.z * 1.2;
      B.pivot.rotation.set(forward, 0.4, 0);
      B.sleeve.scale.y = 1;
      B.hand.position.y = -ARM_LEN;
      // The gun keeps the rig's orientation regardless of how the arm is angled.
      this.socket.quaternion.copy(B.pivot.quaternion).invert();
      this.socket.position.set(0, 0, 0);
      // Show the gun's mag / pump motion from the first-person model.
      const fp = weapons.models[idx];
      if (gun.model.parts.mag && fp.parts.mag) gun.model.parts.mag.position.y = fp.parts.mag.position.y;
      if (gun.model.parts.pump && fp.parts.pump) gun.model.parts.pump.position.z = fp.parts.pump.position.z;
      if (this.reloadBlend > 0.01 && !weapons.current.cfg.perShell) { // dip the gun for a mag change
        this.rig.rotation.x += 0.35 * Math.sin(Math.PI * easeInOut(clamp(1 - weapons.reloadTimer / weapons.current.cfg.reloadTime, 0, 1)));
      }

      // Left hand reaches for the gun's support grip.
      this.group.updateMatrixWorld(true);
      gun.leftGrip.getWorldPosition(this._v);
      this.rig.worldToLocal(this._v).sub(A.pivot.position);
      const dist = this._v.length() || 1;
      A.pivot.quaternion.setFromUnitVectors(this._w.set(0, -1, 0), this._v.divideScalar(dist));
      const reach = clamp(dist / ARM_LEN, 0.6, 1.45);
      A.sleeve.scale.y = reach;
      A.hand.position.y = -ARM_LEN * reach;
    } else {
      // Fists: arms hang and swing opposite the legs; punches thrust forward.
      this.rig.rotation.set(0, 0, 0);
      this.rig.position.z = 0;
      this.socket.quaternion.identity();
      const armSwing = swing * 0.8 * this.stride;
      for (const [i, arm] of [A, B].entries()) {
        const side = i === 0 ? 1 : -1; // left arm swings with the right leg
        let rx = armSwing * side * -1;
        let rz = (i === 0 ? 1 : -1) * 0.12;
        let ry = 0;
        const t = weapons.punchT[i];
        if (t >= 0) {
          const f = t < 0.35 ? 1 - Math.pow(1 - t / 0.35, 3) : 1 - easeInOut((t - 0.35) / 0.65);
          rx = lerp(rx, forward - 0.15, f);
          rz *= 1 - f;
          ry = (i === 0 ? 1 : -1) * 0.2 * f;
        }
        arm.pivot.rotation.set(rx, ry, rz);
        arm.pivot.quaternion.setFromEuler(arm.pivot.rotation);
        arm.sleeve.scale.y = 1;
        arm.hand.position.y = -ARM_LEN;
      }
    }

    // --- Death: topple backwards ---
    this.fallT = player.alive ? Math.max(0, this.fallT - dt * 4) : Math.min(1, this.fallT + dt * 1.6);
    this.root.rotation.set(easeInOut(this.fallT) * 1.5, this.bodyYaw, 0);
    this.shadow.rotation.y = -this.bodyYaw; // keep the blob shadow's orientation irrelevant
    this.shadow.position.y = 0.02;

    this.flash.update(dt);
    this.group.updateMatrixWorld(true);
    if (this.skin) this._poseSkin({ phase: this.phase, run, stride: this.stride, grounded, sliding: player.sliding, crouching: player.crouching, sprinting: player.sprinting, falling: player.vel.y < 0 }, gun);
  }

  /**
   * Pose the human model: its own gait from the player's motion, then, with a gun up, both hands on the gun.
   * The gun is moved into the model's right hand and the left hand reaches the support grip with the elbow out,
   * so the arms never cross. Most guns are carried in front of the body with the right elbow bent; the launcher
   * rests on the shoulder (see `_rightHandTarget`). With nothing in hand the hands are fists.
   */
  _poseSkin(motion, gun) {
    const skin = this.skin;
    skin.sync(motion);
    skin.setGrip(gun ? GUN_GRIP : FIST_GRIP);
    if (!gun || !skin.ready || !skin.active) return;
    skin.reach('Right', this._rightHandTarget(gun), { roll: GUN_PALM_IN });
    skin.wristWorld('Right', this._w);
    this.socket.position.copy(this.armR.hand.worldToLocal(this._w)); // the gun's wrist on the model's wrist
    this.group.updateMatrixWorld(true);
    skin.reach('Left', gun.leftGrip.getWorldPosition(this._v), { roll: GUN_PALM_IN });
    this.group.updateMatrixWorld(true);
  }

  /**
   * Where the right hand goes. A gun carried in front rests low and out in front of the body (the right elbow bent) and
   * comes up to the rig's raised arm as you aim; the launcher takes the rig's hand as it is. Then the gun is drawn back
   * along its own barrel line just far enough for the left hand to reach the front grip (a little for a carried gun,
   * a lot for the shouldered launcher).
   */
  _rightHandTarget(gun) {
    const skin = this.skin;
    const shouldered = gun.id === SHOULDER_GUN;
    const rigHand = this.armR.hand.getWorldPosition(this._v);
    const grip = this._w.copy(gun.leftGrip.getWorldPosition(this._w));
    const axis = this._a.copy(grip).sub(rigHand);
    const span = axis.length();
    const target = this._d.copy(rigHand);
    if (!shouldered) {
      const shoulder = skin.shoulderWorld('Right', this._c);
      const raised = target.sub(this.armR.pivot.getWorldPosition(this._b)).multiplyScalar(RAISED_ARM); // as the rig aims, a little shorter
      const lowered = this._b.copy(CARRY_OFFSET).applyQuaternion(this.root.getWorldQuaternion(this._q)); // low and in front, in the body's frame
      target.lerpVectors(lowered, raised, this.aimW).add(shoulder);
    }
    if (span < 1e-4) return target;
    axis.divideScalar(span);
    const toGrip = this._c.copy(grip).add(target).sub(rigHand).sub(skin.shoulderWorld('Left', this._b)); // the grip moves with the hand
    const reach = skin.armReach('Left') * GRIP_REACH;
    if (toGrip.length() <= reach) return target;
    const along = toGrip.dot(axis);
    const slack = along * along - toGrip.lengthSq() + reach * reach;
    const pullBack = THREE.MathUtils.clamp(slack >= 0 ? along - Math.sqrt(slack) : along, 0, shouldered ? MAX_SHOULDER_PULL : MAX_CARRY_PULL);
    return target.addScaledVector(axis, -pullBack);
  }
}
