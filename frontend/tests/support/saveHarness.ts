/**
 * Test harness for the save coordinator: a fake clock, a deferred PUT and a
 * readable state, so save behaviour is exercised without a network or a browser.
 */
import { DraftRegistry } from "../../src/editor/drafts";
import {
  SaveCoordinator,
  SaveHttpError,
  UnknownOutcomeError,
  type SaveResult,
  type Snapshot,
} from "../../src/solutions/SaveCoordinator";
import type { SaveState } from "../../src/solutions/saveState";
import type { CanvasDocument } from "../../src/model/types";

interface Deferred {
  snapshot: Snapshot;
  baseRevision: number;
  resolve: (result: SaveResult) => void;
  reject: (error: unknown) => void;
}

export function createSaveHarness(options: { baseRevision?: number } = {}) {
  let clock = 1_000;
  let text = "v0";
  let name = "solution-260906-001";
  let revisionOnServer = options.baseRevision ?? 1;
  let stored: Snapshot | null = null;

  const puts: Deferred[] = [];
  const gets: Array<() => void> = [];
  let states: SaveState[] = [];

  /** The document is minimal on purpose: this suite is about save, not the model. */
  const document = () =>
    ({
      schemaVersion: 1,
      semantic: {
        domainId: "ecommerce",
        templateProvenance: null,
        rubricVersion: "custom:1",
        context: {
          requirements: [],
          acceptanceCriteria: [],
          technicalParameters: [],
          assumptions: [],
          constraints: [],
        },
        diagrams: [],
        annotations: [],
        notes: [
          { id: "note-1", text, diagramIds: [], originTemplateObjectId: null },
        ],
      },
      layout: {
        objectPositions: {},
        annotationOffsets: {},
        diagramFrames: {},
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    }) as unknown as CanvasDocument;

  const drafts = new DraftRegistry(() => {});

  const coordinator = new SaveCoordinator({
    solutionId: "solution-1",
    openInstanceId: "open-1",
    baseRevision: revisionOnServer,
    drafts,
    snapshot: () => ({ name, document: document() }),
    now: () => clock,
    onState: (state) => states.push(state),
    transport: {
      put: (_id, baseRevision, snapshot) =>
        new Promise<SaveResult>((resolve, reject) => {
          puts.push({
            snapshot,
            baseRevision,
            resolve: (result) => {
              stored = snapshot;
              revisionOnServer = result.revision;
              resolve(result);
            },
            reject,
          });
        }),
      get: () =>
        new Promise((resolve) => {
          gets.push(() =>
            resolve({
              revision: revisionOnServer,
              name: stored?.name ?? "solution-260906-001",
              document: (stored?.document ?? document()) as CanvasDocument,
            }),
          );
        }),
    },
  });

  return {
    coordinator,
    drafts,
    state: () => coordinator.getState(),
    /** Every state the indicator was notified about, for ordering assertions. */
    seenStates: () => states,
    clearStates: () => {
      states = [];
    },
    documentText: () => text,
    editText(value: string) {
      text = value;
      coordinator.markEdited();
    },
    rename(value: string) {
      name = value;
      coordinator.markEdited();
    },
    advance(ms: number) {
      clock += ms;
      return clock;
    },
    now: () => clock,
    pendingPuts: () => puts.length,
    lastPut: () => puts[puts.length - 1],
    /** Confirm the oldest outstanding PUT. */
    resolvePut(result: SaveResult) {
      const deferred = puts.shift();
      if (!deferred) throw new Error("No PUT in flight");
      deferred.resolve(result);
    },
    failPut(status: number) {
      const deferred = puts.shift();
      if (!deferred) throw new Error("No PUT in flight");
      deferred.reject(new SaveHttpError(status));
    },
    loseResponse() {
      const deferred = puts.shift();
      if (!deferred) throw new Error("No PUT in flight");
      deferred.reject(new UnknownOutcomeError("lost"));
    },
    /** The server stored the snapshot, but the client never saw the response. */
    storeThenLoseResponse(revision: number) {
      const deferred = puts.shift();
      if (!deferred) throw new Error("No PUT in flight");
      stored = deferred.snapshot;
      revisionOnServer = revision;
      deferred.reject(new UnknownOutcomeError("lost"));
    },
    /** Answer the read that settles an unknown outcome. */
    settleGet() {
      const pending = gets.shift();
      if (!pending) throw new Error("No GET in flight");
      pending();
    },
    /** Pretend another writer advanced the canvas. */
    serverMovedOn(revision: number) {
      revisionOnServer = revision;
      stored = { name: "renamed elsewhere", document: document() };
    },
  };
}
