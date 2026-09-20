/**
 * Undo/redo as a bounded ring of immutable document snapshots.
 *
 * Documents are immutable and commands share every untouched subtree, so a
 * snapshot costs only the path that actually changed rather than a copy of the
 * whole canvas. That makes whole-document history cheaper to keep correct than
 * a set of inverse commands: a cascading delete is undone in one step, with the
 * references it removed restored exactly, and no inverse operation can drift
 * out of sync with the command it is supposed to reverse.
 *
 * The bound exists so that a long editing session cannot grow without limit;
 * reaching it drops the oldest step and never blocks a new edit.
 */
import type { CanvasDocument } from "./types";

const DEFAULT_LIMIT = 50;

export class History {
  private entries: CanvasDocument[];
  private index = 0;

  constructor(
    initial: CanvasDocument,
    private readonly limit: number = DEFAULT_LIMIT,
  ) {
    if (limit < 1) throw new Error("History limit must be at least 1");
    this.entries = [initial];
  }

  get current(): CanvasDocument {
    return this.entries[this.index];
  }

  /** Number of retained snapshots, including the current one. */
  get size(): number {
    return this.entries.length;
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.entries.length - 1;
  }

  /** Record a new state. Anything that was undone is discarded, as usual for redo. */
  commit(document: CanvasDocument): void {
    if (document === this.current) return;
    this.entries = [...this.entries.slice(0, this.index + 1), document];
    if (this.entries.length > this.limit + 1)
      this.entries = this.entries.slice(this.entries.length - (this.limit + 1));
    this.index = this.entries.length - 1;
  }

  undo(): CanvasDocument {
    if (this.canUndo) this.index--;
    return this.current;
  }

  redo(): CanvasDocument {
    if (this.canRedo) this.index++;
    return this.current;
  }

  /** Replace history, for example after loading another canvas. */
  reset(document: CanvasDocument): void {
    this.entries = [document];
    this.index = 0;
  }
}
