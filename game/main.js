import { createEffects } from '../core/client/graphics/particles.js';
import { createStage } from '../core/client/engine/stage.js';
import { GameLoop } from '../core/client/engine/loop.js';
import { ModeManager } from '../core/client/modes/mode-manager.js';
import { COMIC_FONT } from './ui/theme.js';
import { World } from './world/world.js';
import { Player } from '../core/client/character/player.js';
import { Weapons } from './weapons/index.js';
import { Enemies } from './entities/enemies.js';
import { Pickups } from './entities/pickups.js';
import { Hud } from './ui/hud.js';
import { CharacterScreen } from './ui/character-screen.js';
import { SuitState } from './suit/suit-state.js';
import { MechSuit, BEACON } from './entities/mech-suit-entity.js';
import { loadDevFlag } from './dev-flag.js';
import { Cyborg } from './assets/cyborg.js';
import { AudioFX } from './audio.js';
import { NetClient, NET_STATUS } from '../core/client/net/net-client.js';
import { RemotePlayers } from './entities/remote-players.js';
import { Targets } from './entities/targets.js';
import { Deathmatch } from './rules/deathmatch.js';
import { SandboxMode } from './modes/sandbox-mode.js';
import { WavesMode } from './modes/waves-mode.js';
import { DeathmatchMode } from './modes/deathmatch-mode.js';
import { BotMatchMode } from './modes/bot-match-mode.js';
import { DigSiteMode } from './modes/dig-site-mode.js';
import { MultiplayerMenu } from './ui/multiplayer-menu.js';
import { Scoreboard } from './ui/scoreboard.js';
import { DigMode } from './rules/dig-mode.js';
import { DigHud } from './ui/dig-hud.js';
import { DigLobbyScreen } from './ui/dig-lobby.js';
import { BotMatch } from './rules/bot-match.js';
import { SoloMenu } from './ui/solo-menu.js';
import { loadName } from './ui/multiplayer-menu.js';
import { GamepadInput } from '../core/client/engine/gamepad.js';
import { ActionInput } from '../core/client/engine/action-input.js';
import { DeviceInput } from '../core/client/engine/input.js';
import { Bindings, FAMILIES, controlLabel } from '../core/client/engine/bindings.js';
import { SettingsModel } from '../core/client/engine/settings-model.js';
import { ACTIONS, ACTION_GROUPS, PAD_PRESETS } from './ui/actions.js';
import { SETTING_DEFS, SETTING_GROUPS } from './ui/settings-defs.js';
import { createSettingsApplier } from './ui/settings-apply.js';
import { SettingsScreen } from './ui/settings-screen.js';
import { OnScreenKeyboard } from './ui/on-screen-keyboard.js';
import { padLabels } from '../core/client/engine/pad-labels.js';

import { CONFIG } from './config.js';


/* ========================================================================== *
 *  Renderer, scene, camera
 * ========================================================================== */
const canvas = document.getElementById('game');
const DEFAULT_FOG = { near: 25, far: 90 }; // a mode's setup can change it (the sandbox sees further)
const { renderer, scene, camera, skyDome, resize: resizeStage } = createStage({
  canvas, fov: CONFIG.player.fov, fogColor: CONFIG.fogColor, fog: DEFAULT_FOG, internalHeight: CONFIG.internalHeight,
});

/* ========================================================================== *
 *  Game objects
 * ========================================================================== */
