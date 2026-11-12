import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { HUMANOID_MATERIALS } from './humanoid.js';

/*
 * The human: the Mixamo "Y Bot" model, dressed in the game's own original-Xbox materials
 * (Phong lighting, one small highlight, small procedural textures) in the same grey as the
 * placeholder humanoid.
 *
 * The game poses a procedural rig (BodyRig: hips, torso, head, arm and leg pivots), not a
 * skeleton with animation clips. A YBotSkin sits on such a rig and every frame copies its
 * pose onto the Y Bot's bones: the spine and neck share the torso and head turn, the arms
 * point where the rig's arms point (with a bent elbow), and the feet are kept on the ground.
 * Given the player's motion it also walks its own gait: a run cycle with knees that fold,
 * a slide with one leg out and one tucked, a crouch and a jump tuck. For a held weapon the
 * arm is solved with two-bone IK (`reach`) so both hands meet the grips with the elbows out.
 * Until the file has loaded (or if it cannot load) the rig's own plain look stays visible.
 * The hands can close into a grip or a fist (`setGrip`), and a skin can be made of the arms alone
 * (`armsOnly`) for the first-person view, where only the arms are ever on screen.
 *
 * The file is in centimetres and faces +Z; it is turned to face -Z like the rig. All
 * rotations below are in "rig space": relative to the rig's root group, where a positive turn
 * about X swings a hanging limb forward (-Z).
 */

export const Y_BOT_URL = new URL('./y-bot.fbx', import.meta.url).href;

// 1.8 m tall as authored. 0.92 puts its shoulders at the rig's shoulder height and its arms at the rig's arm length,
// so a weapon held at the rig's hand is held at the Y Bot's.
const FIT = 0.92;
const CENTIMETRES = 0.01;
const SPINE_SHARE = [1 / 3, 2 / 3, 1]; // how much of the torso lean each spine bone takes
const NECK_SHARE = 0.5;
const KNEE_BEND_FORWARD = 0.9; // radians of knee bend per radian a thigh swings forward (rig-driven legs)
const KNEE_BEND_BACK = 0.5; // ... and per radian it swings back
const MAX_KNEE_BEND = 1.3;

// The gait, in radians. Thigh angles are forward-positive; a knee value is how far the shin folds back.
const GAIT = {
  strideSwing: 0.62, // thigh swing at a full run (the rig swings 0.75)
  sprintSwing: 0.2, // extra swing while sprinting
  idleKnee: 0.12, // a standing knee is almost straight
  kneeBase: 0.25, // extra knee fold at the top of the swing, when walking
  kneePerRun: 1.25, // ... and how much more at a full run
  hipTwist: 0.1, // the pelvis turns this much against the shoulders
  slide: { tucked: [0.95, 2.5, 0.6], lead: [1.25, 0.1, -0.15] }, // [thigh, knee, foot]: one knee folded under, one leg out front, toes up
  crouch: { thigh: 1.0, knee: 1.95, stride: 0.3 },
  rising: { lead: [0.85, 1.35], trail: [0.2, 0.5] }, // jump: one knee up
  falling: { lead: [0.5, 0.6], trail: [0.05, 0.35] }, // falling: legs reaching for the ground
  footFromKnee: 0.35, // toes hang down as the shin folds
  footFromBack: 0.7, // and as the thigh swings back (the heel lifts)
  maxFoot: 0.9,
};
const ELBOW = { rest: 0.15, perRun: 0.95, sprint: 0.3, slide: 0.5, air: 0.7, crouch: 0.3 }; // unarmed arm flexion
const ELBOW_HINT = { out: 0.45, back: 0.15 };
const ARM_STRETCH = 1.2; // the Y Bot's arms are short for a two-handed grip; they are drawn this much longer (the hands keep their size)
const FINGER_CURL = [1.4, 1.6, 1.1]; // radians a finger's three joints close at a full fist
const THUMB_CURL = [0.5, 0.6, 0.5];
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb'];
const RELAXED_GRIP = 0.25; // an idle hand is slightly curled, not flat
const ARM_BONES = /(Arm|Hand)/; // the arms and hands, not the shoulders or anything else // where a held arm's elbow wants to point: out, down and a little back

