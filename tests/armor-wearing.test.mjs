/*
 * Armor on the body: the real helmet file fitted to the head, the rig's armor mount,
 * the wearer that loads and swaps pieces, and the mech suit hiding armor.
 */
import { readFile } from 'node:fs/promises';
import { load, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
const { ARMOR_PARTS, emptyEquipment } = await load('armor-parts');
const { fitModel } = await load('armor-model');
const { ArmorWearer } = await load('armor-wearer');
const { BodyRig } = await load('body-rig');
const { defaultSelection } = await load('suit-parts');
const { HUMANOID_KIT, HUMANOID_MATERIALS } = await load('humanoid');

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

// ---- the real helmet file, fitted ----
const helmet = ARMOR_PARTS.head[0];
const objText = await readFile(new URL(helmet.model.obj, helmet.model.folder), 'utf8');
const fitted = fitModel(new OBJLoader().parse(objText), helmet.model);
const box = new THREE.Box3().setFromObject(fitted);
const size = box.getSize(new THREE.Vector3());
const centre = box.getCenter(new THREE.Vector3());
check(near(size.y, helmet.model.height), `the helmet is ${helmet.model.height} m tall once fitted (${size.y.toFixed(3)})`);
check(near(box.min.y, helmet.model.lift), 'the helmet base sits at its lift above the neck pivot');
check(near(centre.x, 0) && near(centre.z, 0), 'the helmet is centred over the pivot');
check(size.x < 0.35 && size.z < 0.4, `the helmet is about head sized (${size.x.toFixed(2)} x ${size.z.toFixed(2)} m)`);

let threw = false;
try { fitModel(new THREE.Group(), helmet.model); } catch { threw = true; }
check(threw, 'fitting an empty model throws');

// ---- the rig's armor mount ----
const rig = new BodyRig(HUMANOID_MATERIALS);
rig.setKit(HUMANOID_KIT, HUMANOID_MATERIALS);
check(rig.armorSlots().join() === 'head', 'only the head can wear armor for now');
const marker = new THREE.Group();
rig.setArmor('head', marker);
check(marker.parent === rig.armorMounts.head && rig.armorMounts.head.parent === rig.head,'armor hangs on the head pivot, not on the look mount');
check(!rig.lookMounts().includes(rig.armorMounts.head), 'a skinned model that hides the look mounts leaves the armor alone');
rig.setArmor('head', null);
check(rig.armorMounts.head.children.length === 0, 'setArmor with null takes the armor off');
threw = false;
try { rig.setArmor('chest', marker); } catch { threw = true; }
check(threw, 'setArmor throws for a slot with no armor mount');
rig.setArmor('head', marker);
rig.setArmorVisible(false);
check(rig.armorMounts.head.visible === false && rig.armorMounts.head.children.length === 1, 'armor can be hidden without losing it');

// ---- the wearer ----
const body = new BodyRig(HUMANOID_MATERIALS);
const loads = [];
const pending = [];
const loader = (piece) => { loads.push(piece.id); return new Promise((resolve) => pending.push(() => resolve(new THREE.Group()))); };
const wearer = new ArmorWearer(body, loader);
const equip = (id) => ({ ...emptyEquipment(), head: id });

wearer.wear(emptyEquipment());
check(loads.length === 0 && body.armorMounts.head.children.length === 0, 'wearing nothing loads nothing');
wearer.wear(equip('test-helmet'));
wearer.wear(equip('test-helmet'));
check(loads.length === 1, 'repeating the same equipment does not load again');
pending.shift()();
await settle();
check(body.armorMounts.head.children.length === 1, 'the helmet is put on the head once it has loaded');
wearer.wear(equip(null));
check(body.armorMounts.head.children.length === 0, 'taking the helmet off clears the head at once');

wearer.wear(equip('test-helmet'));
wearer.wear(equip(null)); // taken off again before the model arrived
pending.shift()();
await settle();
check(body.armorMounts.head.children.length === 0, 'a model that arrives after it was taken off is dropped');

const errors = [];
const originalError = console.error;
console.error = (...args) => errors.push(args);
const failing = new ArmorWearer(new BodyRig(HUMANOID_MATERIALS), () => Promise.reject(new Error('no file')));
failing.wear(equip('test-helmet'));
await settle();
console.error = originalError;
check(errors.length === 1, 'a model that fails to load is reported loudly');

// ---- armor follows the Y Bot's head bone, not just the rig's head pivot ----
const { YBotSkin, parseYBot } = await load('y-bot');
const { ROOT } = await import('./support/modules.mjs');
const botFile = await readFile(`${ROOT}/game/assets/y-bot.fbx`);
const botTemplate = parseYBot(botFile.buffer.slice(botFile.byteOffset, botFile.byteOffset + botFile.byteLength));
const botBody = new BodyRig(HUMANOID_MATERIALS);
botBody.setKit(HUMANOID_KIT, HUMANOID_MATERIALS);
const botSkin = new YBotSkin(botBody, { load: async () => botTemplate });
const botMarker = new THREE.Group();
botBody.setArmor('head', botMarker);
await settle();
const headBone = botSkin.bones.get('mixamorigHead');
check(botSkin.ready && headBone.getObjectById(botBody.armorMounts.head.id) !== undefined, 'once the Y Bot is drawn, the armor hangs on its head bone');
const worldPose = (object) => { botBody.root.updateWorldMatrix(true, true); return object.matrixWorld.clone(); };
const relativeToBone = () => worldPose(headBone).invert().multiply(worldPose(botMarker));
const restOffset = relativeToBone();
const restWorld = worldPose(botMarker).elements.slice();
botBody.head.rotation.x = 0.6; // the player looks down: the rig head pivot turns, the bone follows it
botSkin.sync();
const lookingDown = relativeToBone();
check(lookingDown.elements.every((value, i) => near(value, restOffset.elements[i], 1e-4)), 'the armor keeps its place on the bone when the head turns');
check(worldPose(botMarker).elements.some((value, i) => !near(value, restWorld[i], 1e-3)), 'and it moves with the head');
botBody.head.rotation.x = 0;
botSkin.sync({ phase: 0, run: 0, stride: 0, grounded: true, sliding: true, crouching: false, sprinting: false, falling: false });
check(relativeToBone().elements.every((value, i) => near(value, restOffset.elements[i], 1e-4)), 'the armor keeps its place on the bone through the slide animation');
const sliding = worldPose(botMarker).elements.slice();
check(sliding.some((value, i) => !near(value, restWorld[i], 1e-3)), 'and the slide moves it, which the rig head pivot alone would not');

// ---- the Y Bot's own head is left out while a helmet is worn ----
const skinnedMeshes = () => { const found = []; botSkin.model.traverse((n) => { if (n.isSkinnedMesh) found.push(n); }); return found; };
const vertexCount = () => skinnedMeshes().reduce((sum, m) => sum + m.geometry.attributes.position.count, 0);
const fullGeometries = skinnedMeshes().map((m) => m.geometry);
const fullCount = vertexCount();
botSkin.setHeadVisible(false);
check(vertexCount() < fullCount && vertexCount() > fullCount * 0.9, 'without its head the Y Bot loses some triangles, not the body');
const headlessVertices = [];
for (const m of skinnedMeshes()) {
  const { skinIndex, skinWeight } = m.geometry.attributes;
  for (let v = 0; v < skinIndex.count; v++) {
    let strongest = 0;
    for (let k = 1; k < 4; k++) if (skinWeight.getComponent(v, k) > skinWeight.getComponent(v, strongest)) strongest = k;
    headlessVertices.push(m.skeleton.bones[skinIndex.getComponent(v, strongest)].name);
  }
}
check(headlessVertices.some((name) => name === 'mixamorigNeck') && headlessVertices.some((name) => name === 'mixamorigSpine2'), 'the neck and the body are still drawn');
const wholeHeadDrawn = (() => {
  const names = headlessVertices;
  for (let i = 0; i < names.length; i += 3) if (names.slice(i, i + 3).every((name) => /Head/.test(name))) return true;
  return false;
})();
check(!wholeHeadDrawn, 'no triangle that belongs wholly to the head is drawn');
botSkin.setHeadVisible(true);
check(skinnedMeshes().every((m, i) => m.geometry === fullGeometries[i]), 'showing the head again restores the original geometry');
const lateSkin = new YBotSkin(new BodyRig(HUMANOID_MATERIALS), { load: async () => botTemplate });
lateSkin.setHeadVisible(false); // asked for before the model has loaded
await settle();
let lateCount = 0; lateSkin.model.traverse((n) => { if (n.isSkinnedMesh) lateCount += n.geometry.attributes.position.count; });
check(lateSkin.ready && lateCount < fullCount, 'a head hidden before the model loads is still hidden once it has');

// the wearer hides and shows the head with the helmet
const headCalls = [];
const stubSkin = { setHeadVisible: (visible) => headCalls.push(visible) };
const headBody = new BodyRig(HUMANOID_MATERIALS);
const headPending = [];
const headWearer = new ArmorWearer(headBody, () => new Promise((resolve) => headPending.push(() => resolve(new THREE.Group()))), stubSkin);
headWearer.wear(equip('test-helmet'));
check(headCalls.length === 0, 'the head stays drawn while the helmet is still loading');
headPending.shift()();
await settle();
check(headCalls.join() === 'false', 'the head is left out once the helmet is on');
headWearer.wear(equip(null));
check(headCalls.join() === 'false,true', 'the head comes back when the helmet comes off');
headWearer.wear(equip('test-helmet'));
headWearer.wear(equip(null));
headPending.shift()();
await settle();
check(headCalls.join() === 'false,true,true', 'a helmet that arrives after it was taken off does not hide the head');

// ---- the cyborg body hides armor while the suit is on ----
const { Cyborg } = await load('cyborg');
const cyborgBody = { player: {}, weapons: { cfg: { list: [] } } };
const cyborg = new Cyborg({ scene: new THREE.Scene(), player: cyborgBody.player, weapons: cyborgBody.weapons, rigged: true, skinLoader: () => new Promise(() => {}), armorLoader: async () => new THREE.Group() });
cyborg.wearArmor(equip('test-helmet'));
await settle();
check(cyborg.body.armorMounts.head.children.length === 1 && cyborg.body.armorMounts.head.visible, 'the cyborg wears the helmet');
cyborg.setSuit(defaultSelection(), 1.7);
check(cyborg.body.armorMounts.head.visible === false, 'the helmet is hidden while the suit is worn');
cyborg.setSuit(null);
check(cyborg.body.armorMounts.head.visible === true && cyborg.body.armorMounts.head.children.length === 1, 'the helmet is back when the suit comes off');

// ---- another player's armor comes in the state message ----
const { loadConfig } = await import('./support/modules.mjs');
const { World } = await load('world');
const { Weapons } = await load('weapons');
const { Player } = await load('player');
const { Enemies } = await load('enemies');
const { createEffects } = await load('effects');
const { RemotePlayers } = await load('remote-players');
const CONFIG = await loadConfig();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 200);
const fx = createEffects(scene);
const world = new World(scene, CONFIG);
const localPlayer = new Player(camera, world, CONFIG.player);
const noop = () => {};
const hud = new Proxy({}, { get: () => noop });
const audio = new Proxy({}, { get: () => noop });
const enemies = new Enemies({ cfg: CONFIG, scene, world, fx, player: localPlayer });
const weapons = new Weapons({ cfg: CONFIG, camera, mainScene: scene, world, enemies, player: localPlayer, fx, hud, audio });
const remotes = new RemotePlayers({ scene, fx, world, weapons, audio, config: CONFIG.multiplayer, suitConfig: CONFIG.suit, skinLoader: () => new Promise(() => {}), armorLoader: async () => new THREE.Group() });
remotes.sync([{ id: 1, name: 'ME' }, { id: 2, name: 'OTHER' }], 1);
const base = { t: 's', x: 20, y: 0, z: 20, yw: 0, pt: 0, vx: 0, vz: 0, g: 1, sl: 0, sp: 0, cr: 0, ln: 0, w: 1, a: 0, f: 0, r: 0, al: 1, hp: 100 };
const headMount = () => remotes.byId.get(2).cyborg.body.armorMounts.head;
remotes.receive(2, { ...base, ar: '10000' }, 1);
await settle();
check(headMount().children.length === 1, 'a player whose state message says they wear the helmet is shown with it');
remotes.receive(2, { ...base }, 1.05);
check(headMount().children.length === 0, 'a state message without the key takes it off');
remotes.receive(2, { ...base, ar: 'zzzzz' }, 1.1);
await settle();
check(headMount().children.length === 0, 'a garbage armor key is treated as no armor');
remotes.clear();

process.exit(fails ? 1 : 0);
