import { GameMode } from '../../core/client/modes/game-mode.js';

/** DEATHMATCH VS BOTS: the deathmatch rules played alone. The match rules are in game/rules/bot-match.js. */
export class BotMatchMode extends GameMode {
  /** @param deps { botMatch } */
  constructor({ botMatch }) {
    super('botmatch');
    this.match = botMatch;
  }

  get respawns() { return true; }

  get simulatesWhileDead() { return true; } // the bots keep coming while you wait to respawn

  start() {
    this.match.start();
  }

  stop() {
    this.match.stop();
  }

  update(dt, { playing, boardHeld }) {
    if (playing) this.match.update(dt, { boardHeld });
  }

  onPlayerDeath() {
    this.match.onPlayerDeath();
    return true;
  }

  onEnemyKilled() {
    this.match.onBotKilled();
  }
}
