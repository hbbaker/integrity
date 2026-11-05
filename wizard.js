import * as THREE from 'three';
import { material, MuzzleFlash } from './effects.js';
import { buildHeldModel } from './weapons.js';

/*
 * The third-person character: a chunky, flat-shaded, old-school-WoW-style wizard
 * (pointy hat, big nose and beard, oversized gold-trimmed shoulder pads, blue robe).
 * Built from a handful of low-segment primitives (a few hundred triangles) and posed
 * procedurally every frame. It holds a copy of whichever gun is equipped.
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

// Where each hand grips a gun, in the gun model's own space (matches the first-person arms).
const GRIPS = {
  pistol: { right: [0.052, -0.09, 0.05], left: [-0.052, -0.11, 0.04] },
  shotgun: { right: [0.05, -0.09, 0.22], left: [0, -0.1, -0.25] },
  smg: { right: [0.052, -0.1, 0.13], left: [0, -0.07, -0.19] },
  raygun: { right: [0.052, -0.11, 0.085], left: [0, -0.085, -0.1] },
};

const MAT = {
  robe: material(0x3a47b8, { roughness: 0.9, flatShading: true }),
  robeDark: material(0x2a2f86, { roughness: 0.9, flatShading: true }),
  gold: material(0xe0b030, { roughness: 0.45, metalness: 0.5, flatShading: true }),
  skin: material(0xe2b38e, { roughness: 0.85, flatShading: true }),
  beard: material(0xe6e6e0, { roughness: 0.95, flatShading: true }),
  hat: material(0x2c2a8c, { roughness: 0.9, flatShading: true }),
  boot: material(0x4a2f1c, { roughness: 0.9, flatShading: true }),
  dark: material(0x15151c, { roughness: 0.9 }),
  cape: material(0x6a2fa8, { roughness: 0.9, flatShading: true, side: THREE.DoubleSide }),
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

/** An arm hanging from a shoulder pivot: stretchable sleeve, bell cuff, and a hand at the end. */
function makeArm(side) {
  const pivot = new THREE.Group();
  pivot.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
  pivot.rotation.order = 'YXZ';
  const sleeve = new THREE.Group(); // scaled along Y to reach a target
  sleeve.add(
    mesh(new THREE.BoxGeometry(0.11, ARM_LEN * 0.8, 0.11), MAT.robe, 0, -ARM_LEN * 0.4, 0),
    mesh(new THREE.CylinderGeometry(0.07, 0.115, 0.2, 6), MAT.robeDark, 0, -ARM_LEN * 0.8 + 0.02, 0), // bell cuff
    mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 6), MAT.gold, 0, -ARM_LEN * 0.8 + 0.12, 0), // cuff trim
  );
  const hand = new THREE.Group();
  hand.position.y = -ARM_LEN;
  hand.add(mesh(new THREE.BoxGeometry(0.1, 0.1, 0.12), MAT.skin));
  pivot.add(sleeve, hand);
  return { pivot, sleeve, hand };
}

function makeLeg(side) {
  const pivot = new THREE.Group();
  pivot.position.set(side * 0.13, 0.56, 0);
  pivot.add(
    mesh(new THREE.BoxGeometry(0.15, 0.4, 0.16), MAT.robeDark, 0, -0.2, 0),
    mesh(new THREE.BoxGeometry(0.17, 0.2, 0.26), MAT.boot, 0, -0.46, -0.04), // boot
    mesh(new THREE.BoxGeometry(0.18, 0.04, 0.27), MAT.gold, 0, -0.36, -0.04), // boot cuff
  );
  return pivot;
}

function makeHat() {
  const hat = new THREE.Group();
  hat.add(
    mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.03, 8), MAT.hat, 0, 0.12, 0), // wide brim
    mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.07, 7), MAT.gold, 0, 0.17, 0), // band
    mesh(new THREE.CylinderGeometry(0.12, 0.22, 0.34, 7), MAT.hat, 0, 0.34, 0),
  );
  const upper = new THREE.Group(); // the crooked tip
  upper.position.set(0, 0.5, 0);
  upper.rotation.z = -0.35;
  upper.add(mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.34, 6), MAT.hat, 0, 0.15, 0));
  const tip = new THREE.Group();
  tip.position.set(0, 0.32, 0);
  tip.rotation.z = -0.55;
  tip.add(mesh(new THREE.ConeGeometry(0.05, 0.25, 5), MAT.hat, 0, 0.1, 0));
  upper.add(tip);
  hat.add(upper, mesh(new THREE.BoxGeometry(0.07, 0.07, 0.02), MAT.gold, 0, 0.17, -0.225)); // buckle
  return hat;
}

