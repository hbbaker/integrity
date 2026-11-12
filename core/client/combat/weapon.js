/*
 * WEAPON: a Holdable that uses ammo, reloads and fires on the trigger.
 *
 * Subclasses decide what firing does: Firearm (rays and pellets), BeamWeapon (a continuous
 * beam), MeleeWeapon (a punch or swing). Weapon itself owns what they share: the magazine and
 * reserve, ammo types (a gun can keep several, like shells and slugs, and swap between them),
 * reloading (whole magazine or round by round), and the fire-when-the-trigger-is-ready rule.
 *
 * Per-weapon state lives here (mag, reserve, reload progress). Shared hand state (cooldown, the
 * trigger buffer, heat, aim) lives on the holder.
 */

import { clamp, easeInOut } from '../engine/math.js';
import { Holdable } from './holdable.js';

export class Weapon extends Holdable {
  /**
   * @param base config entry. With `ammoTypes` the weapon keeps one merged config per type in `typeCfgs`;
   * `cfg` always points at the active one, so every other method just reads this.cfg. `reserve` is the active
   * type's reserve; the others wait in `stash`.
   */
  constructor(base) {
    super(base);
    this.typeCfgs = null;
    this.type = null;
    this.stash = {};
    if (base.ammoTypes) {
      const { ammoTypes, ...shared } = base;
      this.typeCfgs = {};
      for (const [key, type] of Object.entries(ammoTypes)) {
        this.typeCfgs[key] = { ...shared, ...type, name: `${base.name}: ${type.label}` };
      }
    }
    this.reset();
  }

  reset() {
    this.equipAge = Infinity; // seconds since the item was taken out; models read it for a draw animation
    if (this.typeCfgs) {
      this.type = this.base.defaultAmmo;
      this.cfg = this.typeCfgs[this.type];
      for (const [key, cfg] of Object.entries(this.typeCfgs)) this.stash[key] = cfg.reserve;
      this.reserve = this.stash[this.type];
      this.stash[this.type] = 0;
    } else {
      this.reserve = this.cfg.reserve || 0;
    }
    this.mag = this.base.mag || 0;
    this.beamTime = 0; // seconds of continuous beam since the last reload (drives the power falloff)
    this.reloading = false;
    this.reloadPhase = 'start';
    this.reloadTimer = 0;
    this.reloadStage = 0;
    this.reloadFromEnergy = 1;
    this.pumpTimer = 0;
  }

  /** Keep the magazine and reserve full so nothing ever runs dry. */
  refill() {
    if (this.base.melee) return;
    this.mag = this.base.mag;
    this.reserve = this.cfg.maxReserve || this.reserve;
  }

  /** Spare ammo of every type is always full; the rounds in the weapon still run out. */
  refillReserve() {
    if (this.base.melee) return;
    if (this.typeCfgs) {
      for (const [key, cfg] of Object.entries(this.typeCfgs)) {
        if (key === this.type) this.reserve = cfg.maxReserve;
        else this.stash[key] = cfg.maxReserve;
      }
    } else if (this.cfg.maxReserve) {
      this.reserve = this.cfg.maxReserve;
    }
  }

  get loadingRoundByRound() {
    return this.reloading && Boolean(this.cfg.perShell);
  }

  onDeselect(holder) {
    this.cease(holder);
    this.cancelReload();
  }

  onEquip() {
    this.equipAge = 0;
  }

  tick(holder, dt) {
    this.equipAge += dt;
    if (this.pumpTimer > 0) {
      this.pumpTimer -= dt;
      if (this.pumpTimer <= 0) holder.audio.click('pump');
    }
  }

  fixedUpdate(holder, dt, input) {
    this._updateReload(holder, dt);
    this.pull(holder, dt, input);
  }

  /** pull(holder, dt, input): the trigger part of a step; each subclass decides what the trigger does. */
  pull() {}

  /**
   * Fire if the trigger is wanted and the weapon is ready. A full-auto weapon wants it while the trigger is held; the
   * others on each (buffered) press. Firing while sprinting drops the sprint and the shot comes a beat later.
   */
  _fireIfWanted(holder, input) {
    const c = this.cfg;
    const wantsTrigger = c.auto ? (input.fireHeld || holder.triggerBuffer > 0) : holder.triggerBuffer > 0;
    if (holder.fireLocked || !wantsTrigger || holder.cooldown > 0) return;
    if (holder.player.sprinting) {
      holder.player.cancelSprint();
      holder.cooldown = holder.cfg.sprintExitDelay;
      return;
    }
    this.tryFire(holder);
  }

  /** tryFire(holder): the trigger was pulled and the weapon is ready. */
  tryFire() {}

