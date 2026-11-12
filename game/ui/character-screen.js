import { WEAPON_ICONS } from './hud.js';
import { CONFIG } from '../config.js';
import { CharacterPreview } from './character-preview.js';
import { SLOT_LABELS, SUIT_PARTS, SUIT_SLOTS } from '../suit/suit-parts.js';

/*
 * The character screen (the I key): the character in the middle, the three weapon slots
 * on the left (hover a slot to open the list of weapons for it, click one to fit it) and
 * the mech suit on the right (equip it, customize each part, set it down in the world).
 * With developer mode on there is an extra DEV tab that lists every item and part.
 *
 * The game is paused while this is open (the pointer is released).
 */

const SLOT_COUNT = 3;
// Bars are drawn against these maxima so the stats are comparable across guns.
const MAX_DPS = 140;
const MAX_RANGE = 140;

const TAB_CHARACTER = 'character';
const TAB_DEV = 'dev';

const defaultPreview = ({ canvas, selection }) => new CharacterPreview({ canvas, suitScale: CONFIG.suit.scale, selection });

export class CharacterScreen {
  /**
   * @param {object} options
   * @param {object} options.weapons the holdable system (loadout, assign, armory, describe)
   * @param {import('../suit/suit-state.js').SuitState} options.suitState
   * @param {{ canPlace(): boolean, place(): void, canPickUp(): boolean, pickUp(): void, exit(): void }} options.suitActions what the world does with the suit (place and pick up arm a beacon)
   * @param {() => void} options.onResume close the screen and go back to the game
   * @param {boolean} [options.devMode] show the DEV tab
   * @param {(args: object) => object} [options.createPreview] replaces the 3D turntable (tests)
   */
  constructor({ weapons, suitState, suitActions, onResume, devMode = false, createPreview = defaultPreview }) {
    this.weapons = weapons;
    this.suitState = suitState;
    this.suitActions = suitActions;
    this.onResume = onResume;
    this.devMode = devMode;
    this.createPreview = createPreview;

    this.root = document.getElementById('character');
    this.tabsEl = document.getElementById('char-tabs');
    this.slotsEl = document.getElementById('char-slots');
    this.flyoutEl = document.getElementById('char-flyout');
    this.leftEl = document.getElementById('char-left');
    this.canvas = document.getElementById('char-preview');
    this.suitEl = document.getElementById('char-suit');
    this.devEl = document.getElementById('char-dev');
    this.mainEl = document.getElementById('char-main');

    this.isOpen = false;
    this.tab = TAB_CHARACTER;
    this.active = 0; // loadout slot that the next click on a gun assigns to
    this.hovered = -1; // slot whose weapon list is open
    this.devTarget = 0; // slot the DEV tab fits items into
    this.customizing = false;
    this.dirty = false; // has the player changed anything? (only then do we equip on close)
    this.preview = null;

    this.root.addEventListener('click', (event) => this._onClick(event));
    this.root.addEventListener('pointerover', (event) => this._onHover(event));
    this.leftEl.addEventListener('pointerleave', () => this._hover(-1));
    this.unsubscribe = suitState.onChange(() => { if (this.isOpen) this.render(); });
  }

  setDevMode(enabled) {
    this.devMode = enabled;
    if (!enabled && this.tab === TAB_DEV) this.tab = TAB_CHARACTER;
    if (this.isOpen) this.render();
  }

  open() {
    this.active = Math.max(0, Math.min(SLOT_COUNT - 1, this.weapons.activeSlot()));
    this.devTarget = this.active;
    this.dirty = false;
    this.hovered = -1;
    this.customizing = false;
    this.isOpen = true;
    this.root.style.display = 'flex';
    if (!this.preview) this.preview = this.createPreview({ canvas: this.canvas, selection: this.suitState.selection });
    this.render();
    this.preview.start();
  }

  /** Hide the screen; if the player picked a slot or fitted a gun, equip that slot's weapon. */
  close() {
    this.isOpen = false;
    this.root.style.display = 'none';
    this.preview?.stop();
    if (this.dirty) this.weapons.selectLoadout(this.active);
  }

