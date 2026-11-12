/*
 * The character screen: weapon slots with a hover list, the suit slot, and the DEV tab
 * that only exists in developer mode.
 */
import { load, loadConfig, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { World } = await load('world');
const { Player } = await load('player');
const { Weapons } = await load('weapons');
const { Enemies } = await load('enemies');
const { createEffects } = await load('effects');
const { SuitState } = await load('suit-state');
const { SUIT_PARTS } = await load('suit-parts');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };
const noop = () => {};

// ---- a page made of plain objects: elements keep their handlers, markup and style ----
const elements = {};
const element = () => {
  const handlers = {};
  return { style: {}, innerHTML: '', handlers, addEventListener(type, fn) { handlers[type] = fn; } };
};
for (const id of ['character', 'char-tabs', 'char-slots', 'char-flyout', 'char-left', 'char-preview', 'char-suit', 'char-dev', 'char-main']) elements[id] = element();
globalThis.document.getElementById = (id) => elements[id];
const { CharacterScreen } = await load('character-screen');

const hit = (selector, dataset = {}) => ({ target: { closest: (asked) => (asked === selector ? { dataset } : null) } });
const click = (selector, dataset) => elements.character.handlers.click(hit(selector, dataset));
const hover = (slot) => elements.character.handlers.pointerover(hit('[data-slot]', { slot: String(slot) }));

const CONFIG = await loadConfig();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 200);
const fx = createEffects(scene);
const world = new World(scene, CONFIG);
const player = new Player(camera, world, CONFIG.player);
const hud = new Proxy({}, { get: () => noop });
const audio = new Proxy({}, { get: () => noop });
const enemies = new Enemies({ cfg: CONFIG, scene, world, fx, player });
const weapons = new Weapons({ cfg: CONFIG, camera, mainScene: scene, world, enemies, player, fx, hud, audio });
const memory = new Map();
const suitState = new SuitState({ getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) });

const log = { resumed: 0, placed: 0, pickedUp: 0, exited: 0, preview: [] };
const preview = { start: () => log.preview.push('start'), stop: () => log.preview.push('stop'), showSuit: (on) => { log.suitShown = on; }, setPart: (slot, id) => log.preview.push(`${slot}:${id}`) };
let canPlace = true;
let canPickUp = true;
const screen = new CharacterScreen({
  weapons,
  suitState,
  suitActions: { canPlace: () => canPlace, place: () => { log.placed++; }, canPickUp: () => canPickUp, pickUp: () => { log.pickedUp++; }, exit: () => { log.exited++; } },
  onResume: () => { log.resumed++; },
  createPreview: () => preview,
});

weapons.reset();
screen.open();
check(screen.isOpen && elements.character.style.display === 'flex', 'opening shows the screen');
check(log.preview[0] === 'start', 'the turntable starts drawing');
check((elements['char-slots'].innerHTML.match(/data-slot=/g) ?? []).length === 3, 'three weapon slots are shown');
check(!elements['char-tabs'].innerHTML.includes('data-tab="dev"'), 'there is no DEV tab in normal mode');
check(elements['char-flyout'].style.display === 'none', 'no weapon list is open until a slot is hovered');

// ---- hovering a slot and picking a weapon ----
const armory = weapons.armory();
const other = armory.find((info) => !weapons.loadout.includes(info.index));
hover(1);
check(elements['char-flyout'].style.display === 'flex' && elements['char-flyout'].innerHTML.includes('SLOT 2'), 'hovering slot 2 opens the weapon list for slot 2');
click('[data-gun]', { gun: String(other.index) });
check(weapons.loadout[1] === other.index, 'clicking a weapon in the list fits it into the hovered slot');
elements['char-left'].handlers.pointerleave();
check(elements['char-flyout'].style.display === 'none', 'moving the pointer away closes the list');
const slotNow = weapons.loadout.slice();
screen.selectSlot(5);
check(weapons.loadout.join() === slotNow.join(), 'a slot that does not exist is ignored');