const audio = new AudioFX();
const hud = new Hud(CONFIG);
const fx = createEffects(scene, { bubbleFont: COMIC_FONT });
const world = new World(scene, CONFIG);
const player = new Player(camera, world, CONFIG.player);
const enemies = new Enemies({ cfg: CONFIG, scene, world, fx, player, audio });
const weapons = new Weapons({ cfg: CONFIG, camera, mainScene: scene, world, enemies, player, fx, hud, audio });
const cyborg = new Cyborg({ scene, player, weapons, rigged: true }); // the Y Bot loads in the background; the plain humanoid shows until it is there
weapons.tp = cyborg;
const pickups = new Pickups(scene, CONFIG);
const suitState = new SuitState();
const scoreboard = new Scoreboard();
const DIG_MESSAGE_PREFIX = 'dg_'; // the DIG SITE server messages (server/src/dig/lobby.rs)
const net = new NetClient({
  onStatus: (status) => {
    mpMenu.setStatus(status);
    digLobby.setStatus(status);
    if (status === NET_STATUS.ONLINE && pendingSolo) startSoloDigNow();
    if (status === NET_STATUS.CLOSED && pendingSolo) {
      pendingSolo = false;
      soloMenu.setStatus('COULD NOT REACH THE SERVER');
    }
    if (status === NET_STATUS.CLOSED && modes.online) toMenu();
  },
  onRoster: (players) => onNetRoster(players),
  onJoinError: (code) => mpMenu.showError(code),
  onGame: (message) => onDigMessage(message),
  onMessage: (from, message) => {
    remotes.receive(from, message, performance.now() * 0.001);
    modes.onPeerMessage(from, message);
  },
}, { gamePrefix: DIG_MESSAGE_PREFIX });
const remotes = new RemotePlayers({ scene, fx, world, weapons, audio, config: CONFIG.multiplayer, suitConfig: CONFIG.suit });
remotes.listener = camera;
weapons.enemies = new Targets({ enemies, remotes }); // shots now hit bots and other players alike
const deathmatch = new Deathmatch({
  config: CONFIG.multiplayer, arenaHalf: CONFIG.arena.half, net, player, weapons, cyborg, remotes, world, scoreboard, hud, pickups,
  suit: () => mechSuit.networkState(),
});
const mpMenu = new MultiplayerMenu({
  onJoin: (name) => net.join(name),
  onBack: () => {
    net.close();
    mpMenu.close();
    hud.showStart(true, false);
  },
});
const botMatch = new BotMatch({
  config: CONFIG.botMatch, arenaHalf: CONFIG.arena.half, player, weapons, cyborg, enemies, world, scoreboard, hud,
});
const soloMenu = new SoloMenu({
  onSandbox: () => {
    soloMenu.close();
    startMode('sandbox');
  },
  onDig: () => startSoloDig(),
  onBots: () => {
    soloMenu.close();
    startMode('botmatch');
  },
  onBack: () => {
    pendingSolo = false;
    soloMenu.close();
    hud.showStart(true, false);
  },
});
const digHud = new DigHud();
const dig = new DigMode({
  config: CONFIG.dig, net, player, weapons, remotes, world, scene, camera, audio, hud, digHud, scoreboard,
  suit: () => mechSuit.networkState(),
});
const digLobby = new DigLobbyScreen({
  onJoin: (name) => net.sendGame({ t: 'dg_join', name }),
  onStart: () => net.sendGame({ t: 'dg_start' }),
  onBack: () => {
    net.sendGame({ t: 'dg_leave' });
    net.close();
    digLobby.reset();
    digLobby.close();
    hud.showStart(true, false);
  },
});
const mechSuit = new MechSuit({
  scene, world, player, cyborg, hud, suitState, config: CONFIG.suit, playerConfig: CONFIG.player,
  keyLabel: () => {
    const control = bindings.slots('interact', FAMILIES.KEYBOARD)[0];
    return control ? controlLabel(control) : '?';
  },
});

/** Close the character screen and go back to the game (the mouse is captured again). */
function resumeFromCharacterScreen() {
  characterScreen.close();
  audio.unlock();
  requestLock();
}

const characterScreen = new CharacterScreen({
  weapons,
  suitState,
  suitActions: {
    canPlace: () => mechSuit.canPlace(),
    place: () => { if (equipBeacon(BEACON.DEPLOY)) resumeFromCharacterScreen(); },
    canPickUp: () => mechSuit.canPickUp(),
    pickUp: () => { if (equipBeacon(BEACON.RECALL)) resumeFromCharacterScreen(); },
    exit: () => {
      resumeFromCharacterScreen();
      mechSuit.interact();
    },
  },
  onResume: resumeFromCharacterScreen,
});
loadDevFlag().then((enabled) => characterScreen.setDevMode(enabled));

