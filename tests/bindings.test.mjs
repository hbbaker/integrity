import { load } from './support/modules.mjs';
const { Bindings, FAMILIES, familyOf, controlLabel } = await load('bindings');
const { ACTIONS, PAD_PRESETS } = await load('actions');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const memoryStorage = () => { const data = {}; return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, data }; };

const bindings = new Bindings(ACTIONS, { presets: PAD_PRESETS });
check(bindings.actionsFor('KeyW').includes('forward') && bindings.actionsFor('ArrowUp').includes('forward'), 'default keys: W and the up arrow move forward');
check(bindings.actionsFor('Pad0').join() === 'jump', 'default pad: A jumps');
check(bindings.actionsFor('Mouse0').join() === 'fire' && bindings.actionsFor('WheelDown').join() === 'nextWeapon', 'default mouse: left fires, wheel down is the next weapon');
check(familyOf('Pad3') === FAMILIES.GAMEPAD && familyOf('Mouse0') === FAMILIES.KEYBOARD && familyOf('KeyA') === FAMILIES.KEYBOARD, 'controls sort into the keyboard and gamepad families');
check(controlLabel('KeyW') === 'W' && controlLabel('Digit1') === '1' && controlLabel('ShiftLeft') === 'LEFT SHIFT' && controlLabel('Mouse2') === 'RIGHT MOUSE' && controlLabel('Pad0', { Pad0: 'CROSS' }) === 'CROSS', 'control labels are readable');

let changes = 0;
bindings.subscribe(() => { changes++; });
const displaced = bindings.assign('jump', FAMILIES.KEYBOARD, 0, 'KeyF');
check(bindings.actionsFor('KeyF').join() === 'jump' && bindings.actionsFor('Space').length === 0, 'rebinding moves the control to the new key');
check(displaced.join() === 'melee' && bindings.controlsFor('melee', FAMILIES.KEYBOARD).length === 0, 'the action that had the key loses it, and the caller is told');
check(changes === 1, 'subscribers hear about the change');
check(bindings.assign('jump', FAMILIES.KEYBOARD, 0, 'Pad3').length === 0 && bindings.actionsFor('Pad3').join() !== 'jump', 'a pad button cannot go in a keyboard slot');
bindings.assign('jump', FAMILIES.KEYBOARD, 1, 'KeyJ');
check(bindings.slots('jump', FAMILIES.KEYBOARD).join() === 'KeyF,KeyJ', 'an action keeps a primary and a secondary control');
bindings.clear('jump', FAMILIES.KEYBOARD, 1);
check(bindings.controlsFor('jump', FAMILIES.KEYBOARD).join() === 'KeyF', 'a slot can be cleared');
bindings.reset(FAMILIES.KEYBOARD, 'jump');
check(bindings.actionsFor('Space').join() === 'jump', 'reset restores one action');
bindings.reset(FAMILIES.KEYBOARD);
check(bindings.actionsFor('KeyF').join() === 'melee', 'reset restores the whole family');

// Gamepad: assigning steals from the other action
bindings.assign('reload', FAMILIES.GAMEPAD, 0, 'Pad0');
check(bindings.actionsFor('Pad0').join() === 'reload' && bindings.controlsFor('jump', FAMILIES.GAMEPAD).length === 0, 'pad conflicts are resolved the same way');
bindings.applyPreset('BUMPER JUMPER', FAMILIES.GAMEPAD);
check(bindings.actionsFor('Pad4').join() === 'jump' && bindings.actionsFor('Pad5').join() === 'crouch', 'the bumper-jumper preset puts jump and crouch on the bumpers');
check(bindings.actionsFor('Pad0').join() === 'reload' && bindings.actionsFor('Pad3').includes('nextWeapon'), 'the preset leaves the other buttons on their defaults');
const everyPadControl = ACTIONS.flatMap((a) => bindings.controlsFor(a.id, FAMILIES.GAMEPAD));
check(new Set(everyPadControl).size === everyPadControl.length, 'the preset never binds one button twice');
bindings.applyPreset('DEFAULT', FAMILIES.GAMEPAD);
check(bindings.actionsFor('Pad0').join() === 'jump', 'the default preset restores the pad layout');
check(bindings.applyPreset('NO SUCH PRESET', FAMILIES.GAMEPAD) === false, 'an unknown preset is refused');

// Saving
const storage = memoryStorage();
const saver = new Bindings(ACTIONS, { storage, storageKey: 'b' });
saver.assign('fire', FAMILIES.KEYBOARD, 1, 'KeyX');
const loader = new Bindings(ACTIONS, { storage, storageKey: 'b' });
check(loader.actionsFor('KeyX').join() === 'fire', 'a changed layout is remembered');
storage.data.b = '{not json';
check(new Bindings(ACTIONS, { storage, storageKey: 'b' }).actionsFor('KeyW').includes('forward'), 'a corrupt save falls back to the defaults');
storage.data.b = JSON.stringify({ version: 1, layout: { jump: { keyboard: ['Pad9', 'KeyZ'], gamepad: 'oops' }, ghost: { keyboard: ['KeyQ'] } } });
const odd = new Bindings(ACTIONS, { storage, storageKey: 'b' });
check(odd.actionsFor('KeyZ').join() === 'jump' && odd.actionsFor('Pad9').join() === 'pause' && odd.controlsFor('jump', FAMILIES.GAMEPAD).join() === 'Pad0', 'bad entries in a save are ignored one by one');
const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
const blocked = new Bindings(ACTIONS, { storage: throwing });
blocked.assign('jump', FAMILIES.KEYBOARD, 0, 'KeyZ');
check(blocked.actionsFor('KeyZ').join() === 'jump', 'blocked storage does not break rebinding');

// The table itself
const ids = ACTIONS.map((a) => a.id);
check(new Set(ids).size === ids.length, 'action ids are unique');
for (const family of Object.values(FAMILIES)) {
  const seen = new Map();
  let clash = '';
  for (const action of ACTIONS) for (const control of action.defaults[family] ?? []) {
    if (seen.has(control)) clash = `${control} on ${seen.get(control)} and ${action.id}`;
    seen.set(control, action.id);
  }
  check(clash === '', `no default ${family} control is used twice ${clash}`);
}

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
