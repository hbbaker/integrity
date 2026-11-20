/*
 * Starts the real game/main.js in Node with browser stand-ins (as main-boot.test.mjs does) and plays the
 * mountain mode from the menu. It checks the wiring: any import, constructor or per-frame error fails it.
 */
import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './support/modules.mjs';

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

await import(pathToFileURL(path.join(ROOT, 'game/main.js')).href);
let clock = 1000;
const frames = (count) => { for (let i = 0; i < count; i++) { clock += 16.7; browser.frame(clock); } };
const visible = (id) => browser.element(id).style.display !== 'none';
const inSkiMode = () => globalThis.document.body.classList.contains('ski-mode');
const canvas = browser.element('game');

step('menu frames', () => frames(3));
step('open the mountain menu', () => browser.element('mode-ski').click());
check(visible('overlay-ski') && !visible('overlay-start'), 'should show the course menu in place of the mode menu when MOUNTAIN is pressed');
step('back', () => browser.element('ski-back').click());
check(!visible('overlay-ski') && visible('overlay-start'), 'should return to the mode menu when BACK is pressed');

step('start freeride', () => {
  browser.element('mode-ski').click();
  browser.element('ski-freeride').click();
  browser.lockPointer(canvas);
  browser.fire('pointerlockchange');
  frames(30);
});
check(!visible('overlay-ski') && !visible('overlay-start'), 'should close the menus when a course starts');
check(inSkiMode(), 'should switch the page to the mountain HUD when a course starts');
step('look, keys and frames on the mountain', () => {
  browser.fire('mousemove', { movementX: 60, movementY: -20 });
  browser.fire('keydown', { code: 'KeyW', target: {} });
  browser.fire('keydown', { code: 'Space', target: {} });
  browser.fire('keydown', { code: 'Digit2', target: {} });
  browser.fire('mousedown', { button: 0 });
  frames(90);
  browser.fire('mouseup', { button: 0 });
  browser.fire('keyup', { code: 'KeyW', target: {} });
});
step('pause and resume', () => {
  browser.lockPointer(null);
  browser.fire('pointerlockchange');
  frames(3);
  browser.lockPointer(canvas);
  browser.fire('pointerlockchange');
  frames(10);
});
step('main menu', () => { browser.element('start-menu').click(); frames(5); });
check(!inSkiMode() && visible('overlay-start'), 'should give back the combat HUD and show the mode menu when the run is left');
step('another mode after the mountain', () => {
  browser.element('mode-waves').click();
  browser.lockPointer(canvas);
  browser.fire('pointerlockchange');
  frames(60);
});
check(!inSkiMode() && browser.element('weapon-name').textContent.length > 0, 'should run the wave game normally after a mountain run');
step('the mountain again', () => {
  browser.element('start-menu').click();
  browser.element('mode-ski').click();
  browser.element('ski-freeride').click();
  browser.lockPointer(canvas);
  browser.fire('pointerlockchange');
  frames(30);
});
check(inSkiMode(), 'should start a second mountain run');
step('ride the board', () => {
  browser.element('start-menu').click();
  browser.element('mode-ski').click();
  browser.element('ski-ride-board').click();
  browser.element('ski-freeride').click();
  browser.lockPointer(canvas);
  browser.fire('pointerlockchange');
  browser.fire('keydown', { code: 'KeyW', target: {} });
  frames(240);
  browser.fire('keydown', { code: 'KeyD', target: {} });
  frames(60);
  browser.fire('keyup', { code: 'KeyD', target: {} });
  browser.fire('keydown', { code: 'KeyS', target: {} });
  frames(60);
  browser.fire('keyup', { code: 'KeyS', target: {} });
  browser.fire('keyup', { code: 'KeyW', target: {} });
  browser.fire('keydown', { code: 'KeyR', target: {} });
  frames(10);
  browser.fire('keyup', { code: 'KeyR', target: {} });
});
check(browser.element('ski-ride-board').classList.contains('active') && !browser.element('ski-ride-skis').classList.contains('active'), 'should mark the chosen ride in the menu');
check(Number(browser.element('ski-speed').textContent) >= 0 && browser.element('ski-time').textContent === '0:00.0', 'should show the speed, and a clock at zero after "start again"');

// A crash in the real game: ride, carve, brake, then set the other edge during the brake.
await new Promise((resolve) => setTimeout(resolve, 500)); // the physics library loads in the background
let speedBeforeCrash = 0;
step('crash and get up', () => {
  browser.fire('keydown', { code: 'KeyW', target: {} });
  frames(60 * 12); // off the start bench and well into the open bowl, in a tuck
  browser.fire('keyup', { code: 'KeyW', target: {} });
  speedBeforeCrash = Number(browser.element('ski-speed').textContent);
  browser.fire('keydown', { code: 'KeyD', target: {} });
  frames(25);
  browser.fire('keyup', { code: 'KeyD', target: {} });
  browser.fire('keydown', { code: 'KeyS', target: {} });
  frames(8);
  browser.fire('keydown', { code: 'KeyA', target: {} });
  frames(40);
});
check(browser.element('ski-alert').textContent === 'CRASH', `should crash when the other edge is set during a brake (at ${speedBeforeCrash} km/h)`);
step('the ragdoll frames', () => {
  browser.fire('keyup', { code: 'KeyA', target: {} });
  browser.fire('keyup', { code: 'KeyS', target: {} });
  frames(60 * 8);
});
check(browser.element('ski-alert').textContent === '', 'should get the rider up again');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