  /* --------------------------------- ammo --------------------------------- */

  _otherAmmoType() {
    return Object.keys(this.typeCfgs).find((key) => key !== this.type);
  }

  /**
   * The ammo-swap control on a weapon with several ammo types. The rounds in the weapon go back to reserve,
   * the type changes, and the weapon starts a full reload with the new rounds: switching is never free.
   * Refused (dry click) if there is none of the other type.
   */
  swapAmmo(holder) {
    if (!this.typeCfgs) return;
    const next = this._otherAmmoType();
    if (this.stash[next] <= 0) {
      holder.audio.dry();
      return;
    }
    this.cancelReload();
    this.stash[this.type] = this.reserve + this.mag; // unload
    this.mag = 0;
    this.type = next;
    this.cfg = this.typeCfgs[next];
    this.reserve = this.stash[next];
    this.stash[next] = 0;
    holder.cooldown = Math.max(holder.cooldown, 0.3);
    holder.triggerBuffer = 0;
    holder.audio.click('pump');
    holder.hud.setWeapon(this.cfg.id, this.cfg.name);
    this.startReload(holder);
  }

  /** `amounts` maps pickup keys ('pistol', 'shotgun', 'slug', ...) to rounds. Returns true if any ammo was taken. */
  addAmmo(amounts) {
    let added = false;
    if (this.typeCfgs) {
      for (const [key, cfg] of Object.entries(this.typeCfgs)) {
        const amount = amounts[cfg.pickupKey];
        if (!amount) continue;
        const have = key === this.type ? this.reserve : this.stash[key];
        const take = Math.min(cfg.maxReserve - have, amount);
        if (take <= 0) continue;
        if (key === this.type) this.reserve += take;
        else this.stash[key] += take;
        added = true;
      }
      return added;
    }
    const amount = amounts[this.cfg.id];
    if (!amount) return false;
    const space = this.cfg.maxReserve - this.reserve;
    if (space <= 0) return false;
    this.reserve += Math.min(space, amount);
    return true;
  }

  /* ------------------------------- reloading ------------------------------ */

  startReload(holder) {
    const c = this.cfg;
    if (c.melee || this.reloading) return;
    const full = this.mag >= c.mag;
    // A beam weapon can also recharge when full, if its power has fallen off: that is what resets it.
    if (c.beam ? (full && this.beamTime <= 0) || (!full && this.reserve <= 0) : full || this.reserve <= 0) return;
    this.cease(holder);
    this.reloading = true;
    this.reloadFromEnergy = this.mag / c.mag;
    if (c.beam) holder.audio.recharge(c.reloadTime);
    holder.triggerBuffer = 0;
    this.reloadStage = 0;
    if (c.perShell) {
      this.reloadPhase = 'start';
      this.reloadTimer = c.startTime;
    } else {
      this.reloadTimer = c.reloadTime;
    }
  }

  cancelReload() {
    this.reloading = false;
  }

  _updateReload(holder, dt) {
    if (!this.reloading) return;
    const c = this.cfg;
    const { audio } = holder;
    this.reloadTimer -= dt;

    if (!c.perShell) {
      const p = 1 - this.reloadTimer / c.reloadTime;
      if (this.reloadStage === 0 && p > 0.3) { audio.click('mag'); this.reloadStage = 1; } // mag out
      if (this.reloadStage === 1 && p > 0.75) { audio.click('mag'); this.reloadStage = 2; } // mag in
      if (this.reloadTimer <= 0) {
        const n = Math.min(c.mag - this.mag, this.reserve);
        this.mag += n;
        this.reserve -= n;
        this.beamTime = 0; // a fresh cell restores full beam power
        this.reloading = false;
      }
      return;
    }

    // Round by round (a shotgun): one shell at a time, interruptible by firing.
    if (this.reloadTimer > 0) return;
    if (this.reloadPhase === 'start') {
      this.reloadPhase = 'load';
      this.reloadTimer = c.shellTime;
    } else if (this.reloadPhase === 'load') {
      this.mag += 1;
      this.reserve -= 1;
      audio.click('shell');
      if (this.mag < c.mag && this.reserve > 0) {
        this.reloadTimer = c.shellTime;
      } else {
        this.reloadPhase = 'end';
        this.reloadTimer = c.endTime;
        audio.click('pump');
      }
    } else {
      this.reloading = false;
    }
  }

  /* -------------------------------- viewmodel ----------------------------- */

