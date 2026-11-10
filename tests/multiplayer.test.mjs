import { load, loadConfig, installDomStubs } from './support/modules.mjs';
const noop = () => {};
installDomStubs();
const THREE = await import('three');
const { createEffects } = await load('effects');
const { World } = await load('world');
const { Player } = await load('player');
const { Enemies } = await load('enemies');
const { Weapons } = await load('weapons');
const { Cyborg } = await load('cyborg');
const { RemotePlayers } = await load('remote-players');
const { Targets } = await load('targets');
const { Deathmatch } = await load('deathmatch');
const { Pickups } = await load('pickups');
const { kdRatio, formatKd, rankRows } = await load('scoreboard');
const CONFIG = await loadConfig();
CONFIG.multiplayer.killLimit = 3;

let fails = 0;
const check = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) { fails++; process.exitCode = 1; } };
const dt = 1 / 60;
let clock = 100; // seconds, the shared fake clock

/** In-memory stand-in for the Rust relay: same rules, delivery on the next flush (like a real network). */
class FakeServer {
  constructor() { this.clients = []; this.nextId = 1; this.queue = []; }
  roster() { return this.clients.filter((c) => c.joined).map((c) => ({ id: c.id, name: c.name })); }
  broadcastRoster() { const r = this.roster(); for (const c of this.clients) this.queue.push(() => c.handlers.onRoster(r)); }
  flush() { const q = this.queue; this.queue = []; for (const f of q) f(); }
  connect(name, handlers) {
    const c = { id: this.nextId++, name, handlers, joined: false }; // the methods below use the module's one `server`
    this.clients.push(c);
    return {
      id: c.id, latency: 20,
      get players() { return server.roster(); },
      get joined() { return c.joined; },
      join() { c.joined = true; server.broadcastRoster(); },
      leave() { c.joined = false; server.clients = server.clients.filter((x) => x !== c); server.broadcastRoster(); },
      send(m) {
        if (!c.joined) return;
        const copy = JSON.parse(JSON.stringify(m));
        for (const o of server.clients) if (o !== c && o.joined) server.queue.push(() => o.handlers.onMessage(c.id, copy));
      },
    };
  }
}
const server = new FakeServer();

function createInstance(name) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1.7, 0.1, 200);
  const fx = createEffects(scene);
  const world = new World(scene, CONFIG);
  const player = new Player(camera, world, CONFIG.player);
  const log = { numbers: [], feed: [], banners: [], kills: 0 };
  const hud = {
    setWeapon: noop, setAmmo: noop, setAim: noop, setScope: noop, setAltAmmo: noop, setLoadout: noop, hitmarker: noop,
    damageNumber: (p, v) => log.numbers.push(Math.round(v)), banner: (t) => log.banners.push(t), setKills: (k) => { log.kills = k; },
  };
  const audio = new Proxy({}, { get: () => noop });
  const enemies = new Enemies({ cfg: CONFIG, scene, world, fx, player });
  const weapons = new Weapons({ cfg: CONFIG, camera, mainScene: scene, envMap: null, world, enemies, player, fx, hud, audio });
  const wizard = new Cyborg({ scene, player, weapons });
  weapons.tp = wizard;
  const scoreboard = { visible: false, setVisible(v) { this.visible = v; }, setMiniVisible: noop, renderMini(rows) { log.mini = rows; }, render(rows, ping, title) { log.board = { rows, title }; }, refresh(dt, visible, rows, ping, title) { this.visible = visible; if (visible) log.board = { rows, title }; else log.mini = rows; }, feed: (t) => log.feed.push(t), clearFeed: noop, setRespawn: (s) => { log.respawn = s; }, setPing: noop };
  const inst = { name, scene, camera, player, weapons, wizard, log, world, enemies, fx };
  inst.remotes = new RemotePlayers({ scene, fx, world, weapons, audio, config: CONFIG.multiplayer });
  weapons.enemies = new Targets({ enemies, remotes: inst.remotes });
  inst.net = server.connect(name, {
    onRoster: (players) => { inst.remotes.sync(players, inst.net.id); if (inst.deathmatch.active) inst.deathmatch.onRoster(players); },
    onMessage: (from, m) => { inst.remotes.receive(from, m, clock); inst.deathmatch.onMessage(from, m); },
  });
  inst.pickups = new Pickups(scene, CONFIG);
  inst.pickups.onCollect = (kind) => {
    if (kind === 'health') { if (player.health >= CONFIG.player.maxHealth) return false; player.heal(CONFIG.pickups.healthAmount); return true; }
    return weapons.addAmmo(CONFIG.pickups.ammo);
  };
  inst.deathmatch = new Deathmatch({ config: CONFIG.multiplayer, arenaHalf: CONFIG.arena.half, net: inst.net, player, weapons, cyborg: wizard, remotes: inst.remotes, world, scoreboard, hud, pickups: inst.pickups });
  inst.input = { forward: 0, back: 0, left: 0, right: 0, sprintHeld: 0, fireHeld: 0, jumpPressed: 0, slidePressed: 0, sprintPressed: 0, firePressed: 0, reloadPressed: 0, meleePressed: 0, ammoPressed: 0, selectSlot: -1, wheel: 0 };
  player.onDeath = () => inst.deathmatch.onLocalDeath(); // as main.js wires it
  inst.join = () => { inst.net.join(); inst.deathmatch.start(); };
  return inst;
}

