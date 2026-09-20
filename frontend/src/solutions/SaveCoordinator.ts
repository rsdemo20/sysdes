/**
 * One writer for one open canvas.
 *
 * Manual saves and the minute timer are separate intents with separate feedback,
 * but they share this coordinator so that at most one PUT is ever in flight. The
 * editor is never blocked by a request: edits during a write change the model and
 * the local generation, while the body already sent stays as it was.
 *
 * Dirty state is a pair of counters rather than a document hash. Every edit bumps
 * `currentGeneration`; a confirmed write sets `savedGeneration` to the generation
 * its snapshot captured. So acknowledging generation N never clears edits made at
 * N+1, which is the case the whole design exists for.
 */
import { DraftRegistry } from "../editor/drafts";
import {
  initialSaveState,
  isBlocked,
  type SaveState,
  type SaveStatus,
} from "./saveState";
import type { CanvasDocument } from "../model/types";

export interface Snapshot {
  name: string;
  document: CanvasDocument;
}

export interface SaveResult {
  revision: number;
}

/** Outcome the transport could not determine: a lost response or a timeout. */
export class UnknownOutcomeError extends Error {}
/** Server rejected the write; `status` decides whether writing stays blocked. */
export class SaveHttpError extends Error {
  constructor(
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `Save failed with ${status}`);
  }
}

export interface SolutionsTransport {
  put(
    id: string,
    baseRevision: number,
    snapshot: Snapshot,
  ): Promise<SaveResult>;
  /** Used only to settle an unknown outcome, by comparing the full name and document. */
  get(
    id: string,
  ): Promise<{ revision: number; name: string; document: CanvasDocument }>;
}

export interface CoordinatorOptions {
  solutionId: string;
  /** Identifies this opening of the document; late responses from another are ignored. */
  openInstanceId: string;
  baseRevision: number;
  drafts: DraftRegistry;
  transport: SolutionsTransport;
  snapshot: () => Snapshot;
  now?: () => number;
  onState?: (state: SaveState) => void;
  autoIntervalMs?: number;
}

const MINUTE = 60_000;

export class SaveCoordinator {
  private state: SaveState = { ...initialSaveState };
  private currentGeneration = 0;
  private savedGeneration = 0;
  private baseRevision: number;
  private inFlight: { generation: number; promise: Promise<void> } | null =
    null;
  private manualTarget: number | null = null;
  private lastAutoAttemptAt: number | null = null;
  private openedAt: number;
  private disposed = false;
  private readonly now: () => number;
  private readonly autoIntervalMs: number;

  constructor(private readonly options: CoordinatorOptions) {
    this.now = options.now ?? Date.now;
    this.autoIntervalMs = options.autoIntervalMs ?? MINUTE;
    this.baseRevision = options.baseRevision;
    this.openedAt = this.now();
  }

  private listeners = new Set<() => void>();

  /**
   * The indicator subscribes here rather than through the editor, so a status
   * change repaints the corner without re-rendering the canvas.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): SaveState => this.state;

  get revision(): number {
    return this.baseRevision;
  }

  /**
   * Record that the document changed. Called once per edit, not per keystroke:
   * a field's local draft reports a single change the first time it diverges.
   */
  markEdited(): void {
    this.currentGeneration++;
    this.publish();
  }

  private publish(patch: Partial<SaveState> = {}): void {
    const isDirty = this.currentGeneration > this.savedGeneration;
    const next: SaveState = { ...this.state, ...patch, isDirty };
    if (patch.status === undefined) next.status = this.deriveStatus(next);
    this.state = next;
    this.options.onState?.(next);
    this.listeners.forEach((listener) => listener());
  }

  private deriveStatus(state: SaveState): SaveStatus {
    if (isBlocked(state.status) || state.status === "error")
      return state.status;
    if (this.inFlight) return "saving";
    if (!state.isDirty) return "saved";
    return state.lastConfirmedAt === null ? "dirty" : "saved_with_new_changes";
  }

  private paused = false;

  /**
   * Stop automatic writes without touching dirty state. Used while a remote
   * switch is waiting on the owner: the draft must not keep writing itself to a
   * canvas the account no longer points at. Manual saves still work, because
   * "save and switch" is one of the choices offered.
   */
  setAutomaticPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** Clear a block once the user has dealt with it, so writing may resume. */
  resume(): void {
    this.publish({ status: "saved", lastError: null });
  }