const BONE_PREFIX = 'mixamorig';
const SIDES = ['Left', 'Right'];
const SOLE_BONES = ['Foot', 'ToeBase', 'Toe_End'];
const DOWN = new THREE.Vector3(0, -1, 0);
const RIG_X = new THREE.Vector3(1, 0, 0);
const RIG_Y = new THREE.Vector3(0, 1, 0);
const RIG_Z = new THREE.Vector3(0, 0, 1);

/** Resolve to the loaded model, or null if it cannot load (the plain rig look stays). Loaded once. */
let templatePromise = null;
export function loadYBot(url = Y_BOT_URL) {
  templatePromise ??= new FBXLoader().loadAsync(url).then(styleModel).catch((error) => {
    if (import.meta.url.startsWith('http')) console.warn(`Y Bot could not load, using the plain humanoid: ${error.message}`); // quiet where there is no server (tests)
    return null;
  });
  return templatePromise;
}

/** Use an already built model instead of loading the file (tests, or a game that loads it in its own way). */
export function preloadYBot(model) {
  templatePromise = Promise.resolve(model);
}

/** Build the model from the bytes of the file (used where the file is read from disk). */
export function parseYBot(arrayBuffer) {
  return styleModel(new FBXLoader().parse(arrayBuffer, ''));
}

/** Swap the file's blue materials for the game's grey Xbox ones. The body is the skin, the joints the dark grey. */
function styleModel(model) {
  model.traverse((node) => {
    if (!node.isSkinnedMesh) return;
    const joints = node.name.toLowerCase().includes('joint');
    node.material.dispose?.();
    node.material = joints ? HUMANOID_MATERIALS.dark : HUMANOID_MATERIALS.skin;
    node.frustumCulled = false; // the bounds come from the T-pose, not from where the bones are now
  });
  return model;
}

const boneName = (name) => `${BONE_PREFIX}${name}`;

