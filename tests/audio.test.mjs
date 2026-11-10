import { load } from './support/modules.mjs';

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };

// A fake Web Audio graph that counts what is made.
const made = { osc: 0, noise: 0, gains: [] };
const param = () => ({ value: 0, cancelScheduledValues() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} });
const node = () => ({ connect: (n) => n ?? node(), disconnect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param(), type: '' });
globalThis.window = globalThis;
globalThis.AudioContext = class {
  constructor() { this.currentTime = 0; this.sampleRate = 100; this.state = 'running'; this.destination = node(); }
  createGain() { const g = node(); made.gains.push(g); return g; }
  createOscillator() { made.osc += 1; return node(); }
  createBufferSource() { made.noise += 1; return node(); }
  createBiquadFilter() { return node(); }
  createBuffer() { return { getChannelData: () => new Float32Array(100) }; }
  resume() {}
};

const { AudioFX } = await load('audio');
const { AudioEngine } = await load('audio-engine');

const audio = new AudioFX();
check(audio instanceof AudioEngine, 'the game sounds extend the core engine');
audio.shoot('pistol');
check(made.osc === 0, 'nothing plays before the first user gesture');
audio.unlock();
audio.shoot('pistol');
check(made.osc > 0 && made.noise > 0, 'a shot makes a tone and a noise burst');
const gainsBefore = made.gains.length;
audio.shootAt('shotgun', 28);
check(made.gains.length > gainsBefore && audio.bus === audio.master, 'a distant shot goes through its own volume and the bus is restored');
audio.digAt(10, 24);
check(audio.bus === audio.master, 'a distant dig restores the bus too');
audio.toggleMute();
const oscBefore = made.osc;
audio.shoot('pistol');
check(made.osc === oscBefore, 'muted: nothing plays');
audio.toggleMute();
for (const sound of ['dig', 'strike', 'dry', 'hurt', 'pickup', 'jump', 'slide', 'enemyKill', 'deathDialup']) audio[sound]();
audio.land(10); audio.punch(true); audio.click('mag'); audio.hitBeep(true); audio.beamStart(); audio.beamSet(0.5); audio.beamStop(); audio.recharge(1);
check(true, 'every sound plays without error');

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