function step(insts, n = 1) {
  for (let i = 0; i < n; i++) {
    clock += dt;
    server.flush();
    for (const s of insts) {
      s.deathmatch.update(dt, { boardHeld: false });
      if (s.player.alive) { s.player.update(dt, s.input); s.weapons.update(dt, s.input); }
      if (s.player.alive) s.pickups.update(dt, s.player.pos); // like main.js: nothing is collected while dead
      s.remotes.update(dt, clock, clock);
      s.fx.update(dt);
      s.input.firePressed = 0; s.input.jumpPressed = 0; s.input.selectSlot = -1;
      s.player.pitch = 0; s.player.kickPitch = 0; s.player.kickYaw = 0; // nobody looks around in this test: undo recoil climb
    }
  }
}
const place = (s, x, z, yaw = 0) => { s.player.pos.set(x, 0, z); s.player.prevPos.copy(s.player.pos); s.player.yaw = yaw; s.player.pitch = 0; s.player.vel.set(0, 0, 0); };

const A = createInstance('Ada'); const B = createInstance('Bob');
A.join(); B.join();
step([A, B], 5);
check(A.remotes.list.length === 1 && A.remotes.list[0].name === 'Bob', 'A sees Bob as a remote player');
check(B.remotes.list.length === 1 && B.remotes.list[0].name === 'Ada', 'B sees Ada as a remote player');
check(A.player.invulnerable && B.player.invulnerable, 'both start with spawn protection');

// Separate them in a clear lane, facing each other; let protection expire.
place(A, -12, 20, 0); place(B, -12, -5, Math.PI);
step([A, B], Math.round(CONFIG.multiplayer.spawnProtect / dt) + 30);
check(!A.player.invulnerable && !B.player.invulnerable, 'spawn protection expires');
const seen = A.remotes.list[0];
check(Math.hypot(seen.pos.x + 12, seen.pos.z + 5) < 0.3, `A sees Bob at his real position (${seen.pos.x.toFixed(2)}, ${seen.pos.z.toFixed(2)})`);
check(seen.cyborg.group.visible, 'Bob avatar is visible to A');

// A grapples Bob with the fiber reel: his game pulls him toward A, and letting go stops it.
const reelIndex = CONFIG.weapons.list.findIndex((item) => item.id === 'reel');
A.weapons.select(reelIndex); step([A, B], 40);
const gap0 = Math.hypot(B.player.pos.x - A.player.pos.x, B.player.pos.z - A.player.pos.z);
A.input.firePressed = 1; step([A, B], 4);
check(B.player.pulled, 'a grapple hit on a remote player makes their game pull them');
step([A, B], 40);
const gap1 = Math.hypot(B.player.pos.x - A.player.pos.x, B.player.pos.z - A.player.pos.z);
check(gap1 < gap0 - 8, `Bob is dragged toward Ada (${gap0.toFixed(1)} m -> ${gap1.toFixed(1)} m)`);
step([A, B], 120);
check(!B.player.pulled && Math.hypot(B.player.pos.x - A.player.pos.x, B.player.pos.z - A.player.pos.z) < 3, 'the pull ends when Bob arrives next to Ada');
B.deathmatch.onMessage(A.net.id, { t: 'pl', to: B.net.id, v: 9999, s: 9999 });
check(B.player.pulled && B.player.pull.speed <= 40 && B.player.pull.time <= 6, 'a grapple message asking for too much is clamped');
B.deathmatch.onMessage(A.net.id, { t: 'pl', to: B.net.id, c: 1 });
check(!B.player.pulled, 'a let-go message ends the pull');
B.player.invulnerable = true;
B.deathmatch.onMessage(A.net.id, { t: 'pl', to: B.net.id, v: 20, s: 2 });
check(!B.player.pulled, 'a player with spawn protection cannot be grappled');
B.player.invulnerable = false;
B.deathmatch.onMessage(A.net.id, { t: 'pl', to: 999, v: 20, s: 2 });
check(!B.player.pulled, 'a grapple aimed at someone else is ignored');
place(A, -12, 20, 0); place(B, -12, -5, Math.PI);
A.weapons.select(1); step([A, B], 40);

