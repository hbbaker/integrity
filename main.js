import * as THREE from 'three';

import { createEffects, createEnvironment, createSkyDome } from './effects.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Weapons } from './weapons.js';
import { Enemies } from './enemies.js';
import { Pickups } from './pickups.js';
import { Hud } from './hud.js';
import { Inventory } from './inventory.js';
import { Cyborg } from './cyborg.js';
import { AudioFX } from './audio.js';
import { NetClient, NET_STATUS } from './net.js';
import { RemotePlayers } from './remote-players.js';
import { Targets } from './targets.js';
import { Deathmatch } from './deathmatch.js';
import { MultiplayerMenu } from './multiplayer-menu.js';
import { Scoreboard } from './scoreboard.js';
import { DigMode } from './dig-mode.js';
import { DigHud } from './dig-hud.js';
import { DigLobbyScreen } from './dig-lobby.js';
import { BotMatch } from './bot-match.js';
import { SoloMenu } from './solo-menu.js';
import { loadName } from './multiplayer-menu.js';

/* ========================================================================== *
 *  CONFIG: every tuning value lives here. Distances are metres, times are
 *  seconds, angles are radians unless noted.
 * ========================================================================== */
const CONFIG = {
  fixedStep: 1 / 60, // gameplay tick rate; rendering is interpolated between ticks
  maxFrameDelta: 0.1, // clamp so a tab switch cannot cause a giant catch-up
  maxStepsPerFrame: 5,
  maxPixelRatio: 2,
  exposure: 0.95, // tone-mapping exposure: raise for a brighter, lower for a moodier look
  fogColor: 0xbfcbd4,

  arena: { half: 30, wallHeight: 2.5 }, // 60 x 60
  sandbox: { half: 100, wallHeight: 6 }, // 200 x 200 open map

  player: {
    maxHealth: 100,
    radius: 0.4,
    eyeHeight: 1.65,
    slideEyeHeight: 0.85,
    crouchEyeHeight: 1.05, // hold C / Ctrl while not sprinting
    crouchSpeedMul: 0.55,
    leanDistance: 0.45, // metres the eye shifts sideways at a full lean (Q / E)
    leanTilt: 0.2, // radians the view rolls at a full lean
    leanSpeed: 12, // how fast the lean moves in and out
    leanClearance: 0.18, // how much room the eye needs, so a lean stops at walls
    stepHeight: 0.35, // ledges/ramps lower than this are walked up without jumping
    climbSpeed: 2.5, // m/s up the wall of a dug hole (DIG SITE) while you push against it
    snapDown: 0.2, // how far we stay glued to a downward ramp

    walkSpeed: 6.5,
    sprintSpeed: 10.5, // <- tweak for feel
    groundAccel: 70,
    groundDecel: 55,
    airAccel: 35,
    gravity: 24,
    jumpSpeed: 8.2,
    coyoteTime: 0.1,
    jumpBuffer: 0.12,

    slideSpeed: 15, // <- tweak for feel: initial burst
    slideEndSpeed: 5.5, // speed the burst decays to
    slideTime: 0.8,
    slideCooldown: 0.35,
    slideSteer: 1.2, // how much you can bend a slide with WASD
    slideJumpBoost: 1.08, // speed multiplier when you jump out of a slide
    slideRoll: 0.07,
    leanRoll: 0.012, // strafe lean

    fov: 75,
    sprintFovAdd: 10,
    slideFovAdd: 14,
    fovLerp: 9,
    mouseSensitivity: 0.0022,
    adsSpeedMul: 0.6, // walk speed multiplier while aiming down sights
    adsSensitivity: 0.9, // extra look-speed multiplier while aiming, on top of the zoom scaling (1 = the crosshair crosses the screen at the same speed)

    bobFreq: 1.3, // radians of bob per metre travelled
    bobAmpWalk: 0.03,
    bobAmpSprint: 0.055,
    landThreshold: 4, // impact speed that triggers a landing dip
    maxLandImpact: 14,
    landDip: 0.18,
    dipStiffness: 220,
    dipDamping: 16,

    kickRecover: 12, // how fast camera recoil settles
    shakeAmount: 0.06, // camera shake when hurt
    hitKnockback: 3.5,

    // Third person (T): over-the-shoulder camera. aim* values are used while aiming down sights.
    thirdPerson: { dist: 3.2, shoulder: 0.55, aimDist: 1.5, aimShoulder: 0.85, pivotDrop: 0.15 },
  },

  weapons: {
    viewmodelFov: 62,
    switchTime: 0.26,
    adsSpeed: 14, // how fast the gun moves between hip and sights (higher = snappier)
    sprintExitDelay: 0.1, // pause between "fire pressed while sprinting" and the first shot
    maxHeat: 24, // crosshair spread added by sustained fire (px)
    heatDecay: 45,
    crosshair: { base: 6, perSpeed: 1.1, air: 10 },
    quickMelee: { damage: 28, range: 2.8, cooldown: 0.5, knockback: 11, cone: 0.8, stun: 0.45 },
    list: [
      { id: 'fists', name: 'WORK GLOVES', melee: true, damage: 20, interval: 0.3, range: 2.6, cone: 0.78, knockback: 9, stun: 0.45 },
      {
        id: 'pistol', name: 'NAIL GUN', auto: false, damage: 24, interval: 0.2, mag: 12, reserve: 60, maxReserve: 96,
        reloadTime: 1.0, spread: 0.004, pellets: 1, range: 120, critMul: 2, knockback: 2.5, stun: 0.1,
        camKick: 0.018, camYaw: 0.004, climb: 0.002, kickZ: 0.022, kickRot: 0.07, flashSize: 0.3, worldLight: 25,
        heat: 5, tracerColor: 0xfff27a,
        ads: { x: 0, y: -0.093, z: -0.32, fovDrop: 12 }, // fovDrop = degrees of zoom
      },
      {
        // TAB swaps shell type. The shells in the tube go back to reserve, and you must reload
        // (shell by shell) with the new type. Fields in ammoTypes override the shared ones.
        id: 'shotgun', name: 'RIVET BLASTER', auto: false, interval: 0.8, mag: 6, critMul: 2,
        perShell: true, startTime: 0.3, shellTime: 0.42, endTime: 0.25,
        camYaw: 0.008, kickRot: 0.12, worldLight: 40, heat: 14,
        ads: { x: 0, y: -0.057, z: -0.28, fovDrop: 8 },
        defaultAmmo: 'buckshot',
        ammoTypes: {
          buckshot: {
            // 8 fat pellets (pelletRadius = how forgiving each pellet is), each with its own damage
            // number. Damage tapers from falloffStart to falloffEnd down to falloffMin.
            label: 'RIVETS', pickupKey: 'shotgun', reserve: 24, maxReserve: 36,
            damage: 11, pellets: 8, spread: 0.055, pelletRadius: 0.1, range: 60,
            falloffStart: 5, falloffEnd: 25, falloffMin: 0.15, pelletNumbers: true,
            knockback: 8, stun: 0.25, camKick: 0.05, climb: 0.004, kickZ: 0.045, flashSize: 0.5, tracerColor: 0xffb347,
          },
          slug: {
            // One heavy, accurate, long-range projectile.
            label: 'ANCHOR BOLT', pickupKey: 'slug', reserve: 8, maxReserve: 20,
            interval: 0.95, damage: 62, pellets: 1, spread: 0.007, pelletRadius: 0.04, range: 140,
            falloffStart: 30, falloffEnd: 90, falloffMin: 0.6, pelletNumbers: false,
            knockback: 14, stun: 0.35, camKick: 0.075, climb: 0.008, kickZ: 0.06, flashSize: 0.55, tracerColor: 0xffe9b0,
          },
        },
      },
      {
        id: 'smg', name: 'FRAMING NAILER', auto: true, damage: 7, interval: 0.075, mag: 30, reserve: 120, maxReserve: 180,
        reloadTime: 1.5, spread: 0.02, pellets: 1, range: 90, critMul: 2, knockback: 1.2, stun: 0.05,
        camKick: 0.007, camYaw: 0.006, climb: 0.0045, kickZ: 0.014, kickRot: 0.035, flashSize: 0.22, worldLight: 18,
        heat: 2.5, tracerColor: 0x9ff3ff,
        ads: { x: 0, y: -0.08, z: -0.3, fovDrop: 14 },
      },
      {
        // ARC TORCH: a continuous beam. `mag` is energy; it drains at drainRate per second of firing, so a
        // full cell is mag/drainRate seconds of beam. Power starts at 100% and eases down to powerMin over
        // falloffTime seconds of firing; ONLY a reload (recharge) restores it. Damage and beam width scale with it.
        id: 'raygun', name: 'ARC TORCH', beam: true, auto: true,
        dps: 95, tick: 0.1, critMul: 1.5, range: 90, beamRadius: 0.12, knockback: 0.5,
        mag: 100, reserve: 200, maxReserve: 300, drainRate: 12, reloadTime: 1.8,
        falloffTime: 6, powerMin: 0.35,
        flashTint: 0x55ffb0, flashSize: 0.3, worldLight: 0, heat: 0,
        ads: { x: 0, y: -0.088, z: -0.3, fovDrop: 10 },
      },
      {
        // Bolt-action surveyor's transit rifle (the sniper). `scope` hides the gun and draws a scope overlay while aiming; fovDrop is the zoom.
        // It is very accurate when aimed, but the hip shot wanders (spread).
        id: 'sniper', name: 'TRANSIT RIFLE', auto: false, boltAction: true, scope: true, damage: 96, interval: 1.35,
        mag: 5, reserve: 20, maxReserve: 40, reloadTime: 2.4, spread: 0.05, adsSpreadCut: 0.99, adsAccurateAt: 0.55, adsSpeed: 24, pellets: 1, range: 250, critMul: 2.5,
        knockback: 16, stun: 0.5, camKick: 0.07, camYaw: 0.01, climb: 0.012, kickZ: 0.06, kickRot: 0.12,
        flashSize: 0.5, worldLight: 40, heat: 16, tracerColor: 0xbfe8ff,
        ads: { x: 0, y: -0.09, z: -0.25, fovDrop: 52 },
      },
      // The shovel is the DIG SITE tool. Hidden: it is not in the inventory and never in a loadout slot.
      { id: 'shovel', name: 'SHOVEL', melee: true, hidden: true, damage: 0, interval: 0.6, range: 0, cone: 0, knockback: 0, stun: 0 },
    ],
  },

  enemies: {
    maxAlive: 40, // hard cap for performance
    spawnMinDistance: 10, // never spawn closer than this to the player
    spawnMargin: 2, // spawn this far inside the walls
    bootTime: 0.8, // idle "loading wheel" time after spawning
    attackWindup: 0.25,
    attackCooldown: 1.0,
    accel: 8,
    separationWeight: 2.2, // higher = bots spread out more
    hitFlashTime: 0.09,

    // --- bot athletics / tactics ---
    jumpSpeed: 8, // ~1.3 m jump with gravity 24
    gravity: 24,
    jumpClear: 1.2, // bots hop onto anything up to this tall
    dodgeAimRadius: 0.55, // metres (x scale) from your aim line that counts as "being aimed at"
    dodgeReaction: 0.18, // seconds your aim must stay on a bot before it reacts
    dodgeSpeed: 9,
    dodgeTime: 0.28,
    coverRadius: 16, // how far a hurt bot will run to find cover
    coverTimeout: 4,
    coverRunMul: 1.3,
    hideTime: [2, 3.5], // seconds crouched behind cover
    coverCooldown: [5, 9],
    ambushRange: 4.5, // hiding bots charge out if you get this close
    rushTime: 1.5,
    rushMul: 1.35,
    // color = hi-vis vest, head = cable-box head, hat = hard hat colour. scale 1 = a 1.7 m tall bot.
    // Extra looks (all optional): extraEar, stripes (reflective bands), spool (cable reel backpack),
    // jackhammer (big drill in the hands), cone (traffic cone for a hat), visor (welding mask).
    // ai: cover = chance (scaled by how hurt) to run for cover when hit; dodge = chance to sidestep when
    // aimed at; hop = chance a dodge includes a jump; leap = leaps per second when 3.5-7 m away.
    types: {
      router: {
        hp: 28, speed: 6.2, scale: 0.75, damage: 6, hat: 0xffffff, color: 0xdfe6ea, head: 0xf1f4f5, mass: 0.8, stunMul: 1, extraEar: true,
        ai: { cover: 0.15, dodge: 0.85, dodgeCooldown: 1.0, hop: 0.4, leap: 0.3 },
      },
      cable: {
        hp: 70, speed: 3.6, scale: 1, damage: 10, hat: 0xff7a00, color: 0x6a2fd6, head: 0x1a1b1f, mass: 1, stunMul: 1,
        ai: { cover: 0.5, dodge: 0.5, dodgeCooldown: 1.8, hop: 0.25, leap: 0 },
      },
      technician: {
        hp: 260, speed: 2.2, scale: 1.2, damage: 22, color: 0xff7a00, head: 0x2a2b30, mass: 3, stunMul: 0.35, hat: 0xe8b800, stripes: true,
        ai: { cover: 0.1, dodge: 0.1, dodgeCooldown: 3, hop: 0, leap: 0 },
      },
      lineman: { // pole climber: quick on its feet, hops a lot, carries a cable reel
        hp: 45, speed: 4.8, scale: 0.95, damage: 8, color: 0xffd400, head: 0x1a1b1f, hat: 0xffffff, mass: 0.9, stunMul: 1, spool: true, stripes: true,
        ai: { cover: 0.2, dodge: 0.7, dodgeCooldown: 1.2, hop: 0.6, leap: 0.15 },
      },
      splicer: { // glass-fibre splicer: fragile and fast, wears a welding visor
        hp: 22, speed: 7, scale: 0.8, damage: 5, color: 0x1ec6d6, head: 0x20242a, hat: 0x1ec6d6, mass: 0.7, stunMul: 1.2, visor: true,
        ai: { cover: 0.1, dodge: 0.9, dodgeCooldown: 0.8, hop: 0.5, leap: 0.4 },
      },
      foreman: { // tough and cautious: ducks behind cover often
        hp: 150, speed: 3, scale: 1.1, damage: 16, color: 0xff7a00, head: 0x2a2b30, hat: 0xffffff, mass: 1.8, stunMul: 0.6, stripes: true, extraEar: true,
        ai: { cover: 0.8, dodge: 0.3, dodgeCooldown: 2.2, hop: 0.1, leap: 0 },
      },
      jackhammer: { // slow heavy hitter with a drill
        hp: 420, speed: 1.9, scale: 1.35, damage: 30, color: 0xf2c200, head: 0x2a2b30, hat: 0xff7a00, mass: 4, stunMul: 0.25, stripes: true, jackhammer: true,
        ai: { cover: 0.05, dodge: 0.05, dodgeCooldown: 4, hop: 0, leap: 0 },
      },
      coneHead: { // cheap fodder wearing a traffic cone
        hp: 36, speed: 4.2, scale: 0.9, damage: 7, color: 0xff7a00, head: 0x1a1b1f, mass: 0.9, stunMul: 1, cone: true,
        ai: { cover: 0.3, dodge: 0.5, dodgeCooldown: 1.5, hop: 0.3, leap: 0 },
      },
    },
  },

  waves: {
    baseCount: 6,
    countGrowth: 3, // extra bots per wave
    spawnInterval: 0.9,
    intervalDecay: 0.94,
    minInterval: 0.25,
    speedGrowth: 0.06, // bots get this much faster each wave
    maxSpeedMul: 1.7,
    intermission: 3.5,
  },

  // DIG SITE (see dig-mode.js). Rules numbers live on the server; the cooldown here only paces the swing.
  dig: {
    half: 24, // the site is 48 x 48 tiles of 1 m
    wallHeight: 2.5,
    reach: 3, // metres from you to the tile your crosshair can dig
    swingTime: 0.4, // seconds you stand still while the shovel swings
    cooldownBase: 0.6, // keep in step with server/src/dig/rules.rs
    cooldownPerLayer: 0.12,
    layerInches: 6,
    maxDepthInches: 132,
    sendHz: 20,
  },

  // DEATHMATCH VS BOTS (see bot-match.js): the deathmatch rules, played alone against the cable bots
  botMatch: {
    unlimited: true, // solo practice: infinite health and ammo. Set false for the normal rules (respawns, protection, limited ammo)
    botCount: 6, // bots kept alive at once (enemies.maxAlive is the hard cap)
    spawnInterval: 1.5, // seconds between topping the bots back up
    speedMul: 1.1,
    respawnTime: 3,
    spawnProtect: 2,
    killLimit: 20, // first to this many kills wins; the bots' kills are your deaths
    matchRestartDelay: 8,
    regenDelay: 5,
    regenRate: 8,
  },

  // LAN deathmatch (see deathmatch.js)
  multiplayer: {
    sendHz: 20, // state updates per second
    renderDelay: 0.1, // seconds: other players are drawn this far in the past, so motion stays smooth
    respawnTime: 3,
    spawnProtect: 2, // seconds of invulnerability after spawning
    killLimit: 20, // first to this many kills wins the match
    matchRestartDelay: 8,
    regenDelay: 5, // seconds without taking damage before health starts to come back
    regenRate: 8, // health per second while regenerating
    pickupInterval: 7, // seconds between ammo / health crates appearing around the arena
    pickupMax: 6, // most crates lying around at once
    pickupLife: 30, // seconds a crate lasts (dropped and spawned ones)
    dropHealthChance: 0.4, // a dead player always drops ammo, and health with this chance
  },

  pickups: {
    dropChance: 0.28,
    healthBias: 0.65, // chance a drop is health when you are hurt
    poolPerKind: 16,
    collectRadius: 1.3,
    lifetime: 18,
    healthAmount: 25,
    ammo: { pistol: 24, shotgun: 8, slug: 3, smg: 60, raygun: 40, sniper: 5 }, // keys match weapons (shotgun = buckshot) and ammoTypes[].pickupKey
  },
};

