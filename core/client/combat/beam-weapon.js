/*
 * BEAM WEAPON: a Weapon that fires a continuous beam. `mag` is energy; it drains at `drainRate` per second
 * of firing, so a full cell lasts mag / drainRate seconds. Power starts at 100% and eases down to `powerMin`
 * over `falloffTime` seconds of firing; only a reload (recharge) restores it. Damage and beam width scale with it.
 *
 * The beam's colour comes from the game: `holder.modelDefs[id].beamColor(power, outColor)`.
 */

import * as THREE from 'three';
import { clamp, easeInOut } from '../engine/math.js';
import { makeGlowTexture } from '../graphics/materials.js';
import { Weapon } from './weapon.js';

const NUMBER_MERGE_SECONDS = 0.3; // floating damage numbers are merged to about three per second
const DEFAULT_BEAM_COLOR = new THREE.Color(0xffffff);

export class BeamWeapon extends Weapon {
  get aimable() { return true; }

  reset() {
    super.reset();
    this.beamOn = false;
    this.beamTick = 0;
    this.beamAcc = 0;
    this.beamAccCrit = false;
    this.beamAccTime = 0;
    this.beamAccEnemy = null;
    if (this.beam) this.beam.group.visible = false;
  }

  /** World-space beam: a white core, a scrolling additive sheath, and an impact glow. */
  onAttach(holder) {
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
    holder.mainScene.add(group);
    this.beam = { group, sheath, core, impact, texture };
  }

  /** Beam power 0..1: full at the start of a cell, easing down to `powerMin` over `falloffTime` seconds of firing. */
  beamPower() {
    const c = this.cfg;
    const t = clamp(this.beamTime / c.falloffTime, 0, 1);
    return 1 - (1 - c.powerMin) * (t * t * (3 - 2 * t));
  }

  cease(holder) {
    if (this.beamOn) this._stopBeam(holder);
  }

  _stopBeam(holder) {
    if (!this.beamOn) return;
    this.beamOn = false;
    this._flushNumber(holder);
    holder.audio.beamStop();
    this.beam.group.visible = false;
    holder.worldLight.intensity = 0;
  }

  pull(holder, dt, input) {
    const c = this.cfg;
    const { player, audio } = holder;
    const wants = input.fireHeld;

    if (wants && player.sprinting) { // firing cancels the sprint, same as the guns
      player.cancelSprint();
      this._stopBeam(holder);
      return;
    }
    if (wants && !this.reloading && this.mag <= 0) { // empty cell: recharge, or click if there is nothing left
      this._stopBeam(holder);
      if (this.reserve > 0) this.startReload(holder);
      else if (input.firePressed) audio.dry();
      return;
    }
    if (!wants || this.reloading || this.mag <= 0) {
      this._stopBeam(holder);
      return;
    }

    if (!this.beamOn) {
      this.beamOn = true;
      this.beamTick = 0;
      audio.beamStart();
    }
    this.mag = Math.max(0, this.mag - c.drainRate * dt);
    this.beamTime += dt; // the falloff clock only runs while firing, and only a reload resets it
    const power = this.beamPower();
    audio.beamSet(power);
    player.addRecoil(0.0003, (Math.random() - 0.5) * 0.0006, 0); // faint rumble

    this.beamTick -= dt;
    if (this.beamTick <= 0) {
      this.beamTick += c.tick;
      this._damageTick(holder, c, power);
    }
    if (this.mag <= 0) this._stopBeam(holder);
  }

  /** One damage tick: damage scales with current beam power. Numbers are merged into ~3 per second. */
  _damageTick(holder, c, power) {
    const { player, world, enemies, hud, audio } = holder;
    player.getAim(holder._origin, holder._fwd, holder._right, holder._up);
    const wallT = world.raycast(holder._origin, holder._fwd, c.range);
    const hit = enemies.raycast(holder._origin, holder._fwd, Math.min(c.range, wallT), c.beamRadius);
    if (!hit) {
      this._flushNumber(holder);
      return;
    }
    const enemy = hit.enemy;
    if (this.beamAccEnemy !== enemy) this._flushNumber(holder);
    this.beamAccEnemy = enemy;
    holder._beamEnd.copy(holder._origin).addScaledVector(holder._fwd, hit.t);

    const damage = c.dps * c.tick * power * (hit.crit ? c.critMul : 1);
    const flat = Math.hypot(holder._fwd.x, holder._fwd.z) || 1;
    const killed = enemies.damage(enemy, damage, {
      dirX: holder._fwd.x / flat, dirZ: holder._fwd.z / flat, knock: c.knockback, stun: 0, rollScale: 0.12,
    });
    this.beamAcc += damage;
    this.beamAccCrit = this.beamAccCrit || hit.crit;
    this.beamAccTime += c.tick;
    hud.hitmarker(hit.crit, killed);
    if (killed) {
      audio.enemyKill();
      this._flushNumber(holder);
    } else if (this.beamAccTime >= NUMBER_MERGE_SECONDS) {
      this._flushNumber(holder);
    }
  }

