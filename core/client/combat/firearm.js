/*
 * FIREARM: a Weapon that fires rays: one bullet or several pellets per trigger pull, with spread,
 * recoil, damage falloff and tracer lines. Each ray stops at the first wall or target.
 */

import { clamp } from '../engine/math.js';
import { Weapon } from './weapon.js';

const MAX_HITS = 32; // one entry per projectile that connects (a buckshot blast can hit up to 8 per target)

export class Firearm extends Weapon {
  get aimable() { return true; }

  pull(holder, dt, input) {
    this._fireIfWanted(holder, input);
  }

  tryFire(holder) {
    const c = this.cfg;
    if (this.reloading) {
      if (c.perShell && this.mag > 0) {
        this.cancelReload(); // firing interrupts a round-by-round reload
      } else {
        holder.triggerBuffer = 0;
        return;
      }
    }

    if (this.mag <= 0) {
      holder.triggerBuffer = 0;
      if (this.reserve > 0) {
        this.startReload(holder); // auto-reload when you try to fire on empty
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
    const { player } = holder;
    this.mag -= 1;
    holder.cooldown = c.interval;
    holder.triggerBuffer = 0;
    holder.heat = Math.min(holder.cfg.maxHeat, holder.heat + c.heat);

    // Read the aim BEFORE applying recoil: the shot goes where the crosshair was when you
    // pulled the trigger, and the kick only affects the next one.
    player.getAim(holder._origin, holder._fwd, holder._right, holder._up);

    // Camera kick (recovers) + aim climb (permanent until you pull down).
    const steady = 1 - 0.35 * holder.adsBlend; // sights steady the gun a little
    player.addRecoil(c.camKick * steady * (0.8 + Math.random() * 0.4), (Math.random() - 0.5) * 2 * c.camYaw * steady, c.climb * steady);
    // Viewmodel kick: impulse into the spring (see the system's updateView).
    holder.kick.vz += c.kickZ * 60;
    holder.kick.vr += c.kickRot * 60;

    holder.flashFire(c.flashSize * (1 - 0.6 * holder.adsBlend), 6); // smaller flash so it does not cover the sights
    holder.audio.shoot(c.id);

    if (holder.tp && player.thirdPersonVisible) {
      holder.tp.muzzleWorld(holder._from); // shots leave the third-person model's gun
    } else {
      holder._from.copy(holder._origin)
        .addScaledVector(holder._fwd, 0.7)
        .addScaledVector(holder._right, 0.2)
        .addScaledVector(holder._up, -0.16);
    }
    holder.worldLight.position.copy(holder._origin).addScaledVector(holder._fwd, 1.5);
    holder.worldLight.intensity = c.worldLight;
    holder.worldLightTime = 0.05;

    // Spread widens when moving or airborne. adsSpreadCut = share of the spread the sights remove (0.5 default).
    // adsAccurateAt: the sights count as fully on by this fraction of the aim blend, so a quick
    // scope (aim and fire straight away) is already accurate while the gun is still rising.
    const ads = c.adsAccurateAt ? Math.min(1, holder.adsBlend / c.adsAccurateAt) : holder.adsBlend;
    const spread = c.spread * (1 + (player.speed * 0.05 + (player.grounded ? 0 : 1.5)) * (1 - ads)) * (1 - (c.adsSpreadCut ?? 0.5) * ads);
    holder.hitCount = 0;
    for (let i = 0; i < c.pellets; i++) {
      const radius = Math.sqrt(Math.random()) * spread; // uniform over a disc
      const angle = Math.random() * Math.PI * 2;
      holder._dir.copy(holder._fwd)
        .addScaledVector(holder._right, Math.cos(angle) * radius)
        .addScaledVector(holder._up, Math.sin(angle) * radius)
        .normalize();
      this._shootRay(holder, c);
    }
    this._applyHits(holder, c);
    if (holder.onShot) {
      holder.onShot(holder.index, holder._from, holder._shotEnds);
      holder._shotEnds.length = 0;
    }

    if (c.pump || c.boltAction) this.pumpTimer = c.interval * 0.45;
  }

  _shootRay(holder, c) {
    const { world, enemies, fx } = holder;
    const origin = holder._origin;
    const dir = holder._dir;
    const wallT = world.raycast(origin, dir, c.range);
    const forgiveness = holder.flickForgiveness(); // a fast flick makes the hit volumes a little bigger
    const hit = enemies.raycast(origin, dir, Math.min(c.range, wallT), (c.pelletRadius || 0) + forgiveness.extra, forgiveness.boost);
    let endT = 60; // nothing hit: the tracer just flies off into the distance

    if (hit) {
      endT = hit.t;
      this._recordHit(holder, hit, c);
    } else if (wallT < c.range) {
      endT = wallT;
      holder._tmp.copy(origin).addScaledVector(dir, wallT - 0.05);
      fx.particles.burst(holder._tmp, 0xffffff, c.pellets > 1 ? 3 : 6, 3, 0.08, 0.3, 8); // impact puff
    }
    holder._to.copy(origin).addScaledVector(dir, endT);
    fx.tracers.spawn(holder._from, holder._to, c.tracerColor);
    if (holder.onShot) holder._shotEnds.push([holder._to.x, holder._to.y, holder._to.z]);
  }

  _damageFalloff(c, distance) {
    if (!c.falloffStart) return 1;
    const t = clamp((distance - c.falloffStart) / (c.falloffEnd - c.falloffStart), 0, 1);
    return 1 - t * (1 - c.falloffMin);
  }

  /** One entry per projectile that connects. Merged per target in _applyHits. */
  _recordHit(holder, hit, c) {
    if (holder.hitCount >= MAX_HITS) return;
    const falloff = this._damageFalloff(c, hit.t);
    const h = holder.hits[holder.hitCount++];
    h.enemy = hit.enemy;
    h.dmg = c.damage * (hit.crit ? c.critMul : 1) * falloff;
    h.crit = hit.crit;
    // Floating numbers shrink as the pellet's damage tapers off with distance.
    h.size = c.pelletNumbers ? 0.6 + 0.4 * falloff : 1;
    h.point.copy(holder._origin).addScaledVector(holder._dir, hit.t);
  }

  /**
   * Damage each target ONCE with the total of its pellets (one flash, one knockback).
   * Numbers: a pellet weapon shows one per pellet, scattered around the impacts; everything
   * else shows a single merged number per target.
   */
  _applyHits(holder, c) {
    const { enemies, hud, fx, audio } = holder;
    const fwd = holder._fwd;
    const flat = Math.hypot(fwd.x, fwd.z) || 1;
    for (let i = 0; i < holder.hitCount; i++) {
      const first = holder.hits[i];
      const enemy = first.enemy;
      if (!enemy) continue; // already merged into an earlier entry
      let total = 0;
      let crit = false;
      let last = first;
      for (let j = i; j < holder.hitCount; j++) {
        const h = holder.hits[j];
        if (h.enemy !== enemy) continue;
        total += h.dmg;
        crit = crit || h.crit;
        last = h;
        if (c.pelletNumbers) hud.damageNumber(h.point, h.dmg, h.crit ? 'crit' : 'normal', h.size, 0.45);
        h.enemy = null;
      }
      const killed = enemies.damage(enemy, total, {
        dirX: fwd.x / flat, dirZ: fwd.z / flat, knock: c.knockback, stun: c.stun,
      });
      if (!c.pelletNumbers) hud.damageNumber(last.point, total, crit ? 'crit' : 'normal');
      hud.hitmarker(crit, killed);
      fx.particles.burst(last.point, 0xfff27a, 4, 3.5, 0.07, 0.25, 8);
      if (killed) audio.enemyKill();
      else audio.hitBeep(crit);
    }
    holder.hitCount = 0;
  }
}

export { MAX_HITS };
