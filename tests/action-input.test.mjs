import { load } from './support/modules.mjs';
const { Bindings, FAMILIES } = await load('bindings');
const { ActionInput } = await load('action-input');
const { DeviceInput } = await load('device-input');
const { ACTIONS } = await load('actions');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };

const bindings = new Bindings(ACTIONS);
const state = { forward: false, jumpPressed: false, fireHeld: false, firePressed: false, wheel: 0, selectSlot: -1, sprintHeld: false, sprintPressed: false };
const commands = [];
const input = new ActionInput({ bindings, state, onCommand: (id, info) => commands.push([id, info.down, info.gateOpen]) });

input.press('KeyW');
check(state.forward === true, 'a bound key holds its field');
input.press('ArrowUp');
input.release('KeyW');
check(state.forward === true, 'the field stays held while another control for the action is down');
input.release('ArrowUp');
check(state.forward === false, 'and ends when the last one is released');

input.press('Space');
check(state.jumpPressed === true, 'a press action sets its field');
input.press('Mouse0');
check(state.fireHeld && state.firePressed, 'fire holds and presses at once');
input.press('WheelUp');
check(state.wheel === -1, 'a press action can carry a value');
input.press('Digit3');
check(state.selectSlot === 2 && commands.some(([id]) => id === 'slot3'), 'slot keys set the slot and also report a command');

state.fireHeld = false; state.jumpPressed = false;
input.press('Space', { gateOpen: false });
input.press('Mouse0', { gateOpen: false });
check(!state.jumpPressed && !state.fireHeld, 'with the gate shut, hold and press actions are ignored');
input.press('KeyM', { gateOpen: false });
check(commands.some(([id, down, gate]) => id === 'mute' && down && gate === false), 'commands still fire with the gate shut, and say so');

input.press('KeyW'); input.press('ShiftLeft');
input.releaseAll();
check(!state.forward && !state.sprintHeld, 'releaseAll lets go of everything');

// Rebinding capture
let captured = null;
input.beginCapture(FAMILIES.KEYBOARD, (control) => { captured = control; });
check(input.capturing && input.press('KeyZ') && captured === 'KeyZ' && !input.capturing, 'capture takes the next key and ends');
input.beginCapture(FAMILIES.KEYBOARD, (control) => { captured = control; });
input.press('Pad0');
check(input.capturing, 'a keyboard capture ignores pad buttons');
input.cancelCapture();
check(!input.capturing, 'capture can be cancelled');

// DeviceInput: events in, actions out
const listeners = {};
const target = { addEventListener: (name, fn) => { listeners[name] = fn; } };
const looks = [];
let gate = true;
let escapes = 0;
const devices = new DeviceInput({
  actionInput: input, gateOpen: () => gate, target, onLook: (dx, dy) => looks.push([dx, dy]),
  onEscape: () => { escapes++; return true; }, ignoreEvent: (e) => e.typing === true,
});
devices.attach();
const fire = (name, event) => { const e = { preventDefault() { e.prevented = true; }, ...event }; listeners[name](e); return e; };
state.forward = false;
const down = fire('keydown', { code: 'KeyW' });
check(state.forward && down.prevented, 'a keydown reaches the action and stops the browser default');
fire('keydown', { code: 'KeyW', repeat: true });
fire('keyup', { code: 'KeyW' });
check(!state.forward, 'a keyup releases it');
fire('keydown', { code: 'KeyW', typing: true });
check(!state.forward, 'typing in a text field is ignored');
gate = false;
fire('keydown', { code: 'KeyW' });
check(!state.forward, 'a shut gate blocks keys');
gate = true;
fire('wheel', { deltaY: 100 });
check(state.wheel === 1, 'wheel down is the next weapon');
fire('mousemove', { movementX: 5, movementY: -3 });
check(looks.length === 1 && looks[0][0] === 5, 'mouse movement becomes look while the gate is open');
gate = false;
fire('mousemove', { movementX: 1, movementY: 1 });
check(looks.length === 1, 'and not while it is shut');
gate = true;
fire('keydown', { code: 'Escape' });
check(escapes === 1, 'Escape goes to the game, not the bindings');
input.beginCapture(FAMILIES.KEYBOARD, () => {});
fire('keydown', { code: 'Escape' });
check(!input.capturing, 'Escape cancels a capture');
check(!!fire('contextmenu', {}).prevented, 'the right-click menu is suppressed');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