// A shoots Bob (head height: crit).
A.weapons.select(1); step([A, B], 30);
const hp0 = B.player.health;
A.input.firePressed = 1; step([A, B], 4);
check(B.player.health < hp0, `Bob loses health from A's shot: ${hp0} -> ${B.player.health}`);
check(A.log.numbers.length > 0, `A saw a damage number ${JSON.stringify(A.log.numbers)}`);
check(B.player.health === hp0 - 48 || B.player.health === hp0 - 24, `pistol damage applied once (${hp0 - B.player.health})`);

// Kill Bob.
for (let i = 0; i < 6 && B.player.alive; i++) { A.input.firePressed = 1; step([A, B], 14); }
check(!B.player.alive, 'Bob dies');
step([A, B], 5);
check(A.deathmatch.scores.get(A.net.id).kills === 1 && B.deathmatch.scores.get(A.net.id).kills === 1, 'both clients credit Ada with 1 kill');
check(A.deathmatch.scores.get(B.net.id).deaths === 1 && B.deathmatch.scores.get(B.net.id).deaths === 1, 'both clients count 1 death for Bob');
check(A.log.feed.some((f) => f.includes('Ada') && f.includes('Bob')), `kill feed: ${JSON.stringify(A.log.feed)}`);
check(A.log.kills === 1, 'Ada HUD kills = 1');
check(!A.remotes.list[0].alive, 'A sees Bob as dead');
check(A.remotes.list[0].view.player.alive === false, 'Bob avatar pose is dead');

// Dead players cannot be hit again, and respawn after respawnTime.
step([A, B], Math.round((CONFIG.multiplayer.respawnTime + 0.3) / dt));
check(B.player.alive && B.player.health === CONFIG.player.maxHealth, 'Bob respawns with full health');
check(B.player.invulnerable, 'Bob has spawn protection after respawn');
check(B.log.respawn === null, 'respawn countdown hidden after respawn');

// Protected player takes no damage.
place(A, -12, 20, 0); place(B, -12, -5, Math.PI); step([A, B], 20);
const hpProtected = B.player.health;
A.input.firePressed = 1; step([A, B], 6);
check(B.player.health === hpProtected, 'protected Bob ignores hits');

// Hit validation: absurd damage is capped, unknown targets ignored.
step([A, B], Math.round(2.2 / dt));
B.deathmatch.onMessage(A.net.id, { t: 'h', to: B.net.id, d: 1e9 });
check(!B.player.alive, 'a huge hit still just kills (damage capped, no crash)');
step([A, B], Math.round(3.5 / dt));
const before = A.player.health;
A.deathmatch.onMessage(B.net.id, { t: 'h', to: 999, d: 50 });
check(A.player.health === before, 'hits for another player are ignored');

// Match end at the kill limit, then restart.
for (let k = 0; k < 3; k++) {
  step([A, B], Math.round(2.4 / dt)); // protection
  place(A, -12, 20, 0); place(B, -12, -5, Math.PI); step([A, B], 20);
  for (let i = 0; i < 8 && B.player.alive; i++) { A.input.firePressed = 1; step([A, B], 14); }
  step([A, B], 5);
  if (A.deathmatch.over) break;
  step([A, B], Math.round(3.3 / dt));
}
check(A.deathmatch.over && B.deathmatch.over, 'match ends when Ada reaches the kill limit');
check(A.log.banners.some((b) => b.includes('Ada') && b.includes('WINS')), `winner banner: ${JSON.stringify(A.log.banners)}`);
step([A, B], Math.round((CONFIG.multiplayer.matchRestartDelay + 0.5) / dt));
check(!A.deathmatch.over && A.deathmatch.scores.get(A.net.id).kills === 0, 'new match resets scores');

