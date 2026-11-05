import * as THREE from 'three';
import { MuzzleFlash, material, makeGlowTexture } from './effects.js';
import { buildRaygun, glowColor } from './raygun.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
const easeInOut = (t) => t * t * (3 - 2 * t);
const MAX_HITS = 32; // one entry per projectile that connects (a buckshot blast can hit up to 8 per target)
const SLOT_PISTOL = 1;

/*
 * VIEWMODEL SETUP
 * Weapons live in their own scene (`vmScene`) drawn by their own camera
 * (`vmCamera`) AFTER the world, with the depth buffer cleared in between. That is
 * why a gun never clips into a wall: it is never depth-tested against the world.
 * The viewmodel camera sits at the origin looking down -Z, so every position below
 * is "metres in front of / beside your eye". All animation (bob, recoil, reload,
 * switching, sway, melee swing) is summed into one offset applied to `anchor`.
 */

// Shared materials (never modified per instance, so one set serves every model).
const MAT = {
  metal: material(0x2b2e33, { metalness: 0.85, roughness: 0.38 }),
  steel: material(0x6b7077, { metalness: 0.9, roughness: 0.3 }),
  polymer: material(0x1b1c1e, { roughness: 0.6 }),
  wood: material(0x6b4423, { roughness: 0.65 }),
  brass: material(0xb08a2e, { metalness: 0.9, roughness: 0.3 }),
  accent: material(0x7a3cff, { roughness: 0.5 }), // faint cable-company purple trim
  glove: material(0x16171a, { roughness: 0.8 }),
  sleeve: material(0x4a5236, { roughness: 0.95 }), // olive field jacket
};

function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

function barrelPart(radius, length, mat) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), mat);
  mesh.rotation.x = Math.PI / 2; // lay the cylinder along -Z
  return mesh;
}

function at(object, x, y, z) {
  object.position.set(x, y, z);
  return object;
}

/** Jacket sleeve from the wrist (origin) along `dir` (gun space), wide end away from the hand. */
function makeSleeve(dir) {
  const length = 0.8;
  const direction = new THREE.Vector3(...dir).normalize();
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.046, length, 10), MAT.sleeve);
  // The cylinder's +Y axis is its wide (elbow) end; point it along `direction`.
  sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  sleeve.position.copy(direction).multiplyScalar(length / 2);
  return sleeve;
}

/**
 * First-person arm: a gloved hand (palm, curled fingers, thumb) plus a jacket
 * sleeve that runs from the wrist back toward the camera and out of the frame.
 *
 * The group's origin is the wrist. `palmRoll` rotates the hand about Z so the palm
 * can face a vertical grip (+/- 90 degrees) or wrap under a horizontal barrel
 * (180 degrees). `sleeveDir` is the sleeve's direction in the gun's space; it is
 * a separate child so it is NOT rotated with the hand.
 */
let BUILD_ARMS = true; // false while building the third-person copies (the wizard has its own arms)

function makeArm(side, palmRoll, sleeveDir) {
  const arm = new THREE.Group();
  if (!BUILD_ARMS) return arm;
  const hand = new THREE.Group();
  hand.add(box(0.08, 0.045, 0.095, MAT.glove));
  const fingers = at(box(0.08, 0.04, 0.055, MAT.glove), 0, -0.027, -0.07);
  fingers.rotation.x = 0.7; // curled around whatever is being held
  const thumb = at(box(0.024, 0.028, 0.06, MAT.glove), -side * 0.05, 0.005, -0.03);
  thumb.rotation.y = side * 0.4;
  hand.add(fingers, thumb);
  hand.rotation.z = palmRoll;
  arm.add(hand);

  arm.add(makeSleeve(sleeveDir));
  return arm;
}

/* Each builder returns { root, muzzle, home, parts }. Barrels point down -Z. */

function buildPistol() {
  const root = new THREE.Group();
  const grip = at(box(0.055, 0.15, 0.07, MAT.polymer), 0, -0.085, 0.045);
  grip.rotation.x = 0.2;
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.25, -0.5, 1]), 0.052, -0.09, 0.05);
  const leftArm = at(makeArm(-1, Math.PI / 2, [-0.25, -0.5, 1]), -0.052, -0.11, 0.04);
  root.add(
    at(box(0.062, 0.07, 0.3, MAT.metal), 0, 0.04, -0.1), // slide
    at(box(0.058, 0.045, 0.26, MAT.polymer), 0, -0.002, -0.08), // frame
    grip,
    at(box(0.01, 0.02, 0.01, MAT.steel), 0, 0.083, -0.24), // front sight
    at(box(0.032, 0.02, 0.012, MAT.steel), 0, 0.083, 0.05), // rear sight (tops of both sights line up for ADS)
    at(barrelPart(0.014, 0.05, MAT.steel), 0, 0.04, -0.26),
    rightArm,
    leftArm,
  );
  const muzzle = at(new THREE.Object3D(), 0, 0.04, -0.29);
  root.add(muzzle);
  return { root, muzzle, home: { x: 0.2, y: -0.2, z: -0.42 }, parts: { support: { object: leftArm, baseY: leftArm.position.y } } };
}

function buildShotgun() {
  const root = new THREE.Group();
  const pump = at(box(0.075, 0.06, 0.2, MAT.wood), 0, -0.045, -0.25);
  const leftArm = at(makeArm(-1, Math.PI, [-0.3, -0.35, 1]), 0, -0.055, 0); // palm up, wrapped under the pump
  pump.add(leftArm);
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.3, -0.45, 1]), 0.05, -0.09, 0.22);
  root.add(
    at(barrelPart(0.022, 0.75, MAT.metal), 0, 0.02, -0.3),
    at(barrelPart(0.018, 0.5, MAT.steel), 0, -0.025, -0.18), // magazine tube
    at(box(0.075, 0.095, 0.3, MAT.metal), 0, 0, 0.1), // receiver
    pump,
    at(box(0.055, 0.12, 0.06, MAT.wood), 0, -0.085, 0.21), // pistol grip
    at(box(0.06, 0.11, 0.3, MAT.wood), 0, -0.03, 0.4), // stock
    at(box(0.062, 0.01, 0.1, MAT.accent), 0, 0.054, 0.1), // trim stripe
    at(box(0.01, 0.015, 0.01, MAT.brass), 0, 0.045, -0.66), // bead sight
    rightArm,
  );
  const muzzle = at(new THREE.Object3D(), 0, 0.02, -0.68);
  root.add(muzzle);
  return {
    root, muzzle, home: { x: 0.2, y: -0.2, z: -0.4 },
    parts: { pump, pumpBaseZ: pump.position.z, support: { object: leftArm, baseY: leftArm.position.y } },
  };
}