/*
 * The suit beacon: the character screen arms a deploy (suit down) or recall (suit up) beacon and puts it in your hand;
 * the fire button throws it, and what you held before comes back. Switching to something else instead puts it away.
 */
const beaconIndex = CONFIG.weapons.list.findIndex((item) => item.id === 'beacon');
let beaconReturnIndex = weapons.startIndex;

function equipBeacon(mode) {
  if (!mechSuit.arm(mode)) return false;
  if (weapons.index !== beaconIndex) beaconReturnIndex = weapons.switching ? weapons.pendingIndex : weapons.index;
  weapons.select(beaconIndex);
  return true;
}

weapons.onBeaconThrow = () => {
  if (mechSuit.throwBeacon()) weapons.select(beaconReturnIndex);
};

const stats = { kills: 0 }; // bots the player has killed this run

/** What a mode's `setup` may leave out. */
const DEFAULT_SETUP = {
  level: 'waves', fog: DEFAULT_FOG, spawn: { x: 0, z: 22 }, invulnerable: false, infiniteAmmo: false, infiniteReserve: false,
};

/** The work every mode shares before it starts: build its level, reset the player and weapons, clear the field. */
function prepareMode(mode) {
  const setup = { ...DEFAULT_SETUP, ...mode.setup };
  world.build(setup.level);
  renderer.shadowMap.needsUpdate = true; // shadows are static: re-render them for the new level
  scene.fog.near = setup.fog.near;
  scene.fog.far = setup.fog.far;
  player.spawnX = setup.spawn.x;
  player.spawnY = 0;
  player.spawnYaw = 0;
  player.spawnZ = setup.spawn.z;
  mechSuit.clear();
  player.reset();
  cyborg.reset();
  player.invulnerable = setup.invulnerable;
  weapons.reset();
  weapons.infiniteAmmo = setup.infiniteAmmo;
  weapons.infiniteReserve = setup.infiniteReserve;
  enemies.clear();
  pickups.clear();
  hud.clearNumbers();
  hud.hideDeath();
  hud.setMode(mode.id);
  stats.kills = 0;
  hud.setKills(0);
}

/** Back to the mode-select screen (the scene keeps rendering behind it). Only a full exit resets the scene; going back to a lobby keeps it. */
function cleanupMode(mode, reason) {
  if (reason !== 'menu') return;
  mechSuit.clear();
  enemies.clear();
  pickups.clear();
  hud.clearNumbers();
  hud.hideDeath();
  player.invulnerable = false;
  weapons.infiniteAmmo = false;
  weapons.infiniteReserve = false;
  hud.showStart(true, false);
}

const modes = new ModeManager({ prepare: prepareMode, cleanup: cleanupMode });

modes.register(new SandboxMode({ config: CONFIG.sandbox }));
modes.register(new WavesMode({ config: CONFIG, hud, enemies, stats }));
modes.register(new DeathmatchMode({ deathmatch, net, remotes, hud }));
modes.register(new BotMatchMode({ botMatch }));
modes.register(new DigSiteMode({
  dig, digHud, digLobby, net, remotes, hud, cyborg, renderer, leaveToLobby: () => modes.stop('lobby'),
}));

/** Start (or restart) a mode, then hand the player the controls. */
function startMode(id, payload = null) {
  modes.start(id, payload);
  loop.resetAccumulator();
  audio.unlock();
  requestLock();
}

function toMenu() {
  modes.stop('menu');
}

player.onDamage = () => {
  hud.damage();
  audio.hurt();
  pad.rumble(0.2, 0.35, 0.9);
};
player.onJump = () => audio.jump();
player.onLand = (impact) => audio.land(impact);
player.onSlide = () => audio.slide();
player.onMantle = () => audio.mantle();
player.onSlam = () => audio.slide();
player.onDeath = () => {
  audio.deathDialup();
  mechSuit.ejectOnDeath();
  if (modes.onPlayerDeath()) return; // a mode may respawn the player or show its own end screen
  hud.showDeath(0, stats.kills);
  document.exitPointerLock();
};

