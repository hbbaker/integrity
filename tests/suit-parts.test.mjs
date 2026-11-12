/*
 * The suit parts: four looks per slot, each fitting its slot, and a swap changes one slot only.
 */
import { load, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { SUIT_PARTS, SUIT_SLOTS, defaultSelection, sanitizeSelection, findPart } = await load('suit-parts');
const { BodyRig } = await load('body-rig');
const { createSuitBody, setSuitPart, setSuitOpen, clearSuitExtras, SUIT_MATERIALS } = await load('mech-suit');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };

// Where each slot's look may sit, in the suit's own space (feet at y = 0, before the suit scale).
const SLOT_BOUNDS = {
  head: new THREE.Box3(new THREE.Vector3(-0.3, 1.4, -0.3), new THREE.Vector3(0.3, 2.15, 0.3)),
  chest: new THREE.Box3(new THREE.Vector3(-0.45, 0.85, -0.35), new THREE.Vector3(0.45, 1.7, 0.4)),
  arms: new THREE.Box3(new THREE.Vector3(-0.8, 0.55, -0.3), new THREE.Vector3(0.8, 1.75, 0.3)),
  legs: new THREE.Box3(new THREE.Vector3(-0.3, 0, -0.3), new THREE.Vector3(0.3, 0.75, 0.3)),
  boots: new THREE.Box3(new THREE.Vector3(-0.3, -0.01, -0.4), new THREE.Vector3(0.3, 0.2, 0.3)),
};

check(SUIT_SLOTS.join() === 'head,arms,chest,legs,boots', 'the suit has head, arms, chest, legs and boots');

for (const slot of SUIT_SLOTS) {
  const parts = SUIT_PARTS[slot];
  check(parts.length >= 4, `${slot}: at least four looks (${parts.length})`);
  check(new Set(parts.map((p) => p.id)).size === parts.length, `${slot}: every look has its own id`);
  check(parts.every((p) => p.name && typeof p.stats === 'object' && typeof p.build === 'function'), `${slot}: every look has a name, a stats object and a builder`);
}

const slotObjects = (rig, slot) => ({
  head: [rig.headMount], chest: [rig.chestMount], arms: rig.arms.map((arm) => arm.pivot),
  legs: rig.legs.map((leg) => leg.legMount), boots: rig.legs.map((leg) => leg.bootMount),
})[slot];

for (const slot of SUIT_SLOTS) {
  for (const part of SUIT_PARTS[slot]) {
    const rig = new BodyRig(SUIT_MATERIALS);
    let built = true;
    try { rig.setSlot(slot, part.build, SUIT_MATERIALS); } catch (error) { built = false; console.log(error.message); }
    rig.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const object of slotObjects(rig, slot)) box.expandByObject(object);
    const fits = SLOT_BOUNDS[slot].containsBox(box);
    check(built && !box.isEmpty() && fits, `${slot}/${part.id} builds and fits its slot${fits ? '' : ` (box ${box.min.toArray().map((n) => n.toFixed(2))} .. ${box.max.toArray().map((n) => n.toFixed(2))})`}`);
  }
}

const selection = defaultSelection();
const body = createSuitBody(selection);
const mounts = () => ({
  head: body.headMount.children[0], chest: body.chestMount.children[0], arms: body.armL.sleeve.children[0],
  legs: body.legL.legMount.children[0], boots: body.legL.bootMount.children[0],
});
const before = mounts();
setSuitPart(body, 'head', SUIT_PARTS.head[1].id);
const after = mounts();
check(after.head !== before.head, 'fitting a head replaces the head');
check(['chest', 'arms', 'legs', 'boots'].every((slot) => after[slot] === before[slot]), 'the other four slots are left alone');
check(body.headMount.children.length === 1, 'the old head is removed, not stacked');

const sanitized = sanitizeSelection({ head: 'nonsense', arms: SUIT_PARTS.arms[2].id });
check(sanitized.head === SUIT_PARTS.head[0].id && sanitized.arms === SUIT_PARTS.arms[2].id, 'a saved selection keeps valid ids and drops unknown ones');
let threw = false;
try { findPart('head', 'nope'); } catch { threw = true; }
check(threw, 'asking for an unknown part is an error');

// ---- the hatch: the back of a chest rides on it, the front stays ----
for (const chest of SUIT_PARTS.chest) {
  const dressed = createSuitBody({ ...selection, chest: chest.id });
  const front = dressed.chestMount.children[0];
  const rear = dressed.hatch.mount.children[0];
  check(front.children.every((c) => c.position.z <= 0.05), `${chest.id}: the front half stays on the torso`);
  check(rear.children.length > 0 && rear.children.every((c) => c.position.z > 0.05), `${chest.id}: the back half is on the hatch`);
}
const dressed = createSuitBody(selection);
setSuitPart(dressed, 'chest', SUIT_PARTS.chest[1].id);
check(dressed.hatch.mount.children.length === 1 && dressed.chestMount.children.length === 1, 'swapping the chest replaces both halves, it does not stack them');
setSuitOpen(dressed, 1);
check(Math.abs(dressed.hatch.hinge.rotation.y) > 1.5 && dressed.shells.length === 4, 'opening swings the hatch and four limb shells');
setSuitOpen(dressed, 0);
check(dressed.hatch.hinge.rotation.y === 0 && dressed.armL.pivot.rotation.z === 0 && dressed.legR.pivot.rotation.z === 0, 'closing puts everything back');
clearSuitExtras(dressed);
check(dressed.hatch === null && dressed.shells.length === 0, 'taking the suit off removes the hatch and shells');

process.exit(fails ? 1 : 0);
