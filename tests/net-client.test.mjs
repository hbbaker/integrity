import { load } from './support/modules.mjs';
globalThis.location = { protocol: 'http:', host: 'localhost:8123' };
const { NetClient, NET_STATUS, isValidName } = await load('net');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (c, m) => { console.log(c ? 'ok  :' : 'FAIL:', m); if (!c) fails++; };
function make() {
  const log = { status: [], rosters: [], errors: [], messages: [] };
  const net = new NetClient({
    onStatus: (s) => log.status.push(s), onRoster: (p) => log.rosters.push(p),
    onJoinError: (c) => log.errors.push(c), onMessage: (from, m) => log.messages.push([from, m]),
  });
  return { net, log };
}
const a = make(); const b = make();
a.net.connect(); b.net.connect();
await wait(300);
check(a.net.status === NET_STATUS.ONLINE && a.net.id > 0, 'client A online with an id');
a.net.join('Ada'); await wait(150);
check(a.net.joined && b.log.rosters.at(-1).some((p) => p.name === 'Ada'), 'B sees Ada in the lobby before joining');
b.net.join('ada'); await wait(150);
check(b.log.errors.includes('name-taken') && !b.net.joined, 'duplicate name is refused');
b.net.join('Bob'); await wait(150);
check(b.net.joined, 'Bob joins with a new name');
a.net.send({ t: 's', x: 3 }); await wait(150);
check(b.log.messages.some(([from, m]) => from === a.net.id && m.t === 's' && m.x === 3), 'state relayed with sender id');
check(a.log.messages.length === 0, 'sender gets no echo');
await wait(100);
check(a.net.latency > 0 && a.net.latency < 100, `latency measured: ${a.net.latency.toFixed(1)} ms`);
check(isValidName('Ada_1') && !isValidName('bad"name') && !isValidName('   '), 'client-side name rule');
b.net.close(); await wait(200);
check(a.log.rosters.at(-1).length === 1 && b.log.status.at(-1) === NET_STATUS.CLOSED, 'leave updates roster and status');
a.net.close();
console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