enemies.onKill = (e) => {
  modes.onEnemyKilled(e);
  stats.kills += 1;
  hud.setKills(stats.kills);
  pickups.maybeDrop(e.pos.x, e.pos.y, e.pos.z, player.health < player.cfg.maxHealth * 0.5);
};

pickups.onCollect = (kind) => {
  if (kind === 'health') {
    if (player.health >= player.cfg.maxHealth) return false; // leave it for later
    player.heal(CONFIG.pickups.healthAmount);
  } else if (!weapons.addAmmo(CONFIG.pickups.ammo)) {
    return false;
  }
  audio.pickup();
  return true;
};

/* ========================================================================== *
 *  Multiplayer glue
 * ========================================================================== */
/** The server roster changed: update the lobby list, avatars and match tables; start the match once joined. */
function onNetRoster(players) {
  mpMenu.setRoster(players, net.id);
  if (!modes.usesRelayRoster) return; // dig keeps its own player list
  remotes.sync(players, net.id);
  modes.onRoster(players);
  if (mpMenu.isOpen && net.joined) {
    mpMenu.close();
    startMode('deathmatch');
  }
}

/** The server's DIG SITE messages: lobby updates, errors, the map (match start), and match events. */
function onDigMessage(message) {
  switch (message.t) {
    case 'dg_lobby':
      digLobby.setLobby(message, net.id);
      modes.onServerMessage(message); // the dig mode follows a "back to lobby" from another player
      break;
    case 'dg_error':
      digLobby.showError(message.code);
      break;
    case 'dg_map':
      soloMenu.close();
      startMode('dig', message);
      break;
    default:
      modes.onServerMessage(message);
      break;
  }
}

/** SANDBOX menu -> DIG SITE: connect, then ask the server for a private one-player match. */
function startSoloDig() {
  pendingSolo = true;
  soloMenu.setStatus('CONNECTING...');
  net.connect();
  if (net.status === NET_STATUS.ONLINE) startSoloDigNow();
}

function startSoloDigNow() {
  pendingSolo = false;
  net.sendGame({ t: 'dg_solo', name: loadName() ?? '' }); // the server falls back to "Solo" for a bad name
}

function openDig() {
  hud.showStart(false);
  digLobby.open();
  net.connect();
  digLobby.setStatus(net.status); // already connected: no status change will come
}

function openMultiplayer() {
  hud.showStart(false);
  mpMenu.open();
  net.connect();
}

/* ========================================================================== *
 *  Input
 * ========================================================================== */
/* Saved settings and control layout (browser storage; blocked storage just means nothing is remembered). */
const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
const bindings = new Bindings(ACTIONS, { storage, storageKey: 'cable-bots-bindings', presets: PAD_PRESETS });
const settings = new SettingsModel(SETTING_DEFS, { storage, storageKey: 'cable-bots-settings' });
const applySettings = createSettingsApplier(CONFIG, settings);
applySettings();
settings.subscribe(applySettings);

const input = {
  forward: false, back: false, left: false, right: false,
  sprintHeld: false, fireHeld: false, aimHeld: false, boardHeld: false, crouchHeld: false, leanLeft: false, leanRight: false,
  // One-shot edges: latched until a fixed step consumes them, so a press is never
  // lost on a rendered frame that happens to run zero fixed steps.
  jumpPressed: false, slidePressed: false, sprintPressed: false, firePressed: false, ammoPressed: false,
  reloadPressed: false, meleePressed: false, interactPressed: false, selectSlot: -1, wheel: 0,
  analogActive: false, analogX: 0, analogY: 0, // controller stick: any direction, with a throttle (see player.update)

  clearEdges() {
    this.jumpPressed = this.slidePressed = this.sprintPressed = this.firePressed = this.ammoPressed = false;
    this.reloadPressed = this.meleePressed = this.interactPressed = false;
    this.selectSlot = -1;
    this.wheel = 0;
  },

  clearAll() {
    this.forward = this.back = this.left = this.right = false;
    this.sprintHeld = this.fireHeld = this.aimHeld = this.boardHeld = this.crouchHeld = false;
    this.leanLeft = this.leanRight = false;
    this.analogActive = false;
    this.clearEdges();
  },
};

