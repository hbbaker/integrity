/*
 * Multiplayer HUD pieces: the hold-to-show scoreboard, the kill feed, the
 * respawn countdown and the ping readout. DOM only; main.js feeds it data.
 */

const FEED_LIFETIME = 5000; // ms
const FEED_MAX = 5;
const MINI_ROWS = 3;

/** Kills per death. With no deaths yet it is simply the kill count, so a flawless 5-0 reads 5.00. */
export function kdRatio(kills, deaths) {
  return deaths === 0 ? kills : kills / deaths;
}

export function formatKd(kills, deaths) {
  return kdRatio(kills, deaths).toFixed(2);
}

/** Best first: most kills, then the better K/D, then fewer deaths, then name. */
export function rankRows(rows) {
  return [...rows].sort((a, b) =>
    b.kills - a.kills
    || kdRatio(b.kills, b.deaths) - kdRatio(a.kills, a.deaths)
    || a.deaths - b.deaths
    || a.name.localeCompare(b.name));
}

export class Scoreboard {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = { board: $('scoreboard'), mini: $('mini-board'), feed: $('kill-feed'), respawn: $('respawn'), ping: $('ping') };
    this.visible = false;
    this.lastPing = -1;
  }

  setVisible(visible) {
    this.visible = visible;
    this.el.board.style.display = visible ? 'block' : 'none';
  }

  /**
   * @param rows [{ id, name, kills, deaths, wins, me }] in any order; shown ranked best first
   * @param title the heading, e.g. "SCOREBOARD" or "ADA WINS"
   */
  render(rows, pingMs, title = 'SCOREBOARD') {
    const table = document.createElement('table');
    const header = table.insertRow();
    for (const label of ['#', 'PLAYER', 'KILLS', 'DEATHS', 'K/D', 'WINS']) {
      const cell = document.createElement('th');
      cell.textContent = label;
      header.append(cell);
    }
    rankRows(rows).forEach((row, index) => {
      const tr = table.insertRow();
      if (row.me) tr.className = 'me';
      for (const value of [index + 1, row.name, row.kills, row.deaths, formatKd(row.kills, row.deaths), row.wins]) {
        tr.insertCell().textContent = value;
      }
    });
    const heading = document.createElement('h3');
    const ping = document.createElement('small');
    ping.textContent = `PING ${Math.round(pingMs)} MS`;
    heading.append(title, ping);
    this.el.board.replaceChildren(heading, table);
  }

  /** The always-visible top three, in the corner. */
  renderMini(rows) {
    const top = rankRows(rows).slice(0, MINI_ROWS);
    this.el.mini.replaceChildren(...top.map((row, index) => {
      const line = document.createElement('div');
      if (row.me) line.className = 'me';
      line.textContent = `${index + 1}. ${row.name}  ${row.kills}/${row.deaths}  (${formatKd(row.kills, row.deaths)})`;
      return line;
    }));
  }

  setMiniVisible(visible) {
    this.el.mini.style.display = visible ? 'block' : 'none';
  }

  /** A line in the kill feed that fades out after a few seconds. */
  feed(text, mine) {
    const line = document.createElement('div');
    line.textContent = text;
    if (mine) line.className = 'mine';
    this.el.feed.append(line);
    while (this.el.feed.children.length > FEED_MAX) this.el.feed.firstChild.remove();
    setTimeout(() => line.remove(), FEED_LIFETIME);
  }

  clearFeed() {
    this.el.feed.replaceChildren();
  }

  /** Whole seconds left to respawn, or null to hide. */
  setRespawn(seconds) {
    const text = seconds === null ? '' : `RESPAWNING IN ${seconds}`;
    this.el.respawn.textContent = text;
    this.el.respawn.style.display = seconds === null ? 'none' : 'block';
  }

  setPing(ms) {
    const rounded = ms === null ? -1 : Math.round(ms);
    if (rounded === this.lastPing) return;
    this.lastPing = rounded;
    this.el.ping.style.display = rounded < 0 ? 'none' : 'block';
    this.el.ping.textContent = `PING ${rounded} MS`;
  }
}
