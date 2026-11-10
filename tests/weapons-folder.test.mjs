/*
 * Each weapon has its own file in game/weapons/ with the same three exports, and the index lists every one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, load, installDomStubs } from './support/modules.mjs';

installDomStubs();
const { WEAPONS, WEAPON_LIST, HOLDABLE_TYPES, HOLDABLE_MODELS } = await load('weapons');
const { Holdable } = await load('holdable');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };

const folder = path.join(ROOT, 'game/weapons');
const SUPPORT_FILES = new Set(['index.js', 'shared.js']);
const files = fs.readdirSync(folder).filter((name) => name.endsWith('.js') && !SUPPORT_FILES.has(name));
check(files.length === WEAPONS.length, `${files.length} weapon files, ${WEAPONS.length} weapons in the index`);

const ids = [];
for (const file of files) {
  const { weapon } = await import(pathToFileURL(path.join(folder, file)).href);
  check(weapon && weapon.config && weapon.holdable && weapon.model, `${file} exports weapon with config, holdable and model`);
  check(typeof weapon.config.id === 'string' && typeof weapon.config.name === 'string' && typeof weapon.config.type === 'string', `${file}: the config names its id, name and type`);
  check(weapon.holdable.type === weapon.config.type && weapon.holdable.class.prototype instanceof Holdable, `${file}: its class extends Holdable and matches the config type`);
  check(typeof weapon.model.build === 'function', `${file}: it has a model builder`);
  check(WEAPONS.includes(weapon), `${file}: it is listed in the index`);
  ids.push(weapon.config.id);
}
check(new Set(ids).size === ids.length, 'weapon ids are unique');
check(WEAPON_LIST.map((entry) => entry.id).join() === 'fists,pistol,shotgun,smg,raygun,sniper,shovel,reel', 'the list keeps its order: gloves first, the nail gun second');
check(WEAPON_LIST.every((entry) => HOLDABLE_TYPES[entry.type] && HOLDABLE_MODELS[entry.id]), 'every entry has a class and a model');
check(Object.keys(HOLDABLE_TYPES).sort().join() === 'beam,firearm,grapple,melee,tool', 'the types the weapons use');
for (const file of files) {
  const source = fs.readFileSync(path.join(folder, file), 'utf8');
  check(!/from '\.\/(?!shared\.js)/.test(source), `${file} imports no other weapon (only shared.js)`);
}

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