/* ========================================================================== *
 *  Renderer, scene, camera
 * ========================================================================== */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.autoClear = false; // we clear once, then draw world + viewmodel layers
renderer.toneMapping = THREE.ACESFilmicToneMapping; // filmic highlight roll-off: the biggest single step toward "realistic"
renderer.toneMappingExposure = CONFIG.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Everything that casts shadows is static (the arena), so render the shadow map
// once, on the first frame, and never again.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

const scene = new THREE.Scene();
const envMap = createEnvironment(renderer); // sky-lit reflections and ambient light for all PBR materials
scene.environment = envMap;
scene.environmentIntensity = 0.7;
const skyDome = createSkyDome(250); // follows the camera so it can never be clipped by the far plane
scene.add(skyDome);
scene.fog = new THREE.Fog(CONFIG.fogColor, 45, 130); // sandbox widens this in startMode

const camera = new THREE.PerspectiveCamera(CONFIG.player.fov, window.innerWidth / window.innerHeight, 0.1, 320);

/* ========================================================================== *
 *  Game objects
 * ========================================================================== */
const audio = new AudioFX();
const hud = new Hud(CONFIG);
const fx = createEffects(scene);
const world = new World(scene, CONFIG);
const player = new Player(camera, world, CONFIG.player);
const enemies = new Enemies({ cfg: CONFIG, scene, world, fx, player });
const weapons = new Weapons({ cfg: CONFIG, camera, mainScene: scene, envMap, world, enemies, player, fx, hud, audio });
const cyborg = new Cyborg({ scene, player, weapons });
weapons.tp = cyborg;
const pickups = new Pickups(scene, CONFIG);
const scoreboard = new Scoreboard();
const net = new NetClient({
  onStatus: (status) => {
    mpMenu.setStatus(status);
    digLobby.setStatus(status);
    if (status === NET_STATUS.ONLINE && pendingSolo) startSoloDigNow();
    if (status === NET_STATUS.CLOSED && pendingSolo) {
      pendingSolo = false;
      soloMenu.setStatus('COULD NOT REACH THE SERVER');
    }
    if (status === NET_STATUS.CLOSED && (game.mode === 'deathmatch' || game.mode === 'dig')) toMenu();
  },
  onRoster: (players) => onNetRoster(players),
  onJoinError: (code) => mpMenu.showError(code),
  onDig: (message) => onDigMessage(message),
  onMessage: (from, message) => {
    remotes.receive(from, message, performance.now() * 0.001);
    deathmatch.onMessage(from, message);
  },
});
const remotes = new RemotePlayers({ scene, fx, world, weapons, audio, config: CONFIG.multiplayer });
remotes.listener = camera;
weapons.enemies = new Targets({ enemies, remotes }); // shots now hit bots and other players alike
const deathmatch = new Deathmatch({
  config: CONFIG.multiplayer, arenaHalf: CONFIG.arena.half, net, player, weapons, cyborg, remotes, world, scoreboard, hud, pickups,
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
});
const digLobby = new DigLobbyScreen({
  onJoin: (name) => net.sendDig({ t: 'dg_join', name }),
  onStart: () => net.sendDig({ t: 'dg_start' }),
  onBack: () => {
    net.sendDig({ t: 'dg_leave' });
    net.close();
    digLobby.reset();
    digLobby.close();
    hud.showStart(true, false);
  },
});
const inventory = new Inventory({
  weapons,
  onResume: () => {
    inventory.close();
    audio.unlock();
    requestLock();
  },
});

