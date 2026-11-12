/*
 * The suit's holographic HUD and the "use" prompt, and the developer flag the server hands the page.
 */
import { load, loadConfig, installDomStubs } from './support/modules.mjs';

installDomStubs();

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };

const fakeElement = () => {
  const classes = new Set();
  return {
    style: {}, textContent: '', innerHTML: '', offsetWidth: 0, classes,
    classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)), add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
    appendChild() {}, addEventListener() {},
  };
};
const elements = new Map();
globalThis.document.getElementById = (id) => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); };

const { Hud } = await load('hud');
const { loadDevFlag, DEV_FLAG_URL } = await load('dev-flag');
const CONFIG = await loadConfig();
const hud = new Hud(CONFIG);
const root = elements.get('hud');
const holo = elements.get('suit-holo');

check(!root.classes.has('suit-hud'), 'the HUD starts as a normal HUD');
hud.setSuitMode(true);
check(root.classes.has('suit-hud') && holo.classes.has('boot'), 'inside the suit the HUD gets the hologram look and the boot-up flash');
hud.setSuitMode(false);
check(!root.classes.has('suit-hud'), 'out of the suit it goes back');

hud.setPrompt('V  ENTER SUIT');
const prompt = elements.get('prompt');
check(prompt.textContent === 'V  ENTER SUIT' && prompt.style.display === 'block', 'the prompt shows its text');
hud.setPrompt(null);
check(prompt.style.display === 'none' && prompt.textContent === '', 'a null prompt hides it');

// ---- the developer flag ----
check(DEV_FLAG_URL === '/dev-flag.json', 'the page asks the server at /dev-flag.json');
check(await loadDevFlag(async () => ({ dev: true })) === true, 'the server saying dev is true turns developer mode on');
check(await loadDevFlag(async () => ({ dev: false })) === false, 'the server saying dev is false leaves it off');
check(await loadDevFlag(async () => ({ dev: 'yes' })) === false, 'an odd answer leaves it off');
check(await loadDevFlag(async () => { throw new Error('no server'); }) === false, 'no server leaves it off');

process.exit(fails ? 1 : 0);
