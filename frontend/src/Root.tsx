/**
 * Chooses how the editor is opened and owns everything that outlives one canvas:
 * the session, which canvas is open, and the account's shared selection.
 *
 * With a `fixture` parameter the editor runs as the local prototype it has been
 * since stage 1: no account, no server, everything in the tab. Without one it
 * connects: sign in, open the account's current canvas, and follow that selection
 * as it changes on other devices.
 *
 * Switching canvases remounts the editor by keying it on the canvas id, so a new
 * canvas can never inherit the previous document, history or in-flight save.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import App from "./App";
import { SignIn } from "./auth/SignIn";
import { CatalogPicker } from "./solutions/CatalogPicker";
import { RecoveryPanel, type RecoveryChoice } from "./solutions/RecoveryPanel";
import { SelectionSync } from "./solutions/selectionSync";
import { SysdesApi, type Session, type SolutionBody } from "./solutions/api";
import { usePreferences } from "./settings/usePreferences";
import type { SaveCoordinator } from "./solutions/SaveCoordinator";
import { exportCanvas } from "./solutions/export";

type Phase =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "ready"; session: Session; solution: SolutionBody }
  | { kind: "failed"; message: string };

/** A switch waiting on the owner because this tab holds unconfirmed work. */
interface PendingSwitch {
  targetId: string | null;
  /** True when another device moved the selection, rather than this tab asking. */
  remote: boolean;
  collapsed: boolean;
  problem: string | null;
}

/** An empty canvas is Custom by definition; a card brings its own domain. */
const DEFAULT_DOMAIN = "custom";

export function Root() {
  const fixture = new URLSearchParams(location.search).get("fixture");
  if (fixture) return <App />;
  return <ConnectedApp />;
}

