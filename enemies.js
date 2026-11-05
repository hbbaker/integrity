import * as THREE from 'three';
import { material } from './effects.js';

/*
 * CABLE BOTS
 * Human-proportioned (about 1.7 m) cable-company technician robots: a cable-box
 * head with a glowing "12:00" clock face and antenna ears, work vest over a long-
 * sleeved shirt, gloves, work pants and boots, with a coax coil on the belt.
 * Original design: no real logos or trademarks.
 *
 * BEHAVIOUR (all tunable in CONFIG.enemies)
 *  - advance: seek the player, separate from neighbours, melee on contact.
 *  - jump: hop onto platforms / low cover that block the way, and (Routers) leap
 *    at the player from a few metres out.
 *  - cover: when hurt, run to the far side of a tall box (one that actually blocks
 *    line of sight to the player), crouch there, then rush out.
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

const HIPS_Y = 0.875;
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
const HEAD = { y: 1.54, r: 0.19, drop: 0.55 }; // crit zone
const TORSO = { y: 1.2, r: 0.3, drop: 0.42 };
const LEGS = { y: 0.5, r: 0.28, drop: 0.2 };

/** Capsule hanging DOWN from its pivot (top at y=0), cached by dimensions. Rounded ends hide joint gaps. */
const limbCache = new Map();
function limbGeometry(length, radius) {
  const key = `${length}|${radius}`;
  if (!limbCache.has(key)) {
    const geometry = new THREE.CapsuleGeometry(radius, length, 4, 10);
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
  stick: new THREE.CylinderGeometry(0.008, 0.008, 0.22, 5),
  boot: new THREE.BoxGeometry(0.1, 0.09, 0.26),
  glove: new THREE.BoxGeometry(0.07, 0.1, 0.045),
  coil: new THREE.TorusGeometry(0.06, 0.016, 6, 12),
  hat: new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  brim: new THREE.CylinderGeometry(0.2, 0.2, 0.025, 12),
  wheel: new THREE.RingGeometry(0.12, 0.22, 16, 1, 0, 4.6),
  blob: new THREE.CircleGeometry(0.5, 14),
};
GEO.blob.rotateX(-Math.PI / 2);

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

function raySphere(o, d, cx, cy, cz, r) {
  const lx = cx - o.x;
  const ly = cy - o.y;
  const lz = cz - o.z;
  const tca = lx * d.x + ly * d.y + lz * d.z;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
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

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const rand = (range) => range[0] + Math.random() * (range[1] - range[0]);

export class Enemies {
  constructor({ cfg, scene, world, fx, player }) {
    this.cfg = cfg.enemies;
    this.arenaHalf = cfg.arena.half;
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.player = player;

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
    const vestMat = material(def.color, { roughness: 0.7 });
    const headMat = material(def.head, { roughness: 0.4, metalness: 0.2 });
    const shirtMat = material(SHIRT, { roughness: 0.85 });
    const pantsMat = material(PANTS, { roughness: 0.85 });
    const bootMat = material(BOOT, { roughness: 0.6 });
    const gloveMat = material(GLOVE, { roughness: 0.8 });
    const cableMat = material(CABLE_BLACK, { roughness: 0.45, metalness: 0.1 });
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
    if (def.stripes) { // hi-vis reflective bands
      const stripeMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.3, metalness: 0.6 });
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
    if (def.hat) { // Technician hard hat
      const hatMat = material(0xe8b800, { roughness: 0.4 });
      mats.push(hatMat);
      const hat = this._mesh(GEO.hat, hatMat);
      hat.position.y = 0.11;
      const brim = this._mesh(GEO.brim, hatMat);
      brim.position.y = 0.11;
      head.add(hat, brim);
    }

    // Arms: shirt sleeve to the elbow, then a coax-cable forearm, gloved hand.
    const arms = [];
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
      key, def, root, visual, hips, upper, head, legs, arms, wheel, mats,
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
    };
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
   */
  spawnAtEdge(key, speedMul) {
    if (this.alive.length >= this.cfg.maxAlive) return null;
    const edge = this.arenaHalf - this.cfg.spawnMargin;
    const p = this.player.pos;
    for (let attempt = 0; attempt < 12; attempt++) {
      const along = (Math.random() * 2 - 1) * edge;
      const side = Math.floor(Math.random() * 4);
      const x = side < 2 ? along : (side === 2 ? -edge : edge);
      const z = side < 2 ? (side === 0 ? -edge : edge) : along;
      if (Math.hypot(x - p.x, z - p.z) < this.cfg.spawnMinDistance) continue;
      return this._spawnAt(key, x, z, speedMul);
    }
    return null;
  }

  _spawnAt(key, x, z, speedMul) {
    const e = this._acquire(key);
    e.hp = e.def.hp;
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
    e.boot -= dt;
    e.stun -= dt;
    e.attackCd -= dt;
    e.bubbleCd -= dt;
    e.jumpCd -= dt;
    e.dodgeCd -= dt;
    e.dodgeT -= dt;
    e.coverCd -= dt;
    e.rush -= dt;

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

    const crouchTarget = e.state === 'hide' ? 1 : e.state === 'cover' ? 0.3 : 0;
    e.crouch += (crouchTarget - e.crouch) * (1 - Math.exp(-9 * dt));
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
      if (e.hideT <= 0 || dist < cfg.ambushRange) {
        e.state = 'advance';
        e.rush = cfg.rushTime;
        e.coverCd = rand(cfg.coverCooldown);
      }
    } else if (e.state === 'cover') {
      const cx = e.coverX - e.pos.x;
      const cz = e.coverZ - e.pos.z;
      const cd = Math.hypot(cx, cz);
      e.coverT -= dt;
      if (cd < 0.45 || e.coverT <= 0) {
        e.state = 'hide';
        e.hideT = rand(cfg.hideTime);
      } else {
        sx = cx / cd;
        sz = cz / cd;
        speed = e.speed * cfg.coverRunMul;
      }
    }
    if (hold) return;

    const advancing = e.state === 'advance';
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
   * Returns true if a spot was found.
   */
  _seekCover(e) {
    const p = this.player.pos;
    const s = e.def.scale;
    this._eye.set(p.x, p.y + this.player.cfg.eyeHeight, p.z);
    const half = this.arenaHalf - 1;
    let bestX = 0;
    let bestZ = 0;
    let bestDist = this.cfg.coverRadius;
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
      const floor = this.world.groundHeight(hx, hz);
      if (this.world.isBlocked(hx, hz, e.radius, floor)) continue; // spot is inside something

      this._hideDir.set(hx - this._eye.x, floor + 1.25 * s - this._eye.y, hz - this._eye.z);
      const hideDist = this._hideDir.length();
      this._hideDir.divideScalar(hideDist);
      if (this.world.raycast(this._eye, this._hideDir, hideDist) > hideDist - 0.3) continue; // still visible
      bestDist = dist;
      bestX = hx;
      bestZ = hz;
      found = true;
    }
    if (!found) return false;
    e.state = 'cover';
    e.coverX = bestX;
    e.coverZ = bestZ;
    e.coverT = this.cfg.coverTimeout;
    e.windup = 0;
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
   * Apply damage. opts: { dirX, dirZ, knock, stun }. Returns true if the bot died.
   * Numbers, hitmarkers and sounds are the caller's job (weapons.js).
   */
  damage(e, amount, opts) {
    if (e.hp <= 0) return false;
    e.hp -= amount;
    e.flash = this.cfg.hitFlashTime;
    e.sq = 0.9; // squash; the spring in animate() overshoots into a stretch
    e.sqv = 0;
    e.stun = Math.max(e.stun, opts.stun * e.def.stunMul);
    const push = Math.min(14, opts.knock / e.def.mass);
    e.knock.x += opts.dirX * push;
    e.knock.z += opts.dirZ * push;
    if (e.windup > 0 && opts.stun > 0.2) e.windup = 0; // a heavy hit cancels their attack

    if (e.hp <= 0) {
      this._kill(e);
      return true;
    }
    // Hurt bots may run for cover; the more hurt, the likelier.
    if (e.state === 'advance' && e.coverCd <= 0) {
      const chance = e.def.ai.cover * (1.4 - e.hp / e.def.hp);
      if (Math.random() < chance) this._seekCover(e);
    }
    if (e.bubbleCd <= 0 && Math.random() < 0.35) this._say(e, HIT_LINES);
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
  raycast(origin, dir, maxT, radius = 0) {
    let bestT = maxT;
    let best = null;
    let bestCrit = false;
    for (let i = 0; i < this.alive.length; i++) {
      const e = this.alive[i];
      const s = e.def.scale;
      const c = e.crouch;
      const px = e.pos.x;
      const py = e.pos.y;
      const pz = e.pos.z;
      const th = raySphere(origin, dir, px, py + (HEAD.y - HEAD.drop * c) * s, pz, HEAD.r * s + radius);
      const tt = raySphere(origin, dir, px, py + (TORSO.y - TORSO.drop * c) * s, pz, TORSO.r * s + radius);
      const tl = raySphere(origin, dir, px, py + (LEGS.y - LEGS.drop * c) * s, pz, LEGS.r * s + radius);
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

      const t = time + e.phase;
      for (const arm of e.arms) {
        const swing = -sw * arm.side * 0.7 * amp * walkWeight;
        arm.shoulder.rotation.x = swing + raise;
        arm.shoulder.rotation.z = arm.side * (0.1 + Math.sin(t * 3 + arm.side) * 0.05); // loose cable sway
        arm.elbow.rotation.x = -0.3 * amp - 0.9 * crouch + Math.sin(t * 5 + arm.side * 2) * 0.1 + raise * 0.4;
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
