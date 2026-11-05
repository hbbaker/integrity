import { WEAPON_ICONS } from './hud.js';

/*
 * Inventory menu: three loadout slots (keys 1-3 in play) and the armory of every
 * weapon you can put in them. Click a slot to pick where to assign, then click a
 * gun. A gun that is already in another slot swaps places. The game is paused while
 * this is open (the pointer is released).
 */

// Bars are drawn against these maxima so the stats are comparable across guns.
const MAX_DPS = 140;
const MAX_RANGE = 140;

export class Inventory {
  constructor({ weapons, onResume }) {
    this.weapons = weapons;
    this.onResume = onResume;
    this.root = document.getElementById('inventory');
    this.slotsEl = document.getElementById('inv-slots');
    this.armoryEl = document.getElementById('inv-armory');
    this.isOpen = false;
    this.active = 0; // loadout slot that the next click on a gun assigns to
    this.dirty = false; // has the player changed anything? (only then do we equip on close)

    this.root.addEventListener('click', (event) => {
      const slot = event.target.closest('[data-slot]');
      const gun = event.target.closest('[data-gun]');
      if (event.target.closest('#inv-resume')) this.onResume();
      else if (slot) this.selectSlot(Number(slot.dataset.slot));
      else if (gun) this.assign(Number(gun.dataset.gun));
    });
  }

  open() {
    this.active = Math.max(0, Math.min(2, this.weapons.activeSlot()));
    this.dirty = false;
    this.isOpen = true;
    this.root.style.display = 'flex';
    this.render();
  }

  /** Hide the menu; if the player picked a slot or assigned a gun, equip that slot's weapon. */
  close() {
    this.isOpen = false;
    this.root.style.display = 'none';
    if (this.dirty) this.weapons.selectLoadout(this.active);
  }

  selectSlot(slot) {
    if (slot < 0 || slot > 2) return;
    this.active = slot;
    this.dirty = true;
    this.render();
  }

  assign(weaponIndex) {
    this.weapons.assign(this.active, weaponIndex);
    this.dirty = true;
    this.render();
  }

  _stat(label, fraction) {
    return `<div class="stat"><span>${label}</span><div class="bar"><i style="width:${Math.round(Math.min(1, fraction) * 100)}%"></i></div></div>`;
  }

  _card(info, attrs, tag, active) {
    const mark = info.slot >= 0 && !tag ? `<div class="slotmark">SLOT ${info.slot + 1}</div>` : '';
    return `<div class="panel inv-card${active ? ' active' : ''}" ${attrs}>
      ${tag ? `<div class="tag">${tag}</div>` : ''}${mark}
      <div class="icon">${WEAPON_ICONS[info.id]}</div>
      <div class="name">${info.name}</div>
      ${this._stat('DPS', info.dps / MAX_DPS)}${this._stat('RANGE', info.range / MAX_RANGE)}
      <div class="meta">${info.capacity}</div>
    </div>`;
  }

  render() {
    const armory = this.weapons.armory();
    const byIndex = new Map(armory.map((info) => [info.index, info]));
    this.slotsEl.innerHTML = this.weapons.loadout
      .map((index, slot) => this._card(byIndex.get(index), `data-slot="${slot}"`, `SLOT ${slot + 1}`, slot === this.active))
      .join('');
    this.armoryEl.innerHTML = armory.map((info) => this._card(info, `data-gun="${info.index}"`, '', false)).join('');
  }
}
