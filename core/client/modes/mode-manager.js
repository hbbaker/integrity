/*
 * MODE MANAGER: holds the registered game modes, starts and stops them, and forwards the game's events
 * to whichever one is current (and does nothing when none is).
 *
 * The game supplies two hooks for the work every mode shares:
 *   prepare(mode, payload)  build the level, reset the player and weapons, clear enemies (before mode.start)
 *   cleanup(mode, reason)   what returning to the menu must undo (after mode.stop)
 */

export class ModeManager {
  constructor({ prepare, cleanup }) {
    this.prepare = prepare;
    this.cleanup = cleanup;
    this.modes = new Map();
    this.current = null;
  }

  register(mode) {
    this.modes.set(mode.id, mode);
    return mode;
  }

  /** The id of the running mode, or null in the menu. */
  get id() {
    return this.current?.id ?? null;
  }

  /** Start (or restart) a mode. */
  start(id, payload = null) {
    const mode = this.modes.get(id);
    if (!mode) throw new Error(`no game mode "${id}" is registered`);
    this.current = mode;
    this.prepare(mode, payload);
    mode.start(payload);
  }

  /** Leave the running mode. `current` is cleared first: closing a connection reports "closed", which must not re-enter. */
  stop(reason = 'menu') {
    const mode = this.current;
    this.current = null;
    mode?.stop(reason);
    this.cleanup(mode, reason);
  }

  /* Queries: safe to ask in the menu (no mode). */
  get online() { return this.current?.online ?? false; }

  get respawns() { return this.current?.respawns ?? false; }

  get simulatesWhileDead() { return this.current?.simulatesWhileDead ?? false; }

  get usesRelayRoster() { return this.current?.usesRelayRoster ?? true; }

  get resultsShowing() { return this.current?.resultsShowing ?? false; }

  get allowsInventory() { return this.current?.allowsInventory ?? false; }

  canResume(player) { return this.current !== null && this.current.canResume(player); }

  /* Event forwards. */
  fixedUpdate(dt, input) { this.current?.fixedUpdate(dt, input); }

  afterFixedUpdate(dt) { this.current?.afterFixedUpdate(dt); }

  filterInput(input) { return this.current ? this.current.filterInput(input) : input; }

  update(dt, frame) { this.current?.update(dt, frame); }

  /** Returns true if the mode handled the death. */
  onPlayerDeath() { return this.current?.onPlayerDeath() ?? false; }

  onEnemyKilled(enemy) { this.current?.onEnemyKilled(enemy); }

  onPeerMessage(from, message) { this.current?.onPeerMessage(from, message); }

  onServerMessage(message) { this.current?.onServerMessage(message); }

  onRoster(players) { this.current?.onRoster(players); }
}
