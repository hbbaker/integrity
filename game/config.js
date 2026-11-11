import { WEAPON_LIST } from './weapons/index.js';

/* ========================================================================== *
 *  CONFIG: every tuning value lives here. Distances are metres, times are
 *  seconds, angles are radians unless noted.
 * ========================================================================== */
export const CONFIG = {
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
    // Crouching in the air (the slam): sideways speed fades and the fall builds up, so you drop into a crouch smoothly.
    slamSpeed: 11, // m/s: the fastest the slam falls
    slamAccel: 38, // m/s each second the fall speeds up (gravity alone is 24)
    slamDamping: 7, // how fast sideways speed fades: higher stops you sooner (7 loses half in 0.1 s)
    leanDistance: 0.45, // metres the eye shifts sideways at a full lean (Q / E)
    leanTilt: 0.2, // radians the view rolls at a full lean
    leanSpeed: 12, // how fast the lean moves in and out
    leanClearance: 0.18, // how much room the eye needs, so a lean stops at walls
    stepHeight: 0.35, // ledges/ramps lower than this are walked up without jumping
    climbSpeed: 2.5, // m/s up the wall of a dug hole (DIG SITE) while you push against it
    snapDown: 0.2, // how far we stay glued to a downward ramp
    // Mantling: in the air, pushing forward into a ledge you could not simply walk or jump onto pulls you up onto it.
    mantleMaxHeight: 2.1, // highest ledge top (metres above your feet) you can grab; a jump alone clears about 1.4
    mantleDepth: 0.5, // the ledge must be at least this deep (metres past the wall) to stand on
    mantleTime: 0.45, // seconds the climb takes

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
    // Flick forgiveness (quickscoping): the faster the view is turning when you shoot, the more forgiving the hit
    // detection gets. Speeds are the view's turn rate in radians per second (a quick flick is roughly 8-15).
    flick: {
      minSpeed: 2, // below this (normal tracking and aiming) nothing is added
      fullSpeed: 10, // at or above this the full bonus applies; in between it ramps up smoothly
      maxBoost: 1, // at a full flick the distance-based growth of every hit volume is multiplied by (1 + this)
      maxExtraRadius: 0.06, // metres added to every hit volume at a full flick (helps at close range)
      hipShare: 0.35, // share of the bonus without the sights up: ADS flicks get all of it
      memory: 0.18, // seconds a flick still counts after the view stops moving (the click comes just after the flick)
    },
    handsIndex: 0, // the always-available item (work gloves): its own key and the last stop of the wheel
    startIndex: 1, // what you hold after a reset
    defaultLoadout: [1, 2, 3], // list indices on keys 1-3
    switchTime: 0.26,
    adsSpeed: 14, // how fast the gun moves between hip and sights (higher = snappier)
    sprintExitDelay: 0.1, // pause between "fire pressed while sprinting" and the first shot
    maxHeat: 24, // crosshair spread added by sustained fire (px)
    heatDecay: 45,
    crosshair: { base: 6, perSpeed: 1.1, air: 10 },
    quickMelee: { damage: 28, range: 2.8, cooldown: 0.5, knockback: 11, cone: 0.8, stun: 0.45 },
    list: WEAPON_LIST, // one file per weapon in game/weapons/: its numbers are the `config` there
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
        hp: 28, glow: 0x00f0ff, speed: 6.2, scale: 0.75, damage: 6, hat: 0xffffff, color: 0xdfe6ea, head: 0xf1f4f5, mass: 0.8, stunMul: 1, extraEar: true,
        ai: { cover: 0.15, dodge: 0.85, dodgeCooldown: 1.0, hop: 0.4, leap: 0.3 },
      },
      cable: {
        hp: 70, glow: 0x8a4dff, speed: 3.6, scale: 1, damage: 10, hat: 0xff7a00, color: 0x6a2fd6, head: 0x1a1b1f, mass: 1, stunMul: 1,
        ai: { cover: 0.5, dodge: 0.5, dodgeCooldown: 1.8, hop: 0.25, leap: 0 },
      },
      technician: {
        hp: 260, glow: 0xffb800, speed: 2.2, scale: 1.2, damage: 22, color: 0xff7a00, head: 0x2a2b30, mass: 3, stunMul: 0.35, hat: 0xe8b800, stripes: true,
        ai: { cover: 0.1, dodge: 0.1, dodgeCooldown: 3, hop: 0, leap: 0 },
      },
      lineman: { // pole climber: quick on its feet, hops a lot, carries a cable reel
        hp: 45, glow: 0x3dff9a, speed: 4.8, scale: 0.95, damage: 8, color: 0xffd400, head: 0x1a1b1f, hat: 0xffffff, mass: 0.9, stunMul: 1, spool: true, stripes: true,
        ai: { cover: 0.2, dodge: 0.7, dodgeCooldown: 1.2, hop: 0.6, leap: 0.15 },
      },
      splicer: { // glass-fibre splicer: fragile and fast, wears a welding visor
        hp: 22, glow: 0xff2bd6, speed: 7, scale: 0.8, damage: 5, color: 0x1ec6d6, head: 0x20242a, hat: 0x1ec6d6, mass: 0.7, stunMul: 1.2, visor: true,
        ai: { cover: 0.1, dodge: 0.9, dodgeCooldown: 0.8, hop: 0.5, leap: 0.4 },
      },
      foreman: { // tough and cautious: ducks behind cover often
        hp: 150, glow: 0xff7a1a, speed: 3, scale: 1.1, damage: 16, color: 0xff7a00, head: 0x2a2b30, hat: 0xffffff, mass: 1.8, stunMul: 0.6, stripes: true, extraEar: true,
        ai: { cover: 0.8, dodge: 0.3, dodgeCooldown: 2.2, hop: 0.1, leap: 0 },
      },
      jackhammer: { // slow heavy hitter with a drill
        hp: 420, glow: 0xff3b5c, speed: 1.9, scale: 1.35, damage: 30, color: 0xf2c200, head: 0x2a2b30, hat: 0xff7a00, mass: 4, stunMul: 0.25, stripes: true, jackhammer: true,
        ai: { cover: 0.05, dodge: 0.05, dodgeCooldown: 4, hop: 0, leap: 0 },
      },
      coneHead: { // cheap fodder wearing a traffic cone
        hp: 36, glow: 0x00f0ff, speed: 4.2, scale: 0.9, damage: 7, color: 0xff7a00, head: 0x1a1b1f, mass: 0.9, stunMul: 1, cone: true,
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

  // Controller support (see gamepad.js). Sticks are 0..1 after the dead zone.
  gamepad: {
    deadzone: 0.18,
    moveThreshold: 0.35, // left stick tilt that counts as holding a direction
    triggerThreshold: 0.35, // how far RT / LT go down to count as pressed
    lookSpeed: 3.6, // radians per second at full right-stick tilt (about 206 degrees)
    lookCurve: 1.8, // above 1: small pushes turn slowly for fine aim, a full push turns fast
    invertY: false,
    moveStick: 'left', // 'right' swaps the sticks (southpaw)
    navRepeat: 0.18, // seconds between highlight steps while the stick is held in a menu
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
    ammo: { pistol: 24, shotgun: 8, slug: 3, smg: 60, raygun: 40, sniper: 5, drill: 1 }, // keys match weapons (shotgun = buckshot) and ammoTypes[].pickupKey
  },
};
