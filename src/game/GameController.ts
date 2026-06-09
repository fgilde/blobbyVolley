import { AIController, Difficulty } from './AI';
import { EMPTY_INPUT, FIXED_DT, PlayerInput, Side, WINNING_SCORE } from './constants';
import { InputManager } from './Input';
import { BlobState, Simulation, SimState, stepBlobKinematics } from './Simulation';
import { GameRenderer } from '../render/GameRenderer';
import { NetClient } from '../net/NetClient';
import { StateSnapshot } from '../net/protocol';

export type Mode = 'cpu' | 'host' | 'guest';
export type Phase = 'countdown' | 'rally' | 'point' | 'matchover';

export interface GameCallbacks {
  onScore: (left: number, right: number) => void;
  onPhase: (
    phase: Phase,
    info?: { winner?: Side; countdown?: number; pointWinner?: Side; reason?: 'ground' | 'fault' },
  ) => void;
  onPing?: (ms: number) => void;
}

const SNAPSHOT_INTERVAL = 1 / 40; // host streams 40 snapshots/s
const INTERP_DELAY = 0.11; // guest renders ~110ms in the past for smoothness

export class GameController {
  private sim = new Simulation();
  private ai: AIController | null = null;
  private mode: Mode = 'cpu';

  private running = false;
  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;

  private phase: Phase = 'countdown';
  private phaseTimer = 0;
  private seq = 0;
  private snapAccum = 0;
  private currentCountdown = 3;
  private matchOverWinner: Side | null = null;

  // Online state.
  private remoteInput: PlayerInput = { ...EMPTY_INPUT };
  private snapBuffer: { time: number; snap: StateSnapshot }[] = [];
  /** Guest: locally predicted state of the player's OWN blob (client prediction). */
  private predBlob: BlobState | null = null;
  private predAccum = 0;

  constructor(
    private renderer: GameRenderer,
    private input: InputManager,
    private net: NetClient | null,
    private cb: GameCallbacks,
  ) {}

  // --- Public lifecycle --------------------------------------------------
  startCpu(difficulty: Difficulty): void {
    this.mode = 'cpu';
    this.ai = new AIController(Side.Right, difficulty);
    this.sim = new Simulation(Side.Left);
    this.beginCountdown();
    this.run();
  }

  startHost(): void {
    this.mode = 'host';
    this.ai = null;
    this.sim = new Simulation(Side.Left);
    this.beginCountdown();
    this.run();
  }

  startGuest(): void {
    this.mode = 'guest';
    this.ai = null;
    this.phase = 'rally';
    this.predBlob = null;
    this.run();
  }

