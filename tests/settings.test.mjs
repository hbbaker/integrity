import { load } from './support/modules.mjs';
const { SettingsModel } = await load('settings-model');
const { SETTING_DEFS } = await load('settings-defs');
const { createSettingsApplier } = await load('settings-apply');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const memoryStorage = () => { const data = {}; return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, data }; };

const settings = new SettingsModel(SETTING_DEFS);
check(settings.get('mouseSensitivity') === 1 && settings.get('padMoveStick') === 'left' && settings.get('invertMouseY') === false, 'defaults');
check(settings.set('mouseSensitivity', 99) === 3 && settings.set('mouseSensitivity', -5) === 0.2, 'sliders clamp to their range');
check(Math.abs(settings.set('padLookSpeed', 3.14159) - 3.1) < 1e-9, 'sliders snap to their step');
check(settings.set('mouseSensitivity', 'abc') === 1, 'a value that is not a number falls back to the default');
check(settings.set('invertMouseY', 1) === true && settings.set('invertMouseY', 0) === false, 'switches are true or false');
check(settings.set('padMoveStick', 'right') === 'right' && settings.set('padMoveStick', 'up') === 'left', 'a choice outside the list falls back to the default');
check(settings.set('nonsense', 1) === undefined, 'an unknown setting is ignored');

const heard = [];
settings.subscribe((id) => heard.push(id));
settings.set('adsSensitivity', 0.5);
settings.set('adsSensitivity', 0.5);
check(heard.join() === 'adsSensitivity', 'subscribers hear one change, and none when the value is the same');
settings.reset('adsSensitivity');
check(settings.get('adsSensitivity') === 0.9, 'reset restores one setting');
settings.set('mouseSensitivity', 2);
settings.reset();
check(settings.get('mouseSensitivity') === 1, 'reset restores everything');

const storage = memoryStorage();
const saved = new SettingsModel(SETTING_DEFS, { storage, storageKey: 's' });
saved.set('padLookSpeed', 5);
check(new SettingsModel(SETTING_DEFS, { storage, storageKey: 's' }).get('padLookSpeed') === 5, 'settings are remembered');
storage.data.s = JSON.stringify({ version: 1, values: { padLookSpeed: 9999, ghost: 1 } });
check(new SettingsModel(SETTING_DEFS, { storage, storageKey: 's' }).get('padLookSpeed') === 8, 'a saved value is clamped when loaded');
storage.data.s = 'garbage';
check(new SettingsModel(SETTING_DEFS, { storage, storageKey: 's' }).get('padLookSpeed') === 3.6, 'a corrupt save gives the defaults');

const config = { player: { mouseSensitivity: 0.002, adsSensitivity: 0.9 }, gamepad: {} };
const live = new SettingsModel(SETTING_DEFS);
const apply = createSettingsApplier(config, live);
apply();
check(config.player.mouseSensitivity === 0.002, 'the default multiplier leaves the designed sensitivity');
live.set('mouseSensitivity', 2); apply();
live.set('mouseSensitivity', 2); apply();
check(Math.abs(config.player.mouseSensitivity - 0.004) < 1e-12, 'a multiplier never compounds when applied twice');
live.set('padMoveStick', 'right'); live.set('padInvertY', true); apply();
check(config.gamepad.moveStick === 'right' && config.gamepad.invertY === true && config.gamepad.deadzone === 0.18, 'pad settings reach the pad config');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
