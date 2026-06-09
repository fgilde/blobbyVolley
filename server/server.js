// Blobby Volley relay/lobby server.
//
// Responsibilities:
//   * Issue short lobby codes and pair two players into a room.
//   * Relay gameplay messages (input / state / rematch / emote) between the two
//     peers. It is intentionally "dumb": the host client owns the simulation.
//   * Optionally serve the built static client (`--serve-dist`) so the whole
//     thing runs from a single `node server/server.js --serve-dist` in prod.

import { WebSocketServer } from 'ws';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const SERVE_DIST = process.argv.includes('--serve-dist');
const DIST_DIR = path.join(__dirname, '..', 'dist');

// --- Lobby state ---------------------------------------------------------
/** code -> { host, guest } where each is a ws or null. */
const rooms = new Map();

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no easily-confused chars
function makeCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function peerOf(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return null;
  return ws.role === 'host' ? room.guest : room.host;
}

function closeRoom(code, reason) {
  const room = rooms.get(code);
  if (!room) return;
  for (const peer of [room.host, room.guest]) {
    if (peer) send(peer, { t: 'peer-left' });
  }
  rooms.delete(code);
  if (reason) console.log(`[room ${code}] closed (${reason})`);
}

// --- Static file serving (production) ------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200).end('ok');
    return;
  }
  if (!SERVE_DIST) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('Blobby Volley relay server running. WebSocket only.\n');
    return;
  }
  // Serve static files from dist, falling back to index.html (SPA).
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = path.join(DIST_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      filePath = path.join(DIST_DIR, 'index.html');
    }
    fs.readFile(filePath, (e, data) => {
      if (e) {
        res.writeHead(404).end('not found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
});

// --- WebSocket relay -----------------------------------------------------
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.roomCode = null;
  ws.role = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.t) {
      case 'create': {
        if (ws.roomCode) return;
        const code = makeCode();
        rooms.set(code, { host: ws, guest: null });
        ws.roomCode = code;
        ws.role = 'host';
        ws.name = (msg.name || 'Spieler 1').slice(0, 24);
        send(ws, { t: 'created', code, side: 'left' });
        console.log(`[room ${code}] created`);
        break;
      }

      case 'join': {
        if (ws.roomCode) return;
        const code = String(msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) {
          send(ws, { t: 'error', message: 'Lobby nicht gefunden.' });
          return;
        }
        if (room.guest) {
          send(ws, { t: 'error', message: 'Lobby ist bereits voll.' });
          return;
        }
        room.guest = ws;
        ws.roomCode = code;
        ws.role = 'guest';
        ws.name = (msg.name || 'Spieler 2').slice(0, 24);
        send(ws, { t: 'joined', code, side: 'right', peerName: room.host?.name });
        send(room.host, { t: 'peer-joined', peerName: ws.name });
        console.log(`[room ${code}] guest joined`);
        break;
      }

      case 'input':
      case 'state':
      case 'rematch':
      case 'emote': {
        const peer = peerOf(ws);
        if (peer) send(peer, msg);
        break;
      }

      case 'ping':
        send(ws, { t: 'pong', ts: msg.ts });
        break;

      case 'leave':
        if (ws.roomCode) closeRoom(ws.roomCode, 'leave');
        ws.roomCode = null;
        ws.role = null;
        break;
    }
  });

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('close', () => {
    if (ws.roomCode) closeRoom(ws.roomCode, 'disconnect');
  });
});

// Heartbeat: drop dead sockets.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`Blobby Volley server listening on :${PORT}` + (SERVE_DIST ? ' (serving dist/)' : ''));
});
