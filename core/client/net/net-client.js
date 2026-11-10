/*
 * WebSocket client for the multiplayer relay (server/src/hub.rs).
 *
 * Connect first (so the menu can show who is in the lobby), then join with a
 * username. After joining, send() reaches every other joined player and their
 * messages come back through onMessage(fromId, message).
 */

export const NET_STATUS = { IDLE: 'idle', CONNECTING: 'connecting', ONLINE: 'online', CLOSED: 'closed' };

const PING_INTERVAL = 4000; // ms; the server drops clients that stay silent for 30 s
const SOCKET_PATH = '/ws';

/** Why the server refused a join, in words for the menu. */
export const JOIN_ERRORS = {
  'name-taken': 'NAME TAKEN',
  'bad-name': 'USE 1-16 LETTERS, NUMBERS, SPACE _ -',
  full: 'GAME IS FULL',
};

const NAME_PATTERN = /^[A-Za-z0-9 _-]{1,16}$/;

/** Same rule the server enforces, so the menu can disable JOIN early. */
export function isValidName(name) {
  return NAME_PATTERN.test(name.trim());
}

export class NetClient {
  /**
   * @param handlers { onStatus(status), onRoster(players), onJoinError(code), onMessage(fromId, message), onGame(message) }
   * onGame receives the game server's own messages: every message whose type starts with `gamePrefix`.
   * @param options { gamePrefix } the type prefix of those messages (for example "dg_"); none means no game messages.
   */
  constructor(handlers, { gamePrefix = null } = {}) {
    this.handlers = handlers;
    this.gamePrefix = gamePrefix;
    this.status = NET_STATUS.IDLE;
    this.id = 0; // assigned by the server on connect
    this.players = []; // roster: [{ id, name }] of joined players
    this.latency = 0; // ms, smoothed round trip
    this.socket = null;
    this.pingTimer = 0;
  }

  get joined() {
    return this.players.some((player) => player.id === this.id);
  }

  connect() {
    if (this.socket) return;
    this._setStatus(NET_STATUS.CONNECTING);
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${location.host}${SOCKET_PATH}`);
    this.socket = socket;
    socket.onopen = () => {
      this._setStatus(NET_STATUS.ONLINE);
      this._ping();
      this.pingTimer = setInterval(() => this._ping(), PING_INTERVAL);
    };
    socket.onmessage = (event) => this._receive(event.data);
    socket.onclose = () => this._closed(socket);
    socket.onerror = () => {}; // onclose always follows and reports it
  }

  join(name) {
    this._send({ t: 'join', name: name.trim() });
  }

  /** Send a game message to every other joined player. No-op until joined. */
  send(message) {
    if (this.joined) this._send(message);
  }

  close() {
    const socket = this.socket;
    if (!socket) return;
    socket.close();
    this._closed(socket);
  }

  _send(message) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  _ping() {
    this._send({ t: 'ping', n: Math.round(performance.now()) });
  }

  _receive(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return; // never let one bad packet break the game
    }
    if (message.from !== undefined) {
      this.handlers.onMessage(message.from, message.m);
      return;
    }
    switch (message.t) {
      case 'welcome':
        this.id = message.id;
        break;
      case 'roster':
        this.players = message.players;
        this.handlers.onRoster(this.players);
        break;
      case 'error':
        this.handlers.onJoinError(message.code);
        break;
      case 'pong': {
        const rtt = performance.now() - message.n;
        this.latency = this.latency ? this.latency * 0.7 + rtt * 0.3 : rtt;
        break;
      }
      default:
        if (this.gamePrefix && typeof message.t === 'string' && message.t.startsWith(this.gamePrefix)) this.handlers.onGame(message);
        break;
    }
  }

  /** Send a message to the game server's own logic (a lobby, a match). Unlike send(), it needs no deathmatch join. */
  sendGame(message) {
    this._send(message);
  }

  _closed(socket) {
    if (this.socket !== socket) return;
    clearInterval(this.pingTimer);
    this.socket = null;
    this.id = 0;
    this.players = [];
    this._setStatus(NET_STATUS.CLOSED);
    this.handlers.onRoster(this.players);
  }

  _setStatus(status) {
    this.status = status;
    this.handlers.onStatus(status);
  }
}
