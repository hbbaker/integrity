/*
 * The MOUNTAIN menu: pick what to ride, then a course. DOM only; main.js starts the mountain mode with the choice.
 */
export class SkiMenu {
  /** @param options { rides (ids, the first is chosen at the start), onCourse(course, ride), onBack() } */
  constructor({ rides, onCourse, onBack }) {
    const $ = (id) => document.getElementById(id);
    const wire = (element, handler) => element.addEventListener('click', (e) => {
      e.stopPropagation();
      handler();
    });
    this.el = { overlay: $('overlay-ski'), rides: Object.fromEntries(rides.map((ride) => [ride, $(`ski-ride-${ride}`)])) };
    this.ride = rides[0];
    for (const ride of rides) wire(this.el.rides[ride], () => this._choose(ride));
    wire($('ski-freeride'), () => onCourse('freeride', this.ride));
    wire($('ski-back'), onBack);
    this.el.overlay.addEventListener('click', (e) => e.stopPropagation());
    this._choose(this.ride);
  }

  _choose(ride) {
    this.ride = ride;
    for (const [id, button] of Object.entries(this.el.rides)) button.classList.toggle('active', id === ride);
  }

  open() {
    this.el.overlay.style.display = 'flex';
  }

  close() {
    this.el.overlay.style.display = 'none';
  }
}
