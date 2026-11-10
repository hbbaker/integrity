import { load } from './support/modules.mjs';
import { installBrowser } from './support/browser-stub.mjs';

const browser = installBrowser();
const { Bindings, FAMILIES } = await load('bindings');
const { SettingsModel } = await load('settings-model');
const { ActionInput } = await load('action-input');
const { ACTIONS, ACTION_GROUPS, PAD_PRESETS } = await load('actions');
const { SETTING_DEFS, SETTING_GROUPS } = await load('settings-defs');
const { SettingsScreen } = await load('settings-screen');
const { OnScreenKeyboard } = await load('on-screen-keyboard');
const { padLabels, isPlayStationPad } = await load('pad-labels');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };

// --- the settings screen ---
const bindings = new Bindings(ACTIONS, { presets: PAD_PRESETS });
const settings = new SettingsModel(SETTING_DEFS);
const actionInput = new ActionInput({ bindings, state: {} });
let closed = 0;
const screen = new SettingsScreen({
  bindings, settings, actionInput, actions: ACTIONS, actionGroups: ACTION_GROUPS,
  settingDefs: SETTING_DEFS, settingGroups: SETTING_GROUPS, presets: PAD_PRESETS,
  padLabels: () => padLabels('Xbox Wireless Controller'), onClose: () => { closed += 1; },
});

const body = browser.element('settings-body');
const allButtons = (root) => root.children.flatMap((child) => [child, ...allButtons(child)]).filter((e) => e.listeners?.click);
const rowFor = (label) => body.children.find((row) => row.children?.[0]?.textContent === label);
const slotButtons = (row) => row.children.filter((c) => c.className.includes('set-slot'));

screen.open();
check(browser.element('overlay-settings').style.display === 'flex' && screen.isOpen, 'open shows the screen');
const rows = body.children.filter((c) => c.className === 'set-row');
check(rows.length === ACTIONS.length, `the keyboard tab has a row for each of the ${ACTIONS.length} actions`);
const jump = rowFor('JUMP');
check(slotButtons(jump)[0].textContent === 'SPACE' && slotButtons(jump)[1].textContent === '—', 'a row shows the bound key and an empty second slot');
check(rowFor('MOVE FORWARD') && slotButtons(rowFor('MOVE FORWARD')).map((b) => b.textContent).join() === 'W,UP', 'two keys on one action are both shown');

// Rebinding by key
slotButtons(jump)[0].listeners.click[0]({ stopPropagation() {} });
check(slotButtons(jump)[0].textContent === 'PRESS A KEY…' && actionInput.capturing, 'clicking a slot asks for a key');
actionInput.press('KeyF');
check(bindings.actionsFor('KeyF').join() === 'jump' && slotButtons(jump)[0].textContent === 'F' && !actionInput.capturing, 'the next key is bound and shown');
check(/MOVED FROM MELEE/.test(browser.element('settings-message').textContent), 'taking a used key tells the player what lost it');
check(slotButtons(rowFor('MELEE'))[0].textContent === '—', 'and the other row updates without a rebuild');

// Escape cancels
slotButtons(jump)[1].listeners.click[0]({ stopPropagation() {} });
check(screen.onEscape() === true && !actionInput.capturing && screen.isOpen, 'Escape cancels a rebind first, and keeps the screen open');
check(slotButtons(jump)[1].textContent === '—', 'the slot shows what it had');

// Capture times out
slotButtons(jump)[1].listeners.click[0]({ stopPropagation() {} });
await new Promise((resolve) => setTimeout(resolve, 6200));
check(!actionInput.capturing && slotButtons(jump)[1].textContent === '—', 'waiting too long cancels the rebind (this is how a pad cancels)');

// CLEAR
jump.children.find((c) => c.className.includes('set-clear')).listeners.click[0]({ stopPropagation() {} });
check(bindings.controlsFor('jump', FAMILIES.KEYBOARD).length === 0 && slotButtons(jump)[0].textContent === '—', 'CLEAR empties both slots');

