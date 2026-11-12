/*
 * The human: the Y Bot model in the game's Xbox materials, following the procedural rig.
 */
import { readFile } from 'node:fs/promises';
import { load, installDomStubs, ROOT } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { BodyRig } = await load('body-rig');
const { HUMANOID_KIT, HUMANOID_MATERIALS } = await load('humanoid');
const { YBotSkin, parseYBot, preloadYBot, Y_BOT_URL } = await load('y-bot');
const { YBotViewArms } = await load('y-bot-arms');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

const file = await readFile(`${ROOT}/game/assets/y-bot.fbx`);
const template = parseYBot(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
preloadYBot(template); // the weapons below build their first-person arms from it
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeSkin(loader = async () => template) {
  const body = new BodyRig(HUMANOID_MATERIALS);
  body.setKit(HUMANOID_KIT, HUMANOID_MATERIALS);
  const skin = new YBotSkin(body, { load: loader });
  return { body, skin };
}
const bone = (skin, name) => skin.model.getObjectByName(`mixamorig${name}`);
const at = (skin, name) => { skin.body.root.updateWorldMatrix(true, true); return bone(skin, name).getWorldPosition(new THREE.Vector3()); };
const direction = (skin, from, to) => at(skin, to).sub(at(skin, from)).normalize();
const groundLevel = (skin) => skin.restSoleHeight; // the toe bones sit this far above the sole, which is the ground
const lowestSole = (skin) => Math.min(...['Left', 'Right'].flatMap((side) => ['Foot', 'ToeBase', 'Toe_End'].map((name) => at(skin, `${side}${name}`).y)));

// ---- the model and its materials ----
const meshes = [];
template.traverse((node) => { if (node.isSkinnedMesh) meshes.push(node); });
check(meshes.length === 2, 'the file has the body and the joints as skinned meshes');
check(meshes.every((m) => m.material.isMeshPhongMaterial && !m.material.envMap && !m.material.map?.isRenderTargetTexture), 'every part uses Phong lighting with no reflections, like the rest of the game');
check(meshes.some((m) => m.material === HUMANOID_MATERIALS.skin) && meshes.some((m) => m.material === HUMANOID_MATERIALS.dark), 'the body is the game\'s grey skin and the joints its dark grey');
check(Y_BOT_URL.endsWith('/y-bot.fbx') && !Y_BOT_URL.includes('%'), 'the file has a plain name the server can serve');

// ---- before it loads, and if it cannot ----
const pending = makeSkin(() => new Promise(() => {}));
check(pending.body.lookMounts().every((m) => m.visible) && !pending.skin.ready, 'while the model loads, the plain humanoid shows');
pending.skin.sync();
const failed = makeSkin(async () => null);
await settle();
check(!failed.skin.ready && failed.body.lookMounts().every((m) => m.visible), 'if the model cannot load, the plain humanoid stays');
failed.skin.sync();

// ---- once loaded ----
const { body, skin } = makeSkin();
await settle();
check(skin.ready && skin.wrapper.visible && body.lookMounts().every((m) => !m.visible), 'once loaded, the Y Bot shows and the plain look hides');
check(body.arms.every((arm) => arm.hand.parent === arm.pivot), 'the hand stays for held items');

const head = at(skin, 'HeadTop_End');
check(head.y > 1.55 && head.y < 1.75, `it stands about human height (${head.y.toFixed(2)} m)`);
check(near(at(skin, 'RightArm').y, 1.32, 0.05), 'its shoulders are at the rig\'s shoulder height, so a held weapon lines up');
check(at(skin, 'RightArm').x > 0 && at(skin, 'LeftArm').x < 0, 'its right side is on the rig\'s right');
check(at(skin, 'LeftToe_End').z < at(skin, 'LeftFoot').z, 'it faces the way the rig faces (-Z)');
check(near(lowestSole(skin), groundLevel(skin), 0.005) && groundLevel(skin) < 0.04, `standing, its feet are on the ground (${lowestSole(skin).toFixed(3)})`);

// the arms follow the rig's arms
body.armR.pivot.rotation.set(Math.PI / 2, 0, 0); // straight out in front, as when aiming
skin.sync();
const forearm = direction(skin, 'RightArm', 'RightHand');
check(forearm.z < -0.95 && near(forearm.x, 0, 0.1), 'the right arm points straight ahead when the rig\'s arm does');
const leftArm = direction(skin, 'LeftArm', 'LeftHand');
check(leftArm.y < -0.95, 'the left arm hangs when the rig\'s arm hangs');

// the legs follow the rig's legs, and the feet stay on the ground
body.armR.pivot.rotation.set(0, 0, 0);
body.legL.pivot.rotation.set(-1.25, 0, 0); // the slide
body.legR.pivot.rotation.set(-0.95, 0, 0);
skin.sync();
const thigh = direction(skin, 'LeftUpLeg', 'LeftLeg');
check(thigh.z > 0.9, 'the thigh swings the way the rig\'s leg swings (a negative turn about X is toward +Z)');
check(near(lowestSole(skin), groundLevel(skin), 0.005), `sliding, its feet still touch the ground (${lowestSole(skin).toFixed(3)})`);
check(at(skin, 'Hips').y < 0.9, 'the hips came down to meet them');
const shin = direction(skin, 'LeftLeg', 'LeftFoot');
check(shin.z > thigh.z, 'the knee bends: the shin hangs lower than the thigh');
body.legL.pivot.rotation.set(0.7, 0, 0); // a leg swung forward, mid stride
skin.sync();
check(near(lowestSole(skin), groundLevel(skin), 0.005), 'mid stride, the lowest foot is on the ground too');
check(direction(skin, 'LeftUpLeg', 'LeftLeg').z < -0.5 && direction(skin, 'LeftLeg', 'LeftFoot').z > direction(skin, 'LeftUpLeg', 'LeftLeg').z, 'a leg swung forward bends at the knee, the shin hanging back of the thigh');
body.legL.pivot.rotation.set(0, 0, 0);
body.legR.pivot.rotation.set(0, 0, 0);

// the torso and head turn
body.torso.rotation.set(0.4, 0, 0);
body.head.rotation.set(0, 0.5, 0);
skin.sync();
const chest = at(skin, 'Spine2');
check(chest.z < at(skin, 'Hips').z - 0.0 || chest.y < 1.4, 'a lean of the rig\'s torso leans the Y Bot\'s spine');
body.torso.rotation.set(0, 0, 0);
body.head.rotation.set(0, 0, 0);
skin.sync();
check(near(at(skin, 'HeadTop_End').y, head.y, 0.01), 'back at rest the pose comes back exactly');

// when the suit is on, the Y Bot gets out of the way
skin.setActive(false);
check(!skin.wrapper.visible && body.lookMounts().every((m) => m.visible), 'with the suit on, the Y Bot hides and the rig\'s look shows');
skin.sync();
skin.setActive(true);
check(skin.wrapper.visible && body.lookMounts().every((m) => !m.visible), 'out of the suit, the Y Bot is back');


// ---- the old look is gone, hips included ----
check(body.pelvisMount.visible === false && body.lookMounts().includes(body.pelvisMount), 'the old pelvis and waist block is hidden with the rest of the old look');
check(body.pelvisMount.children.length > 0, 'it is still there for the suit and the fallback');

// ---- holding a weapon: two-bone IK, hands on the grips, elbows out ----
skin.sync();
const front = new THREE.Vector3(0.02, 1.25, -0.36); // in front of the chest, where a gun's grips are
skin.reach('Right', front);
skin.reach('Left', front.clone().add(new THREE.Vector3(-0.1, 0, -0.04)));
const wrist = (side) => skin.wristWorld(side, new THREE.Vector3());
check(wrist('Right').distanceTo(front) < 0.02, `the right hand reaches its grip (${wrist('Right').distanceTo(front).toFixed(3)} m off)`);
check(wrist('Left').distanceTo(front.clone().add(new THREE.Vector3(-0.1, 0, -0.04))) < 0.02, 'the left hand reaches its grip');
const elbowL = at(skin, 'LeftForeArm');
const elbowR = at(skin, 'RightForeArm');
check(elbowL.x < -0.05 && elbowR.x > 0.05, `the elbows stay on their own sides, so the arms are not crossed (L ${elbowL.x.toFixed(2)}, R ${elbowR.x.toFixed(2)})`);
check(elbowL.y < 1.3 && elbowR.y < 1.3, 'the elbows hang below the shoulders');
check(wrist('Left').x < wrist('Right').x, 'the left hand is left of the right hand');
const farAway = new THREE.Vector3(0.1, 1.3, -3);
skin.reach('Right', farAway);
const armLength = at(skin, 'RightArm').distanceTo(wrist('Right'));
check(near(armLength, skin.armReach('Right'), 0.01), `a grip out of reach is reached as far as the arm goes (${armLength.toFixed(2)} m, arm straight)`);
check(Number.isFinite(wrist('Right').x), 'a target on top of the shoulder does not break the arm');
skin.reach('Right', at(skin, 'RightArm'));
check(Number.isFinite(wrist('Right').x) && Number.isFinite(wrist('Right').y), 'and an arm folded right up still has a position');
skin.sync();

// ---- the gait ----
const motion = (over) => ({ phase: 0, run: 0, stride: 1, grounded: true, sliding: false, crouching: false, sprinting: false, falling: false, ...over });
const angleBetween = (a, b) => Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
const kneeBend = (side) => angleBetween(direction(skin, `${side}UpLeg`, `${side}Leg`), direction(skin, `${side}Leg`, `${side}Foot`));
const thighForward = (side) => -direction(skin, `${side}UpLeg`, `${side}Leg`).z; // positive: swung forward
const hipsHeight = () => at(skin, 'Hips').y;

skin.sync(motion({ run: 0 }));
const standingHips = hipsHeight();
check(kneeBend('Left') < 0.2 && kneeBend('Right') < 0.2, 'standing still, the knees are straight');

let mostBend = 0;
let groundedThroughout = true;
let forwardLeft = [];
for (let step = 0; step < 24; step++) {
  skin.sync(motion({ run: 1, phase: (step / 24) * Math.PI * 2 }));
  mostBend = Math.max(mostBend, kneeBend('Left'), kneeBend('Right'));
  groundedThroughout &&= near(lowestSole(skin), groundLevel(skin), 0.006);
  forwardLeft.push(thighForward('Left'));
}
check(mostBend > 1.1, `running, the knee folds right up as the leg swings through (${mostBend.toFixed(2)} rad)`);
check(groundedThroughout, 'at every point of the stride a foot is on the ground');
check(Math.max(...forwardLeft) > 0.45 && Math.min(...forwardLeft) < -0.45, 'the thigh swings both forward and back');
skin.sync(motion({ run: 1, phase: Math.PI / 2 }));
check(thighForward('Left') > 0.4 && thighForward('Right') < -0.4, 'when the left leg is forward the right is back');
const strideLength = Math.abs(at(skin, 'LeftFoot').z - at(skin, 'RightFoot').z);
skin.sync(motion({ run: 0.3, phase: Math.PI / 2 }));
check(Math.abs(at(skin, 'LeftFoot').z - at(skin, 'RightFoot').z) < strideLength, 'a walk takes shorter steps than a run');
skin.sync(motion({ run: 1, sprinting: true, phase: Math.PI / 2 }));
check(Math.abs(at(skin, 'LeftFoot').z - at(skin, 'RightFoot').z) > strideLength, 'a sprint takes the longest steps');

// arms: pumped at the elbow when running, easy when standing
body.armL.pivot.rotation.set(0, 0, 0);
skin.sync(motion({ run: 0 }));
const standingElbow = angleBetween(direction(skin, 'LeftArm', 'LeftForeArm'), direction(skin, 'LeftForeArm', 'LeftHand'));
skin.sync(motion({ run: 1, sprinting: true }));
const runningElbow = angleBetween(direction(skin, 'LeftArm', 'LeftForeArm'), direction(skin, 'LeftForeArm', 'LeftHand'));
check(standingElbow < 0.3 && runningElbow > 1.0, `the elbows bend when running (${standingElbow.toFixed(2)} standing, ${runningElbow.toFixed(2)} running)`);

// the pelvis turns against the shoulders
skin.sync(motion({ run: 1, phase: Math.PI / 2 }));
const hipLine = at(skin, 'RightUpLeg').sub(at(skin, 'LeftUpLeg'));
check(Math.abs(hipLine.z) > 0.01, 'the pelvis twists as the legs swing');

// sliding: one leg out front, one tucked under, hips low, leaning on the ground
skin.sync(motion({ sliding: true }));
const slideHips = hipsHeight();
check(thighForward('Right') > 0.9 && kneeBend('Right') < 0.3, 'sliding, the lead leg is out in front and almost straight');
check(kneeBend('Left') > 1.6 && thighForward('Left') > 0.5, 'the other knee is tucked under');
check(slideHips < 0.55 && slideHips < standingHips - 0.3, `the hips come right down (${slideHips.toFixed(2)} m from ${standingHips.toFixed(2)})`);
check(near(lowestSole(skin), groundLevel(skin), 0.006), 'and a foot is still on the ground');
check(at(skin, 'RightToe_End').y > at(skin, 'RightFoot').y - 0.12, 'the lead foot has its toes up, not dug in');

// crouching: a squat
skin.sync(motion({ crouching: true }));
const crouchHips = hipsHeight();
check(kneeBend('Left') > 1.6 && thighForward('Left') > 0.8, 'crouching, the thighs come forward and the knees fold');
check(crouchHips < standingHips - 0.2 && crouchHips > slideHips, `the hips sit between standing and sliding (${crouchHips.toFixed(2)} m)`);
check(near(lowestSole(skin), groundLevel(skin), 0.006), 'a crouch keeps the feet on the ground');

// in the air: a tuck, then legs reaching down
skin.sync(motion({ grounded: false, falling: false }));
const tuck = Math.max(kneeBend('Left'), kneeBend('Right'));
skin.sync(motion({ grounded: false, falling: true }));
const reaching = Math.max(kneeBend('Left'), kneeBend('Right'));
check(tuck > 1.1 && reaching < tuck, `jumping, a knee comes up; falling, the legs reach down (${tuck.toFixed(2)} then ${reaching.toFixed(2)} rad)`);
skin.sync(motion({ run: 1, phase: 1 }));
check(near(at(skin, 'Hips').y, hipsHeight(), 1e-9) && Number.isFinite(hipsHeight()), 'poses are repeatable');

// ---- the whole player: a cyborg with a gun up ----
const { World } = await load('world');
const { Player } = await load('player');
const { Weapons } = await load('weapons');
const { Enemies } = await load('enemies');
const { Cyborg } = await load('cyborg');
const { createEffects } = await load('effects');
const { loadConfig } = await import('./support/modules.mjs');
const CONFIG = await loadConfig();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 200);
const noop = () => {};
const gameWorld = new World(scene, CONFIG);
const player = new Player(camera, gameWorld, CONFIG.player);
const hud = new Proxy({}, { get: () => noop });
const audio = new Proxy({}, { get: () => noop });
const enemies = new Enemies({ cfg: CONFIG, scene, world: gameWorld, fx: createEffects(scene), player });
const weapons = new Weapons({ cfg: CONFIG, camera, mainScene: scene, world: gameWorld, enemies, player, fx: createEffects(scene), hud, audio });
const cyborg = new Cyborg({ scene, player, weapons, rigged: true, skinLoader: async () => template });
await settle();
const idle = { forward: 0, back: 0, left: 0, right: 0, sprintHeld: 0, fireHeld: 0, jumpPressed: 0, slidePressed: 0, sprintPressed: 0, firePressed: 0, reloadPressed: 0, meleePressed: 0, ammoPressed: 0, selectSlot: -1, wheel: 0, aimHeld: 0, crouchHeld: 0, leanLeft: 0, leanRight: 0 };
player.thirdPerson = true;
player.tpBlend = 1;
for (const id of ['pistol', 'shotgun', 'sniper', 'smg', 'raygun', 'drill']) {
  weapons.reset();
  weapons.select(CONFIG.weapons.list.findIndex((item) => item.id === id));
  for (let i = 0; i < 40; i++) { player.update(1 / 60, idle); weapons.update(1 / 60, idle); }
  cyborg.update(1 / 60, 1, 0);
  const gun = cyborg.guns[weapons.index];
  const socket = cyborg.socket.getWorldPosition(new THREE.Vector3());
  const right = cyborg.skin.wristWorld('Right', new THREE.Vector3());
  const left = cyborg.skin.wristWorld('Left', new THREE.Vector3());
  const grip = gun.leftGrip.getWorldPosition(new THREE.Vector3());
  check(socket.distanceTo(right) < 0.01, `${id}: the gun is in the model's right hand (${socket.distanceTo(right).toFixed(3)} m off)`);
  check(left.distanceTo(grip) < 0.1, `${id}: the left hand is at the support grip (${left.distanceTo(grip).toFixed(2)} m off)`);
  const elbowLeft = cyborg.skin.model.getObjectByName('mixamorigLeftForeArm').getWorldPosition(new THREE.Vector3());
  const elbowRight = cyborg.skin.model.getObjectByName('mixamorigRightForeArm').getWorldPosition(new THREE.Vector3());
  const across = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), cyborg.root.rotation.y); // the body's own right
  check(elbowRight.clone().sub(elbowLeft).dot(across) > 0.2, `${id}: the elbows are apart, right of left, so the arms are not crossed`);
  const shoulder = cyborg.skin.shoulderWorld('Right', new THREE.Vector3());
  if (id === 'drill') {
    check(shoulder.y - right.y < 0.15, `${id}: the launcher stays up on the shoulder (hand ${(shoulder.y - right.y).toFixed(2)} m below it)`);
  } else {
    check(shoulder.y - right.y > 0.15 && shoulder.y - right.y < 0.4, `${id}: carried low, the right hand at waist-to-chest height (${(shoulder.y - right.y).toFixed(2)} m below the shoulder)`);
    check(left.distanceTo(grip) < 0.1, `${id}: and the left hand still holds the front grip (${left.distanceTo(grip).toFixed(2)} m off)`);
  }
}
check(cyborg.body.pelvisMount.visible === false, 'the player body has no old hip block');
cyborg.setSuit(CONFIG.suit ? { head: 'standard-helm', arms: 'slim-plates', chest: 'plate-cuirass', legs: 'straight-greaves', boots: 'flat-treads' } : null, 1.7);
check(cyborg.body.pelvisMount.visible === true && !cyborg.skin.wrapper.visible, 'in the suit the model hides and the rig shows, pelvis included');
cyborg.setSuit(null);
check(cyborg.body.pelvisMount.visible === false && cyborg.skin.wrapper.visible, 'out of the suit the model is back');