function buildSmg() {
  const root = new THREE.Group();
  const mag = at(box(0.045, 0.19, 0.065, MAT.polymer), 0, -0.14, -0.05);
  const grip = at(box(0.055, 0.13, 0.065, MAT.polymer), 0, -0.1, 0.13);
  grip.rotation.x = 0.15;
  const rightArm = at(makeArm(1, -Math.PI / 2, [0.3, -0.45, 1]), 0.052, -0.1, 0.13);
  const leftArm = at(makeArm(-1, Math.PI, [-0.3, -0.35, 1]), 0, -0.07, -0.19); // under the handguard
  root.add(
    at(box(0.07, 0.1, 0.4, MAT.metal), 0, 0, 0), // receiver
    at(box(0.074, 0.06, 0.2, MAT.polymer), 0, -0.01, -0.22), // handguard
    at(barrelPart(0.015, 0.2, MAT.steel), 0, 0.01, -0.4),
    mag,
    grip,
    at(box(0.045, 0.06, 0.2, MAT.polymer), 0, 0, 0.3), // stock
    at(box(0.03, 0.03, 0.08, MAT.steel), 0, 0.065, -0.05), // rear sight
    at(box(0.01, 0.055, 0.01, MAT.steel), 0, 0.0525, -0.5), // front post
    at(box(0.072, 0.012, 0.15, MAT.accent), 0, 0.052, -0.2),
    rightArm,
    leftArm,
  );
  const muzzle = at(new THREE.Object3D(), 0, 0.01, -0.5);
  root.add(muzzle);
  return {
    root, muzzle, home: { x: 0.2, y: -0.2, z: -0.4 },
    parts: { mag, magBaseY: mag.position.y, support: { object: leftArm, baseY: leftArm.position.y } },
  };
}

function buildFists() {
  const root = new THREE.Group();
  const hands = [];
  for (const side of [-1, 1]) {
    const hand = new THREE.Group();
    hand.add(
      box(0.085, 0.085, 0.11, MAT.glove), // fist
      at(box(0.09, 0.02, 0.03, MAT.steel), 0, 0.035, -0.06), // knuckle guard plate
      at(box(0.03, 0.04, 0.06, MAT.glove), -side * 0.05, 0.0, -0.01),
    );
    hand.add(makeSleeve([side * 0.2, -0.3, 1]));
    hand.position.set(side * 0.2, -0.22, -0.38);
    hand.userData.base = hand.position.clone();
    hand.userData.side = side;
    root.add(hand);
    hands.push(hand);
  }
  return { root, muzzle: null, home: { x: 0, y: 0, z: 0 }, parts: { hands } };
}

const MODEL_BUILDERS = {
  fists: buildFists, pistol: buildPistol, shotgun: buildShotgun, smg: buildSmg,
  raygun: () => buildRaygun(makeArm),
};

/** A gun model with no first-person hands or sleeves, for the third-person wizard to hold. Null for fists. */
export function buildHeldModel(id) {
  if (id === 'fists') return null;
  BUILD_ARMS = false;
  try {
    return MODEL_BUILDERS[id]();
  } finally {
    BUILD_ARMS = true;
  }
}

const FISTS = 0; // weapon index of the fists; always available on key 4 and in the wheel cycle

export class Weapons {
  constructor({ cfg, camera, mainScene, envMap, world, enemies, player, fx, hud, audio }) {
    this.cfg = cfg.weapons;
    this.camera = camera;
    this.world = world;
    this.enemies = enemies;
    this.player = player;
    this.fx = fx;
    this.hud = hud;
    this.audio = audio;

    // --- Viewmodel scene / camera ---
    this.vmScene = new THREE.Scene();
    this.vmScene.environment = envMap; // same sky as the world, so metal reflects consistently
    this.vmScene.environmentIntensity = 0.9;
    this.vmScene.add(new THREE.HemisphereLight(0xcfe0f0, 0x6a6a60, 0.3));
    const sun = new THREE.DirectionalLight(0xfff0d6, 2.6);
    sun.position.set(1, 2, 1.5);
    this.vmScene.add(sun);
    this.vmCamera = new THREE.PerspectiveCamera(this.cfg.viewmodelFov, innerWidth / innerHeight, 0.02, 10);
    this.anchor = new THREE.Group();
    this.vmScene.add(this.anchor);

    this.flash = new MuzzleFlash();
    // A second light in the world scene so shots visibly light up the arena.
    this.worldLight = new THREE.PointLight(0xffb23d, 0, 16, 1);
    mainScene.add(this.worldLight);
    this.worldLightTime = 0;

    this.slots = this.cfg.list.map((c) => this._makeSlot(c));
    this.models = this.cfg.list.map((c) => {
      const model = MODEL_BUILDERS[c.id]();
      model.root.visible = false;
      this.anchor.add(model.root);
      return model;
    });

    // Three loadout slots (keys 1-3) hold indices into this.slots; edited from the inventory menu.
    // Fists (index 0) are always on key 4 and are not part of the loadout.
    this.loadout = [1, 2, 3];

    this.tp = null; // the Wizard, set by main.js: third-person muzzle + flash
    this._createBeam(mainScene);

    // Aim scratch vectors (reused every shot).
    this._origin = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._muzzleW = new THREE.Vector3();
    this._beamEnd = new THREE.Vector3();
    this._beamColor = new THREE.Color();
    this.hits = Array.from({ length: MAX_HITS }, () => ({ enemy: null, dmg: 0, crit: false, size: 1, point: new THREE.Vector3() }));
    this.hitCount = 0;

    this.reset();
  }

  reset() {
    this.slots.forEach((s) => this._resetSlot(s));
    this.index = -1;
    this.reloading = false;
    this.reloadPhase = 'start';
    this.reloadTimer = 0;
    this.reloadStage = 0;
    this.cooldown = 0;
    this.meleeCooldown = 0;
    this.triggerBuffer = 0;
    this.heat = 0;
    this.switching = false;
    this.switchPhase = 'out';
    this.switchTimer = 0;
    this.switchAmount = 0;
    this.pendingIndex = SLOT_PISTOL;
    this.pumpTimer = 0;
    this._resetBeamState();
    this.aiming = false;
    this.adsBlend = 0; // 0 = hip, 1 = on the sights (smoothed per frame)

    // View animation state
    this.kick = { z: 0, vz: 0, r: 0, vr: 0 };
    this.sway = { x: 0, y: 0 };
    this.lookX = 0;
    this.lookY = 0;
    this.sprintBlend = 0;
    this.slideBlend = 0;
    this.reloadBlend = 0;
    this.swingT = -1;
    this.punchT = [-1, -1];
    this.nextHand = 0;

    this._equip(SLOT_PISTOL);
  }