// ---- the suit panel ----
check(elements['char-suit'].innerHTML.includes('EQUIP SUIT'), 'with no suit the panel offers to equip one');
click('[data-action]', { action: 'equip' });
check(suitState.owned && elements['char-suit'].innerHTML.includes('DROP BEACON') && !elements['char-suit'].innerHTML.includes('disabled'), 'equipping the suit offers a beacon to call it down');
canPlace = false;
screen.render();
check(elements['char-suit'].innerHTML.includes('disabled'), 'while the suit cannot be called the beacon button is disabled');
canPlace = true;
click('[data-action]', { action: 'place' });
check(log.placed === 1, 'the drop beacon button asks the game to put a beacon in your hand');
click('[data-action]', { action: 'customize' });
check(elements['char-suit'].innerHTML.includes('Heavy Pauldrons') && log.suitShown === true, 'customizing lists the parts and shows the suit on the turntable');
click('[data-part]', { slotName: 'chest', part: SUIT_PARTS.chest[2].id });
check(suitState.selection.chest === SUIT_PARTS.chest[2].id && log.preview.includes(`chest:${SUIT_PARTS.chest[2].id}`), 'picking a part fits it and updates the turntable');
check(suitState.selection.head === SUIT_PARTS.head[0].id, 'the other slots keep their parts');
suitState.place(1, 1, 0);
check(elements['char-suit'].innerHTML.includes('RECALL BEACON') && !elements['char-suit'].innerHTML.includes('disabled'), 'a suit out in the world offers a recall beacon');
canPickUp = false;
screen.render();
check(elements['char-suit'].innerHTML.includes('disabled'), 'but not while it is still falling or rising');
canPickUp = true;
click('[data-action]', { action: 'pickup' });
check(log.pickedUp === 1, 'the recall beacon button asks the game to put a recall beacon in your hand');
suitState.setOccupied(true);
check(elements['char-suit'].innerHTML.includes('EXIT SUIT'), 'inside the suit the panel offers to exit');
click('[data-action]', { action: 'exit' });
check(log.exited === 1, 'the exit button asks the world to climb out');
suitState.setOccupied(false);

// ---- the DEV tab ----
screen.setDevMode(true);
check(elements['char-tabs'].innerHTML.includes('data-tab="dev"'), 'developer mode adds the DEV tab');
click('[data-tab]', { tab: 'dev' });
check(elements['char-dev'].style.display === 'block' && elements['char-main'].style.display === 'none', 'the DEV tab replaces the main view');
const shovel = weapons.slots.findIndex((item) => item.hidden);
check(shovel >= 0 && elements['char-dev'].innerHTML.includes(`data-gun="${shovel}"`), 'the DEV tab lists items the armory hides');
click('[data-target]', { target: '2' });
click('[data-gun]', { gun: String(shovel) });
check(weapons.loadout[2] === shovel, 'clicking an item in the DEV tab fits it into the chosen slot');
screen.setDevMode(false);
check(!elements['char-tabs'].innerHTML.includes('data-tab="dev"') && elements['char-main'].style.display === 'grid', 'turning developer mode off hides the tab and returns to the main view');
click('[data-tab]', { tab: 'dev' });
check(elements['char-dev'].style.display === 'none', 'the DEV tab cannot be opened when developer mode is off');

// ---- closing ----
click('#char-resume');
check(log.resumed === 1, 'the resume button asks the game to resume');
screen.close();
check(!screen.isOpen && elements.character.style.display === 'none' && log.preview.at(-1) === 'stop', 'closing hides the screen and stops the turntable');

// ---- the page's own stylesheet: a stray global rule once made the turntable canvas cover the whole screen ----
const { readFile } = await import('node:fs/promises');
const { ROOT } = await import('./support/modules.mjs');
const html = await readFile(`${ROOT}/index.html`, 'utf8');
check(!/^\s*canvas\s*\{/m.test(html), 'no rule styles every canvas (it would pin the turntable over the game)');
check(/#char-preview\s*\{[^}]*position:\s*static/.test(html), 'the turntable canvas sits in its panel instead of covering the screen');

process.exit(fails ? 1 : 0);
