import * as THREE from 'three';
import { clamp, damp, lerp } from '../../core/client/engine/math.js';
import { DampedSpring } from '../../core/client/engine/spring.js';

/*
 * POSE SOLVER: the rider's body, computed every frame from what the rider is doing. There are no
 * animation clips (see docs/adr/0007). The result is a pose in the ride's frame ("rig space": metres,
 * -Z the way the ride points, +X its right, +Y its up, the snow at y = 0) that the body model takes
 * through YBotSkin.driveBones(), plus where the ride itself sits.
 *
 * Layers, in order:
 *   1. stance      feet on the ride, hips down and torso forward: more of both in a tuck, legs longer in the air
 *   2. carve lean  the ride rolls onto its edge and the body leans into the turn; the chest stays more upright.
 *                  A brake swings the ride across the slope onto its mountain edge (toeside or heelside on a board)
 *   5. sway        springs let the chest and hands lag behind a change of speed or direction, then catch up
 *   6. feet        ankles and knees follow the rolled ride, so the feet stay flat on it
 *   3. tricks      (applied with layers 1 and 2) a pop charge sinks the body; a spin, a flip or a grab pulls the ride
 *                  up under it; the chest and head lead a spin; a grab takes one hand to a point of the ride
 *   4. landing     (also with layers 1 and 2) the knees and hips fold by how hard the rider came down, then come back up
 *
 * All the numbers are in CONFIG.ski.pose. A turn to the right is a positive `edge`.
 */

const SIDES = ['Left', 'Right'];
const SIDE_SIGN = { Left: -1, Right: 1 };
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const FORWARD = new THREE.Vector3(0, 0, -1);

const scratch = { x: new THREE.Quaternion(), y: new THREE.Quaternion(), z: new THREE.Quaternion() };

/** A turn in rig space: pitch about X first (in the body's own frame), then yaw about Y, then roll about Z. */
function turn(out, roll, yaw, pitch) {
  scratch.x.setFromAxisAngle(X, pitch);
  scratch.y.setFromAxisAngle(Y, yaw);
  return out.setFromAxisAngle(Z, roll).multiply(scratch.y).multiply(scratch.x);
}

const makeFoot = () => ({ ankle: new THREE.Vector3(), turn: new THREE.Quaternion(), knee: new THREE.Vector3(), sole: new THREE.Vector3(), yaw: 0 });
const makeHand = () => ({ wrist: new THREE.Vector3(), roll: 0 });

export class PoseSolver {
  /** @param deps { config (CONFIG.ski.pose), ride ('skis' or 'board') } */
  constructor({ config, ride }) {
    this.config = config;
    this.ride = ride;
    this.stance = config[ride];
    const { frequency, damping } = config.sway;
    this.swaySide = new DampedSpring(frequency, damping);
    this.swayFore = new DampedSpring(frequency, damping);
    this.fold = new DampedSpring(config.landing.frequency, config.landing.damping); // 4. how far a landing has folded the body: 0 .. about 1
    this.pose = {
      ride: { roll: 0, yaw: 0, lift: 0, turn: new THREE.Quaternion() }, // rolled onto its edge, swung across the slope, its middle lifted off the snow; `turn` is roll and yaw together
      hips: { offset: new THREE.Vector3(), turn: new THREE.Quaternion() },
      chest: new THREE.Quaternion(),
      head: new THREE.Quaternion(),
      feet: { Left: makeFoot(), Right: makeFoot() }, // `sole` is where the foot stands on the ride; `yaw` is the way its toes point
      hands: { Left: makeHand(), Right: makeHand() },
    };
    this._point = new THREE.Vector3();
    this._toes = new THREE.Quaternion();
    this.reset();
  }

