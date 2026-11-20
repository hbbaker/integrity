import * as THREE from 'three';
import { TrailRibbon } from '../../core/client/graphics/trail-ribbon.js';
import { clamp, lerp } from '../../core/client/engine/math.js';

/*
 * SNOW TRACKS: what a ride and a body do to the snow of a course (docs/adr/0005 and 0014).
 *
 *  - A track: a thin ribbon behind each ski, or one behind a board. It is narrow on an edge and wide in a skid.
 *  - A trough: the snow pressed down along the track, in the course's heightfield.
 *  - A dent where the rider lands, deeper for a harder landing.
 *  - A crater where a fallen body hits, and a trench where it slides.
 *  - Spray: snow thrown from the edge in a carve or a brake, and a puff at a landing or a hit.
 *
 * The snow under the rider goes down only after the rider has moved away (`clearance`), so the ride never tilts
 * on its own fresh track. A body presses the snow at once: the physics moves it, on the base ground.
 */

const SPRAY_LIFT = 0.05; // metres over the snow where spray starts
const between = ([low, high], share) => lerp(low, high, share);

export class SnowTracks {
  /**
   * @param deps {
   *   heightfield, terrain (the DeformableTerrain that draws it), group (where the tracks are drawn),
   *   config (CONFIG.ski.snow), ride ('skis' or 'board'),
   *   lines (metres to the right of the rider's path where each line of the track runs),
   *   particles (a ParticlePool, or null: then there is no spray)
   * }
   */
  constructor({ heightfield, terrain, group, config, ride, lines, particles }) {
    this.heightfield = heightfield;
    this.terrain = terrain;
    this.config = config;
    this.lines = lines;
    this.halfWidth = config.tracks.halfWidth[ride];
    this.edgeShift = ride === 'board' ? config.tracks.boardEdgeShift * this.halfWidth : 0;
    this.particles = particles;
    this.material = new THREE.MeshBasicMaterial({
      color: config.tracks.color, transparent: true, opacity: config.tracks.opacity, depthWrite: false, side: THREE.DoubleSide,
    });
    this.ribbons = lines.map(() => new TrailRibbon({ pieces: config.tracks.pieces, material: this.material }));
    for (const ribbon of this.ribbons) group.add(ribbon.mesh);
    this.waiting = []; // { x, z, radius, depth }: snow that goes down once the rider is clear of it
    this.bodyMarks = new Map(); // part of a fallen body -> where it last pressed the snow
    this.lastPoint = null; // { x, z }: the last point of the track, while the ride is on the snow
    this.sprayOwed = 0; // spray particles not yet thrown (the rate rarely gives a whole number each step)
    this.changed = null; // { minX, maxX, minZ, maxZ }: where the snow moved since the last update()
    this.everChanged = null; // ... and since the last reset()
    this._height = (x, z) => heightfield.heightAt(x, z);
    this._left = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._at = new THREE.Vector3();
  }

  /** Once per fixed step while the rider rides (not while it is down). */
  ride(dt, rider) {
    this._pressWhereClear(rider.pos);
    if (!rider.grounded) {
      this._endLines();
      return;
    }
    const yaw = rider.travelYaw;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const facing = Math.cos(rider.heading - yaw) >= 0 ? 1 : -1; // -1: the ride goes tail first, so its right side is on the path's left
    const carve = Math.abs(rider.edge);
    const brake = rider.controls.brake;
    this._spray(dt, rider, { forwardX, forwardZ, rightX, rightZ, facing, carve, brake });

    const { x, z } = rider.pos;
    const { tracks, trough } = this.config;
    if (this.lastPoint && Math.hypot(x - this.lastPoint.x, z - this.lastPoint.z) < tracks.spacing) return;
    this.lastPoint ??= { x: 0, z: 0 };
    this.lastPoint.x = x;
    this.lastPoint.z = z;
    const half = Math.max(lerp(this.halfWidth, tracks.edgeHalfWidth, carve), brake * tracks.skidHalfWidth);
    const shift = rider.edge * facing * this.edgeShift;
    this.lines.forEach((line, index) => {
      const middle = line + shift;
      this._onSnow(this._left, x + rightX * (middle - half), z + rightZ * (middle - half));
      this._onSnow(this._right, x + rightX * (middle + half), z + rightZ * (middle + half));
      this.ribbons[index].add(this._left, this._right);
    });
    this.waiting.push({ x, z, radius: trough.radius, depth: lerp(trough.depth, trough.hardDepth, Math.max(carve, brake)) });
  }

  _onSnow(out, x, z) {
    return out.set(x, this.heightfield.heightAt(x, z) + this.config.tracks.lift, z);
  }

  _endLines() {
    for (const ribbon of this.ribbons) ribbon.breakLine();
    this.lastPoint = null;
  }

  /** The rider came down at `position`. `share` is how hard: 0 = soft .. 1 = at the crash limit. */
  land(position, share) {
    const { dent, spray } = this.config;
    this.waiting.push({ x: position.x, z: position.z, radius: dent.radius, depth: lerp(dent.depth, dent.hardDepth, share) });
    this._puff(position, Math.round(between(spray.landCount, share)), between(spray.landSpeed, share));
  }

