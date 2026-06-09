// Wire protocol shared between the client (TS) and the relay server (JS).
// The server is a dumb relay: it manages rooms/lobby codes and forwards
// gameplay messages between the two peers. The host (room creator, plays on the
// LEFT side) runs the authoritative simulation and streams snapshots; the guest
// (RIGHT side) streams its input.

import { PlayerInput } from '../game/constants';

export interface BallSnap {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
export interface BlobSnap {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface StateSnapshot {
  seq: number;
  ball: BallSnap;
  blobs: [BlobSnap, BlobSnap];
  score: [number, number];
  ballActive: boolean;
  serving: number;
  /** Winner side if the match is over, otherwise null/undefined. */
  over?: number | null;
  /** Countdown seconds remaining before the rally starts (host-driven). */
  countdown?: number;
  /** Contact events to play effects for, encoded compactly. */
  fx?: { t: string; x: number; y: number; s: number; side?: number }[];
}

// Client -> Server
export type ClientMsg =
  | { t: 'create'; name?: string }
  | { t: 'join'; code: string; name?: string }
  | { t: 'input'; input: PlayerInput }
  | { t: 'state'; snap: StateSnapshot }
  | { t: 'rematch' }
  | { t: 'emote'; id: string }
  | { t: 'leave' }
  | { t: 'ping'; ts: number };

// Server -> Client
export type ServerMsg =
  | { t: 'created'; code: string; side: 'left' }
  | { t: 'joined'; code: string; side: 'right'; peerName?: string }
  | { t: 'peer-joined'; peerName?: string }
  | { t: 'peer-left' }
  | { t: 'input'; input: PlayerInput }
  | { t: 'state'; snap: StateSnapshot }
  | { t: 'rematch' }
  | { t: 'emote'; id: string }
  | { t: 'pong'; ts: number }
  | { t: 'error'; message: string };

export const WS_PORT = 8080;
