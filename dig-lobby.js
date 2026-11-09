import { isValidName, NET_STATUS } from './net.js';
import { loadName, saveName } from './multiplayer-menu.js';

/*
 * The DIG SITE lobby screen: pick a username and join, watch who else is in, and
 * (for the host) start the match. DOM only; main.js owns the network client and
 * hands this screen the connection status and the server's lobby messages.
 */

const ERROR_TEXT = {
  'name-taken': 'NAME TAKEN',
  'bad-name': 'USE 1-16 LETTERS, NUMBERS, SPACE _ -',
  full: 'LOBBY IS FULL',
  'in-progress': 'A MATCH IS RUNNING. TRY AGAIN WHEN IT ENDS.',
  'too-few': 'NOT ENOUGH PLAYERS TO START',
  'not-host': 'ONLY THE HOST CAN START',
};

export class DigLobbyScreen {
  /** @param handlers { onJoin(name), onStart(), onBack() } */
  constructor({ onJoin, onStart, onBack }) {
    const $ = (id) => document.getElementById(id);
    this.el = {
      overlay: $('overlay-dig'), name: $('dig-name'), error: $('dig-error'), players: $('dig-players'),
      status: $('dig-status'), join: $('dig-join'), start: $('dig-start'), back: $('dig-back'),
    };
    this.online = false;
    this.joined = false;
    this.joining = false;
    this.min = 2;
    this.playerCount = 0;
    this.isHost = false;
    this.phase = 'lobby';

    this.el.name.value = loadName() ?? `PLAYER${100 + Math.floor(Math.random() * 900)}`;
    this.el.name.addEventListener('input', () => {
      this.el.error.textContent = '';
      this._refresh();
    });
    this.el.name.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && !this.el.join.disabled) this.el.join.click();
    });
    this.el.join.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.el.join.disabled) return;
      const name = this.el.name.value.trim();
      saveName(name);
      this.joining = true;
      this._refresh();
      onJoin(name);
    });
    this.el.start.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.el.start.disabled) onStart();
    });
    this.el.back.addEventListener('click', (e) => {
      e.stopPropagation();
      onBack();
    });
    this.el.overlay.addEventListener('click', (e) => e.stopPropagation());
  }

  get isOpen() {
    return this.el.overlay.style.display === 'flex';
  }

  open() {
    this.el.error.textContent = '';
    this.el.overlay.style.display = 'flex';
    this._refresh();
    if (!this.joined) {
      this.el.name.focus();
      this.el.name.select();
    }
  }

  close() {
    this.el.overlay.style.display = 'none';
    this.el.name.blur();
  }

  /** Forget everything about the lobby (back to the main menu). */
  reset() {
    this.joined = false;
    this.joining = false;
    this.isHost = false;
    this.playerCount = 0;
    this.phase = 'lobby';
    this.el.players.replaceChildren();
    this.el.error.textContent = '';
    this._refresh();
  }

  setStatus(status) {
    this.online = status === NET_STATUS.ONLINE;
    this.connectionLost = status === NET_STATUS.CLOSED;
    this._refresh();
  }

  /** The server's `dg_lobby` message: who is in, who hosts, and which phase the lobby is in. */
  setLobby(message, myId) {
    this.min = message.min;
    this.phase = message.phase;
    this.playerCount = message.players.length;
    this.joined = message.players.some((player) => player.id === myId);
    this.joining = false;
    this.isHost = this.joined && message.host === myId;
    this.el.players.replaceChildren(...message.players.map((player) => {
      const item = document.createElement('li');
      item.textContent = player.name; // textContent: names are user input
      const classes = [];
      if (player.id === myId) classes.push('me');
      if (player.id === message.host) classes.push('host');
      item.className = classes.join(' ');
      return item;
    }));
    if (!message.players.length) {
      const empty = document.createElement('li');
      empty.textContent = 'NOBODY YET';
      this.el.players.append(empty);
    }
    this._refresh();
  }

  showError(code) {
    this.joining = false;
    this.el.error.textContent = ERROR_TEXT[code] ?? 'SOMETHING WENT WRONG';
    this._refresh();
  }

  _refresh() {
    this.el.name.disabled = this.joined;
    this.el.join.style.display = this.joined ? 'none' : '';
    this.el.join.disabled = !(this.online && !this.joining && isValidName(this.el.name.value));
    this.el.start.style.display = this.joined && this.isHost ? '' : 'none';
    this.el.start.disabled = !(this.playerCount >= this.min && this.phase === 'lobby');
    this.el.status.textContent = this._statusText();
  }

  _statusText() {
    if (this.connectionLost) return 'CONNECTION LOST. GO BACK AND TRY AGAIN.';
    if (!this.online) return 'CONNECTING...';
    if (!this.joined) return 'CONNECTED';
    if (!this.isHost) return 'WAITING FOR THE HOST TO START';
    if (this.playerCount < this.min) return `NEED ${this.min} PLAYERS TO START (${this.playerCount}/${this.min})`;
    return 'READY. PRESS START GAME.';
  }
}
