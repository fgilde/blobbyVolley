import { Peer, type DataConnection } from 'peerjs';
import { PlayerInput } from '../game/constants';
import { ClientMsg, ServerMsg, StateSnapshot } from './protocol';

export type Role = 'host' | 'guest';

export interface NetCallbacks {
  onCreated?: (code: string) => void;
  onJoined?: (code: string, peerName?: string) => void;
  onPeerJoined?: (peerName?: string) => void;
  onPeerLeft?: () => void;
  onInput?: (input: PlayerInput) => void;
  onState?: (snap: StateSnapshot) => void;
  onRematch?: () => void;
  onEmote?: (id: string) => void;
  onError?: (message: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onPing?: (ms: number) => void;
}

// Lobby codes become PeerJS IDs on the shared public broker, so we namespace
// them to avoid colliding with unrelated apps using the same broker.
const PEER_PREFIX = 'blobbyvolley3d-v1-';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no easily-confused chars
const CODE_LENGTH = 4;

function makeCode(): string {
  let code = '';
  const arr = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(arr);
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[arr[i] % CODE_ALPHABET.length];
  }
  return code;
}

/**
 * PeerJS connection options. Defaults to the free public PeerJS cloud broker.
 * A custom self-hosted PeerServer can be supplied via the URL, e.g.
 *   ?peer=my-peerserver.example.com or ?peer=host:9000/myapp
 * which is handy if the public broker is ever overloaded.
 */
function peerOptions(): Record<string, unknown> {
  const opts: Record<string, unknown> = { debug: 1 };
  const custom = new URLSearchParams(window.location.search).get('peer');
  if (custom) {
    const [hostPort, path] = custom.split('/');
    const [host, port] = hostPort.split(':');
    opts.host = host;
    if (port) opts.port = Number(port);
    opts.secure = window.location.protocol === 'https:';
    if (path) opts.path = '/' + path;
  }
  return opts;
}

/**
 * Peer-to-peer transport built on WebRTC via the free public PeerJS broker.
 * The broker is used purely for signaling; gameplay data flows directly between
 * the two players' browsers, so the whole game can be hosted as static files
 * (e.g. GitHub Pages) with no backend.
 *
 * The host registers a peer whose id encodes the lobby code; the guest connects
 * to that id. The public API mirrors a classic relay client so the rest of the
 * game (GameController, UI) is transport-agnostic.
 */
export class NetClient {
  private cb: NetCallbacks;
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private myName = 'Blobby';
  private pingTimer = 0;

  role: Role | null = null;
  code: string | null = null;
  ping = 0;

  constructor(cb: NetCallbacks) {
    this.cb = cb;
  }

  // --- Public API --------------------------------------------------------
  async create(name?: string): Promise<void> {
    this.cleanup();
    this.role = 'host';
    this.myName = name || 'Spieler 1';
    await this.createHostPeer(0);
  }

  async join(code: string, name?: string): Promise<void> {
    this.cleanup();
    this.role = 'guest';
    this.myName = name || 'Spieler 2';
    const clean = code.toUpperCase().trim();
    this.code = clean;

    const peer = new Peer(peerOptions());
    this.peer = peer;

    peer.on('open', () => {
      const conn = peer.connect(PEER_PREFIX + clean, {
        reliable: true,
        metadata: { name: this.myName },
      });
      this.setupConnection(conn, /*isHost*/ false);
    });
    peer.on('disconnected', () => this.tryReconnect());
    peer.on('error', (err) => this.handlePeerError(err));
  }

  /** Re-establish the broker link without dropping the existing data channel. */
  private tryReconnect(): void {
    try {
      if (this.peer && !this.peer.destroyed) this.peer.reconnect();
    } catch {
      /* ignore */
    }
  }

  sendInput(input: PlayerInput): void {
    this.rawSend({ t: 'input', input });
  }
  sendState(snap: StateSnapshot): void {
    this.rawSend({ t: 'state', snap });
  }
  sendRematch(): void {
    this.rawSend({ t: 'rematch' });
  }
  sendEmote(id: string): void {
    this.rawSend({ t: 'emote', id });
  }