// Late joiner gets the score table from the lowest-id player.
A.deathmatch.scores.get(A.net.id).kills = 2; B.deathmatch.scores.get(A.net.id).kills = 2;
const C = createInstance('Cyd'); C.join();
step([A, B, C], 10);
check(C.deathmatch.scores.get(A.net.id)?.kills === 2, 'late joiner receives existing scores');
check(A.remotes.list.length === 2 && C.remotes.list.length === 2, 'three players see each other');

// Leaving removes the avatar.
B.net.leave(); B.deathmatch.stop(); step([A, C], 5);
check(A.remotes.list.length === 1 && A.remotes.list[0].name === 'Cyd', 'a leaver disappears from the others');


// ---- health regeneration, drops and map pickups ----
{
  A.net.leave(); C.net.leave(); step([], 1); // the earlier players go away
  const X = createInstance('Xan'); const Y = createInstance('Yve');
  X.join(); Y.join(); step([X, Y], 5);
  const live = (inst) => inst.pickups.items.filter((i) => i.active);
  step([X, Y], Math.round(2.2 / dt)); // spawn protection over
  place(X, -12, 20, 0); place(Y, -12, -5, Math.PI); step([X, Y], 20);
  // regen
  Y.player.health = 40; step([Y], Math.round((CONFIG.multiplayer.regenDelay - 1) / dt));
  check(Y.player.health === 40, 'no regeneration right after taking damage');
  step([Y], Math.round(2 / dt));
  check(Y.player.health > 40, `health regenerates after ${CONFIG.multiplayer.regenDelay}s (${Y.player.health.toFixed(1)})`);
  step([Y], Math.round(10 / dt));
  check(Y.player.health === CONFIG.player.maxHealth, 'regeneration stops at full health');
  Y.player.health = 60; step([Y], Math.round(3 / dt));
  Y.player.takeDamage(10, null); const afterHit = Y.player.health; step([Y], Math.round(2 / dt));
  check(Y.player.health === afterHit, 'a new hit restarts the regeneration delay');
  Y.player.health = CONFIG.player.maxHealth;

  // death drop: ammo for everyone, same crate on both clients
  Y.player.takeDamage(1000, null); step([X, Y], 5);
  check(!Y.player.alive, 'Yve died');
  const dropsX = live(X).filter((i) => i.kind === 'ammo').length;
  const dropsY = live(Y).filter((i) => i.kind === 'ammo').length;
  check(dropsX >= 1 && dropsX === dropsY, `death drops an ammo crate on every client (${dropsX}/${dropsY})`);
  const ids = (inst) => live(inst).map((i) => i.netId).sort().join();
  check(ids(X) === ids(Y) && live(X).every((i) => i.netId > 0), 'both clients hold the same crate ids');

  // collecting removes it for the others and gives ammo
  const crate = live(X).find((i) => i.kind === 'ammo');
  X.weapons.current.mag = 1; X.weapons.current.reserve = 0;
  place(X, crate.x, crate.z, 0); X.player.pos.y = crate.y; step([X, Y], 5);
  check(X.weapons.current.reserve > 0, 'collecting an ammo crate gives ammo');
  check(!live(Y).some((i) => i.netId === crate.netId), 'the crate disappears on the other client');

  // the lowest-id player spawns crates around the map over time
  for (const i of X.pickups.items) i.active = false; for (const i of Y.pickups.items) i.active = false;
  step([X, Y], Math.round((CONFIG.multiplayer.pickupInterval + 1) / dt));
  check(live(X).length >= 1 && ids(X) === ids(Y), `map crates spawn and sync (${live(X).length})`);
  check(Math.floor(X.net.id) < Math.floor(Y.net.id) && live(X).every((i) => Math.floor(i.netId / 1e6) === X.net.id), 'only the lowest-id player spawns them');
  step([X, Y], Math.round(120 / dt));
  check(live(X).length <= CONFIG.multiplayer.pickupMax + 2, `crate count stays bounded (${live(X).length})`);
}