  /** The rider went down: its track ends, and the snow it was on goes down now. */
  fall() {
    this._endLines();
    for (const stamp of this.waiting) this._press(stamp);
    this.waiting.length = 0;
    this.bodyMarks.clear();
  }

  /**
   * A part of the fallen body is at `position` (its middle; `radius` metres thick) and moves at `speed` m/s.
   * If it touches the snow it leaves a crater: deep for a hard hit, a shallow trench for a slide.
   * Returns true when it pressed the snow.
   */
  pressBody(part, position, radius, speed) {
    const { crater, spray } = this.config;
    if (position.y - radius - this.heightfield.heightAt(position.x, position.z) > crater.contact) return false;
    const mark = this.bodyMarks.get(part);
    if (mark && Math.hypot(position.x - mark.x, position.z - mark.z) < crater.spacing) return false;
    this.bodyMarks.set(part, { x: position.x, z: position.z });
    const hard = clamp(speed / crater.fullSpeed, 0, 1);
    this._press({ x: position.x, z: position.z, radius: crater.radius, depth: lerp(crater.depth, crater.hardDepth, hard) });
    this._puff(position, Math.round(spray.craterCount * hard), between(spray.landSpeed, hard));
    return true;
  }

  /** Press down what waits, oldest first, as far as the rider is clear of it. */
  _pressWhereClear(riderPos) {
    const { waiting } = this;
    while (waiting.length > 0) {
      const stamp = waiting[0];
      if (Math.hypot(riderPos.x - stamp.x, riderPos.z - stamp.z) < stamp.radius + this.config.clearance) return;
      this._press(stamp);
      waiting.shift();
    }
  }

  _press({ x, z, radius, depth }) {
    if (!this.heightfield.stamp(x, z, radius, depth)) return;
    this.changed = this._grow(this.changed, x, z, radius);
    this.everChanged = this._grow(this.everChanged, x, z, radius);
  }

  _grow(area, x, z, radius) {
    if (!area) return { minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius };
    area.minX = Math.min(area.minX, x - radius);
    area.maxX = Math.max(area.maxX, x + radius);
    area.minZ = Math.min(area.minZ, z - radius);
    area.maxZ = Math.max(area.maxZ, z + radius);
    return area;
  }

  /** Snow thrown from the edge: to the outside of a carve, and ahead of a brake. */
  _spray(dt, rider, { forwardX, forwardZ, rightX, rightZ, facing, carve, brake }) {
    const { spray } = this.config;
    if (!this.particles) return;
    const fast = clamp((rider.speed - spray.minSpeed) / (spray.fullSpeed - spray.minSpeed), 0, 1);
    const carved = carve * spray.carveShare;
    this.sprayOwed += fast * Math.max(carved, brake) * spray.rate * dt;
    if (this.sprayOwed < 1) return;
    const outward = -Math.sign(rider.edge) * facing; // away from the edge that is in the snow
    const push = rider.speed * spray.throw;
    const pushX = (rightX * outward * carved + forwardX * brake) * push + rider.vel.x * spray.carry;
    const pushZ = (rightZ * outward * carved + forwardZ * brake) * push + rider.vel.z * spray.carry;
    const jitter = () => (Math.random() - 0.5) * spray.jitter;
    for (; this.sprayOwed >= 1; this.sprayOwed -= 1) {
      const side = (Math.random() - 0.5) * 2 * this.halfWidth - outward * this.halfWidth;
      this._at.set(rider.pos.x + rightX * side, rider.pos.y + SPRAY_LIFT, rider.pos.z + rightZ * side);
      this.particles.spawn(
        this._at, pushX + jitter(), between(spray.up, Math.random()) * (0.4 + 0.6 * fast), pushZ + jitter(),
        spray.color, between(spray.size, Math.random()), spray.life, spray.gravity, spray.spin,
      );
    }
  }

  _puff(position, count, speed) {
    const { spray } = this.config;
    if (!this.particles || count <= 0) return;
    this._at.copy(position);
    this._at.y = this.heightfield.heightAt(position.x, position.z) + SPRAY_LIFT;
    this.particles.burst(this._at, spray.color, count, speed, spray.size[1], spray.life, spray.gravity);
  }

  /** Once per rendered frame: draw the snow that moved, and lay the tracks on it again. */
  update() {
    const area = this.changed;
    if (!area) return;
    this.changed = null;
    this._redraw(area);
  }

  _redraw({ minX, maxX, minZ, maxZ }) {
    this.terrain.redraw(minX, maxX, minZ, maxZ);
    for (const ribbon of this.ribbons) ribbon.settle(minX, maxX, minZ, maxZ, this._height, this.config.tracks.lift);
  }

  /** A new run: fresh snow, no tracks. */
  reset() {
    for (const ribbon of this.ribbons) ribbon.clear();
    this.waiting.length = 0;
    this.bodyMarks.clear();
    this.lastPoint = null;
    this.sprayOwed = 0;
    this.changed = null;
    if (!this.everChanged) return;
    this.heightfield.liftPressed();
    this._redraw(this.everChanged);
    this.everChanged = null;
  }

  /** Take the tracks out of the scene. The snow itself belongs to the course. */
  dispose() {
    for (const ribbon of this.ribbons) ribbon.dispose();
    this.material.dispose();
  }
}
