import * as THREE from 'three';
import { clamp, damp } from '../../core/client/engine/math.js';

/*
 * RIDER: how skis or a board move down a course. No physics engine: the velocity is integrated by
 * hand on the course's heightfield, at the fixed step.
 *
 * On the snow the ride slides along the way it points and grips sideways, so turning the ride carves
 * a turn. Gravity pulls it down the slope, snow friction and air drag hold it back, and a tuck cuts
 * the drag. A turn can pull only so hard (`maxLateralAccel`), so the faster you go the wider you turn.
 * The rider always knows which edge it is on (`mountainEdge`); the body brakes on that edge. An edge that
 * goes down on the side the ride moves toward catches (`caught`): see _watchForCatch.
 * Left alone, the ride swings round to line up with the way it travels: nose first, or tail first when it
 * rides backward (switch).
 *
 * Where the snow drops away from the path (a lip, a cliff), or after a pop, the rider is in the air and flies
 * a plain arc until the snow comes back up. In the air the ride spins and flips (see _rotateInAir), and the
 * landing is judged (see _land). Over ripples and gentle rolls the ride stays glued to the snow.
 *
 * `heading` is a yaw like the player's: 0 faces -Z and a turn to the right makes it smaller.
 */

const TAU = 2 * Math.PI;
const shortestTurn = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const REST = Object.freeze({ steer: 0, tuck: 0, brake: 0, pop: false, stomp: false, grab: null });
const X_AXIS = new THREE.Vector3(1, 0, 0);
export const RIGHT_EDGE = 1;
export const LEFT_EDGE = -1;

export class Rider {
  /** @param deps { config (CONFIG.ski.rider with the chosen ride's numbers merged in), course (from buildCourse) } */
  constructor({ config, course }) {
    this.config = config;
    this.course = course;
    this.pos = new THREE.Vector3(); // where the ride touches the snow (or would, in the air)
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.accel = new THREE.Vector3(); // the change of velocity over the last step, per second: the body sways with it
    this.up = new THREE.Vector3(0, 1, 0); // the ride's own up: the snow's normal, smoothed
    this.orientation = new THREE.Quaternion(); // the ride's frame: its up, and -Z along the heading
    this.prevOrientation = new THREE.Quaternion();
    this._normal = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._before = new THREE.Vector3();
    this._basis = new THREE.Matrix4();
    this._right = new THREE.Vector3();
    this._back = new THREE.Vector3();
    this._flipTurn = new THREE.Quaternion();
    // This air time: radians spun (above zero: to the left) and flipped (above zero: a back flip), and seconds each grab was held.
    // `load` is the gravity load: the greatest height above the snow, in metres. `stompAt` is the air time at which the stomp was pressed (null: not yet).
    this.air = { spin: 0, flip: 0, grabs: {}, load: 0, stompAt: null };
    this.reset(course.start, course.start.yaw);
  }