const game = { kills: 0, time: 0, mode: null }; // mode: null (menu) | 'waves' | 'sandbox' | 'deathmatch' | 'botmatch' | 'dig'

player.onDamage = () => {
  hud.damage();
  audio.hurt();
};
player.onJump = () => audio.jump();
player.onLand = (impact) => audio.land(impact);
player.onSlide = () => audio.slide();
player.onDeath = () => {
  if (game.mode === 'deathmatch') { // no game-over screen: the match respawns you
    audio.deathDialup();
    deathmatch.onLocalDeath();
    return;
  }
  if (game.mode === 'botmatch') {
    audio.deathDialup();
    botMatch.onPlayerDeath();
    return;
  }
  hud.showDeath(director.wave, game.kills);
  audio.deathDialup();
  document.exitPointerLock();
};

enemies.onKill = (e) => {
  if (game.mode === 'botmatch') botMatch.onBotKilled();
  game.kills += 1;
  hud.setKills(game.kills);
  pickups.maybeDrop(e.pos.x, e.pos.y, e.pos.z, player.health < CONFIG.player.maxHealth * 0.5);
};

pickups.onCollect = (kind) => {
  if (kind === 'health') {
    if (player.health >= CONFIG.player.maxHealth) return false; // leave it for later
    player.heal(CONFIG.pickups.healthAmount);
  } else if (!weapons.addAmmo(CONFIG.pickups.ammo)) {
    return false;
  }
  audio.pickup();
  return true;
};

