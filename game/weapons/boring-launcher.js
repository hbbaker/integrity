/*
 * BORING LAUNCHER: a shoulder-mounted directional drill. It fires a spinning drill head that IMPALES whatever it hits.
 *   - A head that hits a wall or the ground stays stuck there for a while. The part sticking out is solid: jump or
 *     mantle onto it and use it as a step or a platform.
 *   - A head that hits a bot or a player skewers them and carries them along its path (3 seconds) until it meets a
 *     surface, where they take crush damage and are let go.
 *
 * Guidance: keep HOLDING the fire button after launching and move the mouse. The head slowly turns toward the point
 * your crosshair is on, so you can bend its path in mid-air; let go of the button and it flies straight on.
 *
 * TUNE IT HERE: the numbers are DRILL_TUNING below. How the heads fly and stick is in game/entities/drill-heads.js.
 *
 * Aiming (ADS) looks through the scope on top: the launcher drops out of the picture and the scope overlay comes up,
 * as on the Transit Rifle.
 *
 * Reload: the launcher is brought out in front, barrel up; the next head is lowered in from the top, a slide on the
 * gearbox is racked to prime it, and the launcher goes back on the shoulder.
 *
 * It is the one orange weapon. The glow accents still cycle through RGB.
 */

import * as THREE from 'three';
import { clamp, easeInOut } from '../../core/client/engine/math.js';
import { at, bevelBox, barrelPart, lathePart, makeGauge, sideProfile, tubePart, glowMaterial } from '../../core/client/combat/viewmodel-parts.js';
import { Weapon } from '../../core/client/combat/weapon.js';
import { DrillHeads } from '../entities/drill-heads.js';
import { MAT, makeArm, glowRing, makeHeat, rgbColor, rgbGlows } from './shared.js';

/** Height of the scope's axis above the model origin: ADS puts this on the centre of the view. */
const SCOPE_AXIS_HEIGHT = 0.21;

export const DRILL_TUNING = {
  speed: 48, // m/s a head flies
  range: 160, // metres before a head that hit nothing disappears
  hitRadius: 0.35, // metres of forgiveness when hitting a bot or player (bigger = easier)
  impactDamage: 40, // damage when a head hits a target
  crushDamage: 30, // extra damage when a skewered target is slammed into a surface
  carrySeconds: 3, // how long a skewered target rides the head at most
  guideTurnRate: 0.9, // radians a second a head can turn while you hold fire and look elsewhere (slow: about 50 degrees a second)
  guideSeconds: 5, // how long after launch a head can be steered at most
  guideReach: 80, // metres: the crosshair's target is taken from at most this far
  steerSendSeconds: 0.1, // how often other players hear about a steering head
  stickSeconds: 25, // how long a stuck head stays before it vanishes
  maxStuck: 6, // stuck heads at once (the oldest vanishes first)
  maxBoxTop: 2.4, // a stuck head higher than this off the ground is decoration only (nothing to stand on)
  // The head's shape, for sticking it in and making it solid:
  length: 1.5, // metres, tip to base
  embed: 0.45, // how far the tip goes into a surface
  baseRadius: 0.27,
  tipRadius: 0.02,
  taper: 0.15, // the cone's radius grows this much per metre from the tip
  boxStart: 0.2, // solid boxes along the exposed shaft: where the first one is (metres from the surface)
  boxStep: 0.4, // and how far apart they are
  boxPadding: 0.1, // extra width round the shaft, so the solid is a little generous
};

/** The numbers: damage, speed, ammo, recoil. (The head's own numbers are DRILL_TUNING.) */
export const config = {
  id: 'drill', name: 'BORING LAUNCHER', type: 'projectile', auto: false, damage: DRILL_TUNING.impactDamage, pellets: 1,
  interval: 1.0, mag: 1, reserve: 4, maxReserve: 8, reloadTime: 3.0, range: DRILL_TUNING.range,
  camKick: 0.06, camYaw: 0.01, climb: 0.01, kickZ: 0.09, kickRot: 0.2, flashSize: 0.6, worldLight: 40, heat: 14, tracerColor: 0xff7a1a,
  scope: true, adsSpeed: 12, // aiming looks through the scope; the launcher is heavy, so the sights come up slowly
  ads: { x: 0, y: -SCOPE_AXIS_HEIGHT, z: -0.4, fovDrop: 28 }, // the scope's axis sits on the view centre
};