  get current() {
    return this.slots[this.index];
  }

  resize(aspect) {
    this.vmCamera.aspect = aspect;
    this.vmCamera.updateProjectionMatrix();
  }

  addLook(dx, dy) {
    this.lookX += dx;
    this.lookY += dy;
  }

  /**
   * A weapon slot. Weapons with `ammoTypes` (the shotgun) keep one merged config per
   * type in `typeCfgs`; `slot.cfg` always points at the active one, so every other
   * method just reads slot.cfg. `reserve` is the active type's reserve; the others
   * wait in `stash`.
   */
  _makeSlot(base) {
    const slot = { base, cfg: base, typeCfgs: null, type: null, stash: {}, mag: 0, reserve: 0 };
    if (base.ammoTypes) {
      const { ammoTypes, ...shared } = base;
      slot.typeCfgs = {};
      for (const [key, type] of Object.entries(ammoTypes)) {
        slot.typeCfgs[key] = { ...shared, ...type, name: `${base.name}: ${type.label}` };
      }
    }
    this._resetSlot(slot);
    return slot;
  }

  /** Sandbox: keep every cell full so nothing ever runs dry (reloading still resets the beam falloff). */
  _refillAll() {
    for (const s of this.slots) {
      if (s.base.melee) continue;
      s.mag = s.base.mag;
      s.reserve = s.cfg.maxReserve || s.reserve;
    }
  }

  _resetSlot(slot) {
    if (slot.typeCfgs) {
      slot.type = slot.base.defaultAmmo;
      slot.cfg = slot.typeCfgs[slot.type];
      for (const [key, cfg] of Object.entries(slot.typeCfgs)) slot.stash[key] = cfg.reserve;
      slot.reserve = slot.stash[slot.type];
      slot.stash[slot.type] = 0;
    } else {
      slot.reserve = slot.cfg.reserve || 0;
    }
    slot.mag = slot.base.mag || 0;
    slot.beamTime = 0; // seconds of continuous beam since the last reload (drives the power falloff)
  }

  _otherAmmoType(slot) {
    return Object.keys(slot.typeCfgs).find((key) => key !== slot.type);
  }

  /**
   * TAB on a gun with several ammo types. The shells in the tube go back to reserve,
   * the type changes, and the gun starts a full reload with the new shells: switching
   * is never free. Refused (dry click) if you have none of the other type.
   */
  toggleAmmo() {
    const slot = this.current;
    if (!slot.typeCfgs) return;
    const next = this._otherAmmoType(slot);
    if (slot.stash[next] <= 0) {
      this.audio.dry();
      return;
    }
    this._cancelReload();
    slot.stash[slot.type] = slot.reserve + slot.mag; // unload
    slot.mag = 0;
    slot.type = next;
    slot.cfg = slot.typeCfgs[next];
    slot.reserve = slot.stash[next];
    slot.stash[next] = 0;
    this.cooldown = Math.max(this.cooldown, 0.3);
    this.triggerBuffer = 0;
    this.audio.click('pump');
    this.hud.setWeapon(slot.cfg.id, slot.cfg.name);
    this.startReload();
  }

  /** Called by pickups. `amounts` maps pickup keys ('pistol', 'shotgun', 'slug', 'smg') -> rounds. Returns true if any ammo was taken. */
  addAmmo(amounts) {
    let added = false;
    for (const slot of this.slots) {
      if (slot.typeCfgs) {
        for (const [key, cfg] of Object.entries(slot.typeCfgs)) {
          const amount = amounts[cfg.pickupKey];
          if (!amount) continue;
          const have = key === slot.type ? slot.reserve : slot.stash[key];
          const take = Math.min(cfg.maxReserve - have, amount);
          if (take <= 0) continue;
          if (key === slot.type) slot.reserve += take;
          else slot.stash[key] += take;
          added = true;
        }
        continue;
      }
      const amount = amounts[slot.cfg.id];
      if (!amount) continue;
      const space = slot.cfg.maxReserve - slot.reserve;
      if (space <= 0) continue;
      slot.reserve += Math.min(space, amount);
      added = true;
    }
    return added;
  }

  /* ------------------------------ switching ------------------------------ */

  select(index) {
    if (index < 0 || index >= this.slots.length) return;
    if (!this.switching && index === this.index) return;
    if (this.switching && index === this.pendingIndex) return;
    this._stopBeam();
    this._cancelReload();
    this.pendingIndex = index;
    this.switching = true;
    this.switchPhase = 'out';
    this.switchTimer = this.cfg.switchTime / 2;
  }

  /** Muzzle flash on the viewmodel, and on the wizard's gun when it is visible. */
  _flashFire(size, intensity) {
    this.flash.fire(size, intensity);
    if (this.tp && this.player.thirdPersonVisible) this.tp.flash.fire(size, intensity);
  }

  _equip(index) {
    if (this.index >= 0) this.models[this.index].root.visible = false;
    this.index = index;
    const model = this.models[index];
    model.root.visible = true;
    if (model.muzzle) model.muzzle.add(this.flash.group);
    else this.flash.group.removeFromParent();
    this.cooldown = Math.max(this.cooldown, 0.05);
    const tint = this.current.cfg.flashTint;
    this.flash.setColor(tint ?? 0xffffff, tint ?? 0xffb23d);
    this.hud.setWeapon(this.current.cfg.id, this.current.cfg.name);
    this._pushHud();
    this._pushLoadout();
  }

  _updateSwitch(dt) {
    if (!this.switching) {
      this.switchAmount = 0;
      return;
    }
    const half = this.cfg.switchTime / 2;
    this.switchTimer -= dt;
    const progress = clamp(1 - this.switchTimer / half, 0, 1);
    this.switchAmount = this.switchPhase === 'out' ? easeInOut(progress) : 1 - easeInOut(progress);
    if (this.switchTimer > 0) return;
    if (this.switchPhase === 'out') {
      this._equip(this.pendingIndex);
      this.switchPhase = 'in';
      this.switchTimer = half;
    } else {
      this.switching = false;
    }
  }

  /* ------------------------------ fixed update --------------------------- */

