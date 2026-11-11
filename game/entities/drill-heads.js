import * as THREE from 'three';

/*
 * DRILL HEADS: the projectiles of the boring launcher (game/weapons/boring-launcher.js).
 *
 * A launched head flies in a straight line, spinning, and does one of three things:
 *   - It meets a solid or the ground: it IMPALES it. The head stays stuck in the surface, and the part sticking out
 *     becomes solid, so players can jump (or mantle) onto it and use it as a step or a platform. It is removed after
 *     `stickSeconds`, and the oldest goes first when more than `maxStuck` are out.
 *   - It meets a target (a bot or another player): the target is SKEWERED. The head keeps flying with the target
 *     stuck on it, at the head's speed along its path, for up to `carrySeconds` or until the head meets a surface
 *     (then the target is let go and takes crush damage, and the head impales the surface). It keeps going and skewers
 *     every further target it meets on the way, each with its own timer; it never hits the same target twice.
 *   - It meets nothing within `range`: it is removed.
 *
 * Guidance: a head launched with a `guide` function is steered while the function keeps returning a point to aim at
 * (the launcher returns the crosshair's target while the fire button is held). The head turns toward that point at
 * most `guideTurnRate` radians a second, for at most `guideSeconds`. While it steers, `onSteer(drill)` is called ten
 * times a second so the weapon can tell the other players.
 *
 * Multiplayer: every player's game flies its own copy of a head from the launch message (a "ghost": no target hits)
 * and gets the same impaled head and the same solid; steering messages keep the copy on the shooter's path. Only the
 * shooter's game decides who was hit; a hit player is carried by their own game (see DeathmatchRules), and is told the
 * new direction whenever the head turns.
 *
 * The solid part is built from small boxes along the exposed shaft (the world only has solids that stand on the ground).
 * A box waits while someone stands inside its footprint, so nobody is ever trapped in one.
 */

const SPIN_SPEED = 22; // radians per second of a flying head
const BOX_CLEARANCE = 0.5; // metres: a body this close to a box blocks it from appearing
const BOX_HEIGHT_LEEWAY = 0.35; // a body standing on top of a box does not block it
const PENDING_BOX_SECONDS = 4; // a box that stays blocked this long is dropped
const MIN_BOX_TOP = 0.25; // a stuck head lower than this is only decoration
const CARRY_BODY_OFFSET = 0.5; // metres behind the tip: where the first skewered target's body centre hangs
const CARRY_BODY_SPACING = 0.7; // metres between bodies when a head carries several
const MAX_TARGETS_PER_STEP = 8; // a step cannot skewer more than this many (a safety limit)
const IMPACT_SHAKE = 0.6;
const GHOST_SNAP_DISTANCE = 6; // metres: a ghost further than this from its shooter's head jumps to it instead of easing
const HEAD_COLORS = [0xff7a1a, 0xffd0a0, 0x888888];

export class DrillHeads {
  /**
   * @param holder the HoldableSystem (world, enemies (the Targets), player, fx, hud, audio, mainScene)
   * @param tuning see DRILL_TUNING in boring-launcher.js
   * @param buildHead () => { root, spinner, animate?(dt, time, flying) }: the head's model. Its origin is the tip and its
   *        body runs back along +Z; `spinner` is the part that turns about that axis.
   */
  constructor(holder, tuning, buildHead) {
    this.holder = holder;
    this.tuning = tuning;
    this.buildHead = buildHead;
    this.flying = [];
    this.stuck = [];
    this.time = 0;
    this._tmp = new THREE.Vector3();
    this._from = new THREE.Vector3();
    this._axis = new THREE.Vector3(0, 0, -1);
    this._want = new THREE.Vector3();
    this._turn = new THREE.Quaternion();
    this._identity = new THREE.Quaternion();
    this.lastId = 0;
    this.ghosts = new Map(); // `${player}:${id}` -> a ghost head, so steering messages find it
    this.onSteer = null; // (drill) => void, set by the weapon: tell the other players where the head is now
  }

  /** Every head still out (flying or stuck), for tests and the HUD. */
  get count() {
    return this.flying.length + this.stuck.length;
  }

