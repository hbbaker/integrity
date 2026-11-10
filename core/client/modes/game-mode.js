/*
 * GAME MODE: one way to play (a wave survival, a deathmatch, a puzzle). The ModeManager
 * (mode-manager.js) runs whichever mode is current and calls these hooks; every hook has a
 * do-nothing default, so a mode overrides only what it needs.
 *
 * A mode never has to know about the others. To add one: extend GameMode, give it an `id`,
 * and register an instance with the manager.
 */

export class GameMode {
  constructor(id) {
    this.id = id;
  }

  /**
   * Level parameters the game's `prepare` step reads before the mode starts. The keys are the game's own
   * (for example: level, fog, spawn point, invulnerable, infiniteAmmo); the core does not read them.
   */
  get setup() { return {}; }

  /** Plays over the network: the world keeps running when the mouse is released, and a lost connection ends the mode. */
  get online() { return false; }

  /** The player comes back after dying, so the world keeps running while they wait. */
  get respawns() { return false; }

  /** The world keeps stepping (bots, spawns) while the local player is dead and waiting to respawn. */
  get simulatesWhileDead() { return false; }

  /** The mode uses the relay's list of connected players (the multiplayer roster). */
  get usesRelayRoster() { return true; }

  /** A results screen is up: the simulation stops and nothing can be resumed. */
  get resultsShowing() { return false; }

  /** The inventory screen may be opened in this mode. */
  get allowsInventory() { return true; }

  /** Can the player take the game back after the mouse was released? (`player` is the local player.) */
  canResume(player) { return !this.resultsShowing && (player.alive || this.respawns); }

  // The hooks below do nothing by default. A mode overrides them with the parameters named in each comment.

  /** start(payload): the manager built the level and reset the player; begin the mode. `payload` is whatever the starter passed. */
  start() {}

  /** stop(reason): leave the mode. `reason` says why: 'menu' (back to the main menu) or a mode-specific reason. */
  stop() {}

  /** fixedUpdate(dt, input): once per fixed step, before the player and weapons update. */
  fixedUpdate() {}

  /** afterFixedUpdate(dt): once per fixed step, after the player, weapons and bots have stepped. */
  afterFixedUpdate() {}

  /** The input the player and weapons see this step (a mode may block movement or keys). */
  filterInput(input) { return input; }

  /** update(dt, frame): once per rendered frame. `frame` is { playing, boardHeld }. */
  update() {}

  /** The local player died. Return true if the mode handled it (no default game-over screen). */
  onPlayerDeath() { return false; }

  /** onEnemyKilled(enemy): one of the game's bots was killed by the local player. */
  onEnemyKilled() {}

  /** onPeerMessage(from, message): a message from another player (a relayed message). */
  onPeerMessage() {}

  /** onServerMessage(message): a message from the game server's own logic. */
  onServerMessage() {}

  /** onRoster(players): the list of connected players changed. */
  onRoster() {}
}