/* ========================================================================== *
 *  Wave director: spawns bots in growing, speeding-up waves
 * ========================================================================== */
const WAVE_TYPES = [
  { type: 'cable', from: 1, weight: 5 },
  { type: 'router', from: 1, weight: 3 },
  { type: 'coneHead', from: 2, weight: 3 },
  { type: 'lineman', from: 3, weight: 2.5 },
  { type: 'splicer', from: 4, weight: 2 },
  { type: 'technician', from: 3, weight: 1.5 },
  { type: 'foreman', from: 5, weight: 1.5 },
  { type: 'jackhammer', from: 6, weight: 1 },
];

const director = {
  wave: 0,
  toSpawn: 0,
  spawnTimer: 0,
  spawnInterval: 1,
  speedMul: 1,
  intermission: 0,

  reset() {
    this.wave = 0;
    this.toSpawn = 0;
    this.intermission = 1.2; // short pause before wave 1
    hud.setWave(1);
  },

  startWave(n) {
    const w = CONFIG.waves;
    this.wave = n;
    this.toSpawn = w.baseCount + w.countGrowth * (n - 1);
    this.spawnInterval = Math.max(w.minInterval, w.spawnInterval * Math.pow(w.intervalDecay, n - 1));
    this.speedMul = Math.min(w.maxSpeedMul, 1 + w.speedGrowth * (n - 1));
    this.spawnTimer = 0;
    hud.setWave(n);
    hud.banner(`WAVE ${n}`);
  },

  /** Weighted pick among the types unlocked by this wave (`from`), so new kinds show up as waves go on. */
  pickType() {
    const table = WAVE_TYPES.filter((entry) => this.wave >= entry.from);
    let roll = Math.random() * table.reduce((sum, entry) => sum + entry.weight, 0);
    for (const entry of table) {
      roll -= entry.weight;
      if (roll <= 0) return entry.type;
    }
    return table[0].type;
  },

  update(dt) {
    if (this.intermission > 0) {
      this.intermission -= dt;
      if (this.intermission <= 0) this.startWave(this.wave + 1);
      return;
    }
    if (this.toSpawn > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer > 0) return;
      const burst = 1 + Math.floor(this.wave / 4); // bigger groups later on
      for (let i = 0; i < burst && this.toSpawn > 0; i++) {
        if (enemies.alive.length >= CONFIG.enemies.maxAlive) break;
        if (enemies.spawnAtEdge(this.pickType(), this.speedMul)) this.toSpawn -= 1;
      }
      this.spawnTimer = this.spawnInterval;
    } else if (enemies.alive.length === 0) {
      this.intermission = CONFIG.waves.intermission;
    }
  },
};