let locked = false;
let pendingSolo = false; // waiting for the connection so a solo DIG SITE game can be requested

const RELOCK_RETRY_MS = 1300; // browsers refuse a new lock for about a second after the old one was released

function requestLock(retry = true) {
  const result = canvas.requestPointerLock();
  if (result && result.catch) {
    result.catch(() => {
      if (retry) setTimeout(() => { if (!locked && canResume()) requestLock(false); }, RELOCK_RETRY_MS);
    });
  }
}

/** True when a game is running and the mouse was released by accident (Esc, alt-tab, a click outside). */
function canResume() {
  return !characterScreen.isOpen && modes.canResume(player);
}

/** What the bound controls that are plain commands do (menus, view toggle, mute). */
function onCommand(id, { down, gateOpen }) {
  if (!down) return;
  if (id === 'mute') {
    audio.toggleMute();
    return;
  }
  if (characterScreen.isOpen) { // the pointer is free and the menu is open: slot keys pick, the inventory key closes
    if (id === 'inventory') characterScreen.onResume();
    else if (id.startsWith('slot') && Number(id.slice(4)) <= 3) characterScreen.selectSlot(Number(id.slice(4)) - 1);
    return;
  }
  if (id === 'inventory') {
    if (!player.alive || !modes.allowsInventory) return;
    characterScreen.open();
    hud.showStart(false);
    document.exitPointerLock(); // the game pauses while the pointer is free
    return;
  }
  if (!gateOpen) return; // dead players cannot act
  if (id === 'toggleView') player.toggleView(); // first / third person
  else if (id === 'pause') {
    pad.disengage();
    hud.showStart(true, true);
  }
}

const actionInput = new ActionInput({ bindings, state: input, onCommand });
const devices = new DeviceInput({
  actionInput,
  gateOpen: () => locked && player.alive,
  ignoreEvent: (e) => e.target instanceof HTMLInputElement, // typing a username: no game shortcuts
  onEscape: () => {
    if (osk.isOpen) {
      osk.cancel();
      return true;
    }
    if (settingsScreen.isOpen) return settingsScreen.onEscape();
    if (!characterScreen.isOpen) return false;
    characterScreen.close();
    hud.showStart(player.alive, modes.current !== null);
    return true;
  },
  onLook: (dx, dy) => {
    const lookY = settings.get('invertMouseY') ? -dy : dy;
    player.look(dx, lookY);
    weapons.addLook(dx, lookY);
  },
});
devices.attach();

/** Forget every held control and latched press (focus lost, death, pointer lock changed). */
function clearInput() {
  actionInput.releaseAll();
  input.clearAll();
}

// Any click that is not on a menu button takes the mouse back. Buttons stop their own click
// from reaching here, so MAIN MENU and the like still work.
document.addEventListener('click', () => {
  if (locked || !canResume()) return;
  audio.unlock();
  requestLock();
});
window.addEventListener('blur', () => clearInput());

/* ----------------------------- controller ----------------------------- */
let padPending = false; // a controller press started a game: take control of it as soon as it runs

/** Let the pad play. A pad gets no pointer lock, so `pad.engaged` stands in for it. */
function engagePad() {
  if (!canResume()) return false;
  audio.unlock();
  pad.clearFocus();
  pad.engaged = true;
  padPending = false;
  hud.showStart(false);
  return true;
}

/** A on nothing in particular: retry from the death screen, or take the game back. */
function padPrimary() {
  if (hud.el.dead.style.display === 'flex') {
    padPending = true;
    hud.el.dead.click();
    return true;
  }
  return engagePad();
}

