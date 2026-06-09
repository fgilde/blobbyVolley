import {
  BALL_GRAVITY,
  BALL_MAX_SPEED,
  BALL_RADIUS,
  BLOB_GRAVITY,
  BLOB_JUMP_SPEED,
  BLOB_MOVE_SPEED,
  BLOB_RADIUS,
  BLOB_VELOCITY_TRANSFER,
  CEILING_Y,
  COURT_HALF_WIDTH,
  HIT_IMPULSE,
  LEFT_START_X,
  NET_HALF_WIDTH,
  NET_HEIGHT,
  PlayerInput,
  RIGHT_START_X,
  Side,
} from './constants';

export interface Vec2 {
  x: number;
  y: number;
}

export interface BlobState {
  pos: Vec2;
  vel: Vec2;
  /** True while the blob is on the ground (can jump). */
  grounded: boolean;
}

export interface BallState {
  pos: Vec2;
  vel: Vec2;
}

/** A single contact event the renderer can turn into particles / sound. */
export interface ContactEvent {
  type: 'blob' | 'net' | 'ground' | 'wall' | 'ceiling';
  x: number;
  y: number;
  strength: number;
  side?: Side;
}

export interface SimState {
  ball: BallState;
  blobs: [BlobState, BlobState];
  score: [number, number];
  /** Whose turn it is to serve / who last touched matters for serving. */
  serving: Side;
  /** True between a point being scored and the next serve. */
  ballActive: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function len(x: number, y: number): number {
  return Math.hypot(x, y);
}

/**
 * Deterministic, fixed-timestep Blobby Volley simulation. Pure logic — knows
 * nothing about rendering or networking. The same class runs on the host for
 * online play and locally for the single-player / CPU modes.
 */
export class Simulation {
  state: SimState;
  /** Contacts produced during the last step() — consumed by the renderer. */
  contacts: ContactEvent[] = [];
  /** Set when a point is scored during step(): side that WON the point. */
  pointWinner: Side | null = null;