/* ========================================================================== *
 *  Multiplayer glue
 * ========================================================================== */
/** The server roster changed: update the lobby list, avatars and match tables; start the match once joined. */
function onNetRoster(players) {
  mpMenu.setRoster(players, net.id);
  if (game.mode === 'dig') return; // the deathmatch roster is not this game's: dig keeps its own player list
  remotes.sync(players, net.id);
  if (game.mode === 'deathmatch') deathmatch.onRoster(players);
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
      if (game.mode === 'dig') {
        dig.onLobby(message);
        if (message.phase === 'lobby') backToDigLobby(); // someone pressed BACK TO LOBBY: everyone follows
      }
      break;
    case 'dg_error':
      digLobby.showError(message.code);
      break;
    case 'dg_map':
      soloMenu.close();
      startMode('dig', message);
      break;
    default:
      dig.onMessage(message);
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
  net.sendDig({ t: 'dg_solo', name: loadName() ?? '' }); // the server falls back to "Solo" for a bad name
}

function openDig() {
  hud.showStart(false);
  digLobby.open();
  net.connect();
  digLobby.setStatus(net.status); // already connected: no status change will come
}

/** Leave the match screen for the lobby screen, staying connected. */
function backToDigLobby() {
  dig.stop();
  game.mode = null;
  remotes.clear();
  hud.clearNumbers();
  document.exitPointerLock();
  hud.showStart(false);
  digLobby.open();
}

