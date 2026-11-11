import { load, loadConfig, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { HOLDABLE_MODELS, buildHeldModel } = await load('holdable-models');
const { bevelBox, lathePart, makeGauge, glowMaterial, sideProfile, tubePart } = await import('../core/client/combat/viewmodel-parts.js');
const { rgbColor, MAT } = await import('../game/weapons/shared.js');
const { createEffects } = await load('effects');
const { World } = await load('world');
const { Player } = await load('player');
const { Enemies } = await load('enemies');
const { Weapons } = await load('weapons');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const noop = () => {};

// --- the shape helpers ---
const box = bevelBox(0.1, 0.06, 0.3, new THREE.MeshBasicMaterial(), 0.01);
box.geometry.computeBoundingBox();
const size = box.geometry.boundingBox.getSize(new THREE.Vector3());
check(Math.abs(size.x - 0.1) < 1e-6 && Math.abs(size.y - 0.06) < 1e-6 && Math.abs(size.z - 0.3) < 1e-6, 'a bevelled box has exactly the size asked for');
check(box.geometry.attributes.position.count > 24, 'and more faces than a plain box (the softened edges)');
check(bevelBox(0.002, 0.002, 0.002, new THREE.MeshBasicMaterial(), 0.05).geometry.attributes.position.count > 0, 'a bevel larger than the part is limited, not broken');
const tube = lathePart([[0.02, 0], [0.02, 0.5]], new THREE.MeshBasicMaterial());
tube.geometry.computeBoundingBox();
check(tube.geometry.boundingBox.min.z < -0.49 && tube.geometry.boundingBox.max.z <= 1e-6, 'a turned part runs forward along -Z from z = 0');

const gauge = makeGauge(5);
const litCount = () => gauge.group.children.filter((cell) => cell.material.emissiveIntensity > 1).length;
gauge.update(1, 0);
check(litCount() === 5, 'a full gauge lights every cell');
gauge.update(0.6, 0);
check(litCount() === 3, 'a 60 per cent gauge lights three of five');
gauge.update(0, 0);
check(litCount() === 0, 'an empty gauge lights none');
gauge.update(0.2, 0);
check(litCount() === 1 && gauge.group.children[0].material.emissive.getHex() === 0xff3b5c, 'a nearly empty gauge turns red');
gauge.chase(0.5);
check(litCount() === 1, 'chase runs one lit cell along the row');
check(glowMaterial(0x00ff00, 3).emissiveIntensity === 3, 'a glow material carries its intensity');

// --- silhouettes cut from a side view ---
const wedge = sideProfile([[0.1, 0], [-0.3, 0], [-0.3, 0.08], [0.1, 0.12]], 0.05, new THREE.MeshBasicMaterial(), 0.004);
wedge.geometry.computeBoundingBox();
const wedgeSize = wedge.geometry.boundingBox.getSize(new THREE.Vector3());
check(Math.abs(wedgeSize.x - 0.05) < 1e-6, 'a side profile is exactly the width asked for');
check(wedgeSize.z > 0.39 && wedgeSize.z < 0.41 && wedgeSize.y > 0.11 && wedgeSize.y < 0.13, 'and follows the outline in z (forward) and y (up)');
check(wedge.geometry.boundingBox.min.z < -0.29 && wedge.geometry.boundingBox.max.z > 0.09, 'forward is negative z');
check(tubePart([[0, 0, 0], [0, 0.05, -0.05], [0, 0, -0.1]], 0.004, new THREE.MeshBasicMaterial()).geometry.attributes.position.count > 0, 'a bent bar can be built through points');

// --- the colours: neutral bodies, RGB glow ---
const hue = (colour) => colour.getHSL({}).h;
const first = rgbColor(0, 0).clone();
const later = rgbColor(0, 3).clone();
check(Math.abs(hue(first) - hue(later)) > 0.2, 'the RGB glow moves round the spectrum over time');
check(Math.abs(hue(rgbColor(0, 0).clone()) - hue(rgbColor(0.5, 0).clone())) > 0.4, 'two glow parts with different phases show different colours');
check(rgbColor(0.3, 1).getHSL({}).s > 0.9, 'the glow is fully saturated');
for (const name of ['gunmetal', 'steel', 'alloy', 'polymer', 'grip', 'ribbed', 'rubber']) {
  check(MAT[name].bumpMap && MAT[name].map && !MAT[name].emissiveMap, `${name}: a neutral material with a colour map and a height map, no glow`);
}
check(MAT.trace.emissiveMap, 'the circuit traces glow, tinted by the RGB cycle');

// --- the weapon models ---
const state = (over = {}) => ({ reloadProgress: 0, rounds: 6, capacity: 6, ammo: 1, pulse: 0, aiming: 0, reloading: false, swing: false, active: false, ...over });
const emissiveMaterials = (root) => {
  const found = new Set();
  root.traverse((o) => { if (o.material?.emissiveIntensity > 0 && o.material.emissive.getHex() !== 0) found.add(o.material); });
  return [...found];
};
for (const id of ['pistol', 'shotgun', 'smg', 'sniper', 'reel', 'drill', 'shovel', 'stopsign', 'fists']) {
  const first = HOLDABLE_MODELS[id].build();
  let meshes = 0;
  first.root.traverse((o) => { if (o.isMesh) meshes += 1; });
  check(typeof first.animate === 'function', `${id}: the model animates`);
  check(meshes >= 12, `${id}: built from many parts (${meshes} meshes)`);
  check(emissiveMaterials(first.root).length >= 2, `${id}: has glowing parts (${emissiveMaterials(first.root).length} lit materials)`);
  let threw = null;
  try {
    for (const s of [state(), state({ pulse: 1, ammo: 0.1 }), state({ reloading: true, aiming: 1 }), state({ swing: true, active: true }), state({ ammo: 0 })]) {
      for (let i = 0; i < 4; i++) first.animate(1 / 60, i * 0.1, s);
    }
  } catch (error) { threw = error; }
  check(!threw, `${id}: animates through every state without error ${threw?.message ?? ''}`);
  const held = buildHeldModel(id);
  if (id !== 'fists') check(held && typeof held.animate === 'function', `${id}: the third-person copy animates too`);
  else check(held === null, 'fists: nothing is held in third person');
}

// --- the glow reacts to what the weapon does ---
const ringColourAt = (model, time) => {
  model.animate(1 / 60, time, state());
  let found = null;
  model.root.traverse((o) => { if (o.material?.emissiveIntensity > 0 && o.geometry?.type === 'LatheGeometry' && o.material.emissive.getHex() !== 0xffffff && !found) found = o.material.emissive.getHex(); });
  return found;
};
const ringModel = HOLDABLE_MODELS.pistol.build();
check(ringColourAt(ringModel, 0) !== ringColourAt(ringModel, 5), 'the pistol muzzle ring changes colour as time passes');

const heatOf = (model, shotState) => {
  const lit = emissiveMaterials(model.root);
  model.animate(1 / 60, 0, shotState);
  return Math.max(...lit.map((m) => m.emissiveIntensity));
};
const pistol = HOLDABLE_MODELS.pistol.build();
const idle = heatOf(pistol, state());
const fired = heatOf(pistol, state({ pulse: 1 }));
check(fired > idle + 3, `a shot makes the nozzle ring flare (${idle.toFixed(1)} -> ${fired.toFixed(1)})`);
const cell = (model) => { let count = 0; model.root.traverse((o) => { if (o.isMesh && o.material.emissiveIntensity > 1 && o.geometry.type === 'BoxGeometry' && o.geometry.parameters.width === 0.004) count += 1; }); return count; };
pistol.animate(1 / 60, 0, state({ ammo: 1 }));
const full = cell(pistol);
pistol.animate(1 / 60, 0, state({ ammo: 0.5 }));
check(full === 6 && cell(pistol) === 3, 'the pistol gauge shows the rounds left (6 of 6, then 3)');
const smg = HOLDABLE_MODELS.smg.build();
const drum = smg.parts.mag.children[0];
const before = drum.rotation.x;
smg.animate(1 / 60, 0, state({ pulse: 0 }));
check(drum.rotation.x === before, 'the nail drum is still when nothing is firing');
smg.animate(1 / 60, 0, state({ pulse: 1 }));
check(drum.rotation.x > before + 0.3, 'and spins when it fires');
const sniper = HOLDABLE_MODELS.sniper.build();
const lensOf = () => { let value = 0; sniper.root.traverse((o) => { if (o.material?.emissive?.getHex() === 0x0a2a88) value = o.material.emissiveIntensity; }); return value; };
sniper.animate(1 / 60, 0, state({ aiming: 0 }));
const lensOff = lensOf();
sniper.animate(1 / 60, 0, state({ aiming: 1 }));
check(lensOf() > lensOff + 1, 'the scope lens brightens as you aim');
const reel = HOLDABLE_MODELS.reel.build();
const spool = reel.root.children.find((child) => child.children.length > 3);
const spin = spool.rotation.x;
reel.animate(1 / 60, 0, state({ active: false }));
check(spool.rotation.x === spin, 'the reel spool is still while the cable is in');
reel.animate(1 / 60, 0, state({ active: true }));
check(spool.rotation.x < spin - 0.1, 'and spins while the cable is out');
const shovel = HOLDABLE_MODELS.shovel.build();
const edgeOf = () => { let value = 0; shovel.root.traverse((o) => { if (o.material?.name === 'shovel-edge') value = o.material.emissiveIntensity; }); return value; };
shovel.animate(1 / 60, 0, state({ swing: false }));
const edgeIdle = edgeOf();
shovel.animate(1 / 60, 0, state({ swing: true }));
check(edgeOf() > edgeIdle + 3, 'the shovel edge flares on a swing');

// --- the state a real weapon feeds its model ---
const CONFIG = await loadConfig();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 200);
const fx = createEffects(scene);
const world = new World(scene, CONFIG);
const player = new Player(camera, world, CONFIG.player);
const enemies = new Enemies({ cfg: CONFIG, scene, world, fx, player });
const weapons = new Weapons({
  cfg: CONFIG, camera, mainScene: scene, envMap: null, world, enemies, player, fx,
  hud: new Proxy({}, { get: () => noop }), audio: new Proxy({}, { get: () => noop }),
});
const input = { forward: 0, back: 0, left: 0, right: 0, sprintHeld: 0, fireHeld: 0, jumpPressed: 0, slidePressed: 0, sprintPressed: 0, firePressed: 0, reloadPressed: 0, meleePressed: 0, ammoPressed: 0, selectSlot: -1, wheel: 0, aimHeld: 0, crouchHeld: 0, leanLeft: 0, leanRight: 0 };
weapons.select(1);
for (let i = 0; i < 40; i++) { player.update(1 / 60, input); weapons.update(1 / 60, input); }
let live = weapons.current.modelState(weapons);
check(live.rounds === 12 && live.capacity === 12 && live.ammo === 1 && live.pulse === 0, 'a real pistol reports 12 of 12 rounds and no recent shot');
input.firePressed = 1; weapons.update(1 / 60, input); input.firePressed = 0;
live = weapons.current.modelState(weapons);
check(live.rounds === 11 && live.pulse > 0.9, 'right after a shot it reports 11 rounds and a fresh shot');
weapons.select(0);
for (let i = 0; i < 40; i++) weapons.update(1 / 60, input);
weapons.swingT = 0.1;
check(weapons.current.modelState(weapons).swing === true, 'a swing in progress is reported');