const SCOPED_AT = 0.9; // the launcher is out of the picture (only the scope overlay shows) once the aim is this far up
const GUIDE_ARRIVED = 3; // metres: a head this close to the crosshair's target stops turning
const round = (vector, scale) => [vector.x, vector.y, vector.z].map((value) => Math.round(value * scale) / scale);
const MUZZLE_AIM_DISTANCE = 60; // the head leaves the muzzle aimed at what the crosshair is over, up to this far away
const MUZZLE_OFFSET = { forward: 0.7, right: 0.22, up: -0.2 }; // from the eye, when the first-person muzzle is not used

/* ------------------------------ the drill head ------------------------------ */

const HEAD_LENGTH = DRILL_TUNING.length;
// The head's outline from its base (distance 0) to its tip, as [radius, distance]: a collar, a step, then a long cone.
const HEAD_PROFILE = [[0.0, 0], [0.25, 0], [0.27, 0.03], [0.27, 0.2], [0.22, 0.22], [0.22, 0.3], [0.2, 0.32], [0.14, 0.75], [0.085, 1.15], [0.03, 1.45], [0.0, HEAD_LENGTH]];
const FLIGHT_COUNT = 2; // the spiral ridges that carry the cuttings back
const FLIGHT_TURNS = 5;
const TEETH = 6;

/**
 * The drill head: a hardened cone with spiral flights and carbide teeth on an orange collar with a glowing ring.
 * Its origin is the tip and its body runs back along +Z. `spinner` is the part that turns about that axis.
 */
export function buildDrillHead() {
  const root = new THREE.Group();
  const spinner = new THREE.Group();
  const ring = glowMaterial(0xffffff, 2);
  spinner.add(
    at(lathePart(HEAD_PROFILE, MAT.steel, 28), 0, 0, HEAD_LENGTH),
    at(lathePart([[0.272, 0.03], [0.272, 0.2]], MAT.orange, 28), 0, 0, HEAD_LENGTH), // the orange collar
    at(lathePart([[0.2705, 0.21], [0.2705, 0.225]], ring, 28), 0, 0, HEAD_LENGTH), // glowing ring
  );
  const coneRadius = (distance) => {
    for (let i = 1; i < HEAD_PROFILE.length; i++) {
      const [r1, d1] = HEAD_PROFILE[i];
      const [r0, d0] = HEAD_PROFILE[i - 1];
      if (distance <= d1) return r0 + ((r1 - r0) * (distance - d0)) / (d1 - d0 || 1);
    }
    return 0;
  };
  for (let flight = 0; flight < FLIGHT_COUNT; flight++) {
    const points = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const distance = 0.35 + t * 1.05;
      const angle = (flight / FLIGHT_COUNT) * Math.PI * 2 + t * Math.PI * 2 * FLIGHT_TURNS;
      const radius = coneRadius(distance) + 0.012;
      points.push([Math.cos(angle) * radius, Math.sin(angle) * radius, HEAD_LENGTH - distance]);
    }
    spinner.add(tubePart(points, 0.02, MAT.steel, 80));
  }
  for (let i = 0; i < TEETH; i++) { // carbide teeth round the cone
    const angle = (i / TEETH) * Math.PI * 2;
    const tooth = bevelBox(0.04, 0.05, 0.12, MAT.gunmetal, 0.008);
    const radius = coneRadius(0.95);
    tooth.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, HEAD_LENGTH - 0.95);
    tooth.rotation.z = angle - Math.PI / 2;
    spinner.add(tooth);
  }
  root.add(spinner);
  return {
    root, spinner,
    animate(dt, time) {
      ring.emissive.copy(rgbColor(0, time));
    },
  };
}

/* --------------------------------- the weapon --------------------------------- */

export class BoringLauncher extends Weapon {
  get aimable() { return true; }

  onAttach(holder) {
    this.heads = new DrillHeads(holder, DRILL_TUNING, buildDrillHead);
    this.holdingFire = false;
    this.heads.onSteer = (drill) => holder.sendItemMessage({ t: 'ds', i: drill.id, f: round(drill.pos, 100), d: round(drill.dir, 1000) });
  }

  /** The player put the launcher away: no more steering. */
  cease() {
    this.holdingFire = false;
  }

  /** A new level or a respawn: every head goes. */
  reset() {
    super.reset();
    this.heads?.clear();
  }

