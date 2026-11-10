import { load, loadConfig } from '../support/modules.mjs';
// Drives the real client modules (DigMode, DigSite, DigHud, NetClient) against the real server.
const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(16) }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop), set: () => true });
const made = [];
const makeEl = () => {
  const el = {
    style: {}, classList: { add: noop, remove: noop, toggle: noop }, textContent: '', value: '', children: [],
    addEventListener: noop, append: noop, replaceChildren: noop, focus: noop, select: noop, blur: noop, offsetWidth: 0,
    insertRow() { const row = { className: '', insertCell: () => ({}), append: noop }; el.rows.push(row); return row; }, rows: [],
  };
  made.push(el);
  return el;
};
let pointerUnlocked = 0;
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? { width: 0, height: 0, getContext: () => ctx } : makeEl()),
  getElementById: () => makeEl(), body: { classList: { toggle: noop } }, exitPointerLock: () => { pointerUnlocked++; },
};
globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.window = globalThis;
globalThis.location = { protocol: 'http:', host: `localhost:${process.env.TEST_PORT || 18123}` };
const THREE = await import('three');
const { createEffects } = await load('effects');
const { World } = await load('world');
const { Player } = await load('player');
const { Enemies } = await load('enemies');
const { Weapons } = await load('weapons');
const { RemotePlayers } = await load('remote-players');
const { Cyborg } = await load('cyborg');
const { DigMode } = await load('dig-mode');
const { DigHud, formatDepth, formatClock } = await load('dig-hud');
const { DigLobbyScreen } = await load('dig-lobby');
const { NetClient } = await load('net');
const CONFIG = await loadConfig();

let fails = 0;
const check = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- the game stack, wired like main.js ---
const log = { numbers: [], banners: [], damage: 0, feed: [], sounds: [], digMessages: [] };
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 200);
const fx = createEffects(scene);
const world = new World(scene, CONFIG);
const player = new Player(camera, world, CONFIG.player);
const hud = { setWeapon: noop, setAmmo: noop, setAim: noop, setScope: noop, setAltAmmo: noop, setLoadout: noop, hitmarker: noop, damageNumber: (p, v) => log.numbers.push(v), banner: (t) => log.banners.push(t), damage: () => { log.damage++; } };
const audio = new Proxy({}, { get: (t, k) => () => log.sounds.push(String(k)) });
const enemies = new Enemies({ cfg: CONFIG, scene, world, fx, player });
const weapons = new Weapons({ cfg: CONFIG, camera, mainScene: scene, envMap: null, world, enemies, player, fx, hud, audio });
const cyborg = new Cyborg({ scene, player, weapons });
weapons.tp = cyborg;
const scoreboard = { feed: (t) => log.feed.push(t), clearFeed: noop };
let net;
const digHud = new DigHud();
const lobbyShown = [];
const digLobby = new DigLobbyScreen({ onJoin: noop, onStart: noop, onBack: noop });
const remotes = new RemotePlayers({ scene, fx, world, weapons, audio, config: CONFIG.multiplayer });
const dig = new DigMode({ config: CONFIG.dig, net: null, player, weapons, remotes, world, scene, camera, audio, hud, digHud, scoreboard });
let started = null;
net = new NetClient({
  onStatus: noop, onRoster: noop, onJoinError: noop,
  onMessage: (from, m) => remotes.receive(from, m, performance.now() * 0.001),
  onGame: (m) => {
    log.digMessages.push(JSON.stringify(m));
    if (m.t === 'dg_lobby') { digLobby.setLobby(m, net.id); lobbyShown.push(m); if (dig.active) dig.onLobby(m); }
    else if (m.t === 'dg_map') { world.build('dig'); started = m; dig.start(m); cyborg.reset(); }
    else dig.onMessage(m);
  },
}, { gamePrefix: 'dg_' });
dig.net = net;
net.connect();
await wait(300);

// --- a second player over a raw socket ---
const raw = await new Promise((resolve) => { const ws = new WebSocket(location.host.replace(/^/, 'ws://') + '/ws'); const c = { ws, inbox: [] }; ws.onmessage = (e) => c.inbox.push(JSON.parse(e.data)); ws.onopen = () => resolve(c); });

