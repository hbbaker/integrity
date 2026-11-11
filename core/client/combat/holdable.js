/*
 * HOLDABLE: anything the player can hold in their hands.
 *
 * A Holdable is one item in the hands slot list. The HoldableSystem (holdable-system.js) owns the
 * hands (the first-person viewmodel, switching, aiming, recoil springs) and asks the item in hand
 * what to do through the hooks below. Every hook has a do-nothing default, so a new kind of item
 * overrides only what it needs. Weapon (weapon.js) is one subclass; a game can add others (a tool,
 * a camera, a grenade) without touching the core: extend Holdable and register the class.
 *
 * `holder` in every hook is the HoldableSystem: it carries the shared hand state (cooldown, aiming,
 * recoil) and the game services (player, world, targets, effects, hud, audio).
 */

export class Holdable {
  /** @param base the item's config entry: { id, name, type, hidden, melee, ... } */
  constructor(base) {
    this.base = base;
    this.cfg = base; // the active config; a subclass with variants (ammo types) points this at the current one
    this.mag = 0; // rounds in the item; 0 for items without ammo
    this.reserve = 0;
  }

  get id() { return this.cfg.id; }

  get name() { return this.base.name; }

  /** Hidden items are not in the inventory menu and cannot go in a loadout slot (a game's special tool). */
  get hidden() { return Boolean(this.cfg.hidden); }

  /** Short-range items: no aiming down sights, no reload, no quick melee of their own. */
  get melee() { return Boolean(this.cfg.melee); }

  /** True when holding the aim control raises sights and bots should dodge your crosshair. */
  get aimable() { return false; }

  /** True while the item is mid-way through loading a single round (drives the viewmodel tilt). */
  get loadingRoundByRound() { return false; }

  /* ------------------------------ lifecycle ------------------------------ */

  /** Back to the starting state (full ammo, nothing in progress). */
  reset() {}

  /** Keep the item full (sandbox cheat); optional. */
  refill() {}

  /** Keep only the spare ammo full, not the magazine (sandbox: infinite reserve); optional. */
  refillReserve() {}

  // The hooks below do nothing by default. Subclasses override them with the parameters named in each comment.

  /** onAttach(holder): the system was built; create any world-space visuals the item needs. */
  onAttach() {}

  /** onDeselect(holder): the player started switching away from this item; cancel anything in progress. */
  onDeselect() {}

  /** onEquip(holder): the item is now in hand. */
  onEquip() {}

  /** cease(holder): the game stopped running (menu, pause, death) or the player is switching; stop continuous effects. */
  cease() {}

  /* ---------------------------- per-step hooks ---------------------------- */

  /** tick(holder, dt): every fixed step while this item is the one in hand, even while switching. */
  tick() {}

  /** backgroundTick(holder, dt): every fixed step for EVERY item, in hand or not. For things the item launched (a projectile in flight). */
  backgroundTick() {}

  /** onPeerMessage(holder, from, message): a message another player's copy of this item sent with holder.sendItemMessage. */
  onPeerMessage() {}

  /** fixedUpdate(holder, dt, input): every fixed step while in hand and not switching. Read the input here: fire, reload, aim. */
  fixedUpdate() {}

  /** startReload(holder): the reload control was pressed. */
  startReload() {}

  /** swapAmmo(holder): the ammo-swap control was pressed. */
  swapAmmo() {}

  /** addAmmo(amounts): pickups; `amounts` maps pickup keys to quantities. Return true if anything was taken. */
  addAmmo() { return false; }

  /* ---------------------------- per-frame hooks ---------------------------- */

  /**
   * poseView(holder, pose, dt, time, model): adjust the viewmodel pose. `pose` is { x, y, z, rx, ry, rz, supportDrop }
   * in viewmodel space, already holding the shared bob, sway, sights and kick; add the item's own motion to it.
   */
  poseView() {}

  /** After the pose is applied: animate the model's own parts. */
  afterPose(holder, model, dt, time) {
    if (!model.animate) return;
    const state = this.modelState(holder);
    model.animate(dt, time, state);
    holder.tp?.animateGun(holder.index, dt, time, state);
  }

  /** What the model's `animate` hook gets to read. */
  modelState() { return {}; }

  /* ------------------------------- display -------------------------------- */

  /** What the HUD shows for this item. */
  hudState() {
    return { mag: 0, reserve: 0, reloading: false, melee: this.melee, altAmmo: '' };
  }

  /** Stats for the inventory menu. */
  describe() {
    return { dps: 0, range: 0, capacity: '' };
  }
}
