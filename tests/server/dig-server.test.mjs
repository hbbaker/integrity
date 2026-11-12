const PORT = process.env.TEST_PORT || 18123;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) fails++; };

function open(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const c = { label, ws, inbox: [], raw: [], id: 0 };
    ws.onmessage = (e) => { c.raw.push(e.data); const m = JSON.parse(e.data); c.inbox.push(m); if (m.t === 'welcome') c.id = m.id; };
    ws.onopen = () => resolve(c);
    ws.onerror = reject;
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));
const last = (c, t) => [...c.inbox].reverse().find((m) => m.t === t);
const all = (c, t) => c.inbox.filter((m) => m.t === t);
const clear = (...cs) => cs.forEach((c) => { c.inbox.length = 0; c.raw.length = 0; });

const [a, b, c, d] = await Promise.all(['A', 'B', 'C', 'D'].map(open));
await wait(100);
check([a, b, c].every((x) => x.id > 0), 'all connected');

// lobby
send(a, { t: 'dg_join', name: 'Ada' }); await wait(80);
check(last(a, 'dg_lobby')?.host === a.id && last(a, 'dg_lobby').players.length === 1, 'first joiner is host');
send(b, { t: 'dg_join', name: 'ada' }); await wait(80);
check(last(b, 'dg_error')?.code === 'name-taken', 'duplicate name refused');
send(b, { t: 'dg_join', name: 'bad"name' }); await wait(80);
check(last(b, 'dg_error')?.code === 'bad-name', 'bad name refused');
send(b, { t: 'dg_start' }); await wait(80);
check(last(b, 'dg_error')?.code === 'not-host', 'a non-member cannot start');
send(a, { t: 'dg_start' }); await wait(80);
check(last(a, 'dg_error')?.code === 'too-few', 'start refused with one player');
send(b, { t: 'dg_join', name: 'Bob' }); send(c, { t: 'dg_join', name: 'Cyd' }); await wait(120);
check(last(a, 'dg_lobby').players.length === 3 && last(c, 'dg_lobby').host === a.id, 'lobby lists three players in real time');
send(b, { t: 'dg_start' }); await wait(80);
check(last(b, 'dg_error')?.code === 'not-host', 'only the host can start');

// start
clear(a, b, c);
send(a, { t: 'dg_start' }); await wait(200);
const maps = [a, b, c].map((x) => last(x, 'dg_map'));
check(maps.every(Boolean), 'everyone gets a map');
check(new Set(maps.map((m) => m.spawn.join())).size === 3, 'spawns differ per player');
const secretWords = ['"lines"', '"depths"', '"tape"', '"tiles"', '"reveal"', '"kind"'];
check(a.raw.concat(b.raw, c.raw).every((t) => secretWords.every((w) => !t.includes(w))), 'nothing about buried lines before the first dig');
check(maps[0].map.indicators.length > 10 && maps[0].map.buildings.length >= 4, `map has ${maps[0].map.indicators.length} indicators and ${maps[0].map.buildings.length} buildings`);
check(maps[0].duration === 14, 'match length comes from the server');

// late join
send(d, { t: 'dg_join', name: 'Dee' }); await wait(80);
check(last(d, 'dg_error')?.code === 'in-progress', 'late join refused while running');

// positions and relay
const spawnWorld = (m) => ({ x: m.spawn[0] + 0.5 - 24, z: m.spawn[1] + 0.5 - 24 });
const pos = (x, m) => ({ t: 's', x: spawnWorld(m).x, y: 0, z: spawnWorld(m).z, yw: 0, pt: 0, vx: 0, vz: 0, g: 1, sl: 0, sp: 0, w: 6, a: 0, f: 0, r: 0, al: 1, hp: 100 });
[a, b, c].forEach((x, i) => send(x, pos(x, maps[i]))); await wait(100);
check(b.inbox.some((m) => m.from === a.id && m.m?.t === 's'), 'pose messages are relayed between players');
check(!a.inbox.some((m) => m.from === a.id), 'no echo of your own pose');
clear(a, b, c);
send(a, { ...pos(a, maps[0]), su: 3, sx: 4.5, sz: -2.25, sw: 1.5, sc: '01230' }); await wait(100);
const suited = b.inbox.find((m) => m.from === a.id && m.m?.t === 's')?.m;
check(suited && suited.su === 3 && suited.sx === 4.5 && suited.sz === -2.25 && suited.sw === 1.5 && suited.sc === '01230', 'the mech suit fields of a pose are relayed to the other players untouched');