  /** Stand in the neutral stance, with nothing swaying. */
  reset() {
    this.tuck = 0;
    this.brake = 0;
    this.skid = 0; // the brake with the side of its edge: -1 a full brake on the left edge .. +1 on the right edge
    this.air = 0;
    this.charge = 0; // the pop, as the body shows it
    this.trickTuck = 0; // 0..1: how far the ride is pulled up under the body
    this.twist = 0; // -1..1: how far the upper body leads a spin (above zero: to the left)
    this.grabReach = 0; // 0..1: how far the grabbing hand has gone to the ride
    this.grab = null; // the grab the hand is going to, or coming back from
    this.swaySide.reset();
    this.swayFore.reset();
    this.fold.reset();
  }

  /** A landing: the body folds by how hard it was (`share`, 0..1 of what it can take) and then comes back up. */
  land(share) {
    this.fold.velocity += clamp(share, 0, 1) * this.config.landing.kick;
  }

  /**
   * One rendered frame.
   * @param input { edge (-1..1), tuck (0..1), brake (0..1), mountainEdge (-1 left or +1 right: the edge a brake uses),
   *   grounded, accelSide, accelFore (m/s^2 in rig space: +X and -Z),
   *   popCharge (0..1), spinRate, flipRate (radians per second in the air), grab (a grab id or null) }
   * @param anatomy the body's measurements (YBotSkin.anatomy())
   * @returns the pose (the same object every call)
   */
  update(dt, input, anatomy) {
    const c = this.config;
    const s = this.stance;
    const { pose } = this;
    this.tuck = damp(this.tuck, input.tuck, c.blendRate, dt);
    this.brake = damp(this.brake, input.brake, c.blendRate, dt);
    this.air = damp(this.air, input.grounded ? 0 : 1, c.blendRate, dt);
    const { tuck, brake, air } = this;

    // 3. Tricks: a pop charge sinks the body; a spin, a flip or a grab pulls the ride up under it; a spin is led by the upper body.
    const t = c.trick;
    this.charge = damp(this.charge, input.popCharge, c.blendRate * 2, dt);
    const turning = Math.abs(input.spinRate) / t.tuckSpin + Math.abs(input.flipRate) / t.tuckFlip;
    this.trickTuck = damp(this.trickTuck, input.grounded ? 0 : clamp(input.grab ? 1 : turning, 0, 1), c.blendRate, dt);
    this.twist = damp(this.twist, input.grounded ? 0 : clamp(input.spinRate / t.maxSpin, -1, 1), c.blendRate, dt);
    if (input.grab) this.grab = input.grab;
    this.grabReach = damp(this.grabReach, input.grab && !input.grounded ? 1 : 0, t.grabRate, dt);
    const fold = clamp(this.fold.step(0, dt), 0, 1); // 4. the landing
    const tuckLift = this.trickTuck * t.tuckLift + this.grabReach * t.grabLift; // a grab brings the ride further up, into reach of the hand

    // 5. Sway: the body is thrown against a change of velocity, and the springs bring it back.
    const swaySide = this.swaySide.step(clamp(input.accelSide * c.sway.perAccel, -c.sway.max, c.sway.max), dt); // pushed to the right, the body tips left (a positive roll)
    const swayFore = this.swayFore.step(clamp(input.accelFore * c.sway.perAccel, -c.sway.max, c.sway.max), dt);

    // 2. Carve lean. A positive roll about Z tips the top of the body to the left, so a right turn is a negative roll.
    // A brake swings the ride across the slope and digs in the mountain edge: toward the right for the right edge.
    const skid = this.skid = damp(this.skid, input.brake * input.mountainEdge, c.blendRate, dt);
    const rideRoll = clamp(-input.edge * c.maxEdge - skid * s.brakeEdge, -c.maxEdge, c.maxEdge);
    const bodyRoll = rideRoll * c.inclineShare;
    const rideYaw = -skid * s.skidYaw; // a turn to the right is a negative yaw
    pose.ride.roll = rideRoll;
    pose.ride.yaw = rideYaw;
    pose.ride.lift = Math.abs(Math.sin(rideRoll)) * s.rideHalfWidth + tuckLift; // the edge stays on the snow, so the middle rises; a tuck pulls the whole ride up
    const rideTurn = pose.ride.turn.setFromAxisAngle(Y, rideYaw).multiply(scratch.z.setFromAxisAngle(Z, rideRoll));

    // 1. Stance: how low the hips are and how far the torso folds forward.
    const hipDrop = lerp(s.hipDrop, s.tuckHipDrop, tuck) + brake * s.brakeHipDrop + this.charge * c.popCrouch + fold * c.landing.crouch - air * (1 - this.trickTuck) * c.airExtend;
    const lean = lerp(s.lean, s.tuckLean, tuck) - brake * s.brakeLeanBack + this.grabReach * t.grabLean + fold * c.landing.lean; // a grab folds the body down to the ride; a landing folds it too
    const hips = this._point.set(0, anatomy.hipsHeight - hipDrop, s.hipBack * lean);
    hips.applyAxisAngle(Z, bodyRoll).applyAxisAngle(Y, rideYaw);
    hips.y += pose.ride.lift - tuckLift; // the tuck brings the ride to the body, not the body up
    pose.hips.offset.set(hips.x, hips.y - anatomy.hipsHeight, hips.z);
    const bodyYaw = rideYaw + s.bodyYaw;
    turn(pose.hips.turn, bodyRoll, bodyYaw, -lean * c.hipsLeanShare);
    turn(pose.chest, bodyRoll * (1 - c.angulation) + swaySide, rideYaw * c.skidChestShare + s.chestYaw + this.twist * t.spinTwist, -lean + swayFore);
    turn(pose.head, bodyRoll * (1 - c.headLevel), -input.edge * c.headIntoTurn + this.twist * t.headTwist, -lean * c.headLeanShare);

    // 6. Feet: flat on the rolled ride, knees over the toes and driven into the turn.
    for (const side of SIDES) {
      const sign = SIDE_SIGN[side];
      const foot = pose.feet[side];
      const place = s.feet[side];
      const tipLead = -sign * input.edge * s.tipLead; // the inside ski runs ahead
      foot.yaw = rideYaw + place.yaw;
      foot.sole.set(place.x, 0, place.z + tipLead).applyQuaternion(rideTurn);
      foot.sole.y += pose.ride.lift;
      foot.ankle.set(0, anatomy.ankleHeight, 0).applyQuaternion(rideTurn).add(foot.sole);
      foot.turn.copy(rideTurn).multiply(this._toes.setFromAxisAngle(Y, foot.yaw - rideYaw));
      foot.knee.copy(FORWARD).applyAxisAngle(Y, foot.yaw + sign * s.kneeSplay);
      foot.knee.x += input.edge * c.kneeIntoTurn;
    }

    // Hands: held where the stance wants them, in the chest's frame, and thrown about a little by the sway.
    for (const side of SIDES) {
      const sign = SIDE_SIGN[side];
      const hand = pose.hands[side];
      const rest = s.hands[side];
      const tucked = s.tuckHands[side];
      hand.wrist.set(lerp(rest.x, tucked.x, tuck), lerp(rest.y, tucked.y, tuck) + air * c.airArmLift, lerp(rest.z, tucked.z, tuck));
      hand.wrist.x += sign * air * c.airArmSpread;
      hand.wrist.applyQuaternion(pose.chest).add(hips);
      hand.wrist.x -= swaySide * c.sway.handShare;
      hand.wrist.z += swayFore * c.sway.handShare;
      hand.roll = s.palmRoll;
    }
    // A grab: one hand leaves its place and takes a point of the ride.
    const grab = this.grab && s.grabs[this.grab];
    if (grab && this.grabReach > 0.001) {
      const point = this._point.set(grab.point.x, grab.point.y, grab.point.z).applyQuaternion(rideTurn);
      point.y += pose.ride.lift;
      pose.hands[grab.hand].wrist.lerp(point, this.grabReach);
    }
    return pose;
  }
}