function ConnectedApp() {
  const [api] = useState(() => new SysdesApi());
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [pending, setPending] = useState<PendingSwitch | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [picking, setPicking] = useState(false);
  // A canvas changed on the server under the same id -- a hint does that -- has
  // to remount the editor, which is keyed by id; the generation makes it so.
  const [loadGeneration, setLoadGeneration] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // The sign-in form and the catalog speak the language the account panel
  // remembered, the same one the editor uses.
  const locale = usePreferences().locale;

  const coordinatorRef = useRef<SaveCoordinator | null>(null);
  const selectionRef = useRef({
    currentSolutionId: null as string | null,
    revision: 0,
  });

  const openSolution = useCallback(
    async (session: Session, id: string) => {
      const solution = await api.getSolution(id);
      setPending(null);
      setPhase({ kind: "ready", session, solution });
      setRefreshToken((token) => token + 1);
    },
    [api],
  );

  /** Open the canvas the account points at, creating one if there is none. */
  const openWorkspace = useCallback(
    async (session: Session) => {
      try {
        const selection = await api.getCurrentSolution();
        selectionRef.current = {
          currentSolutionId: selection.currentSolutionId,
          revision: selection.selectionRevision,
        };
        if (selection.currentSolutionId) {
          await openSolution(session, selection.currentSolutionId);
          return;
        }
        const listing = await api.listSolutions();
        const solution = listing.items.length
          ? listing.items[0]
          : await api.createSolution(DEFAULT_DOMAIN);
        try {
          const moved = await api.selectSolution(
            solution.id,
            selection.selectionRevision,
          );
          selectionRef.current = {
            currentSolutionId: moved.currentSolutionId,
            revision: moved.selectionRevision,
          };
        } catch {
          // Another device may have selected first; the canvas still opens.
        }
        await openSolution(session, solution.id);
      } catch (error) {
        setPhase({ kind: "failed", message: String(error) });
      }
    },
    [api, openSolution],
  );

  useEffect(() => {
    void (async () => {
      try {
        const session = await api.currentSession();
        if (!session) {
          setPhase({ kind: "signed-out" });
          return;
        }
        await openWorkspace(session);
      } catch (error) {
        setPhase({ kind: "failed", message: String(error) });
      }
    })();
  }, [api, openWorkspace]);

  // Follow the shared selection while this tab is visible.
  useEffect(() => {
    if (phase.kind !== "ready") return;
    const sync = new SelectionSync({
      read: () => api.getCurrentSolution(),
      onChanged: (selection) => {
        selectionRef.current = {
          currentSolutionId: selection.currentSolutionId,
          revision: selection.selectionRevision,
        };
        if (selection.currentSolutionId === phase.solution.id) return;
        const dirty = coordinatorRef.current?.getState().isDirty ?? false;
        if (!dirty) {
          void openSolution(
            phase.session,
            selection.currentSolutionId ?? phase.solution.id,
          );
          return;
        }
        // Another device switching is not consent to lose local edits.
        coordinatorRef.current?.setAutomaticPaused(true);
        setPending({
          targetId: selection.currentSolutionId,
          remote: true,
          collapsed: false,
          problem: null,
        });
      },
    });
    sync.prime({
      currentSolutionId: selectionRef.current.currentSolutionId,
      selectionRevision: selectionRef.current.revision,
    });
    sync.start();
    return () => sync.stop();
  }, [api, phase, openSolution]);

  /** A switch this tab asked for: resolve local work first, then move the selection. */
  const requestSwitch = useCallback(
    (targetId: string) => {
      if (phase.kind !== "ready" || targetId === phase.solution.id) return;
      if (coordinatorRef.current?.getState().isDirty) {
        coordinatorRef.current.setAutomaticPaused(true);
        setPending({
          targetId,
          remote: false,
          collapsed: false,
          problem: null,
        });
        return;
      }
      void (async () => {
        try {
          const moved = await api.selectSolution(
            targetId,
            selectionRef.current.revision,
          );
          selectionRef.current = {
            currentSolutionId: moved.currentSolutionId,
            revision: moved.selectionRevision,
          };
          await openSolution(phase.session, targetId);
        } catch (error) {
          setPending({
            targetId,
            remote: false,
            collapsed: false,
            problem: `${error}`,
          });
        }
      })();
    },
    [api, phase, openSolution],
  );

  const resolvePending = useCallback(
    async (choice: RecoveryChoice) => {
      if (phase.kind !== "ready" || !pending) return;
      if (choice === "postpone") {
        setPending({ ...pending, collapsed: true });
        return;
      }
      if (choice === "save") {
        const coordinator = coordinatorRef.current;
        await coordinator?.manualSave();
        const state = coordinator?.getState();
        if (state && (state.isDirty || state.status === "conflict")) {
          setPending({
            ...pending,
            problem:
              state.status === "conflict"
                ? "Конфликт версий: холст изменён в другом месте."
                : "Появились новые правки. Сохраните ещё раз или отбросьте их.",
          });
          return;
        }
      }
      // Discard applies to unconfirmed edits only; a sent request may be stored.
      const target = pending.targetId;
      coordinatorRef.current?.setAutomaticPaused(false);
      if (!pending.remote && target) {
        try {
          const moved = await api.selectSolution(
            target,
            selectionRef.current.revision,
          );
          selectionRef.current = {
            currentSolutionId: moved.currentSolutionId,
            revision: moved.selectionRevision,
          };
        } catch (error) {
          setPending({ ...pending, problem: `${error}` });
          return;
        }
      }
      // Re-read the shared selection: it may have moved again while deciding.
      const latest = await api.getCurrentSolution().catch(() => null);
      const openId = latest?.currentSolutionId ?? target ?? phase.solution.id;
      if (latest)
        selectionRef.current = {
          currentSolutionId: latest.currentSolutionId,
          revision: latest.selectionRevision,
        };
      await openSolution(phase.session, openId);
    },
    [api, pending, phase, openSolution],
  );

  if (phase.kind === "loading")
    return <div className="boot">Загрузка рабочей области...</div>;

  if (phase.kind === "failed")
    return (
      <div className="boot boot-error" role="alert">
        Не удалось открыть рабочую область. {phase.message}
      </div>
    );

  if (phase.kind === "signed-out")
    return (
      <SignIn
        api={api}
        locale={locale}
        onSignedIn={(session) => {
          setPhase({ kind: "loading" });
          void openWorkspace(session);
        }}
      />
    );

  return (
    <>
      <App
        key={`${phase.solution.id}:${loadGeneration}`}
        connection={{
          api,
          session: phase.session,
          solution: phase.solution,
          refreshToken,
          currentSolutionId: selectionRef.current.currentSolutionId,
          recoveryPending: pending !== null,
          onCoordinator: (coordinator) => {
            coordinatorRef.current = coordinator;
          },
          onOpenSolution: requestSwitch,
          notice,
          onSolutionReplaced: (solution, message) => {
            setPhase({ kind: "ready", session: phase.session, solution });
            setNotice(message);
            setLoadGeneration((generation) => generation + 1);
          },
          // Creating always starts at the catalog: a card, or an empty Custom canvas.
          onCreateSolution: async () => setPicking(true),
          onSignOut: async () => {
            await api.logout().catch(() => undefined);
            setPhase({ kind: "signed-out" });
          },
        }}
      />
      {picking && (
        <CatalogPicker
          api={api}
          locale={locale}
          role={phase.session.user.role}
          onCancel={() => setPicking(false)}
          onChoose={async ({ entry, disclosure }) => {
            const created = await api.createFromCard(
              entry?.domainId ?? DEFAULT_DOMAIN,
              entry
                ? {
                    entryId: entry.entryId,
                    entryVersion: entry.entryVersion,
                    disclosure,
                  }
                : null,
            );
            setPicking(false);
            setRefreshToken((token) => token + 1);
            requestSwitch(created.id);
          }}
        />
      )}
      {pending && !pending.collapsed && (
        <RecoveryPanel
          locale={locale}
          name={phase.solution.name}
          problem={pending.problem}
          onChoice={resolvePending}
          onExport={() =>
            exportCanvas(phase.solution.document, phase.solution.name, "json")
          }
        />
      )}
      {pending?.collapsed && (
        <button
          type="button"
          className="recovery-bar"
          onClick={() => setPending({ ...pending, collapsed: false })}
        >
          Есть неразрешённые изменения. Открыть восстановление
        </button>
      )}
    </>
  );
}
