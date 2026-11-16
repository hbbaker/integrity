/*
 * Ctrl + wheel in third person moves the camera; without Ctrl the wheel still changes weapon.
 */
import { load, loadConfig, installDomStubs } from './support/modules.mjs';

installDomStubs();
const THREE = await import('three');
const { Bindings } = await load('bindings');
const { ActionInput } = await load('action-input');
const { DeviceInput } = await load('device-input');
const { ACTIONS } = await load('actions');
const { World } = await load('world');
const { Player } = await load('player');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };

const CONFIG = await loadConfig();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 200);
const player = new Player(camera, new World(scene, CONFIG), CONFIG.player);
const tp = CONFIG.player.thirdPerson;

// ---- the camera distance ----
const distance = () => player._orbit(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), player.pos, 1);
check(distance() === tp.dist, 'the camera starts at the configured distance');
player.zoomThirdPerson(1);
check(distance() < tp.dist, 'zooming in brings the camera closer');
player.zoomThirdPerson(-2);
check(distance() > tp.dist, 'zooming out takes it further than it started');
player.zoomThirdPerson(-100);
check(distance() === tp.dist * tp.zoomMax, 'it stops at the furthest distance');
player.zoomThirdPerson(100);
check(Math.abs(distance() - tp.dist * tp.zoomMin) < 1e-9, 'and at the closest');
player.aimBlend = 1;
check(distance() === tp.aimDist, 'aiming still pulls the camera to the aim distance, whatever the zoom');
player.aimBlend = 0;
player.reset();
const kept = player.tpZoom;
check(kept === tp.zoomMin, 'the chosen distance survives a respawn');
player.tpZoom = 1;

// ---- the wheel ----
const bindings = new Bindings(ACTIONS);
const state = { wheel: 0, selectSlot: -1 };
const actionInput = new ActionInput({ bindings, state, onCommand: () => {} });
const listeners = {};
const target = { addEventListener: (name, fn) => { listeners[name] = fn; } };
const zooms = [];
let takesZoom = true;
new DeviceInput({ actionInput, gateOpen: () => true, target, onZoom: (steps) => { zooms.push(steps); return takesZoom; } }).attach();
const wheel = (event) => { const e = { preventDefault() { e.prevented = true; }, ...event }; listeners.wheel(e); return e; };

state.wheel = 0;
const plain = wheel({ deltaY: -100, ctrlKey: false });
check(state.wheel !== 0 && zooms.length === 0 && !plain.prevented, 'without Ctrl the wheel changes weapon and does not zoom');
state.wheel = 0;
const up = wheel({ deltaY: -100, ctrlKey: true });
check(zooms.join() === '1' && up.prevented && state.wheel === 0, 'Ctrl + wheel up zooms in, stops the page zooming, and does not change weapon');
wheel({ deltaY: 100, ctrlKey: true });
check(zooms.join() === '1,-1', 'Ctrl + wheel down zooms out');
takesZoom = false; // first person: the game does not take the zoom
state.wheel = 0;
const fallback = wheel({ deltaY: 100, ctrlKey: true });
check(state.wheel !== 0 && !fallback.prevented, 'when the game does not take the zoom, the wheel changes weapon as usual');

process.exit(fails ? 1 : 0);