check(formatDepth(18) === '18 IN (1 FT 6 IN)' && formatDepth(24) === '24 IN (2 FT)' && formatDepth(6) === '6 IN' && formatClock(125.2) === '2:06', 'depth and clock formatting');

// lobby
net.sendGame({ t: 'dg_join', name: 'Ada' }); await wait(150);
check(lobbyShown.at(-1)?.host === net.id && digLobby.joined && digLobby.isHost, 'client joins the lobby as host');
raw.ws.send(JSON.stringify({ t: 'dg_join', name: 'Bob' })); await wait(150);
check(lobbyShown.at(-1).players.length === 2 && digLobby.playerCount === 2, 'lobby shows the second player live');
net.sendGame({ t: 'dg_start' }); await wait(250);
check(started && dig.active, 'dg_map starts the match on the client');
check(dig.site.size === 48 && dig.site.group.children.length > 40, `site built (${dig.site.group.children.length} objects)`);
check(weapons.fireLocked && weapons.models[dig.shovelIndex].root.visible === false || weapons.pendingIndex === dig.shovelIndex || weapons.index === dig.shovelIndex, 'the shovel is equipped and the trigger is locked');
check(log.digMessages.every((t) => !/"lines"|"depths"|"tape"|"tiles"|"reveal"|"kind"/.test(t)), 'nothing about buried lines reached the client before any dig');
check(remotes.list.length === 1 && remotes.list[0].name === 'Bob', 'the other player is an avatar');

// a house is solid
const house = started.map.buildings[0];
player.pos.set(house[0] + 2.5 - 24, 0, house[1] - 1.5 - 24 + (house[4] ? 0 : 0)); player.prevPos.copy(player.pos);
const input = { forward: 1, back: 0, left: 0, right: 0, sprintHeld: 0, crouchHeld: 0, jumpPressed: 0, slidePressed: 0, sprintPressed: 0, firePressed: 0, fireHeld: 0, reloadPressed: 0, meleePressed: 0, ammoPressed: 0, selectSlot: -1, wheel: 0, aimHeld: 0, leanLeft: 0, leanRight: 0 };
player.yaw = Math.PI; // face +z, toward the house at the larger z
const dt = 1 / 60;
for (let i = 0; i < 120; i++) { player.update(dt, dig.filterInput(input)); }
check(world.solids.length > 20, `houses and poles are solid colliders (${world.solids.length})`);
input.forward = 0;

// aim and dig the telecom main: row 18, tile (20, 18); it lies 12-24 in down, so a strike comes within 4 layers
const aimAt = (tx, tz) => { player.pos.set(tx + 0.5 - 24, 0, tz + 0.5 - 24 + 1.31); player.prevPos.copy(player.pos); player.yaw = 0; player.pitch = -0.9; player.vel.set(0, 0, 0); };
aimAt(20, 18);
dig.update(0.05);
check(dig.target && dig.target.x === 20 && dig.target.z === 18, `crosshair picks tile ${JSON.stringify(dig.target)}`);
player.pitch = 0; dig.update(0.05);
check(dig.target === null, 'looking level picks no tile');
player.pitch = -0.9; aimAt(20, 18); dig.update(0.05);
player.pitch = -0.3; dig.update(0.05); // a shallow look hits the ground about 5 m away
check(dig.target === null, 'a tile beyond reach is not targeted');
aimAt(20, 18); dig.update(0.05);

let sawStrike = false; let swings = 0;
const swingCount = () => log.sounds.filter((s) => s === 'dig').length;
for (let i = 0; i < 40 && !sawStrike; i++) {
  input.fireHeld = 1; input.firePressed = 1;
  const sentBefore = dig.nextDigAt;
  dig.fixedUpdate(input); input.firePressed = 0;
  if (dig.nextDigAt !== sentBefore) swings++;
  for (let t = 0; t < 8; t++) { dig.update(0.1); await wait(25); }
  sawStrike = dig.site.holeAt(20, 18).locked;
}
input.fireHeld = 0;
const hole = dig.site.holeAt(20, 18);
check(sawStrike && hole.locked, `digging down struck the telecom line (hole ${hole.depth} in, ${swings} swings)`);
check(log.sounds.includes('strike') && log.banners.some((b) => b.includes('TELECOM')) && log.damage >= 1, `strike feedback: ${log.banners.at(-1)}`);
check(log.feed.some((f) => f.includes('STRUCK TELECOM')), `activity line: ${log.feed.at(-1)}`);
check(dig.site.revealed.size >= 4 && dig.site.isLocked(21, 18) && dig.site.isLocked(17, 18), `the line is painted for everyone (${dig.site.revealed.size} tiles)`);
check(swingCount() >= 1 && log.numbers.length >= 1, 'safe digs played a sound and showed points');
check(dig.scores.get(net.id).strikes === 1, 'the strike is on the scoreboard');

