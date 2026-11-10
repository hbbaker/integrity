/*
 * The smallest game built on the core: a spinning crate you move with the keyboard.
 * It shows the pieces every game wires up: the stage (renderer, scene, camera), the game loop,
 * an action table with rebindable keys, a settings model, and one game mode.
 *
 * To use it: serve a page with an import map for "three", a <canvas id="game">, and
 *   import { startMinimalGame } from './core/examples/minimal-game.js'; startMinimalGame(document.getElementById('game'));
 * tests/core-example.test.mjs runs this same file, so it stays correct.
 */
import * as THREE from 'three';
import { createStage } from '../client/engine/stage.js';
import { GameLoop } from '../client/engine/loop.js';
import { Bindings } from '../client/engine/bindings.js';
import { SettingsModel } from '../client/engine/settings-model.js';
import { ActionInput } from '../client/engine/action-input.js';
import { DeviceInput } from '../client/engine/input.js';
import { GameMode } from '../client/modes/game-mode.js';
import { ModeManager } from '../client/modes/mode-manager.js';

// 1. Actions: what the player can do, and the keys that do it. `hold` names the input field a control sets.
const ACTIONS = [
  { id: 'left', label: 'MOVE LEFT', group: 'MOVE', hold: 'left', defaults: { keyboard: ['KeyA', 'ArrowLeft'], gamepad: [] } },
  { id: 'right', label: 'MOVE RIGHT', group: 'MOVE', hold: 'right', defaults: { keyboard: ['KeyD', 'ArrowRight'], gamepad: [] } },
];
const SETTINGS = [{ id: 'speed', label: 'SPEED', group: 'GAME', type: 'range', min: 1, max: 10, step: 1, default: 4 }];

// 2. A mode: one way to play. It overrides only the hooks it needs.
class FreeRoamMode extends GameMode {
  constructor({ crate, input, settings }) {
    super('free-roam');
    Object.assign(this, { crate, input, settings });
  }

  fixedUpdate(dt) {
    const direction = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    this.crate.position.x += direction * this.settings.get('speed') * dt;
    this.crate.rotation.y += dt;
  }
}

export function startMinimalGame(canvas) {
  // 3. The stage and the world.
  const { renderer, scene, camera } = createStage({
    canvas, fov: 70, exposure: 1, fogColor: 0x88aacc, fog: { near: 20, far: 80 }, maxPixelRatio: 2,
  });
  camera.position.set(0, 2, 6);
  const crate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xd9a441 }));
  scene.add(crate, new THREE.HemisphereLight(0xffffff, 0x444466, 2));

  // 4. Input: the player's controls and settings (saved in the browser when it allows).
  const input = { left: false, right: false };
  const bindings = new Bindings(ACTIONS, { storage: window.localStorage, storageKey: 'minimal-bindings' });
  const settings = new SettingsModel(SETTINGS, { storage: window.localStorage, storageKey: 'minimal-settings' });
  const actionInput = new ActionInput({ bindings, state: input });
  new DeviceInput({ actionInput, gateOpen: () => true }).attach();

  // 5. Modes and the loop.
  const modes = new ModeManager({ prepare: () => { crate.position.set(0, 0, 0); }, cleanup: () => {} });
  modes.register(new FreeRoamMode({ crate, input, settings }));
  modes.start('free-roam');

  const loop = new GameLoop({ fixedStep: 1 / 60, maxFrameDelta: 0.1, maxStepsPerFrame: 5 }, {
    beginFrame: () => true,
    fixedUpdate: (dt) => modes.fixedUpdate(dt, input),
    endFrame: () => {},
    render: () => { renderer.clear(); renderer.render(scene, camera); },
  });
  loop.start();
  return { crate, modes, bindings, settings, input };
}