function openMultiplayer() {
  hud.showStart(false);
  mpMenu.open();
  net.connect();
}

/* ========================================================================== *
 *  Input
 * ========================================================================== */
const input = {
  forward: false, back: false, left: false, right: false,
  sprintHeld: false, fireHeld: false, aimHeld: false, boardHeld: false, crouchHeld: false, leanLeft: false, leanRight: false,
  // One-shot edges: latched until a fixed step consumes them, so a press is never
  // lost on a rendered frame that happens to run zero fixed steps.
  jumpPressed: false, slidePressed: false, sprintPressed: false, firePressed: false, ammoPressed: false,
  reloadPressed: false, meleePressed: false, selectSlot: -1, wheel: 0,

  clearEdges() {
    this.jumpPressed = this.slidePressed = this.sprintPressed = this.firePressed = this.ammoPressed = false;
    this.reloadPressed = this.meleePressed = false;
    this.selectSlot = -1;
    this.wheel = 0;
  },

  clearAll() {
    this.forward = this.back = this.left = this.right = false;
    this.sprintHeld = this.fireHeld = this.aimHeld = this.boardHeld = this.crouchHeld = false;
    this.leanLeft = this.leanRight = false;
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
  if (game.mode === 'dig') return !inventory.isOpen && !dig.ended; // nothing to resume once the results show
  const respawns = game.mode === 'deathmatch' || game.mode === 'botmatch'; // these revive you, so a dead player may still resume
  return game.mode !== null && !inventory.isOpen && (player.alive || respawns);
}

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return; // typing a username: no game shortcuts
  if (e.code === 'KeyM') {
    audio.toggleMute();
    return;
  }
  if (inventory.isOpen) {
    // The menu is open and the pointer is free: keys pick slots or close it.
    if (e.code === 'KeyI') inventory.onResume();
    else if (e.code === 'Escape') {
      inventory.close();
      hud.showStart(player.alive, game.mode !== null);
    } else if (e.code.startsWith('Digit') && e.code <= 'Digit3') inventory.selectSlot(Number(e.code.slice(5)) - 1);
    else return;
    e.preventDefault();
    return;
  }
  if (e.code === 'KeyI' && player.alive && game.mode !== null && game.mode !== 'dig' && !e.repeat) {
    inventory.open();
    hud.showStart(false);
    document.exitPointerLock(); // the game pauses while the pointer is free
    e.preventDefault();
    return;
  }
  if (!locked || !player.alive) return; // dead players cannot act
  if (e.repeat) {
    e.preventDefault();
    return;
  }
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': input.forward = true; break;
    case 'KeyS': case 'ArrowDown': input.back = true; break;
    case 'KeyA': case 'ArrowLeft': input.left = true; break;
    case 'KeyD': case 'ArrowRight': input.right = true; break;
    case 'ShiftLeft': case 'ShiftRight':
      if (!e.repeat) input.sprintPressed = true; // a fresh tap cancels a slide
      input.sprintHeld = true;
      break;
    case 'Space': input.jumpPressed = true; break;
    case 'KeyC': case 'ControlLeft': // slides when sprinting, otherwise crouches while held
      input.slidePressed = true;
      input.crouchHeld = true;
      break;
    case 'KeyQ': input.leanLeft = true; break;
    case 'KeyE': input.leanRight = true; break;
    case 'KeyR': input.reloadPressed = true; break;
    case 'KeyF': input.meleePressed = true; break;
    case 'KeyT': player.toggleView(); break; // first / third person
    case 'KeyG': input.boardHeld = true; break; // multiplayer scoreboard while held
    case 'Tab': input.ammoPressed = true; break; // swap shotgun ammo type
    case 'Digit1': input.selectSlot = 0; break;
    case 'Digit2': input.selectSlot = 1; break;
    case 'Digit3': input.selectSlot = 2; break;
    case 'Digit4': input.selectSlot = 3; break;
    default: return;
  }
  e.preventDefault();
});