  /** Heads keep flying (and stay stuck) whatever the player holds. */
  backgroundTick(holder, dt) {
    this.heads.update(dt);
  }

  /** Another player fired theirs: fly the same head here so it sticks in the same place. */
  onPeerMessage(holder, from, message) {
    if (message.t === 'dr') this.heads.receive(from, message);
    else if (message.t === 'ds') this.heads.steer(from, message);
  }

  pull(holder, dt, input) {
    this.holdingFire = Boolean(input.fireHeld);
    this._fireIfWanted(holder, input);
  }

  tryFire(holder) {
    if (this.reloading) {
      holder.triggerBuffer = 0;
      return;
    }
    if (this.mag <= 0) {
      holder.triggerBuffer = 0;
      if (this.reserve > 0) {
        this.startReload(holder);
      } else {
        holder.audio.dry();
        holder.cooldown = 0.3;
      }
      return;
    }
    this._fire(holder);
  }

  _fire(holder) {
    const c = this.cfg;
    const { player, world } = holder;
    this.mag -= 1;
    holder.cooldown = c.interval;
    holder.triggerBuffer = 0;
    holder.heat = Math.min(holder.cfg.maxHeat, holder.heat + c.heat);
    player.getAim(holder._origin, holder._fwd, holder._right, holder._up);
    player.addRecoil(c.camKick, (Math.random() - 0.5) * 2 * c.camYaw, c.climb);
    holder.kick.vz += c.kickZ * 60;
    holder.kick.vr += c.kickRot * 60;
    holder.flashFire(c.flashSize, 6);
    holder.audio.shoot(c.id);
    holder.worldLight.position.copy(holder._origin).addScaledVector(holder._fwd, 1.5);
    holder.worldLight.intensity = c.worldLight;
    holder.worldLightTime = 0.05;

    const start = holder._from;
    if (holder.tp && player.thirdPersonVisible) {
      holder.tp.muzzleWorld(start);
    } else {
      start.copy(holder._origin)
        .addScaledVector(holder._fwd, MUZZLE_OFFSET.forward)
        .addScaledVector(holder._right, MUZZLE_OFFSET.right)
        .addScaledVector(holder._up, MUZZLE_OFFSET.up);
    }
    const aimDistance = Math.min(world.raycast(holder._origin, holder._fwd, MUZZLE_AIM_DISTANCE), MUZZLE_AIM_DISTANCE);
    holder._to.copy(holder._origin).addScaledVector(holder._fwd, Math.max(aimDistance, 2));
    holder._dir.subVectors(holder._to, start).normalize();
    const drill = this.heads.launch(start, holder._dir, { guide: (position, out) => this._guideAim(holder, position, out) });
    holder.sendItemMessage({ t: 'dr', i: drill.id, f: round(start, 100), d: round(holder._dir, 1000) });
  }

  /**
   * Where a steered head should head while the fire button is held: toward the point the crosshair is on. Returns
   * null once the button is released (or the player is gone), and a zero vector when the head is already there.
   */
  _guideAim(holder, position, out) {
    if (!this.holdingFire || !holder.player.alive) return null;
    const { player, world } = holder;
    player.getAim(holder._origin, holder._fwd, holder._right, holder._up);
    const reach = Math.min(world.raycast(holder._origin, holder._fwd, DRILL_TUNING.guideReach), DRILL_TUNING.guideReach);
    out.copy(holder._origin).addScaledVector(holder._fwd, reach).sub(position);
    return out.lengthSq() < GUIDE_ARRIVED * GUIDE_ARRIVED ? out.set(0, 0, 0) : out;
  }

  /* -------------------------------- reload pose ------------------------------- */

  /** 0 to 1 through the reload, 0 when not reloading. */
  get reloadProgress() {
    return this.reloading ? clamp(1 - this.reloadTimer / this.cfg.reloadTime, 0, 1) : 0;
  }

