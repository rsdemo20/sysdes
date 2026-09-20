/**
 * The state the save indicator renders from.
 *
 * This is deliberately a small value object with its own subscription: the corner
 * status changes far more often than the graph, and re-rendering the canvas to
 * show "Saving..." would defeat the input isolation the editor is built around.
 */
export type SaveStatus =
  /** No local changes and nothing in flight. */
  | "saved"
  /** Local changes that no confirmed snapshot covers yet. */
  | "dirty"
  /** A write is in flight. */
  | "saving"
  /** The write succeeded, but edits made after its snapshot are still unsaved. */
  | "saved_with_new_changes"
  /** Transient failure; a retry is allowed. */
  | "error"
  /** The response was lost. Nothing new is sent until a read settles it. */
  | "unknown"
  /** Blocked until the user signs in again. */
  | "auth_required"
  /** Blocked until the version conflict is resolved. */
  | "conflict"
  /** Blocked until the document validates. */
  | "invalid";

export interface SaveState {
  status: SaveStatus;
  isDirty: boolean;
  /** True only while a manual command is outstanding, so its spinner is separate. */
  manualPending: boolean;
  /** Local time of the last confirmed write; never the server's updatedAt. */
  lastConfirmedAt: number | null;
  lastError: string | null;
}

export const initialSaveState: SaveState = {
  status: "saved",
  isDirty: false,
  manualPending: false,
  lastConfirmedAt: null,
  lastError: null,
};

/** Statuses that stop automatic writes until the user resolves something. */
export const BLOCKED_STATUSES: readonly SaveStatus[] = [
  "auth_required",
  "conflict",
  "invalid",
  "unknown",
];

export function isBlocked(status: SaveStatus): boolean {
  return BLOCKED_STATUSES.includes(status);
}
