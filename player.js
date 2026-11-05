import * as THREE from 'three';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent exponential smoothing toward a target. */
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

/*
 * KINEMATIC PLAYER CONTROLLER
 *
 * No physics engine: velocity is integrated by hand and collision is resolved by
 * World.move() (cylinder vs. axis-aligned footprints, one axis at a time).
 * update() runs at a fixed 60 Hz. The camera is placed in applyCamera() at render
 * rate, interpolating between the previous and current fixed step so motion stays
 * smooth on any refresh rate.
 *
 * Feel features, all tuned from CONFIG.player:
 *  - coyote time: you can still jump for a moment after walking off a ledge
 *  - jump buffer: a jump pressed just before landing fires on landing
 *  - slide: a speed burst that decays over ~0.8 s; jumping out keeps the momentum
 *  - air control only *adds* speed toward the wish direction (Quake style), so
 *    momentum from a slide-jump is never bled off in mid-air
 */
export class Player {
  constructor(camera, world, cfg) {
    this.camera = camera;
    this.world = world;
    this.cfg = cfg;
    camera.rotation.order = 'YXZ'; // yaw first, then pitch, then roll: standard FPS look

    this.pos = new THREE.Vector3(); // feet position
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.wish = new THREE.Vector3();
    this.slideDir = new THREE.Vector3();
    this._camA = new THREE.Vector3();
    this._camB = new THREE.Vector3();
    this._pivot = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this.aimBlend = 0;

    // Callbacks wired up in main.js.
    this.onLand = null;
    this.onJump = null;
    this.onSlide = null;
    this.onDamage = null;
    this.onDeath = null;

    this.reset();
  }

  reset() {
    const c = this.cfg;
    this.pos.set(0, 0, this.spawnZ ?? 22);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.kickPitch = 0; // temporary camera recoil that recovers
    this.kickYaw = 0;
    this.shake = 0;
    this.aimBlend = 0; // 0 = hip, 1 = fully aimed; written by Weapons every frame
    this.zoom = 0; // degrees of FOV removed by aiming; written by Weapons

    this.health = c.maxHealth;
    this.alive = true;
    this.thirdPerson = false;
    this.tpBlend = 0; // 0 = first person eye, 1 = full over-the-shoulder camera

    this.grounded = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.sprinting = false;
    this.sprintLocked = false; // set when firing cancels a sprint; cleared on releasing Shift
    this.sliding = false;
    this.slideTimer = 0;
    this.slideCooldown = 0;

    this.bobPhase = 0;
    this.bobAmt = 0;
    this.dip = 0;
    this.dipVel = 0;
    this.stepSmooth = 0;
    this.eyeHeight = c.eyeHeight;
    this.camX = 0;
    this.camY = c.eyeHeight;
    this.prevCamX = 0;
    this.prevCamY = c.eyeHeight;
    this.roll = 0;
    this.prevRoll = 0;
    this.fov = c.fov;
  }

  /* ------------------------------- input -------------------------------- */

  look(dx, dy) {
    // Slower look while aiming: it feels like the same angular speed on a zoomed-in image.
    const sensitivity = this.cfg.mouseSensitivity * lerp(1, this.cfg.adsSensitivity, this.aimBlend);
    this.yaw -= dx * sensitivity;
    this.pitch = clamp(this.pitch - dy * sensitivity, -1.55, 1.55);
  }

  /** Weapons call this: firing while sprinting drops you out of the sprint. */
  cancelSprint() {
    this.sprinting = false;
    this.sprintLocked = true;
  }

  /** Recoil: `pitch` kicks the camera (recovers); `climb` moves your actual aim up. */
  addRecoil(kickPitch, kickYaw, climb) {
    this.kickPitch += kickPitch;
    this.kickYaw += kickYaw;
    this.pitch = clamp(this.pitch + climb, -1.55, 1.55);
  }

  /** True once the camera has pulled far enough back that the wizard (not the viewmodel) should be shown. */
  get thirdPersonVisible() {
    return this.tpBlend > 0.35;
  }

