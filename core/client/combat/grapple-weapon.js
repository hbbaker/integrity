/*
 * GRAPPLE WEAPON: a Weapon that shoots a cable.
 *   - It hits a target (a bot or another player): the target is dragged toward the shooter.
 *   - It hits a wall, the ground or anything else solid: the shooter is pulled toward the anchor point.
 *   - It hits nothing: the cable flies out and falls back.
 * Pressing fire again while the cable is out lets go.
 *
 * Every number comes from `tuning`, which a subclass supplies (see game/combat/fiber-reel.js), so a
 * game tunes a grapple in one small file:
 *   range            metres the cable reaches
 *   aimRadius        how forgiving the hook is against targets
 *   selfPullSpeed    m/s the shooter flies toward an anchor
 *   targetPullSpeed  m/s a target is dragged toward the shooter
 *   arriveDistance   the pull stops this far from its goal
 *   maxSeconds       a pull gives up after this long
 *   cooldown         seconds before the next shot (or letting go)
 *   cableColor, cableRadius, missSeconds   how the cable looks
 *
 * The target system (`holder.enemies`) must offer pull(target, options) and release(target) next to raycast,
 * and the audio a grapple() sound.
 */

import * as THREE from 'three';
import { Weapon } from './weapon.js';

export class GrappleWeapon extends Weapon {
  /** The numbers described above. A subclass overrides this. */
  get tuning() {
    throw new Error('a GrappleWeapon subclass must provide `tuning`');
  }

  reset() {
    super.reset();
    this.hook = null; // { kind: 'target', target, time } | { kind: 'anchor', point }
    this.missTime = 0; // seconds the cable still shows after a miss
    this.missPoint = new THREE.Vector3();
    if (this.cable) this.cable.visible = false;
  }

  /** The cable: a thin cylinder stretched between the muzzle and wherever it is hooked. */
  onAttach(holder) {
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    geometry.rotateX(Math.PI / 2); // axis along Z so lookAt() aims it
    this.cable = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: this.tuning.cableColor, toneMapped: false, fog: false }));
    this.cable.frustumCulled = false;
    this.cable.visible = false;
    holder.mainScene.add(this.cable);
  }

  get hooked() {
    return this.hook !== null;
  }

  /* ------------------------------ lifecycle ------------------------------- */

  onDeselect(holder) {
    this.cease(holder);
    this.cancelReload();
  }

  /** Let go: the game paused, the player switched away, died... */
  cease(holder) {
    if (this.hook) this._release(holder);
    this.missTime = 0;
    if (this.cable) this.cable.visible = false;
  }

  pull(holder, dt, input) {
    this._watchHook(holder, dt);
    this._fireIfWanted(holder, input);
  }

  tryFire(holder) {
    holder.triggerBuffer = 0;
    holder.cooldown = this.tuning.cooldown;
    if (this.hook) {
      this._release(holder);
      return;
    }
    this._shoot(holder);
  }

  /* -------------------------------- the shot ------------------------------ */

  _shoot(holder) {
    const tuning = this.tuning;
    const { player, world, enemies, audio } = holder;
    player.getAim(holder._origin, holder._fwd, holder._right, holder._up);
    const wallT = world.raycast(holder._origin, holder._fwd, tuning.range);
    const hit = enemies.raycast(holder._origin, holder._fwd, Math.min(tuning.range, wallT), tuning.aimRadius);
    audio.grapple();

    if (hit) {
      this._hookTarget(holder, hit.enemy);
    } else if (wallT < tuning.range) {
      this._hookAnchor(holder, wallT);
    } else {
      holder._tmp.copy(holder._origin).addScaledVector(holder._fwd, tuning.range);
      this.missPoint.copy(holder._tmp);
      this.missTime = tuning.missSeconds; // nothing there: the cable flies out and falls back
    }
  }

  _hookTarget(holder, target) {
    const tuning = this.tuning;
    const { player, enemies } = holder;
    enemies.pull(target, {
      toward: () => player.pos,
      speed: tuning.targetPullSpeed,
      arrive: tuning.arriveDistance,
      seconds: tuning.maxSeconds,
    });
    this.hook = { kind: 'target', target, time: tuning.maxSeconds };
  }

  _hookAnchor(holder, distance) {
    const tuning = this.tuning;
    const point = holder._origin.clone().addScaledVector(holder._fwd, distance);
    holder.player.pullToward(point, { speed: tuning.selfPullSpeed, arrive: tuning.arriveDistance, seconds: tuning.maxSeconds });
    this.hook = { kind: 'anchor', point };
  }

  /** Drop the hook when the pull is over: arrived, timed out, the target died, or the shooter jumped off. */
  _watchHook(holder, dt) {
    if (this.missTime > 0) this.missTime -= dt;
    const { hook } = this;
    if (!hook) return;
    if (!holder.player.alive) {
      this._release(holder);
      return;
    }
    if (hook.kind === 'anchor') {
      if (!holder.player.pulled) this.hook = null;
      return;
    }
    hook.time -= dt;
    const { target } = hook;
    const gone = target.isRemote ? !target.alive : target.hp <= 0;
    if (hook.time <= 0 || gone || (!target.isRemote && !target.pull)) this._release(holder);
  }

  _release(holder) {
    const { hook } = this;
    this.hook = null;
    if (!hook) return;
    if (hook.kind === 'anchor') holder.player.cancelPull();
    else holder.enemies.release(hook.target);
  }

  /* -------------------------------- viewmodel ----------------------------- */

  /** The spool spins while the cable is out. */
  modelState() {
    return { active: this.hook !== null || this.missTime > 0 };
  }

  afterPose(holder, model, dt, time) {
    super.afterPose(holder, model, dt, time);
    this._drawCable(holder, model);
  }

  _drawCable(holder, model) {
    const { cable } = this;
    const hooked = this.hook !== null;
    if (!hooked && this.missTime <= 0) {
      cable.visible = false;
      return;
    }
    const { camera, player, tp, enemies } = holder;
    const start = holder._muzzleW;
    if (tp && player.thirdPersonVisible) {
      tp.muzzleWorld(start);
    } else {
      holder.anchor.updateMatrixWorld(true);
      model.muzzle.getWorldPosition(start);
      start.applyQuaternion(camera.quaternion).add(camera.position);
    }

    const end = holder._beamEnd;
    if (!hooked) end.copy(this.missPoint);
    else if (this.hook.kind === 'anchor') end.copy(this.hook.point);
    else enemies.bodyCenter(this.hook.target, end);

    const length = Math.max(0.05, start.distanceTo(end));
    cable.position.addVectors(start, end).multiplyScalar(0.5);
    cable.lookAt(end);
    cable.scale.set(this.tuning.cableRadius, this.tuning.cableRadius, length);
    cable.visible = true;
  }

  /* -------------------------------- display ------------------------------- */

  hudState() {
    return { mag: 0, reserve: 0, reloading: false, melee: true, altAmmo: '' }; // no ammo: the HUD shows infinity
  }

  describe() {
    return { dps: 0, range: this.tuning.range, capacity: 'GRAPPLE' };
  }
}