/** A pressed on a highlighted element: a text field opens the keyboard; anything else is clicked. */
function padConfirm(element) {
  if (element.matches('input[type=text]')) {
    osk.open(element, { maxLength: element.maxLength, onDone: () => pad.setFocus(element) });
    return;
  }
  if (element === hud.el.resume) {
    engagePad();
    return;
  }
  padPending = true; // a mode button starts a game: the pad takes it over once it runs
  element.click();
}

/** B: close the keyboard, go back from a screen, or resume a paused game. */
function padBack() {
  if (osk.isOpen) {
    osk.cancel();
    return;
  }
  const back = [...document.querySelectorAll('.overlay [data-back]')].find((element) => element.getClientRects().length > 0);
  if (back) {
    back.click();
    return;
  }
  if (canResume() && hud.el.start.style.display !== 'none') engagePad(); // the pause menu: B resumes
}

const MENU_TARGETS = '.overlay button:not([disabled]), .overlay input[type=text], .overlay [data-slot], .overlay [data-gun]';

const pad = new GamepadInput({
  config: CONFIG.gamepad,
  actionInput,
  state: input,
  mouseSensitivity: () => CONFIG.player.mouseSensitivity, // read live: the stick's turn rate must not change with the mouse setting
  look: (dx, dy) => {
    player.look(dx, dy);
    weapons.addLook(dx, dy);
  },
  engage: padPrimary,
  confirm: padConfirm,
  back: padBack,
  menuSelector: () => (osk.isOpen ? '#overlay-osk button' : MENU_TARGETS), // the keyboard sits on top: only its keys count
  vibration: () => settings.get('padVibration'),
});

/** Show the pad's button names in the hint line (Xbox letters or PlayStation shapes). */
function showPadHint(id) {
  const labels = padLabels(id);
  document.getElementById('pad-hint').textContent = `${labels.Pad0} SELECT  ·  ${labels.Pad1} BACK  ·  ${labels.Pad9} PAUSE`;
  document.body.classList.add('pad-connected');
}
window.addEventListener('gamepadconnected', (event) => {
  showPadHint(event.gamepad?.id ?? '');
  hud.banner('CONTROLLER CONNECTED');
});
window.addEventListener('gamepaddisconnected', () => document.body.classList.remove('pad-connected'));

const osk = new OnScreenKeyboard();
const settingsScreen = new SettingsScreen({
  bindings, settings, actionInput, actions: ACTIONS, actionGroups: ACTION_GROUPS,
  settingDefs: SETTING_DEFS, settingGroups: SETTING_GROUPS, presets: PAD_PRESETS,
  padLabels: () => padLabels(pad.id),
  onClose: () => hud.showStart(true, modes.current !== null),
});

function openSettings() {
  hud.showStart(false);
  settingsScreen.open();
}
document.getElementById('mode-settings').addEventListener('click', (e) => { e.stopPropagation(); openSettings(); });
document.getElementById('start-settings').addEventListener('click', (e) => { e.stopPropagation(); openSettings(); });
document.getElementById('start-inventory').addEventListener('click', (e) => {
  e.stopPropagation();
  onCommand('inventory', { down: true, gateOpen: false });
});

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  clearInput(); // avoid keys stuck "down" when focus changes
  pad.disengage(); // mouse and pad take turns: the pad asks again with A or START
  if (locked) padPending = false;
  hud.showStart(!locked && player.alive && !characterScreen.isOpen, modes.current !== null);
});

document.addEventListener('pointerlockerror', () => hud.showStart(player.alive, modes.current !== null));

