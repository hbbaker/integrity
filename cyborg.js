import * as THREE from 'three';
import { material, MuzzleFlash } from './effects.js';
import { buildHeldModel } from './weapons.js';

/*
 * The third-person character: a green-and-black cybernetic robot (black plating,
 * green armour panels, glowing green visor, chest core, joints and cable runs).
 * Built from a handful of low-segment primitives and posed procedurally every
 * frame. It holds a copy of whichever gun is equipped.
 *
 * Model space: feet at y = 0, facing -Z (like the guns). Yaw uses the same convention
 * as the camera, so `root.rotation.y = yaw` turns it to face a camera yaw.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
const easeInOut = (t) => t * t * (3 - 2 * t);
const shortest = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const ARM_LEN = 0.62;
const SHOULDER_X = 0.37;
const SHOULDER_Y = 1.32;
const GUN_SCALE = 1.25;
const LEAN_BODY_ANGLE = 0.45; // radians the torso tips at a full lean
const LEAN_BODY_SHIFT = 0.3; // metres the torso slides sideways at a full lean

// Where each hand grips a gun, in the gun model's own space (matches the first-person arms).
const GRIPS = {
  pistol: { right: [0.052, -0.09, 0.05], left: [-0.052, -0.11, 0.04] },
  shotgun: { right: [0.05, -0.09, 0.22], left: [0, -0.1, -0.25] },
  smg: { right: [0.052, -0.1, 0.13], left: [0, -0.07, -0.19] },
  sniper: { right: [0.05, -0.09, 0.22], left: [0, -0.1, -0.25] },
  shovel: { right: [0.04, -0.03, 0.2], left: [0, -0.03, -0.18] },
  raygun: { right: [0.052, -0.11, 0.085], left: [0, -0.085, -0.1] },
};

const glow = (hex, intensity) => new THREE.MeshStandardMaterial({
  color: 0x04120a, emissive: hex, emissiveIntensity: intensity, roughness: 0.4, metalness: 0.2,
});

const MAT = {
  black: material(0x0b0d0c, { metalness: 0.85, roughness: 0.34 }),
  plate: material(0x1d2421, { metalness: 0.8, roughness: 0.4 }),
  green: material(0x16a03c, { metalness: 0.55, roughness: 0.42 }), // painted armour panels
  joint: material(0x39403d, { metalness: 0.9, roughness: 0.3 }),
  glow: glow(0x2dff6a, 1.8), // visor, core, light strips
  hat: material(0xf2c200, { roughness: 0.4 }), // hard hat
  vest: material(0xff6a00, { roughness: 0.6 }), // hi-vis vest
  reflect: material(0xdfe3e6, { metalness: 0.6, roughness: 0.3 }), // reflective bands
  leather: material(0x4a3420, { roughness: 0.8 }), // tool belt
  cable: material(0x7a3cff, { roughness: 0.5 }), // fibre cable wound on the reel
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

export class Cyborg {
  constructor({ scene, player, weapons, flashLight = true }) {
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

    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.group.add(this.root);

    this.hips = new THREE.Group();
    this.root.add(this.hips);
    this.legL = makeLeg(-1);
    this.legR = makeLeg(1);
    this.hips.add(
      this.legL, this.legR,
      mesh(new THREE.BoxGeometry(0.42, 0.2, 0.28), MAT.black, 0, 0.62, 0), // pelvis
      mesh(new THREE.BoxGeometry(0.44, 0.03, 0.3), MAT.glow, 0, 0.72, 0), // belt light
      mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.22, 8), MAT.joint, 0, 0.8, 0), // waist
    );

    this.torso = new THREE.Group();
    this.torso.position.y = 0.9;
    this.hips.add(this.torso);
    const core = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 12), MAT.glow, 0, 0.32, -0.19); // chest core
    core.rotation.x = Math.PI / 2; // the disc faces forward
    this.torso.add(
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
    this.hips.add(mesh(new THREE.BoxGeometry(0.46, 0.06, 0.3), MAT.leather, 0, 0.66, 0)); // tool belt
    for (const x of [-0.17, 0.12]) this.hips.add(mesh(new THREE.BoxGeometry(0.08, 0.1, 0.06), MAT.leather, x, 0.61, -0.16));

    // Back pack with glowing vents; it tilts with movement.
    this.pack = new THREE.Group();
    this.pack.position.set(0, 0.35, 0.2);
    this.pack.add(
      mesh(new THREE.BoxGeometry(0.34, 0.4, 0.12), MAT.plate, 0, 0, 0.04),
      mesh(new THREE.BoxGeometry(0.26, 0.03, 0.02), MAT.glow, 0, 0.1, 0.11),
      mesh(new THREE.BoxGeometry(0.26, 0.03, 0.02), MAT.glow, 0, 0.02, 0.11),
      mesh(new THREE.BoxGeometry(0.26, 0.03, 0.02), MAT.glow, 0, -0.06, 0.11),
    );
    // Cable reel strapped on top of the pack: two flanges and a wound fibre core.
    for (const x of [-0.08, 0.08]) {
      this.pack.add(mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.02, 12), MAT.reflect, x, 0.28, 0.06).rotateZ(Math.PI / 2));
    }
    this.pack.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 12), MAT.cable, 0, 0.28, 0.06).rotateZ(Math.PI / 2));
    this.torso.add(this.pack);

    // Head (pivot at the neck): boxy skull, glowing visor, side sensors and an antenna.
    this.head = new THREE.Group();
    this.head.position.y = 0.62;
    this.torso.add(this.head);
    this.head.add(
      mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), MAT.joint, 0, -0.02, 0), // neck
      mesh(new THREE.BoxGeometry(0.3, 0.27, 0.3), MAT.black, 0, 0.14, 0), // skull
      mesh(new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.hat, 0, 0.27, 0), // hard hat dome
      mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 14), MAT.hat, 0, 0.27, -0.03), // brim, longer at the front
      mesh(new THREE.BoxGeometry(0.04, 0.03, 0.34), MAT.hat, 0, 0.455, 0), // ridge
      mesh(new THREE.BoxGeometry(0.24, 0.07, 0.02), MAT.glow, 0, 0.16, -0.155), // visor
      mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 8), MAT.joint, -0.17, 0.14, 0).rotateZ(Math.PI / 2), // ears
      mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 8), MAT.joint, 0.17, 0.14, 0).rotateZ(Math.PI / 2),
      mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6), MAT.joint, 0.1, 0.4, 0.06), // antenna
      mesh(new THREE.SphereGeometry(0.02, 8, 6), MAT.glow, 0.1, 0.52, 0.06),
    );

    // Aim rig: both arms (and the gun) pitch together around the shoulders.
    this.rig = new THREE.Group();
    this.rig.position.y = 0;
    this.rig.rotation.order = 'YXZ';
    this.torso.add(this.rig);
    this.rig.position.set(0, SHOULDER_Y - 0.9, 0);
    this.armL = makeArm(-1);
    this.armR = makeArm(1);
    for (const arm of [this.armL, this.armR]) {
      arm.pivot.position.y = 0;
      this.rig.add(arm.pivot);
    }
    for (const side of [-1, 1]) { // shoulder joints with a glowing ring
      const pad = mesh(new THREE.SphereGeometry(0.11, 10, 8), MAT.joint, side * (SHOULDER_X + 0.02), SHOULDER_Y - 0.9 + 0.04, 0);
      pad.scale.set(1.15, 1, 1.1);
      const ring = mesh(new THREE.TorusGeometry(0.115, 0.012, 6, 14), MAT.glow, side * (SHOULDER_X + 0.02), SHOULDER_Y - 0.9 + 0.04, 0);
      ring.rotation.y = Math.PI / 2;
      this.torso.add(pad, ring);
    }

    // Gun in the right hand: one copy per weapon, only the equipped one shown.
    this.socket = new THREE.Group();
    this.armR.hand.add(this.socket);
    this.guns = weapons.cfg.list.map((cfg) => {
      const model = buildHeldModel(cfg.id);
      if (!model) return null;
      const grip = GRIPS[cfg.id];
      const holder = new THREE.Group();
      holder.scale.setScalar(GUN_SCALE);
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
    this.reset();
  }

  reset() {
    this.bodyYaw = this.player.yaw;
    this.phase = 0;
    this.fireT = 0;
    this.reloadBlend = 0;
    this.fallT = 0;
    this.stride = 0;
    this.heldIndex = -2;
    this.aimW = 0;
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
    this.group.visible = show;
    if (!show) return;

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
      if (weapons.swingT >= 0) { // quick melee jab
        const s = Math.sin(Math.PI * weapons.swingT);
        rigX += 0.35 * s;
        rigY += 0.5 * s;
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
  }
}