  /**
   * The launcher comes off the shoulder and stands in front of you, barrel up, for the reload. While aiming it
   * disappears behind the scope overlay.
   */
  poseView(holder, pose, dt, time, model) {
    const lift = easeInOut(reloadLift(this.reloadProgress));
    pose.x += RELOAD_POSE.x * lift;
    pose.y += RELOAD_POSE.y * lift;
    pose.z += RELOAD_POSE.z * lift;
    pose.rx += RELOAD_POSE.rx * lift;
    pose.rz += RELOAD_POSE.rz * lift;
    pose.supportDrop = 0; // the off hand is animated by the model during the reload

    const { player, hud } = holder;
    const scoped = !player.thirdPersonVisible && holder.adsBlend > SCOPED_AT;
    model.root.visible = !scoped;
    hud.setScope(player.thirdPersonVisible ? 0 : holder.adsBlend);
  }

  modelState(holder) {
    return { ...super.modelState(holder), reloadProgress: this.reloadProgress };
  }

  describe() {
    return { dps: DRILL_TUNING.impactDamage / this.cfg.interval, range: this.cfg.range, capacity: '1 drill head' };
  }
}

/* The reload, as fractions of its time. */
const RAISE_END = 0.18; // the launcher swings up in front
const LOAD_START = 0.18; // the head is lowered in from the top
const LOAD_END = 0.5;
const SLIDE_START = 0.62; // the slide is pulled back...
const SLIDE_BACK = 0.7;
const SLIDE_SNAP = 0.73; // ...and let go: it snaps forward
const LOWER_START = 0.78; // the launcher goes back on the shoulder
const HAND_ON_HEAD = [0.14, 0.2, 0.46, 0.54]; // the off hand reaches for the head, holds it, lets go
const HAND_ON_SLIDE = [0.54, 0.62, 0.78, 0.84];

/** How far the launcher is off the shoulder (0 to 1) at reload progress `p`. */
function reloadLift(p) {
  if (p <= 0) return 0;
  if (p < RAISE_END) return p / RAISE_END;
  if (p < LOWER_START) return 1;
  return 1 - (p - LOWER_START) / (1 - LOWER_START);
}

/** Added to the resting pose at full lift: forward and down so the muzzle is in view at the top, standing upright. */
const RELOAD_POSE = { x: -0.2, y: -0.5, z: -0.2, rx: 1.45, rz: 0.12 };

const ramp = (p, from, to) => clamp((p - from) / (to - from), 0, 1);
/** 0 before `a`, up to 1 by `b`, holds, back to 0 between `c` and `d`. */
const inWindow = (p, [a, b, c, d]) => ramp(p, a, b) - ramp(p, c, d);
const mix = (from, to, amount) => from + (to - from) * amount;

/* ----------------------------------- the model ----------------------------------- */

// Side outlines in [z, y] (forward is -z).
const GEARBOX = [[0.24, 0.07], [0.16, 0.135], [-0.1, 0.135], [-0.18, 0.07]];
const SLIDE_BLOCK = [[0.07, 0.14], [-0.02, 0.14], [-0.02, 0.172], [0.07, 0.172]];
const PISTOL_GRIP = [[0.06, -0.08], [0.13, -0.08], [0.155, -0.2], [0.09, -0.2]];
const FOREGRIP = [[-0.2, -0.08], [-0.14, -0.08], [-0.145, -0.2], [-0.195, -0.2]];
const SIDE_PLATE = [[0.2, 0.03], [-0.42, 0.03], [-0.42, -0.04], [0.2, -0.04]];
const ROD_LENGTH = 0.55;
const LOADED_HEAD_SCALE = 0.32; // the head in the tube, smaller than the one that flies
const LOADED_TIP_Z = -1.04; // where its tip is when it is seated
const HEAD_DROP_DISTANCE = 0.95; // how far above its seat the head starts when it is lowered in
const REST_SLIDE_Z = 0;
const SLIDE_TRAVEL = 0.14;

const SCOPE_Z = { rear: 0.3, front: -0.2 }; // the scope tube runs from the eyepiece to the objective

/**
 * The scope on top: a tube on two mounts (one in front of the racking slide's path, one behind it), an objective bell,
 * lenses and a glowing strip. Its axis is SCOPE_AXIS_HEIGHT above the model origin, which is what ADS centres.
 */
