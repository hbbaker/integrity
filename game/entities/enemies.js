import * as THREE from 'three';
import { material, xboxMaterial } from '../../core/client/graphics/materials.js';
import { surfaceMaterial, cssColor } from '../../core/client/graphics/surfaces.js';
import { clamp } from '../../core/client/engine/math.js';

/*
 * CABLE BOTS
 * Human-proportioned (about 1.7 m) telecom construction-crew robots: a cable-box
 * head with a glowing "12:00" clock face and antenna ears, hard hat, hi-vis vest over a long-
 * sleeved shirt, gloves, work pants and boots, with a coax coil on the belt.
 * Original design: no real logos or trademarks.
 *
 * BEHAVIOUR (all tunable in CONFIG.enemies)
 *  - advance: seek the player, separate from neighbours, melee on contact.
 *  - jump: hop onto platforms / low cover that block the way, and (Routers) leap
 *    at the player from a few metres out.
 *  - cover: when hurt, run to the far side of a tall box (one that actually blocks
 *    line of sight to the player), crouch there, then rush out.
 *  - pistols: most bots carry one (CONFIG.enemies.gun, per type `gun`). Within range and with a clear line, a bot
 *    stops closing in, raises the gun (your warning), and fires bursts, sidestepping as it does. Walls block its shots.
 *  - cover fire: a bot with a pistol uses cover on its own. It runs behind a tall box, crouches out of sight, stands
 *    to fire a burst, and ducks again (over a low box it stands up; round a tall one it leans out past the edge and steps
 *    back). It ducks at once when hit or when you aim at it, and moves to other cover when you flank it or it has
 *    peeked enough times.
 *  - dodge: if the player's crosshair rests on a bot for a moment, it sidesteps
 *    (sometimes with a hop). Hitscan is instant, so dodging means leaving the
 *    aim line BEFORE the shot: flick or lead your targets.
 *
 * Bots are pooled per variant: killing one hides it and returns it to a free
 * list, spawning pops from that list, so a long session creates no new objects.
 * Bots do not cast shadows (the shadow map is static); each gets a cheap blob
 * shadow under its feet instead.
 *
 * Model space (scale 1, facing +Z): feet y=0, hips 0.875, shoulders 1.35, head
 * centre 1.54, antenna tips ~1.8.
 */

const HIDE_CHECK = 0.4; // seconds between checks that cover still hides a bot from the player
const GUNNER_HIDE_SHARE = 0.5; // a bot with a pistol stays down for this share of the usual hide time
const STRAFE_FLIP = [1.2, 2.6]; // seconds between a shooting bot's changes of sidestep direction
const LINE_CHECK = 0.2; // seconds between line-of-sight checks while shooting from the open
const SHOT_SPARK = 0xffe27a;
const TRACER_SPEED = 140; // m/s: slow enough to see coming
const LEAN_CLEARANCE = 0.3; // metres past a box's edge that a bot leans out to shoot round it
const LEAN_SPEED = 1.15; // how fast it steps out and back, as a share of its speed
const ARRIVE = 0.3; // metres: close enough to a spot to be there
const RELOCATE_DISTANCE = 2.5; // metres: cover closer than this to where a bot already is does not count as "other" cover

const HIPS_Y = 0.875;
const PULL_END_STUN = 0.6; // seconds a grappled bot is dazed after being dragged to you
const CROUCH_DROP = 0.39; // how far the hips sink in a full crouch (matches the leg angles in animate())
const GOLD = 0xc9a227;
const CABLE_BLACK = 0x17181b;
const SHIRT = 0x2b2f36;
const PANTS = 0x30343b;
const BOOT = 0x141414;
const GLOVE = 0x16171a;

const HIT_LINES = ['PLEASE HOLD', 'YOUR CALL IS IMPORTANT', 'RESTARTING...'];
const KILL_LINES = ['SERVICE INTERRUPTED', 'RESTARTING...', 'PLEASE HOLD'];

/** Hit volumes in model space (times scale). `drop` is how far each sinks when fully crouched. */
const HEAD = { y: 1.54, r: 0.23, drop: 0.55 }; // crit zone; a little bigger than the drawn head so quick shots land
const TORSO = { y: 1.2, r: 0.36, drop: 0.42 }; // covers the arms and shoulders too
const LEGS = { y: 0.52, r: 0.33, drop: 0.2 };

/**
 * Aim forgiveness: every hit volume grows with distance along the ray, because the same
 * angular mistake misses by more metres the further away you are. At 50 m a volume is about
 * 0.3 m fatter; the growth stops at AIM_TOLERANCE_MAX so very long shots stay honest.
 */
export const AIM_TOLERANCE = 0.006; // metres of growth per metre of distance
const AIM_TOLERANCE_MAX = 0.35; // metres

/** Capsule hanging DOWN from its pivot (top at y=0), cached by dimensions. Rounded ends hide joint gaps. */
const limbCache = new Map();
function limbGeometry(length, radius) {
  const key = `${length}|${radius}`;
  if (!limbCache.has(key)) {
    const geometry = new THREE.CapsuleGeometry(radius, length, 2, 6);
    geometry.translate(0, -(length / 2 + radius), 0);
    limbCache.set(key, geometry);
  }
  return limbCache.get(key);
}

const GEO = {
  waist: new THREE.BoxGeometry(0.34, 0.22, 0.21),
  chest: new THREE.BoxGeometry(0.4, 0.32, 0.23),
  stripe: new THREE.BoxGeometry(0.405, 0.03, 0.235),
  head: new THREE.BoxGeometry(0.26, 0.26, 0.26),
  clock: new THREE.PlaneGeometry(0.2, 0.095),
  stick: new THREE.CylinderGeometry(0.008, 0.008, 0.22, 4),
  boot: new THREE.BoxGeometry(0.1, 0.09, 0.26),
  glove: new THREE.BoxGeometry(0.07, 0.1, 0.045),
  coil: new THREE.TorusGeometry(0.06, 0.016, 4, 8),
  hat: new THREE.SphereGeometry(0.17, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
  brim: new THREE.CylinderGeometry(0.2, 0.2, 0.025, 8),
  belt: new THREE.BoxGeometry(0.42, 0.06, 0.25),
  pouch: new THREE.BoxGeometry(0.07, 0.09, 0.06),
  reel: new THREE.CylinderGeometry(0.15, 0.15, 0.06, 8),
  reelCore: new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8),
  drill: new THREE.CylinderGeometry(0.045, 0.05, 0.42, 6),
  pistolSlide: new THREE.BoxGeometry(0.045, 0.2, 0.055), // its length runs along the forearm
  pistolGrip: new THREE.BoxGeometry(0.04, 0.05, 0.11),
  pistolBand: new THREE.BoxGeometry(0.05, 0.02, 0.06),
  chisel: new THREE.ConeGeometry(0.03, 0.2, 6),
  cone: new THREE.ConeGeometry(0.14, 0.34, 8),
  coneBase: new THREE.BoxGeometry(0.3, 0.025, 0.3),
  visor: new THREE.BoxGeometry(0.24, 0.07, 0.03),
  lightBar: new THREE.BoxGeometry(0.26, 0.022, 0.012),
  wheel: new THREE.RingGeometry(0.12, 0.22, 10, 1, 0, 4.6),
  blob: new THREE.CircleGeometry(0.5, 10),
};
GEO.blob.rotateX(-Math.PI / 2);

const DEFAULT_GLOW = 0x00f0ff; // fibre-optic cyan
const glowMaterials = new Map();

/** One unlit, glowing material per colour, shared by every bot that uses it (it is never flashed). */
function glowMaterial(hex) {
  if (!glowMaterials.has(hex)) glowMaterials.set(hex, new THREE.MeshBasicMaterial({ color: hex, toneMapped: false }));
  return glowMaterials.get(hex);
}

let sharedClockMaterial = null;
let sharedWheelMaterial = null;
let sharedBlobMaterial = null;

/** Glowing green "12:00" face, drawn once and shared by every bot. */
function getSharedMaterials() {
  if (!sharedClockMaterial) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#031a0c';
    ctx.fillRect(0, 0, 128, 64);
    ctx.font = '900 46px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#3dff7a';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#5dff8f';
    ctx.fillText('12:00', 64, 34);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    sharedClockMaterial = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    sharedWheelMaterial = new THREE.MeshBasicMaterial({ color: 0x40e0ff, side: THREE.DoubleSide, toneMapped: false });
    sharedBlobMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false });
  }
}