// two skins from one file do not share bones
const third = makeSkin();
await settle();
const before = direction(third.skin, 'RightArm', 'RightHand');
const fourth = makeSkin();
await settle();
fourth.body.armR.pivot.rotation.set(Math.PI / 2, 0, 0);
fourth.skin.sync();
check(fourth.skin.model !== third.skin.model && direction(third.skin, 'RightArm', 'RightHand').distanceTo(before) < 1e-6 && direction(fourth.skin, 'RightArm', 'RightHand').z < -0.9, 'each skin has its own skeleton');

// ---- first-person arms ----
const view = new YBotViewArms({ load: async () => template });
await settle();
const viewMeshes = [];
view.skin.model.traverse((node) => { if (node.isSkinnedMesh) viewMeshes.push(node); });
const fullTriangles = meshes.reduce((total, mesh) => total + mesh.geometry.attributes.position.count / 3, 0);
const armTriangles = viewMeshes.reduce((total, mesh) => total + mesh.geometry.attributes.position.count / 3, 0);
check(view.ready && view.object.visible, 'the first-person arms show once the model has loaded');
check(armTriangles > 2000 && armTriangles < fullTriangles * 0.65, `only the arms are kept (${armTriangles} of ${fullTriangles} triangles: the fingers are most of it)`);
let nearTheBody = 0;
for (const mesh of viewMeshes) {
  const position = mesh.geometry.attributes.position;
  for (let v = 0; v < position.count; v++) if (Math.abs(position.getX(v)) < 12) nearTheBody++;
}
check(nearTheBody === 0, 'no head, chest or legs came with them');
const handOf = (mesh) => mesh.skeleton.bones.find((bone) => bone.name === 'mixamorigRightHand');
const wrists = { Left: new THREE.Vector3(-0.2, -0.22, -0.38), Right: new THREE.Vector3(0.2, -0.22, -0.38) };
view.follow(wrists.Left, wrists.Right);
const wristAt = (side) => view.skin.wristWorld(side, new THREE.Vector3());
check(wristAt('Left').distanceTo(wrists.Left) < 0.02 && wristAt('Right').distanceTo(wrists.Right) < 0.02, 'the wrists land on the item\'s two hand positions');
const punch = new THREE.Vector3(0.116, -0.15, -0.68); // the hand mid-punch
view.follow(wrists.Left, punch);
check(wristAt('Right').distanceTo(punch) < 0.03, `a punch is followed all the way out (${wristAt('Right').distanceTo(punch).toFixed(3)} m off)`);
check(wristAt('Left').distanceTo(wrists.Left) < 0.02, 'while the other hand stays put');
check(viewMeshes.length === 2 && handOf(viewMeshes[0]).getWorldPosition(new THREE.Vector3()).distanceTo(handOf(viewMeshes[1]).getWorldPosition(new THREE.Vector3())) < 1e-6, 'the body and the joints both follow the same hand');
const knuckle = view.skin.model.getObjectByName('mixamorigRightHandMiddle3').getWorldPosition(new THREE.Vector3());
check(knuckle.z < -0.3 && knuckle.y > -0.6 && knuckle.y < 0.1, `the fist is in front of the camera, low in the picture (${knuckle.toArray().map((n) => n.toFixed(2))})`);
check(view.skin.grip === 1, 'the hands are fists');
const shoulderHeight = view.skin.shoulderWorld('Right', new THREE.Vector3());
check(shoulderHeight.y < -0.3 && shoulderHeight.z > -0.1, 'the shoulders are down and just behind the camera, so the arms come in from the bottom of the picture');
const unready = new YBotViewArms({ load: async () => null });
await settle();
unready.follow(wrists.Left, wrists.Right);
check(!unready.ready && !unready.object.visible, 'if the model cannot load there are no arms to show, and nothing breaks');

