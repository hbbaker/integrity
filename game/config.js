import { WEAPON_LIST } from './weapons/index.js';

/* ========================================================================== *
 *  CONFIG: every tuning value lives here. Distances are metres, times are
 *  seconds, angles are radians unless noted.
 * ========================================================================== */
export const CONFIG = {
  fixedStep: 1 / 60, // gameplay tick rate; rendering is interpolated between ticks
  maxFrameDelta: 0.1, // clamp so a tab switch cannot cause a giant catch-up
  maxStepsPerFrame: 5,
  internalHeight: 480, // render height in pixels (original Xbox: 480p); the canvas is scaled up to the window
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
    thirdPerson: {
      dist: 3.2, shoulder: 0.55, aimDist: 1.5, aimShoulder: 0.85, pivotDrop: 0.15,
      // Ctrl + wheel moves the camera: dist is multiplied by a zoom between zoomMin and zoomMax, one zoomStep per notch.
      zoomMin: 0.4, zoomMax: 2.5, zoomStep: 1.15,
    },
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
    // The pistol a bot carries (a type with `gun: {...}` of its own overrides any of these; a type without `gun` is melee only).
    // It raises the gun for `aimTime` seconds first (your warning), then fires bursts at you with `spread` radians of aim error.
    gun: {
      damage: 6, // per hit (per pellet when `pellets` is above 1)
      pellets: 1, // rays per shot
      barrelLength: 1, // how long the gun model looks (1 = a pistol)
      interval: 0.4, // seconds between shots in a burst
      burst: [2, 4], // shots in a burst
      burstPause: [0.9, 1.6], // seconds between bursts when shooting from the open
      aimTime: 0.55,
      spread: 0.05,
      range: 28, // metres: it only shoots at you inside this
      minRange: 3, // closer than this it uses its fists instead
      holdDistance: [8, 14], // metres: it stops closing in and shoots from about here
      strafeSpeed: 0.45, // how fast (as a share of its speed) it sidesteps while shooting from the open
      coverSeekRate: 0.45, // chance per second, while it has a line on you, of running for cover instead
      peekTime: [1.4, 2.4], // seconds it stands up from behind cover
      peeks: [3, 5], // times it pops up before it moves to other cover
      duckChance: 0.75, // chance it ducks when you aim at it as it peeks (and it always ducks when hit)
      tracerColor: 0xffd24d,
      muzzleHeight: 1.28, // metres above its feet (times its scale) when standing
    },
    // color = hi-vis vest, head = cable-box head, hat = hard hat colour. scale 1 = a 1.7 m tall bot.
    // Extra looks (all optional): extraEar, stripes (reflective bands), spool (cable reel backpack),
    // jackhammer (big drill in the hands), cone (traffic cone for a hat), visor (welding mask), gun (carries a pistol).
    // Routers and jackhammers have no `gun`: they close in and use their fists.
    // ai: cover = chance (scaled by how hurt) to run for cover when hit; dodge = chance to sidestep when
    // aimed at; hop = chance a dodge includes a jump; leap = leaps per second when 3.5-7 m away.
    types: {
      router: {
        hp: 28, glow: 0x00f0ff, speed: 6.2, scale: 0.75, damage: 6, hat: 0xffffff, color: 0xdfe6ea, head: 0xf1f4f5, mass: 0.8, stunMul: 1, extraEar: true,
        ai: { cover: 0.15, dodge: 0.85, dodgeCooldown: 1.0, hop: 0.4, leap: 0.3 },
      },
      cable: {
        hp: 70, glow: 0x8a4dff, speed: 3.6, scale: 1, damage: 10, hat: 0xff7a00, color: 0x6a2fd6, head: 0x1a1b1f, mass: 1, stunMul: 1, gun: {},
        ai: { cover: 0.5, dodge: 0.5, dodgeCooldown: 1.8, hop: 0.25, leap: 0 },
      },
      technician: {
        hp: 260, glow: 0xffb800, speed: 2.2, scale: 1.2, damage: 22, color: 0xff7a00, head: 0x2a2b30, mass: 3, stunMul: 0.35, hat: 0xe8b800, stripes: true, gun: { damage: 9, interval: 0.7, burst: [1, 2], coverSeekRate: 0.15 }, // a slow heavy: stands its ground
        ai: { cover: 0.1, dodge: 0.1, dodgeCooldown: 3, hop: 0, leap: 0 },
      },
      lineman: { // pole climber: quick on its feet, hops a lot, carries a cable reel
        hp: 45, glow: 0x3dff9a, speed: 4.8, scale: 0.95, damage: 8, color: 0xffd400, head: 0x1a1b1f, hat: 0xffffff, mass: 0.9, stunMul: 1, spool: true, stripes: true, gun: { interval: 0.33, spread: 0.07 },
        ai: { cover: 0.2, dodge: 0.7, dodgeCooldown: 1.2, hop: 0.6, leap: 0.15 },
      },
      splicer: { // glass-fibre splicer: fragile and fast, wears a welding visor
        hp: 22, glow: 0xff2bd6, speed: 7, scale: 0.8, damage: 5, color: 0x1ec6d6, head: 0x20242a, hat: 0x1ec6d6, mass: 0.7, stunMul: 1.2, visor: true, gun: { damage: 4, spread: 0.08, strafeSpeed: 0.8 }, // fragile and fidgety
        ai: { cover: 0.1, dodge: 0.9, dodgeCooldown: 0.8, hop: 0.5, leap: 0.4 },
      },
      foreman: { // tough and cautious: ducks behind cover often
        hp: 150, glow: 0xff7a1a, speed: 3, scale: 1.1, damage: 16, color: 0xff7a00, head: 0x2a2b30, hat: 0xffffff, mass: 1.8, stunMul: 0.6, stripes: true, extraEar: true, gun: { damage: 8, coverSeekRate: 0.9, peeks: [4, 6] }, // the cautious one: lives behind cover
        ai: { cover: 0.8, dodge: 0.3, dodgeCooldown: 2.2, hop: 0.1, leap: 0 },
      },
      jackhammer: { // slow heavy hitter with a drill
        hp: 420, glow: 0xff3b5c, speed: 1.9, scale: 1.35, damage: 30, color: 0xf2c200, head: 0x2a2b30, hat: 0xff7a00, mass: 4, stunMul: 0.25, stripes: true, jackhammer: true,
        ai: { cover: 0.05, dodge: 0.05, dodgeCooldown: 4, hop: 0, leap: 0 },
      },
      coneHead: { // cheap fodder wearing a traffic cone
        hp: 36, glow: 0x00f0ff, speed: 4.2, scale: 0.9, damage: 7, color: 0xff7a00, head: 0x1a1b1f, mass: 0.9, stunMul: 1, cone: true, gun: { damage: 5, spread: 0.07 },
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
    unlimited: false, // true = solo practice: infinite health and ammo. False = the normal rules (respawns, protection, limited ammo)
    botType: 'cable', // the 1v1 opponent: a type that carries a gun
    botCount: 1, // bots kept alive at once: 1 is the duel (enemies.maxAlive is the hard cap)
    spawnInterval: 1.5, // seconds before a new bot (with a new random weapon) replaces one you killed
    speedMul: 1.1,
    respawnTime: 3,
    spawnProtect: 2,
    killLimit: 10, // first to this many kills wins; the bot's kills are your deaths
    matchRestartDelay: 8,
    regenDelay: 5,
    regenRate: 8,
    // The duel bot picks one of these at random each time it spawns. Same keys as `enemies.gun`; anything left out comes from it.
    loadouts: [
      { name: 'NAIL GUN', damage: 7 },
      { name: 'RIVET BLASTER', damage: 5, pellets: 6, spread: 0.07, interval: 0.9, burst: [1, 1], range: 20, minRange: 2, holdDistance: [5, 8], aimTime: 0.6, barrelLength: 1.4 },
      { name: 'FRAMING NAILER', damage: 4, interval: 0.1, burst: [5, 9], burstPause: [1, 1.8], spread: 0.045, range: 35, barrelLength: 1.2 },
      { name: 'TRANSIT RIFLE', damage: 30, interval: 1, burst: [1, 1], spread: 0.012, aimTime: 1.1, range: 60, minRange: 6, holdDistance: [18, 28], burstPause: [1.6, 2.4], barrelLength: 2 },
      { name: 'OLE RELIABLE', damage: 20, interval: 0.55, burst: [2, 3], spread: 0.02, aimTime: 0.5, range: 40, barrelLength: 1.3 },
    ],
  },

  // MOUNTAIN (see game/rules/ski-run.js): ride a course on skis or on a board. The courses themselves are in game/ski/.
  ski: {
    fog: { near: 80, far: 420 }, // a mountain is seen from far away
    terrain: {
      cell: 1, // metres between ground heights: the snow you see and the snow you ride use the same grid
      chunkCells: 40, // cells along one side of a terrain chunk (one draw call each)
      textureTile: 8, // metres one repeat of the snow texture covers; a chunk must be a whole number of tiles
      snowColor: 0xe6edf5,
      rockColor: 0x6f7378, // steep ground shows rock
      rockStart: 0.72, // the upward part of the ground normal where rock starts to show (about 44 degrees of slope) ...
      rockFull: 0.55, // ... and where it is all rock (about 57 degrees)
    },
    // The chase camera (see game/ski/chase-camera.js).
    camera: {
      far: 460, // draw distance in metres (the stage's own is shorter)
      distance: 6.5, // metres from the rider; Ctrl + wheel scales it, as in third person
      lookHeight: 1.3, // metres above the rider's feet that the camera orbits
      lead: 4, // metres past the rider that the camera looks at, so more of the slope ahead is in view
      pitch: 0.3, // radians above the rider's level where the camera rests
      minPitch: -0.15,
      maxPitch: 1.25,
      clearance: 1.1, // metres the camera stays above the snow
      sightMargin: 0.4, // metres the line from the camera to the rider clears the ground by
      followRate: 9, // how fast the camera closes on its place (per second); lower trails further behind at speed
      returnDelay: 0.9, // seconds after the last look input before the camera swings back behind the rider
      returnRate: 2.5, // how fast it swings back at returnFullSpeed (per second); slower when the rider is slow, never at rest
      returnFullSpeed: 12, // m/s
      speedFov: 14, // degrees the view widens at speedFovFull ...
      speedFovFull: 38, // ... m/s
      fovRate: 4, // how fast the view widens and narrows (per second)
    },
    // How the ride moves (see game/ski/rider.js). The numbers under `rides` differ between skis and a board.
    rider: {
      gravity: 13, // m/s^2: stronger than real, so a run gets up to speed quickly
      friction: 0.035, // snow friction, as a share of the rider's weight
      stillFriction: 0.14, // ... for a ride at rest: it holds on slopes up to about 8 degrees, until you push
      stillSpeed: 0.4, // m/s: slower than this the ride counts as at rest
      drag: 0.007, // air drag standing up: with the slope it sets the top speed (about 28 m/s on 27 degrees)
      tuckDrag: 0.0038, // ... and in a full tuck (about 39 m/s)
      airDrag: 0.002, // drag while in the air
      maxSpeed: 50, // m/s: nothing goes faster than this
      brakeDecel: 9, // m/s^2 at full brake
      pushSpeed: 5, // m/s: below this, "tuck" pushes off (poles, or a skate with the board)
      pushAccel: 4, // m/s^2
      minTurnSpeed: 3, // m/s: below this the turn rate no longer grows
      edgeFullSpeed: 12, // m/s at which a full steer puts the ride fully on its edge
      mountainEdgeCarve: 0.3, // how far onto an edge the ride must be, as a share of how far it can roll at its speed, for that edge to count as the one it is on
      mountainEdgeSlope: 0.08, // with the ride flat: how much its side must face up the hill (the sine of the tilt) for that edge to count
      weathervane: 2, // how fast the ride swings round to point the way it travels (per second), when not steered
      weathervaneMinSpeed: 1.5, // m/s: slower than this the ride keeps pointing where it was put
      // Pop and air (see Rider._pop, _rotateInAir, _land).
      popChargeTime: 0.5, // seconds the pop control must be held for a full pop
      popSpeedMin: 2.6, // m/s off the snow for a tap ...
      popSpeedMax: 6, // ... and for a full charge (about 1.4 m of height on level ground)
      popLate: 0.12, // seconds after the ride leaves the snow in which a release still pops (a pop timed on a lip)
      flickSpin: 7, // radians per second of spin from one full flick sideways
      flickFlip: 7.5, // ... of flip from one full flick up or down
      airSpinAccel: 9, // radians per second, each second, while a direction is held in the air
      airFlipAccel: 10,
      maxSpinRate: 14,
      maxFlipRate: 13,
      landFlipTolerance: 0.75, // radians from the right way up at which a landing still holds
      landSpinTolerance: 0.7, // radians from pointing along the path (forward or backward)
      // Edge catching (see Rider._watchForCatch and docs/adr/0010).
      catchMinSpeed: 6, // m/s: slower than this an edge never catches
      catchWarn: 0.45, // share of the way to a catch at which the HUD warns
      steerSet: 0.3, // how far the steering (0..1) must be to one side to count as demanding that edge
      // The wrong edge for the slope: the ride is set on its downhill edge and the snow tilts sideways under it by more than
      // wrongEdgeSlope (the sine of the tilt). 0.3 is a 30 degree slope with the ride more than 37 degrees off the fall line,
      // or a 20 degree slope with it more than 61 degrees off. On gentler slopes it never counts.
      wrongEdgeSlope: 0.3,
      wrongEdgeGrace: 0.25, // seconds on the wrong edge before it catches, with nothing earned: enough only for a small turn
      // A held edge earns more grace for the next edge (see Rider._trackEdgeHold): nothing below edgeHoldMin seconds on
      // the old edge, all of wrongEdgeBonus at edgeHoldFull. Time spent flat between the edges takes the hold away again.
      edgeHoldMin: 0.3,
      edgeHoldFull: 0.9,
      wrongEdgeBonus: 0.6, // seconds: with a full hold the grace is 0.85 s, enough for a wide turn on a steep slope
      // The other edge during a brake: a load, in metres of sideways travel on the leading edge.
      catchRecover: 0.08, // load that drains each second
      skidSlip: 0.8, // share of the speed that is sideways in a full brake
      snapDistance: 0.3, // metres the snow may drop away under the ride and still hold it (ripples, gentle rolls) ...
      lookAhead: 0.12, // ... measured this many seconds ahead along a free flight: further below than that, the ride is in the air
      alignRate: 14, // how fast the ride tilts to a new slope (per second)
      bodyRadius: 0.35, // metres: the rider, for hitting trees and rocks
      bonkBounce: 0.2, // share of the speed into a tree or rock that comes back out
      bonkKeep: 0.45, // share of all speed kept after such a hit
      edgeMargin: 3, // metres from the edge of the course where the rider stops
    },
    rides: {
      skis: {
        maxLateralAccel: 15, // m/s^2 a turn can pull: higher turns tighter at speed
        maxTurnRate: 2.8, // radians per second, at low speed
        grip: 11, // how fast sideways speed dies (per second): higher carves, lower drifts
        edgeRate: 9, // how fast the ride goes from one edge to the other (per second)
        startEdge: -1, // the edge the ride counts as being on before it has turned: -1 left, +1 right
        catchLimit: 0.08, // brake load at which the leading edge catches: higher forgives more
        edgeChangeTime: 0.08, // seconds the steering must be neutral between one edge and the other at speed
      },
      // Surfier: wider turns, slower from edge to edge. toeEdge: the side the toes are on (+1 right: a regular stance). It starts heelside.
      board: { maxLateralAccel: 12.5, maxTurnRate: 2.3, grip: 8, edgeRate: 6.5, startEdge: -1, toeEdge: 1, catchLimit: 0.1, edgeChangeTime: 0.1 },
    },
    // Style points (see game/ski/tricks.js) and the flick that starts a spin or a flip (core/client/engine/flick-detector.js).
    tricks: {
      pointsPerHalfSpin: 100, // each 180 degrees
      pointsPerFlip: 400,
      pointsPerGrab: 150,
      pointsPerGrabSecond: 200, // more for a grab held longer ...
      grabMaxTime: 1.5, // ... up to this many seconds
      grabMinTime: 0.2, // seconds a grab must be held to count
      comboBonus: 0.5, // each extra kind of trick (spin, flip, grab) in one air time adds this share
      switchBonus: 0.25, // a landing backward adds this share
      bannerTime: 2.5, // seconds the name of a landed trick stays on the screen
      flick: {
        window: 0.1, // seconds the mouse or stick movement is added up over
        threshold: 45, // movement (mouse pixels) that counts as a flick
        full: 220, // movement of a full-strength flick
        cooldown: 0.18, // seconds before the next flick can start
      },
    },
    // The landing (see game/ski/landing.js). The gravity load is the greatest height above the snow that the rider had in the air.
    landing: {
      crashLimit: 4.5, // metres of load, after the stomp, at which the rider goes down: a lip is safe, a cliff band is not
      sketchyShare: 0.7, // share of the limit from which a landing is sketchy
      sketchyKeep: 0.65, // share of the speed kept after a sketchy landing
      stompAbsorb: 3, // metres a stomp takes away
      absorbPerStyle: 0.004, // metres more for each style point of the air time ...
      styleAbsorbMax: 6, // ... up to this many
      stompWindow: 0.18, // seconds before the snow in which the stomp counts
      windowPerStyle: 0.0002, // seconds more for each style point ...
      stompWindowMax: 0.6, // ... up to this
      stompMinLoad: 1.5, // metres of height from which a stomp is worth the name
      alignPenalty: 2.5, // metres added for a landing at the edge of the tolerance for a flip, and again for a spin; no stomp takes them away
      stompedBonus: 0.5, // share of extra style points for a stomped landing
      sketchyPoints: 0.5, // share of the style points a sketchy landing keeps
    },
    // The rider's body (see game/ski/pose-solver.js). Positions are metres in the ride's frame: +X right, +Y up, -Z ahead.
    pose: {
      blendRate: 8, // how fast the body moves between stances (per second)
      maxEdge: 0.7, // radians the ride rolls onto its edge in a full turn
      inclineShare: 0.85, // how much of that roll the whole body leans with
      angulation: 0.45, // share of the lean that the chest takes back, to stay over the ride
      headLevel: 0.75, // share of the lean that the head takes back, to keep the eyes level
      headIntoTurn: 0.3, // radians the head turns into a full turn
      skidChestShare: 0.4, // share of the ride's swing across the slope (a brake) that the chest follows; the head keeps looking ahead
      headLeanShare: 0.25, // share of the torso's forward lean that the head follows
      hipsLeanShare: 0.35, // share of the torso's forward lean that the hips take
      kneeIntoTurn: 0.35, // how far the knees drive into a full turn
      airExtend: 0.07, // metres the legs lengthen in the air
      airArmLift: 0.12, // metres the hands rise in the air ...
      airArmSpread: 0.1, // ... and move apart
      popCrouch: 0.2, // metres the hips sink at a full pop charge
      // The landing: the body folds by how hard it came down (the share of the crash limit that was left), then comes back up.
      landing: { crouch: 0.3, lean: 0.35, kick: 24, frequency: 2.2, damping: 0.75 }, // metres and radians at a full load; kick sets how fast it folds
      // Tricks: how the body shows a spin, a flip and a grab.
      trick: {
        tuckLift: 0.24, // metres the ride comes up under the body in a full tuck (a fast spin or flip, or a grab)
        tuckSpin: 9, // radians per second of spin at which the tuck is full ...
        tuckFlip: 8, // ... and of flip
        spinTwist: 0.55, // radians the chest leads a full-speed spin
        headTwist: 0.8, // ... and the head
        maxSpin: 14, // the spin rate that counts as full speed here
        grabRate: 12, // how fast a hand goes to a grab and back (per second)
        grabLift: 0.3, // metres more that the ride comes up in a grab ...
        grabLean: 0.75, // ... and radians more that the torso folds down to it
      },
      sway: {
        frequency: 2.4, // cycles per second: how quickly the upper body catches up
        damping: 0.6, // below 1: it overshoots a little before it settles
        perAccel: 0.012, // radians of sway for each m/s^2
        max: 0.3, // radians
        handShare: 0.5, // metres the hands move for each radian of sway
      },
      skis: {
        rideHalfWidth: 0.2, // metres from the middle of the ride to its outer edge
        feet: { Left: { x: -0.14, z: 0, yaw: 0 }, Right: { x: 0.14, z: 0, yaw: 0 } },
        bodyYaw: 0, // radians the hips are turned away from straight ahead
        chestYaw: 0,
        kneeSplay: 0.08, // radians each knee points out from its toes
        tipLead: 0.09, // metres the inside ski runs ahead in a full turn
        hipDrop: 0.1, // metres below standing height
        tuckHipDrop: 0.36,
        hipBack: 0.12, // metres the hips move back for each radian the torso folds forward
        lean: 0.32, // radians the torso folds forward
        tuckLean: 1.05,
        brakeHipDrop: 0.12, // extra, at full brake
        brakeLeanBack: 0.1,
        skidYaw: 0.95, // radians the skis swing across the slope at full brake (a hockey stop), tails toward the mountain edge's side
        brakeEdge: 0.4, // radians the ride rolls onto the mountain edge at full brake
        palmRoll: 1.1, // radians the palms turn in (around a pole grip)
        // Grabs: which hand, and the point of the ride it takes (in the ride's frame).
        grabs: {
          indy: { hand: 'Right', point: { x: 0.2, y: 0.06, z: 0.05 } }, // outside of the right ski, at the boot
          mute: { hand: 'Left', point: { x: 0.08, y: 0.08, z: -0.2 } }, // across to the right ski, ahead of the boot
          nose: { hand: 'Left', point: { x: -0.14, y: 0.06, z: -0.38 } }, // the left ski, ahead of the boot
          tail: { hand: 'Right', point: { x: 0.14, y: 0.06, z: 0.2 } }, // the right ski, behind the boot
        },
        poleRest: { x: 0.12, y: -0.8, z: 0.58 }, // the way a pole points from the right hand (mirrored for the left): down and back
        poleTuck: { x: 0.05, y: -0.2, z: 0.98 }, // ... and in a tuck: back along the body
        // Wrists from the middle of the pelvis, in the chest's own frame.
        hands: { Left: { x: -0.3, y: 0.16, z: -0.34 }, Right: { x: 0.3, y: 0.16, z: -0.34 } },
        tuckHands: { Left: { x: -0.1, y: 0.4, z: -0.3 }, Right: { x: 0.1, y: 0.4, z: -0.3 } },
      },
      board: { // regular stance: the left foot leads and the body faces the right
        rideHalfWidth: 0.14,
        feet: { Left: { x: 0, z: -0.26, yaw: -1.31 }, Right: { x: 0, z: 0.26, yaw: -1.68 } }, // toes to the right; the front foot opens toward the nose
        bodyYaw: -1.15,
        chestYaw: -0.75, // the chest opens toward the way of travel
        kneeSplay: 0,
        tipLead: 0,
        hipDrop: 0.14,
        tuckHipDrop: 0.36,
        hipBack: 0.1,
        lean: 0.14,
        tuckLean: 0.5,
        brakeHipDrop: 0.14,
        brakeLeanBack: 0.2,
        skidYaw: 1.0, // radians the board swings across the slope at full brake: nose right for a toeside brake, left for heelside
        brakeEdge: 0.45,
        palmRoll: 0,
        grabs: { // regular stance: the left hand is the front hand, and the toes are on the right edge
          indy: { hand: 'Right', point: { x: 0.15, y: 0.03, z: 0.04 } }, // back hand, toe edge, between the feet
          mute: { hand: 'Left', point: { x: 0.15, y: 0.03, z: -0.06 } }, // front hand, toe edge
          nose: { hand: 'Left', point: { x: 0.06, y: 0.08, z: -0.46 } },
          tail: { hand: 'Right', point: { x: 0.08, y: 0.08, z: 0.4 } },
        },
        hands: { Left: { x: -0.4, y: 0.22, z: -0.1 }, Right: { x: 0.4, y: 0.22, z: -0.1 } },
        tuckHands: { Left: { x: -0.24, y: 0.2, z: -0.28 }, Right: { x: 0.3, y: 0.3, z: 0.05 } },
      },
    },
    // A crash: the rider becomes a ragdoll in the physics world (see game/ski/ragdoll.js), then gets up where it stops.
    crash: {
      minTime: 1.2, // seconds the rider stays down at least
      maxTime: 6, // ... and at most
      stillSpeed: 0.7, // m/s: slower than this the body counts as stopped ...
      stillTime: 0.6, // ... once it has been for this long
      legsKeep: 0.45, // share of the speed the legs keep at an edge catch: the snow holds them and the body goes over
      tossUp: 1.6, // m/s the upper body is thrown up ...
      tossSide: 0.22, // ... and toward the side of the caught edge, as a share of the speed
      body: {
        density: 950, // kg per cubic metre
        friction: 0.6, // on snow: enough to stop on all but the steepest faces
        linearDamping: 0.08,
        angularDamping: 1.6, // stops limbs from spinning like propellers
        radius: { pelvis: 0.13, chest: 0.15, head: 0.1, thigh: 0.075, shin: 0.06, arm: 0.045 }, // metres
      },
      // What comes off (skis, poles) or stays on (a board): boxes in the physics world.
      loose: {
        density: 500,
        friction: 0.12, // a ski slides far
        linearDamping: 0.05,
        angularDamping: 0.8,
        spin: 5, // radians per second a loose ski or pole tumbles at the start
        scatter: 1.8, // m/s it is thrown out to its side
        // The box of each thing, in its model's own frame (metres): half its size each way, and where its middle is.
        ski: { halfSize: { x: 0.05, y: 0.02, z: 0.85 }, centre: { x: 0, y: 0.02, z: -0.07 } },
        pole: { halfSize: { x: 0.015, y: 0.57, z: 0.015 }, centre: { x: 0, y: -0.57, z: 0 } },
        board: { halfSize: { x: 0.14, y: 0.02, z: 0.72 }, centre: { x: 0, y: 0.01, z: 0 } },
      },
      ground: {
        friction: 0.6,
        halfCells: 28, // the physics ground is a square this many grid cells each way from the body ...
        marginCells: 8, // ... rebuilt around the body when it comes this near the edge
      },
    },
    // The shadow map follows the rider (the sun's shadows are static in the other modes).
    shadow: {
      reach: 90, // metres each way from the rider that cast shadows
      step: 16, // metres the rider moves before the shadows are drawn again
      mapSize: 2048,
    },
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
    ammo: { pistol: 24, shotgun: 8, slug: 3, smg: 60, raygun: 40, sniper: 5, drill: 1, revolver: 12 }, // keys match weapons (shotgun = buckshot) and ammoTypes[].pickupKey
  },

  // Worn armor (see game/armor/): the pieces a player equips on the character screen.
  armor: {
    maxReduction: 0.5, // the most damage that any set of armor can remove, as a fraction
  },

  // The mech suit: a power-armour frame much bigger than the human who steps into it from behind.
  suit: {
    scale: 1.7, // body size against the human; the hit cylinder and the eye scale with it
    interactRadius: 4.6, // how close the player must be to step in
    // The numbers every suit starts from. Part stats are added on top (see game/suit/suit-stats.js).
    baseline: {
      speedMul: 0.8, // walk, sprint and slide speed
      jumpDelay: 0.15, // seconds between pressing jump and the legs firing
      slideDelay: 0.2, // seconds between pressing slide and the slide starting
      healthMul: 3, // the suit's health, as a multiple of the player's own
    },
    // The beacon: thrown to call the suit down, or to send it back up. It flies in an arc, lands, and the suit follows.
    beacon: {
      throwSpeed: 15, // m/s along the aim
      throwLift: 3, // m/s extra upward, so it arcs
      gravity: 18,
      maxFlight: 6, // seconds in the air before it is given up on
      landDelay: 0.8, // seconds it blinks on the ground before the suit comes (or goes)
      noRoomBanner: 'NO ROOM FOR THE SUIT',
    },
    // The suit falling from the sky and rising back into it.
    sky: { height: 80, dropTime: 1.6, liftTime: 1.4, beamLinger: 0.9, shake: 0.7, shakeRange: 25 },
    walkBehind: 3.4, // metres behind the suit where the human steps in and out
    // Seconds each stage of stepping in (and, run backwards, out) takes: the back and limbs open, the human walks in, they close.
    enterTimes: { open: 1.1, step: 1.7, close: 1.1 },
    orbit: { dist: 7.5 }, // third-person camera distance while the animation plays
    collider: { width: 0.8, height: 1.9 }, // the standing suit's solid, times scale
  },
};
