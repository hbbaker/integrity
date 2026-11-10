import { GameMode } from '../../core/client/modes/game-mode.js';

/**
 * DIG SITE: find the utilities without striking one. The server decides everything; the client rules are in
 * game/rules/dig-mode.js. Played with others (a shared lobby) or alone (a private match).
 */
export class DigSiteMode extends GameMode {
  /** @param deps { dig, digHud, digLobby, net, remotes, hud, cyborg, renderer, leaveToLobby() } */
  constructor({ dig, digHud, digLobby, net, remotes, hud, cyborg, renderer, leaveToLobby }) {
    super('dig');
    this.dig = dig;
    this.digHud = digHud;
    this.lobby = digLobby;
    this.net = net;
    this.remotes = remotes;
    this.hud = hud;
    this.cyborg = cyborg;
    this.renderer = renderer;
    this.leaveToLobby = leaveToLobby;
  }

  get setup() { return { level: 'dig' }; }

  get online() { return true; }

  get resultsShowing() { return this.dig.ended; }

  get allowsInventory() { return false; }

  get usesRelayRoster() { return false; } // the dig lobby keeps its own player list

  start(map) {
    this.lobby.close();
    this.dig.solo = Boolean(map.solo);
    this.digHud.setSolo(this.dig.solo);
    this.dig.start(map);
    this.cyborg.reset(); // after dig.start: the player now stands on the site's spawn tile
    this.renderer.shadowMap.needsUpdate = true; // the houses and poles are new static shadow casters
  }

  /** reason 'lobby': back to the lobby screen, staying connected. Anything else: leave the server. */
  stop(reason) {
    this.dig.stop();
    if (reason === 'lobby') {
      this.remotes.clear();
      this.hud.clearNumbers();
      document.exitPointerLock();
      this.hud.showStart(false);
      this.lobby.open();
      return;
    }
    this.net.sendGame({ t: 'dg_leave' });
    this.net.close();
    this.remotes.clear();
    this.lobby.reset();
  }

  fixedUpdate(dt, input) {
    this.dig.fixedUpdate(input);
  }

  /** Stand still mid-swing, and no weapon keys. */
  filterInput(input) {
    return this.dig.filterInput(input);
  }

  update(dt) {
    this.dig.update(dt);
  }

  onServerMessage(message) {
    if (message.t !== 'dg_lobby') {
      this.dig.onMessage(message);
      return;
    }
    this.dig.onLobby(message);
    if (message.phase === 'lobby') this.leaveToLobby(); // someone pressed BACK TO LOBBY: everyone follows
  }
}