  update(dt, input) {
    if (this.infiniteAmmo) this._refillAll();
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.meleeCooldown -= dt;
    this.triggerBuffer = Math.max(0, this.triggerBuffer - dt);
    this.heat = Math.max(0, this.heat - dt * this.cfg.heatDecay);
    if (input.firePressed) this.triggerBuffer = 0.15; // press buffering: a click just before the gun is ready still fires

    if (input.selectSlot >= 0) this.selectLoadout(input.selectSlot);
    if (input.wheel !== 0) {
      // The wheel cycles the three loadout slots, then fists.
      const order = [...this.loadout, FISTS];
      const from = order.indexOf(this.switching ? this.pendingIndex : this.index);
      this.select(order[(from + input.wheel + order.length) % order.length]);
    }
    this._updateSwitch(dt);
    if (input.ammoPressed && !this.switching) this.toggleAmmo();

    // Aim down sights: hold to aim. Aiming drops the sprint (like firing does) and is
    // not possible while switching, reloading, sliding, or with fists equipped.
    const gun = this.current.cfg;
    this.enemies.aimThreat = !gun.melee; // bots dodge when you aim a gun at them
    const canAim = !gun.melee && !this.switching;
    if (input.aimHeld && canAim && this.player.sprinting) this.player.cancelSprint();
    this.aiming = input.aimHeld && canAim && !this.reloading && !this.player.sprinting && !this.player.sliding;

    if (this.pumpTimer > 0) {
      this.pumpTimer -= dt;
      if (this.pumpTimer <= 0) this.audio.click('pump');
    }

    if (!this.switching) {
      if (input.reloadPressed) this.startReload();
      if (input.meleePressed) this.quickMelee();
      this._updateReload(dt);

      const c = this.current.cfg;
      if (c.beam) {
        this._updateBeam(dt, input);
        this._pushHud();
        return;
      }
      const wantsFire = c.auto ? (input.fireHeld || this.triggerBuffer > 0) : this.triggerBuffer > 0;
      if (wantsFire && this.cooldown <= 0) {
        if (this.player.sprinting) {
          // Cannot fire while sprinting: the attempt drops the sprint, and the shot comes a beat later.
          this.player.cancelSprint();
          this.cooldown = this.cfg.sprintExitDelay;
        } else {
          this._tryFire();
        }
      }
    }
    if (this.switching) this._stopBeam();
    this._pushHud();
  }

  _pushHud() {
    const w = this.current;
    // Ceil: the raygun's energy drains fractionally.
    this.hud.setAmmo(Math.ceil(w.mag), Math.ceil(w.reserve), this.reloading, !!w.cfg.melee);
    if (w.typeCfgs) {
      const other = this._otherAmmoType(w);
      this.hud.setAltAmmo(`TAB: ${w.typeCfgs[other].label} ${w.stash[other]}`);
    } else {
      this.hud.setAltAmmo('');
    }
  }

  /* ------------------------------ loadout --------------------------------- */

  /** Keys 1-3 pick a loadout slot, key 4 picks fists. */
  selectLoadout(slot) {
    this.select(slot >= this.loadout.length ? FISTS : this.loadout[slot]);
  }

  /** Which loadout slot (0-2) holds the equipped weapon, 3 for fists, -1 if none. */
  activeSlot() {
    const target = this.switching ? this.pendingIndex : this.index;
    if (target === FISTS) return this.loadout.length;
    return this.loadout.indexOf(target);
  }

  /** Put weapon `weaponIndex` into loadout slot `slot`, swapping if it is already in another slot. */
  assign(slot, weaponIndex) {
    if (weaponIndex === FISTS || weaponIndex < 0 || weaponIndex >= this.slots.length) return;
    const existing = this.loadout.indexOf(weaponIndex);
    if (existing >= 0) this.loadout[existing] = this.loadout[slot];
    this.loadout[slot] = weaponIndex;
    this._pushLoadout();
  }

  /** Stats for the inventory menu. */
  describe(index) {
    const s = this.slots[index];
    const c = s.cfg;
    const dps = c.beam ? c.dps : (c.damage * (c.pellets || 1)) / c.interval;
    const capacity = c.beam ? `${(c.mag / c.drainRate).toFixed(1)}s beam` : `${c.mag} rounds`;
    return { index, id: c.id, name: s.base.name, dps, range: c.range, capacity, slot: this.loadout.indexOf(index) };
  }

  /** Every weapon that can go in a loadout slot (everything except fists). */
  armory() {
    return this.slots.map((_, i) => i).filter((i) => i !== FISTS).map((i) => this.describe(i));
  }

  _pushLoadout() {
    this.hud.setLoadout(this.loadout.map((i) => this.slots[i].cfg.id), this.activeSlot());
  }

  /* -------------------------------- beam ---------------------------------- */

  _resetBeamState() {
    this.beamOn = false;
    this.beamTick = 0;
    this.beamAcc = 0;
    this.beamAccCrit = false;
    this.beamAccTime = 0;
    this.beamAccEnemy = null;
    this.reloadFromEnergy = 1;
    this.audio.beamStop();
    if (this.beam) this.beam.group.visible = false;
  }

  /** Beam power 0..1: full at the start of a cell, easing down to `powerMin` over `falloffTime` seconds of firing. */
  beamPower(slot) {
    const c = slot.cfg;
    const t = clamp(slot.beamTime / c.falloffTime, 0, 1);
    return 1 - (1 - c.powerMin) * (t * t * (3 - 2 * t));
  }

  /** Called every frame the game is not running (menu open, paused, dead). */
  cease() {
    if (this.beamOn) this._stopBeam();
  }

  _stopBeam() {
    if (!this.beamOn) return;
    this.beamOn = false;
    this._flushBeamNumber();
    this.audio.beamStop();
    this.beam.group.visible = false;
    this.worldLight.intensity = 0;
  }

  _updateBeam(dt, input) {
    const w = this.current;
    const c = w.cfg;
    const wants = input.fireHeld;

    if (wants && this.player.sprinting) { // firing cancels the sprint, same as the guns
      this.player.cancelSprint();
      this._stopBeam();
      return;
    }
    if (wants && !this.reloading && w.mag <= 0) { // empty cell: recharge, or click if there is nothing left
      this._stopBeam();
      if (w.reserve > 0) this.startReload();
      else if (input.firePressed) this.audio.dry();
      return;
    }
    if (!wants || this.reloading || w.mag <= 0) {
      this._stopBeam();
      return;
    }

    if (!this.beamOn) {
      this.beamOn = true;
      this.beamTick = 0;
      this.audio.beamStart();
    }
    w.mag = Math.max(0, w.mag - c.drainRate * dt);
    w.beamTime += dt; // the falloff clock only runs while firing, and only a reload resets it
    const power = this.beamPower(w);
    this.audio.beamSet(power);
    this.player.addRecoil(0.0003, (Math.random() - 0.5) * 0.0006, 0); // faint rumble

    this.beamTick -= dt;
    if (this.beamTick <= 0) {
      this.beamTick += c.tick;
      this._beamDamage(c, power);
    }
    if (w.mag <= 0) this._stopBeam();
  }