document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': input.forward = false; break;
    case 'KeyS': case 'ArrowDown': input.back = false; break;
    case 'KeyA': case 'ArrowLeft': input.left = false; break;
    case 'KeyD': case 'ArrowRight': input.right = false; break;
    case 'ShiftLeft': case 'ShiftRight': input.sprintHeld = false; break;
    case 'KeyG': input.boardHeld = false; break;
    case 'KeyC': case 'ControlLeft': input.crouchHeld = false; break;
    case 'KeyQ': input.leanLeft = false; break;
    case 'KeyE': input.leanRight = false; break;
    default: break;
  }
});

document.addEventListener('mousedown', (e) => {
  if (!locked || !player.alive) return;
  if (e.button === 0) {
    input.fireHeld = true;
    input.firePressed = true;
  } else if (e.button === 2) {
    input.aimHeld = true; // hold right mouse to aim down sights
  }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fireHeld = false;
  if (e.button === 2) input.aimHeld = false;
});
// Any click that is not on a menu button takes the mouse back. Buttons stop their own click
// from reaching here, so MAIN MENU and the like still work.
document.addEventListener('click', () => {
  if (locked || !canResume()) return;
  audio.unlock();
  requestLock();
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => {
  if (locked && player.alive) input.wheel = Math.sign(e.deltaY);
}, { passive: true });
document.addEventListener('mousemove', (e) => {
  if (!locked || !player.alive) return;
  player.look(e.movementX, e.movementY);
  weapons.addLook(e.movementX, e.movementY);
});
window.addEventListener('blur', () => input.clearAll());

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  input.clearAll(); // avoid keys stuck "down" when focus changes
  hud.showStart(!locked && player.alive && !inventory.isOpen, game.mode !== null);
});

document.addEventListener('pointerlockerror', () => hud.showStart(player.alive, game.mode !== null));

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
  else net.sendDig({ t: 'dg_again' });
});
digHud.el.menu.addEventListener('click', (e) => { e.stopPropagation(); toMenu(); });
hud.el.resume.addEventListener('click', (e) => { e.stopPropagation(); audio.unlock(); requestLock(); });
hud.el.toMenu.addEventListener('click', (e) => { e.stopPropagation(); toMenu(); });
hud.el.deadMenu.addEventListener('click', (e) => { e.stopPropagation(); toMenu(); });

hud.el.dead.addEventListener('click', () => {
  audio.unlock();
  startMode(game.mode);
});

/** Back to the mode-select screen (the scene keeps rendering behind it). */
function toMenu() {
  const wasDeathmatch = game.mode === 'deathmatch';
  const wasDig = game.mode === 'dig';
  if (game.mode === 'botmatch') botMatch.stop();
  game.mode = null; // first: closing the connection reports "closed", which must not re-enter here
  if (wasDeathmatch) {
    deathmatch.stop();
    net.close();
    remotes.clear();
    hud.setKills(0);
  }
  if (wasDig) {
    dig.stop();
    net.sendDig({ t: 'dg_leave' });
    net.close();
    remotes.clear();
    digLobby.reset();
  }
  enemies.clear();
  pickups.clear();
  hud.clearNumbers();
  hud.hideDeath();
  player.invulnerable = false;
  weapons.infiniteAmmo = false;
  hud.showStart(true, false);
}