  /** Fire a head. `ghost` heads are another player's: they fly and stick but hit no one. */
  launch(origin, direction, { ghost = false, guide = null, key = null } = {}) {
    const dir = direction.clone().normalize();
    const head = this.buildHead();
    this.holder.mainScene.add(head.root);
    head.root.quaternion.setFromUnitVectors(this._axis, dir);
    const drill = {
      head, dir, ghost, pos: origin.clone(), travelled: 0, victims: [], struck: new Set(),
      id: ++this.lastId, guide, guideTime: 0, steerTimer: 0, key,
      stuckLeft: 0, boxes: [], solids: [], pendingFor: 0,
    };
    head.root.position.copy(drill.pos);
    this.flying.push(drill);
    if (key) this.ghosts.set(key, drill);
    return drill;
  }

  /** Another player's launch message: { i: id, f: [x, y, z], d: [dx, dy, dz] }. Bad numbers are ignored. */
  receive(from, message) {
    const parsed = this._parse(message);
    if (!parsed) return;
    const key = Number.isFinite(Number(message.i)) ? `${from}:${Number(message.i)}` : null;
    this.launch(parsed.from, parsed.dir, { ghost: true, key });
  }

  /** Another player's steering message: { i: id, f: [x, y, z], d: [dx, dy, dz] }: their head is here, heading this way now. */
  steer(from, message) {
    const drill = this.ghosts.get(`${from}:${Number(message.i)}`);
    const parsed = this._parse(message);
    if (!drill || !parsed || !this.flying.includes(drill)) return;
    drill.dir.copy(parsed.dir).normalize();
    drill.head.root.quaternion.setFromUnitVectors(this._axis, drill.dir);
    if (drill.pos.distanceTo(parsed.from) > GHOST_SNAP_DISTANCE) drill.pos.copy(parsed.from);
    else drill.pos.lerp(parsed.from, 0.5);
  }

  /** { from, dir } as vectors from a message's `f` and `d`, or null when they are not three real numbers (and a direction). */
  _parse(message) {
    const f = message.f;
    const d = message.d;
    if (!Array.isArray(f) || !Array.isArray(d) || f.length !== 3 || d.length !== 3) return null;
    const from = f.map(Number);
    const dir = d.map(Number);
    if (![...from, ...dir].every(Number.isFinite) || !(Math.hypot(...dir) > 0)) return null;
    return { from: new THREE.Vector3(...from), dir: new THREE.Vector3(...dir) };
  }

  /** Remove everything (a new level, or the player died). Skewered targets are let go. */
  clear() {
    for (const drill of [...this.flying]) this._remove(drill);
    for (const drill of [...this.stuck]) this._remove(drill);
  }

  update(dt) {
    this.time += dt;
    for (const drill of [...this.flying]) this._fly(drill, dt);
    for (const drill of [...this.stuck]) this._stay(drill, dt);
  }

  /* -------------------------------- flight -------------------------------- */

  _fly(drill, dt) {
    const { tuning, holder } = this;
    const step = tuning.speed * dt;
    if (drill.guide) this._steer(drill, dt);
    const wallT = holder.world.raycast(drill.pos, drill.dir, step);

    if (!drill.ghost) this._lookForTargets(drill, Math.min(step, wallT));
    this._dropDeadVictims(drill);

    if (wallT <= step) {
      this._impale(drill, wallT);
      return;
    }
    drill.pos.addScaledVector(drill.dir, step);
    drill.travelled += step;
    this._carry(drill, dt);
    drill.head.root.position.copy(drill.pos);
    drill.head.spinner.rotation.z += SPIN_SPEED * dt;
    drill.head.animate?.(dt, this.time, true);
    if (drill.travelled >= tuning.range) this._remove(drill);
  }