// digging
const tileOf = (m) => ({ x: m.spawn[0], z: m.spawn[1] - 1 }); // one tile toward the street centre line, within reach
const target = tileOf(maps[0]);
clear(a, b, c);
send(a, { t: 'dg_dig', ...target }); await wait(150);
let first = last(a, 'dg_dig');
check(first && first.by === a.id && first.depth === 6 && first.res === 'safe' && first.pts === 10, `first dig: ${JSON.stringify(first)}`);
check(last(b, 'dg_dig')?.depth === 6 && last(c, 'dg_dig')?.x === target.x, 'everyone sees the new hole depth');
send(a, { t: 'dg_dig', ...target }); await wait(120);
check(last(a, 'dg_no')?.why === 'cooldown', 'a second dig inside the cooldown is refused');
check(last(a, 'dg_no')?.depth === 6, 'the refusal carries the hole depth');
send(a, { t: 'dg_dig', x: 0, z: 0 }); await wait(120);
check(last(a, 'dg_no')?.why === 'far', 'a dig far from the player is refused');

// two players on one tile in one tick, lower id resolves first
await wait(1200);
clear(a, b, c);
const shared = { x: maps[1].spawn[0], z: maps[1].spawn[1] - 1 };
[a, b, c].forEach((x) => send(x, { ...pos(x, maps[1]) }));
await wait(80);
send(c, { t: 'dg_dig', ...shared }); send(b, { t: 'dg_dig', ...shared }); await wait(200);
const order = a.inbox.filter((m) => m.t === 'dg_dig' || m.t === 'dg_no').map((m) => `${m.t}:${m.by ?? ''}`);
const digs = all(a, 'dg_dig');
check(digs.length >= 1 && digs[0].by === Math.min(b.id, c.id), `simultaneous digs resolve lower id first (${order.join(', ')})`);
check(digs.length === 1 || digs[1].depth === digs[0].depth + 6 || digs[0].res === 'strike', 'the second digger builds on the first depth');

// Dig the telecom main (row 18, north side): its depth is 12-24 in, so a strike comes within 4 layers.
send(a, { t: 's', x: 20.5 - 24, y: 0, z: 19.5 - 24, yw: 0, pt: 0, vx: 0, vz: 0, g: 1, sl: 0, sp: 0, w: 6, a: 0, f: 0, r: 0, al: 1, hp: 100 });
await wait(100);
let sawStrike = null; let layers = 0;
clear(a, b);
for (let i = 0; i < 6 && !sawStrike; i++) {
  send(a, { t: 'dg_dig', x: 20, z: 18 });
  await wait(250);
  const r = last(a, 'dg_dig');
  if (r?.res === 'strike') sawStrike = r;
  else check(!a.raw.some((t) => t.includes('"reveal"')) && !a.raw.some((t) => t.includes('"kind"')), `safe dig ${i + 1} (${r?.res}, ${r?.depth} in) reveals nothing`);
  layers += 1;
  await wait(600 + 120 * layers);
}
check(sawStrike && sawStrike.kind === 'telecom' && sawStrike.pen > 0 && sawStrike.reveal.length >= 4, `striking the telecom line reveals it: ${JSON.stringify(sawStrike)?.slice(0, 160)}`);
check(sawStrike && last(b, 'dg_dig')?.res === 'strike' && last(b, 'dg_dig').reveal.length >= 4, 'everyone sees the revealed line');
send(a, { t: 'dg_dig', x: 20, z: 18 }); await wait(200);
check(last(a, 'dg_no')?.why === 'locked', 'the struck hole is locked');
check(sawStrike && sawStrike.score === last(a, 'dg_dig').score, 'the strike carries the new score');

check(a.raw.concat(b.raw, c.raw).every((x) => !x.includes('tape')) && [a, b, c].every((x) => all(x, 'dg_dig').every((m) => m.res === 'safe' || m.res === 'strike')), 'dig results are only safe or strike: no warning layer');

