import { load, loadConfig } from './support/modules.mjs';
const { GameMode } = await load('game-mode');
const { ModeManager } = await load('mode-manager');
const { GameLoop } = await load('game-loop');
const { WavesMode } = await load('waves-mode');
const { SandboxMode } = await load('sandbox-mode');
const { BotMatchMode } = await load('bot-match-mode');
const { DeathmatchMode } = await load('deathmatch-mode');
const { DigSiteMode } = await load('dig-site-mode');

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`); if (!ok) fails++; };

// --- the manager with a brand-new mode (a plugin) ---
const log = [];
class RaceMode extends GameMode {
  constructor() { super('race'); }
  get setup() { return { level: 'track' }; }
  get online() { return true; }
  start(payload) { log.push(['start', payload]); }
  stop(reason) { log.push(['stop', reason]); }
  fixedUpdate(dt) { log.push(['fixed', dt]); }
  update(dt, frame) { log.push(['update', frame.playing]); }
  filterInput(input) { return { ...input, jumpPressed: false }; }
  onPlayerDeath() { log.push(['death']); return true; }
  onEnemyKilled(enemy) { log.push(['kill', enemy]); }
  onPeerMessage(from, message) { log.push(['peer', from, message]); }
  onServerMessage(message) { log.push(['server', message]); }
  onRoster(players) { log.push(['roster', players.length]); }
}
class PlainMode extends GameMode { constructor() { super('plain'); } }

const manager = new ModeManager({
  prepare: (mode, payload) => log.push(['prepare', mode.id, mode.setup.level, payload]),
  cleanup: (mode, reason) => log.push(['cleanup', mode?.id ?? null, reason]),
});
manager.register(new RaceMode());
manager.register(new PlainMode());

check(manager.id === null && manager.current === null, 'no mode is running at first');
manager.update(0.1, { playing: true });
manager.fixedUpdate(0.1, {});
check(log.length === 0 && manager.onPlayerDeath() === false && manager.canResume({ alive: true }) === false && manager.filterInput({ a: 1 }).a === 1, 'with no mode every forward is a safe no-op');
check(manager.online === false && manager.respawns === false && manager.resultsShowing === false && manager.allowsInventory === false && manager.usesRelayRoster === true, 'trait queries have safe answers in the menu');

manager.start('race', { lap: 3 });
check(manager.id === 'race' && JSON.stringify(log.slice(0, 2)) === JSON.stringify([['prepare', 'race', 'track', { lap: 3 }], ['start', { lap: 3 }]]), 'start prepares the level, then starts the mode, in that order');
log.length = 0;
manager.fixedUpdate(0.016, {});
manager.update(0.5, { playing: true });
manager.onEnemyKilled('bot1');
manager.onPeerMessage(7, 'hi');
manager.onServerMessage({ t: 'x' });
manager.onRoster([1, 2]);
check(JSON.stringify(log) === JSON.stringify([['fixed', 0.016], ['update', true], ['kill', 'bot1'], ['peer', 7, 'hi'], ['server', { t: 'x' }], ['roster', 2]]), 'events reach the current mode');
check(manager.onPlayerDeath() === true && manager.online === true, 'the mode can claim a death, and its traits show through');
check(manager.filterInput({ jumpPressed: true }).jumpPressed === false, 'the mode can filter input');

log.length = 0;
manager.stop('menu');
check(manager.id === null && JSON.stringify(log) === JSON.stringify([['stop', 'menu'], ['cleanup', 'race', 'menu']]), 'stop clears the mode first, then stops it, then cleans up');
manager.start('plain');
const plain = manager.current;
check(plain.online === false && plain.respawns === false && plain.simulatesWhileDead === false && plain.allowsInventory === true && plain.canResume({ alive: true }) && !plain.canResume({ alive: false }), 'a mode that overrides nothing gets sensible defaults');
manager.start('race');
check(manager.id === 'race', 'starting another mode replaces the current one');
let threw = false;
try { manager.start('nope'); } catch (error) { threw = /no game mode "nope"/.test(error.message); }
check(threw, 'an unknown mode id is refused with a clear message');

// --- the game's own modes ---
const CONFIG = await loadConfig();
const hudLog = [];
const hud = new Proxy({}, { get: (target, key) => (...args) => hudLog.push([key, ...args]) });
const enemies = { alive: [], spawned: [], spawnAtEdge(type, speed) { this.spawned.push([type, speed]); this.alive.push({}); return {}; } };
const stats = { kills: 4 };
const waves = new WavesMode({ config: CONFIG, hud, enemies, stats });
waves.start();
check(hudLog.some(([k, n]) => k === 'setWave' && n === 1), 'waves: the HUD shows wave 1 at the start');
for (let i = 0; i < 400; i++) waves.afterFixedUpdate(1 / 60);
check(waves.wave === 1 && enemies.spawned.length === CONFIG.waves.baseCount && enemies.spawned.every(([type]) => ['cable', 'router'].includes(type)), `waves: wave 1 spawns ${CONFIG.waves.baseCount} bots, only the early types`);
enemies.alive.length = 0;
for (let i = 0; i < 400; i++) waves.afterFixedUpdate(1 / 60);
check(waves.wave === 2, 'waves: the next wave starts once the field is clear');
globalThis.document = { exitPointerLock() { hudLog.push(['exitPointerLock']); } };
check(waves.onPlayerDeath() === true && hudLog.some(([k, wave, kills]) => k === 'showDeath' && wave === 2 && kills === 4), 'waves: death shows the end screen with the wave and kills');

const sandbox = new SandboxMode({ config: CONFIG.sandbox });
check(sandbox.setup.level === 'sandbox' && sandbox.setup.invulnerable && sandbox.setup.infiniteReserve && !sandbox.setup.infiniteAmmo && sandbox.setup.spawn.z === CONFIG.sandbox.half - 30, 'sandbox: open level, invulnerable, infinite reserve (not infinite magazine)');

const botLog = [];
const botMode = new BotMatchMode({ botMatch: { start: () => botLog.push('start'), stop: () => botLog.push('stop'), update: () => botLog.push('update'), onPlayerDeath: () => botLog.push('death'), onBotKilled: () => botLog.push('kill') } });
botMode.update(0.1, { playing: false, boardHeld: false });
botMode.update(0.1, { playing: true, boardHeld: false });
botMode.start(); botMode.onEnemyKilled(); botMode.onPlayerDeath(); botMode.stop();
check(botLog.join() === 'update,start,kill,death,stop' && botMode.respawns && botMode.simulatesWhileDead, 'bot match: rules run only while playing; it respawns and the world runs while dead');

const dmLog = [];
const dmMode = new DeathmatchMode({
  deathmatch: { start: () => dmLog.push('start'), stop: () => dmLog.push('stop'), update: () => dmLog.push('update'), onLocalDeath: () => dmLog.push('death'), onMessage: (from) => dmLog.push(`msg${from}`), onRoster: () => dmLog.push('roster') },
  net: { close: () => dmLog.push('net-close') }, remotes: { clear: () => dmLog.push('remotes-clear') }, hud: { setKills: () => dmLog.push('kills0') },
});
dmMode.start(); dmMode.onPeerMessage(3, {}); dmMode.onRoster([]); dmMode.onPlayerDeath(); dmMode.stop();
check(dmLog.join() === 'start,msg3,roster,death,stop,net-close,remotes-clear,kills0' && dmMode.online && !dmMode.simulatesWhileDead, 'deathmatch: stopping also closes the connection and clears the other players');

const digLog = [];
const dig = { ended: false, solo: false, start: () => digLog.push('start'), stop: () => digLog.push('stop'), fixedUpdate: () => digLog.push('fixed'), update: () => digLog.push('update'), filterInput: (i) => ({ ...i, blocked: true }), onMessage: (m) => digLog.push(`msg:${m.t}`), onLobby: () => digLog.push('lobby') };
const digMode = new DigSiteMode({
  dig, digHud: { setSolo: () => {} }, digLobby: { close: () => digLog.push('lobby-close'), open: () => digLog.push('lobby-open'), reset: () => digLog.push('lobby-reset') },
  net: { sendGame: (m) => digLog.push(`send:${m.t}`), close: () => digLog.push('net-close') },
  remotes: { clear: () => digLog.push('remotes-clear') }, hud: { clearNumbers: () => {}, showStart: () => {} }, cyborg: { reset: () => digLog.push('cyborg') },
  renderer: { shadowMap: {} }, leaveToLobby: () => digLog.push('leave-to-lobby'),
});
digMode.start({ solo: true });
check(dig.solo === true && digMode.usesRelayRoster === false && digMode.allowsInventory === false && digMode.setup.level === 'dig', 'dig: solo flag, own roster, no inventory, its own level');
digMode.onServerMessage({ t: 'dg_dig' });
digMode.onServerMessage({ t: 'dg_lobby', phase: 'playing' });
digMode.onServerMessage({ t: 'dg_lobby', phase: 'lobby' });
check(digLog.slice(-4).join() === 'msg:dg_dig,lobby,lobby,leave-to-lobby', 'dig: server messages go to the dig rules, and "back to lobby" moves everyone');
digLog.length = 0;
digMode.stop('menu');
check(digLog.join() === 'stop,send:dg_leave,net-close,remotes-clear,lobby-reset', 'dig: leaving for the menu tells the server and closes the connection');
digLog.length = 0;
digMode.stop('lobby');
check(digLog.join() === 'stop,remotes-clear,lobby-open', 'dig: going back to the lobby stays connected');
dig.ended = true;
check(digMode.resultsShowing && !digMode.canResume({ alive: true }) && digMode.filterInput({}).blocked === true, 'dig: results stop the game; input is filtered by the dig rules');

// --- the loop ---
const calls = [];
const originalRaf = globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame = () => {};
const loop = new GameLoop({ fixedStep: 1 / 60, maxFrameDelta: 0.1, maxStepsPerFrame: 5 }, {
  beginFrame: () => { calls.push('begin'); return playing; },
  fixedUpdate: () => calls.push('step'),
  endFrame: (dt, p) => calls.push(`end:${p}`),
  render: (alpha) => calls.push(`render:${alpha.toFixed(2)}`),
});
let playing = true;
loop.lastTime = 0;
loop.frame(50); // 50 ms = 3 steps of 16.7 ms and a bit left over
check(calls.filter((c) => c === 'step').length === 3 && calls[0] === 'begin' && calls.at(-2) === 'end:true' && calls.at(-1).startsWith('render:'), 'loop: begin, as many fixed steps as time allows, end, then render');
calls.length = 0; playing = false; loop.frame(100);
check(!calls.includes('step') && calls.includes('render:1.00'), 'loop: no steps while not playing, and the picture is not interpolated');
calls.length = 0; playing = true; loop.frame(100 + 5000); // a tab switch: the frame time is clamped
check(calls.filter((c) => c === 'step').length === 5 && loop.accumulator === 0, 'loop: a huge gap is clamped, and the backlog is dropped');
globalThis.requestAnimationFrame = originalRaf;

console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