// ---- crouch and lean across the network ----
{
  const P = createInstance('Pia'); const Q = createInstance('Quin');
  P.join(); Q.join(); step([P, Q], 5);
  place(P, -12, 20, 0); place(Q, -12, -5, Math.PI); step([P, Q], 20);
  const remote = P.remotes.list.find((r) => r.name === 'Quin');
  const ray = (y, x = -12) => P.remotes.raycast(new THREE.Vector3(x, y, 20), new THREE.Vector3(0, 0, -1), 100);
  check(ray(1.65), 'a standing remote player is hit at head height');
  Q.input.crouchHeld = 1; step([P, Q], 40);
  check(remote.view.player.crouching, 'P sees that Quin is crouching');
  check(!ray(1.8) && ray(1.05), 'a crouched remote player is hit lower, and a standing-height shot passes over');
  Q.input.crouchHeld = 0; Q.input.leanRight = 1; step([P, Q], 60);
  check(Math.abs(remote.view.player.lean - 1) < 0.1, 'P sees Quin leaning');
  // Quin faces +z (yaw = PI): right vector = (cos PI, -sin PI) = (-1, 0), so a right lean moves his head to x = -12.45 - ... in world space
  const headX = -12 + Math.cos(Math.PI) * 0.45;
  check(ray(1.65, headX) && !ray(1.65, -12 + 1.0), `the leaning head is where the peek puts it (x ${headX.toFixed(2)})`);
}

// ---- kill/death ratio and the leaderboard ----
{
  check(kdRatio(5, 0) === 5 && formatKd(5, 0) === '5.00', 'no deaths: K/D is the kill count');
  check(formatKd(3, 2) === '1.50' && formatKd(0, 4) === '0.00' && formatKd(0, 0) === '0.00', 'K/D = kills / deaths, two decimals');
  const rows = [
    { name: 'Low', kills: 2, deaths: 5 }, { name: 'Tie-bad', kills: 4, deaths: 4 },
    { name: 'Tie-good', kills: 4, deaths: 2 }, { name: 'Top', kills: 9, deaths: 9 }, { name: 'Zed', kills: 4, deaths: 2 },
  ];
  check(rankRows(rows).map((r) => r.name).join() === 'Top,Tie-good,Zed,Tie-bad,Low', `ranking: kills, then K/D, then deaths, then name (${rankRows(rows).map((r) => r.name)})`);

  const L = createInstance('Lia'); const M = createInstance('Max');
  for (const c of server.clients) if (c.name !== 'Lia' && c.name !== 'Max') c.joined = false;
  server.broadcastRoster(); L.join(); M.join(); step([L, M], 10);
  place(L, -12, 20, 0); place(M, -12, -5, Math.PI); step([L, M], Math.round(2.3 / dt));
  for (let k = 0; k < 3; k++) {
    place(L, -12, 20, 0); place(M, -12, -5, Math.PI); step([L, M], 20);
    for (let i = 0; i < 8 && M.player.alive; i++) { L.input.firePressed = 1; step([L, M], 14); }
    step([L, M], 5);
    if (k < 2) step([L, M], Math.round(5.5 / dt));
  }
  const lia = L.deathmatch.scores.get(L.net.id), max = L.deathmatch.scores.get(M.net.id);
  check(lia.kills === 3 && max.deaths >= 3, `kills ${lia.kills}, Max deaths ${max.deaths}`);
  check(L.deathmatch.over && lia.wins === 1 && M.deathmatch.scores.get(L.net.id).wins === 1, 'the winner gets 1 win on both clients');
  step([L, M], 40);
  check(L.log.board && L.log.board.title === 'Lia WINS' && L.log.board.rows.find((r) => r.name === 'Lia').wins === 1, `final standings are titled with the winner (${L.log.board?.title})`);
  step([L, M], Math.round(9 / dt));
  const after = L.deathmatch.scores.get(L.net.id);
  check(after.kills === 0 && after.deaths === 0 && after.wins === 1, 'a new match clears kills and deaths but keeps wins');
  check(L.log.mini && L.log.mini.length === 2, 'the corner top-three is fed every refresh');
  const N = createInstance('Nia'); N.join(); step([L, M, N], 10);
  check(N.deathmatch.scores.get(L.net.id)?.wins === 1, 'a late joiner receives the wins too');
}

console.log(fails ? `${fails} FAILED` : 'ALL OK');