function buildScope() {
  const lens = new THREE.MeshStandardMaterial({ color: 0x2a6bff, metalness: 0.3, roughness: 0.05, emissive: 0x0a2a88, emissiveIntensity: 0.6 });
  const rail = glowMaterial(0xffffff, 1.2);
  const group = new THREE.Group();
  const length = SCOPE_Z.rear - SCOPE_Z.front;
  group.add(
    at(lathePart([[0.03, 0], [0.03, length]], MAT.gunmetal, 24), 0, SCOPE_AXIS_HEIGHT, SCOPE_Z.rear), // main tube
    at(lathePart([[0.03, 0], [0.04, 0.02], [0.04, 0.1], [0.034, 0.1]], MAT.gunmetal, 24), 0, SCOPE_AXIS_HEIGHT, SCOPE_Z.front + 0.1), // objective bell
    at(lathePart([[0.036, 0], [0.03, 0.03]], MAT.gunmetal, 24), 0, SCOPE_AXIS_HEIGHT, SCOPE_Z.rear), // eyepiece flare
    at(barrelPart(0.034, 0.02, lens), 0, SCOPE_AXIS_HEIGHT, SCOPE_Z.front - 0.0),
    at(barrelPart(0.026, 0.02, lens), 0, SCOPE_AXIS_HEIGHT, SCOPE_Z.rear),
    at(lathePart([[0.011, 0], [0.011, 0.02], [0.013, 0.02], [0.013, 0.026]], MAT.steel, 14), 0, SCOPE_AXIS_HEIGHT + 0.03, 0.1), // elevation turret
    at(bevelBox(0.02, 0.045, 0.04, MAT.steel, 0.005), 0, 0.165, -0.12), // front mount
    at(bevelBox(0.02, 0.045, 0.04, MAT.steel, 0.005), 0, 0.165, 0.26), // rear mount
    at(new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.004, 0.36), rail), 0, SCOPE_AXIS_HEIGHT + 0.033, 0.06), // glowing strip along the top
  );
  group.children[5].rotation.x = Math.PI / 2; // the turret points up
  return { group, lens, rail };
}