  _flushNumber(holder) {
    if (this.beamAcc > 0 && this.beamAccEnemy) {
      const power = this.beamPower();
      holder.hud.damageNumber(holder._beamEnd, this.beamAcc, this.beamAccCrit ? 'crit' : 'normal', 0.7 + 0.3 * power, 0.3);
    }
    this.beamAcc = 0;
    this.beamAccCrit = false;
    this.beamAccTime = 0;
    this.beamAccEnemy = null;
  }

  /** Per rendered frame while firing: stretch the beam from the real muzzle to wherever the crosshair lands. */
  _updateVisual(holder, dt, time, model) {
    const c = this.cfg;
    const power = this.beamPower();
    const { camera: cam, player, world, enemies, fx, tp } = holder;
    const { beam } = this;

    // Muzzle position: viewmodel space -> world space (the viewmodel camera mirrors the main one's orientation).
    let origin = cam.position;
    if (tp && player.thirdPersonVisible) {
      tp.muzzleWorld(holder._muzzleW); // the beam leaves the third-person model's gun, aimed through the crosshair
      player.getAim(holder._origin, holder._fwd, holder._right, holder._up);
      origin = holder._origin;
    } else {
      holder.anchor.updateMatrixWorld(true);
      model.muzzle.getWorldPosition(holder._muzzleW);
      holder._muzzleW.applyQuaternion(cam.quaternion).add(cam.position);
      holder._fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    }
    const wallT = world.raycast(origin, holder._fwd, c.range);
    const hit = enemies.raycast(origin, holder._fwd, Math.min(c.range, wallT), c.beamRadius);
    const endT = hit ? hit.t : Math.min(wallT, c.range);
    const end = holder._beamEnd.copy(origin).addScaledVector(holder._fwd, endT);

    const beamColor = holder.modelDefs[this.id]?.beamColor;
    const colour = beamColor ? beamColor(power, holder._beamColor) : holder._beamColor.copy(DEFAULT_BEAM_COLOR);
    const length = Math.max(0.1, holder._muzzleW.distanceTo(end));
    const mid = holder._tmp.addVectors(holder._muzzleW, end).multiplyScalar(0.5);
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

    beam.impact.position.copy(end).addScaledVector(holder._fwd, -0.05);
    beam.impact.scale.setScalar(0.45 * (0.5 + 0.5 * power) * (0.85 + Math.random() * 0.3));
    beam.impact.material.color.copy(colour);
    if (Math.random() < 0.6) fx.particles.burst(end, colour.getHex(), 1, 3, 0.05, 0.25, 6);

    holder.worldLight.color.copy(colour);
    holder.worldLight.position.copy(end).addScaledVector(holder._fwd, -0.6);
    holder.worldLight.intensity = 14 * power;
    holder.worldLightTime = 0.05;
    holder.flashFire(0.3 * (1 - 0.5 * holder.adsBlend), 5);
    beam.group.visible = true;
  }

  /** The whole weapon hums with a fine vibration while firing. */
  poseView(holder, pose, dt, time, model) {
    super.poseView(holder, pose, dt, time, model);
    if (!this.beamOn) return;
    const shake = 0.0025 * (1 - 0.7 * holder.adsBlend);
    pose.x += (Math.random() - 0.5) * shake;
    pose.y += (Math.random() - 0.5) * shake;
    pose.z += 0.008;
  }

  afterPose(holder, model, dt, time) {
    super.afterPose(holder, model, dt, time);
    if (this.beamOn) this._updateVisual(holder, dt, time, model);
  }

  /** The energy core refills over a recharge; power and firing drive the model's glow. */
  modelState(holder) {
    const c = this.cfg;
    let energy = this.mag / c.mag;
    if (this.reloading) {
      const p = clamp(1 - this.reloadTimer / c.reloadTime, 0, 1);
      energy = this.reloadFromEnergy + (Math.min(1, (this.mag + this.reserve) / c.mag) - this.reloadFromEnergy) * easeInOut(p);
    }
    return { ...super.modelState(holder), firing: this.beamOn, energy, power: this.beamPower() };
  }
}
