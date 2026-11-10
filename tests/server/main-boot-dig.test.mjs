/*
 * Boots the real game/main.js against the running game server and plays a solo DIG SITE round start to finish:
 * the menu button, the connection, the server's map, frames with the dig mode running, and leaving.
 */
import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../support/modules.mjs';

register('../support/three-hooks.mjs', import.meta.url);
const { installBrowser } = await import('../support/browser-stub.mjs');
const browser = installBrowser({ realWebSocket: true, host: `localhost:${process.env.TEST_PORT || 18123}` });

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await import(pathToFileURL(path.join(ROOT, 'game/main.js')).href);
let clock = 1000;
const frames = (n) => { for (let i = 0; i < n; i++) { clock += 16.7; browser.frame(clock); } };
const canvas = browser.element('game');
const visible = (id) => browser.element(id).style.display !== 'none';
const digging = () => document.body.classList.contains('dig-mode');

frames(3);
browser.element('mode-sandbox').click();
browser.element('solo-dig').click();
let ready = false;
for (let i = 0; i < 40 && !ready; i++) { // wait for the server's map, which starts the match
  await wait(100);
  frames(1);
  ready = digging();
}
check(ready, 'a solo DIG SITE match starts from the menu (the server sent the map)');
if (ready) {
  browser.lockPointer(canvas);
  browser.fire('pointerlockchange');
  let ok = true;
  try {
    browser.fire('keydown', { code: 'KeyW', target: {} });
    browser.fire('mousedown', { button: 0 });
    frames(120);
    browser.fire('mouseup', { button: 0 });
    browser.fire('keyup', { code: 'KeyW', target: {} });
    frames(30);
  } catch (error) {
    ok = false;
    check(false, `the dig mode runs: ${error.stack.split('\n').slice(0, 4).join(' | ')}`);
  }
  if (ok) check(true, 'frames ran in the dig mode with movement and the dig control held');
  browser.element('start-menu').click();
  frames(3);
  check(visible('overlay-start') && !digging(), 'MAIN MENU leaves the match and shows the mode menu');
}

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
