import * as THREE from 'three';
import { MuzzleFlash } from '../graphics/particles.js';
import { clamp, damp, easeInOut } from '../engine/math.js';
import { MAX_HITS } from './firearm.js';
import { meleeStrike } from './melee.js';

/*
 * HOLDABLE SYSTEM: the player's hands.
 *
 * It owns everything about holding things and nothing about any one thing: the first-person
 * viewmodel (its own scene and camera), the list of items, the loadout slots, switching, aiming
 * down sights, the recoil and sway springs, the muzzle flash and the shared hand state (cooldown,
 * trigger buffer, heat). What an item does with the trigger, a reload or an ammo swap is the item's
 * business: the system calls the Holdable hooks (holdable.js) on whichever item is in hand.
 *
 * VIEWMODEL SETUP
 * The viewmodel lives in its own scene (`vmScene`) drawn by its own camera (`vmCamera`) AFTER the world,
 * with the depth buffer cleared in between. That is why an item never clips into a wall: it is never
 * depth-tested against the world. The viewmodel camera sits at the origin looking down -Z, so every position
 * is "metres in front of / beside your eye". All animation (bob, recoil, reload, switching, sway, melee swing)
 * is summed into one offset applied to `anchor`.
 *
 * The game supplies:
 *   config   { viewmodelFov, switchTime, adsSpeed, sprintExitDelay, maxHeat, heatDecay, crosshair, quickMelee,
 *              handsIndex, startIndex, defaultLoadout, list: [{ id, name, type, ... }] }
 *   types    { type name -> Holdable subclass }: how each list entry becomes an item
 *   models   { item id -> { build(), buildHeld?(), beamColor?() } }: the viewmodel for each item
 */

const NO_FORGIVENESS = Object.freeze({ boost: 0, extra: 0 });

const LIMB_UP = new THREE.Vector3(0, 1, 0);
const LIMB_SCRATCH = new THREE.Vector3();

/** The wrist groups of a model (see HoldableSystem._reachShoulders). */
function collectLimbs(root) {
  const limbs = [];
  root.traverse((object) => { if (object.userData.limb) limbs.push(object); });
  return limbs;
}

export class HoldableSystem {
  constructor({ config, types, models, camera, mainScene, envMap, world, enemies, player, fx, hud, audio }) {
    this.cfg = config;
    this.modelDefs = models;
    this.camera = camera;
    this.mainScene = mainScene;
    this.world = world;
    this.enemies = enemies;
    this.player = player;
    this.fx = fx;
    this.hud = hud;
    this.audio = audio;
    this.handsIndex = config.handsIndex ?? 0; // the always-available item: its own key, and the last stop of the wheel
    this.startIndex = config.startIndex ?? 1;

    // --- Viewmodel scene / camera ---
    this.vmScene = new THREE.Scene();
    this.vmScene.environment = envMap; // same sky as the world, so metal reflects consistently
    this.vmScene.environmentIntensity = 0.9;
    this.vmScene.add(new THREE.HemisphereLight(0xcfe0f0, 0x6a6a60, 0.3));
    const sun = new THREE.DirectionalLight(0xfff0d6, 2.6);
    sun.position.set(1, 2, 1.5);
    this.vmScene.add(sun);
    this.vmCamera = new THREE.PerspectiveCamera(config.viewmodelFov, innerWidth / innerHeight, 0.02, 10);
    this.anchor = new THREE.Group();
    this.vmScene.add(this.anchor);

    this.flash = new MuzzleFlash();
    // A second light in the world scene so shots visibly light up the arena.
    this.worldLight = new THREE.PointLight(0xffb23d, 0, 16, 1);
    mainScene.add(this.worldLight);
    this.worldLightTime = 0;

    this.slots = config.list.map((entry) => {
      const ItemClass = types[entry.type];
      if (!ItemClass) throw new Error(`holdable "${entry.id}" has unknown type "${entry.type}"`);
      return new ItemClass(entry);
    });
    this.models = config.list.map((entry) => {
      const model = models[entry.id].build();
      model.root.visible = false;
      this.anchor.add(model.root);
      return model;
    });

    // Loadout slots (keys 1-3) hold indices into this.slots; edited from the inventory menu.
    // The hands item is always on its own key and is not part of the loadout.
    this.loadout = [...(config.defaultLoadout ?? [1, 2, 3])];

    this.tp = null; // the third-person character, set by the game: muzzle position and flash
    // Multiplayer hooks, set by the game (null in single player):
    this.onShot = null; // (itemIndex, fromVector, endPointsArray) after each trigger pull of a ray weapon
    this.onMelee = null; // (usesFists) after each melee swing
    this.onItemMessage = null; // (message) an item wants other players' copies of it to hear something (a launched projectile)
    this.fireLocked = false; // a mode that uses the trigger for something else (digging) sets this
    this.infiniteAmmo = false; // every item stays completely full
    this.infiniteReserve = false; // spare ammo never runs out, but magazines still empty and need a reload
    this._shotEnds = []; // end points of this trigger pull's rays, reused

    // Scratch values reused every shot (no per-shot garbage).
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
    this.pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, supportDrop: 0 };
    this.flickSpeed = 0; // the fastest recent view turn (rad/s), held briefly: see flickForgiveness

