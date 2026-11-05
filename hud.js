import * as THREE from 'three';
import { easeOutBack } from './effects.js';

/*
 * HTML/CSS HUD. Damage numbers are pooled DOM elements projected from world space
 * every frame (crisp at any resolution, no canvas textures needed).
 */

const INK = '#000000';

// Simple inline-SVG weapon icons (viewBox 100x50, thick outlines to match the HUD).
const stroke = `stroke="${INK}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"`;
const WEAPON_ICONS = {
  fists: `<svg viewBox="0 0 100 50"><rect x="14" y="14" width="46" height="26" rx="12" fill="#f4f4f4" ${stroke}/><rect x="52" y="18" width="34" height="18" rx="4" fill="#9aa0a6" ${stroke}/><path d="M26 14v26M38 14v26" ${stroke} fill="none"/></svg>`,
  pistol: `<svg viewBox="0 0 100 50"><rect x="14" y="8" width="70" height="16" rx="4" fill="#ffd800" ${stroke}/><rect x="22" y="22" width="26" height="8" fill="#9aa0a6" ${stroke}/><rect x="26" y="24" width="16" height="22" rx="4" fill="#e3242b" ${stroke}/></svg>`,
  shotgun: `<svg viewBox="0 0 100 50"><rect x="4" y="12" width="72" height="9" rx="3" fill="#cfd3d6" ${stroke}/><rect x="30" y="22" width="26" height="8" rx="3" fill="#ff7a1a" ${stroke}/><rect x="56" y="14" width="22" height="16" rx="3" fill="#ff7a1a" ${stroke}/><path d="M78 14l16 6-4 20-14-8z" fill="#e3242b" ${stroke}/></svg>`,
  smg: `<svg viewBox="0 0 100 50"><rect x="6" y="12" width="72" height="16" rx="4" fill="#7a3cff" ${stroke}/><rect x="40" y="26" width="12" height="20" rx="3" fill="#ffd800" ${stroke}/><rect x="64" y="26" width="10" height="18" rx="3" fill="#e3242b" ${stroke}/><rect x="78" y="14" width="16" height="10" rx="3" fill="#9aa0a6" ${stroke}/></svg>`,
};

const NUMBER_POOL_SIZE = 48;
const NUMBER_LIFE = 0.95;
const NUMBER_POP_TIME = 0.16;
const NUMBER_DRIFT_PX = 70;

export class Hud {
  constructor(cfg) {
    this.cfg = cfg;
    const $ = (id) => document.getElementById(id);
    this.el = {
      healthPanel: $('health-panel'), healthFill: $('health-fill'), healthText: $('health-text'),
      weaponIcon: $('weapon-icon'), weaponName: $('weapon-name'), weaponAlt: $('weapon-alt'),
      ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), ammoSep: $('ammo-sep'), reload: $('reload-indicator'),
      crosshair: $('crosshair'), hitmarker: $('hitmarker'),
      wave: $('wave'), kills: $('kills'), banner: $('banner'),
      vignette: $('vignette'), numbers: $('damage-numbers'),
      start: $('overlay-start'), dead: $('overlay-dead'), deadWave: $('dead-wave'), deadKills: $('dead-kills'),
    };

    // Cached values so the DOM is only touched when something actually changes.
    this.last = { health: -1, mag: -1, reserve: -1, reloading: null, melee: null, spread: -1, weapon: '', aim: -1, alt: null };
    this.healthFraction = 1;
    this.hitPulse = 0;