/** Start (or restart) a mode: rebuild the level, reset everything, lock the pointer. */
function startMode(mode, payload = null) {
  const sandbox = mode === 'sandbox';
  game.mode = mode;
  world.build(sandbox ? 'sandbox' : mode === 'dig' ? 'dig' : 'waves'); // deathmatch plays in the wave arena
  renderer.shadowMap.needsUpdate = true; // shadows are static: re-render them for the new level
  scene.fog.far = sandbox ? 230 : 130;
  scene.fog.near = sandbox ? 70 : 45;
  player.spawnX = 0;
  player.spawnY = 0;
  player.spawnYaw = 0;
  player.spawnZ = sandbox ? CONFIG.sandbox.half - 30 : 22;
  player.reset();
  cyborg.reset();
  player.invulnerable = sandbox;
  weapons.reset();
  weapons.infiniteAmmo = sandbox;
  enemies.clear();
  pickups.clear();
  hud.clearNumbers();
  hud.hideDeath();
  hud.setMode(mode);
  game.kills = 0;
  hud.setKills(0);
  if (mode === 'waves') director.reset();
  if (mode === 'botmatch') botMatch.start();
  if (mode === 'deathmatch') deathmatch.start();
  if (mode === 'dig') {
    digLobby.close();
    dig.solo = !!payload.solo;
    digHud.setSolo(dig.solo);
    dig.start(payload);
    cyborg.reset(); // after dig.start: the player now stands on the site's spawn tile
    renderer.shadowMap.needsUpdate = true; // the houses and poles are new static shadow casters
  }
  accumulator = 0;
  audio.unlock();
  requestLock();
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  weapons.resize(aspect);
});

/* ========================================================================== *
 *  Main loop: fixed-timestep simulation, interpolated rendering
 * ========================================================================== */
let accumulator = 0;
let lastTime = performance.now();

function fixedUpdate(dt) {
  const digging = game.mode === 'dig';
  if (digging) dig.fixedUpdate(input);
  const stepInput = digging ? dig.filterInput(input) : input; // digging: stand still mid-swing, no weapon keys
  if (player.alive) { // in a bot match the world runs on while you wait to respawn, but the dead do nothing
    player.update(dt, stepInput);
    weapons.update(dt, stepInput);
  }
  enemies.update(dt);
  if (game.mode === 'waves') director.update(dt);
  if (player.alive) pickups.update(dt, player.pos);
  input.clearEdges();
}

function renderFrame(alpha, dt) {
  player.applyCamera(alpha, dt);
  skyDome.position.copy(camera.position);
  camera.updateMatrixWorld(); // HUD projection and viewmodel read this frame's camera
  cyborg.update(dt, alpha, game.time, weapons);
  weapons.updateView(dt, game.time);
  enemies.animate(alpha, game.time, dt);
  remotes.update(dt, game.time, performance.now() * 0.001);
  pickups.animate(game.time);
  fx.update(dt);
  hud.setHealth(player.health, CONFIG.player.maxHealth);
  hud.update(dt, camera, weapons.crosshairSpread());

  renderer.clear();
  renderer.render(scene, camera);
  weapons.render(renderer);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, CONFIG.maxFrameDelta);
  lastTime = now;
  game.time += dt;

  const online = game.mode === 'deathmatch' || game.mode === 'dig'; // these matches run on even when the pointer is released
  const resultsShowing = game.mode === 'dig' && dig.ended;
  const respawning = game.mode === 'botmatch'; // the world keeps running while you are dead and waiting to respawn
  const playing = (locked || online) && (player.alive || respawning) && game.mode !== null && !resultsShowing;
  if (!playing) weapons.cease(); // never leave a beam (or its hum) running while paused
  if (!player.alive) input.clearAll(); // dead: forget held keys and latched presses, so respawning starts clean
  let alpha = 1;
  if (playing) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= CONFIG.fixedStep && steps < CONFIG.maxStepsPerFrame) {
      fixedUpdate(CONFIG.fixedStep);
      accumulator -= CONFIG.fixedStep;
      steps += 1;
    }
    if (steps === CONFIG.maxStepsPerFrame) accumulator = 0; // way behind: drop the backlog
    alpha = accumulator / CONFIG.fixedStep;
  }
  if (game.mode === 'deathmatch') deathmatch.update(dt, { boardHeld: input.boardHeld });
  if (game.mode === 'dig') dig.update(dt);
  if (game.mode === 'botmatch' && playing) botMatch.update(dt, { boardHeld: input.boardHeld });
  // The match keeps running when the mouse is released: always show how to get it back.
  if (online && !locked && canResume() && hud.el.start.style.display === 'none') hud.showStart(true, true);
  renderFrame(alpha, dt);
}

hud.setKills(0);
hud.showStart(true, false);
requestAnimationFrame(frame);
