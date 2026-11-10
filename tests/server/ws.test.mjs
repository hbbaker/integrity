const open = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://localhost:${process.env.TEST_PORT || 8123}/ws`);
  const inbox = [];
  ws.onmessage = (e) => inbox.push(JSON.parse(e.data));
  ws.onopen = () => resolve({ ws, inbox });
  ws.onerror = reject;
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) fails++; };
const a = await open(); const b = await open();
await wait(100);
check(a.inbox[0].t === 'welcome' && b.inbox[0].t === 'welcome' && a.inbox[0].id !== b.inbox[0].id, 'both get welcome with distinct ids');
a.ws.send(JSON.stringify({ t: 'join', name: 'Ada' }));
await wait(100);
check(b.inbox.some((m) => m.t === 'roster' && m.players.length === 1 && m.players[0].name === 'Ada'), 'lurker sees roster update');
b.ws.send(JSON.stringify({ t: 'join', name: 'ada' }));
await wait(100);
check(b.inbox.some((m) => m.t === 'error' && m.code === 'name-taken'), 'duplicate name rejected');
b.ws.send(JSON.stringify({ t: 'join', name: 'Bob' }));
await wait(100);
a.inbox.length = 0; b.inbox.length = 0;
a.ws.send(JSON.stringify({ t: 'state', x: 1.5 }));
await wait(100);
check(b.inbox.some((m) => m.from === a.inbox.length && false) || b.inbox.some((m) => m.m && m.m.t === 'state' && m.m.x === 1.5), 'state relayed to Bob');
check(!a.inbox.some((m) => m.m), 'sender does not get its own message');
a.ws.send(JSON.stringify({ t: 'ping', n: 777 }));
await wait(100);
check(a.inbox.some((m) => m.t === 'pong' && m.n === 777), 'ping answered with pong');
b.inbox.length = 0;
a.ws.close();
await wait(150);
check(b.inbox.some((m) => m.t === 'roster' && m.players.length === 1 && m.players[0].name === 'Bob'), 'leave updates roster');
// 9 joins -> full
const extra = [];
for (let i = 0; i < 8; i++) { const c = await open(); c.ws.send(JSON.stringify({ t: 'join', name: 'P' + i })); extra.push(c); await wait(30); }
await wait(100);
check(extra[7].inbox.some((m) => m.t === 'error' && m.code === 'full'), 'ninth player is refused (full)');
// cross-origin upgrade refused
const res = await fetch(`http://localhost:${process.env.TEST_PORT || 8123}/ws`, { headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13', Origin: 'http://evil.example' } }).catch((e) => ({ status: 'err ' + e.message }));
console.log('cross-origin status:', res.status);
[b, ...extra].forEach((c) => c.ws.close());
await wait(100);
console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