  selectSlot(slot) {
    if (slot < 0 || slot >= SLOT_COUNT) return;
    this.active = slot;
    this.dirty = true;
    this.render();
  }

  /** Fit a weapon into the slot the next click targets (the DEV tab uses its own target). */
  assign(weaponIndex, slot = this.active) {
    this.weapons.assign(slot, weaponIndex);
    this.dirty = true;
    this.render();
  }

  setTab(tab) {
    if (tab === TAB_DEV && !this.devMode) return;
    this.tab = tab;
    this.render();
  }

  fitPart(slot, id) {
    this.suitState.setPart(slot, id);
    this.preview?.setPart(slot, id);
    this.render();
  }

  /* ------------------------------- events -------------------------------- */

  _onClick(event) {
    const hit = (selector) => event.target.closest(selector);
    const tab = hit('[data-tab]');
    const slot = hit('[data-slot]');
    const gun = hit('[data-gun]');
    const part = hit('[data-part]');
    const action = hit('[data-action]');
    if (hit('#char-resume')) this.onResume();
    else if (tab) this.setTab(tab.dataset.tab);
    else if (action) this._runAction(action.dataset.action);
    else if (part) this.fitPart(part.dataset.slotName, part.dataset.part);
    else if (hit('[data-target]')) this._setDevTarget(Number(hit('[data-target]').dataset.target));
    else if (gun) this.assign(Number(gun.dataset.gun), this.tab === TAB_DEV ? this.devTarget : this.hovered >= 0 ? this.hovered : this.active);
    else if (slot) this.selectSlot(Number(slot.dataset.slot));
  }

  _onHover(event) {
    const slot = event.target.closest('[data-slot]');
    if (slot) this._hover(Number(slot.dataset.slot));
  }

  _hover(slot) {
    if (this.hovered === slot) return;
    this.hovered = slot;
    this._renderFlyout();
  }

  _setDevTarget(slot) {
    this.devTarget = slot;
    this.render();
  }

  _runAction(action) {
    const suit = this.suitState;
    if (action === 'equip') suit.setOwned(true);
    else if (action === 'unequip') suit.setOwned(false);
    else if (action === 'customize') {
      this.customizing = !this.customizing;
      this.render();
    } else if (action === 'place') this.suitActions.place();
    else if (action === 'pickup') this.suitActions.pickUp();
    else if (action === 'exit') this.suitActions.exit();
  }

  /* ------------------------------- drawing ------------------------------- */

  _stat(label, fraction) {
    return `<div class="stat"><span>${label}</span><div class="bar"><i style="width:${Math.round(Math.min(1, fraction) * 100)}%"></i></div></div>`;
  }

  _card(info, attrs, tag, active) {
    const mark = info.slot >= 0 && !tag ? `<div class="slotmark">SLOT ${info.slot + 1}</div>` : '';
    return `<div class="panel inv-card${active ? ' active' : ''}" ${attrs}>
      ${tag ? `<div class="tag">${tag}</div>` : ''}${mark}
      <div class="icon">${WEAPON_ICONS[info.id] ?? ''}</div>
      <div class="name">${info.name}</div>
      ${this._stat('DPS', info.dps / MAX_DPS)}${this._stat('RANGE', info.range / MAX_RANGE)}
      <div class="meta">${info.capacity}</div>
    </div>`;
  }

  render() {
    this.mainEl.style.display = this.tab === TAB_CHARACTER ? 'grid' : 'none';
    this.devEl.style.display = this.tab === TAB_DEV ? 'block' : 'none';
    this.tabsEl.innerHTML = [[TAB_CHARACTER, 'CHARACTER'], ...(this.devMode ? [[TAB_DEV, 'DEV']] : [])]
      .map(([id, label]) => `<button class="panel menu-btn${this.tab === id ? ' active' : ''}" data-tab="${id}">${label}</button>`)
      .join('');

    const armory = this.weapons.armory();
    const byIndex = new Map(armory.map((info) => [info.index, info]));
    this.slotsEl.innerHTML = this.weapons.loadout
      .map((index, slot) => this._card(byIndex.get(index) ?? this.weapons.describe(index), `data-slot="${slot}"`, `SLOT ${slot + 1}`, slot === this.active))
      .join('');
    this._renderFlyout();
    this._renderSuit();
    if (this.tab === TAB_DEV) this._renderDev();
    this.preview?.showSuit(this.customizing || this.suitState.occupied);
  }

