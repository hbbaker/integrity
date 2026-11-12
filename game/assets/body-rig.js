import * as THREE from 'three';

/*
 * The posable skeleton shared by the grey humanoid and the mech suit: nested pivots
 * (hips, torso, head, shoulders, hips-to-legs) with empty "mounts" where the look goes.
 * A kit is one builder per slot; `setSlot` swaps a single slot without touching the rest.
 * The pivots and sizes match the old cyborg rig, so Cyborg's pose code drives either.
 *
 * Model space: feet at y = 0, facing -Z.
 */

export const ARM_LEN = 0.62;
export const SHOULDER_X = 0.37;
export const SHOULDER_Y = 1.32;
export const TORSO_Y = 0.9;
export const HEAD_Y = 0.62;
export const LEG_X = 0.13;
export const LEG_Y = 0.56;

export const SLOTS = ['head', 'arms', 'chest', 'legs', 'boots'];

export function mesh(geometry, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, mat);
  m.position.set(x, y, z);
  return m;
}

/** A group holding the given children. */
export function group(...children) {
  const g = new THREE.Group();
  for (const child of children) g.add(child);
  return g;
}

function clearMount(mount) {
  for (const child of [...mount.children]) {
    child.traverse((node) => { if (node.geometry) node.geometry.dispose(); });
    mount.remove(child);
  }
}

export class BodyRig {
  /** @param {{dark: THREE.Material, joint: THREE.Material}} materials used by the fixed pelvis and waist */
  constructor(materials) {
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';

    this.hips = new THREE.Group();
    this.root.add(this.hips);
    this.legL = this._makeLeg(-1);
    this.legR = this._makeLeg(1);
    this.pelvisMount = group( // the pelvis and waist: part of the rig's look, so a skinned model can hide them too
      mesh(new THREE.BoxGeometry(0.42, 0.2, 0.28), materials.dark, 0, 0.62, 0),
      mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.22, 8), materials.joint, 0, 0.8, 0),
    );
    this.hips.add(this.legL.pivot, this.legR.pivot, this.pelvisMount);

    this.torso = new THREE.Group();
    this.torso.position.y = TORSO_Y;
    this.hips.add(this.torso);
    this.chestMount = new THREE.Group();
    this.torso.add(this.chestMount);

    this.pack = new THREE.Group(); // the cyborg tilts a back pack here; the humanoid has none
    this.pack.position.set(0, 0.35, 0.2);
    this.torso.add(this.pack);

    this.head = new THREE.Group();
    this.head.position.y = HEAD_Y;
    this.torso.add(this.head);
    this.headMount = new THREE.Group();
    this.head.add(this.headMount);

    // Aim rig: both arms (and the gun) pitch together around the shoulders.
    this.rig = new THREE.Group();
    this.rig.rotation.order = 'YXZ';
    this.rig.position.set(0, SHOULDER_Y - TORSO_Y, 0);
    this.torso.add(this.rig);
    this.armL = this._makeArm(-1);
    this.armR = this._makeArm(1);
    this.rig.add(this.armL.pivot, this.armR.pivot);

    this.arms = [this.armL, this.armR];
    this.legs = [this.legL, this.legR];
  }

  _makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * LEG_X, LEG_Y, 0);
    const legMount = new THREE.Group();
    const bootMount = new THREE.Group();
    pivot.add(legMount, bootMount);
    return { pivot, side, legMount, bootMount };
  }

  _makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * SHOULDER_X, 0, 0);
    pivot.rotation.order = 'YXZ';
    const sleeve = new THREE.Group(); // scaled along Y to reach a target
    const hand = new THREE.Group(); // at the wrist; things held in the hand hang here and survive a change of look
    hand.position.y = -ARM_LEN;
    const handMount = new THREE.Group(); // the look of the hand: swapped with the slot
    hand.add(handMount);
    pivot.add(sleeve, hand);
    return { pivot, side, sleeve, hand, handMount };
  }

  /** Put one slot's look on the body. `build(materials, side)`; arms return `{sleeve, hand}`, every other slot a single object. */
  setSlot(slot, build, materials) {
    if (slot === 'head') this._fill(this.headMount, build(materials, 0));
    else if (slot === 'chest') this._fill(this.chestMount, build(materials, 0));
    else if (slot === 'arms') {
      for (const arm of this.arms) {
        const look = build(materials, arm.side);
        this._fill(arm.sleeve, look.sleeve);
        this._fill(arm.handMount, look.hand);
      }
    } else if (slot === 'legs') for (const leg of this.legs) this._fill(leg.legMount, build(materials, leg.side));
    else if (slot === 'boots') for (const leg of this.legs) this._fill(leg.bootMount, build(materials, leg.side));
    else throw new Error(`Unknown body slot: ${slot}`);
  }

  /** Every group that holds a slot's look. Hide them to show something else (a skinned model) in their place. */
  lookMounts() {
    return [
      this.headMount, this.chestMount, this.pelvisMount,
      ...this.arms.flatMap((arm) => [arm.sleeve, arm.handMount]),
      ...this.legs.flatMap((leg) => [leg.legMount, leg.bootMount]),
    ];
  }

  setKit(kit, materials) {
    for (const slot of SLOTS) this.setSlot(slot, kit[slot], materials);
  }

  _fill(mount, object) {
    clearMount(mount);
    mount.add(object);
  }
}