  /** Reload dip and tilt, shell-loading tilt, pump and bolt strokes, and the scope hiding the gun. */
  poseView(holder, pose, dt, time, model) {
    const c = this.cfg;
    const ads = holder.adsBlend;
    const { player, hud } = holder;

    // Reload tween (magazine weapons: dip and tilt; round by round: tilt up and hold while the rounds go in).
    if (this.reloading) {
      if (!c.perShell) {
        const p = clamp(1 - this.reloadTimer / c.reloadTime, 0, 1);
        const s = Math.sin(Math.PI * easeInOut(p));
        pose.y -= 0.13 * s;
        pose.rz += 0.6 * s;
        pose.rx += 0.3 * s;
        pose.x -= 0.04 * s;
        pose.supportDrop = 0.12 * s;
        if (model.parts.mag) { // magazine drops out, then slides back in
          const out = p < 0.3 ? 0 : p < 0.5 ? (p - 0.3) / 0.2 : p < 0.6 ? 1 : p < 0.8 ? 1 - (p - 0.6) / 0.2 : 0;
          model.parts.mag.position.y = model.parts.magBaseY - 0.25 * out;
        }
      } else if (this.reloadPhase === 'load') {
        const p = clamp(1 - this.reloadTimer / c.shellTime, 0, 1);
        pose.y -= 0.025 * Math.sin(Math.PI * p); // each round is a small push
        pose.supportDrop = 0.1 * Math.sin(Math.PI * p);
      }
    } else if (model.parts.mag) {
      model.parts.mag.position.y = model.parts.magBaseY;
    }
    if (c.perShell) { // held tilted while loading
      const b = easeInOut(holder.reloadBlend);
      pose.rz += 0.55 * b;
      pose.rx += 0.3 * b;
      pose.y -= 0.07 * b;
    }

    // Pump after each shot.
    if (model.parts.pump) {
      const p = 1 - holder.cooldown / c.interval;
      const stroke = p > 0.3 && p < 0.8 ? Math.sin(Math.PI * ((p - 0.3) / 0.5)) : 0;
      model.parts.pump.position.z = model.parts.pumpBaseZ + 0.13 * stroke;
    }

    // Bolt-action cycle after each shot: the handle lifts and slides back, then returns.
    if (model.parts.bolt) {
      const p = 1 - holder.cooldown / c.interval;
      const stroke = p > 0.25 && p < 0.85 ? Math.sin(Math.PI * ((p - 0.25) / 0.6)) : 0;
      model.parts.bolt.position.z = model.parts.boltBaseZ + 0.09 * stroke;
      model.parts.bolt.rotation.z = -0.9 * stroke;
    }

    // Looking through a scope: the gun itself is out of the picture.
    if (c.scope) {
      const scoped = !player.thirdPersonVisible && ads > 0.9;
      model.root.visible = !scoped;
      hud.setScope(player.thirdPersonVisible ? 0 : ads);
    }
  }

  /**
   * What a model's `animate(dt, time, state)` reads: ammo (0..1), rounds and capacity, pulse (1 right after a shot,
   * falling to 0 as the next one gets ready), aiming (0..1), reloading, reloadProgress (0..1 through a whole-magazine
   * reload, else 0), equipAge (seconds since the item was taken out), and swing (a melee swing is in progress).
   */
  modelState(holder) {
    const c = this.cfg;
    const capacity = this.base.mag || 0;
    const pulse = c.interval > 0 ? clamp(holder.cooldown / c.interval, 0, 1) : 0;
    return {
      rounds: this.mag,
      capacity,
      ammo: capacity ? clamp(this.mag / capacity, 0, 1) : 1,
      pulse,
      aiming: holder.adsBlend,
      reloading: this.reloading,
      reloadProgress: this.reloading && !c.perShell ? clamp(1 - this.reloadTimer / c.reloadTime, 0, 1) : 0,
      equipAge: this.equipAge,
      swing: holder.swingT >= 0 || holder.punchT.some((t) => t >= 0),
    };
  }

  /* -------------------------------- display ------------------------------- */

  hudState() {
    let altAmmo = '';
    if (this.typeCfgs) {
      const other = this._otherAmmoType();
      altAmmo = `TAB: ${this.typeCfgs[other].label} ${this.stash[other]}`;
    }
    // Ceil: an energy cell drains fractionally.
    return { mag: Math.ceil(this.mag), reserve: Math.ceil(this.reserve), reloading: this.reloading, melee: Boolean(this.cfg.melee), altAmmo };
  }

  describe() {
    const c = this.cfg;
    const dps = c.beam ? c.dps : (c.damage * (c.pellets || 1)) / c.interval;
    const capacity = c.beam ? `${(c.mag / c.drainRate).toFixed(1)}s beam` : `${c.mag} rounds`;
    return { dps, range: c.range, capacity };
  }
}
