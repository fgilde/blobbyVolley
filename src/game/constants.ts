// ---------------------------------------------------------------------------
// World constants. All values are in abstract "world units" with y=0 = ground.
// The simulation is fully 2D (x = horizontal, y = vertical). The 3D renderer
// maps these onto a slightly perspective court for a modern look.
// ---------------------------------------------------------------------------

/** Court half-width. Playable x range is [-COURT_HALF_WIDTH, COURT_HALF_WIDTH]. */
export const COURT_HALF_WIDTH = 8;
export const COURT_WIDTH = COURT_HALF_WIDTH * 2;

/** Ceiling — ball bounces off the top of the arena. */
export const CEILING_Y = 12;

/** Net sits at x = 0. */
export const NET_HALF_WIDTH = 0.18;
export const NET_HEIGHT = 3.6;

/** Ball. */
export const BALL_RADIUS = 0.62;
export const BALL_GRAVITY = -16.5;
/** Max horizontal/vertical speed a ball can travel (anti-tunneling sanity). */
export const BALL_MAX_SPEED = 26;

/** Blob (the player avatar). Collision shape = circle of BLOB_RADIUS. */
export const BLOB_RADIUS = 1.35;
export const BLOB_GRAVITY = -34;
export const BLOB_MOVE_SPEED = 8.2;
export const BLOB_JUMP_SPEED = 14.5;

/** How much of the blob's velocity is transferred to the ball on contact. */
export const BLOB_VELOCITY_TRANSFER = 0.45;
/** Extra "punch" added along the contact normal so hits feel lively. */
export const HIT_IMPULSE = 2.2;

/** Fixed-timestep simulation rate. */
export const TICK_RATE = 120;
export const FIXED_DT = 1 / TICK_RATE;

/** Score needed to win a match. */
export const WINNING_SCORE = 15;

/** Starting x positions for the two blobs (left = player, right = opponent). */
export const LEFT_START_X = -COURT_HALF_WIDTH * 0.5;
export const RIGHT_START_X = COURT_HALF_WIDTH * 0.5;

export enum Side {
  Left = 0,
  Right = 1,
}

export interface PlayerInput {
  left: boolean;
  right: boolean;
  jump: boolean;
}

export const EMPTY_INPUT: PlayerInput = { left: false, right: false, jump: false };