  /** One damage tick: damage scales with current beam power. Numbers are merged into ~3 per second. */
  _beamDamage(c, power) {
    this.player.getAim(this._origin, this._fwd, this._right, this._up);
    const wallT = this.world.raycast(this._origin, this._fwd, c.range);
    const hit = this.enemies.raycast(this._origin, this._fwd, Math.min(c.range, wallT), c.beamRadius);
    if (!hit) {
      this._flushBeamNumber();
      return;
    }
    const enemy = hit.enemy;
    if (this.beamAccEnemy !== enemy) this._flushBeamNumber();
    this.beamAccEnemy = enemy;
    this._beamEnd.copy(this._origin).addScaledVector(this._fwd, hit.t);

    const damage = c.dps * c.tick * power * (hit.crit ? c.critMul : 1);
    const flat = Math.hypot(this._fwd.x, this._fwd.z) || 1;
    const killed = this.enemies.damage(enemy, damage, {
      dirX: this._fwd.x / flat, dirZ: this._fwd.z / flat, knock: c.knockback, stun: 0, rollScale: 0.12,
    });
    this.beamAcc += damage;
    this.beamAccCrit = this.beamAccCrit || hit.crit;
    this.beamAccTime += c.tick;
    this.hud.hitmarker(hit.crit, killed);
    if (killed) {
      this.audio.enemyKill();
      this._flushBeamNumber();
    } else if (this.beamAccTime >= 0.3) {
      this._flushBeamNumber();
    }
  }

  _flushBeamNumber() {
    if (this.beamAcc > 0 && this.beamAccEnemy) {
      const power = this.beamPower(this.current);
      this.hud.damageNumber(this._beamEnd, this.beamAcc, this.beamAccCrit ? 'crit' : 'normal', 0.7 + 0.3 * power, 0.3);
    }
    this.beamAcc = 0;
    this.beamAccCrit = false;
    this.beamAccTime = 0;
    this.beamAccEnemy = null;
  }

  /** World-space beam: a white core, a scrolling additive sheath, and an impact glow. */
  _createBeam(mainScene) {
    const stripes = document.createElement('canvas');
    stripes.width = 8;
    stripes.height = 64;
    const ctx = stripes.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#404040');
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 64);
    const texture = new THREE.CanvasTexture(stripes);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;