hud.el.modeSandbox.addEventListener('click', (e) => {
  e.stopPropagation();
  hud.showStart(false);
  soloMenu.open();
});
hud.el.modeWaves.addEventListener('click', (e) => { e.stopPropagation(); startMode('waves'); });
hud.el.modeMultiplayer.addEventListener('click', (e) => { e.stopPropagation(); audio.unlock(); openMultiplayer(); });
hud.el.modeDig.addEventListener('click', (e) => { e.stopPropagation(); audio.unlock(); openDig(); });
digHud.el.again.addEventListener('click', (e) => {
  e.stopPropagation();
  if (dig.solo) startSoloDigNow(); // a solo player starts a fresh game instead of returning to a lobby
  else net.sendGame({ t: 'dg_again' });
});
digHud.el.menu.addEventListener('click', (e) => { e.stopPropagation(); toMenu(); });
hud.el.resume.addEventListener('click', (e) => { e.stopPropagation(); audio.unlock(); requestLock(); });
hud.el.toMenu.addEventListener('click', (e) => { e.stopPropagation(); toMenu(); });
hud.el.deadMenu.addEventListener('click', (e) => { e.stopPropagation(); toMenu(); });

hud.el.dead.addEventListener('click', () => {
  audio.unlock();
  startMode(modes.id);
});

window.addEventListener('resize', () => weapons.resize(resizeStage()));

/* ========================================================================== *
 *  Main loop: fixed-timestep simulation, interpolated rendering
 * ========================================================================== */
function fixedUpdate(dt) {
  modes.fixedUpdate(dt, input);
  if (input.interactPressed) mechSuit.interact();
  const stepInput = mechSuit.filterInput(modes.filterInput(input)); // a mode may block movement or keys; the suit's climb blocks all of it
  if (player.alive) { // in some modes the world runs on while you wait to respawn, but the dead do nothing
    player.update(dt, stepInput);
    weapons.update(dt, stepInput);
  }
  mechSuit.update(dt);
  if (mechSuit.armedMode && !weapons.switching && weapons.index !== beaconIndex) mechSuit.disarm(); // you put the beacon away
  enemies.update(dt);
  modes.afterFixedUpdate(dt);
  if (player.alive) pickups.update(dt, player.pos);
  input.clearEdges();
}

function renderFrame(alpha, dt) {
  const time = loop.time;
  player.applyCamera(alpha, dt);
  skyDome.position.copy(camera.position);
  camera.updateMatrixWorld(); // HUD projection and viewmodel read this frame's camera
  cyborg.update(dt, alpha, time, weapons);
  mechSuit.animate();
  weapons.updateView(dt, time);
  enemies.animate(alpha, time, dt);
  remotes.update(dt, time, performance.now() * 0.001);
  pickups.animate(time);
  fx.update(dt);
  hud.setHealth(player.health, player.cfg.maxHealth);
  hud.update(dt, camera, weapons.crosshairSpread());

  renderer.clear();
  renderer.render(scene, camera);
  weapons.render(renderer);
}

/** Before the simulation: read the pad, decide whether the game is running this frame. */
function beginFrame(dt) {
  const inGame = modes.current !== null;
  const gameRunning = inGame && !modes.resultsShowing;
  if (pad.engaged && !canResume()) pad.disengage(); // died in a one-life mode, results, a menu...
  pad.poll(dt, player.alive && gameRunning);
  if (padPending && !pad.engaged && inGame) engagePad(); // a game the pad just started is now running
  const alive = player.alive || modes.simulatesWhileDead;
  const playing = (locked || modes.online || pad.engaged) && alive && gameRunning;
  if (!playing) weapons.cease(); // never leave a beam (or its hum) running while paused
  if (!player.alive) clearInput(); // dead: forget held keys and latched presses, so respawning starts clean
  return playing;
}

/** After the simulation: the mode's per-frame work, and the "get your mouse back" prompt. */
function endFrame(dt, playing) {
  modes.update(dt, { playing, boardHeld: input.boardHeld });
  // An online match keeps running when the mouse is released: always show how to get it back.
  if (modes.online && !locked && !pad.engaged && !settingsScreen.isOpen && !osk.isOpen && canResume() && hud.el.start.style.display === 'none') hud.showStart(true, true);
}

const loop = new GameLoop(CONFIG, { beginFrame, fixedUpdate, endFrame, render: renderFrame });

hud.setKills(0);
hud.showStart(true, false);
loop.start();
