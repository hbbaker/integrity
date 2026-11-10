/*
 * Starts the real game/main.js (the page's entry point) in Node with browser stand-ins, starts a game, and runs
 * frames with keyboard and pad input. It checks wiring, not looks: any import, constructor or per-frame error fails it.
 */
import { register } from 'node:module';
import { ROOT, MODULE_PATHS } from './support/modules.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

register('./support/three-hooks.mjs', import.meta.url);
const { installBrowser } = await import('./support/browser-stub.mjs');
const browser = installBrowser();

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const step = (label, run) => {
  try {
    run();
    return true;
  } catch (error) {
    check(false, `${label}: ${error.stack.split('\n').slice(0, 4).join(' | ')}`);
    return false;
  }
};

const mainPath = path.join(ROOT, MODULE_PATHS.main ?? 'game/main.js');
let loaded = true;
try {
  await import(pathToFileURL(mainPath).href);
} catch (error) {
  loaded = false;
  check(false, `main.js loads: ${error.stack.split('\n').slice(0, 5).join(' | ')}`);
}
if (loaded) {
  check(true, 'main.js loads and queues its first frame');
  let clock = 1000;
  const frames = (n) => { for (let i = 0; i < n; i++) { clock += 16.7; browser.frame(clock); } };

  step('menu frames', () => frames(5));
  const canvas = browser.element('game');
  step('start the wave game', () => browser.element('mode-waves').click());
  browser.lockPointer(canvas);
  step('pointer lock', () => browser.fire('pointerlockchange'));
  step('wave frames', () => frames(60));
  check(browser.element('overlay-start').style.display === 'none', 'starting a mode hides the mode menu');
  check(browser.element('weapon-name').textContent.length > 0, 'the HUD shows the equipped weapon');
  step('keyboard', () => {
    browser.fire('keydown', { code: 'KeyW', target: {} });
    browser.fire('keydown', { code: 'Space', target: {} });
    browser.fire('mousedown', { button: 0 });
    browser.fire('mousemove', { movementX: 40, movementY: -10 });
    browser.fire('wheel', { deltaY: 100 });
    frames(40);
    browser.fire('mouseup', { button: 0 });
    browser.fire('keyup', { code: 'KeyW', target: {} });
  });
  step('pause menu', () => { browser.lockPointer(null); browser.fire('pointerlockchange'); frames(3); });

  // A pad takes over from the menu
  const pad = { id: 'Xbox Wireless Controller', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  browser.pads.push(pad);
  step('pad: START resumes', () => { pad.buttons[9] = { pressed: true, value: 1 }; frames(2); pad.buttons[9] = { pressed: false, value: 0 }; frames(2); });
  step('pad: sticks and triggers', () => {
    pad.axes[1] = -1; pad.axes[2] = 0.6;
    pad.buttons[7] = { pressed: true, value: 1 };
    frames(40);
    pad.buttons[7] = { pressed: false, value: 0 };
    pad.axes[1] = 0; pad.axes[2] = 0;
    frames(5);
  });
  check(true, 'frames ran with keyboard and pad input');

  // Every mode starts, runs, and returns to the menu
  const visible = (id) => browser.element(id).style.display !== 'none';
  const play = (label, open, frameCount = 90) => step(label, () => {
    browser.element('start-menu').click(); // back to the main menu first
    for (const click of open) browser.element(click).click();
    browser.lockPointer(canvas);
    browser.fire('pointerlockchange');
    frames(frameCount);
  });
  play('sandbox', ['mode-sandbox', 'solo-sandbox']);
  check(!visible('overlay-solo') && !visible('overlay-start'), 'sandbox starts and the menus close');
  play('deathmatch vs bots', ['mode-sandbox', 'solo-bots'], 400);
  play('wave game again', ['mode-waves']);
  step('main menu', () => { browser.element('start-menu').click(); frames(3); });
  check(visible('overlay-start'), 'MAIN MENU shows the mode menu again');
}

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