  /** Turn the head toward what the guide says to aim at, a little each step. */
  _steer(drill, dt) {
    const { tuning } = this;
    const aim = drill.guide(drill.pos, this._want);
    drill.guideTime += dt;
    if (!aim || drill.guideTime > tuning.guideSeconds) {
      drill.guide = null; // let go of the button, or out of time: the head flies straight on from here
      this._announce(drill);
      return;
    }
    if (aim.lengthSq() > 1e-6) {
      aim.normalize();
      const angle = drill.dir.angleTo(aim);
      if (angle > 1e-5) {
        this._turn.setFromUnitVectors(drill.dir, aim);
        this._turn.slerp(this._identity, 1 - Math.min(1, (tuning.guideTurnRate * dt) / angle)); // only part of the way: the turn rate limits it
        drill.dir.applyQuaternion(this._turn).normalize();
        drill.head.root.quaternion.setFromUnitVectors(this._axis, drill.dir);
      }
    }
    drill.steerTimer -= dt;
    if (drill.steerTimer <= 0) {
      drill.steerTimer = tuning.steerSendSeconds;
      this._announce(drill);
    }
  }

  /** Tell the other players where the head is and which way it goes, and every carried player the new direction. */
  _announce(drill) {
    this.onSteer?.(drill);
    for (const victim of drill.victims) if (victim.target.isRemote) this._carryOptions(drill, victim);
  }

  /** Skewer every target the head meets along this step, one after the other: each rides the head from then on. */
  _lookForTargets(drill, reach) {
    const { tuning, holder } = this;
    for (let guard = 0; guard < MAX_TARGETS_PER_STEP; guard++) {
      const hit = holder.enemies.raycast(drill.pos, drill.dir, reach, tuning.hitRadius, 0, drill.struck);
      if (!hit) return;
      this._skewer(drill, hit.enemy);
    }
  }

  _skewer(drill, target) {
    const { tuning } = this;
    drill.struck.add(target); // a head never hits the same target twice, even after letting it go
    this._hurt(drill, target, tuning.impactDamage, drill.pos);
    if (!this._isAlive(target)) return; // the hit killed it: the head just flies on
    const victim = { target, carryLeft: tuning.carrySeconds, point: new THREE.Vector3(), index: drill.struck.size - 1 };
    drill.victims.push(victim);
    this._updateCarryPoint(drill, victim);
    this._carryOptions(drill, victim);
  }

  /** Start (or, for a player, re-send) the carry of one victim: bots hang from a point, players are told the direction. */
  _carryOptions(drill, victim) {
    const { tuning, holder } = this;
    holder.enemies.carry(victim.target, {
      point: () => (drill.victims.includes(victim) ? victim.point : null),
      direction: drill.dir,
      speed: tuning.speed,
      seconds: Math.max(0.05, victim.carryLeft),
    });
  }

  _isAlive(target) {
    return target.isRemote ? target.alive : target.hp > 0;
  }

  _dropDeadVictims(drill) {
    for (const victim of [...drill.victims]) if (!this._isAlive(victim.target)) this._letGo(drill, victim);
  }

  /** Move every skewered target with the head, and let go of the ones whose time is up. */
  _carry(drill, dt) {
    for (const victim of [...drill.victims]) {
      victim.carryLeft -= dt;
      if (victim.carryLeft <= 0) this._letGo(drill, victim);
      else this._updateCarryPoint(drill, victim);
    }
  }

  /** The bodies hang one behind the other along the shaft, the first hit nearest the tip. */
  _updateCarryPoint(drill, victim) {
    victim.point.copy(drill.pos).addScaledVector(drill.dir, -(CARRY_BODY_OFFSET + victim.index * CARRY_BODY_SPACING));
  }

  _letGo(drill, victim) {
    const index = drill.victims.indexOf(victim);
    if (index < 0) return;
    drill.victims.splice(index, 1);
    this.holder.enemies.release(victim.target);
  }

  /* ------------------------------- impaling ------------------------------- */

  _impale(drill, distance) {
    const { tuning, holder } = this;
    drill.pos.addScaledVector(drill.dir, distance);
    for (const victim of [...drill.victims]) { // everyone on the head is slammed into the surface
      this._letGo(drill, victim);
      if (this._isAlive(victim.target)) this._hurt(drill, victim.target, tuning.crushDamage, drill.pos);
    }
    this.flying.splice(this.flying.indexOf(drill), 1);
    drill.stuckLeft = tuning.stickSeconds;
    drill.head.root.position.copy(drill.pos).addScaledVector(drill.dir, tuning.embed);
    drill.head.spinner.rotation.z = 0;
    drill.head.animate?.(0, this.time, false);
    drill.boxes = this._boxesFor(drill);
    drill.pendingFor = 0;
    this.stuck.push(drill);
    while (this.stuck.length > tuning.maxStuck) this._remove(this.stuck[0]);

    for (const color of HEAD_COLORS) holder.fx.particles.burst(drill.pos, color, 5, 5, 0.1, 0.5, 14);
    holder.fx.particles.smoke(drill.pos, 4, 1.4);
    if (!drill.ghost) holder.player.shake = Math.max(holder.player.shake, IMPACT_SHAKE * this._nearness(drill.pos));
    holder.audio.drillImpact?.(holder.player.pos.distanceTo(drill.pos));
  }

