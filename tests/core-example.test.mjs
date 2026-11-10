/*
 * Runs core/examples/minimal-game.js, the example in core/README.md, to prove the core works on its own:
 * a second game built from the core pieces, with no game/ code involved.
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

const { startMinimalGame } = await import(pathToFileURL(path.join(ROOT, 'core/examples/minimal-game.js')).href);
const game = startMinimalGame(browser.element('game'));
let clock = 1000;
const frames = (n) => { for (let i = 0; i < n; i++) { clock += 16.7; browser.frame(clock); } };

check(game.modes.id === 'free-roam', 'the example starts its mode');
frames(30);
check(game.crate.rotation.y > 0.3, 'the loop runs the mode every step');
const startX = game.crate.position.x;
browser.fire('keydown', { code: 'KeyD', target: {} });
frames(60);
browser.fire('keyup', { code: 'KeyD', target: {} });
check(game.crate.position.x - startX > 2, 'a key moves the crate through the bindings, at the speed setting');
game.settings.set('speed', 10);
const before = game.crate.position.x;
browser.fire('keydown', { code: 'ArrowRight', target: {} });
frames(60);
browser.fire('keyup', { code: 'ArrowRight', target: {} });
check(game.crate.position.x - before > 8, 'changing a setting changes the speed');
game.bindings.assign('right', 'keyboard', 0, 'KeyL');
const rebound = game.crate.position.x;
browser.fire('keydown', { code: 'KeyD', target: {} });
frames(30);
check(game.crate.position.x === rebound, 'after a rebind the old key does nothing');
browser.fire('keydown', { code: 'KeyL', target: {} });
frames(30);
check(game.crate.position.x > rebound, 'and the new key works');
check(browser.storage.has('minimal-bindings') && browser.storage.has('minimal-settings'), 'bindings and settings are saved');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
