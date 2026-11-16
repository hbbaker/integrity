/*
 * The armor catalogue, the saved equipped state and the network form of it.
 */
import { load, installDomStubs } from './support/modules.mjs';

installDomStubs();
const { ARMOR_PARTS, ARMOR_SLOTS, emptyEquipment, sanitizeEquipment, damageReduction, findArmorPart } = await load('armor-parts');
const { ArmorState } = await load('armor-state');
const { encodeEquipment, decodeEquipment } = await load('armor-network');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };

const memoryStorage = (initial) => {
  const data = new Map(initial === undefined ? [] : [['oneshot.armor', initial]]);
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};

check(ARMOR_SLOTS.join() === 'head,arms,chest,legs,boots', 'armor has head, arms, chest, legs and boots slots');
check(ARMOR_PARTS.head.some((p) => p.id === 'test-helmet'), 'the head slot has the test helmet');
check(Object.values(ARMOR_PARTS).flat().every((p) => p.armor > 0 && p.armor < 1), 'every piece removes a fraction of damage between 0 and 1');

check(Object.values(emptyEquipment()).every((id) => id === null), 'a new state has nothing equipped');
check(sanitizeEquipment({ head: 'no-such-piece', chest: 'test-helmet' }).head === null, 'an unknown piece id is dropped');
check(sanitizeEquipment({ chest: 'test-helmet' }).chest === null, 'a piece in the wrong slot is dropped');

const state = new ArmorState(memoryStorage());
let heard = null;
state.onChange((event) => { heard = event; });
state.equip('head', 'test-helmet');
check(state.equipped.head === 'test-helmet' && heard?.slot === 'head', 'equip fits the piece and tells listeners which slot changed');
state.equip('head', null);
check(state.equipped.head === null, 'equip with null empties the slot');

let threw = false;
try { state.equip('head', 'no-such-piece'); } catch { threw = true; }
check(threw, 'equip throws for an unknown piece');
threw = false;
try { state.equip('tail', null); } catch { threw = true; }
check(threw, 'equip throws for an unknown slot');

const storage = memoryStorage();
new ArmorState(storage).equip('head', 'test-helmet');
check(new ArmorState(storage).equipped.head === 'test-helmet', 'the equipped piece is remembered by the next session');
check(new ArmorState(memoryStorage('not json')).equipped.head === null, 'corrupt saved data starts with nothing equipped');

const worn = { ...emptyEquipment(), head: 'test-helmet' };
check(damageReduction(emptyEquipment(), 0.5) === 0, 'no armor gives no damage reduction');
check(damageReduction(worn, 0.5) === findArmorPart('head', 'test-helmet').armor, 'the helmet gives its damage reduction');
check(damageReduction(worn, 0.05) === 0.05, 'damage reduction never goes above the cap');

check(encodeEquipment(emptyEquipment()) === '00000', 'empty armor encodes as zeros');
check(encodeEquipment(worn) === '10000', 'the helmet encodes as 1 in the head digit');
check(decodeEquipment('10000').head === 'test-helmet', 'the helmet decodes from 1 in the head digit');
check(Object.values(decodeEquipment('99999')).every((id) => id === null), 'out-of-range digits decode as empty');
check(Object.values(decodeEquipment(undefined)).every((id) => id === null), 'a missing key decodes as empty');
check(Object.values(decodeEquipment('x-1.5')).every((id) => id === null), 'garbage characters decode as empty');

const { poseMessage } = await load('pose-message');
const stubPlayer = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 }, yaw: 0, pitch: 0, lean: 0, health: 100, alive: true };
const stubWeapons = { index: 0, adsBlend: 0 };
check(poseMessage(stubPlayer, stubWeapons).ar === undefined, 'a state message without armor has no armor key');
check(poseMessage(stubPlayer, stubWeapons, null, emptyEquipment()).ar === undefined, 'a state message with nothing equipped has no armor key');
check(poseMessage(stubPlayer, stubWeapons, null, worn).ar === '10000', 'equipped armor rides in the state message as key ar');

process.exit(fails ? 1 : 0);