// --- the arms stay joined to the shoulders ---
const shoulderGap = (index) => {
  const model = weapons.models[index];
  const worlds = [];
  model.root.traverse((o) => { if (o.userData.limb) worlds.push(o); });
  const gaps = worlds.map((wrist) => {
    const { sleeve, shoulder } = wrist.userData.limb;
    const end = sleeve.localToWorld(new THREE.Vector3(0, 0.5, 0)); // the sleeve's far end
    return end.distanceTo(new THREE.Vector3(...shoulder));
  });
  return { count: worlds.length, worst: Math.max(...gaps) };
};
for (const id of ['pistol', 'shotgun', 'smg', 'sniper', 'reel', 'drill', 'shovel', 'stopsign', 'fists']) {
  const index = CONFIG.weapons.list.findIndex((item) => item.id === id);
  weapons.reset(); weapons.select(index);
  for (let i = 0; i < 40; i++) { player.update(1 / 60, input); weapons.update(1 / 60, input); weapons.updateView(1 / 60, i / 60); }
  const gap = shoulderGap(index);
  check(gap.count >= 1 && gap.worst < 0.01, `${id}: every sleeve runs all the way to its shoulder (${gap.count} arm parts, worst gap ${gap.worst.toFixed(4)} m)`);
}
{
  const index = CONFIG.weapons.list.findIndex((item) => item.id === 'drill');
  weapons.reset(); weapons.select(index);
  for (let i = 0; i < 40; i++) { weapons.update(1 / 60, input); weapons.updateView(1 / 60, i / 60); }
  const launcher = weapons.slots[index];
  launcher.mag = 0; launcher.reloading = true; launcher.reloadTimer = launcher.cfg.reloadTime * 0.6; // mid-reload: the launcher is raised in front
  for (let i = 0; i < 30; i++) weapons.updateView(1 / 60, 1 + i / 60);
  check(shoulderGap(index).worst < 0.01, 'and still do while the launcher is raised for the reload');
}

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