  setDifficulty(d: Difficulty): void {
    this.ai?.setDifficulty(d);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /** Called when the guest receives an authoritative snapshot. */
  receiveSnapshot(snap: StateSnapshot, nowSec: number): void {
    this.snapBuffer.push({ time: nowSec, snap });
    if (this.snapBuffer.length > 30) this.snapBuffer.shift();
  }

  /** Called on the host when guest input arrives. */
  receiveRemoteInput(input: PlayerInput): void {
    this.remoteInput = input;
  }

  requestRematch(): void {
    this.resetMatch();
    this.beginCountdown();
  }

  // --- Match flow --------------------------------------------------------
  private resetMatch(): void {
    this.sim = new Simulation(Side.Left);
    this.cb.onScore(0, 0);
  }

  private beginCountdown(): void {
    this.phase = 'countdown';
    this.phaseTimer = 3;
    this.currentCountdown = 3;
    this.matchOverWinner = null;
    this.cb.onPhase('countdown', { countdown: 3 });
  }

  /** Host: stream a snapshot to the guest at the configured rate. */
  private maybeStream(frameDt: number, force = false): void {
    if (this.mode !== 'host' || !this.net) return;
    this.snapAccum += frameDt;
    if (force || this.snapAccum >= SNAPSHOT_INTERVAL) {
      this.snapAccum = 0;
      this.net.sendState(this.encodeSnapshot());
    }
  }

  private matchWon(): Side | null {
    const [l, r] = this.sim.state.score;
    if (l >= WINNING_SCORE && l - r >= 2) return Side.Left;
    if (r >= WINNING_SCORE && r - l >= 2) return Side.Right;
    return null;
  }

  // --- Main loop ---------------------------------------------------------
  private run(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    const loop = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);
      let dt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      if (dt > 0.1) dt = 0.1; // clamp after tab switches

      if (this.mode === 'guest') {
        this.tickGuest(dt, now / 1000);
      } else {
        this.tickHostOrCpu(dt);
      }
      this.renderer.render();
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private tickHostOrCpu(frameDt: number): void {
    // Countdown / point pause phases.
    if (this.phase === 'countdown') {
      this.phaseTimer -= frameDt;
      const c = Math.max(0, Math.ceil(this.phaseTimer));
      this.currentCountdown = c;
      this.cb.onPhase('countdown', { countdown: c });
      if (this.phaseTimer <= 0) {
        this.phase = 'rally';
        this.cb.onPhase('rally');
      }
      this.maybeStream(frameDt);
      // Still render the frozen scene.
      this.renderer.sync(this.sim.state, frameDt);
      return;
    }

    if (this.phase === 'point') {
      this.phaseTimer -= frameDt;
      this.renderer.sync(this.sim.state, frameDt);
      if (this.phaseTimer <= 0) {
        const winner = this.matchWon();
        if (winner !== null) {
          this.phase = 'matchover';
          this.matchOverWinner = winner;
          this.cb.onPhase('matchover', { winner });
          this.maybeStream(frameDt, true);
        } else {
          this.phase = 'rally';
          this.cb.onPhase('rally');
        }
      }
      this.maybeStream(frameDt);
      return;
    }

    if (this.phase === 'matchover') {
      this.maybeStream(frameDt);
      this.renderer.sync(this.sim.state, frameDt);
      return;
    }

    // --- Active rally: fixed-timestep physics ---
    this.accumulator += frameDt;
    let scoredThisFrame: Side | null = null;
    while (this.accumulator >= FIXED_DT) {
      const left = this.input.getPlayerInput();
      let right: PlayerInput;
      if (this.mode === 'cpu' && this.ai) {
        right = this.ai.update(this.sim, FIXED_DT);
      } else {
        right = this.remoteInput;
      }
      this.sim.step(FIXED_DT, left, right);
      if (this.sim.contacts.length) this.renderer.handleContacts(this.sim.contacts);
      if (this.sim.pointWinner !== null) {
        scoredThisFrame = this.sim.pointWinner;
      }
      this.accumulator -= FIXED_DT;
    }

    // Stream snapshots to the guest (host only).
    this.maybeStream(frameDt);

    if (scoredThisFrame !== null) {
      this.onPointScored(scoredThisFrame);
    }

    this.renderer.sync(this.sim.state, frameDt);
  }

  private onPointScored(winner: Side): void {
    const [l, r] = this.sim.state.score;
    this.cb.onScore(l, r);
    this.renderer.celebrate(winner);
    this.phase = 'point';
    this.phaseTimer = 1.4;
    this.cb.onPhase('point', { pointWinner: winner, reason: this.sim.pointReason });
    // Winner serves next (classic Blobby rule).
    this.sim.resetForServe(winner);
    if (this.mode === 'host' && this.net) {
      this.net.sendState(this.encodeSnapshot());
    }
  }

  // --- Guest rendering (interpolated from snapshots) ---------------------
  private tickGuest(frameDt: number, nowSec: number): void {
    // Always send our input upstream.
    if (this.net) this.net.sendInput(this.input.getPlayerInput());

    const renderTime = nowSec - INTERP_DELAY;
    const buf = this.snapBuffer;
    if (buf.length === 0) {
      this.renderer.sync(this.sim.state, frameDt);
      return;
    }

    // Find the two snapshots bracketing renderTime.
    let older = buf[0];
    let newer = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i].time <= renderTime && buf[i + 1].time >= renderTime) {
        older = buf[i];
        newer = buf[i + 1];
        break;
      }
    }
    const span = Math.max(1e-3, newer.time - older.time);
    const t = Math.max(0, Math.min(1, (renderTime - older.time) / span));

    const state = this.lerpSnapshots(older.snap, newer.snap, t);
    this.applyGuestScore(newer.snap);
    this.applyGuestPhase(newer.snap);

    // --- Client-side prediction of our OWN blob (Side.Right) ---
    // The ball + opponent come from the (slightly delayed) host snapshots, but
    // our own movement is simulated locally from local input so it feels lag-free.
    const rallyActive =
      newer.snap.ballActive && (newer.snap.over ?? null) === null && newer.snap.countdown === undefined;
    if (!rallyActive || !this.predBlob) {
      // Snap to authoritative whenever the rally isn't live (serve, countdown, point).
      const a = state.blobs[Side.Right];
      this.predBlob = {
        pos: { x: a.pos.x, y: a.pos.y },
        vel: { x: a.vel.x, y: a.vel.y },
        grounded: a.pos.y <= 0.01,
      };
      this.predAccum = 0;
    } else {
      const input = this.input.getPlayerInput();
      this.predAccum += frameDt;
      let guard = 0;
      while (this.predAccum >= FIXED_DT && guard++ < 8) {
        stepBlobKinematics(this.predBlob, input, Side.Right, FIXED_DT);
        this.predAccum -= FIXED_DT;
      }
    }
    state.blobs[Side.Right] = this.predBlob;

    // Fire contact effects from the newest snapshot once.
    if (newer.snap.seq !== this.lastFxSeq && newer.snap.fx) {
      this.lastFxSeq = newer.snap.seq;
      this.renderer.handleContacts(
        newer.snap.fx.map((f) => ({
          type: f.t as 'blob' | 'net' | 'ground' | 'wall' | 'ceiling',
          x: f.x,
          y: f.y,
          strength: f.s,
          side: f.side as Side | undefined,
        })),
      );
    }

    this.renderer.sync(state, frameDt);
  }

  private lastFxSeq = -1;
  private guestScore: [number, number] = [0, 0];
  private guestOver: Side | null = null;
  private guestCountdown = -1;

  private applyGuestScore(snap: StateSnapshot): void {
    if (snap.score[0] !== this.guestScore[0] || snap.score[1] !== this.guestScore[1]) {
      this.guestScore = [snap.score[0], snap.score[1]];
      this.cb.onScore(snap.score[0], snap.score[1]);
    }
  }

  private applyGuestPhase(snap: StateSnapshot): void {
    const over = snap.over ?? null;
    if (over !== null && this.guestOver === null) {
      this.guestOver = over;
      this.cb.onPhase('matchover', { winner: over as Side });
      return;
    }
    if (over === null && this.guestOver !== null) {
      // Match restarted by the host (rematch).
      this.guestOver = null;
      this.guestCountdown = -1;
      this.cb.onPhase('rally');
    }
    if (over !== null) return;

    if (snap.countdown !== undefined && snap.countdown !== this.guestCountdown) {
      this.guestCountdown = snap.countdown;
      this.cb.onPhase('countdown', { countdown: snap.countdown });
    } else if (snap.countdown === undefined && this.guestCountdown >= 0) {
      this.guestCountdown = -1;
      this.cb.onPhase('rally');
    }
  }

  private lerpSnapshots(a: StateSnapshot, b: StateSnapshot, t: number): SimState {
    const lerp = (x: number, y: number) => x + (y - x) * t;
    return {
      ball: {
        pos: { x: lerp(a.ball.x, b.ball.x), y: lerp(a.ball.y, b.ball.y) },
        vel: { x: b.ball.vx, y: b.ball.vy },
      },
      blobs: [
        {
          pos: { x: lerp(a.blobs[0].x, b.blobs[0].x), y: lerp(a.blobs[0].y, b.blobs[0].y) },
          vel: { x: b.blobs[0].vx, y: b.blobs[0].vy },
          grounded: b.blobs[0].y <= 0.01,
        },
        {
          pos: { x: lerp(a.blobs[1].x, b.blobs[1].x), y: lerp(a.blobs[1].y, b.blobs[1].y) },
          vel: { x: b.blobs[1].vx, y: b.blobs[1].vy },
          grounded: b.blobs[1].y <= 0.01,
        },
      ],
      score: [b.score[0], b.score[1]],
      serving: b.serving as Side,
      ballActive: b.ballActive,
    };
  }

  private encodeSnapshot(): StateSnapshot {
    const s = this.sim.state;
    return {
      seq: this.seq++,
      ball: { x: s.ball.pos.x, y: s.ball.pos.y, vx: s.ball.vel.x, vy: s.ball.vel.y },
      blobs: [
        { x: s.blobs[0].pos.x, y: s.blobs[0].pos.y, vx: s.blobs[0].vel.x, vy: s.blobs[0].vel.y },
        { x: s.blobs[1].pos.x, y: s.blobs[1].pos.y, vx: s.blobs[1].vel.x, vy: s.blobs[1].vel.y },
      ],
      score: [s.score[0], s.score[1]],
      ballActive: s.ballActive,
      serving: s.serving,
      over: this.matchOverWinner,
      countdown: this.phase === 'countdown' ? this.currentCountdown : undefined,
      fx: this.sim.contacts.map((c) => ({ t: c.type, x: c.x, y: c.y, s: c.strength, side: c.side })),
    };
  }
}