  toggleView() {
    this.thirdPerson = !this.thirdPerson;
  }

  /**
   * Over-the-shoulder camera target (unobstructed). Sets `out` to the camera position and
   * returns the distance back from the pivot. Aiming pulls in closer and across the shoulder.
   */
  _orbit(out, pivot, forward, right, yawPos, blend) {
    const t = this.cfg.thirdPerson;
    const dist = lerp(t.dist, t.aimDist, this.aimBlend) * blend;
    const shoulder = lerp(t.shoulder, t.aimShoulder, this.aimBlend) * blend;
    pivot.set(yawPos.x, yawPos.y + this.eyeHeight - t.pivotDrop + this.stepSmooth, yawPos.z);
    out.copy(pivot).addScaledVector(forward, -dist).addScaledVector(right, shoulder);
    out.y += 0.12 * blend;
    return dist;
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /**
   * Aim ray built from the latest yaw/pitch (not last frame's camera), so shots
   * go exactly where the crosshair is pointing right now. Includes visual kick.
   */
  getAim(origin, forward, right, up) {
    const pitch = this.pitch + this.kickPitch;
    const yaw = this.yaw + this.kickYaw;
    const cp = Math.cos(pitch);
    forward.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    up.crossVectors(right, forward);
    origin.set(this.pos.x, this.pos.y + this.cfg.eyeHeight, this.pos.z);
    if (this.tpBlend > 0.001) {
      // Third person: start the ray on the crosshair line at the wizard's depth, so shots land
      // exactly under the crosshair and nothing between the camera and the wizard can block them.
      const dist = this._orbit(this._camA, this._pivot, forward, right, this.pos, this.tpBlend);
      origin.copy(this._camA).addScaledVector(forward, dist);
    }
  }

  takeDamage(amount, fromPos) {
    if (!this.alive || this.invulnerable) return;
    this.health = Math.max(0, this.health - amount);
    this.shake = 1;
    if (fromPos) { // small shove away from the attacker
      const dx = this.pos.x - fromPos.x;
      const dz = this.pos.z - fromPos.z;
      const len = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / len) * this.cfg.hitKnockback;
      this.vel.z += (dz / len) * this.cfg.hitKnockback;
    }
    if (this.onDamage) this.onDamage(amount);
    if (this.health <= 0) {
      this.alive = false;
      if (this.onDeath) this.onDeath();
    }
  }

  heal(amount) {
    this.health = Math.min(this.cfg.maxHealth, this.health + amount);
  }

  /* ---------------------------- fixed update ----------------------------- */

  update(dt, input) {
    const c = this.cfg;
    const world = this.world;

    this.prevPos.copy(this.pos);
    this.prevCamX = this.camX;
    this.prevCamY = this.camY;
    this.prevRoll = this.roll;

    // --- Wish direction from WASD, rotated by yaw ---
    const ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const iz = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    this.wish.set(ix * cos - iz * sin, 0, -ix * sin - iz * cos);
    const hasInput = ix !== 0 || iz !== 0;
    if (hasInput) this.wish.normalize();

    // --- Timers ---
    this.coyote = this.grounded ? c.coyoteTime : this.coyote - dt;
    this.jumpBuffer = input.jumpPressed ? c.jumpBuffer : this.jumpBuffer - dt;
    this.slideCooldown -= dt;

    // --- Slide start: needs an active sprint on the ground (uses last step's sprint state) ---
    if (input.slidePressed && this.sprinting && this.grounded && !this.sliding && this.slideCooldown <= 0) {
      this.sliding = true;
      this.slideTimer = c.slideTime;
      this.slideCooldown = c.slideCooldown;
      this.slideDir.set(this.vel.x, 0, this.vel.z);
      if (this.slideDir.lengthSq() < 0.01) this.slideDir.copy(this.wish);
      this.slideDir.normalize();
      if (this.onSlide) this.onSlide();
    }

    // --- Sprint state ---
    if (!input.sprintHeld) this.sprintLocked = false;
    this.sprinting = input.sprintHeld && iz > 0 && !this.sprintLocked && !this.sliding;

    // --- Jump (works from the ground, during coyote time, or out of a slide) ---
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vel.y = c.jumpSpeed;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      if (this.sliding) { // jump out of a slide: keep (and slightly boost) the momentum
        this.sliding = false;
        this.vel.x *= c.slideJumpBoost;
        this.vel.z *= c.slideJumpBoost;
      }
      if (this.onJump) this.onJump();
    }