// Gamepad tab
const gamepadTab = screen.tabButtons.find((t) => t.id === 'gamepad').element;
gamepadTab.listeners.click[0]({ stopPropagation() {} });
check(body.children.some((c) => c.textContent === 'LAYOUT' || c.children?.[0]?.textContent === 'LAYOUT'), 'the gamepad tab offers layouts');
const padJump = rowFor('JUMP');
check(slotButtons(padJump)[0].textContent === 'A', 'pad buttons show Xbox names');
slotButtons(padJump)[0].listeners.click[0]({ stopPropagation() {} });
check(slotButtons(padJump)[0].textContent === 'PRESS A BUTTON…', 'a pad slot asks for a button');
actionInput.press('Pad4');
check(bindings.actionsFor('Pad4').join() === 'jump' && slotButtons(rowFor('LEAN LEFT'))[0].textContent === '—', 'a pad button is bound and the old owner loses it');
const bumper = allButtons(body).find((b) => b.textContent === 'BUMPER JUMPER');
bumper.listeners.click[0]({ stopPropagation() {} });
check(bindings.actionsFor('Pad4').join() === 'jump' && bindings.actionsFor('Pad5').join() === 'crouch', 'a layout button applies the preset');
browser.element('settings-reset').listeners.click[0]({ stopPropagation() {} });
check(bindings.actionsFor('Pad0').join() === 'jump', 'RESET THIS TAB restores the pad layout');
check(bindings.controlsFor('jump', FAMILIES.KEYBOARD).length === 0, 'and leaves the keyboard tab alone');

// Sensitivity tab
screen.tabButtons.find((t) => t.id === 'sensitivity').element.listeners.click[0]({ stopPropagation() {} });
const mouseRow = rowFor('MOUSE SENSITIVITY');
const [minus, valueEl, plus] = mouseRow.children.slice(1);
check(valueEl.textContent === '1.00', 'a slider row shows its value');
plus.listeners.click[0]({ stopPropagation() {} });
check(Math.abs(settings.get('mouseSensitivity') - 1.05) < 1e-9 && valueEl.textContent === '1.05', 'plus raises it by one step');
for (let i = 0; i < 100; i++) minus.listeners.click[0]({ stopPropagation() {} });
check(settings.get('mouseSensitivity') === 0.2 && valueEl.textContent === '0.20', 'minus stops at the minimum');
const invert = rowFor('INVERT MOUSE Y').children[1];
invert.listeners.click[0]({ stopPropagation() {} });
check(settings.get('invertMouseY') === true && invert.textContent === 'ON', 'a switch toggles');
const stick = rowFor('MOVE STICK').children[1];
check(stick.textContent === 'LEFT STICK', 'a choice shows its current option');
stick.listeners.click[0]({ stopPropagation() {} });
check(settings.get('padMoveStick') === 'right' && stick.textContent === 'RIGHT STICK (SOUTHPAW)', 'a choice cycles to the next option');
check(rowFor('VIBRATION') !== undefined, 'vibration can be switched off');
browser.element('settings-reset').listeners.click[0]({ stopPropagation() {} });
check(settings.get('mouseSensitivity') === 1 && settings.get('padMoveStick') === 'left', 'RESET THIS TAB restores the settings');

browser.element('settings-back').listeners.click[0]({ stopPropagation() {} });
check(!screen.isOpen && closed === 1 && browser.element('overlay-settings').style.display === 'none', 'BACK closes the screen and tells the game');

// --- pad labels ---
check(padLabels('Xbox Wireless Controller (STANDARD GAMEPAD)').Pad0 === 'A' && padLabels('Xbox').Pad9 === 'MENU', 'Xbox pads use letters');
check(isPlayStationPad('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)') && padLabels('054c').Pad0 === 'CROSS' && padLabels('DualShock 4').Pad2 === 'SQUARE' && padLabels('Sony').Pad9 === 'OPTIONS', 'PlayStation pads use shapes');
check(padLabels('').Pad0 === 'A', 'an unknown pad gets Xbox names');

// --- on-screen keyboard ---
const osk = new OnScreenKeyboard();
const field = { value: '', events: 0, dispatchEvent() { this.events += 1; } };
let done = 0;
osk.open(field, { maxLength: 5, onDone: () => { done += 1; } });
const keyButtons = allButtons(browser.element('osk-keys'));
const key = (label) => keyButtons.find((b) => b.textContent === label);
const press = (label) => key(label).listeners.click[0]({ stopPropagation() {} });
check(osk.isOpen && browser.element('overlay-osk').style.display === 'flex', 'the keyboard opens');
press('A'); press('D'); press('A');
check(field.value === 'ADA' && field.events === 3, 'keys type into the field and tell the page');
press('aA'); press('b'); // the letter keys now show lowercase
check(field.value === 'ADAb', 'the case key switches to lowercase');
press('⌫');
check(field.value === 'ADA', 'backspace removes a letter');
press('SPACE'); press('_'); press('9');
check(field.value === 'ADA _' && browser.element('osk-text').textContent === 'ADA _', 'space and symbols are typed, and the limit holds');
press('DONE');
check(!osk.isOpen && done === 1, 'DONE closes it and tells the game');
osk.open(field, {}); osk.cancel();
check(!osk.isOpen, 'cancel closes it and keeps the text');
check(keyButtons.length >= 40, 'the keyboard has letters, digits, symbols and control keys');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
