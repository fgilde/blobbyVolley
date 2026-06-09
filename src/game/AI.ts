import {
  BALL_GRAVITY,
  BALL_RADIUS,
  BLOB_RADIUS,
  COURT_HALF_WIDTH,
  NET_HALF_WIDTH,
  PlayerInput,
  Side,
} from './constants';
import { Simulation } from './Simulation';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'insane';

interface AIProfile {
  /** Seconds between "decisions" — higher = more sluggish reactions. */
  reactionTime: number;
  /** Random horizontal aiming error (world units) applied to the target. */
  aimError: number;
  /** How far ahead the AI is allowed to predict the ball (seconds). */
  lookahead: number;
  /** 0..1 chance per decision to just hesitate (do nothing). */
  laziness: number;
  /** How eagerly it jumps to smash (probability when in range). */
  aggression: number;
  /** Horizontal offset target so it aims the ball toward the far corner. */
  attackBias: number;
}

const PROFILES: Record<Difficulty, AIProfile> = {
  easy: { reactionTime: 0.28, aimError: 1.8, lookahead: 0.6, laziness: 0.28, aggression: 0.18, attackBias: 0.0 },
  medium: { reactionTime: 0.16, aimError: 1.0, lookahead: 1.1, laziness: 0.1, aggression: 0.45, attackBias: 1.2 },
  hard: { reactionTime: 0.08, aimError: 0.45, lookahead: 1.8, laziness: 0.02, aggression: 0.7, attackBias: 2.4 },
  insane: { reactionTime: 0.03, aimError: 0.12, lookahead: 2.6, laziness: 0.0, aggression: 0.9, attackBias: 3.2 },
};

/**
 * A self-contained opponent controller. It reads the simulation each decision
 * tick and produces a PlayerInput for its side. The prediction integrates the
 * ball forward analytically (gravity only) — cheap and good enough to feel
 * like a real, beatable opponent at every difficulty.
 */
export class AIController {
  private profile: AIProfile;
  private timer = 0;
  private targetX = 0;
  private wantJump = false;

  constructor(
    private side: Side,
    difficulty: Difficulty,
  ) {
    this.profile = PROFILES[difficulty];
  }

  setDifficulty(d: Difficulty): void {
    this.profile = PROFILES[d];
  }

  /** Called every frame; only re-decides every reactionTime seconds. */
  update(sim: Simulation, dt: number): PlayerInput {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.decide(sim);
      this.timer = this.profile.reactionTime;
    }

    const blob = sim.state.blobs[this.side];
    const input: PlayerInput = { left: false, right: false, jump: false };

    const dx = this.targetX - blob.pos.x;
    if (Math.abs(dx) > 0.15) {
      if (dx < 0) input.left = true;
      else input.right = true;
    }

    if (this.wantJump && blob.grounded) {
      input.jump = true;
    }
    return input;
  }

  private decide(sim: Simulation): void {
    const p = this.profile;
    const blob = sim.state.blobs[this.side];
    const ball = sim.state.ball;

    // Default: drift back toward home base on its own half.
    const homeX = this.side === Side.Left ? -COURT_HALF_WIDTH * 0.5 : COURT_HALF_WIDTH * 0.5;
    this.wantJump = false;

    if (Math.random() < p.laziness) {
      // Hesitate: hold position.
      this.targetX = blob.pos.x;
      return;
    }

    const ballComingToMe = this.isOnMySide(ball.pos.x) || this.headingToMySide(ball);
    if (!ballComingToMe) {
      // Reposition toward home, slightly toward the net to be ready.
      this.targetX = homeX;
      return;
    }

    // Predict where the ball will be when it descends to hitting height.
    const hitHeight = BLOB_RADIUS + BALL_RADIUS * 1.1;
    const landing = this.predictBall(ball.pos.x, ball.pos.y, ball.vel.x, ball.vel.y, hitHeight, p.lookahead);

    let target = landing.x;
    // Aim attacks toward the opponent's side / far corner.
    const towardOpponent = this.side === Side.Left ? 1 : -1;
    target += towardOpponent * p.attackBias * 0.15;
    // Stand slightly in front of the ball so the dome hits it forward.
    target -= towardOpponent * (BLOB_RADIUS * 0.35);

    // Random aiming error.
    target += (Math.random() * 2 - 1) * p.aimError;

    // Keep target on the AI's own half.
    const innerEdge = NET_HALF_WIDTH + BLOB_RADIUS;
    if (this.side === Side.Left) {
      target = Math.max(-COURT_HALF_WIDTH + BLOB_RADIUS, Math.min(-innerEdge, target));
    } else {
      target = Math.max(innerEdge, Math.min(COURT_HALF_WIDTH - BLOB_RADIUS, target));
    }
    this.targetX = target;

    // Decide whether to jump: ball close horizontally and within reach.
    const horizClose = Math.abs(ball.pos.x - blob.pos.x) < BLOB_RADIUS + BALL_RADIUS + 1.4;
    const ballReachable = ball.pos.y < 7.5 && ball.pos.y > BLOB_RADIUS;
    const descending = ball.vel.y < 4;
    if (horizClose && ballReachable && descending && Math.random() < p.aggression) {
      this.wantJump = true;
    }
  }

  private isOnMySide(x: number): boolean {
    return this.side === Side.Left ? x < 0 : x > 0;
  }

  private headingToMySide(ball: { pos: { x: number }; vel: { x: number } }): boolean {
    return this.side === Side.Left ? ball.vel.x < -0.5 : ball.vel.x > 0.5;
  }

  /** Analytic ball prediction (gravity only). Returns x when it reaches y=targetY descending. */
  private predictBall(
    x: number,
    y: number,
    vx: number,
    vy: number,
    targetY: number,
    maxT: number,
  ): { x: number; t: number } {
    // Solve y + vy*t + 0.5*g*t^2 = targetY for the later (descending) root.
    const g = BALL_GRAVITY;
    const a = 0.5 * g;
    const b = vy;
    const c = y - targetY;
    const disc = b * b - 4 * a * c;
    let t: number;
    if (disc <= 0) {
      t = maxT;
    } else {
      const sq = Math.sqrt(disc);
      const t1 = (-b + sq) / (2 * a);
      const t2 = (-b - sq) / (2 * a);
      // Pick the largest positive root (descending crossing).
      t = Math.max(t1, t2);
      if (t < 0) t = Math.min(t1, t2);
      if (t < 0) t = maxT;
    }
    t = Math.min(t, maxT);

    let px = x + vx * t;
    // Reflect prediction off the side walls so it stays in bounds.
    const span = COURT_HALF_WIDTH - BALL_RADIUS;
    while (px < -span || px > span) {
      if (px < -span) px = -2 * span - px;
      if (px > span) px = 2 * span - px;
    }
    return { x: px, t };
  }
}
