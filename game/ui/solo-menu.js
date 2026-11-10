/*
 * The SANDBOX menu: the solo modes you can play alone. DOM only; main.js starts the
 * chosen mode. `setStatus` shows a line of text (for example while DIG SITE connects).
 */
export class SoloMenu {
  /** @param handlers { onSandbox(), onDig(), onBots(), onBack() } */
  constructor({ onSandbox, onDig, onBots, onBack }) {
    const $ = (id) => document.getElementById(id);
    this.el = { overlay: $('overlay-solo'), status: $('solo-status') };
    const wire = (id, handler) => $(id).addEventListener('click', (e) => {
      e.stopPropagation();
      handler();
    });
    wire('solo-sandbox', onSandbox);
    wire('solo-dig', onDig);
    wire('solo-bots', onBots);
    wire('solo-back', onBack);
    this.el.overlay.addEventListener('click', (e) => e.stopPropagation());
  }

  open() {
    this.setStatus('');
    this.el.overlay.style.display = 'flex';
  }

  close() {
    this.el.overlay.style.display = 'none';
  }

  setStatus(text) {
    this.el.status.textContent = text;
  }
}