  private async write(generation: number): Promise<void> {
    const snapshot = this.options.snapshot();
    try {
      const result = await this.options.transport.put(
        this.options.solutionId,
        this.baseRevision,
        snapshot,
      );
      this.accept(generation, result.revision);
    } catch (error) {
      if (this.disposed) return;
      if (error instanceof UnknownOutcomeError) {
        this.publish({
          status: "unknown",
          lastError: "The response was lost.",
        });
        await this.settleUnknown(generation, snapshot);
        return;
      }
      if (error instanceof SaveHttpError) {
        const status: SaveStatus =
          error.status === 401
            ? "auth_required"
            : error.status === 412
              ? "conflict"
              : error.status === 422
                ? "invalid"
                : "error";
        this.publish({ status, lastError: error.message });
        return;
      }
      this.publish({ status: "error", lastError: String(error) });
    }
  }

  /**
   * A lost response is settled by reading the canvas and comparing the full name
   * and document, layout included. A semantic hash would not do: it excludes
   * layout and the name, so it cannot tell whether this snapshot was stored.
   */
  private async settleUnknown(
    generation: number,
    snapshot: Snapshot,
  ): Promise<void> {
    try {
      const server = await this.options.transport.get(this.options.solutionId);
      if (this.disposed) return;
      const same =
        server.name === snapshot.name &&
        JSON.stringify(server.document) === JSON.stringify(snapshot.document);
      if (same) {
        this.accept(generation, server.revision);
        return;
      }
      if (server.revision === this.baseRevision) {
        // Nothing was written; a retry through the coordinator is allowed.
        this.publish({
          status: "error",
          lastError: "The save did not reach the server.",
        });
        return;
      }
      this.publish({
        status: "conflict",
        lastError: "The canvas changed elsewhere.",
      });
    } catch {
      // Still unknown; stay blocked rather than risk a second write.
      this.publish({ status: "unknown", lastError: "The response was lost." });
    }
  }

  private accept(generation: number, revision: number): void {
    if (this.disposed) return;
    this.baseRevision = revision;
    // Never move backwards: an older confirmation must not undo a newer one.
    this.savedGeneration = Math.max(this.savedGeneration, generation);
    this.publish({
      status: "saved",
      lastConfirmedAt: this.now(),
      lastError: null,
    });
  }

  private async run(generation: number): Promise<void> {
    const promise = this.write(generation).finally(() => {
      if (this.inFlight?.generation === generation) this.inFlight = null;
    });
    this.inFlight = { generation, promise };
    this.publish({ status: "saving" });
    await promise;
    if (!this.disposed) this.publish();
  }

  /**
   * Manual intent. Resolves once a confirmed write covers the generation that
   * existed when the command was given, even if the user kept editing meanwhile.
   */
  async manualSave(): Promise<void> {
    if (this.disposed) return;
    await this.options.drafts.flushPendingInputs();
    const target = this.currentGeneration;
    this.manualTarget = Math.max(this.manualTarget ?? 0, target);
    this.publish({ manualPending: true });
    try {
      // Nothing to confirm and nothing outstanding: no request at all.
      if (target <= this.savedGeneration && !this.inFlight) return;
      if (this.inFlight) {
        const covers = this.inFlight.generation >= target;
        await this.inFlight.promise;
        if (this.disposed) return;
        if (covers || target <= this.savedGeneration) return;
        // A dependent command must not paper over a conflict with another PUT.
        if (isBlocked(this.state.status)) return;
      }
      if (this.disposed || target <= this.savedGeneration) return;
      if (isBlocked(this.state.status)) return;
      await this.run(this.currentGeneration);
    } finally {
      if (!this.disposed) {
        this.manualTarget = null;
        this.publish({ manualPending: false });
      }
    }
  }

  /**
   * One minute check. The tick itself never clears dirty state and never queues a
   * second write; a skipped tick is simply retried a minute later.
   */
  async tick(now: number = this.now()): Promise<void> {
    if (
      this.disposed ||
      this.paused ||
      this.inFlight ||
      this.manualTarget !== null
    )
      return;
    if (!this.state.isDirty || isBlocked(this.state.status)) return;
    const since = this.state.lastConfirmedAt ?? this.openedAt;
    if (now - since < this.autoIntervalMs) return;
    // Failed attempts are spaced too, so reconnects cannot produce a retry storm.
    if (
      this.lastAutoAttemptAt !== null &&
      now - this.lastAutoAttemptAt < this.autoIntervalMs
    )
      return;
    this.lastAutoAttemptAt = now;
    await this.options.drafts.flushPendingInputs();
    if (this.disposed || !this.state.isDirty) return;
    await this.run(this.currentGeneration);
  }

  /**
   * Snapshot preparation for an evaluation: flush, then make sure the current
   * generation is stored, so the server evaluates the version the user sees.
   */
  async prepareEvaluation(): Promise<{ revision: number; stale: boolean }> {
    await this.manualSave();
    return { revision: this.baseRevision, stale: this.state.isDirty };
  }

  /** Stop accepting outcomes for this opening of the document. */
  dispose(openInstanceId: string): void {
    if (openInstanceId !== this.options.openInstanceId) return;
    this.disposed = true;
  }
}