/** `boost` (>= 0) multiplies the distance-based growth: the flick forgiveness of fast view movement (see HoldableSystem.flickForgiveness). */
/** Distance along a ray to a sphere, or -1. No growth with distance: a bot's bullet is as fat as it looks. */
function rayHit(o, d, cx, cy, cz, r) {
  const lx = cx - o.x;
  const ly = cy - o.y;
  const lz = cz - o.z;
  const tca = lx * d.x + ly * d.y + lz * d.z;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return -1;
  const t = tca - Math.sqrt(r * r - d2);
  if (t >= 0) return t;
  return tca >= 0 ? 0 : -1;
}

export function raySphere(o, d, cx, cy, cz, r, boost = 0) {
  const lx = cx - o.x;
  const ly = cy - o.y;
  const lz = cz - o.z;
  const tca = lx * d.x + ly * d.y + lz * d.z;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const grown = r + Math.min(Math.max(tca, 0) * AIM_TOLERANCE * (1 + boost), AIM_TOLERANCE_MAX * (1 + boost));
  const r2 = grown * grown;
  if (d2 > r2) return -1;
  const thc = Math.sqrt(r2 - d2);
  const t = tca - thc;
  if (t >= 0) return t;
  return tca + thc >= 0 ? 0 : -1; // origin inside the sphere
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}


const rand = (range) => range[0] + Math.random() * (range[1] - range[0]);
const randInt = (range) => Math.floor(range[0] + Math.random() * (range[1] - range[0] + 1));

export class Enemies {
  /** `audio` is optional: with it bots' gunshots are heard. */
  constructor({ cfg, scene, world, fx, player, audio = null }) {
    this.cfg = cfg.enemies;
    this.arenaHalf = cfg.arena.half;
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.player = player;
    this.audio = audio;

    this.alive = [];
    this.pool = {};
    for (const key of Object.keys(this.cfg.types)) this.pool[key] = [];

    this.onKill = null; // (enemy) => void, set by main.js
    this.aimThreat = false; // set by Weapons: true while a gun is equipped (bots dodge when you aim at them)
    this.bubbleClock = 0;
    this.hit = { enemy: null, t: 0, crit: false }; // reused raycast result (no per-shot garbage)

    // Scratch values reused every tick.
    this._tmp = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._aimO = new THREE.Vector3();
    this._aimD = new THREE.Vector3();
    this._aimR = new THREE.Vector3();
    this._aimU = new THREE.Vector3();
    this._aimN = new THREE.Vector3(); // horizontal vector 90 degrees right of the aim direction
    this._hideDir = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._shotDir = new THREE.Vector3();
    this._pelletDir = new THREE.Vector3();
    this._shotEnd = new THREE.Vector3();
    this._aimValid = false;
    this.tvx = 0; // steering output (target velocity)
    this.tvz = 0;
  }

  /* ------------------------------ building ------------------------------- */