  /** 1 next to the shooter, fading to 0 at 30 m: how hard an impact shakes the camera. */
  _nearness(point) {
    return Math.max(0, 1 - this.holder.player.pos.distanceTo(point) / 30);
  }

  /** The solid part of a stuck head: a few boxes along the shaft sticking out of the surface. */
  _boxesFor(drill) {
    const { tuning } = this;
    const boxes = [];
    const exposed = tuning.length - tuning.embed;
    for (let along = tuning.boxStart; along < exposed; along += tuning.boxStep) {
      const q = this._tmp.copy(drill.pos).addScaledVector(drill.dir, -along);
      const radius = Math.min(tuning.baseRadius, tuning.tipRadius + tuning.taper * (tuning.embed + along));
      const top = q.y + radius;
      if (top < MIN_BOX_TOP || top > tuning.maxBoxTop) continue;
      boxes.push({ x: q.x, z: q.z, half: radius + tuning.boxPadding, top });
    }
    return boxes;
  }

  /* --------------------------------- stuck -------------------------------- */

  _stay(drill, dt) {
    drill.stuckLeft -= dt;
    if (drill.stuckLeft <= 0) {
      this._remove(drill);
      return;
    }
    if (drill.boxes.length === 0) return;
    drill.pendingFor += dt;
    const ready = drill.boxes.filter((box) => !this._occupied(box));
    for (const box of ready) {
      drill.solids.push(this.holder.world.addCollider(box.x, box.z, box.half * 2, box.top, box.half * 2));
      drill.boxes.splice(drill.boxes.indexOf(box), 1);
    }
    if (drill.pendingFor > PENDING_BOX_SECONDS) drill.boxes.length = 0;
  }

  /** True if anyone stands inside the box's footprint below its top (they would be trapped when it appears). */
  _occupied(box) {
    const { player, enemies } = this.holder;
    const inside = (pos) => Math.abs(pos.x - box.x) < box.half + BOX_CLEARANCE
      && Math.abs(pos.z - box.z) < box.half + BOX_CLEARANCE
      && pos.y < box.top - BOX_HEIGHT_LEEWAY;
    if (player.alive && inside(player.pos)) return true;
    const bots = enemies.enemies?.alive ?? enemies.alive ?? [];
    if (bots.some((bot) => inside(bot.pos))) return true;
    const players = enemies.remotes?.list ?? [];
    return players.some((remote) => remote.alive && inside(remote.pos));
  }

  _hurt(drill, victim, amount, point) {
    const { holder } = this;
    const killed = holder.enemies.damage(victim, amount, {
      dirX: drill.dir.x, dirZ: drill.dir.z, knock: 0, stun: 0.3,
    });
    holder.hud.damageNumber(point, amount, 'normal');
    holder.hud.hitmarker(false, killed);
    holder.fx.particles.burst(point, 0xff7a1a, 6, 4, 0.08, 0.3, 8);
    if (killed) holder.audio.enemyKill();
    else holder.audio.hitBeep(false);
  }

  _remove(drill) {
    for (const victim of [...drill.victims]) this._letGo(drill, victim);
    for (const solid of drill.solids) this.holder.world.removeCollider(solid);
    drill.solids.length = 0;
    drill.boxes.length = 0;
    const list = this.flying.includes(drill) ? this.flying : this.stuck;
    const index = list.indexOf(drill);
    if (index >= 0) list.splice(index, 1);
    if (drill.key) this.ghosts.delete(drill.key);
    drill.head.root.removeFromParent();
    drill.head.root.traverse((object) => object.geometry?.dispose());
  }
}
