import { PlayerInput } from './constants';

/**
 * Keyboard + touch input. Two key sets are supported so a local hot-seat mode
 * is possible, but by default player one uses both WASD and the arrow keys.
 */
export class InputManager {
  private down = new Set<string>();
  private touch: PlayerInput = { left: false, right: false, jump: false };
  private enabled = true;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    // Avoid scrolling the page with arrows / space.
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space', ' '].includes(e.key) || e.code === 'Space') {
      e.preventDefault();
    }
    this.down.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private clear = (): void => {
    this.down.clear();
    this.touch = { left: false, right: false, jump: false };
  };

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) this.clear();
  }

  /** Primary player input (WASD + arrows + touch). */
  getPlayerInput(): PlayerInput {
    return {
      left: this.down.has('KeyA') || this.down.has('ArrowLeft') || this.touch.left,
      right: this.down.has('KeyD') || this.down.has('ArrowRight') || this.touch.right,
      jump:
        this.down.has('KeyW') ||
        this.down.has('ArrowUp') ||
        this.down.has('Space') ||
        this.touch.jump,
    };
  }

  setTouch(input: Partial<PlayerInput>): void {
    this.touch = { ...this.touch, ...input };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
  }
}