  _mesh(geometry, mat) {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  _build(key) {
    const def = this.cfg.types[key];
    getSharedMaterials();

    const root = new THREE.Group();
    const visual = new THREE.Group(); // scaled / squashed / leaned; root only moves and turns
    root.add(visual);

    // Per-bot materials so the hit flash only affects this bot.
    // Textured with colour and height (bump) maps but no glow map: the hit flash is a white emissive, and a glow map
    // would limit it to the glowing marks. The lights on a bot are separate meshes (see the light bar below).
    const flashable = { glowing: false };
    const vestMat = surfaceMaterial('weave', { color: cssColor(def.color), roughness: 0.7, metalness: 0.1, bumpScale: 2.5, ...flashable });
    const headMat = surfaceMaterial('plate', { color: cssColor(def.head), roughness: 0.4, metalness: 0.3, bumpScale: 2, ...flashable });
    const shirtMat = surfaceMaterial('weave', { color: cssColor(SHIRT), roughness: 0.85, metalness: 0, bumpScale: 2.5, ...flashable });
    const pantsMat = surfaceMaterial('weave', { color: cssColor(PANTS), roughness: 0.85, metalness: 0, bumpScale: 2.5, ...flashable });
    const bootMat = surfaceMaterial('rubber', { color: cssColor(BOOT), roughness: 0.7, metalness: 0, bumpScale: 3, ...flashable });
    const gloveMat = surfaceMaterial('rubber', { color: cssColor(GLOVE), roughness: 0.8, metalness: 0, bumpScale: 3, ...flashable });
    const cableMat = surfaceMaterial('brushed', { color: cssColor(CABLE_BLACK), roughness: 0.45, metalness: 0.3, bumpScale: 1.5, ...flashable });
    const mats = [vestMat, headMat, shirtMat, pantsMat, bootMat, gloveMat, cableMat];

    // Hips pivot: bobs, and sinks when crouching. Legs hang from it; the upper body sits on it.
    const hips = new THREE.Group();
    hips.position.y = HIPS_Y;
    visual.add(hips);

    const legs = [];
    for (const side of [-1, 1]) {
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.1, 0, 0);
      thigh.add(this._mesh(limbGeometry(0.28, 0.075), pantsMat));
      const knee = new THREE.Group();
      knee.position.y = -0.43;
      knee.add(this._mesh(limbGeometry(0.3, 0.055), pantsMat));
      const boot = this._mesh(GEO.boot, bootMat);
      boot.position.set(0, -0.4, 0.07);
      knee.add(boot);
      thigh.add(knee);
      hips.add(thigh);
      legs.push({ thigh, knee, side });
    }

    // Upper body (leans forward when running, and when crouched).
    const upper = new THREE.Group();
    hips.add(upper);
    const waist = this._mesh(GEO.waist, shirtMat);
    waist.position.y = 0.09;
    const chest = this._mesh(GEO.chest, vestMat);
    chest.position.y = 0.37;
    const coil = this._mesh(GEO.coil, cableMat); // coax coil on the belt
    coil.position.set(0.19, 0.06, 0.02);
    coil.rotation.y = Math.PI / 2;
    upper.add(waist, chest, coil);
    // A light bar across the chest in the type's own fibre colour (cyan unless the type says otherwise).
    const lightBar = new THREE.Mesh(GEO.lightBar, glowMaterial(def.glow ?? DEFAULT_GLOW));
    lightBar.position.set(0, 0.47, 0.118);
    upper.add(lightBar);
    if (def.stripes) { // hi-vis reflective bands
      const stripeMat = xboxMaterial({ color: 0xdfe3e6, roughness: 0.3, metalness: 0.6 });
      for (const y of [0.3, 0.42]) {
        const stripe = this._mesh(GEO.stripe, stripeMat);
        stripe.position.y = y;
        upper.add(stripe);
      }
    }

    // Head: a cable box with the clock face on the front and antenna ears on top.
    const head = new THREE.Group();
    head.position.y = 0.665;
    upper.add(head);
    head.add(this._mesh(GEO.head, headMat));
    const clock = new THREE.Mesh(GEO.clock, sharedClockMaterial);
    clock.position.set(0, 0.02, 0.131);
    head.add(clock);
    const earSpecs = [{ x: -0.08, tilt: 0.25, len: 1 }, { x: 0.08, tilt: -0.25, len: 1 }];
    if (def.extraEar) earSpecs.push({ x: 0, tilt: 0, len: 1.25 });
    for (const spec of earSpecs) {
      const ear = this._mesh(GEO.stick, cableMat);
      ear.scale.y = spec.len;
      ear.position.set(spec.x, 0.13 + 0.11 * spec.len, -0.03);
      ear.rotation.z = spec.tilt;
      head.add(ear);
    }
    if (def.hat !== undefined) this._addHardHat(head, def.hat, mats);
    if (def.cone) this._addCone(head, mats);
    if (def.visor) { // welding visor over the clock face
      const visorMat = new THREE.MeshBasicMaterial({ color: 0x35f0ff, toneMapped: false });
      const visor = new THREE.Mesh(GEO.visor, visorMat);
      visor.position.set(0, 0.02, 0.15);
      head.add(visor);
    }

    // Tool belt with pouches, on every bot.
    const beltMat = material(0x4a3420, { roughness: 0.8 });
    mats.push(beltMat);
    const belt = this._mesh(GEO.belt, beltMat);
    belt.position.y = 0.03;
    upper.add(belt);
    for (const x of [-0.12, 0.06]) {
      const pouch = this._mesh(GEO.pouch, beltMat);
      pouch.position.set(x, 0.0, 0.14);
      upper.add(pouch);
    }
    if (def.spool) this._addReel(upper, cableMat, mats);

    // Arms: shirt sleeve to the elbow, then a coax-cable forearm, gloved hand.
    const gun = def.gun ? { ...this.cfg.gun, ...def.gun } : null; // the pistol it carries: the shared one with the type's own changes
    const arms = [];
    let pistol = null;
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.255, 0.47, 0);
      shoulder.add(this._mesh(limbGeometry(0.22, 0.047), shirtMat));
      const elbow = new THREE.Group();
      elbow.position.y = -0.31;
      elbow.add(this._mesh(limbGeometry(0.2, 0.04), cableMat));
      const glove = this._mesh(GEO.glove, gloveMat);
      glove.position.y = -0.33;
      elbow.add(glove);
      if (def.jackhammer && side === 1) this._addJackhammer(elbow, mats);
      if (gun && side === 1) pistol = this._addPistol(elbow, mats);
      shoulder.add(elbow);
      upper.add(shoulder);
      arms.push({ shoulder, elbow, side });
    }

    // Loading wheel above the head, shown while booting or stunned.
    const wheel = new THREE.Mesh(GEO.wheel, sharedWheelMaterial);
    wheel.position.y = 2.15 * def.scale;
    wheel.scale.setScalar(def.scale);
    root.add(wheel);

    const blob = new THREE.Mesh(GEO.blob, sharedBlobMaterial);
    blob.position.y = 0.02;
    blob.scale.setScalar(def.scale * 1.1);
    root.add(blob);

    root.visible = false;
    this.scene.add(root);

    return {
      key, def, gun, baseGun: gun, pistol, root, visual, hips, upper, head, legs, arms, wheel, mats,
      pos: new THREE.Vector3(), prevPos: new THREE.Vector3(),
      vel: new THREE.Vector3(), knock: new THREE.Vector3(), dodgeDir: new THREE.Vector3(),
      hp: 0, speed: 0, radius: def.scale * 0.3, reach: 0.4 * def.scale + 0.9,
      yaw: 0, boot: 0, stun: 0, attackCd: 0, windup: 0, lunge: 0,
      flash: 0, flashApplied: 0, sq: 0, sqv: 0, walk: 0,
      blocked: 0, detour: 0, detourSign: 1, orbit: 1, bubbleCd: 0, phase: 0,
      // jumping
      vy: 0, grounded: true, jumpCd: 0, air: 0,
      // dodging
      dodgeT: 0, dodgeCd: 0, dodgeSign: 1, threat: 0, threatRolled: false, lean: 0,
      // cover
      state: 'advance', coverX: 0, coverZ: 0, coverT: 0, hideT: 0, coverCd: 0, crouch: 0, rush: 0,
      // pistol
      fireCd: 0, volley: 0, peekT: 0, peeks: 0, aimT: 0, aimBlend: 0, shooting: false, holdDist: 10,
      checkT: 0, duckT: 0, duckRolled: false, los: false, losT: 0, strafeT: 0,
      coverBox: null, peekOut: false, peekX: 0, peekZ: 0, homeX: 0, homeZ: 0, returning: false,
    };
  }

  /** Hard hat in the type's colour, with a front ridge. */
  _addHardHat(head, color, mats) {
    const hatMat = material(color, { roughness: 0.4 });
    mats.push(hatMat);
    const hat = this._mesh(GEO.hat, hatMat);
    hat.position.y = 0.11;
    const brim = this._mesh(GEO.brim, hatMat);
    brim.position.y = 0.11;
    head.add(hat, brim);
  }

  /** A traffic cone worn as a hat: orange cone, white band, wide base. */
  _addCone(head, mats) {
    const coneMat = material(0xff6a00, { roughness: 0.5 });
    const bandMat = material(0xf4f4f4, { roughness: 0.5 });
    mats.push(coneMat, bandMat);
    const cone = this._mesh(GEO.cone, coneMat);
    cone.position.y = 0.3;
    const band = this._mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.07, 8), bandMat);
    band.position.y = 0.3;
    const base = this._mesh(GEO.coneBase, coneMat);
    base.position.y = 0.13;
    head.add(cone, band, base);
  }

  /** A cable reel on the back (model faces +Z, so the back is -Z). */
  _addReel(upper, cableMat, mats) {
    const reelMat = material(0xc8c8c8, { roughness: 0.4, metalness: 0.5 });
    mats.push(reelMat);
    const reel = new THREE.Group();
    for (const z of [-0.04, 0.04]) {
      const flange = this._mesh(GEO.reel, reelMat);
      flange.rotation.x = Math.PI / 2;
      flange.position.z = z;
      reel.add(flange);
    }
    const wound = this._mesh(GEO.reelCore, cableMat);
    wound.rotation.x = Math.PI / 2;
    wound.scale.set(2.2, 0.8, 2.2);
    reel.add(wound);
    reel.position.set(0, 0.32, -0.2);
    upper.add(reel);
  }

  /**
   * A pistol in the right hand. The barrel runs along the forearm (so it points where the raised arm points) and the
   * grip hangs from the hand.
   */
  _addPistol(elbow, mats) {
    const metal = material(0x2a2d32, { roughness: 0.35, metalness: 0.7 });
    const accent = material(0xffb800, { roughness: 0.5 });
    mats.push(metal, accent);
    const slide = this._mesh(GEO.pistolSlide, metal);
    slide.position.set(0, -0.46, 0);
    const grip = this._mesh(GEO.pistolGrip, metal);
    grip.position.set(0, -0.35, -0.045);
    const band = this._mesh(GEO.pistolBand, accent);
    band.position.set(0, -0.4, 0);
    const pistol = new THREE.Group();
    pistol.add(slide, grip, band);
    elbow.add(pistol);
    return pistol;
  }

  /** A pneumatic drill held in the right hand. */
  _addJackhammer(elbow, mats) {
    const bodyMat = material(0xffc400, { roughness: 0.45 });
    const steelMat = material(0x8a9096, { roughness: 0.3, metalness: 0.8 });
    mats.push(bodyMat, steelMat);
    const body = this._mesh(GEO.drill, bodyMat);
    body.position.set(0, -0.4, 0.06);
    const chisel = this._mesh(GEO.chisel, steelMat);
    chisel.rotation.x = Math.PI;
    chisel.position.set(0, -0.72, 0.06);
    elbow.add(body, chisel);
  }

  _acquire(key) {
    const e = this.pool[key].pop() || this._build(key);
    for (const m of e.mats) m.emissive.setRGB(0, 0, 0);
    e.flash = e.flashApplied = 0;
    e.sq = e.sqv = 0;
    e.knock.set(0, 0, 0);
    e.vel.set(0, 0, 0);
    e.windup = 0;
    e.lunge = 0;
    e.attackCd = 0.5;
    e.stun = 0;
    e.blocked = 0;
    e.detour = 0;
    e.bubbleCd = 0;
    e.walk = Math.random() * 6;
    e.orbit = Math.random() < 0.5 ? -1 : 1;
    e.phase = Math.random() * Math.PI * 2;
    e.vy = 0;
    e.grounded = true;
    e.jumpCd = 0;
    e.air = 0;
    e.dodgeT = 0;
    e.dodgeCd = 0.5;
    e.threat = 0;
    e.threatRolled = false;
    e.lean = 0;
    e.state = 'advance';
    e.coverCd = 2 + Math.random() * 3; // do not duck behind cover the instant they spawn
    e.crouch = 0;
    e.rush = 0;
    e.fireCd = 0;
    e.volley = 0;
    e.peekT = 0;
    e.peeks = 0;
    e.aimT = 0;
    e.aimBlend = 0;
    e.shooting = false;
    e.checkT = 0;
    e.duckT = 0;
    e.duckRolled = false;
    e.los = false;
    e.losT = 0;
    e.strafeT = rand(STRAFE_FLIP);
    e.coverBox = null;
    e.peekOut = false;
    e.returning = false;
    return e;
  }

  _release(e) {
    e.root.visible = false;
    this.pool[e.key].push(e);
  }

  /* ------------------------------- spawning ------------------------------ */

  /**
   * Spawn at a random point along the arena edge, rejecting any point closer than
   * `spawnMinDistance` to the player. Returns the bot, or null if capped / no spot.
   * `loadout` (optional): `{ melee: true }` takes the gun away (fists only, same cover / duck / dodge tactics);
   * `{ gun: {...} }` swaps in that gun profile (merged over the type's own) for this bot. A type with no gun has only fists.
   */
  spawnAtEdge(key, speedMul, loadout = {}) {
    if (this.alive.length >= this.cfg.maxAlive) return null;
    const edge = this.arenaHalf - this.cfg.spawnMargin;
    const p = this.player.pos;
    for (let attempt = 0; attempt < 12; attempt++) {
      const along = (Math.random() * 2 - 1) * edge;
      const side = Math.floor(Math.random() * 4);
      const x = side < 2 ? along : (side === 2 ? -edge : edge);
      const z = side < 2 ? (side === 0 ? -edge : edge) : along;
      if (Math.hypot(x - p.x, z - p.z) < this.cfg.spawnMinDistance) continue;
      return this._spawnAt(key, x, z, speedMul, loadout);
    }
    return null;
  }

  _spawnAt(key, x, z, speedMul, loadout = {}) {
    const e = this._acquire(key);
    this._equip(e, loadout);
    e.hp = e.def.hp;
    e.pin = null;
    e.pull = null;
    e.speed = e.def.speed * speedMul;
    e.pos.set(x, this.world.groundHeight(x, z), z);
    e.prevPos.copy(e.pos);
    e.yaw = Math.atan2(this.player.pos.x - x, this.player.pos.z - z);
    e.boot = this.cfg.bootTime;
    e.root.position.copy(e.pos);
    e.root.rotation.y = e.yaw;
    e.root.visible = true;
    this.alive.push(e);
    return e;
  }

  /** Give a freshly acquired bot its gun for this spawn: none (melee), a profile of its own, or the type's gun. */
  _equip(e, { melee = false, gun = null }) {
    e.gun = !e.baseGun || melee ? null : { ...e.baseGun, ...gun };
    if (e.pistol) {
      e.pistol.visible = Boolean(e.gun);
      e.pistol.scale.y = e.gun?.barrelLength ?? 1;
    }
    if (!e.gun) return;
    e.holdDist = rand(e.gun.holdDistance);
    e.volley = randInt(e.gun.burst);
  }

  clear() {
    for (const e of this.alive) this._release(e);
    this.alive.length = 0;
  }

  /* ------------------------------ simulation ----------------------------- */

  update(dt) {
    this.bubbleClock -= dt;

    // Where is the player aiming? Bots whose body sits on that line may dodge.
    this._aimValid = false;
    if (this.aimThreat) {
      this.player.getAim(this._aimO, this._aimD, this._aimR, this._aimU);
      const flat = Math.hypot(this._aimD.x, this._aimD.z);
      if (flat > 0.2) { // straight up/down has no meaningful sideways direction
        this._aimN.set(this._aimD.z / flat, 0, -this._aimD.x / flat);
        this._aimValid = true;
      }
    }

    const target = this.player.pos;
    for (let i = 0; i < this.alive.length; i++) this._step(this.alive[i], dt, target);
  }

  _step(e, dt, target) {
    const cfg = this.cfg;
    e.prevPos.copy(e.pos);
    e.shooting = false; // set again by whatever steers it this tick
    if (e.pin) {
      this._stepPin(e, dt);
      return;
    }
    if (e.pull) {
      this._stepPull(e, dt);
      return;
    }
    e.boot -= dt;
    e.stun -= dt;
    e.attackCd -= dt;
    e.bubbleCd -= dt;
    e.jumpCd -= dt;
    e.dodgeCd -= dt;
    e.dodgeT -= dt;
    e.coverCd -= dt;
    e.rush -= dt;
    e.fireCd -= dt;

    const dxp = target.x - e.pos.x;
    const dzp = target.z - e.pos.z;
    const dist = Math.hypot(dxp, dzp) || 1e-4;
    const toX = dxp / dist;
    const toZ = dzp / dist;

    // Turn to face the player (shortest way round).
    e.yaw += wrapAngle(Math.atan2(toX, toZ) - e.yaw) * Math.min(1, 12 * dt);

    const active = e.boot <= 0 && e.stun <= 0;
    if (!active) e.dodgeT = 0;

    // Dodge: only while advancing on foot, so bots in cover or mid-air stay put.
    if (active && this._aimValid && e.state === 'advance' && e.dodgeT <= 0 && e.dodgeCd <= 0 && e.grounded) {
      this._checkThreat(e, dt);
    } else {
      e.threat = 0;
      e.threatRolled = false;
    }

    if (active && e.gun && e.state === 'peek') this._checkDuck(e, dt);

    this.tvx = 0;
    this.tvz = 0;
    let accel = cfg.accel;

    if (active && e.dodgeT > 0) {
      this.tvx = e.dodgeDir.x * cfg.dodgeSpeed;
      this.tvz = e.dodgeDir.z * cfg.dodgeSpeed;
      accel = 35; // snap into the dash
      e.windup = 0;
    } else if (active && e.windup > 0) {
      // Winding up a strike: stand still, then hit if the player is still close.
      e.windup -= dt;
      if (e.windup <= 0) this._strike(e, dist);
    } else if (active) {
      this._steer(e, dt, toX, toZ, dist);
    }

    // Smoothly chase the target velocity. In the air there is little control: momentum carries a leap.
    const k = 1 - Math.exp(-accel * dt * (e.grounded ? 1 : 0.12));
    e.vel.x += (this.tvx - e.vel.x) * k;
    e.vel.z += (this.tvz - e.vel.z) * k;

    // Knockback is a separate decaying velocity so it stacks with steering.
    e.knock.multiplyScalar(Math.exp(-9 * dt));

    this.world.move(e.pos, (e.vel.x + e.knock.x) * dt, (e.vel.z + e.knock.z) * dt, e.radius, e.pos.y);
    const hitWall = this.world.hitX || this.world.hitZ;
    let hopped = false;
    if (active && hitWall && e.grounded && e.jumpCd <= 0 && e.state !== 'hide') {
      hopped = this._tryHop(e, toX, toZ);
    }
    if (active && hitWall && !hopped) {
      e.blocked += dt;
      if (e.blocked > 0.4) { // stuck for a while: pick a side and walk around
        e.blocked = 0;
        e.detour = 0.9;
        e.detourSign = Math.random() < 0.5 ? -1 : 1;
      }
    } else {
      e.blocked = Math.max(0, e.blocked - dt * 2);
    }

    this._integrateVertical(e, dt);

    const crouchTarget = e.state === 'hide' ? (e.returning ? 0.3 : 1) : e.state === 'cover' ? 0.3 : 0;
    e.crouch += (crouchTarget - e.crouch) * (1 - Math.exp(-9 * dt));
    if (!e.shooting) e.aimT = 0; // the gun has to be raised again before it fires
  }

  /** Decide where to go this tick. Writes this.tvx / this.tvz. */
  _steer(e, dt, toX, toZ, dist) {
    const cfg = this.cfg;
    let sx = toX;
    let sz = toZ;
    let speed = e.speed * (e.rush > 0 ? cfg.rushMul : 1);
    let hold = false;

    if (e.state === 'hide') {
      // Crouched behind cover. Come out after a while, or ambush if the player gets close.
      hold = true;
      e.hideT -= dt;
      if (e.returning) {
        if (!this._walkTo(e, e.homeX, e.homeZ)) e.returning = false; // back at its hiding place
      } else if (e.gun) this._hideWithGun(e, dt, dist);
      else if (e.hideT <= 0 || dist < cfg.ambushRange) this._rushOut(e);
    } else if (e.state === 'peek') {
      // Standing up from behind cover to shoot, then ducking again.
      hold = true;
      if (dist < cfg.ambushRange) this._rushOut(e);
      else if (e.peekOut && this._walkTo(e, e.peekX, e.peekZ)) {
        // still stepping out past the edge of a tall box
      } else {
        e.peekT -= dt;
        const lastShot = this._shootStep(e, dt, false);
        if (lastShot) e.peekT = Math.min(e.peekT, 0.3); // the burst is spent: back down in a moment
        if (e.peekT <= 0) this._endPeek(e);
      }
    } else if (e.state === 'cover') {
      const cx = e.coverX - e.pos.x;
      const cz = e.coverZ - e.pos.z;
      const cd = Math.hypot(cx, cz);
      e.coverT -= dt;
      if (cd < 0.45 || e.coverT <= 0) {
        e.state = 'hide';
        e.hideT = rand(cfg.hideTime) * (e.gun ? GUNNER_HIDE_SHARE : 1);
        e.checkT = HIDE_CHECK;
      } else {
        sx = cx / cd;
        sz = cz / cd;
        speed = e.speed * cfg.coverRunMul;
      }
    }
    if (hold) return;

    const advancing = e.state === 'advance';
    if (advancing && e.gun && this._standAndShoot(e, dt, toX, toZ, dist)) return;
    if (e.detour > 0) { // stuck behind cover: slide sideways for a moment
      e.detour -= dt;
      const px = -sz * e.detourSign; // perpendicular to the intended direction
      const pz = sx * e.detourSign;
      sx = sx * 0.25 + px;
      sz = sz * 0.25 + pz;
    } else if (advancing && dist < 5) { // close in: drift sideways a little so the pack fans out around you
      sx += -toZ * e.orbit * 0.3;
      sz += toX * e.orbit * 0.3;
    }

    // Separation: push away from neighbours so bots surround instead of stacking.
    let sepX = 0;
    let sepZ = 0;
    for (let i = 0; i < this.alive.length; i++) {
      const o = this.alive[i];
      if (o === e) continue;
      const ox = e.pos.x - o.pos.x;
      const oz = e.pos.z - o.pos.z;
      const min = (e.radius + o.radius) * 1.5;
      const d2 = ox * ox + oz * oz;
      if (d2 >= min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const w = (min - d) / min;
      sepX += (ox / d) * w;
      sepZ += (oz / d) * w;
    }

    let dx;
    let dz;
    if (advancing && dist < e.reach * 0.9) { // in contact: only hold position / spread out
      dx = sepX;
      dz = sepZ;
      speed *= 0.6;
    } else {
      dx = sx + sepX * cfg.separationWeight;
      dz = sz + sepZ * cfg.separationWeight;
    }
    const len = Math.hypot(dx, dz);
    if (len > 1) { dx /= len; dz /= len; }
    this.tvx = dx * speed;
    this.tvz = dz * speed;

    if (!advancing) return;

    // Leap at the player from a few metres out (Routers).
    const leap = e.def.ai.leap;
    if (leap > 0 && e.grounded && e.jumpCd <= 0 && dist > 3.5 && dist < 7 && Math.random() < leap * dt) {
      e.vy = cfg.jumpSpeed * 0.9;
      e.grounded = false;
      e.jumpCd = 1.5;
      e.vel.x = toX * e.speed * 1.5;
      e.vel.z = toZ * e.speed * 1.5;
      return;
    }

    if (dist <= e.reach && e.attackCd <= 0 && Math.abs(this.player.pos.y - e.pos.y) < 1.8) {
      e.windup = cfg.attackWindup;
    }
  }

  /* --------------------------- pistols and cover fire ---------------------- */

  /** Leave cover and charge at the player. */
  _rushOut(e) {
    e.state = 'advance';
    e.rush = this.cfg.rushTime;
    e.coverCd = rand(this.cfg.coverCooldown);
  }

  /** The player's eye, in this._eye. */
  _playerEye() {
    const p = this.player.pos;
    return this._eye.set(p.x, p.y + this.player.cfg.eyeHeight, p.z);
  }

  /** Where the pistol's muzzle is, in this._muzzle: out in front of the right hand, at the height of a bot that is `crouch` crouched. */
  _muzzleOrigin(e, crouch, x = e.pos.x, z = e.pos.z) {
    const s = e.def.scale;
    const sin = Math.sin(e.yaw);
    const cos = Math.cos(e.yaw);
    return this._muzzle.set(
      x + (0.2 * cos + 0.5 * sin) * s,
      e.pos.y + (e.gun.muzzleHeight - 0.45 * crouch) * s,
      z + (-0.2 * sin + 0.5 * cos) * s,
    );
  }

  /** The point a bot aims at: the player's chest. */
  _chest(out) {
    const p = this.player.pos;
    return out.set(p.x, p.y + this.player.cfg.eyeHeight * 0.72, p.z);
  }

  /** Is there a clear line from where a bot's muzzle would be (at this crouch, and standing at (x, z)) to the player? */
  _hasLine(e, crouch, x = e.pos.x, z = e.pos.z) {
    const from = this._muzzleOrigin(e, crouch, x, z);
    const to = this._chest(this._hideDir);
    to.sub(from);
    const distance = to.length();
    if (distance < 1e-3) return true;
    to.divideScalar(distance);
    return this.world.raycast(from, to, distance) >= distance - 0.5;
  }

  /** Does cover still hide this bot? A real ray from the player's eye to where its crouched head is. */
  _isHidden(e) {
    const s = e.def.scale;
    const eye = this._playerEye();
    this._hideDir.set(e.pos.x - eye.x, e.pos.y + (HEAD.y - HEAD.drop) * s + 0.12 - eye.y, e.pos.z - eye.z);
    const distance = this._hideDir.length();
    this._hideDir.divideScalar(distance);
    return this.world.raycast(eye, this._hideDir, distance) < distance - 0.3;
  }

  /** Down behind cover with a pistol: check the cover still works, and when it is time, stand up and shoot. */
  _hideWithGun(e, dt, dist) {
    if (dist < this.cfg.ambushRange) { // the player is on top of it: ambush like the others
      this._rushOut(e);
      return;
    }
    e.checkT -= dt;
    if (e.checkT <= 0) {
      e.checkT = HIDE_CHECK;
      if (!this._isHidden(e) && !this._seekCover(e, true)) { // flanked, and no other cover: fight in the open
        this._rushOut(e);
        return;
      }
      if (e.state !== 'hide') return; // it is running to better cover
    }
    if (e.hideT > 0) return;
    e.peekOut = false;
    if (!this._hasLine(e, 0)) { // the box is too tall to shoot over: lean out past its edge, or give up the cover
      if (!this._leanSpot(e)) {
        this._rushOut(e);
        return;
      }
      e.peekOut = true;
      e.homeX = e.pos.x;
      e.homeZ = e.pos.z;
    }
    e.state = 'peek';
    e.peekT = rand(e.gun.peekTime);
    e.volley = randInt(e.gun.burst);
    e.aimT = 0;
    e.fireCd = 0;
    e.duckT = 0;
    e.duckRolled = false;
  }

  /** Walk toward (x, z), writing this.tvx / this.tvz. Returns false once it is there. */
  _walkTo(e, x, z) {
    const dx = x - e.pos.x;
    const dz = z - e.pos.z;
    const distance = Math.hypot(dx, dz);
    if (distance < ARRIVE) return false;
    const speed = e.speed * LEAN_SPEED;
    this.tvx = (dx / distance) * speed;
    this.tvz = (dz / distance) * speed;
    return true;
  }

  /**
   * Where to stand to shoot round the edge of the box a bot is behind: just past either side, wherever it is free and
   * gives a clear line to the player. Writes e.peekX / e.peekZ and returns true, or returns false if neither side does.
   */
  _leanSpot(e) {
    const box = e.coverBox;
    if (!box) return false;
    const p = this.player.pos;
    let nx = (box.minX + box.maxX) / 2 - p.x; // from the player toward the box
    let nz = (box.minZ + box.maxZ) / 2 - p.z;
    const length = Math.hypot(nx, nz) || 1;
    nx /= length;
    nz /= length;
    const halfWidth = Math.abs(nz) * ((box.maxX - box.minX) / 2) + Math.abs(nx) * ((box.maxZ - box.minZ) / 2); // the box's half width across that line
    const lateral = halfWidth + e.radius + LEAN_CLEARANCE;
    const first = Math.random() < 0.5 ? 1 : -1;
    for (const side of [first, -first]) {
      const x = (box.minX + box.maxX) / 2 + nx * ((Math.abs(nx) * (box.maxX - box.minX) / 2) + (Math.abs(nz) * (box.maxZ - box.minZ) / 2) + e.radius + 0.35) - nz * side * lateral;
      const z = (box.minZ + box.maxZ) / 2 + nz * ((Math.abs(nx) * (box.maxX - box.minX) / 2) + (Math.abs(nz) * (box.maxZ - box.minZ) / 2) + e.radius + 0.35) + nx * side * lateral;
      if (this.world.isBlocked(x, z, e.radius, this.world.groundHeight(x, z))) continue;
      if (!this._hasLine(e, 0, x, z)) continue;
      e.peekX = x;
      e.peekZ = z;
      return true;
    }
    return false;
  }

  /** Back down behind the box; after enough peeks, go and find other cover. */
  _endPeek(e) {
    e.state = 'hide';
    e.hideT = rand(this.cfg.hideTime) * GUNNER_HIDE_SHARE;
    e.checkT = HIDE_CHECK;
    e.returning = e.peekOut; // leaning out round a box: step back to where it was hiding
    e.peekOut = false;
    e.peeks -= 1;
    if (e.peeks <= 0 && !this._seekCover(e, true)) e.peeks = randInt(e.gun.peeks); // nowhere else to go: keep at it
  }

  /** Is the player's aim line on this bot long enough to be a threat? If so it may duck. */
  _checkDuck(e, dt) {
    if (!this._aimValid) {
      e.duckT = 0;
      e.duckRolled = false;
      return;
    }
    const c = this.bodyCenter(e, this._tmp);
    const o = this._aimO;
    const d = this._aimD;
    const vx = c.x - o.x;
    const vy = c.y - o.y;
    const vz = c.z - o.z;
    const along = vx * d.x + vy * d.y + vz * d.z;
    const perp2 = vx * vx + vy * vy + vz * vz - along * along;
    const limit = this.cfg.dodgeAimRadius * e.def.scale;
    if (along < 2.5 || along > 60 || perp2 > limit * limit) {
      e.duckT = 0;
      e.duckRolled = false;
      return;
    }
    e.duckT += dt;
    if (e.duckT < this.cfg.dodgeReaction * 0.8 || e.duckRolled) return;
    e.duckRolled = true;
    if (Math.random() < e.gun.duckChance) this._endPeek(e);
  }

  /**
   * A bot with a pistol in range of the player, with a clear line, stops and shoots from where it is (or runs for cover).
   * Returns true when it did, and has set its own movement; false means carry on advancing.
   */
  _standAndShoot(e, dt, toX, toZ, dist) {
    const gun = e.gun;
    if (dist > e.holdDist || dist < gun.minRange || !this.player.alive) return false;
    e.losT -= dt;
    if (e.losT <= 0) {
      e.losT = LINE_CHECK;
      e.los = this._hasLine(e, e.crouch);
    }
    if (!e.los) return false;

    if (e.coverCd <= 0 && Math.random() < gun.coverSeekRate * dt && this._seekCover(e)) return true; // it runs for cover next tick
    e.strafeT -= dt;
    if (e.strafeT <= 0) {
      e.strafeT = rand(STRAFE_FLIP);
      e.orbit = -e.orbit;
    }
    const speed = e.speed * gun.strafeSpeed;
    this.tvx = -toZ * e.orbit * speed;
    this.tvz = toX * e.orbit * speed;
    this._shootStep(e, dt, true);
    return true;
  }

  /**
   * Raise the gun, and once it is up fire the burst, a shot at a time. `refill` starts a new burst after a pause (shooting
   * from the open); otherwise the caller ends the shooting when this returns true (it fired the last round of a burst).
   */
  _shootStep(e, dt, refill) {
    const gun = e.gun;
    e.shooting = true;
    if (e.aimT < gun.aimTime) {
      e.aimT += dt;
      return false;
    }
    if (e.fireCd > 0 || e.volley <= 0 || !this.player.alive) return false;
    this._fire(e);
    e.volley -= 1;
    e.fireCd = gun.interval;
    if (e.volley > 0) return false;
    if (refill) {
      e.volley = randInt(gun.burst);
      e.fireCd = rand(gun.burstPause);
    }
    return true;
  }

  /** One shot: toward the player's chest with a little error, stopped by walls, with a tracer, a spark and a bang. */
  _fire(e) {
    const gun = e.gun;
    const player = this.player;
    const from = this._muzzleOrigin(e, e.crouch);
    const aim = this._chest(this._shotDir).sub(from);
    const toPlayer = aim.length() || 1;
    aim.divideScalar(toPlayer);
    let damage = 0;
    for (let pellet = 0; pellet < gun.pellets; pellet++) damage += this._firePellet(e, from, aim);
    this.audio?.shootAt('pistol', toPlayer);
    if (damage > 0) player.takeDamage(damage, e.pos);
  }

  /** One pellet along `aim` with random error: returns the damage it does to the player (0 on a miss). */
  _firePellet(e, from, aim) {
    const gun = e.gun;
    const player = this.player;
    const dir = this._pelletDir.copy(aim);
    dir.x += (Math.random() * 2 - 1) * gun.spread;
    dir.y += (Math.random() * 2 - 1) * gun.spread;
    dir.z += (Math.random() * 2 - 1) * gun.spread;
    dir.normalize();

    const eye = player.cfg.eyeHeight;
    const wall = Math.min(this.world.raycast(from, dir, gun.range), gun.range);
    const body = rayHit(from, dir, player.pos.x, player.pos.y + eye * 0.55, player.pos.z, Math.max(player.cfg.radius + 0.1, eye * 0.2));
    const head = rayHit(from, dir, player.pos.x, player.pos.y + eye - 0.12 * (eye / 1.65), player.pos.z, 0.13 * (eye / 1.65));
    const hit = [body, head].filter((t) => t >= 0).reduce((nearest, t) => Math.min(nearest, t), Infinity);
    const struck = hit < wall;
    const end = this._shotEnd.copy(from).addScaledVector(dir, struck ? hit : wall);

    this.fx.tracers.spawn(from, end, gun.tracerColor, TRACER_SPEED, 0.03);
    this.fx.particles.burst(from, SHOT_SPARK, 3, 2.5, 0.05, 0.12, 0);
    if (!struck && wall < gun.range) this.fx.particles.burst(end, 0xffc04d, 3, 3, 0.05, 0.18, 8); // chips off whatever it hit
    return struck ? gun.damage : 0;
  }

  /** Jump if what blocks us is low enough to clear (a platform edge or low cover). */
  _tryHop(e, toX, toZ) {
    const cfg = this.cfg;
    let hx = this.tvx;
    let hz = this.tvz;
    const speed = Math.hypot(hx, hz);
    if (speed < 0.01) { hx = toX; hz = toZ; } else { hx /= speed; hz /= speed; }
    const reach = e.radius + 0.35;
    const top = this.world.groundHeight(e.pos.x + hx * reach, e.pos.z + hz * reach);
    if (top <= e.pos.y + 0.3 || top > e.pos.y + cfg.jumpClear) return false; // nothing there, or too tall
    e.vy = cfg.jumpSpeed;
    e.grounded = false;
    e.jumpCd = 0.6;
    e.vel.x = hx * Math.max(speed, e.speed);
    e.vel.z = hz * Math.max(speed, e.speed);
    return true;
  }

  /**
   * Drag a bot toward a point (a grapple). `options`: { toward() -> { x, z } or null, speed, arrive, seconds }.
   * The bot cannot act while it is dragged; it stops when it is close, the time runs out, or the point goes away.
   */
  pullToward(e, { toward, speed, arrive = 1.5, seconds = 3 }) {
    e.pull = { toward, speed, arrive, time: seconds };
    e.windup = 0;
    e.state = 'advance';
    e.dodgeT = 0;
  }

  /** Let go of a dragged or impaled bot. */
  release(e) {
    e.pull = null;
    if (e.pin) this._endPin(e);
  }

  /**
   * Skewer a bot on something that moves (a drill head). `options`: { point() -> { x, y, z } or null, seconds }.
   * The bot hangs from that point (its body centre sits on it) and cannot act until time runs out or `release`.
   */
  pinTo(e, { point, seconds }) {
    e.pin = { point, time: seconds };
    e.pull = null;
    e.windup = 0;
    e.state = 'advance';
    e.dodgeT = 0;
    e.vel.set(0, 0, 0);
  }

  _stepPin(e, dt) {
    const pin = e.pin;
    const point = pin.point();
    pin.time -= dt;
    if (!point || pin.time <= 0) {
      this._endPin(e);
      return;
    }
    const centre = (1.15 - 0.42 * e.crouch) * e.def.scale;
    e.pos.set(point.x, Math.max(point.y - centre, this.world.groundHeight(point.x, point.z)), point.z);
    e.vy = 0;
    e.vel.set(0, 0, 0);
    e.knock.set(0, 0, 0);
  }

  _endPin(e) {
    e.pin = null;
    e.stun = Math.max(e.stun, PULL_END_STUN);
    e.vy = 0;
    e.grounded = false;
  }

  _stepPull(e, dt) {
    const pull = e.pull;
    const point = pull.toward();
    pull.time -= dt;
    const dx = point ? point.x - e.pos.x : 0;
    const dz = point ? point.z - e.pos.z : 0;
    const distance = Math.hypot(dx, dz);
    if (!point || pull.time <= 0 || distance <= pull.arrive) {
      e.pull = null;
      e.stun = Math.max(e.stun, PULL_END_STUN); // dazed for a moment when it arrives
      return;
    }
    e.yaw = Math.atan2(dx, dz);
    e.vel.set((dx / distance) * pull.speed, 0, (dz / distance) * pull.speed);
    e.knock.set(0, 0, 0);
    this.world.move(e.pos, e.vel.x * dt, e.vel.z * dt, e.radius, e.pos.y);
    this._integrateVertical(e, dt);
  }

  _integrateVertical(e, dt) {
    const wasGrounded = e.grounded;
    e.vy -= this.cfg.gravity * dt;
    e.pos.y += e.vy * dt;
    const ground = this.world.groundHeight(e.pos.x, e.pos.z);
    if (e.vy <= 0 && e.pos.y <= ground + 1e-4) {
      e.pos.y = ground;
      e.vy = 0;
      e.grounded = true;
    } else if (wasGrounded && e.vy <= 0 && e.pos.y - ground <= 0.2) {
      e.pos.y = ground; // stay glued going down ramps
      e.vy = 0;
    } else {
      e.grounded = false;
    }
  }

  /* ----------------------------- dodging ---------------------------------- */

  /** Is the player's aim line passing through this bot? If so for long enough, maybe dodge. */
  _checkThreat(e, dt) {
    const s = e.def.scale;
    const c = this.bodyCenter(e, this._tmp);
    const o = this._aimO;
    const d = this._aimD;
    const vx = c.x - o.x;
    const vy = c.y - o.y;
    const vz = c.z - o.z;
    const along = vx * d.x + vy * d.y + vz * d.z;
    const perp2 = vx * vx + vy * vy + vz * vz - along * along;
    const limit = this.cfg.dodgeAimRadius * s;
    if (along < 2.5 || along > 45 || perp2 > limit * limit) {
      e.threat = 0;
      e.threatRolled = false; // aim left the bot: the next time it lands, roll again
      return;
    }
    e.threat += dt;
    if (e.threat < this.cfg.dodgeReaction || e.threatRolled) return;
    e.threatRolled = true; // one roll per "being targeted" episode
    if (Math.random() < e.def.ai.dodge) this._dodge(e, vx * this._aimN.x + vz * this._aimN.z);
  }

  _dodge(e, sideAmount) {
    const ai = e.def.ai;
    const side = Math.abs(sideAmount) < 0.05 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(sideAmount);
    // Dash away from the aim line, whichever side of it the bot is already on.
    e.dodgeDir.set(this._aimN.x * side, 0, this._aimN.z * side);
    e.dodgeSign = side;
    e.dodgeT = this.cfg.dodgeTime;
    e.dodgeCd = ai.dodgeCooldown * (0.8 + Math.random() * 0.4);
    if (e.grounded && Math.random() < ai.hop) { // sometimes a hop on top of the sidestep
      e.vy = this.cfg.jumpSpeed * 0.85;
      e.grounded = false;
    }
  }

  /* ------------------------------ cover ------------------------------------ */

  /**
   * Find the nearest tall box whose far side hides us from the player, and head
   * there. "Hides" is checked with a real raycast from the player's eye to where
   * our crouched head would be, so low boxes that cannot hide a bot are skipped.
   * Returns true if a spot was found. With `other`, the box it is already behind does not count.
   */
  _seekCover(e, other = false) {
    const p = this.player.pos;
    const s = e.def.scale;
    this._eye.set(p.x, p.y + this.player.cfg.eyeHeight, p.z);
    const half = this.arenaHalf - 1;
    let bestX = 0;
    let bestZ = 0;
    let bestDist = this.cfg.coverRadius;
    let bestSolid = null;
    let found = false;

    for (const solid of this.world.solids) {
      const width = solid.maxX - solid.minX;
      const depth = solid.maxZ - solid.minZ;
      if (solid.ramp || width > 20 || depth > 20) continue; // skip ramps and the arena walls
      const cx = (solid.minX + solid.maxX) / 2;
      const cz = (solid.minZ + solid.maxZ) / 2;
      let nx = cx - p.x;
      let nz = cz - p.z;
      const len = Math.hypot(nx, nz) || 1;
      nx /= len;
      nz /= len;
      // Stand just past the far face, directly behind the box as seen from the player.
      const extent = Math.abs(nx) * (width / 2) + Math.abs(nz) * (depth / 2);
      const hx = Math.max(-half, Math.min(half, cx + nx * (extent + e.radius + 0.35)));
      const hz = Math.max(-half, Math.min(half, cz + nz * (extent + e.radius + 0.35)));
      const dist = Math.hypot(hx - e.pos.x, hz - e.pos.z);
      if (dist >= bestDist) continue;
      if (other && dist < RELOCATE_DISTANCE) continue; // moving on: not the box it is already behind
      const floor = this.world.groundHeight(hx, hz);
      if (this.world.isBlocked(hx, hz, e.radius, floor)) continue; // spot is inside something

      this._hideDir.set(hx - this._eye.x, floor + 1.25 * s - this._eye.y, hz - this._eye.z);
      const hideDist = this._hideDir.length();
      this._hideDir.divideScalar(hideDist);
      if (this.world.raycast(this._eye, this._hideDir, hideDist) > hideDist - 0.3) continue; // still visible
      bestDist = dist;
      bestX = hx;
      bestZ = hz;
      bestSolid = solid;
      found = true;
    }
    if (!found) return false;
    e.state = 'cover';
    e.coverX = bestX;
    e.coverZ = bestZ;
    e.coverT = this.cfg.coverTimeout;
    e.windup = 0;
    e.coverBox = bestSolid;
    e.returning = false;
    e.peekOut = false;
    if (e.gun) e.peeks = randInt(e.gun.peeks);
    return true;
  }

  _strike(e, dist) {
    e.attackCd = this.cfg.attackCooldown;
    e.lunge = 1;
    if (dist <= e.reach + 0.6 && Math.abs(this.player.pos.y - e.pos.y) < 1.8) {
      this.player.takeDamage(e.def.damage, e.pos);
    }
  }

  /* ------------------------------ damage --------------------------------- */

  /**
   * Apply damage. opts: { dirX, dirZ, knock, stun, rollScale }. rollScale (default 1) scales the
   * per-hit chances of ducking for cover / speaking, so a beam that damages 10x a second does
   * not make every bot bolt instantly. Returns true if the bot died.
   * Numbers, hitmarkers and sounds are the caller's job (weapons.js).
   */
  damage(e, amount, opts) {
    if (e.hp <= 0) return false;
    const roll = opts.rollScale ?? 1;
    e.hp -= amount;
    e.flash = this.cfg.hitFlashTime;
    e.sq = 0.9; // squash; the spring in animate() overshoots into a stretch
    e.sqv = 0;
    e.stun = Math.max(e.stun, opts.stun * e.def.stunMul);
    const push = Math.min(14, opts.knock / e.def.mass);
    e.knock.x += opts.dirX * push;
    e.knock.z += opts.dirZ * push;
    if (e.windup > 0 && opts.stun > 0.2) e.windup = 0; // a heavy hit cancels their attack
    if (e.state === 'peek' && e.hp > 0) this._endPeek(e); // hit while standing up to shoot: back down

    if (e.hp <= 0) {
      this._kill(e);
      return true;
    }
    // Hurt bots may run for cover; the more hurt, the likelier.
    if (e.state === 'advance' && e.coverCd <= 0) {
      const chance = e.def.ai.cover * (1.4 - e.hp / e.def.hp) * roll;
      if (Math.random() < chance) this._seekCover(e);
    }
    if (e.bubbleCd <= 0 && Math.random() < 0.35 * roll) this._say(e, HIT_LINES);
    return false;
  }

  _say(e, lines) {
    if (this.bubbleClock > 0) return; // global throttle so a crowd does not fill the screen with bubbles
    this.bubbleClock = 0.12;
    e.bubbleCd = 0.9;
    const s = e.def.scale;
    this.fx.bubbles.spawn(
      lines[Math.floor(Math.random() * lines.length)],
      e.pos.x, e.pos.y + (2.05 - 0.5 * e.crouch) * s, e.pos.z, 0.75 + s * 0.3,
    );
  }

  _kill(e) {
    const idx = this.alive.indexOf(e);
    if (idx >= 0) {
      this.alive[idx] = this.alive[this.alive.length - 1];
      this.alive.pop();
    }
    const centre = this._tmp.set(e.pos.x, e.pos.y + 1.1 * e.def.scale, e.pos.z);
    this.fx.particles.debris(centre, [e.def.color, e.def.head, GOLD, CABLE_BLACK, 0x5dff8f, PANTS], 9, e.def.scale);
    this.fx.particles.burst(centre, 0xffc04d, 8, 5, 0.06, 0.4, 12); // sparks from the busted circuitry
    this.fx.particles.smoke(centre, 4, e.def.scale);
    this.bubbleClock = 0;
    this._say(e, KILL_LINES);
    this._release(e);
    if (this.onKill) this.onKill(e);
  }

  /* ------------------------------- queries ------------------------------- */

  bodyCenter(e, out) {
    return out.set(e.pos.x, e.pos.y + (1.15 - 0.42 * e.crouch) * e.def.scale, e.pos.z);
  }

  /**
   * Nearest bot along a ray against three spheres per bot: head, torso, legs.
   * Crouching lowers them, which is what makes cover work. Reaching the head first
   * is a crit. `radius` fattens every volume (shotgun pellets are not infinitely thin).
   * Fills and returns this.hit, or returns null.
   */
  raycast(origin, dir, maxT, radius = 0, boost = 0, skip = null) {
    let bestT = maxT;
    let best = null;
    let bestCrit = false;
    for (let i = 0; i < this.alive.length; i++) {
      const e = this.alive[i];
      if (skip && skip.has(e)) continue;
      const s = e.def.scale;
      const c = e.crouch;
      const px = e.pos.x;
      const py = e.pos.y;
      const pz = e.pos.z;
      const th = raySphere(origin, dir, px, py + (HEAD.y - HEAD.drop * c) * s, pz, HEAD.r * s + radius, boost);
      const tt = raySphere(origin, dir, px, py + (TORSO.y - TORSO.drop * c) * s, pz, TORSO.r * s + radius, boost);
      const tl = raySphere(origin, dir, px, py + (LEGS.y - LEGS.drop * c) * s, pz, LEGS.r * s + radius, boost);
      let tb = -1;
      if (tt >= 0) tb = tt;
      if (tl >= 0 && (tb < 0 || tl < tb)) tb = tl;
      if (tb < 0 && th < 0) continue;
      const crit = th >= 0 && (tb < 0 || th <= tb + 0.15);
      const t = crit ? th : tb;
      if (t < bestT) {
        bestT = t;
        best = e;
        bestCrit = crit;
      }
    }
    if (!best) return null;
    this.hit.enemy = best;
    this.hit.t = bestT;
    this.hit.crit = bestCrit;
    return this.hit;
  }

  /** Forgiving melee pick: nearest bot within `range` and a cone around `forward`. */
  meleeTarget(origin, forward, range, minCos) {
    let best = null;
    let bestScore = Infinity;
    const c = this._tmp;
    for (let i = 0; i < this.alive.length; i++) {
      const e = this.alive[i];
      this.bodyCenter(e, c);
      const tx = c.x - origin.x;
      const ty = c.y - origin.y;
      const tz = c.z - origin.z;
      const d = Math.hypot(tx, ty, tz);
      const radius = 0.4 * e.def.scale;
      if (d - radius > range) continue;
      const cos = (tx * forward.x + ty * forward.y + tz * forward.z) / (d || 1);
      if (cos < minCos && d > radius + 0.3) continue;
      const score = d * (2 - cos);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  /* ------------------------------ rendering ------------------------------ */

  /** Per-frame visuals: interpolated position, walk / crouch / jump poses, arms, squash, flash, wheel. */
  animate(alpha, time, dt) {
    for (let i = 0; i < this.alive.length; i++) {
      const e = this.alive[i];
      const s = e.def.scale;

      e.root.position.lerpVectors(e.prevPos, e.pos, alpha);
      e.root.rotation.y = e.yaw;

      // Squash & stretch spring (a hit sets sq=0.9 => flattened, then it rebounds).
      e.sqv += (-170 * e.sq - 11 * e.sqv) * dt;
      e.sq += e.sqv * dt;
      e.visual.scale.set(s * (1 + e.sq * 0.18), s * (1 - e.sq * 0.25), s * (1 + e.sq * 0.18));

      // Pose weights: crouch (behind cover) and air (jumping) override the walk cycle.
      const crouch = e.crouch;
      e.air += ((e.grounded ? 0 : 1) - e.air) * (1 - Math.exp(-14 * dt));
      const walkWeight = (1 - crouch) * (1 - e.air);

      // Walk cycle driven by distance travelled, so feet match the ground speed.
      const speed = Math.hypot(e.vel.x, e.vel.z);
      const amp = clamp(speed / 3.5, 0, 1);
      e.walk += speed * dt * 2.4;
      const sw = Math.sin(e.walk);
      for (const leg of e.legs) {
        const phase = sw * leg.side;
        // Crouch: thighs forward 63 deg, knees folded 115 deg (feet stay planted, hips drop ~0.39 m).
        // Jump: legs tucked up.
        leg.thigh.rotation.x = phase * 0.8 * amp * walkWeight - 1.1 * crouch - 0.7 * e.air * (1 - crouch);
        leg.knee.rotation.x = Math.max(0, phase) * 1.1 * amp * walkWeight + 2.0 * crouch + 1.2 * e.air * (1 - crouch);
      }
      e.hips.position.y = HIPS_Y + Math.abs(Math.cos(e.walk)) * 0.04 * amp * walkWeight - CROUCH_DROP * crouch;
      e.upper.rotation.x = 0.12 * amp * walkWeight + 0.35 * crouch;
      e.upper.rotation.z = sw * 0.04 * amp * walkWeight;
      e.head.rotation.y = Math.sin(time * 1.3 + e.phase) * 0.12 * (1 - amp * 0.5);

      // Sidestep lean while dodging.
      e.lean += ((e.dodgeT > 0 ? -e.dodgeSign * 0.35 : 0) - e.lean) * (1 - Math.exp(-16 * dt));
      e.visual.rotation.z = e.lean;

      // Attack: arms rear back during windup, then snap forward.
      const windupP = e.windup > 0 ? 1 - e.windup / this.cfg.attackWindup : 0;
      e.lunge *= Math.exp(-7 * dt);
      const raise = -(windupP * 1.2 + e.lunge * 1.6) - 0.9 * e.air - 0.5 * crouch;
      e.visual.position.z = (e.lunge * 0.35 - windupP * 0.1) * s;

      // Pistol: the gun arm comes up level, the other hand helps a little.
      e.aimBlend += ((e.shooting ? 1 : 0) - e.aimBlend) * (1 - Math.exp(-10 * dt));
      const aim = e.gun ? e.aimBlend : 0;

      const t = time + e.phase;
      for (const arm of e.arms) {
        const aimRaise = aim * (arm.side === 1 ? 1.45 : 0.5);
        const swing = -sw * arm.side * 0.7 * amp * walkWeight * (1 - aim);
        arm.shoulder.rotation.x = swing + raise - aimRaise;
        arm.shoulder.rotation.z = arm.side * (0.1 + Math.sin(t * 3 + arm.side) * 0.05) * (1 - aim * 0.7); // loose cable sway
        arm.elbow.rotation.x = -0.3 * amp - 0.9 * crouch * (1 - aim) + Math.sin(t * 5 + arm.side * 2) * 0.1 * (1 - aim) + raise * 0.4 - 0.15 * aimRaise;
      }

      // Hit flash: white emissive, only touched while it changes.
      e.flash = Math.max(0, e.flash - dt);
      const flash = e.flash > 0 ? 1 : 0;
      if (flash !== e.flashApplied) {
        for (const m of e.mats) m.emissive.setRGB(flash, flash, flash);
        e.flashApplied = flash;
      }

      const spinning = e.boot > 0 || e.stun > 0;
      e.wheel.visible = spinning;
      if (spinning) e.wheel.rotation.z -= dt * 9;
    }
  }
}
