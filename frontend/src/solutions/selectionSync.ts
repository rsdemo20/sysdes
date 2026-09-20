/**
 * Watches the account's shared canvas selection.
 *
 * One account has one current canvas across every tab and device. This poll is
 * metadata only: it is not collaborative editing, not autosave and not analytics,
 * and it deliberately runs on its own schedule rather than the save timer.
 *
 * Reading only happens while the tab is visible, because a hidden tab that keeps
 * polling costs battery and learns nothing anyone is looking at. Becoming visible
 * again, regaining focus and coming back online each trigger one immediate read
 * so a tab catches up the moment it can matter.
 */
export interface Selection {
  currentSolutionId: string | null;
  selectionRevision: number;
}

export interface SelectionSyncOptions {
  read: () => Promise<Selection>;
  /** Called only when the shared selection actually moved. */
  onChanged: (selection: Selection) => void;
  onError?: (error: unknown) => void;
  intervalMs?: number;
  /** Injected so tests do not depend on a real document or window. */
  isVisible?: () => boolean;
  addListener?: (type: string, listener: () => void) => void;
  removeListener?: (type: string, listener: () => void) => void;
}

const INTERVAL = 5_000;

export class SelectionSync {
  private timer: ReturnType<typeof setInterval> | undefined;
  private known: Selection | null = null;
  private reading = false;
  private stopped = true;
  private readonly intervalMs: number;
  private readonly isVisible: () => boolean;
  private readonly wake = () => {
    if (!this.stopped && this.isVisible()) void this.read();
  };

  constructor(private readonly options: SelectionSyncOptions) {
    this.intervalMs = options.intervalMs ?? INTERVAL;
    this.isVisible =
      options.isVisible ?? (() => document.visibilityState === "visible");
  }

  /** Seed the last known selection so the first poll does not look like a change. */
  prime(selection: Selection): void {
    this.known = selection;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      if (this.isVisible()) void this.read();
    }, this.intervalMs);
    const add =
      this.options.addListener ??
      ((type, listener) => window.addEventListener(type, listener));
    for (const event of ["visibilitychange", "focus", "online"])
      add(event, this.wake);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    const remove =
      this.options.removeListener ??
      ((type, listener) => window.removeEventListener(type, listener));
    for (const event of ["visibilitychange", "focus", "online"])
      remove(event, this.wake);
  }

  /** One read. Overlapping reads are skipped rather than queued. */
  async read(): Promise<void> {
    if (this.reading || this.stopped) return;
    this.reading = true;
    try {
      const selection = await this.options.read();
      if (this.stopped) return;
      const changed =
        this.known === null ||
        selection.selectionRevision !== this.known.selectionRevision ||
        selection.currentSolutionId !== this.known.currentSolutionId;
      const first = this.known === null;
      this.known = selection;
      if (changed && !first) this.options.onChanged(selection);
    } catch (error) {
      // A failed read is not a change; the next tick simply tries again.
      this.options.onError?.(error);
    } finally {
      this.reading = false;
    }
  }
}