// the gloves item uses them
const glovesIndex = weapons.handsIndex;
const fists = weapons.models[glovesIndex];
check(fists.afterView && fists.parts.hands.every((hand) => hand.visible === false), 'the fists model hides its old gloves once the arms are ready');
weapons.reset();
weapons.select(glovesIndex);
for (let i = 0; i < 40; i++) { player.update(1 / 60, idle); weapons.update(1 / 60, idle); }
player.thirdPerson = false;
weapons.updateView(1 / 60, 1);
const handWorld = fists.parts.hands.map((hand) => hand.getWorldPosition(new THREE.Vector3()));
const fistsArms = [];
fists.root.traverse((node) => { if (node.isSkinnedMesh) fistsArms.push(node); });
check(fistsArms.length === 2, 'the arms are part of the gloves model');
const modelWrist = (side) => fistsArms[0].skeleton.bones.find((bone) => bone.name === `mixamorig${side}Hand`).getWorldPosition(new THREE.Vector3());
check(modelWrist('Left').distanceTo(handWorld[0]) < 0.03 && modelWrist('Right').distanceTo(handWorld[1]) < 0.03, 'in the game the arms follow the hands as the weapon system places them');
weapons.punchT[1] = 0.1;
weapons.updateView(1 / 60, 1.2);
const punched = fists.parts.hands[1].getWorldPosition(new THREE.Vector3());
check(modelWrist('Right').distanceTo(punched) < 0.05 && punched.z < handWorld[1].z - 0.05, 'and they follow a punch');

