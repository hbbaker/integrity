import { load } from './support/modules.mjs';
const { GamepadInput, PAD, applyDeadzone } = await load('gamepad');
const { Bindings } = await load('bindings');
const { ActionInput } = await load('action-input');
const { ACTIONS } = await load('actions');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };

const button = (cls = []) => ({ classList: { add: (c) => cls.push(c), remove: (c) => cls.splice(cls.indexOf(c), 1), list: cls }, getClientRects: () => [1], clicked: 0 });
const buttons = [button(), button(), button()];
globalThis.document = { querySelectorAll: () => buttons };

const config = { deadzone: 0.18, moveThreshold: 0.35, triggerThreshold: 0.35, lookSpeed: 3.6, lookCurve: 1.8, invertY: false, navRepeat: 0.18 };
const makePad = () => ({ connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
const press = (pad, i, down = true) => { pad.buttons[i] = { pressed: down, value: down ? 1 : 0 }; };

const pad = makePad();
const input = { forward: false, back: false, left: false, right: false, sprintHeld: false, fireHeld: false, aimHeld: false, boardHeld: false, crouchHeld: false, leanLeft: false, leanRight: false, jumpPressed: false, slidePressed: false, sprintPressed: false, firePressed: false, ammoPressed: false, reloadPressed: false, meleePressed: false, wheel: 0 };
const log = { look: [], view: 0, pause: 0, engage: 0, confirmed: [] };
const bindings = new Bindings(ACTIONS);
const actionInput = new ActionInput({
  bindings, state: input,
  onCommand: (id, { down }) => {
    if (!down) return;
    if (id === 'toggleView') log.view++;
    if (id === 'pause') { log.pause++; gp.disengage(); }
  },
});
const gp = new GamepadInput({
  config: { ...config, moveStick: 'left' }, actionInput, state: input, mouseSensitivity: () => 0.0022, getPads: () => [pad],
  look: (dx, dy) => log.look.push([dx, dy]),
  engage: () => { log.engage++; gp.engaged = true; return true; }, confirm: (b) => log.confirmed.push(b),
});

check(applyDeadzone(0.1, 0.1, 0.18).length === 0, 'inside the dead zone gives nothing');
check(Math.abs(applyDeadzone(1, 0, 0.18).length - 1) < 1e-9, 'full tilt reaches 1');

// Menu mode: highlight and confirm
press(pad, PAD.DOWN); gp.poll(1 / 60, true);
check(gp.focused === buttons[0], 'first D-pad press highlights the first button');
press(pad, PAD.DOWN, false); gp.poll(1 / 60, true);
press(pad, PAD.DOWN); gp.poll(1 / 60, true);
check(gp.focused === buttons[1], 'next press moves to the next button');
press(pad, PAD.DOWN, false); press(pad, PAD.A); gp.poll(1 / 60, true);
check(log.confirmed[0] === buttons[1], 'A presses the highlighted button');
press(pad, PAD.A, false); gp.poll(1 / 60, true);
gp.clearFocus();
press(pad, PAD.A); gp.poll(1 / 60, true);
check(gp.engaged && log.engage === 1, 'A with nothing highlighted takes the game');
press(pad, PAD.A, false); gp.poll(1 / 60, true);

// Playing
pad.axes[0] = 0; pad.axes[1] = -1; gp.poll(1 / 60, true);
check(input.forward && !input.back, 'left stick up walks forward');
pad.axes[1] = 0; gp.poll(1 / 60, true);
check(!input.forward, 'releasing the stick stops');
input.forward = true; // the keyboard holds W
gp.poll(1 / 60, true);
check(input.forward, 'a steady pad does not cancel a held key');
input.forward = false;

press(pad, PAD.RT); pad.buttons[PAD.RT].value = 1; gp.poll(1 / 60, true);
check(input.fireHeld && input.firePressed, 'RT fires and latches a press');
press(pad, PAD.RT, false); gp.poll(1 / 60, true);
check(!input.fireHeld, 'letting go of RT stops firing');
pad.buttons[PAD.LT] = { pressed: false, value: 0.2 }; gp.poll(1 / 60, true);
check(!input.aimHeld, 'a light LT touch does not aim');
pad.buttons[PAD.LT] = { pressed: true, value: 0.9 }; gp.poll(1 / 60, true);
check(input.aimHeld, 'LT aims');
pad.buttons[PAD.LT] = { pressed: false, value: 0 }; gp.poll(1 / 60, true);

press(pad, PAD.A); gp.poll(1 / 60, true);
check(input.jumpPressed, 'A jumps');
press(pad, PAD.A, false); press(pad, PAD.B); gp.poll(1 / 60, true);
check(input.slidePressed && input.crouchHeld, 'B slides and crouches');
press(pad, PAD.B, false); gp.poll(1 / 60, true);
check(!input.crouchHeld, 'releasing B stands up');
press(pad, PAD.X); press(pad, PAD.R3); press(pad, PAD.UP); press(pad, PAD.DOWN); press(pad, PAD.Y); gp.poll(1 / 60, true);
check(input.reloadPressed && input.meleePressed && input.ammoPressed && input.wheel === 1 && log.view === 1, 'X reload, R3 melee, up ammo, down view, Y next weapon');
['X', 'R3', 'UP', 'DOWN', 'Y'].forEach((n) => press(pad, PAD[n], false));
press(pad, PAD.LEFT); gp.poll(1 / 60, true);
check(input.wheel === -1, 'D-pad left is the previous weapon');
press(pad, PAD.LEFT, false); press(pad, PAD.LB); press(pad, PAD.BACK); gp.poll(1 / 60, true);
check(input.leanLeft && input.boardHeld, 'LB leans left, BACK shows the scoreboard');
press(pad, PAD.LB, false); press(pad, PAD.BACK, false); gp.poll(1 / 60, true);
check(!input.leanLeft && !input.boardHeld, 'those release again');

// Sprint latch
pad.axes[1] = -1; press(pad, PAD.L3); gp.poll(1 / 60, true);
check(input.sprintHeld && input.sprintPressed, 'L3 with the stick pushed starts a sprint');
press(pad, PAD.L3, false); gp.poll(1 / 60, true);
check(input.sprintHeld, 'the sprint stays on while the stick is held');
pad.axes[1] = 0; gp.poll(1 / 60, true);
check(!input.sprintHeld, 'letting go of the stick ends the sprint');

// Look
log.look.length = 0; pad.axes[2] = 1; pad.axes[3] = 0; gp.poll(1 / 60, true);
const [dx] = log.look[0];
check(Math.abs(dx * 0.0022 - 3.6 / 60) < 1e-9, 'full right-stick tilt turns at lookSpeed');
log.look.length = 0; pad.axes[2] = 0.4; gp.poll(1 / 60, true);
check(log.look[0][0] * 0.0022 < (3.6 / 60) * 0.4, 'a small push turns less than linear (curve)');
log.look.length = 0; pad.axes[2] = 0.05; gp.poll(1 / 60, true);
check(log.look.length === 0, 'stick drift inside the dead zone does not turn');
pad.axes[2] = 0; pad.axes[3] = 1; log.look.length = 0; gp.poll(1 / 60, true);
check(log.look[0][1] > 0, 'right stick down looks down');

// Dead, pause, unplug
press(pad, PAD.RT); pad.buttons[PAD.RT].value = 1; gp.poll(1 / 60, true);
gp.poll(1 / 60, false);
check(!input.fireHeld && gp.engaged, 'dying lets go of the trigger but keeps the pad engaged');
press(pad, PAD.RT, false); gp.poll(1 / 60, true);
press(pad, PAD.RT); pad.buttons[PAD.RT].value = 1; gp.poll(1 / 60, true);
check(input.fireHeld, 'after respawn the trigger works again');
press(pad, PAD.START); gp.poll(1 / 60, true);
check(!gp.engaged && log.pause === 1 && !input.fireHeld, 'START pauses and releases everything');
press(pad, PAD.START, false); gp.poll(1 / 60, true);
press(pad, PAD.START); gp.poll(1 / 60, true);
check(gp.engaged, 'START resumes from the pause menu');
pad.connected = false; gp.poll(1 / 60, true);
check(!gp.engaged, 'unplugging the pad releases control');

// Rebinding and southpaw
pad.connected = true; ['A','START'].forEach((n) => press(pad, PAD[n], false)); gp.poll(1 / 60, true);
gp.engaged = true; gp.poll(1 / 60, true);
bindings.assign('jump', 'gamepad', 0, 'Pad4'); // LB now jumps
input.jumpPressed = false;
press(pad, PAD.LB); gp.poll(1 / 60, true);
check(input.jumpPressed && !input.leanLeft, 'a rebound button triggers its new action');
press(pad, PAD.LB, false); gp.poll(1 / 60, true);
bindings.reset('gamepad');
gp.config.moveStick = 'right';
pad.axes[0] = 0; pad.axes[1] = 0; pad.axes[2] = 0; pad.axes[3] = -1; gp.poll(1 / 60, true);
check(input.forward, 'southpaw: the right stick moves');
log.look.length = 0; pad.axes[3] = 0; pad.axes[0] = 1; gp.poll(1 / 60, true);
check(log.look.length === 1 && log.look[0][0] > 0, 'southpaw: the left stick looks');
gp.config.moveStick = 'left'; pad.axes[0] = 0; gp.poll(1 / 60, true);

// Menu navigation by position: a 3x2 grid, moves go to the nearest button in that direction
const cell = (col, row) => ({ ...button(), getBoundingClientRect: () => ({ left: col * 100, top: row * 60, width: 80, height: 40 }), name: `${col},${row}` });
const grid = [cell(0, 0), cell(1, 0), cell(2, 0), cell(0, 1), cell(1, 1), cell(2, 1)];
const realQuery = globalThis.document.querySelectorAll;
let lastSelector = '';
globalThis.document.querySelectorAll = (selector) => { lastSelector = selector; return grid; };
gp.engaged = false; gp.clearFocus(); pad.axes = [0, 0, 0, 0];
const tap = (index) => { press(pad, index); gp.poll(1 / 60, true); press(pad, index, false); gp.poll(1 / 60, true); };
tap(PAD.DOWN); // nothing highlighted yet: the first button
check(gp.focused === grid[0], 'with nothing highlighted, a move lands on the first button');
tap(PAD.RIGHT); tap(PAD.RIGHT);
check(gp.focused === grid[2], 'right moves along the row');
tap(PAD.DOWN);
check(gp.focused === grid[5], 'down moves to the button below');
tap(PAD.LEFT);
check(gp.focused === grid[4], 'left moves back along the row');
tap(PAD.UP);
check(gp.focused === grid[1], 'up moves to the button above');
tap(PAD.UP);
check(gp.focused === grid[0] || gp.focused === grid[5] || gp.focused === grid[1], 'moving past the edge wraps instead of getting stuck');
check(lastSelector.includes('button'), 'the default selector looks for overlay buttons');
gp.menuSelector = () => '#only-this';
tap(PAD.DOWN);
check(lastSelector === '#only-this', 'the selector can be a function, asked each time');
gp.menuSelector = '.overlay button:not([disabled])';
globalThis.document.querySelectorAll = realQuery;

// Rebinding from the pad while the settings screen waits for a button
gp.clearFocus();
let captured = null;
actionInput.beginCapture('gamepad', (control) => { captured = control; });
const jumpBefore = input.jumpPressed;
input.reloadPressed = false; // left over from earlier checks
press(pad, PAD.X); gp.poll(1 / 60, true);
check(captured === 'Pad2' && !actionInput.capturing, 'a pad button goes to the rebind request');
check(input.reloadPressed === false, 'and does not also trigger the action it is bound to');
press(pad, PAD.X, false); gp.poll(1 / 60, true);
actionInput.beginCapture('keyboard', () => { captured = 'wrong'; });
press(pad, PAD.Y); gp.poll(1 / 60, true);
check(captured === 'Pad2' && actionInput.capturing && input.jumpPressed === jumpBefore, 'a keyboard rebind request ignores pad buttons');
actionInput.cancelCapture();
press(pad, PAD.Y, false); gp.poll(1 / 60, true);

// B goes back, rumble respects the setting
let backs = 0;
const gpBack = new GamepadInput({
  config: { ...config, moveStick: 'left' }, actionInput, state: input, mouseSensitivity: () => 0.0022, getPads: () => [pad],
  look() {}, engage: () => false, confirm() {}, back: () => { backs += 1; }, vibration: () => wantRumble,
});
let wantRumble = true;
press(pad, PAD.B); gpBack.poll(1 / 60, true);
check(backs === 1, 'B in a menu calls back');
press(pad, PAD.B, false); gpBack.poll(1 / 60, true);
const effects = [];
pad.vibrationActuator = { playEffect: (type, options) => { effects.push([type, options]); return Promise.resolve(); } };
gpBack.rumble(0.2, 0.3, 0.9);
check(effects.length === 1 && effects[0][0] === 'dual-rumble' && effects[0][1].duration === 200 && effects[0][1].strongMagnitude === 0.9, 'rumble plays a dual-rumble effect');
wantRumble = false;
gpBack.rumble(0.2, 0.3, 0.9);
check(effects.length === 1, 'with vibration off, nothing rumbles');
delete pad.vibrationActuator;
gpBack.rumble(0.2, 0.3, 0.9);
check(true, 'a pad with no rumble motor is fine');

const nonStandard = makePad(); nonStandard.mapping = '';
const gp2 = new GamepadInput({ config, input, mouseSensitivity: 0.0022, getPads: () => [nonStandard], look() {}, toggleView() {}, pause() {}, engage: () => true, confirm() {} });
gp2.poll(1 / 60, true);
check(!gp2.connected, 'a pad without the standard layout is ignored');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
