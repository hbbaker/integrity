import * as THREE from 'three';
import { Cyborg } from '../assets/cyborg.js';
import { RemoteSuit } from './remote-suit.js';
import { decodeSuit } from '../suit/suit-network.js';
import { raySphere } from './enemies.js';
import { damp, lerp } from '../../core/client/engine/math.js';

/*
 * The other players in a multiplayer match.
 *
 * Each remote player is a Cyborg (the same third-person body the local player
 * uses: the Y Bot, or the mech suit while they wear one) fed by network snapshots
 * instead of by a Player / Weapons pair. A small
 * adapter (RemoteView) exposes the fields Cyborg reads. Snapshots are buffered
 * and sampled slightly in the past, so motion stays smooth between the ~20 Hz
 * updates.
 *
 * RemotePlayers also answers the shooting questions (raycast, melee pick) with
 * the same return shapes as Enemies, so Weapons can treat both alike.
 */

const SNAPSHOT_LIMIT = 40;

// Hit volumes in metres above a player's feet. Head hits are crits.
const HEAD = { y: 1.62, r: 0.28 };
const TORSO = { y: 1.15, r: 0.44 };
const LEGS = { y: 0.55, r: 0.4 };
const SLIDE_DROP = 0.6; // sliding players are lower
const CROUCH_DROP = { head: 0.55, torso: 0.4, legs: 0.15 }; // crouched players sink by these amounts
const LEAN_REACH = 0.45; // metres the head moves sideways at a full lean (matches the local player)
const LEAN_SPEED = 12;

const NO_DROP = { head: 0, torso: 0, legs: 0 };
const BODY_CENTER_Y = 1.1;
const MELEE_RADIUS = 0.45;

const SHOT_COOLDOWN = 0.25; // how long a remote player keeps its gun raised after a shot
const KICK_Z = 0.05;
const KICK_R = 0.12;
const KICK_DECAY = 14; // per second
const MELEE_SPEED = 3; // swing progress per second
const BEAM_TRACER_INTERVAL = 0.06;
const BEAM_TRACER_RANGE = 90;

const NAME_TAG_HEIGHT = 2.1; // above a human; it grows with the avatar, so it stays above a suit
const NAME_TAG_SCALE = 0.42; // sprite height in metres; width follows the text


function lerpAngle(a, b, t) {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
}

/** What the Cyborg reads from "player" and "weapons", filled from snapshots. */
class RemoteView {
  constructor(weaponsRef) {
    const list = weaponsRef.cfg.list;
    this.player = {
      pos: new THREE.Vector3(), prevPos: new THREE.Vector3(), vel: new THREE.Vector3(), speed: 0,
      yaw: 0, pitch: 0, kickPitch: 0,
      grounded: true, sliding: false, sprinting: false, crouching: false, lean: 0, alive: true, thirdPersonVisible: true,
    };
    this.weapons = {
      cfg: weaponsRef.cfg,
      slots: weaponsRef.slots,
      models: list.map(() => ({ parts: {} })), // no first-person parts to mirror
      index: 0, adsBlend: 0, cooldown: 0, beamOn: false, reloading: false, reloadTimer: 0,
      kick: { z: 0, r: 0 }, switchAmount: 0, swingT: -1, punchT: [-1, -1],
      get current() {
        return { cfg: list[this.index] };
      },
    };
  }
}