    this.numbers = [];
    for (let i = 0; i < NUMBER_POOL_SIZE; i++) {
      const el = document.createElement('div');
      el.className = 'dmg';
      this.el.numbers.appendChild(el);
      this.numbers.push({ el, active: false, age: 0, tilt: 0, type: '', point: new THREE.Vector3() });
    }
    this.numberCursor = 0;
    this._ndc = new THREE.Vector3();
  }

  /* ------------------------------ status ---------------------------------- */

  setHealth(health, max) {
    const value = Math.ceil(health);
    if (value === this.last.health) return;
    this.last.health = value;
    this.healthFraction = health / max;
    this.el.healthText.textContent = value;
    this.el.healthFill.style.width = `${Math.max(0, this.healthFraction * 100)}%`;
    this.el.healthPanel.classList.toggle('low', this.healthFraction < 0.3);
  }

  /** Shake + red flash on the health panel and a vignette pulse. */
  damage() {
    const panel = this.el.healthPanel;
    panel.classList.remove('hit');
    void panel.offsetWidth; // force reflow so the CSS animation restarts
    panel.classList.add('hit');
    this.hitPulse = 1;
  }

  setWeapon(id, name) {
    if (this.last.weapon === name) return; // name includes the shotgun's ammo type, so a type swap refreshes it
    this.last.weapon = name;
    this.el.weaponName.textContent = name;
    this.el.weaponIcon.innerHTML = WEAPON_ICONS[id];
  }

  /** Small hint line under the weapon name, e.g. "TAB: SLUG 8". Pass '' to hide. */
  setAltAmmo(text) {
    if (text === this.last.alt) return;
    this.last.alt = text;
    this.el.weaponAlt.textContent = text;
    this.el.weaponAlt.style.display = text ? 'block' : 'none';
  }

  setAmmo(mag, reserve, reloading, melee) {
    const l = this.last;
    if (melee !== l.melee) {
      l.melee = melee;
      this.el.ammoSep.style.display = melee ? 'none' : '';
      this.el.ammoReserve.style.display = melee ? 'none' : '';
      this.el.ammoMag.textContent = melee ? '∞' : mag;
    }
    if (!melee && mag !== l.mag) {
      l.mag = mag;
      this.el.ammoMag.textContent = mag;
    }
    if (!melee && reserve !== l.reserve) {
      l.reserve = reserve;
      this.el.ammoReserve.textContent = reserve;
    }
    if (reloading !== l.reloading) {
      l.reloading = reloading;
      this.el.reload.classList.toggle('on', reloading);
    }
  }

  setWave(wave) {
    this.el.wave.textContent = wave;
  }

  setKills(kills) {
    this.el.kills.textContent = kills;
  }

  banner(text) {
    const b = this.el.banner;
    b.textContent = text;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  showStart(visible) {
    this.el.start.style.display = visible ? 'flex' : 'none';
  }

  showDeath(wave, kills) {
    this.el.deadWave.textContent = wave;
    this.el.deadKills.textContent = kills;
    this.el.dead.style.display = 'flex';
  }

  hideDeath() {
    this.el.dead.style.display = 'none';
  }

  /* ----------------------------- crosshair -------------------------------- */

  /** Fade the crosshair out as the gun comes up to the sights (the sights are the aim point). */
  setAim(blend) {
    if (Math.abs(blend - this.last.aim) < 0.02) return;
    this.last.aim = blend;
    this.el.crosshair.style.opacity = (1 - Math.min(1, blend * 1.6)).toFixed(2);
  }

  hitmarker(crit, kill) {
    const hm = this.el.hitmarker;
    hm.className = kill ? 'kill' : crit ? 'crit' : '';
    void hm.offsetWidth; // restart animation
    hm.classList.add('pop');
  }

  /* --------------------------- damage numbers ------------------------------ */

  /**
   * type: 'normal' (white) | 'crit' (yellow, bigger) | 'melee' (orange).
   * size scales the text (shotgun pellet numbers shrink as damage tapers off with distance);
   * scatter spreads repeated numbers around the hit point (metres).
   */
  damageNumber(point, value, type, size = 1, scatter = 0.3) {
    const n = this.numbers[this.numberCursor];
    this.numberCursor = (this.numberCursor + 1) % this.numbers.length;
    const shown = Math.max(1, Math.round(value));
    n.active = true;
    n.age = 0;
    n.type = type;
    n.tilt = (Math.random() - 0.5) * 24; // degrees
    n.point.copy(point);
    n.point.x += (Math.random() - 0.5) * scatter;
    n.point.y += 0.1 + (Math.random() - 0.3) * scatter;
    n.point.z += (Math.random() - 0.5) * scatter;
    n.el.className = type === 'normal' ? 'dmg' : `dmg ${type}`;
    n.el.style.setProperty('--s', size.toFixed(2));
    n.el.textContent = type === 'crit' ? `${shown}!` : shown;
    n.el.style.display = 'block';
  }

  /* ------------------------------ per-frame -------------------------------- */

  update(dt, camera, spread) {
    // Crosshair gap.
    if (Math.abs(spread - this.last.spread) > 0.25) {
      this.last.spread = spread;
      this.el.crosshair.style.setProperty('--gap', `${spread.toFixed(1)}px`);
    }

    // Vignette: constant at low health (pulsing), plus a flash right after a hit.
    this.hitPulse = Math.max(0, this.hitPulse - dt * 2.2);
    const low = clamp01((0.4 - this.healthFraction) / 0.4);
    const pulse = low * (0.55 + 0.25 * Math.sin(performance.now() * 0.008));
    this.el.vignette.style.opacity = Math.max(pulse, this.hitPulse * 0.65).toFixed(3);

    // Floating damage numbers: project the world point each frame.
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const n of this.numbers) {
      if (!n.active) continue;
      n.age += dt;
      if (n.age >= NUMBER_LIFE) {
        n.active = false;
        n.el.style.display = 'none';
        continue;
      }
      const v = this._ndc.copy(n.point).project(camera);
      if (v.z > 1) { // behind the camera
        n.el.style.display = 'none';
        continue;
      }
      n.el.style.display = 'block';
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h - (n.age / NUMBER_LIFE) * NUMBER_DRIFT_PX;
      // Pop in with overshoot, then hold at scale 1.
      const scale = easeOutBack(Math.min(1, n.age / NUMBER_POP_TIME));
      const fade = Math.min(1, (NUMBER_LIFE - n.age) / 0.3);
      n.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${n.tilt.toFixed(1)}deg) scale(${scale.toFixed(3)})`;
      n.el.style.opacity = fade.toFixed(2);
    }
  }

  clearNumbers() {
    for (const n of this.numbers) {
      n.active = false;
      n.el.style.display = 'none';
    }
  }
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}