// the hole is real: the ground is lower there, the quad is gone, a pipe lies in the pit
const holeView = dig.site.holes.get('20,18').view;
const m = new THREE.Matrix4(); dig.site.ground.getMatrixAt(18 * 48 + 20, m);
check(Math.abs(world.groundHeight(20.5 - 24, 18.5 - 24) + hole.depth * 0.0254) < 1e-9, `the ground there is now ${hole.depth} in lower, for walking and falling`);
check(m.elements[0] === 0, 'the grass quad of the dug tile is gone, so you see into the pit');
check(holeView.pipe && holeView.walls.some((w) => w.visible), 'the struck pipe lies in a pit with walls ' + JSON.stringify({ pipe: !!holeView.pipe, walls: holeView.walls.map((w) => w.visible), depth: hole.depth }));
check(world.groundHeight(21.5 - 24, 18.5 - 24) === 0, 'neighbouring tiles are untouched');
check(log.digMessages.every((t) => !t.includes('tape')) && log.digMessages.filter((t) => t.includes('"dg_dig"')).every((t) => /"res":"(safe|strike)"/.test(t)), 'every dig result is safe or a strike: no warning of any kind');

// locked tile: no new request goes out
const sent = dig.nextDigAt;
dig.time += 5; input.fireHeld = 1; input.firePressed = 1; dig.fixedUpdate(input); input.fireHeld = 0; input.firePressed = 0;
check(dig.nextDigAt === sent, 'a locked tile sends no dig request');
dig.update(0.05);
check(digHud.last.hint !== undefined && dig.hintText.includes('LOCKED'), `hint: ${dig.hintText}`);

// the other player sees the strike too
check(raw.inbox.some((m) => m.t === 'dg_dig' && m.res === 'strike' && m.reveal?.length >= 4), 'the second player received the reveal');

// cooldown pacing: the client does not spam requests
aimAt(25, 19); dig.update(0.05);
input.fireHeld = 1;
let requests = 0;
for (let i = 0; i < 30; i++) { const before = dig.nextDigAt; dig.fixedUpdate(input); if (dig.nextDigAt !== before) requests++; dig.update(1 / 60); }
input.fireHeld = 0;
check(requests >= 1 && requests <= 2, `holding the trigger digs once per cooldown (${requests} requests in 0.5 s)`);

// swing keeps you still, weapon keys are ignored
dig.swingUntil = dig.time + 1;
const filtered = dig.filterInput({ ...input, forward: 1, selectSlot: 2, wheel: 1, meleePressed: true, jumpPressed: true });
check(!filtered.forward && !filtered.jumpPressed && filtered.selectSlot === -1 && filtered.wheel === 0 && !filtered.meleePressed, 'mid-swing: no movement, no weapon keys');
dig.swingUntil = 0;

// the match ends on the server's clock
for (let i = 0; i < 300 && !dig.ended; i++) { dig.update(0.05); await wait(100); }
check(dig.ended && pointerUnlocked >= 1, 'the results arrive and the pointer is released');
dig.update(0.05);
input.fireHeld = 1; input.firePressed = 1; const afterEnd = dig.nextDigAt; dig.fixedUpdate(input); input.fireHeld = 0; input.firePressed = 0;
check(dig.target === null && dig.nextDigAt === afterEnd, 'nothing can be dug after the end');

dig.stop();
check(!dig.active && !weapons.fireLocked, 'leaving the mode unlocks the weapons again');
net.close(); raw.ws.close();
await wait(100);
console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