  _renderFlyout() {
    if (this.hovered < 0) {
      this.flyoutEl.style.display = 'none';
      return;
    }
    const armory = this.weapons.armory();
    this.flyoutEl.style.display = 'flex';
    this.flyoutEl.innerHTML = `<div class="tag">PICK A WEAPON FOR SLOT ${this.hovered + 1}</div>`
      + armory.map((info) => this._card(info, `data-gun="${info.index}"`, '', false)).join('');
  }

  _renderSuit() {
    const suit = this.suitState;
    const button = (action, label) => `<button class="panel menu-btn" data-action="${action}">${label}</button>`;
    if (!suit.owned) {
      this.suitEl.innerHTML = `<h3>MECH SUIT</h3><p class="meta">NO SUIT EQUIPPED</p>${button('equip', 'EQUIP SUIT')}`;
      return;
    }
    const status = suit.occupied ? 'YOU ARE INSIDE' : suit.placed ? 'OUT IN THE WORLD' : this.suitActions.canPlace() ? 'READY TO CALL DOWN' : 'ON ITS WAY';
    const buttons = [button('customize', this.customizing ? 'DONE' : 'CUSTOMIZE')];
    const gated = (action, label, allowed) => `<button class="panel menu-btn" data-action="${action}"${allowed ? '' : ' disabled'}>${label}</button>`;
    if (suit.occupied) buttons.push(button('exit', 'EXIT SUIT'));
    else if (suit.placed) buttons.push(gated('pickup', 'RECALL BEACON', this.suitActions.canPickUp()));
    else buttons.push(gated('place', 'DROP BEACON', this.suitActions.canPlace()));
    if (!suit.occupied && !suit.placed) buttons.push(button('unequip', 'UNEQUIP'));
    this.suitEl.innerHTML = `<h3>MECH SUIT</h3><p class="meta">${status}</p><div class="btn-row">${buttons.join('')}</div>`
      + (this.customizing ? this._partRows() : this._partSummary());
  }

  _partSummary() {
    return `<div class="suit-summary">${SUIT_SLOTS.map((slot) => {
      const part = SUIT_PARTS[slot].find((p) => p.id === this.suitState.selection[slot]);
      return `<div><span>${SLOT_LABELS[slot]}</span><b>${part.name}</b></div>`;
    }).join('')}</div>`;
  }

  _partRows() {
    return SUIT_SLOTS.map((slot) => `<div class="part-row"><div class="tag">${SLOT_LABELS[slot]}</div><div class="part-options">${
      SUIT_PARTS[slot].map((part) => `<button class="panel part${this.suitState.selection[slot] === part.id ? ' active' : ''}" data-slot-name="${slot}" data-part="${part.id}">${part.name}</button>`).join('')
    }</div></div>`).join('');
  }

  _renderDev() {
    const targets = Array.from({ length: SLOT_COUNT }, (_, slot) => `<button class="panel menu-btn${this.devTarget === slot ? ' active' : ''}" data-target="${slot}">SLOT ${slot + 1}</button>`).join('');
    const items = this.weapons.slots
      .map((_, index) => index)
      .filter((index) => index !== this.weapons.handsIndex)
      .map((index) => this._card(this.weapons.describe(index), `data-gun="${index}"`, '', false))
      .join('');
    this.devEl.innerHTML = `<h3>FIT INTO</h3><div class="btn-row">${targets}</div>`
      + `<h3>ALL ITEMS</h3><div id="char-dev-items">${items}</div>`
      + `<h3>SUIT PARTS</h3>${this._partRows()}`
      + `<div class="btn-row"><button class="panel menu-btn" data-action="${this.suitState.owned ? 'unequip' : 'equip'}">${this.suitState.owned ? 'TAKE SUIT AWAY' : 'GIVE SUIT'}</button></div>`;
  }
}
