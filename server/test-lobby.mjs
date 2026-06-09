// Quick integration test of the relay server: host creates a lobby, guest joins
// via the code, then a state/input message is relayed in each direction.
import WebSocket from 'ws';

const URL = 'ws://localhost:8080';
const log = (...a) => console.log(...a);

function open() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(URL);
    ws.on('open', () => res(ws));
    ws.on('error', rej);
  });
}
const next = (ws) => new Promise((res) => ws.once('message', (d) => res(JSON.parse(d.toString()))));

let failures = 0;
const assert = (cond, msg) => {
  log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
};

const host = await open();
const guest = await open();

host.send(JSON.stringify({ t: 'create', name: 'Host' }));
const created = await next(host);
assert(created.t === 'created' && /^[A-Z0-9]{4}$/.test(created.code), `host got code ${created.code}`);
assert(created.side === 'left', 'host is left');

const hostPeerJoinedP = next(host);
guest.send(JSON.stringify({ t: 'join', code: created.code, name: 'Guest' }));
const joined = await next(guest);
assert(joined.t === 'joined' && joined.side === 'right', 'guest joined as right');
assert(joined.peerName === 'Host', 'guest sees host name');
const hostPeerJoined = await hostPeerJoinedP;
assert(hostPeerJoined.t === 'peer-joined' && hostPeerJoined.peerName === 'Guest', 'host notified of guest');

// Host -> guest state relay.
const guestStateP = next(guest);
host.send(JSON.stringify({ t: 'state', snap: { seq: 1, score: [2, 3] } }));
const relayedState = await guestStateP;
assert(relayedState.t === 'state' && relayedState.snap.seq === 1, 'state relayed host->guest');

// Guest -> host input relay.
const hostInputP = next(host);
guest.send(JSON.stringify({ t: 'input', input: { left: true, right: false, jump: true } }));
const relayedInput = await hostInputP;
assert(relayedInput.t === 'input' && relayedInput.input.jump === true, 'input relayed guest->host');

// Joining a bogus code errors.
const stray = await open();
stray.send(JSON.stringify({ t: 'join', code: 'ZZZZ' }));
const err = await next(stray);
assert(err.t === 'error', 'bogus code rejected');

// Guest leaving notifies the host.
const hostPeerLeftP = next(host);
guest.close();
const peerLeft = await hostPeerLeftP;
assert(peerLeft.t === 'peer-left', 'host notified when guest disconnects');

host.close();
stray.close();
log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
