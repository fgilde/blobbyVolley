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

/**
 * Resolve the relay/lobby WebSocket URL. Priority:
 *   1. `?relay=wss://host[/path]` query parameter (instant testing, no rebuild)
 *   2. build-time `VITE_RELAY_URL`
 *   3. localhost:8080 during local development
 *   4. same origin (when the static client is served by the node relay itself)
 *
 * GitHub Pages is served over HTTPS, so a remote relay must use `wss://`; a
 * bare host is therefore upgraded to `wss://` to avoid mixed-content blocking.
 */
function resolveRelayUrl(): string {
  const normalize = (raw: string): string => {
    const v = raw.trim();
    if (v.startsWith('ws://') || v.startsWith('wss://')) return v;
    return 'wss://' + v.replace(/^https?:\/\//, '').replace(/\/$/, '');
  };

  const override = new URLSearchParams(window.location.search).get('relay');
  if (override) return normalize(override);

  const baked = import.meta.env.VITE_RELAY_URL as string | undefined;
  if (baked) return normalize(baked);

  const { protocol, hostname, host } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'ws://' + hostname + ':8080';
  }
  const wsProto = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProto}//${host}`;
}

/**
 * WebSocket relay client. The server pairs two players into a room (lobby code)
 * and forwards gameplay messages between them; the host runs the authoritative
 * simulation. This is robust and low-latency as long as the relay is reachable.
 */
export class NetClient {
  private ws: WebSocket | null = null;
  private cb: NetCallbacks;
  role: Role | null = null;
  code: string | null = null;
  ping = 0;
  private pingTimer = 0;

  constructor(cb: NetCallbacks) {
    this.cb = cb;
  }

  private connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      const url = resolveRelayUrl();
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        reject(new Error('Ungültige Server-Adresse.'));
        return;
      }
      this.ws = ws;

      // Guard against a broker/relay that never finishes the handshake.
      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          reject(new Error('Zeitüberschreitung beim Verbinden.'));
        }
      }, 8000);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        this.cb.onOpen?.();
        this.startPing();
        resolve();
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        reject(new Error('Verbindung fehlgeschlagen.'));
      };
      ws.onclose = () => {
        this.stopPing();
        this.cb.onClose?.();
      };
      ws.onmessage = (ev) => this.handle(JSON.parse(ev.data as string) as ServerMsg);
    });
  }

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case 'created':
        this.role = 'host';
        this.code = msg.code;
        this.cb.onCreated?.(msg.code);
        break;
      case 'joined':
        this.role = 'guest';
        this.code = msg.code;
        this.cb.onJoined?.(msg.code, msg.peerName);
        break;
      case 'peer-joined':
        this.cb.onPeerJoined?.(msg.peerName);
        break;
      case 'peer-left':
        this.cb.onPeerLeft?.();
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
      case 'pong':
        this.ping = Math.round(performance.now() - msg.ts);
        this.cb.onPing?.(this.ping);
        break;
      case 'error':
        this.cb.onError?.(msg.message);
        break;
    }
  }

  private send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      this.send({ t: 'ping', ts: performance.now() });
    }, 2000);
    this.send({ t: 'ping', ts: performance.now() });
  }
  private stopPing(): void {
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.pingTimer = 0;
  }

  async create(name?: string): Promise<void> {
    await this.connect();
    this.send({ t: 'create', name });
  }
  async join(code: string, name?: string): Promise<void> {
    await this.connect();
    this.send({ t: 'join', code: code.toUpperCase().trim(), name });
  }

  sendInput(input: PlayerInput): void {
    this.send({ t: 'input', input });
  }
  sendState(snap: StateSnapshot): void {
    this.send({ t: 'state', snap });
  }
  sendRematch(): void {
    this.send({ t: 'rematch' });
  }
  sendEmote(id: string): void {
    this.send({ t: 'emote', id });
  }

  leave(): void {
    this.send({ t: 'leave' });
    this.role = null;
    this.code = null;
  }
  close(): void {
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }
}