    const geometry = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
    geometry.rotateX(Math.PI / 2); // axis along Z so lookAt() aims it
    const sheath = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false, fog: false,
    }));
    const core = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }));
    const impact = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    sheath.frustumCulled = core.frustumCulled = false;
    const group = new THREE.Group();
    group.add(sheath, core, impact);
    group.visible = false;
    mainScene.add(group);
    this.beam = { group, sheath, core, impact, texture };
  }

  /** Per rendered frame while firing: stretch the beam from the real muzzle to wherever the crosshair lands. */
  _updateBeamVisual(dt, time, model) {
    const w = this.current;
    const c = w.cfg;
    const power = this.beamPower(w);
    const cam = this.camera;
    const beam = this.beam;

    // Muzzle position: viewmodel space -> world space (the viewmodel camera mirrors the main one's orientation).
    let origin = cam.position;
    if (this.tp && this.player.thirdPersonVisible) {
      this.tp.muzzleWorld(this._muzzleW); // beam leaves the wizard's gun, aimed through the crosshair
      this.player.getAim(this._origin, this._fwd, this._right, this._up);
      origin = this._origin;
    } else {
      this.anchor.updateMatrixWorld(true);
      model.muzzle.getWorldPosition(this._muzzleW);
      this._muzzleW.applyQuaternion(cam.quaternion).add(cam.position);
      this._fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    }
    const wallT = this.world.raycast(origin, this._fwd, c.range);
    const hit = this.enemies.raycast(origin, this._fwd, Math.min(c.range, wallT), c.beamRadius);
    const endT = hit ? hit.t : Math.min(wallT, c.range);
    const end = this._beamEnd.copy(origin).addScaledVector(this._fwd, endT);

    const colour = glowColor(power, this._beamColor);
    const length = Math.max(0.1, this._muzzleW.distanceTo(end));
    const mid = this._tmp.addVectors(this._muzzleW, end).multiplyScalar(0.5);
    const flicker = 1 + Math.sin(time * 70) * 0.12;
    const widthScale = 0.45 + 0.55 * power; // the beam visibly thins as power falls off

    for (const [mesh, radius] of [[beam.sheath, 0.034 * widthScale * flicker], [beam.core, 0.009 * widthScale]]) {
      mesh.position.copy(mid);
      mesh.lookAt(end);
      mesh.scale.set(radius, radius, length);
    }
    beam.texture.repeat.set(1, length * 0.9);
    beam.texture.offset.y -= dt * 5;
    beam.sheath.material.color.copy(colour);
    beam.core.material.color.set(0xffffff).lerp(colour, 0.3);

    beam.impact.position.copy(end).addScaledVector(this._fwd, -0.05);
    beam.impact.scale.setScalar(0.45 * (0.5 + 0.5 * power) * (0.85 + Math.random() * 0.3));
    beam.impact.material.color.copy(colour);
    if (Math.random() < 0.6) this.fx.particles.burst(end, colour.getHex(), 1, 3, 0.05, 0.25, 6);

    this.worldLight.color.copy(colour);
    this.worldLight.position.copy(end).addScaledVector(this._fwd, -0.6);
    this.worldLight.intensity = 14 * power;
    this.worldLightTime = 0.05;
    this._flashFire(0.3 * (1 - 0.5 * this.adsBlend), 5);
    beam.group.visible = true;
  }

  /* ------------------------------- reloading ----------------------------- */

  startReload() {
    const w = this.current;
    const c = w.cfg;
    if (c.melee || this.reloading) return;
    const full = w.mag >= c.mag;
    // A beam weapon can also recharge when full, if its power has fallen off: that is what resets it.
    if (c.beam ? (full && w.beamTime <= 0) || (!full && w.reserve <= 0) : full || w.reserve <= 0) return;
    this._stopBeam();
    this.reloading = true;
    this.reloadFromEnergy = w.mag / c.mag;
    if (c.beam) this.audio.recharge(c.reloadTime);
    this.triggerBuffer = 0;
    this.reloadStage = 0;
    if (c.perShell) {
      this.reloadPhase = 'start';
      this.reloadTimer = c.startTime;
    } else {
      this.reloadTimer = c.reloadTime;
    }
  }

  _cancelReload() {
    this.reloading = false;
  }

  _updateReload(dt) {
    if (!this.reloading) return;
    const w = this.current;
    const c = w.cfg;
    this.reloadTimer -= dt;

    if (!c.perShell) {
      const p = 1 - this.reloadTimer / c.reloadTime;
      if (this.reloadStage === 0 && p > 0.3) { this.audio.click('mag'); this.reloadStage = 1; } // mag out
      if (this.reloadStage === 1 && p > 0.75) { this.audio.click('mag'); this.reloadStage = 2; } // mag in
      if (this.reloadTimer <= 0) {
        const n = Math.min(c.mag - w.mag, w.reserve);
        w.mag += n;
        w.reserve -= n;
        w.beamTime = 0; // a fresh cell restores full beam power
        this.reloading = false;
      }
      return;
    }

    // Shotgun: one shell at a time, interruptible by firing.
    if (this.reloadTimer > 0) return;
    if (this.reloadPhase === 'start') {
      this.reloadPhase = 'load';
      this.reloadTimer = c.shellTime;
    } else if (this.reloadPhase === 'load') {
      w.mag += 1;
      w.reserve -= 1;
      this.audio.click('shell');
      if (w.mag < c.mag && w.reserve > 0) {
        this.reloadTimer = c.shellTime;
      } else {
        this.reloadPhase = 'end';
        this.reloadTimer = c.endTime;
        this.audio.click('pump');
      }
    } else {
      this.reloading = false;
    }
  }

  /* -------------------------------- firing ------------------------------- */

  _tryFire() {
    const w = this.current;
    const c = w.cfg;

    if (c.melee) {
      this.triggerBuffer = 0;
      this.cooldown = c.interval;
      this._melee(c);
      this._startMeleeAnim(true);
      return;
    }

    if (this.reloading) {
      if (c.perShell && w.mag > 0) {
        this._cancelReload(); // firing interrupts a shotgun reload
      } else {
        this.triggerBuffer = 0;
        return;
      }
    }

    if (w.mag <= 0) {
      this.triggerBuffer = 0;
      if (w.reserve > 0) {
        this.startReload(); // auto-reload when you try to fire on empty
      } else {
        this.audio.dry();
        this.cooldown = 0.3;
      }
      return;
    }

    this._fireGun(w);
  }

  _fireGun(w) {
    const c = w.cfg;
    const player = this.player;
    w.mag -= 1;
    this.cooldown = c.interval;
    this.triggerBuffer = 0;
    this.heat = Math.min(this.cfg.maxHeat, this.heat + c.heat);

    // Read the aim BEFORE applying recoil: the shot goes where the crosshair was when you
    // pulled the trigger, and the kick only affects the next one.
    player.getAim(this._origin, this._fwd, this._right, this._up);

    // Camera kick (recovers) + aim climb (permanent until you pull down).
    const steady = 1 - 0.35 * this.adsBlend; // sights steady the gun a little
    player.addRecoil(c.camKick * steady * (0.8 + Math.random() * 0.4), (Math.random() - 0.5) * 2 * c.camYaw * steady, c.climb * steady);
    // Viewmodel kick: impulse into the spring (see updateView).
    this.kick.vz += c.kickZ * 60;
    this.kick.vr += c.kickRot * 60;

    this._flashFire(c.flashSize * (1 - 0.6 * this.adsBlend), 6); // smaller flash so it does not cover the sights
    this.audio.shoot(c.id);

    if (this.tp && player.thirdPersonVisible) {
      this.tp.muzzleWorld(this._from); // shots leave the wizard's gun
    } else {
      this._from.copy(this._origin)
        .addScaledVector(this._fwd, 0.7)
        .addScaledVector(this._right, 0.2)
        .addScaledVector(this._up, -0.16);
    }
    this.worldLight.position.copy(this._origin).addScaledVector(this._fwd, 1.5);
    this.worldLight.intensity = c.worldLight;
    this.worldLightTime = 0.05;

    // Spread widens when moving or airborne.
    const ads = this.adsBlend;
    const spread = c.spread * (1 + (player.speed * 0.05 + (player.grounded ? 0 : 1.5)) * (1 - ads)) * (1 - 0.5 * ads);
    this.hitCount = 0;
    for (let i = 0; i < c.pellets; i++) {
      const radius = Math.sqrt(Math.random()) * spread; // uniform over a disc
      const angle = Math.random() * Math.PI * 2;
      this._dir.copy(this._fwd)
        .addScaledVector(this._right, Math.cos(angle) * radius)
        .addScaledVector(this._up, Math.sin(angle) * radius)
        .normalize();
      this._shootRay(c);
    }
    this._applyHits(c);

    if (c.id === 'shotgun') this.pumpTimer = c.interval * 0.45;
  }

  _shootRay(c) {
    const origin = this._origin;
    const dir = this._dir;
    const wallT = this.world.raycast(origin, dir, c.range);
    const hit = this.enemies.raycast(origin, dir, Math.min(c.range, wallT), c.pelletRadius || 0);
    let endT = 60; // nothing hit: tracer just flies off into the distance

    if (hit) {
      endT = hit.t;
      this._recordHit(hit, c);
    } else if (wallT < c.range) {
      endT = wallT;
      this._tmp.copy(origin).addScaledVector(dir, wallT - 0.05);
      this.fx.particles.burst(this._tmp, 0xffffff, c.pellets > 1 ? 3 : 6, 3, 0.08, 0.3, 8); // impact puff
    }
    this._to.copy(origin).addScaledVector(dir, endT);
    this.fx.tracers.spawn(this._from, this._to, c.tracerColor);
  }

  _damageFalloff(c, distance) {
    if (!c.falloffStart) return 1;
    const t = clamp((distance - c.falloffStart) / (c.falloffEnd - c.falloffStart), 0, 1);
    return 1 - t * (1 - c.falloffMin);
  }

  /** One entry per projectile that connects. Merged per target in _applyHits. */
  _recordHit(hit, c) {
    if (this.hitCount >= MAX_HITS) return;
    const falloff = this._damageFalloff(c, hit.t);
    const h = this.hits[this.hitCount++];
    h.enemy = hit.enemy;
    h.dmg = c.damage * (hit.crit ? c.critMul : 1) * falloff;
    h.crit = hit.crit;
    // Floating numbers shrink as the pellet's damage tapers off with distance.
    h.size = c.pelletNumbers ? 0.6 + 0.4 * falloff : 1;
    h.point.copy(this._origin).addScaledVector(this._dir, hit.t);
  }

  /**
   * Damage each target ONCE with the total of its pellets (one flash, one knockback).
   * Numbers: buckshot shows one per pellet, scattered around the impacts; everything
   * else shows a single merged number per target.
   */
  _applyHits(c) {
    const fwd = this._fwd;
    const flat = Math.hypot(fwd.x, fwd.z) || 1;
    for (let i = 0; i < this.hitCount; i++) {
      const first = this.hits[i];
      const enemy = first.enemy;
      if (!enemy) continue; // already merged into an earlier entry
      let total = 0;
      let crit = false;
      let last = first;
      for (let j = i; j < this.hitCount; j++) {
        const h = this.hits[j];
        if (h.enemy !== enemy) continue;
        total += h.dmg;
        crit = crit || h.crit;
        last = h;
        if (c.pelletNumbers) this.hud.damageNumber(h.point, h.dmg, h.crit ? 'crit' : 'normal', h.size, 0.45);
        h.enemy = null;
      }
      const killed = this.enemies.damage(enemy, total, {
        dirX: fwd.x / flat, dirZ: fwd.z / flat, knock: c.knockback, stun: c.stun,
      });
      if (!c.pelletNumbers) this.hud.damageNumber(last.point, total, crit ? 'crit' : 'normal');
      this.hud.hitmarker(crit, killed);
      this.fx.particles.burst(last.point, 0xfff27a, 4, 3.5, 0.07, 0.25, 8);
      if (killed) this.audio.enemyKill();
      else this.audio.hitBeep(crit);
    }
    this.hitCount = 0;
  }

  /* -------------------------------- melee -------------------------------- */

  quickMelee() {
    if (this.meleeCooldown > 0) return;
    const profile = this.cfg.quickMelee;
    this.meleeCooldown = profile.cooldown;
    this.cooldown = Math.max(this.cooldown, 0.25);
    if (this.player.sprinting) this.player.cancelSprint();
    this._melee(profile);
    this._startMeleeAnim(this.current.cfg.melee);
  }

  /** Short-range cone pick (forgiving) with a wall check, damage applied instantly. */
  _melee(profile) {
    const player = this.player;
    player.getAim(this._origin, this._fwd, this._right, this._up);
    const target = this.enemies.meleeTarget(this._origin, this._fwd, profile.range, profile.cone);

    let connected = false;
    if (target) {
      const centre = this.enemies.bodyCenter(target, this._tmp);
      const dist = this._origin.distanceTo(centre);
      this._dir.subVectors(centre, this._origin).divideScalar(dist || 1);
      connected = this.world.raycast(this._origin, this._dir, dist) >= dist - 0.3; // not behind a wall
    }

    if (!connected) {
      this.audio.punch(false);
      return;
    }

    const scale = target.def.scale;
    this._to.copy(this._tmp).addScaledVector(this._dir, -0.45 * scale); // impact point on the near surface
    const flat = Math.hypot(this._fwd.x, this._fwd.z) || 1;
    const killed = this.enemies.damage(target, profile.damage, {
      dirX: this._fwd.x / flat, dirZ: this._fwd.z / flat, knock: profile.knockback, stun: profile.stun,
    });
    this.hud.damageNumber(this._to, profile.damage, 'melee');
    this.hud.hitmarker(false, killed);
    this.fx.particles.burst(this._to, 0xffffff, 7, 4.5, 0.09, 0.3, 8);
    player.addRecoil(0.012, (Math.random() - 0.5) * 0.02, 0);
    this.audio.punch(true);
    if (killed) this.audio.enemyKill();
    else this.audio.hitBeep(false);
  }

  _startMeleeAnim(usesFists) {
    if (usesFists) {
      this.punchT[this.nextHand] = 0;
      this.nextHand = 1 - this.nextHand; // alternate hands
    } else {
      this.swingT = 0;
    }
  }

  /* ------------------------------- crosshair ----------------------------- */

  /** Crosshair gap in px: grows with speed, airtime, sprinting and recent fire. */
  crosshairSpread() {
    const h = this.cfg.crosshair;
    const p = this.player;
    return h.base + p.speed * h.perSpeed + (p.grounded ? 0 : h.air) + this.heat;
  }

  /* ------------------------------ view update ---------------------------- */

  /** Per rendered frame: all viewmodel animation, summed into the anchor transform. */
  updateView(dt, time) {
    const player = this.player;
    const model = this.models[this.index];
    const w = this.current;
    const c = w.cfg;
    const home = model.home;

    // Recoil spring: fire() injects velocity; the spring pulls it back with a little overshoot.
    const k = this.kick;
    k.vz += (-260 * k.z - 19 * k.vz) * dt;
    k.z += k.vz * dt;
    k.vr += (-260 * k.r - 19 * k.vr) * dt;
    k.r += k.vr * dt;

    // Look sway: the gun lags behind quick mouse movement, then settles.
    const swayTx = clamp(-this.lookX * 0.0007, -0.06, 0.06);
    const swayTy = clamp(this.lookY * 0.0007, -0.05, 0.05);
    this.lookX = 0;
    this.lookY = 0;
    this.sway.x = damp(this.sway.x, swayTx, 14, dt);
    this.sway.y = damp(this.sway.y, swayTy, 14, dt);

    this.sprintBlend = damp(this.sprintBlend, player.sprinting ? 1 : 0, 9, dt);
    this.slideBlend = damp(this.slideBlend, player.sliding ? 1 : 0, 8, dt);
    this.reloadBlend = damp(this.reloadBlend, this.reloading && c.perShell ? 1 : 0, 12, dt);

    // Weapon bob: harder while sprinting.
    const bobAmp = player.bobAmt * (player.sprinting ? 2.6 : 1);
    const phase = player.bobPhase;
    const breathe = Math.sin(time * 1.7) * 0.0025;

    // ADS: blend the whole pose from the hip position to the per-gun sight position, and
    // damp bob / sway / breathing so the sights stay put on the target.
    this.adsBlend = damp(this.adsBlend, this.aiming ? 1 : 0, this.cfg.adsSpeed, dt);
    const ads = this.adsBlend;
    const aim = c.ads || home; // fists have no sights
    const loose = 1 - 0.85 * ads;
    this.hud.setAim(player.thirdPersonVisible ? 0 : ads); // no sights to look down in third person
    player.aimBlend = ads;
    player.zoom = c.ads ? c.ads.fovDrop * ads : 0;

    let x = home.x + (aim.x - home.x) * ads + (this.sway.x + Math.cos(phase) * 0.012 * bobAmp) * loose - 0.05 * this.sprintBlend;
    let y = home.y + (aim.y - home.y) * ads
      + (this.sway.y - Math.abs(Math.sin(phase)) * 0.016 * bobAmp + player.dip * 0.5 + breathe) * loose
      - 0.07 * this.sprintBlend;
    let z = home.z + (aim.z - home.z) * ads + k.z * (1 - 0.5 * ads) + 0.04 * this.sprintBlend;
    let rx = k.r * (1 - 0.4 * ads) - 0.15 * this.sprintBlend;
    let ry = 0.55 * this.sprintBlend;
    let rz = -0.15 * this.sprintBlend - 0.25 * this.slideBlend + this.sway.x * 2;

    let supportDrop = 0; // how far the off-hand dips (mag changes, loading shells)

    // Reload tween (pistol / SMG: dip and tilt; shotgun: tilt up and hold while shells go in).
    if (this.reloading) {
      if (!c.perShell) {
        const p = clamp(1 - this.reloadTimer / c.reloadTime, 0, 1);
        const s = Math.sin(Math.PI * easeInOut(p));
        y -= 0.13 * s;
        rz += 0.6 * s;
        rx += 0.3 * s;
        x -= 0.04 * s;
        supportDrop = 0.12 * s;
        if (model.parts.mag) { // magazine drops out, then slides back in
          const out = p < 0.3 ? 0 : p < 0.5 ? (p - 0.3) / 0.2 : p < 0.6 ? 1 : p < 0.8 ? 1 - (p - 0.6) / 0.2 : 0;
          model.parts.mag.position.y = model.parts.magBaseY - 0.25 * out;
        }
      } else if (this.reloadPhase === 'load') {
        const p = clamp(1 - this.reloadTimer / c.shellTime, 0, 1);
        y -= 0.025 * Math.sin(Math.PI * p); // each shell is a small push
        supportDrop = 0.1 * Math.sin(Math.PI * p);
      }
    } else if (model.parts.mag) {
      model.parts.mag.position.y = model.parts.magBaseY;
    }
    if (c.perShell) { // shotgun held tilted while loading
      const b = easeInOut(this.reloadBlend);
      rz += 0.55 * b;
      rx += 0.3 * b;
      y -= 0.07 * b;
    }

    // Shotgun pump after each shot.
    if (model.parts.pump) {
      const p = 1 - this.cooldown / c.interval;
      const stroke = p > 0.3 && p < 0.8 ? Math.sin(Math.PI * ((p - 0.3) / 0.5)) : 0;
      model.parts.pump.position.z = model.parts.pumpBaseZ + 0.13 * stroke;
    }

    // Weapon switch: lower and tilt away.
    if (this.switchAmount > 0) {
      y -= 0.4 * this.switchAmount;
      rx -= 0.6 * this.switchAmount;
    }

    // Quick melee with a gun equipped: a forward jab.
    if (this.swingT >= 0) {
      this.swingT += dt / 0.3;
      if (this.swingT >= 1) {
        this.swingT = -1;
      } else {
        const s = Math.sin(Math.PI * this.swingT);
        z -= 0.22 * s;
        x -= 0.12 * s;
        ry += 0.7 * s;
        rx += 0.25 * s;
      }
    }

    // Beam: the whole weapon hums with a fine vibration while firing.
    if (this.beamOn) {
      const shake = 0.0025 * (1 - 0.7 * ads);
      x += (Math.random() - 0.5) * shake;
      y += (Math.random() - 0.5) * shake;
      z += 0.008;
    }

    if (model.parts.support) model.parts.support.object.position.y = model.parts.support.baseY - supportDrop;
    if (model.parts.hands) this._animateHands(model.parts.hands, dt, time, bobAmp, phase);

    this.anchor.position.set(x, y, z);
    this.anchor.rotation.set(rx, ry, rz);

    if (model.animate) {
      let energy = w.mag / c.mag;
      if (this.reloading) { // core refills over the reload
        const p = clamp(1 - this.reloadTimer / c.reloadTime, 0, 1);
        energy = this.reloadFromEnergy + (Math.min(1, (w.mag + w.reserve) / c.mag) - this.reloadFromEnergy) * easeInOut(p);
      }
      const state = { firing: this.beamOn, energy, power: this.beamPower(w), reloading: this.reloading };
      model.animate(dt, time, state);
      if (this.tp) this.tp.animateGun(this.index, dt, time, state);
    }
    if (this.beamOn) this._updateBeamVisual(dt, time, model);

    this.flash.update(dt);
    if (this.worldLightTime > 0) {
      this.worldLightTime -= dt;
      if (this.worldLightTime <= 0) this.worldLight.intensity = 0;
    }
  }

  _animateHands(hands, dt, time, bobAmp, phase) {
    for (let i = 0; i < 2; i++) {
      const hand = hands[i];
      const base = hand.userData.base;
      const side = hand.userData.side;
      // Idle: gentle sway, alternating with the walk cycle.
      let ox = 0;
      let oy = Math.sin(time * 1.9 + i * 1.7) * 0.004 + Math.sin(phase + i * Math.PI) * 0.012 * bobAmp;
      let oz = 0;
      let rotX = 0;
      if (this.punchT[i] >= 0) {
        this.punchT[i] += dt / 0.24;
        const t = this.punchT[i];
        if (t >= 1) {
          this.punchT[i] = -1;
        } else {
          // Fast out (first 35%), slower return.
          const f = t < 0.35 ? 1 - Math.pow(1 - t / 0.35, 3) : 1 - easeInOut((t - 0.35) / 0.65);
          ox = -side * 0.14 * f;
          oy += 0.07 * f;
          oz = -0.5 * f;
          rotX = -0.4 * f;
        }
      }
      hand.position.set(base.x + ox, base.y + oy, base.z + oz);
      hand.rotation.x = rotX;
    }
  }

  /** Draw the viewmodel on top of whatever is already in the framebuffer. */
  render(renderer) {
    if (this.player.thirdPersonVisible) return; // the wizard holds the gun instead
    renderer.clearDepth();
    renderer.render(this.vmScene, this.vmCamera);
  }
}
