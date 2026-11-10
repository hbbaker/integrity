import { GameMode } from '../../core/client/modes/game-mode.js';

/** Bot types that join the waves, and the wave they first appear on. */
const WAVE_TYPES = [
  { type: 'cable', from: 1, weight: 5 },
  { type: 'router', from: 1, weight: 3 },
  { type: 'coneHead', from: 2, weight: 3 },
  { type: 'lineman', from: 3, weight: 2.5 },
  { type: 'splicer', from: 4, weight: 2 },
  { type: 'technician', from: 3, weight: 1.5 },
  { type: 'foreman', from: 5, weight: 1.5 },
  { type: 'jackhammer', from: 6, weight: 1 },
];

const FIRST_WAVE_DELAY = 1.2; // seconds of quiet before wave 1
const BURST_WAVE_STEP = 4; // groups grow by one bot every this many waves

/** WAVE GAME: survive growing, speeding-up waves of bots. */
export class WavesMode extends GameMode {
  /** @param deps { config (the whole CONFIG), hud, enemies, stats ({ kills }) } */
  constructor({ config, hud, enemies, stats }) {
    super('waves');
    this.config = config;
    this.hud = hud;
    this.enemies = enemies;
    this.stats = stats;
    this.wave = 0;
    this.toSpawn = 0;
    this.spawnTimer = 0;
    this.spawnInterval = 1;
    this.speedMul = 1;
    this.intermission = 0;
  }

  start() {
    this.wave = 0;
    this.toSpawn = 0;
    this.intermission = FIRST_WAVE_DELAY;
    this.hud.setWave(1);
  }

  afterFixedUpdate(dt) {
    if (this.intermission > 0) {
      this.intermission -= dt;
      if (this.intermission <= 0) this._startWave(this.wave + 1);
      return;
    }
    if (this.toSpawn > 0) {
      this._spawn(dt);
    } else if (this.enemies.alive.length === 0) {
      this.intermission = this.config.waves.intermission;
    }
  }

  onPlayerDeath() {
    this.hud.showDeath(this.wave, this.stats.kills);
    document.exitPointerLock();
    return true;
  }

  _startWave(n) {
    const w = this.config.waves;
    this.wave = n;
    this.toSpawn = w.baseCount + w.countGrowth * (n - 1);
    this.spawnInterval = Math.max(w.minInterval, w.spawnInterval * Math.pow(w.intervalDecay, n - 1));
    this.speedMul = Math.min(w.maxSpeedMul, 1 + w.speedGrowth * (n - 1));
    this.spawnTimer = 0;
    this.hud.setWave(n);
    this.hud.banner(`WAVE ${n}`);
  }

  _spawn(dt) {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const burst = 1 + Math.floor(this.wave / BURST_WAVE_STEP); // bigger groups later on
    for (let i = 0; i < burst && this.toSpawn > 0; i++) {
      if (this.enemies.alive.length >= this.config.enemies.maxAlive) break;
      if (this.enemies.spawnAtEdge(this._pickType(), this.speedMul)) this.toSpawn -= 1;
    }
    this.spawnTimer = this.spawnInterval;
  }

  /** Weighted pick among the types unlocked by this wave (`from`), so new kinds show up as waves go on. */
  _pickType() {
    const table = WAVE_TYPES.filter((entry) => this.wave >= entry.from);
    let roll = Math.random() * table.reduce((sum, entry) => sum + entry.weight, 0);
    for (const entry of table) {
      roll -= entry.weight;
      if (roll <= 0) return entry.type;
    }
    return table[0].type;
  }
}