// disconnect mid-match: roster updates, match continues
clear(a, b);
c.ws.close(); await wait(150);
check(last(a, 'dg_lobby')?.players.length === 2 && last(a, 'dg_lobby').phase === 'running', 'a disconnect updates the roster and the match runs on');

// match end and results
for (let i = 0; i < 100 && !last(a, 'dg_end'); i++) await wait(100);
const end = last(a, 'dg_end');
check(end && end.results.length === 3 && end.results.some((r) => r.left), `results arrive when time is up (${end?.results.map((r) => `${r.name}:${r.score}${r.left ? '(left)' : ''}`).join(' ')})`);
check(end && end.results.every((r, i, rows) => i === 0 || rows[i - 1].score >= r.score), 'results are sorted by score');

// back to lobby
clear(a, b);
send(b, { t: 'dg_again' }); await wait(120);
check(last(a, 'dg_lobby')?.phase === 'lobby' && last(a, 'dg_lobby').players.length === 2, 'back to lobby drops the player who left');
send(d, { t: 'dg_join', name: 'Dee' }); await wait(100);
check(last(d, 'dg_lobby')?.players.length === 3, 'a new player can join once the lobby is open again');
send(a, { t: 'dg_start' }); await wait(150);
check(last(d, 'dg_map') && last(a, 'dg_map'), 'a second match starts');

// ---- solo games: private, one player, start at once, isolated from everyone else ----
const [e, f] = await Promise.all([open('E'), open('F')]);
await wait(100);
clear(a, b, d);
send(e, { t: 'dg_solo', name: 'Eve' }); send(f, { t: 'dg_solo', name: 'bad"name' }); await wait(250);
const soloMap = last(e, 'dg_map');
check(soloMap && soloMap.solo === true && soloMap.players.length === 1 && soloMap.players[0].name === 'Eve', 'a solo player gets a one-player map at once');
check(last(f, 'dg_map')?.players[0].name === 'Solo', 'an invalid solo name falls back to "Solo"');
check(!e.inbox.some((m) => m.t === 'dg_lobby'), 'a solo start sends no lobby message');
check([a, b, d].every((x) => !x.inbox.some((m) => m.t === 'dg_map' || m.t === 'dg_lobby')), 'the shared lobby heard nothing about the solo games');
const soloSpawn = { x: soloMap.spawn[0] + 0.5 - 24, z: soloMap.spawn[1] + 0.5 - 24 };
const soloPose = { t: 's', x: soloSpawn.x, y: 0, z: soloSpawn.z, yw: 0, pt: 0, vx: 0, vz: 0, g: 1, sl: 0, sp: 0, w: 6, a: 0, f: 0, r: 0, al: 1, hp: 100 };
send(e, soloPose); send(f, { ...soloPose, x: last(f, 'dg_map').spawn[0] + 0.5 - 24, z: last(f, 'dg_map').spawn[1] + 0.5 - 24 });
await wait(100);
clear(e, f);
send(e, { t: 'dg_dig', x: soloMap.spawn[0], z: soloMap.spawn[1] - 1 });
send(f, { t: 'dg_dig', x: last(f, 'dg_map')?.spawn[0] ?? 0, z: (last(f, 'dg_map')?.spawn[1] ?? 1) - 1 });
await wait(250);
check(last(e, 'dg_dig')?.by === e.id && last(e, 'dg_dig').depth === 6, 'a solo dig resolves for the solo player');
check(!all(e, 'dg_dig').some((m) => m.by === f.id) && !all(f, 'dg_dig').some((m) => m.by === e.id), 'two solo players never see each other\'s digs');
check([a, b, d].every((x) => !x.inbox.some((m) => m.t === 'dg_dig' && (m.by === e.id || m.by === f.id))), 'and the shared match never sees them');
send(e, { t: 'dg_solo', name: 'Eve' }); await wait(200);
check(all(e, 'dg_map').length === 1, 'asking again starts a fresh solo game');
send(e, { t: 'dg_leave' }); await wait(100); clear(e);
send(e, { t: 'dg_dig', x: 1, z: 1 }); await wait(150);
check(!all(e, 'dg_dig').length && !all(e, 'dg_no').length, 'after leaving, a solo player is no longer in a game');
[e, f].forEach((x) => x.ws.close());

[a, b, c, d].forEach((x) => x.ws.close());
await wait(100);
console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