export class YBotSkin {
  /**
   * @param {import('./body-rig.js').BodyRig} body the rig to follow
   * @param {{ load?: () => Promise<THREE.Object3D | null>, armsOnly?: boolean, onReady?: () => void }} [options]
   *   `load` replaces the file loader (tests); `armsOnly` draws just the arms and hands; `onReady` runs once the model is built
   */
  constructor(body, { load = loadYBot, armsOnly = false, onReady = null } = {}) {
    this.body = body;
    this.armsOnly = armsOnly;
    this.onReady = onReady;
    this.grip = RELAXED_GRIP; // how closed the hands are: 0 flat .. 1 fist
    this.ready = false;
    this.active = true; // show the Y Bot (true) or the rig's own look (false)
    this.rootInverse = new THREE.Matrix4();
    this.scratch = { position: new THREE.Vector3(), scale: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    load().then((template) => { if (template) this._build(template); });
  }

  _build(template) {
    this.model = cloneSkinned(template);
    this.wrapper = new THREE.Group(); // turns the model to face -Z and scales it to metres
    this.wrapper.rotation.y = Math.PI;
    this.wrapper.scale.setScalar(CENTIMETRES * FIT);
    if (this.armsOnly) this.model.traverse((node) => { if (node.isSkinnedMesh) node.geometry = armTriangles(node); });
    this.wrapper.add(this.model);
    this.body.root.add(this.wrapper);

    this.bones = new Map();
    // The loader makes two bones per joint: an outer one that holds the transform and carries the child joints, and an
    // inner twin with the same name that the skin binds to. The outer one drives both, so keep the first of each name.
    this.model.traverse((node) => { if (node.isBone && !this.bones.has(node.name)) this.bones.set(node.name, node); });
    this.body.root.updateWorldMatrix(true, true);
    this.rootInverse.copy(this.body.root.matrixWorld).invert();
    this.rest = new Map();
    for (const [name, bone] of this.bones) this.rest.set(name, { quaternion: this._rigQuaternion(bone), position: this._rigPosition(bone) });
    this.hipsRest = this.bones.get(boneName('Hips')).position.clone();
    this.restSoleHeight = this._lowestSole();
    this.armLengths = Object.fromEntries(SIDES.map((side) => [side, {
      upper: this._boneLength(`${side}Arm`, `${side}ForeArm`),
      fore: this._boneLength(`${side}ForeArm`, `${side}Hand`),
    }]));
    this._findFingers();
    this._stretchArms();
    this.ready = true;
    this.setActive(this.active);
    this._applyGrip();
    this.sync();
    this.onReady?.();
  }

  /** Every finger joint, with the axis it closes about (in its own frame) so a hand can make a fist. */
  _findFingers() {
    this.fingers = [];
    for (const side of SIDES) {
      const around = RIG_Z.clone().multiplyScalar(side === 'Right' ? -1 : 1); // fingers close toward the palm, which faces down at rest
      for (const finger of FINGERS) {
        for (let joint = 1; joint <= 3; joint++) {
          const name = boneName(`${side}Hand${finger}${joint}`);
          const bone = this.bones.get(name);
          if (!bone) continue;
          const axis = around.clone().applyQuaternion(this.rest.get(name).quaternion.clone().invert());
          const curl = (finger === 'Thumb' ? THUMB_CURL : FINGER_CURL)[joint - 1];
          this.fingers.push({ side, bone, restQuaternion: bone.quaternion.clone(), axis, curl });
        }
      }
    }
  }

  /** Draw the arms longer, and give the hands back their own size. */
  _stretchArms() {
    for (const side of SIDES) {
      this.bones.get(boneName(`${side}Arm`)).scale.setScalar(ARM_STRETCH);
      this.bones.get(boneName(`${side}Hand`)).scale.setScalar(1 / ARM_STRETCH);
      this.armLengths[side].upper *= ARM_STRETCH;
      this.armLengths[side].fore *= ARM_STRETCH;
    }
  }

  /** Close the hands: 0 is flat, 1 a fist. */
  setGrip(amount) {
    if (amount === this.grip) return;
    this.grip = amount;
    if (this.ready) this._applyGrip();
  }

  _applyGrip() {
    const turn = new THREE.Quaternion();
    for (const { bone, restQuaternion, axis, curl } of this.fingers) {
      bone.quaternion.copy(restQuaternion).multiply(turn.setFromAxisAngle(axis, curl * this.grip));
    }
    for (const side of SIDES) this.bones.get(boneName(`${side}Hand`)).updateMatrixWorld(true);
  }

  /** Show the Y Bot (true), or hide it and show the rig's own look (false: the mech suit is on). */
  setActive(active) {
    this.active = active;
    if (this.wrapper) this.wrapper.visible = active;
    if (this.ready) for (const mount of this.body.lookMounts()) mount.visible = !active;
  }

  /* ---------------------------- rig-space helpers --------------------------- */

  _rigMatrix(object) {
    return new THREE.Matrix4().multiplyMatrices(this.rootInverse, object.matrixWorld);
  }

  _rigQuaternion(object) {
    this._rigMatrix(object).decompose(this.scratch.position, this.scratch.quaternion, this.scratch.scale);
    return this.scratch.quaternion.clone();
  }

  _rigPosition(object) {
    this._rigMatrix(object).decompose(this.scratch.position, this.scratch.quaternion, this.scratch.scale);
    return this.scratch.position.clone();
  }

  _boneLength(name, childName) {
    return this.rest.get(boneName(childName)).position.distanceTo(this.rest.get(boneName(name)).position);
  }

  /** The direction a bone points at rest: toward its (first) child bone. */
  _restDirection(name, childName) {
    return this.rest.get(boneName(childName)).position.clone().sub(this.rest.get(boneName(name)).position).normalize();
  }

  /** Set a bone so that its rotation in rig space is `target`. Parents must already be set. */
  _setRigQuaternion(bone, target) {
    bone.parent.updateWorldMatrix(true, false);
    const parent = this._rigQuaternion(bone.parent);
    bone.quaternion.copy(parent.invert()).multiply(target);
    bone.updateMatrixWorld(true);
  }

  /**
   * Point a bone along `direction`: its rest rotation, turned by the smallest turn from its rest direction,
   * then rolled about that direction by `roll` radians (turning a palm inward, for example).
   */
  _aim(name, childName, direction, roll = 0) {
    const bone = this.bones.get(boneName(name));
    const turn = new THREE.Quaternion().setFromUnitVectors(this._restDirection(name, childName), direction);
    if (roll) turn.premultiply(new THREE.Quaternion().setFromAxisAngle(direction, roll));
    this._setRigQuaternion(bone, turn.multiply(this.rest.get(boneName(name)).quaternion));
  }

  /** Turn a bone by `delta` (a rig-space rotation) from its rest. */
  _turn(name, delta) {
    this._setRigQuaternion(this.bones.get(boneName(name)), delta.clone().multiply(this.rest.get(boneName(name)).quaternion));
  }

  /** A rig object's rotation in rig space. */
  _driverQuaternion(object) {
    return this._rigQuaternion(object);
  }

  _lowestSole() {
    let lowest = Infinity;
    for (const side of SIDES) {
      for (const sole of SOLE_BONES) lowest = Math.min(lowest, this._rigPosition(this.bones.get(boneName(`${side}${sole}`))).y);
    }
    return lowest;
  }

  /* -------------------------------- posing ---------------------------------- */

  /**
   * Copy the rig's pose onto the Y Bot. Call after the rig has been posed for this frame.
   * `motion` ({ phase, run, stride, grounded, sliding, crouching, sprinting, falling }) switches the legs and
   * arms from "copy the rig" to the gait: a run cycle, a slide, a crouch, a jump tuck.
   */
  sync(motion = null) {
    if (!this.ready || !this.active) return;
    const body = this.body;
    body.root.updateWorldMatrix(true, true);
    this.rootInverse.copy(body.root.matrixWorld).invert();

    const hips = this.bones.get(boneName('Hips'));
    hips.position.copy(this.hipsRest);
    hips.updateMatrixWorld(true);
    const twist = new THREE.Quaternion().setFromAxisAngle(RIG_Y, motion ? hipTwist(motion) : 0);
    const hipsTurn = this._driverQuaternion(body.hips).multiply(twist);
    const torsoTurn = this._driverQuaternion(body.torso);
    const headTurn = this._driverQuaternion(body.head);

    this._turn('Hips', hipsTurn);
    ['Spine', 'Spine1', 'Spine2'].forEach((name, i) => this._turn(name, hipsTurn.clone().slerp(torsoTurn, SPINE_SHARE[i])));
    this._turn('Neck', torsoTurn.clone().slerp(headTurn, NECK_SHARE));
    this._turn('Head', headTurn);

    const legs = motion ? gaitLegs(motion) : null;
    for (const [i, side] of SIDES.entries()) {
      this._poseArm(side, body.arms[i].pivot, armFlex(motion));
      this._poseLeg(side, legs ? legs[i] : this._rigLeg(body.legs[i].pivot));
    }
    this._keepFeetOnTheGround(hips);
  }

  /** An arm hanging from the rig's arm pivot, with the elbow bent by `flex` (forward). */
  _poseArm(side, pivot, flex) {
    const upper = DOWN.clone().applyQuaternion(this._driverQuaternion(pivot));
    const fore = upper.clone().applyAxisAngle(RIG_X, flex);
    this._aim(`${side}Arm`, `${side}ForeArm`, upper);
    this._aim(`${side}ForeArm`, `${side}Hand`, fore);
    this._aim(`${side}Hand`, `${side}HandMiddle1`, fore);
  }

  /** What a rig leg is doing, as a thigh direction and a knee bend that follows from it. */
  _rigLeg(pivot) {
    const thigh = DOWN.clone().applyQuaternion(this._driverQuaternion(pivot));
    const forward = Math.asin(THREE.MathUtils.clamp(-thigh.z, -1, 1)); // rig space faces -Z
    const knee = Math.min(MAX_KNEE_BEND, forward > 0 ? forward * KNEE_BEND_FORWARD : -forward * KNEE_BEND_BACK);
    return { thigh, knee, foot: 0 };
  }

  _poseLeg(side, { thigh, knee, foot }) {
    this._aim(`${side}UpLeg`, `${side}Leg`, thigh);
    this._aim(`${side}Leg`, `${side}Foot`, thigh.clone().applyAxisAngle(RIG_X, -knee));
    this._turn(`${side}Foot`, new THREE.Quaternion().setFromAxisAngle(RIG_X, -foot)); // flat, or toes down by `foot`
  }

  /**
   * Put the hand of one arm on a world position (a weapon grip), with two-bone IK: the elbow bends out and down.
   * A target further than the arm can reach is reached as far as it goes. `roll` turns the palm inward (radians).
   * Call after `sync`.
   */
  reach(side, worldTarget, { roll = 0 } = {}) {
    if (!this.ready || !this.active) return;
    this.body.root.updateWorldMatrix(true, true); // the rig may have moved since `sync`
    this.rootInverse.copy(this.body.root.matrixWorld).invert();
    const { upper, fore } = this.armLengths[side];
    const shoulder = this._rigPosition(this.bones.get(boneName(`${side}Arm`)));
    const toTarget = worldTarget.clone().applyMatrix4(this.rootInverse).sub(shoulder);
    const distance = THREE.MathUtils.clamp(toTarget.length(), Math.abs(upper - fore) + 0.02, upper + fore - 0.001);
    const along = toTarget.normalize();

    const outward = side === 'Right' ? 1 : -1;
    const hint = new THREE.Vector3(outward * ELBOW_HINT.out, -1, ELBOW_HINT.back);
    const pole = hint.addScaledVector(along, -hint.dot(along));
    if (pole.lengthSq() < 1e-6) pole.set(outward, 0, 0);
    pole.normalize();

    const alongElbow = (upper * upper - fore * fore + distance * distance) / (2 * distance);
    const outFromLine = Math.sqrt(Math.max(0, upper * upper - alongElbow * alongElbow));
    const elbow = shoulder.clone().addScaledVector(along, alongElbow).addScaledVector(pole, outFromLine);
    const wrist = shoulder.clone().addScaledVector(along, distance);
    const upperDirection = elbow.clone().sub(shoulder).normalize();
    const foreDirection = wrist.sub(elbow).normalize();
    const palmIn = (side === 'Right' ? 1 : -1) * roll; // a positive roll turns either palm toward the body
    this._aim(`${side}Arm`, `${side}ForeArm`, upperDirection);
    this._aim(`${side}ForeArm`, `${side}Hand`, foreDirection, palmIn);
    this._aim(`${side}Hand`, `${side}HandMiddle1`, foreDirection, palmIn);
  }

  /** Where a shoulder joint sits at rest, in rig space. */
  restShoulder(side) {
    return this.rest.get(boneName(`${side}Arm`)).position.clone();
  }

  /** The world position of a shoulder joint. */
  shoulderWorld(side, out) {
    return this.bones.get(boneName(`${side}Arm`)).getWorldPosition(out);
  }

  /** How far a hand can be from its shoulder with the arm straight, in metres. */
  armReach(side) {
    const { upper, fore } = this.armLengths[side];
    return upper + fore;
  }

  /** The world position of a wrist, to hang a held item on. */
  wristWorld(side, out) {
    return this.bones.get(boneName(`${side}Hand`)).getWorldPosition(out);
  }

  /** The legs set how high the hips are: drop them so the lowest foot rests exactly on the rig's ground. */
  _keepFeetOnTheGround(hips) {
    const drop = this._lowestSole() - this.restSoleHeight;
    hips.position.y -= drop / (CENTIMETRES * FIT);
    hips.updateMatrixWorld(true);
  }
}

/* ------------------------------ the gait --------------------------------- */

const clamp01 = (x) => THREE.MathUtils.clamp(x, 0, 1);
const thighVector = (angle) => DOWN.clone().applyAxisAngle(RIG_X, angle);
const legPose = (thigh, knee, foot = 0) => ({ thigh: thighVector(thigh), knee, foot });
const footFor = (thigh, knee) => Math.min(GAIT.maxFoot, knee * GAIT.footFromKnee + Math.max(0, -thigh) * GAIT.footFromBack);

/** How far the pelvis turns against the shoulders: the leg that is forward brings its hip forward. */
function hipTwist({ phase, run, stride, grounded, sliding }) {
  return grounded && !sliding ? -GAIT.hipTwist * Math.sin(phase) * clamp01(run) * stride : 0;
}

/** How much the elbows bend when the arms are not holding anything: more when running. */
function armFlex(motion) {
  if (!motion) return ELBOW.rest;
  if (motion.sliding) return ELBOW.slide;
  if (!motion.grounded) return ELBOW.air;
  if (motion.crouching) return ELBOW.crouch;
  const running = clamp01(motion.run) * motion.stride;
  return ELBOW.rest + (ELBOW.perRun + (motion.sprinting ? ELBOW.sprint : 0)) * running;
}

/** The two legs [left, right] for the player's motion. */
function gaitLegs(motion) {
  const { phase, run, stride, grounded, sliding, crouching, sprinting, falling } = motion;
  if (sliding) {
    const [tuckedThigh, tuckedKnee, tuckedFoot] = GAIT.slide.tucked;
    const [leadThigh, leadKnee, leadFoot] = GAIT.slide.lead;
    return [legPose(tuckedThigh, tuckedKnee, tuckedFoot), legPose(leadThigh, leadKnee, leadFoot)];
  }
  if (!grounded) {
    const { lead, trail } = falling ? GAIT.falling : GAIT.rising;
    return [legPose(lead[0], lead[1], footFor(lead[0], lead[1])), legPose(trail[0], trail[1], footFor(trail[0], trail[1]))];
  }
  const running = clamp01(run);
  if (crouching) {
    const sway = Math.sin(phase) * GAIT.crouch.stride * running * stride;
    return [-sway, sway].map((offset) => legPose(GAIT.crouch.thigh + offset, GAIT.crouch.knee - Math.abs(offset) * 0.5));
  }
  const swing = stride * (GAIT.strideSwing * running + (sprinting ? GAIT.sprintSwing * running : 0));
  const kneeLift = GAIT.kneeBase + GAIT.kneePerRun * Math.min(run, 1.3);
  return [0, Math.PI].map((offset) => {
    const angle = phase + offset;
    const thigh = swing * Math.sin(angle);
    // The knee folds most as the leg swings through (just before it passes under the body) and stays long in the stance.
    const knee = GAIT.idleKnee + kneeLift * stride * Math.max(0, Math.cos(angle + 0.25)) ** 2 * running;
    return legPose(thigh, knee, footFor(thigh, knee));
  });
}

/* ------------------------------ arms only -------------------------------- */

/** A copy of a skinned mesh's geometry with only the triangles that belong to the arms and hands. */
function armTriangles(mesh) {
  const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const { skinIndex, skinWeight } = source.attributes;
  const bones = mesh.skeleton.bones;
  const isArmVertex = new Uint8Array(skinIndex.count);
  for (let v = 0; v < skinIndex.count; v++) {
    let strongest = 0;
    for (let k = 1; k < 4; k++) if (skinWeight.getComponent(v, k) > skinWeight.getComponent(v, strongest)) strongest = k;
    isArmVertex[v] = ARM_BONES.test(bones[skinIndex.getComponent(v, strongest)].name) ? 1 : 0;
  }
  const keep = [];
  for (let triangle = 0; triangle < skinIndex.count / 3; triangle++) {
    if (isArmVertex[triangle * 3] && isArmVertex[triangle * 3 + 1] && isArmVertex[triangle * 3 + 2]) keep.push(triangle);
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) {
    const copy = new attribute.array.constructor(keep.length * 3 * attribute.itemSize);
    keep.forEach((triangle, i) => {
      copy.set(attribute.array.subarray(triangle * 3 * attribute.itemSize, (triangle + 1) * 3 * attribute.itemSize), i * 3 * attribute.itemSize);
    });
    geometry.setAttribute(name, new THREE.BufferAttribute(copy, attribute.itemSize, attribute.normalized));
  }
  return geometry;
}