  /** Stand still on the snow at a point, facing `heading`. */
  reset(point, heading) {
    const field = this.course.heightfield;
    this.pos.set(point.x, field.heightAt(point.x, point.z), point.z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.accel.set(0, 0, 0);
    this.heading = heading;
    this.edge = 0; // -1 = hard on the left edge .. +1 = hard on the right edge
    this.mountainEdge = this.config.startEdge; // RIGHT_EDGE or LEFT_EDGE: the edge the ride is on, which a brake digs in
    this.grounded = true;
    this.airTime = 0; // seconds since the ride left the snow
    this.landingSpeed = 0; // m/s into the snow at the last landing
    this.bonk = 0; // m/s into the last tree or rock that was hit this step (0 = none)
    this.controls = REST; // what the player held on the last step: the body poses from it
    this.edgeSteer = 0;
    this.popCharge = 0; // 0..1: how far the pop is charged
    this.popBlocked = false; // the pop control is held since the air: no charge until it is let go
    this.popWindow = 0; // seconds left after leaving the snow in which a pop still counts (a pop timed on a lip)
    this.spinRate = 0; // radians per second in the air, above zero to the left
    this.flipRate = 0; // radians per second in the air, above zero a back flip
    this.air.spin = 0;
    this.air.flip = 0;
    this.air.grabs = {};
    this.air.load = 0;
    this.air.stompAt = null;
    this.landed = null; // set for one step on landing: see _land
    this.catchLoad = 0; // builds while the leading edge is down in a brake: it catches at config.catchLimit
    this.wrongEdgeTime = 0; // seconds on the downhill edge, well across the slope: it catches at wrongEdgeGrace
    this.wrongEdgeGrace = this.config.wrongEdgeGrace; // seconds the edge the ride is on may be the wrong one: the base, plus what the last edge earned
    this.heldEdge = 0; // the edge the ride was last set on ...
    this.edgeHeld = 0; // ... and for how many seconds (see _trackEdgeHold)
    this.steerSide = 0; // the side the player last steered to (-1 left, +1 right) ...
    this.neutralTime = Infinity; // ... and the seconds since the player let go of it
    this.caught = 0; // set for one step when an edge catches: RIGHT_EDGE or LEFT_EDGE (the edge that caught)
    field.normalAt(this.pos.x, this.pos.z, this.up);
    this._orient();
    this.prevOrientation.copy(this.orientation);
  }

  get speed() {
    return this.vel.length();
  }

  /** The yaw the rider travels toward (not the way the ride points); the heading when nearly at rest. */
  get travelYaw() {
    const flatSpeed = Math.hypot(this.vel.x, this.vel.z);
    return flatSpeed > this.config.weathervaneMinSpeed ? Math.atan2(-this.vel.x, -this.vel.z) : this.heading;
  }

  /**
   * One fixed step.
   * @param controls {
   *   steer (-1 left .. +1 right), tuck (0..1: push when slow, tuck when fast), brake (0..1),
   *   pop (true while the pop control is held: it charges, and the release jumps),
   *   stomp (true on the step the stomp control is pressed: it counts in the air, once),
   *   grab (the id of the grab the player holds, or null)
   * } In the air, steer nudges the spin, and tuck and brake nudge a front flip and a back flip.
   */
  step(dt, controls) {
    const c = this.config;
    const field = this.course.heightfield;
    this.prevPos.copy(this.pos);
    this.prevOrientation.copy(this.orientation);
    this._before.copy(this.vel);
    this.bonk = 0;
    this.caught = 0;
    this.landed = null;
    this.controls = controls;

    this.vel.y -= c.gravity * dt;
    this._pop(dt, controls);
    if (this.grounded) {
      this._steer(dt, controls);
      if (controls.brake === 0) this._trackMountainEdge(); // a brake stays on the edge it began on
      this._watchForCatch(dt, controls);
      this._slide(dt, controls);
    } else {
      this.airTime += dt;
      this.vel.multiplyScalar(Math.max(0, 1 - c.airDrag * this.speed * dt));
      this._rotateInAir(dt, controls);
    }
    this.pos.addScaledVector(this.vel, dt);
    this._hitObstacles();
    this._stayOnCourse();

    // Contact with the snow: land, stay glued over gentle ground, or leave it where it falls away fast.
    const ground = field.heightAt(this.pos.x, this.pos.z);
    const normal = field.facetNormalAt(this.pos.x, this.pos.z, this._normal);
    const gap = this.pos.y - ground;
    const leaving = this.vel.dot(normal); // speed away from the snow (below zero: into it)
    if (gap <= 0 || (this.grounded && gap < c.snapDistance && !this._snowFallsAway())) {
      if (!this.grounded) this._land(Math.max(0, -leaving));
      this.pos.y = ground;
      this.vel.addScaledVector(normal, -leaving); // the snow takes all the speed across it
      this.grounded = true;
      this.airTime = 0;
      this.up.lerp(normal, 1 - Math.exp(-c.alignRate * dt)).normalize();
    } else {
      if (this.grounded) this._takeOff();
      this.grounded = false;
    }

    this.accel.copy(this.vel).sub(this._before).divideScalar(dt);
    this._orient();
  }

  /* --------------------------------- air ---------------------------------- */

  /** Hold the pop control to charge, release it to jump. The jump is along the ride's own up, so a lip throws you further. */
  _pop(dt, controls) {
    const c = this.config;
    this.popWindow = this.grounded ? c.popLate : this.popWindow - dt;
    const canPop = this.grounded || this.popWindow > 0;
    // A hold that began in the air was a stomp: it must not charge a pop when the ride lands with it still held.
    if (!controls.pop) this.popBlocked = false;
    else if (!canPop) this.popBlocked = true;
    if (controls.pop && canPop && !this.popBlocked) {
      this.popCharge = Math.min(1, this.popCharge + dt / c.popChargeTime);
      return;
    }
    if (this.popCharge > 0 && canPop) { // released
      if (this.grounded) this._takeOff();
      this.vel.addScaledVector(this.up, c.popSpeedMin + (c.popSpeedMax - c.popSpeedMin) * this.popCharge);
      this.grounded = false;
      this.popWindow = 0;
    }
    this.popCharge = 0;
  }

  /** The ride leaves the snow: a new air time begins. */
  _takeOff() {
    this.air.spin = 0;
    this.air.flip = 0;
    this.air.grabs = {};
    this.air.load = 0;
    this.air.stompAt = null;
    this.spinRate = 0;
    this.flipRate = 0;
  }

  /**
   * A flick of the mouse or the stick, in the air: `spin` -1 (left) .. +1 (right) and `flip` -1 (forward) .. +1 (back),
   * each times the strength of the flick. It adds turning speed, so a second flick the same way turns faster.
   */
  flick(spin, flip) {
    if (this.grounded) return;
    const c = this.config;
    this.spinRate = clamp(this.spinRate - spin * c.flickSpin, -c.maxSpinRate, c.maxSpinRate);
    this.flipRate = clamp(this.flipRate + flip * c.flickFlip, -c.maxFlipRate, c.maxFlipRate);
  }

  /** In the air the ride keeps turning at its spin and flip rates. The direction controls nudge them; a grab is timed. */
  _rotateInAir(dt, controls) {
    const c = this.config;
    if (controls.grab) {
      this.air.grabs[controls.grab] = (this.air.grabs[controls.grab] ?? 0) + dt;
    } else { // with a grab held, the direction controls pick the grab and do not turn the ride
      this.spinRate = clamp(this.spinRate - controls.steer * c.airSpinAccel * dt, -c.maxSpinRate, c.maxSpinRate);
      this.flipRate = clamp(this.flipRate + (controls.brake - controls.tuck) * c.airFlipAccel * dt, -c.maxFlipRate, c.maxFlipRate);
    }
    this.heading += this.spinRate * dt;
    this.air.spin += this.spinRate * dt;
    this.air.flip += this.flipRate * dt;
    // The gravity load: the greatest height above the snow in this air time. (The metres fallen would not do: on a steep
    // slope the rider falls many metres along the hill in the smallest hop.)
    this.air.load = Math.max(this.air.load, this.pos.y - this.course.heightfield.heightAt(this.pos.x, this.pos.z));
    if (controls.stomp && this.air.stompAt === null) this.air.stompAt = this.airTime; // one press: the first one counts
  }

  /**
   * The ride meets the snow again. A landing is good when the ride is the right way up and points along the way it
   * travels (forward, or backward: "switch"). Too far off either, and the rider goes down.
   */
  _land(speedIntoSnow) {
    const c = this.config;
    this.landingSpeed = speedIntoSnow;
    const upright = shortestTurn(this.air.flip); // how far from the right way up, whole flips taken out
    const offLine = shortestTurn(this.heading - this.travelYaw);
    const backward = Math.abs(offLine) > Math.PI / 2;
    const sideways = backward ? Math.PI - Math.abs(offLine) : Math.abs(offLine);
    const crash = Math.abs(upright) > c.landFlipTolerance || sideways > c.landSpinTolerance;
    this.landed = {
      spin: this.air.spin, flip: this.air.flip, grabs: this.air.grabs, speed: speedIntoSnow, time: this.airTime,
      load: this.air.load,
      stompAge: this.air.stompAt === null ? null : this.airTime - this.air.stompAt,
      uprightShare: Math.min(1, Math.abs(upright) / c.landFlipTolerance),
      sidewaysShare: Math.min(1, sideways / c.landSpinTolerance),
      offLine, switch: backward, crash,
      side: offLine > 0 ? RIGHT_EDGE : LEFT_EDGE, // the ride is turned to the left of its path, so its right side leads
    };
    this.air = { spin: 0, flip: 0, grabs: {}, load: 0, stompAt: null };
    this.spinRate = 0;
    this.flipRate = 0;
  }

  /**
   * Does the snow drop away from the path ahead? It looks where a free flight would be a moment from now: over
   * ripples and gentle rolls the snow is still close under that point, off a lip or a cliff it is far below.
   */
  _snowFallsAway() {
    const c = this.config;
    const time = c.lookAhead;
    const x = this.pos.x + this.vel.x * time;
    const z = this.pos.z + this.vel.z * time;
    const flightHeight = this.pos.y + this.vel.y * time - 0.5 * c.gravity * time * time;
    return flightHeight - this.course.heightfield.heightAt(x, z) > c.snapDistance;
  }

  /** Turn the ride: the player's steering, then the swing toward the way it travels. */
  _steer(dt, controls) {
    const c = this.config;
    const speed = this.speed;
    const turnRate = Math.min(c.maxTurnRate, c.maxLateralAccel / Math.max(speed, c.minTurnSpeed));
    this.heading -= controls.steer * turnRate * dt;
    // Riding backward (switch), the inside of a right turn is the ride's own left side: the edge the steering asks for is mirrored.
    const backward = speed > c.weathervaneMinSpeed && -this.vel.x * Math.sin(this.heading) - this.vel.z * Math.cos(this.heading) < 0;
    this.edgeSteer = backward ? -controls.steer : controls.steer; // above zero asks for the ride's right edge
    if (speed > c.weathervaneMinSpeed) {
      let off = shortestTurn(Math.atan2(-this.vel.x, -this.vel.z) - this.heading);
      if (Math.abs(off) > Math.PI / 2) off = shortestTurn(off + Math.PI); // riding backward (switch): the tail lines up with the path
      this.heading += off * (1 - Math.exp(-c.weathervane * dt)) * (1 - Math.abs(controls.steer));
    }
    this.heading = ((this.heading + Math.PI) % TAU + TAU) % TAU - Math.PI; // keep it in -PI..PI
    this.edge = damp(this.edge, this.edgeSteer * clamp(speed / c.edgeFullSpeed, 0, 1), c.edgeRate, dt);
  }

  /** How far onto an edge the ride must be for that edge to count as set. A slow ride cannot roll far (see _steer), so the mark is lower by the same share. */
  _carveMark() {
    const c = this.config;
    return c.mountainEdgeCarve * clamp(this.speed / c.edgeFullSpeed, 0, 1);
  }

  /** The edge the ride is set on: RIGHT_EDGE, LEFT_EDGE, or 0 when it runs flat. */
  _setEdge() {
    const mark = this._carveMark();
    if (mark === 0 || Math.abs(this.edge) <= mark) return 0;
    return this.edge > 0 ? RIGHT_EDGE : LEFT_EDGE;
  }

  /**
   * How much the ride's right side faces down the hill: the sine of the sideways tilt of the snow under it.
   * Above zero the right side is the downhill side; below zero it is the side toward the mountain.
   */
  _rightDownhill() {
    const normal = this.course.heightfield.facetNormalAt(this.pos.x, this.pos.z, this._normal);
    return Math.cos(this.heading) * normal.x - Math.sin(this.heading) * normal.z; // the level part of the normal points down the hill
  }

  /**
   * Which edge is the ride on? In a carve it is the edge the rider has set. With the ride flat, it is the edge
   * toward the mountain: the uphill side when the ride lies across the slope. Straight down the fall line with
   * the ride flat, neither applies, and the last answer stays.
   */
  _trackMountainEdge() {
    const set = this._setEdge();
    if (set !== 0) {
      this.mountainEdge = set;
      return;
    }
    const rightDownhill = this._rightDownhill();
    if (rightDownhill < -this.config.mountainEdgeSlope) this.mountainEdge = RIGHT_EDGE;
    else if (rightDownhill > this.config.mountainEdgeSlope) this.mountainEdge = LEFT_EDGE;
  }

  /**
   * Three mistakes catch an edge (docs/adr/0010). None of them counts below `catchMinSpeed`.
   *   1. An edge change that is too fast: the player steers from one side straight to the other, with less than
   *      `edgeChangeTime` between them, while the ride is still set on the first edge. The new edge catches at once.
   *   2. The wrong edge for the slope: the ride is set on its downhill edge while it lies across the slope. Every
   *      turn down the hill starts like that, so it counts only while the ride lies well across a steep enough
   *      slope (`wrongEdgeSlope`), and only after a grace time. Then the downhill edge catches. The grace is short
   *      unless the edge before was held well (see _trackEdgeHold).
   *   3. The other edge during a brake: the ride skids with its mountain edge trailing, so the other edge leads.
   *      A load builds while it is down and drains after; at the limit it catches.
   */
  _watchForCatch(dt, controls) {
    const c = this.config;
    const speed = this.speed;
    const fast = speed >= c.catchMinSpeed;

    // 1. Too fast from one edge to the other.
    const steerSide = Math.abs(this.edgeSteer) > c.steerSet ? Math.sign(this.edgeSteer) : 0;
    let changedTooFast = false;
    if (steerSide === 0) {
      this.neutralTime += dt;
    } else {
      const stillOnOldEdge = this._setEdge() === this.steerSide;
      changedTooFast = fast && steerSide === -this.steerSide && this.neutralTime < c.edgeChangeTime && stillOnOldEdge;
      this.steerSide = steerSide;
      this.neutralTime = 0;
    }

    // 2. The downhill edge, across the slope.
    const set = this._setEdge();
    this._trackEdgeHold(dt, set);
    const downhill = set * this._rightDownhill(); // above zero: the edge the ride is set on faces down the hill
    this.wrongEdgeTime = fast && downhill > c.wrongEdgeSlope ? this.wrongEdgeTime + dt : 0;

    // 3. The leading edge during a brake.
    this.catchLoad = Math.max(0, this.catchLoad - c.catchRecover * dt);
    if (fast) this.catchLoad += Math.max(0, -this.mountainEdge * this.edge) * speed * controls.brake * c.skidSlip * dt;

    if (changedTooFast) this.caught = steerSide;
    else if (this.wrongEdgeTime >= this.wrongEdgeGrace) this.caught = set;
    else if (this.catchLoad >= c.catchLimit) this.caught = -this.mountainEdge;
    if (this.caught === 0) return;
    this.catchLoad = 0;
    this.wrongEdgeTime = 0;
  }

  /**
   * A held edge earns grace for the next one. While the ride is set on an edge, the hold time grows. When the ride
   * takes the other edge, the hold of the old edge sets how long the new edge may be the wrong edge for the slope:
   * the base grace after a short hold, up to the base plus the full bonus after a long one. Time spent flat between
   * the edges runs the hold down again, so a change must also be prompt. A smooth, committed turn is rewarded;
   * a rushed or hesitant one gets only the base grace.
   */
  _trackEdgeHold(dt, set) {
    const c = this.config;
    if (set === 0) {
      this.edgeHeld = Math.max(0, this.edgeHeld - dt);
    } else if (set === this.heldEdge) {
      this.edgeHeld = Math.min(c.edgeHoldFull, this.edgeHeld + dt);
    } else {
      this.wrongEdgeGrace = c.wrongEdgeGrace + c.wrongEdgeBonus * this.holdShare;
      this.heldEdge = set;
      this.edgeHeld = 0;
    }
  }

  /** How much of the grace bonus the hold of the current edge has earned: 0 (none yet) .. 1 (all of it). */
  get holdShare() {
    const c = this.config;
    return clamp((this.edgeHeld - c.edgeHoldMin) / (c.edgeHoldFull - c.edgeHoldMin), 0, 1);
  }

  /** How close an edge is to catching: 0 (safe) .. 1 (it catches). */
  get catchShare() {
    return Math.min(1, Math.max(this.catchLoad / this.config.catchLimit, this.wrongEdgeTime / this.wrongEdgeGrace));
  }

  /** The forces of the snow: slide along the ride, grip across it, friction, drag, a push, the brake. */
  _slide(dt, controls) {
    const c = this.config;
    const normal = this.course.heightfield.facetNormalAt(this.pos.x, this.pos.z, this._normal);
    const forward = this._forward.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    forward.addScaledVector(normal, -forward.dot(normal)).normalize(); // the way the ride points, laid on the slope

    const intoSnow = this.vel.dot(normal);
    let along = this.vel.dot(forward);
    // A ride at rest stays put until you push: on gentle ground, and on any slope when it lies across it (the edges hold).
    if (this.speed < c.stillSpeed && controls.tuck === 0 && Math.abs(along) <= c.stillFriction * c.gravity * normal.y * dt) {
      this.vel.set(0, 0, 0);
      return;
    }
    const side = this._side.copy(this.vel).addScaledVector(normal, -intoSnow).addScaledVector(forward, -along);
    side.multiplyScalar(Math.exp(-c.grip * dt)); // the edges hold: sideways speed dies fast

    const hold = (c.friction * c.gravity * normal.y + controls.brake * c.brakeDecel) * dt;
    along = Math.abs(along) <= hold ? 0 : along - Math.sign(along) * hold;
    if (controls.tuck > 0 && along < c.pushSpeed) along = Math.min(c.pushSpeed, along + c.pushAccel * controls.tuck * dt);

    const dragCoefficient = c.drag + (c.tuckDrag - c.drag) * controls.tuck;
    const keep = Math.max(0, 1 - dragCoefficient * Math.hypot(along, side.length()) * dt);
    this.vel.copy(forward).multiplyScalar(along * keep).addScaledVector(side, keep); // the snow carries the weight: nothing is left across the slope
    if (this.vel.length() > c.maxSpeed) this.vel.setLength(c.maxSpeed);
  }

  /** Trees and rocks: the rider is pushed out of them and loses most of the speed into them. */
  _hitObstacles() {
    const c = this.config;
    for (const obstacle of this.course.obstacles) {
      const dx = this.pos.x - obstacle.x;
      const dz = this.pos.z - obstacle.z;
      const reach = obstacle.radius + c.bodyRadius;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= reach * reach || this.pos.y > obstacle.y + obstacle.height) continue;
      const distance = Math.sqrt(distanceSquared);
      const outX = distance > 0 ? dx / distance : Math.sin(this.heading); // dead centre: back the way the ride came
      const outZ = distance > 0 ? dz / distance : Math.cos(this.heading);
      this.pos.x = obstacle.x + outX * reach;
      this.pos.z = obstacle.z + outZ * reach;
      const into = -(this.vel.x * outX + this.vel.z * outZ);
      if (into <= 0) continue;
      this.vel.x += outX * into * (1 + c.bonkBounce);
      this.vel.z += outZ * into * (1 + c.bonkBounce);
      this.vel.multiplyScalar(c.bonkKeep);
      this.bonk = Math.max(this.bonk, into);
    }
  }

  /** The course has edges: the rider stops against them. */
  _stayOnCourse() {
    const field = this.course.heightfield;
    const margin = this.config.edgeMargin;
    const x = clamp(this.pos.x, field.minX + margin, field.maxX - margin);
    const z = clamp(this.pos.z, field.minZ + margin, field.maxZ - margin);
    if (x !== this.pos.x) this.vel.x = 0;
    if (z !== this.pos.z) this.vel.z = 0;
    this.pos.x = x;
    this.pos.z = z;
  }

  /** The ride's frame from its up and its heading: +X to its right, +Y up, -Z the way it points. */
  _orient() {
    const back = this._back.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    back.addScaledVector(this.up, -back.dot(this.up)).normalize();
    const right = this._right.crossVectors(this.up, back);
    this.orientation.setFromRotationMatrix(this._basis.makeBasis(right, this.up, back));
    if (this.air.flip !== 0) this.orientation.multiply(this._flipTurn.setFromAxisAngle(X_AXIS, this.air.flip)); // a flip turns about the ride's own side-to-side axis
  }
}