    for (const item of this.slots) item.onAttach(this);
    this.reset();
  }

  reset() {
    this.slots.forEach((item) => item.reset());
    this.index = -1;
    this.cooldown = 0;
    this.meleeCooldown = 0;
    this.triggerBuffer = 0;
    this.heat = 0;
    this.switching = false;
    this.switchPhase = 'out';
    this.switchTimer = 0;
    this.switchAmount = 0;
    this.pendingIndex = this.startIndex;
    this.audio.beamStop();
    this.aiming = false;
    this.adsBlend = 0; // 0 = hip, 1 = on the sights (smoothed per frame)
    this.flickSpeed = 0;

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

    this._equip(this.startIndex);
  }

  get current() {
    return this.slots[this.index];
  }

  /* State that lives on the item in hand but is read (and, by tests and the sandbox, written) through the hands. */
  get reloading() { return this.current?.reloading ?? false; }

  set reloading(value) { if (this.current && 'reloading' in this.current) this.current.reloading = value; }

  get reloadTimer() { return this.current?.reloadTimer ?? 0; }

  get beamOn() { return this.current?.beamOn ?? false; }

  beamPower(item) {
    return item.beamPower ? item.beamPower() : 1;
  }

  resize(aspect) {
    this.vmCamera.aspect = aspect;
    this.vmCamera.updateProjectionMatrix();
  }

  addLook(dx, dy) {
    this.lookX += dx;
    this.lookY += dy;
  }

  /** Sandbox: keep every item full so nothing ever runs dry. */
  _refillAll() {
    for (const item of this.slots) item.refill();
  }

  /** Called by pickups. `amounts` maps pickup keys to quantities. Returns true if any ammo was taken. */
  addAmmo(amounts) {
    let added = false;
    for (const item of this.slots) added = item.addAmmo(amounts) || added;
    return added;
  }

  startReload() {
    this.current.startReload(this);
  }

  /* ------------------------------ switching ------------------------------ */

  select(index) {
    if (index < 0 || index >= this.slots.length) return;
    if (!this.switching && index === this.index) return;
    if (this.switching && index === this.pendingIndex) return;
    this.current?.onDeselect(this);
    this.pendingIndex = index;
    this.switching = true;
    this.switchPhase = 'out';
    this.switchTimer = this.cfg.switchTime / 2;
  }

  /** An item tells the other players about something it did. A no-op in single player. */
  sendItemMessage(message) {
    if (this.onItemMessage) this.onItemMessage(message);
  }

  /** A relayed message from another player: every item gets to read it. */
  onPeerMessage(from, message) {
    for (const item of this.slots) item.onPeerMessage(this, from, message);
  }

  /** Muzzle flash on the viewmodel, and on the third-person model's item when it is visible. */
  flashFire(size, intensity) {
    this.flash.fire(size, intensity);
    if (this.tp && this.player.thirdPersonVisible) this.tp.flash.fire(size, intensity);
  }

  _equip(index) {
    for (const other of this.models) other.root.visible = false; // all of them: reset() leaves index at -1
    this.index = index;
    const model = this.models[index];
    model.root.visible = true;
    if (model.muzzle) model.muzzle.add(this.flash.group);
    else this.flash.group.removeFromParent();
    this.cooldown = Math.max(this.cooldown, 0.05);
    const tint = this.current.cfg.flashTint;
    this.flash.setColor(tint ?? 0xffffff, tint ?? 0xffb23d);
    this.hud.setWeapon(this.current.cfg.id, this.current.cfg.name);
    this.current.onEquip(this);
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
    if (this.infiniteReserve) for (const item of this.slots) item.refillReserve();
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.meleeCooldown -= dt;
    this.triggerBuffer = Math.max(0, this.triggerBuffer - dt);
    this.heat = Math.max(0, this.heat - dt * this.cfg.heatDecay);
    if (input.firePressed) this.triggerBuffer = 0.15; // press buffering: a click just before the item is ready still fires
    this._trackFlick(dt);

    if (input.selectSlot >= 0) this.selectLoadout(input.selectSlot);
    if (input.wheel !== 0) {
      // The wheel cycles the loadout slots, then the hands item.
      const order = [...this.loadout, this.handsIndex];
      const from = order.indexOf(this.switching ? this.pendingIndex : this.index);
      this.select(order[(from + input.wheel + order.length) % order.length]);
    }
    this._updateSwitch(dt);
    if (input.ammoPressed && !this.switching) this.current.swapAmmo(this);

    // Aim down sights: hold to aim. Aiming drops the sprint (like firing does) and is
    // not possible while switching, reloading, sprinting, or with an item that has no sights.
    const item = this.current;
    this.enemies.aimThreat = item.aimable; // bots dodge when you aim a gun at them
    const canAim = item.aimable && !this.switching;
    if (input.aimHeld && canAim && this.player.sprinting) this.player.cancelSprint();
    this.aiming = input.aimHeld && canAim && !this.reloading && !this.player.sprinting;

    for (const other of this.slots) other.backgroundTick(this, dt);
    item.tick(this, dt);

    if (!this.switching) {
      if (input.reloadPressed) item.startReload(this);
      if (input.meleePressed && !this.fireLocked) this.quickMelee();
      item.fixedUpdate(this, dt, input);
    }
    if (this.switching) item.cease(this);
    this._pushHud();
  }

  _pushHud() {
    const state = this.current.hudState(this);
    this.hud.setAmmo(state.mag, state.reserve, state.reloading, state.melee);
    this.hud.setAltAmmo(state.altAmmo);
  }

  /* ------------------------------ loadout --------------------------------- */

  /** Keys 1-3 pick a loadout slot, the next key picks the hands item. */
  selectLoadout(slot) {
    this.select(slot >= this.loadout.length ? this.handsIndex : this.loadout[slot]);
  }

  /** Which loadout slot holds the equipped item (the hands item counts as one past the loadout), -1 if none. */
  activeSlot() {
    const target = this.switching ? this.pendingIndex : this.index;
    if (target === this.handsIndex) return this.loadout.length;
    return this.loadout.indexOf(target);
  }

  /** Put item `itemIndex` into loadout slot `slot`, swapping if it is already in another slot. */
  assign(slot, itemIndex) {
    if (itemIndex === this.handsIndex || itemIndex < 0 || itemIndex >= this.slots.length) return;
    const existing = this.loadout.indexOf(itemIndex);
    if (existing >= 0) this.loadout[existing] = this.loadout[slot];
    this.loadout[slot] = itemIndex;
    this._pushLoadout();
  }

  /**
   * Remember the fastest recent view turn. A flick ends when the player stops turning, and the click comes a
   * moment later, so the speed is held and fades over `flick.memory` seconds instead of dropping at once.
   */
  _trackFlick(dt) {
    const flick = this.cfg.flick;
    if (!flick) return;
    this.flickSpeed = Math.max(this.player.viewTurnRate ?? 0, this.flickSpeed * Math.exp(-dt / flick.memory));
  }

  /**
   * Extra hit forgiveness for a fast flick, for quickscoping. Returns { boost, extra }: `boost` multiplies how fast
   * the hit volumes grow with distance, and `extra` is a flat addition in metres. Both rise from zero at
   * `flick.minSpeed` to their maximums at `flick.fullSpeed` (view turn in rad/s); without the sights up only
   * `flick.hipShare` of it applies. Tune it in CONFIG.weapons.flick.
   */
  flickForgiveness() {
    const flick = this.cfg.flick;
    if (!flick) return NO_FORGIVENESS;
    const t = clamp((this.flickSpeed - flick.minSpeed) / (flick.fullSpeed - flick.minSpeed), 0, 1);
    if (t === 0) return NO_FORGIVENESS;
    const share = flick.hipShare + (1 - flick.hipShare) * this.adsBlend;
    const strength = t * t * (3 - 2 * t) * share;
    return { boost: flick.maxBoost * strength, extra: flick.maxExtraRadius * strength };
  }

  /** Stats for the inventory menu. */
  describe(index) {
    const item = this.slots[index];
    return { index, id: item.cfg.id, name: item.base.name, ...item.describe(), slot: this.loadout.indexOf(index) };
  }

  /** Every item that can go in a loadout slot (everything except the hands item and hidden tools). */
  armory() {
    return this.slots.map((_, i) => i).filter((i) => i !== this.handsIndex && !this.slots[i].hidden).map((i) => this.describe(i));
  }

  _pushLoadout() {
    this.hud.setLoadout(this.loadout.map((i) => this.slots[i].cfg.id), this.activeSlot());
  }

  /** Called every frame the game is not running (menu open, paused, dead). */
  cease() {
    this.current.cease(this);
  }

  /* -------------------------------- melee -------------------------------- */

  /** The quick-melee control: a jab with whatever is in hand. */
  quickMelee() {
    if (this.meleeCooldown > 0) return;
    const profile = this.cfg.quickMelee;
    this.meleeCooldown = profile.cooldown;
    this.cooldown = Math.max(this.cooldown, 0.25);
    if (this.player.sprinting) this.player.cancelSprint();
    meleeStrike(this, profile);
    this.startMeleeAnim(this.current.melee);
  }

  /** Play the tool swing animation (and tell other players) without hitting anything. */
  swingTool() {
    this.startMeleeAnim(false);
  }

  startMeleeAnim(usesFists) {
    if (this.onMelee) this.onMelee(usesFists);
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
    const { player } = this;
    if (!player.alive) this.aiming = false; // update() is frozen while dead: lower the sights by hand
    const model = this.models[this.index];
    const item = this.current;
    const c = item.cfg;
    const { home } = model;

    // Recoil spring: firing injects velocity; the spring pulls it back with a little overshoot.
    const k = this.kick;
    k.vz += (-260 * k.z - 19 * k.vz) * dt;
    k.z += k.vz * dt;
    k.vr += (-260 * k.r - 19 * k.vr) * dt;
    k.r += k.vr * dt;

    // Look sway: the item lags behind quick mouse movement, then settles.
    const swayTx = clamp(-this.lookX * 0.0007, -0.06, 0.06);
    const swayTy = clamp(this.lookY * 0.0007, -0.05, 0.05);
    this.lookX = 0;
    this.lookY = 0;
    this.sway.x = damp(this.sway.x, swayTx, 14, dt);
    this.sway.y = damp(this.sway.y, swayTy, 14, dt);

    this.sprintBlend = damp(this.sprintBlend, player.sprinting ? 1 : 0, 9, dt);
    this.slideBlend = damp(this.slideBlend, player.sliding ? 1 : 0, 8, dt);
    this.reloadBlend = damp(this.reloadBlend, item.loadingRoundByRound ? 1 : 0, 12, dt);

    // Bob: harder while sprinting.
    const bobAmp = player.bobAmt * (player.sprinting ? 2.6 : 1);
    const phase = player.bobPhase;
    const breathe = Math.sin(time * 1.7) * 0.0025;

    // ADS: blend the whole pose from the hip position to the item's sight position, and
    // damp bob / sway / breathing so the sights stay put on the target.
    this.adsBlend = damp(this.adsBlend, this.aiming ? 1 : 0, c.adsSpeed ?? this.cfg.adsSpeed, dt);
    const ads = this.adsBlend;
    const aim = c.ads || home; // an item without sights has no aim pose
    const loose = 1 - 0.85 * ads;
    this.hud.setAim(player.thirdPersonVisible ? 0 : ads); // no sights to look down in third person
    this.hud.setScope(0); // a scoped item raises it in poseView
    player.aimBlend = ads;
    player.zoom = c.ads ? c.ads.fovDrop * ads : 0;

    const pose = this.pose;
    pose.x = home.x + (aim.x - home.x) * ads + (this.sway.x + Math.cos(phase) * 0.012 * bobAmp) * loose - 0.05 * this.sprintBlend;
    pose.y = home.y + (aim.y - home.y) * ads
      + (this.sway.y - Math.abs(Math.sin(phase)) * 0.016 * bobAmp + player.dip * 0.5 + breathe) * loose
      - 0.07 * this.sprintBlend;
    pose.z = home.z + (aim.z - home.z) * ads + k.z * (1 - 0.5 * ads) + 0.04 * this.sprintBlend;
    pose.rx = k.r * (1 - 0.4 * ads) - 0.15 * this.sprintBlend;
    pose.ry = 0.55 * this.sprintBlend;
    pose.rz = -0.15 * this.sprintBlend - 0.25 * this.slideBlend * (1 - ads) + this.sway.x * 2;
    pose.supportDrop = 0; // how far the off-hand dips (magazine changes, loading rounds)

    item.poseView(this, pose, dt, time, model);

    // Switching: lower and tilt away.
    if (this.switchAmount > 0) {
      pose.y -= 0.4 * this.switchAmount;
      pose.rx -= 0.6 * this.switchAmount;
    }

    // Quick melee with something in hand: a forward jab.
    if (this.swingT >= 0) {
      this.swingT += dt / 0.3;
      if (this.swingT >= 1) {
        this.swingT = -1;
      } else {
        const s = Math.sin(Math.PI * this.swingT);
        pose.z -= 0.22 * s;
        pose.x -= 0.12 * s;
        pose.ry += 0.7 * s;
        pose.rx += 0.25 * s;
      }
    }

    if (model.parts.support) model.parts.support.object.position.y = model.parts.support.baseY - pose.supportDrop;
    if (model.parts.hands) this._animateHands(model.parts.hands, dt, time, bobAmp, phase);

    this.anchor.position.set(pose.x, pose.y, pose.z);
    this.anchor.rotation.set(pose.rx, pose.ry, pose.rz);

    item.afterPose(this, model, dt, time);
    this._reachShoulders(model);

    this.flash.update(dt);
    if (this.worldLightTime > 0) {
      this.worldLightTime -= dt;
      if (this.worldLightTime <= 0) this.worldLight.intensity = 0;
    }
  }

  /**
   * Limbs: any part of a model with `userData.limb = { sleeve, band, shoulder: [x, y, z], bandDistance }` (the group at the
   * wrist) is stretched from the wrist to the shoulder point (in view space) every frame. The arm therefore never ends
   * in mid-air, whatever pose the item is in.
   */
  _reachShoulders(model) {
    model.limbs ??= collectLimbs(model.root);
    if (model.limbs.length === 0) return;
    this.anchor.updateMatrixWorld(true);
    for (const wrist of model.limbs) {
      const { sleeve, band, shoulder, bandDistance } = wrist.userData.limb;
      const target = wrist.worldToLocal(LIMB_SCRATCH.set(shoulder[0], shoulder[1], shoulder[2]));
      const length = Math.max(0.05, target.length());
      target.divideScalar(length);
      sleeve.scale.y = length;
      sleeve.quaternion.setFromUnitVectors(LIMB_UP, target);
      sleeve.position.copy(target).multiplyScalar(length / 2);
      band.quaternion.copy(sleeve.quaternion);
      band.position.copy(target).multiplyScalar(Math.min(bandDistance, length));
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
    if (this.player.thirdPersonVisible || !this.player.alive) return; // the third-person model holds it; the dead hold nothing
    renderer.clearDepth();
    renderer.render(this.vmScene, this.vmCamera);
  }
}