/** A canvas text sprite that floats above a player's head. */
function createNameTag(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'italic 900 40px Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 9;
  ctx.strokeStyle = '#000';
  ctx.strokeText(name, 128, 34);
  ctx.fillStyle = '#ffd800';
  ctx.fillText(name, 128, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(NAME_TAG_SCALE * 4, NAME_TAG_SCALE, 1);
  sprite.position.y = NAME_TAG_HEIGHT;
  sprite.renderOrder = 15;
  return sprite;
}

class RemotePlayer {
  constructor(id, name, { scene, weapons, world, suitConfig, skinLoader }) {
    this.id = id;
    this.name = name;
    this.isRemote = true; // Targets uses this to route damage to the network
    this.def = { scale: 1 }; // Weapons reads def.scale on melee targets
    this.crouch = 0;
    this.pos = new THREE.Vector3();
    this.hp = 100;
    this.alive = true;
    this.hasState = false;
    this.snapshots = [];
    this.reloadStarted = 0;
    this.beamTimer = 0;
    this.targetAim = 0;
    this.targetLean = 0;
    this.firing = false;
    this.nextHand = 0;
    this.placed = false;

    this.view = new RemoteView(weapons);
    this.cyborg = new Cyborg({ scene, player: this.view.player, weapons: this.view.weapons, flashLight: false, rigged: true, skinLoader });
    this.cyborg.group.add(createNameTag(name));
    this.cyborg.group.visible = false;
    this.suit = suitConfig ? new RemoteSuit({ scene, world, config: suitConfig, cyborg: this.cyborg, view: this.view.player, skinLoader }) : null;
  }

  /** How much bigger than a human the avatar is (a mech suit makes it bigger, and its hit volumes with it). */
  get scale() {
    return this.suit?.scale ?? 1;
  }

  /** Store a received state message (positions in metres, angles in radians). */
  push(message, now) {
    const snapshots = this.snapshots;
    snapshots.push({
      time: now, x: message.x, y: message.y, z: message.z, yaw: message.yw, pitch: message.pt,
      vx: message.vx, vz: message.vz,
    });
    if (snapshots.length > SNAPSHOT_LIMIT) snapshots.shift();

    const { player, weapons } = this.view;
    player.grounded = !!message.g;
    player.sliding = !!message.sl;
    player.sprinting = !!message.sp;
    player.crouching = !!message.cr;
    this.targetLean = Math.max(-1, Math.min(1, Number(message.ln) || 0));
    player.alive = !!message.al;
    this.alive = player.alive;
    this.hp = message.hp;
    this.targetAim = message.a;
    this.firing = !!message.f;
    if (message.w !== weapons.index && weapons.cfg.list[message.w]) weapons.index = message.w;
    if (message.r && !weapons.reloading) this.reloadStarted = now;
    weapons.reloading = !!message.r;
    this.suit?.apply(decodeSuit(message));
    this.hasState = true;
  }

  /** Move the avatar to where the player was `renderTime` seconds on the local clock. */
  _sample(renderTime) {
    const snapshots = this.snapshots;
    const first = snapshots[0];
    let from = first;
    let to = first;
    for (let i = snapshots.length - 1; i >= 0; i--) {
      if (snapshots[i].time <= renderTime) {
        from = snapshots[i];
        to = snapshots[i + 1] ?? snapshots[i];
        break;
      }
    }
    const span = to.time - from.time;
    const t = span > 0 ? Math.min(1, Math.max(0, (renderTime - from.time) / span)) : 0;
    const { player } = this.view;
    player.prevPos.copy(player.pos);
    player.pos.set(lerp(from.x, to.x, t), lerp(from.y, to.y, t), lerp(from.z, to.z, t));
    if (!this.placed) { // first sample: appear in place instead of sliding in from the origin
      player.prevPos.copy(player.pos);
      this.placed = true;
    }
    player.yaw = lerpAngle(from.yaw, to.yaw, t);
    player.pitch = lerp(from.pitch, to.pitch, t);
    player.vel.set(lerp(from.vx, to.vx, t), 0, lerp(from.vz, to.vz, t));
    player.speed = Math.hypot(player.vel.x, player.vel.z);
    this.pos.copy(player.pos);
  }

  update(dt, time, now, renderDelay) {
    if (!this.hasState) return;
    this._sample(now - renderDelay);

    const weapons = this.view.weapons;
    const cfg = weapons.current.cfg;
    weapons.adsBlend = damp(weapons.adsBlend, this.targetAim, 14, dt);
    this.view.player.lean = damp(this.view.player.lean, this.targetLean, LEAN_SPEED, dt);
    weapons.beamOn = !!(this.firing && cfg.beam);
    weapons.cooldown = Math.max(0, weapons.cooldown - dt);
    weapons.reloadTimer = Math.max(0, (cfg.reloadTime ?? 1) - (now - this.reloadStarted));
    const kick = weapons.kick;
    kick.z = damp(kick.z, 0, KICK_DECAY, dt);
    kick.r = damp(kick.r, 0, KICK_DECAY, dt);
    this._advanceMelee(dt);

    this.suit?.update(dt);
    this.cyborg.update(dt, 1, time);
    this.suit?.animate();
    if (cfg.beam) {
      this.cyborg.animateGun(weapons.index, dt, time, { firing: weapons.beamOn, energy: 1, power: 1, reloading: weapons.reloading });
    }
  }

  _advanceMelee(dt) {
    const weapons = this.view.weapons;
    if (weapons.swingT >= 0) weapons.swingT = weapons.swingT + dt * MELEE_SPEED >= 1 ? -1 : weapons.swingT + dt * MELEE_SPEED;
    for (let i = 0; i < 2; i++) {
      const t = weapons.punchT[i];
      if (t >= 0) weapons.punchT[i] = t + dt * MELEE_SPEED >= 1 ? -1 : t + dt * MELEE_SPEED;
    }
  }

  /** A shot was fired: raise the gun, kick, and flash. */
  onShot(flashSize) {
    const weapons = this.view.weapons;
    weapons.cooldown = SHOT_COOLDOWN;
    weapons.kick.z = KICK_Z;
    weapons.kick.r = KICK_R;
    this.cyborg.flash.fire(flashSize, 0);
  }

  onMelee(fists) {
    const weapons = this.view.weapons;
    if (fists) {
      this.nextHand = 1 - this.nextHand; // alternate hands
      weapons.punchT[this.nextHand] = 0;
    } else {
      weapons.swingT = 0;
    }
  }

  dispose(scene) {
    this.suit?.dispose();
    scene.remove(this.cyborg.group);
    this.cyborg.group.traverse((object) => {
      if (object.material?.map) object.material.map.dispose();
    });
  }
}

export class RemotePlayers {
  /**
   * @param options { scene, fx, world, weapons, audio, config, suitConfig, skinLoader } config = CONFIG.multiplayer;
   *   suitConfig = CONFIG.suit (without it other players' mech suits are not shown); skinLoader replaces the human model loader (tests)
   */
  constructor({ scene, fx, world, weapons, audio, config, suitConfig = null, skinLoader }) {
    this.scene = scene;
    this.fx = fx;
    this.world = world;
    this.weapons = weapons;
    this.audio = audio;
    this.config = config;
    this.suitConfig = suitConfig;
    this.skinLoader = skinLoader; // left undefined, the real model loader is used
    this.byId = new Map();
    this.list = []; // same players as byId, for fast loops
    this.hit = { enemy: null, t: 0, crit: false };
    this.onDamage = null; // (player, amount, options) => void, set by main.js to send the hit
    this.onPull = null; // (player, options | null) => void, set by the deathmatch rules: drag (or let go of) a player
    this._tmp = new THREE.Vector3();
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this.listener = null; // camera: sounds fade with distance from it
  }

  /** Match the avatars to the server roster (everyone joined except me). */
  sync(roster, myId) {
    const wanted = new Map(roster.filter((player) => player.id !== myId).map((player) => [player.id, player.name]));
    for (const [id, remote] of this.byId) {
      if (!wanted.has(id)) {
        remote.dispose(this.scene);
        this.byId.delete(id);
      }
    }
    for (const [id, name] of wanted) {
      if (!this.byId.has(id)) this.byId.set(id, new RemotePlayer(id, name, { scene: this.scene, weapons: this.weapons, world: this.world, suitConfig: this.suitConfig, skinLoader: this.skinLoader }));
    }
    this.list = [...this.byId.values()];
  }

  clear() {
    for (const remote of this.byId.values()) remote.dispose(this.scene);
    this.byId.clear();
    this.list = [];
  }

  /** A message from another player. `now` is the local clock in seconds. */
  receive(fromId, message, now) {
    const remote = this.byId.get(fromId);
    if (!remote) return;
    switch (message.t) {
      case 's':
        remote.push(message, now);
        break;
      case 'sh':
        this._onShot(remote, message);
        break;
      case 'ml':
        remote.onMelee(!!message.fists);
        break;
      default:
        break;
    }
  }

  update(dt, time, now) {
    for (const remote of this.list) remote.update(dt, time, now, this.config.renderDelay);
    this._beamTracers(dt);
  }

  /** Remote raygun beams draw as a stream of short glowing tracers along the aim line. */
  _beamTracers(dt) {
    for (const remote of this.list) {
      const weapons = remote.view.weapons;
      if (!weapons.beamOn || !remote.alive) continue;
      remote.beamTimer -= dt;
      if (remote.beamTimer > 0) continue;
      remote.beamTimer = BEAM_TRACER_INTERVAL;
      const player = remote.view.player;
      const cosPitch = Math.cos(player.pitch);
      this._dir.set(-Math.sin(player.yaw) * cosPitch, Math.sin(player.pitch), -Math.cos(player.yaw) * cosPitch);
      remote.cyborg.muzzleWorld(this._from);
      const reach = Math.min(BEAM_TRACER_RANGE, this.world.raycast(this._from, this._dir, BEAM_TRACER_RANGE));
      this._to.copy(this._from).addScaledVector(this._dir, reach);
      const tint = weapons.current.cfg.flashTint ?? 0x55ffb0;
      this.fx.tracers.spawn(this._from, this._to, tint, 120, 0.07);
    }
  }

  _onShot(remote, message) {
    const cfg = this.weapons.cfg.list[message.w];
    if (!cfg || !message.f) return;
    remote.onShot(cfg.flashSize ?? 0.3);
    this._from.set(message.f[0], message.f[1], message.f[2]);
    for (const end of message.e ?? []) {
      this._to.set(end[0], end[1], end[2]);
      this.fx.tracers.spawn(this._from, this._to, cfg.tracerColor);
    }
    if (this.listener) this.audio.shootAt(cfg.id, this._from.distanceTo(this.listener.position));
  }

  /* --------------------------- shooting queries --------------------------- */

  _isTarget(remote) {
    return remote.alive && remote.hp > 0 && remote.hasState && !remote.suit?.busy; // nothing hurts a player who is stepping into or out of a suit
  }

  /** Nearest remote player along a ray (head / torso / legs spheres). Same shape as Enemies.raycast. */
  raycast(origin, dir, maxT, radius = 0, boost = 0, skip = null) {
    let bestT = maxT;
    let best = null;
    let bestCrit = false;
    for (const remote of this.list) {
      if (!this._isTarget(remote) || (skip && skip.has(remote))) continue;
      const { x, y, z } = remote.pos;
      const view = remote.view.player;
      const size = remote.scale; // a player in a mech suit is bigger all over
      const slide = view.sliding ? SLIDE_DROP * size : 0;
      const crouch = view.crouching && !slide ? CROUCH_DROP : NO_DROP;
      // A leaning player's head and chest move sideways: that is what peeking round a corner shows.
      const leanX = Math.cos(view.yaw) * view.lean * LEAN_REACH * size;
      const leanZ = -Math.sin(view.yaw) * view.lean * LEAN_REACH * size;
      const th = raySphere(origin, dir, x + leanX, y + (HEAD.y - crouch.head) * size - slide, z + leanZ, HEAD.r * size + radius, boost);
      const tt = raySphere(origin, dir, x + leanX * 0.5, y + (TORSO.y - crouch.torso) * size - slide, z + leanZ * 0.5, TORSO.r * size + radius, boost);
      const tl = raySphere(origin, dir, x, y + (LEGS.y - crouch.legs) * size - slide * 0.5, z, LEGS.r * size + radius, boost);
      let tb = -1;
      if (tt >= 0) tb = tt;
      if (tl >= 0 && (tb < 0 || tl < tb)) tb = tl;
      if (tb < 0 && th < 0) continue;
      const crit = th >= 0 && (tb < 0 || th <= tb + 0.15);
      const t = crit ? th : tb;
      if (t < bestT) {
        bestT = t;
        best = remote;
        bestCrit = crit;
      }
    }
    if (!best) return null;
    this.hit.enemy = best;
    this.hit.t = bestT;
    this.hit.crit = bestCrit;
    return this.hit;
  }

  bodyCenter(remote, out) {
    return out.set(remote.pos.x, remote.pos.y + BODY_CENTER_Y * remote.scale, remote.pos.z);
  }

  /** Forgiving melee pick: nearest remote player in range and inside the cone. */
  meleeTarget(origin, forward, range, minCos) {
    let best = null;
    let bestScore = Infinity;
    for (const remote of this.list) {
      if (!this._isTarget(remote)) continue;
      const c = this.bodyCenter(remote, this._tmp);
      const tx = c.x - origin.x;
      const ty = c.y - origin.y;
      const tz = c.z - origin.z;
      const d = Math.hypot(tx, ty, tz);
      if (d - MELEE_RADIUS * remote.scale > range) continue;
      const cos = (tx * forward.x + ty * forward.y + tz * forward.z) / (d || 1);
      if (cos < minCos && d > MELEE_RADIUS * remote.scale + 0.3) continue;
      const score = d * (2 - cos);
      if (score < bestScore) {
        bestScore = score;
        best = remote;
      }
    }
    return best;
  }

  /**
   * Damage a remote player: predict the result locally (so hitmarkers and kill sounds
   * feel instant) and let main.js send the hit. The victim's next state message
   * corrects the prediction. Returns true when this hit is predicted to kill.
   */
  /** Ask a remote player to pull themselves toward you. Their game moves them; nothing changes here. */
  pull(remote, options) {
    if (this._isTarget(remote) && this.onPull) this.onPull(remote, options);
  }

  release(remote) {
    if (this.onPull) this.onPull(remote, null);
  }

  damage(remote, amount, options) {
    if (!this._isTarget(remote)) return false;
    remote.hp -= amount;
    const killed = remote.hp <= 0;
    if (killed) remote.alive = false;
    if (this.onDamage) this.onDamage(remote, amount, options);
    return killed;
  }
}
