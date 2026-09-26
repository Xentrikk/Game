import type { Dir } from "@hearth/shared";

/**
 * Input shared by the keyboard (in the Phaser scene) and the on-screen touch controls (React).
 * The most recently pressed direction that is still held wins, like on a Game Boy D-pad.
 */
export class InputState {
  private held: Dir[] = [];
  private since = new Map<Dir, number>();
  private aPresses = 0;
  /** Run toggle (B button / X key). Holding Shift also runs. */
  runToggle = false;
  runHeld = false;

  press(dir: Dir, now = performance.now()) {
    if (this.held.includes(dir)) return;
    this.held.push(dir);
    this.since.set(dir, now);
  }

  release(dir: Dir) {
    this.held = this.held.filter((d) => d !== dir);
    this.since.delete(dir);
  }

  releaseAll() {
    this.held = [];
    this.since.clear();
    this.runHeld = false;
  }

  current(): Dir | undefined {
    return this.held[this.held.length - 1];
  }

  heldFor(dir: Dir, now = performance.now()): number {
    const t = this.since.get(dir);
    return t === undefined ? 0 : now - t;
  }

  get running(): boolean {
    return this.runToggle !== this.runHeld;
  }

  pressA() {
    this.aPresses++;
  }

  /** True once per A press. */
  consumeA(): boolean {
    if (!this.aPresses) return false;
    this.aPresses--;
    return true;
  }
}
