import { GameMode } from '../../core/client/modes/game-mode.js';

/** SANDBOX: a big open map where you cannot be hurt and never run out of ammo. */
export class SandboxMode extends GameMode {
  /** @param deps { config } the sandbox section of CONFIG */
  constructor({ config }) {
    super('sandbox');
    this.config = config;
  }

  get setup() {
    return {
      level: 'sandbox',
      fog: { near: 40, far: 160 },
      spawn: { x: 0, z: this.config.half - 30 },
      invulnerable: true,
      infiniteReserve: true, // the spare ammo never runs out, but an empty magazine still needs a reload
    };
  }
}
