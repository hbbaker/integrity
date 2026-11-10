import { GameMode } from '../../core/client/modes/game-mode.js';

/** MULTIPLAYER: free-for-all deathmatch on your network. The match rules are in game/rules/deathmatch.js. */
export class DeathmatchMode extends GameMode {
  /** @param deps { deathmatch, net, remotes, hud } */
  constructor({ deathmatch, net, remotes, hud }) {
    super('deathmatch');
    this.match = deathmatch;
    this.net = net;
    this.remotes = remotes;
    this.hud = hud;
  }

  get online() { return true; }

  get respawns() { return true; }

  start() {
    this.match.start();
  }

  stop() {
    this.match.stop();
    this.net.close();
    this.remotes.clear();
    this.hud.setKills(0);
  }

  update(dt, { boardHeld }) {
    this.match.update(dt, { boardHeld });
  }

  onPlayerDeath() {
    this.match.onLocalDeath(); // no game-over screen: the match respawns you
    return true;
  }

  onPeerMessage(from, message) {
    this.match.onMessage(from, message);
  }

  onRoster(players) {
    this.match.onRoster(players);
  }
}