    // --- Horizontal velocity ---
    if (this.sliding) {
      this.slideTimer -= dt;
      const k = Math.max(0, this.slideTimer / c.slideTime);
      // Quadratic decay: a hard burst up front that tapers off.
      const speed = c.slideEndSpeed + (c.slideSpeed - c.slideEndSpeed) * k * k;
      if (hasInput) this.slideDir.addScaledVector(this.wish, c.slideSteer * dt).normalize();
      this.vel.x = this.slideDir.x * speed;
      this.vel.z = this.slideDir.z * speed;
      if (this.slideTimer <= 0) this.sliding = false;
    } else {
      const target = (this.sprinting ? c.sprintSpeed : c.walkSpeed) * lerp(1, c.adsSpeedMul, this.aimBlend);
      if (this.grounded) {
        const tx = hasInput ? this.wish.x * target : 0;
        const tz = hasInput ? this.wish.z * target : 0;
        const maxDelta = (hasInput ? c.groundAccel : c.groundDecel) * dt;
        const dx = tx - this.vel.x;
        const dz = tz - this.vel.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= maxDelta) {
          this.vel.x = tx;
          this.vel.z = tz;
        } else {
          this.vel.x += (dx / dist) * maxDelta;
          this.vel.z += (dz / dist) * maxDelta;
        }
      } else if (hasInput) {
        // Air control: only add speed along the wish direction, never remove any.
        const current = this.vel.x * this.wish.x + this.vel.z * this.wish.z;
        const add = target - current;
        if (add > 0) {
          const a = Math.min(c.airAccel * dt, add);
          this.vel.x += this.wish.x * a;
          this.vel.z += this.wish.z * a;
        }
      }
    }

    // --- Integrate: horizontal with collision, then vertical against the ground ---
    this.vel.y -= c.gravity * dt;
    world.move(this.pos, this.vel.x * dt, this.vel.z * dt, c.radius, this.pos.y);
    if (world.hitX) this.vel.x = 0;
    if (world.hitZ) this.vel.z = 0;
    this._integrateVertical(dt);

    // --- Camera feel (bob, landing dip, eye height, roll) ---
    this.eyeHeight = damp(this.eyeHeight, this.sliding ? c.slideEyeHeight : c.eyeHeight, 14, dt);
    const hSpeed = this.speed;
    const moving = this.grounded && !this.sliding && hSpeed > 0.8 && hasInput;
    this.bobAmt = damp(this.bobAmt, moving ? 1 : 0, 10, dt);
    if (moving) this.bobPhase += hSpeed * c.bobFreq * dt;
    const amp = this.sprinting ? c.bobAmpSprint : c.bobAmpWalk;
    const bobY = Math.sin(this.bobPhase * 2) * amp * this.bobAmt; // two dips per full cycle = two footsteps
    this.camX = Math.cos(this.bobPhase) * amp * 0.6 * this.bobAmt;

    // Landing dip is a damped spring pushed down by an impulse on landing.
    this.dipVel += (-c.dipStiffness * this.dip - c.dipDamping * this.dipVel) * dt;
    this.dip += this.dipVel * dt;
    this.stepSmooth = damp(this.stepSmooth, 0, 12, dt);
    this.camY = this.eyeHeight + this.dip + bobY + this.stepSmooth;

    const targetRoll = (this.sliding ? c.slideRoll : 0) - ix * c.leanRoll * (this.grounded ? 1 : 0.5);
    this.roll = damp(this.roll, targetRoll, 10, dt);
  }

  _integrateVertical(dt) {
    const c = this.cfg;
    const world = this.world;
    const wasGrounded = this.grounded;
    const impact = -this.vel.y;
    const oldY = this.pos.y;

    this.pos.y += this.vel.y * dt;
    const ground = world.groundHeight(this.pos.x, this.pos.z);

    if (this.vel.y <= 0 && this.pos.y <= ground + 1e-4) {
      // Landed (or still standing).
      this.pos.y = ground;
      this.vel.y = 0;
      this.grounded = true;
      if (!wasGrounded && impact > c.landThreshold) {
        this.dipVel -= Math.min(impact, c.maxLandImpact) * c.landDip;
        if (this.onLand) this.onLand(impact);
      }
      // Stepping up onto a ledge or ramp: hide the pop by lagging the camera behind.
      if (wasGrounded && ground - oldY > 0.02) this.stepSmooth -= ground - oldY;
    } else if (wasGrounded && this.vel.y <= 0 && this.pos.y - ground <= c.snapDown) {
      // Walking down a ramp: stay glued to the surface instead of going airborne.
      this.pos.y = ground;
      this.vel.y = 0;
    } else {
      this.grounded = false;
    }
  }

  /* ------------------------------ rendering ------------------------------ */

  /** Called once per rendered frame with the fixed-step blend factor `alpha`. */
  applyCamera(alpha, dt) {
    const c = this.cfg;
    const cam = this.camera;
    const camX = lerp(this.prevCamX, this.camX, alpha);
    const camY = lerp(this.prevCamY, this.camY, alpha);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    cam.position.set(
      lerp(this.prevPos.x, this.pos.x, alpha) + camX * cos,
      lerp(this.prevPos.y, this.pos.y, alpha) + camY,
      lerp(this.prevPos.z, this.pos.z, alpha) - camX * sin,
    );

    this.kickPitch *= Math.exp(-c.kickRecover * dt);
    this.kickYaw *= Math.exp(-c.kickRecover * dt);
    this.shake = Math.max(0, this.shake - dt * 3.5);
    const s = this.shake * this.shake * c.shakeAmount;
    const blend = this.tpBlend = damp(this.tpBlend, this.thirdPerson ? 1 : 0, 9, dt);
    cam.rotation.set(
      this.pitch + this.kickPitch + (Math.random() - 0.5) * s,
      this.yaw + this.kickYaw + (Math.random() - 0.5) * s,
      lerp(this.prevRoll, this.roll, alpha) * (1 - blend) + (Math.random() - 0.5) * s,
    );

    if (blend > 0.001) {
      // Over-the-shoulder: slide the camera from the eye to the orbit position, never through geometry.
      const pos = this._camB.set(
        lerp(this.prevPos.x, this.pos.x, alpha), lerp(this.prevPos.y, this.pos.y, alpha), lerp(this.prevPos.z, this.pos.z, alpha),
      );
      this.getAim(this._camA, this._fwd, this._right, this._up); // forward/right only; origin overwritten below
      this._orbit(this._camA, this._pivot, this._fwd, this._right, pos, blend);
      const dx = this._camA.x - this._pivot.x;
      const dy = this._camA.y - this._pivot.y;
      const dz = this._camA.z - this._pivot.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      this._up.set(dx / len, dy / len, dz / len);
      const hit = this.world.raycast(this._pivot, this._up, len + 0.25);
      const d = Math.min(len, Math.max(0.25, hit - 0.25));
      this._camA.copy(this._pivot).addScaledVector(this._up, d);
      cam.position.lerp(this._camA, blend);
    }

    const targetFov = c.fov + (this.sliding ? c.slideFovAdd : this.sprinting ? c.sprintFovAdd : 0) - this.zoom;
    this.fov = damp(this.fov, targetFov, c.fovLerp, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