export class Wizard {
  constructor({ scene, player, weapons }) {
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
      mesh(new THREE.CylinderGeometry(0.27, 0.43, 0.78, 7), MAT.robe, 0, 0.52, 0), // robe skirt
      mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.06, 7), MAT.gold, 0, 0.16, 0), // hem trim
    );

    this.torso = new THREE.Group();
    this.torso.position.y = 0.9;
    this.hips.add(this.torso);
    this.torso.add(
      mesh(new THREE.CylinderGeometry(0.27, 0.3, 0.5, 7), MAT.robe, 0, 0.25, 0),
      mesh(new THREE.CylinderGeometry(0.315, 0.315, 0.08, 7), MAT.gold, 0, 0.02, 0), // belt
      mesh(new THREE.BoxGeometry(0.1, 0.1, 0.03), MAT.gold, 0, 0.02, -0.3), // belt buckle
      mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.1, 7), MAT.robeDark, 0, 0.5, 0), // collar
    );

    // Short cape that sways with movement.
    this.cape = new THREE.Group();
    this.cape.position.set(0, 0.5, 0.2);
    this.cape.add(mesh(new THREE.BoxGeometry(0.5, 0.75, 0.03), MAT.cape, 0, -0.37, 0.02));
    this.torso.add(this.cape);

    // Head (pivot at the neck).
    this.head = new THREE.Group();
    this.head.position.y = 0.62;
    this.torso.add(this.head);
    const skull = mesh(new THREE.IcosahedronGeometry(0.19, 0), MAT.skin, 0, 0.1, 0);
    skull.scale.set(1, 1.1, 1);
    const nose = mesh(new THREE.ConeGeometry(0.045, 0.16, 4), MAT.skin, 0, 0.08, -0.22);
    nose.rotation.x = -Math.PI / 2;
    const beard = mesh(new THREE.ConeGeometry(0.16, 0.55, 6), MAT.beard, 0, -0.18, -0.1);
    beard.rotation.x = Math.PI;
    this.head.add(
      skull, nose, beard,
      mesh(new THREE.BoxGeometry(0.05, 0.04, 0.02), MAT.dark, -0.075, 0.14, -0.17), // eyes
      mesh(new THREE.BoxGeometry(0.05, 0.04, 0.02), MAT.dark, 0.075, 0.14, -0.17),
      mesh(new THREE.BoxGeometry(0.09, 0.03, 0.04), MAT.beard, -0.075, 0.19, -0.17), // bushy brows
      mesh(new THREE.BoxGeometry(0.09, 0.03, 0.04), MAT.beard, 0.075, 0.19, -0.17),
      mesh(new THREE.BoxGeometry(0.2, 0.06, 0.06), MAT.beard, 0, 0.0, -0.17), // moustache
    );
    const hat = makeHat();
    hat.position.y = 0.2;
    hat.rotation.x = -0.12; // tilted back a touch
    this.head.add(hat);

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
    for (const side of [-1, 1]) { // oversized WoW shoulder pads
      const pad = mesh(new THREE.OctahedronGeometry(0.2, 0), MAT.robeDark, side * (SHOULDER_X + 0.02), SHOULDER_Y - 0.9 + 0.06, 0);
      pad.scale.set(1.1, 0.65, 1.2);
      const trim = mesh(new THREE.TorusGeometry(0.17, 0.025, 4, 6), MAT.gold, side * (SHOULDER_X + 0.02), SHOULDER_Y - 0.9 + 0.1, 0);
      trim.rotation.x = Math.PI / 2;
      this.torso.add(pad, trim);
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
    }
    this.hips.position.y = damp(this.hips.position.y, hipY, 16, dt);
    this.legL.rotation.x = legL;
    this.legR.rotation.x = legR;
    this.torso.rotation.set(lean, Math.sin(this.phase) * 0.12 * Math.min(1, run) * (1 - this.aimW), 0);
    const breathe = Math.sin(time * 1.8) * 0.012;
    this.torso.position.y = 0.9 + breathe;
    this.head.rotation.x = -clamp(player.pitch, -0.8, 0.8) * 0.5 - lean * 0.6;
    this.head.rotation.y = clamp(shortest(player.yaw - this.bodyYaw), -0.7, 0.7) * 0.6 * (1 - this.aimW);
    this.cape.rotation.x = 0.1 + Math.min(1, run) * 0.5 + (player.sliding ? 0.5 : 0) + (grounded ? 0 : 0.4) + Math.sin(time * 3 + this.phase * 0.5) * 0.04;

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