  constructor(serving: Side = Side.Left) {
    this.state = {
      ball: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } },
      blobs: [
        { pos: { x: LEFT_START_X, y: 0 }, vel: { x: 0, y: 0 }, grounded: true },
        { pos: { x: RIGHT_START_X, y: 0 }, vel: { x: 0, y: 0 }, grounded: true },
      ],
      score: [0, 0],
      serving,
      ballActive: false,
    };
    this.resetForServe(serving);
  }

  /** Place the ball above the serving blob and freeze it until first touch. */
  resetForServe(serving: Side): void {
    const s = this.state;
    s.serving = serving;
    s.ballActive = true;
    s.blobs[0].pos = { x: LEFT_START_X, y: 0 };
    s.blobs[0].vel = { x: 0, y: 0 };
    s.blobs[0].grounded = true;
    s.blobs[1].pos = { x: RIGHT_START_X, y: 0 };
    s.blobs[1].vel = { x: 0, y: 0 };
    s.blobs[1].grounded = true;
    const serveX = serving === Side.Left ? LEFT_START_X : RIGHT_START_X;
    s.ball.pos = { x: serveX, y: 8.5 };
    s.ball.vel = { x: 0, y: 0 };
  }

  /** Advance the simulation by one fixed timestep. */
  step(dt: number, inputLeft: PlayerInput, inputRight: PlayerInput): void {
    this.contacts.length = 0;
    this.pointWinner = null;

    this.stepBlob(this.state.blobs[Side.Left], inputLeft, Side.Left, dt);
    this.stepBlob(this.state.blobs[Side.Right], inputRight, Side.Right, dt);
    this.stepBall(dt);
  }

  private stepBlob(blob: BlobState, input: PlayerInput, side: Side, dt: number): void {
    // Horizontal movement is velocity-based and instantaneous (snappy controls).
    let dir = 0;
    if (input.left) dir -= 1;
    if (input.right) dir += 1;
    blob.vel.x = dir * BLOB_MOVE_SPEED;

    if (input.jump && blob.grounded) {
      blob.vel.y = BLOB_JUMP_SPEED;
      blob.grounded = false;
    }

    blob.vel.y += BLOB_GRAVITY * dt;
    blob.pos.x += blob.vel.x * dt;
    blob.pos.y += blob.vel.y * dt;

    // Clamp to own half of the court (cannot cross the net).
    const innerEdge = NET_HALF_WIDTH + BLOB_RADIUS;
    if (side === Side.Left) {
      blob.pos.x = clamp(blob.pos.x, -COURT_HALF_WIDTH + BLOB_RADIUS, -innerEdge);
    } else {
      blob.pos.x = clamp(blob.pos.x, innerEdge, COURT_HALF_WIDTH - BLOB_RADIUS);
    }

    // Ground.
    if (blob.pos.y <= 0) {
      blob.pos.y = 0;
      blob.vel.y = 0;
      blob.grounded = true;
    }
  }

  private stepBall(dt: number): void {
    const ball = this.state.ball;

    if (!this.state.ballActive) return;

    ball.vel.y += BALL_GRAVITY * dt;

    // Clamp insane speeds (prevents tunneling through the net at high energy).
    ball.vel.x = clamp(ball.vel.x, -BALL_MAX_SPEED, BALL_MAX_SPEED);
    ball.vel.y = clamp(ball.vel.y, -BALL_MAX_SPEED, BALL_MAX_SPEED);

    ball.pos.x += ball.vel.x * dt;
    ball.pos.y += ball.vel.y * dt;

    // --- Blob collisions ---
    this.collideBallWithBlob(this.state.blobs[Side.Left], Side.Left);
    this.collideBallWithBlob(this.state.blobs[Side.Right], Side.Right);

    // --- Walls ---
    if (ball.pos.x < -COURT_HALF_WIDTH + BALL_RADIUS) {
      ball.pos.x = -COURT_HALF_WIDTH + BALL_RADIUS;
      ball.vel.x = Math.abs(ball.vel.x);
      this.contacts.push({ type: 'wall', x: ball.pos.x, y: ball.pos.y, strength: Math.abs(ball.vel.x) });
    } else if (ball.pos.x > COURT_HALF_WIDTH - BALL_RADIUS) {
      ball.pos.x = COURT_HALF_WIDTH - BALL_RADIUS;
      ball.vel.x = -Math.abs(ball.vel.x);
      this.contacts.push({ type: 'wall', x: ball.pos.x, y: ball.pos.y, strength: Math.abs(ball.vel.x) });
    }

    // --- Ceiling ---
    if (ball.pos.y > CEILING_Y - BALL_RADIUS) {
      ball.pos.y = CEILING_Y - BALL_RADIUS;
      ball.vel.y = -Math.abs(ball.vel.y) * 0.85;
      this.contacts.push({ type: 'ceiling', x: ball.pos.x, y: ball.pos.y, strength: Math.abs(ball.vel.y) });
    }

    // --- Net ---
    this.collideBallWithNet();

    // --- Ground -> point scored ---
    if (ball.pos.y <= BALL_RADIUS) {
      ball.pos.y = BALL_RADIUS;
      const winner = ball.pos.x < 0 ? Side.Right : Side.Left;
      this.contacts.push({ type: 'ground', x: ball.pos.x, y: BALL_RADIUS, strength: Math.abs(ball.vel.y) });
      this.awardPoint(winner);
    }
  }

  private collideBallWithBlob(blob: BlobState, side: Side): void {
    const ball = this.state.ball;
    const minDist = BALL_RADIUS + BLOB_RADIUS;
    let nx = ball.pos.x - blob.pos.x;
    let ny = ball.pos.y - blob.pos.y;
    let dist = len(nx, ny);

    if (dist >= minDist) return;
    // The blob is a dome: ignore contacts on the lower hemisphere of the blob
    // so the ball can't bounce off "underneath" the body.
    if (ny < -BLOB_RADIUS * 0.35) return;

    if (dist < 1e-4) {
      nx = 0;
      ny = 1;
      dist = 1;
    }
    nx /= dist;
    ny /= dist;

    // Push the ball out of the blob.
    ball.pos.x = blob.pos.x + nx * minDist;
    ball.pos.y = blob.pos.y + ny * minDist;

    // Reflect velocity relative to the blob, then add part of the blob's motion.
    const relVx = ball.vel.x - blob.vel.x;
    const relVy = ball.vel.y - blob.vel.y;
    const dot = relVx * nx + relVy * ny;
    let rvx = relVx - 2 * dot * nx;
    let rvy = relVy - 2 * dot * ny;

    ball.vel.x = rvx + blob.vel.x * BLOB_VELOCITY_TRANSFER + nx * HIT_IMPULSE;
    ball.vel.y = rvy + blob.vel.y * BLOB_VELOCITY_TRANSFER + ny * HIT_IMPULSE;

    // Guarantee the ball always leaves the blob with some upward life.
    if (ball.vel.y < 1.5) ball.vel.y = 1.5 + Math.abs(ball.vel.y) * 0.2;

    const strength = len(ball.vel.x, ball.vel.y);
    this.contacts.push({ type: 'blob', x: ball.pos.x, y: ball.pos.y, strength, side });
  }

  private collideBallWithNet(): void {
    const ball = this.state.ball;
    const r = BALL_RADIUS;
    const netLeft = -NET_HALF_WIDTH;
    const netRight = NET_HALF_WIDTH;

    // Net top is a small circle the ball can ride over / tip off.
    const topX = 0;
    const topY = NET_HEIGHT;
    if (ball.pos.y > NET_HEIGHT - r) {
      let nx = ball.pos.x - topX;
      let ny = ball.pos.y - topY;
      const d = len(nx, ny);
      const minD = r + NET_HALF_WIDTH;
      if (d < minD) {
        if (d < 1e-4) {
          nx = ball.vel.x >= 0 ? 1 : -1;
          ny = 1;
        } else {
          nx /= d;
          ny /= d;
        }
        ball.pos.x = topX + nx * minD;
        ball.pos.y = topY + ny * minD;
        const dot = ball.vel.x * nx + ball.vel.y * ny;
        ball.vel.x -= 2 * dot * nx;
        ball.vel.y -= 2 * dot * ny;
        ball.vel.x *= 0.92;
        ball.vel.y *= 0.92;
        this.contacts.push({ type: 'net', x: ball.pos.x, y: ball.pos.y, strength: Math.abs(dot) });
      }
      return;
    }

    // Below the top: treat the net as a solid vertical wall.
    if (ball.pos.x + r > netLeft && ball.pos.x - r < netRight) {
      if (ball.pos.x < 0) {
        ball.pos.x = netLeft - r;
        ball.vel.x = -Math.abs(ball.vel.x);
      } else {
        ball.pos.x = netRight + r;
        ball.vel.x = Math.abs(ball.vel.x);
      }
      this.contacts.push({ type: 'net', x: ball.pos.x, y: ball.pos.y, strength: Math.abs(ball.vel.x) });
    }
  }

  private awardPoint(winner: Side): void {
    this.state.score[winner] += 1;
    this.state.ballActive = false;
    this.pointWinner = winner;
  }
}