// ---- fists ----
const fingertip = (skin, side) => at(skin, `${side}HandMiddle3`).distanceTo(at(skin, `${side}Hand`));
const fistSkin = makeSkin();
await settle();
fistSkin.skin.setGrip(0);
const flatReach = fingertip(fistSkin.skin, 'Right');
fistSkin.skin.setGrip(1);
const fistReach = fingertip(fistSkin.skin, 'Right');
check(fistReach < flatReach * 0.8, `a fist closes the fingers up (${flatReach.toFixed(3)} m flat, ${fistReach.toFixed(3)} m closed)`);
check(fingertip(fistSkin.skin, 'Left') < flatReach * 0.8, 'both hands close');
const closedTip = at(fistSkin.skin, 'RightHandMiddle3');
check(closedTip.y < at(fistSkin.skin, 'RightHand').y + 0.01, 'the fingers curl down toward the palm, which faces down, not up and back');
fistSkin.skin.setGrip(0.25);
check(cyborg.skin.grip === 0.55 || cyborg.skin.grip === 1, 'the third-person hands close round a gun, or into fists with nothing in hand');
weapons.reset();
weapons.select(weapons.handsIndex);
for (let i = 0; i < 40; i++) { player.update(1 / 60, idle); weapons.update(1 / 60, idle); }
cyborg.update(1 / 60, 1, 0);
check(cyborg.skin.grip === 1, 'with nothing in hand, the character\'s hands are fists');

process.exit(fails ? 1 : 0);
