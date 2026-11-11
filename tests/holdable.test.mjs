/*
 * Proves the Holdable contract: a brand-new kind of item (a "tape measure") is added by extending Holdable
 * and registering the class and a model, with no change to core. The real game classes are checked for
 * the subclass relationships too.
 */
import { load, loadConfig, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { createEffects } = await load('effects');
const { World } = await load('world');
const { Player } = await load('player');
const { Enemies } = await load('enemies');
const { HoldableSystem } = await load('holdable-system');
const { Holdable } = await load('holdable');
const { Weapon } = await load('weapon');
const { Firearm } = await load('firearm');
const { BeamWeapon } = await load('beam-weapon');
const { MeleeWeapon } = await load('melee-weapon');
const { Tool } = await load('tool');
const { Weapons, HOLDABLE_TYPES } = await load('weapons');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const noop = () => {};

const CONFIG = await loadConfig();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 200);
const fx = createEffects(scene);
const world = new World(scene, CONFIG);
const player = new Player(camera, world, CONFIG.player);
const hudLog = { weapon: [], ammo: null, alt: null, loadout: null };
const hud = new Proxy({
  setWeapon: (id, name) => hudLog.weapon.push([id, name]),
  setAmmo: (...args) => { hudLog.ammo = args; },
  setAltAmmo: (text) => { hudLog.alt = text; },
  setLoadout: (ids, active) => { hudLog.loadout = [ids, active]; },
}, { get: (target, key) => target[key] ?? noop });
const audio = new Proxy({}, { get: () => noop });
const enemies = new Enemies({ cfg: CONFIG, scene, world, fx, player });

// --- the class tree ---
check(Weapon.prototype instanceof Holdable && Tool.prototype instanceof Holdable, 'weapons and tools are Holdables');
check([Firearm, BeamWeapon, MeleeWeapon].every((cls) => cls.prototype instanceof Weapon), 'firearms, beam weapons and melee weapons are Weapons');
check(Object.keys(HOLDABLE_TYPES).sort().join() === 'beam,firearm,grapple,melee,projectile,sign,tool', 'the game registers seven holdable types');

const game = new Weapons({ cfg: CONFIG, camera, mainScene: scene, envMap: null, world, enemies, player, fx, hud, audio });
const kinds = Object.fromEntries(game.slots.map((item) => [item.id, item.constructor.name]));
check(kinds.pistol === 'Firearm' && kinds.raygun === 'BeamWeapon' && kinds.fists === 'MeleeWeapon' && kinds.shovel === 'Tool' && kinds.reel === 'FiberReel', `real items use the right classes (${JSON.stringify(kinds)})`);

// --- a new kind of holdable: no change to core ---
class TapeMeasure extends Holdable {
  constructor(base) {
    super(base);
    this.measured = 0;
    this.equips = 0;
  }

  onEquip() { this.equips += 1; }

  fixedUpdate(holder, dt, input) {
    if (input.fireHeld) this.measured += dt;
  }

  poseView(holder, pose) { pose.y += 0.01; }

  hudState() { return { mag: 0, reserve: 0, reloading: false, melee: true, altAmmo: `MEASURED ${this.measured.toFixed(1)}` }; }

  describe() { return { dps: 0, range: 3, capacity: 'tape' }; }
}

const toyRoot = new THREE.Group();
const toyConfig = {
  ...CONFIG.weapons,
  handsIndex: 0, startIndex: 1, defaultLoadout: [1],
  list: [
    CONFIG.weapons.list.find((item) => item.id === 'fists'),
    { id: 'tape', name: 'TAPE MEASURE', type: 'tape' },
  ],
};
const toy = new HoldableSystem({
  config: toyConfig,
  types: { ...HOLDABLE_TYPES, tape: TapeMeasure },
  models: {
    fists: game.modelDefs.fists,
    tape: { build: () => ({ root: toyRoot, muzzle: null, home: { x: 0.2, y: -0.2, z: -0.4 }, parts: {} }) },
  },
  camera, mainScene: scene, envMap: null, world, enemies, player, fx, hud, audio,
});

check(toy.current instanceof TapeMeasure && toy.current.equips === 1, 'the new item is built from its registered class and equipped');
check(toyRoot.visible && toy.models[0].root.visible === false, 'only the equipped item\'s model shows');
check(hudLog.weapon.at(-1)[0] === 'tape', 'the HUD is told which item is in hand');
const input = { fireHeld: true, firePressed: false, selectSlot: -1, wheel: 0, aimHeld: false, reloadPressed: false, meleePressed: false, ammoPressed: false };
for (let i = 0; i < 30; i++) toy.update(1 / 60, input);
check(Math.abs(toy.current.measured - 0.5) < 0.02, 'its fixedUpdate hook runs every step while it is in hand');
check(hudLog.alt === 'MEASURED 0.5', 'its hudState reaches the HUD');
toy.updateView(1 / 60, 1);
check(toy.pose.y > toy.models[1].home.y - 0.2, 'its poseView hook can move the viewmodel');
check(toy.enemies.aimThreat === false, 'an item that is not aimable does not make bots dodge');
check(toy.armory().map((entry) => entry.id).join() === 'tape' && toy.armory()[0].capacity === 'tape', 'it shows in the inventory with its own stats');
toy.select(0);
for (let i = 0; i < 40; i++) toy.update(1 / 60, { ...input, fireHeld: false });
check(toy.current.id === 'fists' && toy.slots[1].measured > 0.4, 'switching away leaves the new item idle, and fists take over');
let threw = false;
try {
  new HoldableSystem({ config: { ...toyConfig, list: [{ id: 'x', name: 'X', type: 'nonsense' }] }, types: HOLDABLE_TYPES, models: { x: { build: () => ({ root: new THREE.Group(), home: { x: 0, y: 0, z: 0 }, parts: {} }) } }, camera, mainScene: scene, envMap: null, world, enemies, player, fx, hud, audio });
} catch (error) {
  threw = /unknown type/.test(error.message);
}
check(threw, 'an item with an unregistered type is refused with a clear message');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