  leave(): void {
    this.cleanup();
    this.role = null;
    this.code = null;
  }
  close(): void {
    this.cleanup();
  }

  // --- Host peer creation (retries on code collision) --------------------
  private createHostPeer(attempt: number): Promise<void> {
    return new Promise((resolve) => {
      const code = makeCode();
      const peer = new Peer(PEER_PREFIX + code, peerOptions());
      this.peer = peer;

      peer.on('open', () => {
        this.code = code;
        this.cb.onOpen?.();
        this.cb.onCreated?.(code);
        resolve();
      });

      peer.on('connection', (conn) => {
        // Only accept one guest; ignore further connections.
        if (this.conn && this.conn.open) {
          conn.close();
          return;
        }
        this.setupConnection(conn, /*isHost*/ true);
      });

      peer.on('disconnected', () => this.tryReconnect());

      peer.on('error', (err) => {
        if (err.type === 'unavailable-id' && attempt < 5) {
          peer.destroy();
          this.createHostPeer(attempt + 1).then(resolve);
        } else {
          this.handlePeerError(err);
          resolve();
        }
      });
    });
  }

  // --- Connection wiring -------------------------------------------------
  private setupConnection(conn: DataConnection, isHost: boolean): void {
    this.conn = conn;

    conn.on('open', () => {
      if (isHost) {
        // Greet the guest with our name; announce the guest to the host UI.
        const guestName = (conn.metadata && conn.metadata.name) || 'Spieler 2';
        this.rawSend({ t: 'hello', name: this.myName });
        this.cb.onPeerJoined?.(guestName);
      }
      this.startPing();
    });

    conn.on('data', (data) => this.handleData(data as ServerMsg | ClientMsg | HelloMsg));

    conn.on('close', () => {
      this.stopPing();
      this.cb.onPeerLeft?.();
      this.cb.onClose?.();
    });
    conn.on('error', () => {
      this.cb.onError?.('Verbindungsfehler.');
    });
  }

  private handleData(msg: ServerMsg | ClientMsg | HelloMsg): void {
    switch (msg.t) {
      case 'hello':
        // Guest learns the host's name -> the match can begin.
        this.cb.onJoined?.(this.code || '', msg.name);
        break;
      case 'input':
        this.cb.onInput?.(msg.input);
        break;
      case 'state':
        this.cb.onState?.(msg.snap);
        break;
      case 'rematch':
        this.cb.onRematch?.();
        break;
      case 'emote':
        this.cb.onEmote?.(msg.id);
        break;
      case 'ping':
        this.rawSend({ t: 'pong', ts: msg.ts });
        break;
      case 'pong':
        this.ping = Math.round(performance.now() - msg.ts);
        this.cb.onPing?.(this.ping);
        break;
    }
  }

  private rawSend(msg: ClientMsg | ServerMsg | HelloMsg): void {
    if (this.conn && this.conn.open) {
      this.conn.send(msg);
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      this.rawSend({ t: 'ping', ts: performance.now() });
    }, 2000);
    this.rawSend({ t: 'ping', ts: performance.now() });
  }
  private stopPing(): void {
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.pingTimer = 0;
  }

  private handlePeerError(err: { type?: string }): void {
    let message = 'Verbindung fehlgeschlagen.';
    if (err.type === 'peer-unavailable') message = 'Lobby nicht gefunden.';
    else if (err.type === 'unavailable-id') message = 'Lobby-Code bereits vergeben.';
    else if (err.type === 'browser-incompatible') message = 'Browser unterstützt kein WebRTC.';
    else if (err.type === 'network' || err.type === 'server-error')
      message = 'Signaling-Server nicht erreichbar.';
    this.cb.onError?.(message);
  }

  private cleanup(): void {
    this.stopPing();
    if (this.conn) {
      try {
        this.conn.close();
      } catch {
        /* ignore */
      }
      this.conn = null;
    }
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        /* ignore */
      }
      this.peer = null;
    }
  }
}

// A tiny extra message type for the P2P name handshake (host -> guest).
type HelloMsg = { t: 'hello'; name: string };
