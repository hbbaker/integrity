/*
 * One place that knows where each game module lives, so a file move changes this table
 * and not every test. Tests ask for modules by name: `await load('world')`.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Module name -> path from the repo root. A name that is not listed lives at `<name>.js` in the root. */
export const MODULE_PATHS = {
  gamepad: 'core/client/engine/gamepad.js',
  surfaces: 'core/client/graphics/surfaces.js',
  'pad-labels': 'core/client/engine/pad-labels.js',
  'settings-screen': 'game/ui/settings-screen.js',
  'on-screen-keyboard': 'game/ui/on-screen-keyboard.js',
  'game-mode': 'core/client/modes/game-mode.js',
  'mode-manager': 'core/client/modes/mode-manager.js',
  'game-loop': 'core/client/engine/loop.js',
  'waves-mode': 'game/modes/waves-mode.js',
  'sandbox-mode': 'game/modes/sandbox-mode.js',
  'bot-match-mode': 'game/modes/bot-match-mode.js',
  'deathmatch-mode': 'game/modes/deathmatch-mode.js',
  'dig-site-mode': 'game/modes/dig-site-mode.js',
  bindings: 'core/client/engine/bindings.js',
  'settings-model': 'core/client/engine/settings-model.js',
  'action-input': 'core/client/engine/action-input.js',
  'device-input': 'core/client/engine/input.js',
  actions: 'game/ui/actions.js',
  'settings-defs': 'game/ui/settings-defs.js',
  'settings-apply': 'game/ui/settings-apply.js',
  player: 'core/client/character/player.js',
  regen: 'core/client/character/regen.js',
  spawn: 'core/client/character/spawn.js',
  net: 'core/client/net/net-client.js',
  effects: 'core/client/graphics/particles.js',
  weapons: 'game/weapons/index.js',
  'fiber-reel': 'game/weapons/fiber-reel.js',
  'grapple-weapon': 'core/client/combat/grapple-weapon.js',
  'holdable-models': 'game/weapons/index.js',
  'holdable-system': 'core/client/combat/holdable-system.js',
  holdable: 'core/client/combat/holdable.js',
  weapon: 'core/client/combat/weapon.js',
  firearm: 'core/client/combat/firearm.js',
  'beam-weapon': 'core/client/combat/beam-weapon.js',
  'melee-weapon': 'core/client/combat/melee-weapon.js',
  tool: 'core/client/combat/tool.js',
  audio: 'game/audio.js',
  'audio-engine': 'core/client/audio/audio-engine.js',
  cyborg: 'game/assets/cyborg.js',
  enemies: 'game/entities/enemies.js',
  pickups: 'game/entities/pickups.js',
  'remote-players': 'game/entities/remote-players.js',
  targets: 'game/entities/targets.js',
  'pose-message': 'game/entities/pose-message.js',
  'bot-match': 'game/rules/bot-match.js',
  deathmatch: 'game/rules/deathmatch.js',
  'dig-mode': 'game/rules/dig-mode.js',
  world: 'game/world/world.js',
  'dig-world': 'game/world/dig-world.js',
  hud: 'game/ui/hud.js',
  inventory: 'game/ui/inventory.js',
  scoreboard: 'game/ui/scoreboard.js',
  'multiplayer-menu': 'game/ui/multiplayer-menu.js',
  'solo-menu': 'game/ui/solo-menu.js',
  'dig-hud': 'game/ui/dig-hud.js',
  'dig-lobby': 'game/ui/dig-lobby.js',
};

export function modulePath(name) {
  return path.join(ROOT, MODULE_PATHS[name] ?? `${name}.js`);
}

export function load(name) {
  return import(pathToFileURL(modulePath(name)).href);
}

/** The game's CONFIG object (game/config.js). Each call returns a fresh copy, so a test can change it freely. */
export async function loadConfig() {
  const { CONFIG } = await import(`${pathToFileURL(path.join(ROOT, 'game/config.js')).href}?copy=${Math.random()}`);
  return structuredClone(CONFIG);
}

/** Minimal canvas and window stand-ins so the procedural-texture code runs in Node. */
export function installDomStubs() {
  const noop = () => {};
  const context = new Proxy({}, {
    get: (target, key) => {
      if (key === 'measureText') return () => ({ width: 100 });
      if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray(16) });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: noop });
      return noop;
    },
    set: () => true,
  });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 720;
  globalThis.window = globalThis;
}
