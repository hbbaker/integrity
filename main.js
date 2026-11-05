import * as THREE from 'three';

import { createEffects, createEnvironment, createSkyDome } from './effects.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Weapons } from './weapons.js';
import { Enemies } from './enemies.js';
import { Pickups } from './pickups.js';
import { Hud } from './hud.js';
import { AudioFX } from './audio.js';

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

  player: {
    maxHealth: 100,
    radius: 0.4,
    eyeHeight: 1.65,
    slideEyeHeight: 0.85,
    stepHeight: 0.35, // ledges/ramps lower than this are walked up without jumping
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
    adsSensitivity: 0.65, // look sensitivity multiplier while aiming

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
      { id: 'fists', name: 'FISTS', melee: true, damage: 20, interval: 0.3, range: 2.6, cone: 0.78, knockback: 9, stun: 0.45 },
      {
        id: 'pistol', name: 'PISTOL', auto: false, damage: 24, interval: 0.2, mag: 12, reserve: 60, maxReserve: 96,
        reloadTime: 1.0, spread: 0.004, pellets: 1, range: 120, critMul: 2, knockback: 2.5, stun: 0.1,
        camKick: 0.018, camYaw: 0.004, climb: 0.002, kickZ: 0.022, kickRot: 0.07, flashSize: 0.3, worldLight: 25,
        heat: 5, tracerColor: 0xfff27a,
        ads: { x: 0, y: -0.093, z: -0.32, fovDrop: 12 }, // fovDrop = degrees of zoom
      },
      {
        // TAB swaps shell type. The shells in the tube go back to reserve, and you must reload
        // (shell by shell) with the new type. Fields in ammoTypes override the shared ones.
        id: 'shotgun', name: 'SHOTGUN', auto: false, interval: 0.8, mag: 6, critMul: 2,
        perShell: true, startTime: 0.3, shellTime: 0.42, endTime: 0.25,
        camYaw: 0.008, kickRot: 0.12, worldLight: 40, heat: 14,
        ads: { x: 0, y: -0.057, z: -0.28, fovDrop: 8 },
        defaultAmmo: 'buckshot',
        ammoTypes: {
          buckshot: {
            // 8 fat pellets (pelletRadius = how forgiving each pellet is), each with its own damage
            // number. Damage tapers from falloffStart to falloffEnd down to falloffMin.
            label: 'BUCKSHOT', pickupKey: 'shotgun', reserve: 24, maxReserve: 36,
            damage: 11, pellets: 8, spread: 0.055, pelletRadius: 0.1, range: 60,
            falloffStart: 5, falloffEnd: 25, falloffMin: 0.15, pelletNumbers: true,
            knockback: 8, stun: 0.25, camKick: 0.05, climb: 0.004, kickZ: 0.045, flashSize: 0.5, tracerColor: 0xffb347,
          },
          slug: {
            // One heavy, accurate, long-range projectile.
            label: 'SLUG', pickupKey: 'slug', reserve: 8, maxReserve: 20,
            interval: 0.95, damage: 62, pellets: 1, spread: 0.007, pelletRadius: 0.04, range: 140,
            falloffStart: 30, falloffEnd: 90, falloffMin: 0.6, pelletNumbers: false,
            knockback: 14, stun: 0.35, camKick: 0.075, climb: 0.008, kickZ: 0.06, flashSize: 0.55, tracerColor: 0xffe9b0,
          },
        },
      },
      {
        id: 'smg', name: 'SMG', auto: true, damage: 7, interval: 0.075, mag: 30, reserve: 120, maxReserve: 180,
        reloadTime: 1.5, spread: 0.02, pellets: 1, range: 90, critMul: 2, knockback: 1.2, stun: 0.05,
        camKick: 0.007, camYaw: 0.006, climb: 0.0045, kickZ: 0.014, kickRot: 0.035, flashSize: 0.22, worldLight: 18,
        heat: 2.5, tracerColor: 0x9ff3ff,
        ads: { x: 0, y: -0.08, z: -0.3, fovDrop: 14 },
      },
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
    // color = vest/suit, head = cable-box head. 
    // color = vest, head = cable-box head. scale 1 = a 1.7 m tall bot.
    // ai: cover = chance (scaled by how hurt) to run for cover when hit; dodge = chance to sidestep when
    // aimed at; hop = chance a dodge includes a jump; leap = leaps per second when 3.5-7 m away.
    types: {
      router: {
        hp: 28, speed: 6.2, scale: 0.75, damage: 6, color: 0xdfe6ea, head: 0xf1f4f5, mass: 0.8, stunMul: 1, extraEar: true,
        ai: { cover: 0.15, dodge: 0.85, dodgeCooldown: 1.0, hop: 0.4, leap: 0.3 },
      },
      cable: {
        hp: 70, speed: 3.6, scale: 1, damage: 10, color: 0x6a2fd6, head: 0x1a1b1f, mass: 1, stunMul: 1,
        ai: { cover: 0.5, dodge: 0.5, dodgeCooldown: 1.8, hop: 0.25, leap: 0 },
      },
      technician: {
        hp: 260, speed: 2.2, scale: 1.2, damage: 22, color: 0xff7a00, head: 0x2a2b30, mass: 3, stunMul: 0.35, hat: true, stripes: true,
        ai: { cover: 0.1, dodge: 0.1, dodgeCooldown: 3, hop: 0, leap: 0 },
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

  pickups: {
    dropChance: 0.28,
    healthBias: 0.65, // chance a drop is health when you are hurt
    poolPerKind: 10,
    collectRadius: 1.3,
    lifetime: 18,
    healthAmount: 25,
    ammo: { pistol: 24, shotgun: 8, slug: 3, smg: 60 }, // keys match weapons (shotgun = buckshot) and ammoTypes[].pickupKey
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
scene.add(createSkyDome(150));
scene.fog = new THREE.Fog(CONFIG.fogColor, 45, 130);

const camera = new THREE.PerspectiveCamera(CONFIG.player.fov, window.innerWidth / window.innerHeight, 0.1, 200);

/* ========================================================================== *
 *  Game objects
 * ========================================================================== */
const audio = new AudioFX();
const hud = new Hud(CONFIG);
const fx = createEffects(scene);
const world = new World(scene, CONFIG);
const player = new Player(camera, world, CONFIG.player);
const enemies = new Enemies({ cfg: CONFIG, scene, world, fx, player });
const weapons = new Weapons({ cfg: CONFIG, mainScene: scene, envMap, world, enemies, player, fx, hud, audio });
const pickups = new Pickups(scene, CONFIG);

const game = { kills: 0, time: 0 };

player.onDamage = () => {
  hud.damage();
  audio.hurt();
};
player.onJump = () => audio.jump();
player.onLand = (impact) => audio.land(impact);
player.onSlide = () => audio.slide();
player.onDeath = () => {
  hud.showDeath(director.wave, game.kills);
  audio.deathDialup();
  document.exitPointerLock();
};

enemies.onKill = (e) => {
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

  pickType() {
    const techChance = this.wave >= 3 ? Math.min(0.25, 0.07 * (this.wave - 2)) : 0;
    if (Math.random() < techChance) return 'technician';
    const routerChance = Math.min(0.5, 0.3 + 0.03 * this.wave);
    return Math.random() < routerChance ? 'router' : 'cable';
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
 *  Input
 * ========================================================================== */
const input = {
  forward: false, back: false, left: false, right: false,
  sprintHeld: false, fireHeld: false, aimHeld: false,
  // One-shot edges: latched until a fixed step consumes them, so a press is never
  // lost on a rendered frame that happens to run zero fixed steps.
  jumpPressed: false, slidePressed: false, firePressed: false, ammoPressed: false,
  reloadPressed: false, meleePressed: false, selectSlot: -1, wheel: 0,

  clearEdges() {
    this.jumpPressed = this.slidePressed = this.firePressed = this.ammoPressed = false;
    this.reloadPressed = this.meleePressed = false;
    this.selectSlot = -1;
    this.wheel = 0;
  },

  clearAll() {
    this.forward = this.back = this.left = this.right = false;
    this.sprintHeld = this.fireHeld = this.aimHeld = false;
    this.clearEdges();
  },
};

let locked = false;

function requestLock() {
  const result = canvas.requestPointerLock();
  if (result && result.catch) result.catch(() => {}); // browsers refuse if requested too soon after Esc
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    audio.toggleMute();
    return;
  }
  if (!locked) return;
  if (e.repeat) {
    e.preventDefault();
    return;
  }
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': input.forward = true; break;
    case 'KeyS': case 'ArrowDown': input.back = true; break;
    case 'KeyA': case 'ArrowLeft': input.left = true; break;
    case 'KeyD': case 'ArrowRight': input.right = true; break;
    case 'ShiftLeft': case 'ShiftRight': input.sprintHeld = true; break;
    case 'Space': input.jumpPressed = true; break;
    case 'KeyC': case 'ControlLeft': input.slidePressed = true; break;
    case 'KeyR': input.reloadPressed = true; break;
    case 'KeyV': input.meleePressed = true; break;
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
    default: break;
  }
});

document.addEventListener('mousedown', (e) => {
  if (!locked) return;
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
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => {
  if (locked) input.wheel = Math.sign(e.deltaY);
}, { passive: true });
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  player.look(e.movementX, e.movementY);
  weapons.addLook(e.movementX, e.movementY);
});
window.addEventListener('blur', () => input.clearAll());

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  input.clearAll(); // avoid keys stuck "down" when focus changes
  hud.showStart(!locked && player.alive);
});

document.addEventListener('pointerlockerror', () => hud.showStart(player.alive));

hud.el.start.addEventListener('click', () => {
  audio.unlock();
  requestLock();
});

hud.el.dead.addEventListener('click', () => {
  audio.unlock();
  restart();
});

function restart() {
  player.reset();
  weapons.reset();
  enemies.clear();
  pickups.clear();
  hud.clearNumbers();
  hud.hideDeath();
  game.kills = 0;
  hud.setKills(0);
  director.reset();
  accumulator = 0;
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
  player.update(dt, input);
  weapons.update(dt, input);
  enemies.update(dt);
  director.update(dt);
  pickups.update(dt, player.pos);
  input.clearEdges();
}

function renderFrame(alpha, dt) {
  player.applyCamera(alpha, dt);
  camera.updateMatrixWorld(); // HUD projection and viewmodel read this frame's camera
  weapons.updateView(dt, game.time);
  enemies.animate(alpha, game.time, dt);
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

  const playing = locked && player.alive;
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
  renderFrame(alpha, dt);
}

director.reset();
hud.setKills(0);
requestAnimationFrame(frame);
