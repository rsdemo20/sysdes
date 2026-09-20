/**
 * Registry of the text drafts that live inside individual fields.
 *
 * Text input never touches the document on every keystroke. A field keeps its own
 * value and registers here; the registry is what lets a save, an evaluation, an
 * export or a canvas switch take a snapshot that includes text the user has typed
 * but not yet committed, without stealing focus from the field being edited.
 */
export interface TextPatch {
  objectId: string;
  field: string;
  value: string;
}

export interface DraftEntry {
  /** Current value as a patch, or null when it matches what the document already has. */
  read: () => TextPatch | null;
  /** Resolves once the field is ready to be read, e.g. after an IME composition ends. */
  wait: () => Promise<void>;
  /** Called after the value has been taken into the document. */
  acknowledge: () => void;
  isComposing: () => boolean;
  /** Fields that own their own commit path, such as the canvas name. */
  apply?: (patch: TextPatch) => void;
}

export class DraftRegistry {
  private entries = new Map<string, DraftEntry>();
  private pending: Promise<void> | undefined;

  constructor(private readonly commit: (patches: TextPatch[]) => void) {}

  register = (key: string, entry: DraftEntry): (() => void) => {
    this.entries.set(key, entry);
    return () => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    };
  };

  /**
   * Commit every pending draft as one document change. Concurrent callers share a
   * single flush so a manual save during an autosave cannot commit twice.
   */
  flushPendingInputs = (): Promise<void> => {
    if (this.pending) return this.pending;
    this.pending = (async () => {
      // A composition may start while another field is still waiting; recheck all.
      do {
        await Promise.all(
          [...this.entries.values()].map((entry) => entry.wait()),
        );
      } while ([...this.entries.values()].some((entry) => entry.isComposing()));
      const entries = [...this.entries.values()];
      const reads = entries.map((entry) => ({ entry, patch: entry.read() }));
      this.commit(
        reads
          .filter((row) => !row.entry.apply)
          .map((row) => row.patch)
          .filter((patch): patch is TextPatch => patch !== null),
      );
      reads.forEach(({ entry, patch }) => {
        if (patch) entry.apply?.(patch);
      });
      entries.forEach((entry) => entry.acknowledge());
    })().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  };
}
