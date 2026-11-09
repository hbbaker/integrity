/*
 * DIG SITE HUD: match timer, live ranking, the depth readout for the hole you are
 * aiming at, small hints, and the results screen. There is deliberately no warning of what is
 * buried: a strike is the only signal.
 * DOM only; dig-mode.js feeds it.
 */

const INCHES_PER_FOOT = 12;

/** "18 IN (1 FT 6 IN)" style text for a depth in inches. */
export function formatDepth(inches) {
  if (inches < INCHES_PER_FOOT) return `${inches} IN`;
  const feet = Math.floor(inches / INCHES_PER_FOOT);
  const rest = inches % INCHES_PER_FOOT;
  return `${inches} IN (${feet} FT${rest ? ` ${rest} IN` : ''})`;
}

/** m:ss for a number of seconds. */
export function formatClock(seconds) {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export class DigHud {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      timer: $('dig-timer'), board: $('dig-board'), depth: $('dig-depth-value'), next: $('dig-depth-next'),
      hint: $('dig-hint'),
      results: $('overlay-dig-results'), winner: $('dig-winner'), table: $('dig-results-table'),
      again: $('dig-again'), menu: $('dig-menu'),
    };
    this.last = { timer: '', depth: '', next: '', hint: '', board: '' };
  }

  /** Show or hide the whole DIG SITE HUD (the rest of the game HUD hides itself through a body class). */
  setActive(active) {
    document.body.classList.toggle('dig-mode', active);
    if (!active) {
      this.hideResults();
    }
  }

  /** A solo game's results offer PLAY AGAIN instead of BACK TO LOBBY. */
  setSolo(solo) {
    this.el.again.textContent = solo ? 'PLAY AGAIN' : 'BACK TO LOBBY';
  }

  setTimer(seconds) {
    const text = formatClock(seconds);
    if (text !== this.last.timer) {
      this.last.timer = text;
      this.el.timer.textContent = text;
    }
    this.el.timer.classList.toggle('low', seconds <= 30);
  }

  /** rows: [{ name, score, strikes, me }] in any order. */
  setBoard(rows) {
    const sorted = [...rows].sort((a, b) => b.score - a.score || a.strikes - b.strikes || a.name.localeCompare(b.name));
    const key = JSON.stringify(sorted);
    if (key === this.last.board) return;
    this.last.board = key;
    this.el.board.replaceChildren(...sorted.map((row) => {
      const line = document.createElement('div');
      if (row.me) line.className = 'me';
      const name = document.createElement('span');
      name.textContent = row.name;
      const score = document.createElement('span');
      score.textContent = row.score;
      if (row.strikes) {
        const strikes = document.createElement('small');
        strikes.textContent = ` X${row.strikes}`;
        score.append(strikes);
      }
      line.append(name, score);
      return line;
    }));
  }

  /** The hole under the crosshair: its depth, and what the next layer would pay. */
  setDepth(inches, nextPoints) {
    const depth = formatDepth(inches);
    if (depth !== this.last.depth) {
      this.last.depth = depth;
      this.el.depth.textContent = depth;
    }
    const next = nextPoints > 0 ? `NEXT LAYER +${nextPoints}` : '';
    if (next !== this.last.next) {
      this.last.next = next;
      this.el.next.textContent = next;
    }
  }

  setHint(text) {
    if (text === this.last.hint) return;
    this.last.hint = text;
    this.el.hint.textContent = text;
  }

  /** results: [{ id, name, score, strikes, deepest, left }] best first; winner: player id or null. */
  showResults(results, winnerId, myId) {
    const winner = results.find((row) => row.id === winnerId);
    this.el.winner.textContent = winner ? `${winner.name} WINS WITH ${winner.score}` : 'NO WINNER';
    const table = document.createElement('table');
    const header = table.insertRow();
    for (const label of ['#', 'PLAYER', 'SCORE', 'STRIKES', 'DEEPEST']) {
      const cell = document.createElement('th');
      cell.textContent = label;
      header.append(cell);
    }
    results.forEach((row, index) => {
      const tr = table.insertRow();
      tr.className = [row.id === myId ? 'me' : '', row.left ? 'left' : ''].join(' ').trim();
      const values = [index + 1, row.left ? `${row.name} (LEFT)` : row.name, row.score, row.strikes, formatDepth(row.deepest)];
      for (const value of values) tr.insertCell().textContent = value;
    });
    this.el.table.replaceChildren(...table.children);
    this.el.results.style.display = 'flex';
  }

  hideResults() {
    this.el.results.style.display = 'none';
  }
}