function buildLauncher() {
  const root = new THREE.Group();
  const loaded = buildDrillHead();
  loaded.root.scale.setScalar(LOADED_HEAD_SCALE);
  loaded.root.position.z = LOADED_TIP_Z;

  const slide = at(sideProfile(SLIDE_BLOCK, 0.05, MAT.gunmetal, 0.006), 0, 0, REST_SLIDE_Z);
  slide.add(at(bevelBox(0.05, 0.012, 0.03, MAT.orange, 0.003), 0, 0.0, 0.025)); // a handle bar across the slide

  const rightArm = at(makeArm(1, -Math.PI / 2, [0.25, -0.5, 1]), 0.045, -0.15, 0.1);
  const leftArm = at(makeArm(-1, Math.PI / 2, [-0.25, -0.5, 1]), -0.04, -0.15, -0.18);
  const leftBase = leftArm.position.clone();

  const rods = []; // a cassette of drill rods on the left side
  for (const [x, y] of [[-0.13, 0.015], [-0.13, -0.015], [-0.155, 0.015], [-0.155, -0.015]]) {
    rods.push(at(lathePart([[0.012, 0], [0.012, ROD_LENGTH]], MAT.steel, 12), x, y, 0.14));
  }
  const heat = glowRing(0.102, -0.55, 0, 0.012);
  const stripe = glowMaterial(0xffffff, 1.5);
  const gauge = makeGauge(4, { pitch: 0.03, size: [0.004, 0.014, 0.02], color: (time) => rgbColor(0.5, time) });
  gauge.group.position.set(0.0475, 0.1, 0.15);
  const scope = buildScope();
  const glows = rgbGlows([[heat.material, 0], [stripe, 0.4], [scope.rail, 0.7]]);
  const hose = (side, points) => tubePart(points.map(([x, y, z]) => [x * side, y, z]), 0.011, MAT.rubber, 28);
  const guard = tubePart([[0, -0.08, 0.04], [0, -0.115, 0.05], [0, -0.125, 0.085], [0, -0.115, 0.115], [0, -0.08, 0.125]], 0.0045, MAT.gunmetal);

  root.add(
    at(lathePart([[0.08, 0], [0.085, 0.02], [0.085, 0.3], [0.092, 0.32], [0.092, 0.34], [0.085, 0.36], [0.085, 0.8], [0.1, 0.82], [0.1, 0.86]], MAT.orange, 36), 0, 0, 0.3), // the launch tube
    at(lathePart([[0, 0], [0.105, 0], [0.105, 0.03], [0, 0.03]], MAT.rubber, 24), 0, 0, 0.345), // shoulder pad
    heat.ring,
    at(sideProfile(GEARBOX, 0.09, MAT.gunmetal, 0.012), 0, 0, 0), // the drive: the rotary gearbox
    at(bevelBox(0.094, 0.01, 0.2, MAT.orange, 0.003), 0, 0.085, 0.0), // an orange band over it
    at(bevelBox(0.016, 0.014, 0.34, MAT.steel, 0.003), 0, 0.14, 0.04), // the rail the slide rides on
    slide,
    at(sideProfile(SIDE_PLATE, 0.01, MAT.alloy, 0.006), -0.1, 0.005, 0), // the rod cassette plate
    ...rods,
    at(bevelBox(0.0016, 0.006, 0.3, stripe), 0.0455, 0.1, -0.02), // glow inlay on the gearbox
    hose(1, [[0.05, 0.1, -0.1], [0.12, 0.1, -0.2], [0.11, 0.04, -0.3], [0.09, 0.0, -0.4]]), // hydraulic hoses
    hose(-1, [[0.05, 0.1, -0.1], [0.12, 0.1, -0.2], [0.11, 0.04, -0.3], [0.09, 0.0, -0.4]]),
    at(sideProfile(PISTOL_GRIP, 0.05, MAT.grip, 0.008), 0, 0, 0),
    at(sideProfile(FOREGRIP, 0.05, MAT.grip, 0.008), 0, 0, 0),
    guard,
    at(bevelBox(0.008, 0.026, 0.01, MAT.steel, 0.003), 0, -0.1, 0.09), // trigger
    scope.group,
    gauge.group,
    loaded.root,
    rightArm,
    leftArm,
  );
  const muzzle = at(new THREE.Object3D(), 0, 0, -0.6);
  root.add(muzzle);
  const cool = makeHeat();

  const seatHandHead = new THREE.Vector3();
  const slideHand = new THREE.Vector3();
  return {
    root, muzzle, home: { x: 0.24, y: -0.13, z: -0.3 },
    parts: { support: { object: leftArm, baseY: leftArm.position.y } },
    animate(dt, time, state) {
      glows(time);
      gauge.update(state.ammo, time);
      const hot = cool(dt, state.pulse);
      heat.material.emissiveIntensity = 0.4 + hot * 7;
      scope.lens.emissiveIntensity = 0.6 + state.aiming * 1.8 + Math.sin(time * 2) * 0.1;
      scope.rail.emissiveIntensity = 0.8 + state.aiming * 2 + Math.sin(time * 4) * 0.3;

      const p = state.reloadProgress;
      const reloading = state.reloading;
      // The head: gone after a shot, lowered in from the top during the reload, seated when loaded.
      loaded.root.visible = state.rounds > 0 || (reloading && p > LOAD_START);
      const lowered = reloading ? easeInOut(ramp(p, LOAD_START, LOAD_END)) : 1;
      loaded.root.position.z = LOADED_TIP_Z - (1 - lowered) * HEAD_DROP_DISTANCE;
      loaded.spinner.rotation.z += dt * (2 + hot * 12);
      loaded.animate(dt, time);

      // The slide: pulled back, then snapped forward.
      const rack = reloading ? ramp(p, SLIDE_START, SLIDE_BACK) * (1 - ramp(p, SLIDE_BACK, SLIDE_SNAP)) : 0;
      slide.position.z = REST_SLIDE_Z + SLIDE_TRAVEL * rack;

      // The off hand: on the foregrip, then on the head as it goes in, then on the slide, then back on the foregrip.
      seatHandHead.set(-0.07, 0.02, loaded.root.position.z + 0.2);
      slideHand.set(-0.05, 0.17, slide.position.z + 0.03);
      const onHead = reloading ? inWindow(p, HAND_ON_HEAD) : 0;
      const onSlide = reloading ? inWindow(p, HAND_ON_SLIDE) : 0;
      const hand = leftArm.position;
      hand.set(
        mix(mix(leftBase.x, seatHandHead.x, onHead), slideHand.x, onSlide),
        mix(mix(leftBase.y, seatHandHead.y, onHead), slideHand.y, onSlide),
        mix(mix(leftBase.z, seatHandHead.z, onHead), slideHand.z, onSlide),
      );
    },
  };
}

export const weapon = {
  config,
  holdable: { type: 'projectile', class: BoringLauncher },
  model: { build: buildLauncher },
};
