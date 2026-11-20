import * as THREE from 'three';
import { clamp, damp, lerp } from '../../core/client/engine/math.js';

/*
 * CHASE CAMERA: follows the rider from behind and above, and looks a little way past the rider down
 * the slope. The mouse or the right stick orbits it. While the rider moves and the player leaves the
 * view alone, it swings back behind the rider. The view widens with speed.
 *
 * It never goes under the snow, and it rises when the ground would hide the rider (a camera that
 * trails behind a rider on a steep slope is up the hill from the rider, close to the ground).
 */

const SIGHT_SAMPLES = 4; // points checked along the line from the rider to the camera

export class ChaseCamera {
  /**
   * @param deps {
   *   camera, config (CONFIG.ski.camera), groundHeight(x, z),
   *   sensitivity() radians of orbit for one unit of look input, fov() the view angle at rest in degrees
   *   (both are read live: the player can change them in the settings)
   * }
   */
  constructor({ camera, config, groundHeight, sensitivity, fov }) {
    this.camera = camera;
    this.config = config;
    this.groundHeight = groundHeight;
    this.sensitivity = sensitivity;
    this.fov = fov;
    this.position = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._wanted = new THREE.Vector3();
    this._aim = new THREE.Vector3();
    this.reset();
  }

  /** Back to the view from straight behind, and place the camera at once on the next update. */
  reset() {
    this.yawOffset = 0; // radians the view is turned away from the rider's heading
    this.pitch = this.config.pitch; // radians the camera sits above the rider's level
    this.idle = this.config.returnDelay; // seconds since the player last moved the view
    this.settled = false; // false: the next update jumps to the wanted place and does not glide there
    this.viewFov = this.fov();
  }

  /** The player moved the view. Same directions as a first-person look: right turns right, up looks up. */
  look(dx, dy) {
    const c = this.config;
    const scale = this.sensitivity();
    this.yawOffset -= dx * scale;
    this.pitch = clamp(this.pitch + dy * scale, c.minPitch, c.maxPitch);
    this.idle = 0;
  }

  /**
   * Once per rendered frame.
   * @param subject { x, y, z (the rider's feet), heading (the yaw the rider faces), speed (m/s) }
   * @param zoom the camera distance as a multiple of the configured one
   */
  update(dt, subject, zoom = 1) {
    const c = this.config;
    this.idle += dt;
    if (this.idle > c.returnDelay) { // swing back behind the rider, faster the faster the rider goes
      const rate = c.returnRate * clamp(subject.speed / c.returnFullSpeed, 0, 1);
      this.yawOffset = damp(this.yawOffset, 0, rate, dt);
      this.pitch = damp(this.pitch, c.pitch, rate, dt);
    }

    const yaw = subject.heading + this.yawOffset;
    const backX = Math.sin(yaw); // yaw faces (-sin, -cos), so this points behind the view
    const backZ = Math.cos(yaw);
    const distance = c.distance * zoom;
    const flat = Math.cos(this.pitch) * distance;
    const target = this._target.set(subject.x, subject.y + c.lookHeight, subject.z);
    const wanted = this._wanted.set(target.x + backX * flat, target.y + Math.sin(this.pitch) * distance, target.z + backZ * flat);
    wanted.y = Math.max(wanted.y, this._clearHeight(target, wanted));

    const wantedFov = this.fov() + c.speedFov * clamp(subject.speed / c.speedFovFull, 0, 1); // speed widens the view
    this.viewFov = this.settled ? damp(this.viewFov, wantedFov, c.fovRate, dt) : wantedFov;
    if (this.settled) {
      this.position.set(
        damp(this.position.x, wanted.x, c.followRate, dt), damp(this.position.y, wanted.y, c.followRate, dt), damp(this.position.z, wanted.z, c.followRate, dt),
      );
    } else {
      this.position.copy(wanted);
      this.settled = true;
    }
    // The glide can cut a corner through a bump: the snow always wins.
    this.position.y = Math.max(this.position.y, this.groundHeight(this.position.x, this.position.z) + c.clearance);

    this.camera.position.copy(this.position);
    if (this.camera.fov !== this.viewFov) {
      this.camera.fov = this.viewFov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this._aim.set(target.x - backX * c.lead, target.y, target.z - backZ * c.lead));
  }

  /** The lowest height at `wanted` from which the camera is above the snow and sees the rider over the ground between them. */
  _clearHeight(target, wanted) {
    const c = this.config;
    let needed = this.groundHeight(wanted.x, wanted.z) + c.clearance;
    for (let sample = 1; sample < SIGHT_SAMPLES; sample++) {
      const along = sample / SIGHT_SAMPLES;
      const ground = this.groundHeight(lerp(target.x, wanted.x, along), lerp(target.z, wanted.z, along)) + c.sightMargin;
      needed = Math.max(needed, target.y + (ground - target.y) / along); // the sight line must pass over this point
    }
    return needed;
  }
}
