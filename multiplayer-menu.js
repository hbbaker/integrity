import { isValidName, JOIN_ERRORS, NET_STATUS } from './net.js';

/*
 * The MULTIPLAYER screen: pick a username, see who is already in the lobby, join.
 * It only handles the DOM; main.js owns the network client and tells this screen
 * the connection status and roster.
 */

const STORAGE_KEY = 'cable-bots-username';
const STATUS_TEXT = {
  [NET_STATUS.IDLE]: '',
  [NET_STATUS.CONNECTING]: 'CONNECTING...',
  [NET_STATUS.ONLINE]: 'CONNECTED',
  [NET_STATUS.CLOSED]: 'CONNECTION LOST. GO BACK AND TRY AGAIN.',
};

function loadName() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage can be blocked (private windows): the game works without it
  }
}

function saveName(name) {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // not remembered; fine
  }
}

export class MultiplayerMenu {
  /** @param handlers { onJoin(name), onBack() } */
  constructor({ onJoin, onBack }) {
    const $ = (id) => document.getElementById(id);
    this.el = {
      overlay: $('overlay-multiplayer'), name: $('mp-name'), error: $('mp-error'),
      players: $('mp-players'), status: $('mp-status'), join: $('mp-join'), back: $('mp-back'),
    };
    this.online = false;
    this.joining = false;

    this.el.name.value = loadName() ?? `PLAYER${100 + Math.floor(Math.random() * 900)}`;
    this.el.name.addEventListener('input', () => {
      this.el.error.textContent = '';
      this._refreshJoin();
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
      this._refreshJoin();
      onJoin(name);
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
    this.joining = false;
    this.el.error.textContent = '';
    this.el.overlay.style.display = 'flex';
    this._refreshJoin();
    this.el.name.focus();
    this.el.name.select();
  }

  close() {
    this.el.overlay.style.display = 'none';
    this.el.name.blur();
  }

  setStatus(status) {
    this.online = status === NET_STATUS.ONLINE;
    this.el.status.textContent = STATUS_TEXT[status] ?? '';
    this._refreshJoin();
  }

  /** The lobby list; `myId` is highlighted once you have joined. */
  setRoster(players, myId) {
    this.el.players.replaceChildren(...players.map((player) => {
      const item = document.createElement('li');
      item.textContent = player.name; // textContent: names are user input
      if (player.id === myId) item.className = 'me';
      return item;
    }));
    if (!players.length) {
      const empty = document.createElement('li');
      empty.textContent = 'NOBODY YET';
      this.el.players.append(empty);
    }
  }

  /** The server refused the join: say why and let the player edit the name. */
  showError(code) {
    this.joining = false;
    this.el.error.textContent = JOIN_ERRORS[code] ?? 'COULD NOT JOIN';
    this._refreshJoin();
    this.el.name.focus();
  }

  _refreshJoin() {
    this.el.join.disabled = !(this.online && !this.joining && isValidName(this.el.name.value));
  }
}
