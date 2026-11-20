/*
 * The mountain mode's HUD: speed, run time, the finish banner. DOM only; game/rules/ski-run.js feeds it.
 * While it is active the page hides the combat HUD (health, weapon, crosshair): see `body.ski-mode` in index.html.
 */

const KMH_PER_MS = 3.6;

/** Seconds as M:SS.T (1:02.4). */
export function formatRunTime(seconds) {
  const tenths = Math.floor(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = tenths - minutes * 600;
  return `${minutes}:${String(Math.floor(rest / 10)).padStart(2, '0')}.${rest % 10}`;
}

export class SkiHud {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = { dev: $('ski-dev'), speed: $('ski-speed'), edge: $('ski-edge'), time: $('ski-time'), finish: $('ski-finish'), alert: $('ski-alert'), style: $('ski-style'), trick: $('ski-trick'), load: $('ski-load'), loadFill: $('ski-load-fill') };
    this.last = { speed: -1, time: '', edge: '', held: null, alert: null, style: -1, load: null, stomp: null }; // the DOM is only touched when a shown value changes
  }

  /** Show the mountain HUD in place of the combat HUD, or put the combat HUD back. */
  setActive(active) {
    document.body.classList.toggle('ski-mode', active);
  }

  /** The rider's speed, given in metres per second and shown in km/h. */
  setSpeed(metresPerSecond) {
    const shown = Math.round(metresPerSecond * KMH_PER_MS);
    if (shown === this.last.speed) return;
    this.last.speed = shown;
    this.el.speed.textContent = shown;
  }

  /** The name of the edge the rider is on (a brake uses it). `held`: the edge has been held long enough to earn its full reward. */
  setEdge(name, held) {
    if (name !== this.last.edge) {
      this.last.edge = name;
      this.el.edge.textContent = name;
    }
    if (held !== this.last.held) {
      this.last.held = held;
      this.el.edge.classList.toggle('held', held);
    }
  }

  /** The time of the run so far, in seconds. */
  setTime(seconds) {
    const shown = formatRunTime(seconds);
    if (shown === this.last.time) return;
    this.last.time = shown;
    this.el.time.textContent = shown;
  }

  /** The finish banner with the run's time in seconds; null hides it. */
  showFinish(seconds) {
    this.el.finish.textContent = seconds === null ? '' : `FINISH  ${formatRunTime(seconds)}`;
    this.el.finish.style.display = seconds === null ? 'none' : 'block';
  }

  /** The style points of the run so far. */
  setStyle(points) {
    if (points === this.last.style) return;
    this.last.style = points;
    this.el.style.textContent = points;
  }

  /** The name and points of a trick that was just landed; null hides it. */
  showTrick(text) {
    this.el.trick.textContent = text ?? '';
    this.el.trick.style.display = text ? 'block' : 'none';
  }

  /**
   * The gravity load bar, shown in the air: `share` of the load that crashes a landing with no stomp (above 1 the bar is
   * full and red: only a stomp can save it); null hides the bar. `stompPressed`: the stomp was used in this air time.
   */
  setLoad(share, stompPressed) {
    const shown = share === null ? null : Math.round(Math.min(1, share) * 50); // steps of 2 percent: the DOM is touched less
    if (shown !== this.last.load) {
      this.last.load = shown;
      this.el.load.style.display = shown === null ? 'none' : 'block';
      if (shown !== null) this.el.loadFill.style.width = `${shown * 2}%`;
      this.el.load.classList.toggle('over', share !== null && share >= 1);
    }
    if (stompPressed !== this.last.stomp) {
      this.last.stomp = stompPressed;
      this.el.load.classList.toggle('stomp', stompPressed);
    }
  }

  /** A short warning in the middle of the screen ("EDGE!", "CRASH"); null hides it. */
  setAlert(text) {
    if (text === this.last.alert) return;
    this.last.alert = text;
    this.el.alert.textContent = text ?? '';
    this.el.alert.style.display = text ? 'block' : 'none';
  }

  /** The developer line (which keys jump where); null hides it. */
  setDevText(text) {
    this.el.dev.textContent = text ?? '';
    this.el.dev.style.display = text ? 'block' : 'none';
  }
}
