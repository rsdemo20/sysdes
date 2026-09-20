import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createMixedDocument,
  createStandardDocument,
  createTaskOnlyDocument,
} from "./model/fixtures";
import type {
  CanvasDocument,
  Diagram,
  Entity,
  HldNode,
  Participant,
} from "./model/types";
import { EditorStore } from "./editor/EditorStore";
import { PrototypeCanvas } from "./editor/PrototypeCanvas";
import { TextField } from "./editor/TextField";
import { exportCanvas } from "./solutions/export";
import type { EditorCommand } from "./model/commands";
import { SaveCoordinator } from "./solutions/SaveCoordinator";
import { SaveIndicator } from "./solutions/SaveIndicator";
import { SolutionList } from "./solutions/SolutionList";
import { describeObject, statusLine } from "./editor/hoverStatus";
import { BRANCHES, presetById, presetsOf } from "./editor/palette";
import { placeAnnotation } from "./editor/annotationPlacement";
import { newFrameRect } from "./editor/framePlacement";
import { nextShortName } from "./editor/shortName";
import { MermaidExport } from "./solutions/MermaidExport";
import { HintButton } from "./solutions/HintButton";
import { DeleteDialog } from "./solutions/DeleteDialog";
import { PublishToCatalog } from "./solutions/PublishToCatalog";
import { EvaluationController } from "./evaluation/EvaluationController";
import { EvaluationActions } from "./evaluation/EvaluationActions";
import { ReportPanel } from "./evaluation/ReportPanel";
import type { Session, SolutionBody, SysdesApi } from "./solutions/api";
import { AccountPanel } from "./settings/AccountPanel";
import { preferences } from "./settings/preferences";
import { usePreferences } from "./settings/usePreferences";

export interface Connection {
  api: SysdesApi;
  session: Session;
  solution: SolutionBody;
  /** Bumped by the owner of the session to refresh the canvas list. */
  refreshToken: number;
  currentSolutionId: string | null;
  /** True while a switch is waiting on the owner; editing keeps working. */
  recoveryPending: boolean;
  onCoordinator: (coordinator: SaveCoordinator | null) => void;
  onOpenSolution: (id: string) => void;
  /**
   * The server changed this canvas -- a hint does that. The owner replaces it
   * and remounts the editor from the new document and revision; `message` says
   * what changed and is handed back as `notice` once the editor is up again.
   */
  onSolutionReplaced: (solution: SolutionBody, message: string) => void;
  notice: string | null;
  onCreateSolution: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

interface DevHook {
  snapshot: () => CanvasDocument;
  flush: () => Promise<void>;
  dispatch: (command: EditorCommand) => void;
  readonly graphCommits: number;
  readonly nodeRenders: Record<string, number>;
  readonly profiler: { commits: number; totalDuration: number };
}
declare global {
  interface Window {
    __sysdes?: DevHook;
  }
}

export default function App({ connection }: { connection?: Connection } = {}) {
  const [store] = useState(
    () =>
      new EditorStore(
        connection
          ? connection.solution.document
          : new URLSearchParams(location.search).get("fixture") === "standard"
            ? createStandardDocument()
            : new URLSearchParams(location.search).get("fixture") === "task"
              ? createTaskOnlyDocument()
              : createMixedDocument(),
      ),
  );
  const document = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // The language is the reader's own setting, kept with the rest of them, so a
  // choice made once survives the reload instead of being made again.
  const locale = usePreferences().locale;
  const setLocale = (value: "ru" | "en") =>
    preferences.update({ locale: value });
  const [account, setAccount] = useState(false);
  const [name, setName] = useState(
    connection ? connection.solution.name : "Оплата заказа",
  );
  const nameRef = useRef(name);
  // What a hint opened is said once and then gets out of the way: the header is
  // the scarcest room on the screen, and the canvas itself now shows the result.
  const [noticeVisible, setNoticeVisible] = useState(Boolean(connection?.notice));
  useEffect(() => {
    if (!connection?.notice) return;
    const timer = setTimeout(() => setNoticeVisible(false), 6000);
    return () => clearTimeout(timer);
  }, [connection?.notice]);
  const [selected, setSelected] = useState<string | null>(null);
  // What the status line reports: the object under the cursor, or a hint from
  // a control the cursor is resting on. The hint wins, because it is the more
  // specific thing to say at that moment.
  const [hovered, setHovered] = useState<string | null>(null);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ru = locale === "ru";
  const setDocumentName = useCallback((value: string) => {
    nameRef.current = value;
    setName(value);
  }, []);
  const nameForSnapshot = useRef(name);
  nameForSnapshot.current = name;
  const [openInstanceId] = useState(() => crypto.randomUUID());
  const [coordinator] = useState(() =>
    connection
      ? new SaveCoordinator({
          solutionId: connection.solution.id,
          openInstanceId,
          baseRevision: connection.solution.revision,
          drafts: store.drafts,
          transport: connection.api,
          snapshot: () => ({
            name: nameForSnapshot.current,
            document: store.getSnapshot(),
          }),
        })
      : null,
  );

  // The locale is read at launch time, so a report is produced in the language
  // the user had chosen when they pressed the command, not when it comes back.
  const localeRef = useRef(locale);
  localeRef.current = locale;

  const [evaluation] = useState(() =>
    connection && coordinator
      ? new EvaluationController({
          solutionId: connection.solution.id,
          transport: connection.api,
          prepare: () => coordinator.prepareEvaluation(),
          reportLocale: () => localeRef.current,
        })
      : null,
  );

  useEffect(() => {
    if (!evaluation) return;
    void evaluation.loadCurrentReport();
    return () => evaluation.dispose();
  }, [evaluation]);

  const reportCoordinator = connection?.onCoordinator;
  useEffect(() => {
    reportCoordinator?.(coordinator);
    return () => reportCoordinator?.(null);
  }, [coordinator, reportCoordinator]);

  // Every document change counts as one edit for the dirty generation.
  useEffect(() => {
    if (!coordinator) return;
    store.onEdit = () => coordinator.markEdited();
    return () => {
      store.onEdit = undefined;
    };
  }, [coordinator, store]);

  // One interval for the whole open document; the tick decides whether to write.
  useEffect(() => {
    if (!coordinator) return;
    const timer = setInterval(() => void coordinator.tick(), 60_000);
    const check = () => {
      if (window.document.visibilityState === "visible")
        void coordinator.tick();
    };
    window.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
      // Stop accepting outcomes for this opening of the document.
      coordinator.dispose(openInstanceId);
    };
  }, [coordinator, openInstanceId]);

  // Ctrl+S and Cmd+S are intercepted even inside a text field, as the save
  // contract requires; the browser's own page save must not win here.
  useEffect(() => {
    if (!coordinator) return;
    const onSave = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s")
        return;
      event.preventDefault();
      void coordinator.manualSave();
    };
    // Capture phase on purpose: a focused text field stops propagation so canvas
    // shortcuts do not fire, and the save contract still requires Ctrl+S to be
    // intercepted while the caret is in a field.
    window.addEventListener("keydown", onSave, true);
    return () => window.removeEventListener("keydown", onSave, true);
  }, [coordinator]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z")
        return;
      // Input Isolation: inside a field the browser's own undo must keep working.
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA"
      )
        return;
      event.preventDefault();
      if (event.shiftKey) store.redo();
      else store.undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__sysdes = {
      snapshot: () => structuredClone(store.getSnapshot()),
      flush: store.flush,
      dispatch: store.dispatch,
      get graphCommits() {
        return store.graphCommits;
      },
      get nodeRenders() {
        return { ...store.nodeRenders };
      },
      get profiler() {
        return { ...store.profiler };
      },
    };
    return () => {
      delete window.__sysdes;
    };
  }, [store]);
  const download = async (format: "json" | "png" | "svg") => {
    setExporting(true);
    setError(null);
    try {
      await store.flush();
      await exportCanvas(
        structuredClone(store.getSnapshot()),
        nameRef.current,
        format,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : ru
            ? "Экспорт не выполнен."
            : "Export failed.",
      );
    } finally {
      setExporting(false);
    }
  };
  const add = async (kind: "annotation" | "note") => {
    await store.flush();
    const doc = store.getSnapshot();
    if (kind === "note") {
      const id = `note-${crypto.randomUUID()}`;
      store.replace({
        ...doc,
        semantic: {
          ...doc.semantic,
          notes: [
            ...doc.semantic.notes,
            {
              id,
              text: ru ? "Опишите решение…" : "Describe your solution…",
              diagramIds: [],
            },
          ],
        },
        layout: {
          ...doc.layout,
          objectPositions: {
            ...doc.layout.objectPositions,
            [id]: {
              x: 40 + doc.semantic.notes.length * 80,
              y: 780,
              width: 340,
              height: 140,
            },
          },
        },
      });
      return;
    }
    if (kind === "annotation") {
      // Kept for the sidebar button; the card's own T uses the store directly.
      const ownerObjectId =
        selected &&
        doc.layout.objectPositions[selected] &&
        !doc.semantic.notes.some((note) => note.id === selected)
          ? selected
          : "hld-orders";
      if (
        doc.semantic.annotations.filter(
          (a) => a.ownerObjectId === ownerObjectId,
        ).length >= 3
      ) {
        setError(
          ru
            ? "У блока может быть не более трёх подписей."
            : "A block supports three external annotations.",
        );
        return;
      }
      const id = `annotation-${crypto.randomUUID()}`;
      store.replace({
        ...doc,
        semantic: {
          ...doc.semantic,
          annotations: [
            ...doc.semantic.annotations,
            {
              id,
              ownerObjectId,
              text: ru
                ? "Опишите решение или открытый вопрос…"
                : "Describe a decision or an open question…",
            },
          ],
        },
        layout: {
          ...doc.layout,
          annotationOffsets: {
            ...doc.layout.annotationOffsets,
            // Beside its block and on free space: an annotation dropped over
            // the block hides the thing it describes.
            [id]: placeAnnotation(doc, ownerObjectId, {
              width: 280,
              height: 95,
            }),
          },
        },
      });
      return;
    }
  };

  /** The canvas area an author can actually see, in flow units. */
  const visibleCanvas = (doc: CanvasDocument) => {
    const shell = window.document.querySelector(".canvas-shell");
    const zoom = doc.layout.viewport.zoom || 1;
    const rect = shell?.getBoundingClientRect();
    return rect && rect.width > 0
      ? { width: rect.width / zoom, height: rect.height / zoom }
      : { width: 1200, height: 800 };
  };

  const addBlock = async (presetId: string) => {
    const preset = presetById(presetId);
    const kind = preset.branch;
    await store.flush();
    const doc = store.getSnapshot();
    // A Custom canvas starts with no diagrams at all, so the first block of a
    // kind creates the diagram that will hold it.
    const existing = doc.semantic.diagrams.find((item) => item.type === kind);
    const created = existing
      ? null
      : ({
          id: `diagram-${kind}-${crypto.randomUUID()}`,
          type: kind,
          title:
            kind === "hld"
              ? ru
                ? "Компоненты"
                : "Components"
              : kind === "er"
                ? ru
                  ? "Данные"
                  : "Data"
                : ru
                  ? "Сценарий"
                  : "Scenario",
          originTemplateObjectId: null,
          ...(kind === "hld"
            ? { nodes: [], edges: [] }
            : kind === "er"
              ? { entities: [], relationships: [] }
              : { participants: [], messages: [] }),
        } as Diagram);
    const diagram = existing ?? created!;
    const placed = doc.layout.diagramFrames[diagram.id];
    // A new diagram arrives big and clear of the others: a frame that opens on
    // top of an existing one reads as one confused region.
    const frame = placed ?? newFrameRect(doc, visibleCanvas(doc));
    const count =
      diagram.type === "hld"
        ? diagram.nodes.length
        : diagram.type === "er"
          ? diagram.entities.length
          : diagram.participants.length;
    const id = `${kind}-${crypto.randomUUID()}`;
    const block = {
      ...preset.create(id, ru),
      shortName: nextShortName(existing ?? undefined, preset.prefix),
    };
    let updated: Diagram;
    if (diagram.type === "hld")
      updated = { ...diagram, nodes: [...diagram.nodes, block as HldNode] };
    else if (diagram.type === "er")
      updated = {
        ...diagram,
        entities: [...diagram.entities, block as Entity],
      };
    else
      updated = {
        ...diagram,
        participants: [...diagram.participants, block as Participant],
      };
    const x =
      kind === "sequence"
        ? frame.x + 45 + count * 270
        : frame.x + 50 + (count % 3) * 255;
    const y =
      kind === "sequence"
        ? frame.y + 90
        : frame.y + 110 + Math.floor(count / 3) * 180;
    const { width, height } = preset.size;
    store.replace({
      ...doc,
      semantic: {
        ...doc.semantic,
        diagrams: existing
          ? doc.semantic.diagrams.map((item) =>
              item.id === diagram.id ? updated : item,
            )
          : [...doc.semantic.diagrams, updated],
      },
      layout: {
        ...doc.layout,
        objectPositions: {
          ...doc.layout.objectPositions,
          [id]: { x, y, width, height },
        },
        diagramFrames: {
          ...doc.layout.diagramFrames,
          [diagram.id]: {
            ...frame,
            width: Math.max(frame.width, x + width - frame.x + 45),
            height: Math.max(frame.height, y + height - frame.y + 45),
          },
        },
      },
    });
    setSelected(id);
  };
  const sequence = document.semantic.diagrams.find(
    (d) => d.type === "sequence",
  );
  const totalBlocks = document.semantic.diagrams.reduce(
    (count, diagram) =>
      count +
      (diagram.type === "hld"
        ? diagram.nodes.length
        : diagram.type === "er"
          ? diagram.entities.length
          : diagram.participants.length),
    0,
  );
  // One line, three sources, in order of how specific they are: a hint from the
  // control under the cursor, then the object under the cursor, then the
  // standing reminder that has nowhere better to live now that the bottom bar
  // is gone.
  const hoveredStatus = hovered
    ? describeObject(document, hovered, locale)
    : null;
  const statusText =
    statusHint ??
    (hoveredStatus ? statusLine(hoveredStatus) : null) ??
    (exporting
      ? ru
        ? "Подготовка экспорта…"
        : "Preparing export…"
      : ru
        ? "Текст фиксируется по Enter или при выходе из поля"
        : "Text commits on Enter or when leaving the field");
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="./" aria-label="sysdes">
          <span className="brand-symbol">s</span>
          <span>
            sysdes<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="top-divider" />
        <div className="document-title">
          <span className="document-icon">▧</span>
          <TextField
            store={store}
            objectId="document-name"
            value={name}
            label={ru ? "Название холста" : "Canvas name"}
            onCommit={setDocumentName}
          />
        </div>
        {connection && coordinator &&
          // Only a canvas started from a template has anything to open.
          connection.solution.document.semantic.templateProvenance && (
            <HintButton
              locale={locale}
              hintsUsed={connection.solution.hintsUsed}
              prepare={() => coordinator.prepareEvaluation()}
              take={(revision) => connection.api.takeHint(connection.solution.id, revision)}
              onTaken={(result, message) =>
                connection.onSolutionReplaced(result.solution, message)
              }
            />
          )}
        {connection?.notice && noticeVisible && (
          <span className="hint-notice" role="status" title={connection.notice}>
            {connection.notice}
          </span>
        )}
        {!connection && (
          <span className="local-badge">
            <span />
            {ru ? "Локальный прототип" : "Local prototype"}
          </span>
        )}
        <div className="top-actions">
          <button
            className="locale-switch"
            onClick={() => setLocale(ru ? "en" : "ru")}
            aria-label={ru ? "Switch to English" : "Переключить на русский"}
          >
            <span>{locale.toUpperCase()}</span>
            <span>⌄</span>
          </button>
          {coordinator && (
            <>
              <SaveIndicator coordinator={coordinator} locale={locale} />
              <button
                className="save-button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void coordinator.manualSave()}
                aria-label={ru ? "Сохранить" : "Save"}
                title={ru ? "Сохранить (Ctrl+S)" : "Save (Ctrl+S)"}
              >
                {ru ? "Сохранить" : "Save"}
              </button>
            </>
          )}
          <div
            className="export-actions"
            aria-label={ru ? "Отменить и вернуть" : "Undo and redo"}
          >
            <button
              disabled={!store.canUndo}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => store.undo()}
              aria-label={ru ? "Отменить" : "Undo"}
              title={ru ? "Отменить (Ctrl+Z)" : "Undo (Ctrl+Z)"}
            >
              <span>↶</span>
            </button>
            <button
              disabled={!store.canRedo}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => store.redo()}
              aria-label={ru ? "Вернуть" : "Redo"}
              title={ru ? "Вернуть (Ctrl+Shift+Z)" : "Redo (Ctrl+Shift+Z)"}
            >
              <span>↷</span>
            </button>
          </div>
          <div
            className="export-actions"
            aria-label={ru ? "Экспорт" : "Export"}
          >
            {(["json", "png", "svg"] as const).map((format) => (
              <button
                key={format}
                disabled={exporting}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void download(format)}
                aria-label={`${ru ? "Экспорт" : "Export"} ${format.toUpperCase()}`}
              >
                <span>↓</span> {format.toUpperCase()}
              </button>
            ))}
            <MermaidExport
              snapshot={() => structuredClone(store.getSnapshot())}
              canvasName={nameRef.current}
              locale={locale}
              disabled={exporting}
              onBeforeExport={() => store.flush()}
              onHint={setStatusHint}
            />
          </div>
          {connection && (
            <div className="account-control">
              <span className="account-login">
                {connection.session.user.login}
              </span>
              <button
                type="button"
                className="account-button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setAccount(true)}
                aria-label={ru ? "Личный кабинет" : "Account"}
                title={ru ? "Личный кабинет" : "Account"}
              >
                <span aria-hidden="true">☰</span>
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-intro">
            <span className="eyebrow">WORKSPACE / 01</span>
            <h1>{ru ? "Проектирование" : "System design"}</h1>
            <p>
              {ru
                ? "От устройства системы до деталей взаимодействия."
                : "From the system structure to the details of each interaction."}
            </p>
          </div>
          {connection && (
            <SolutionList
              api={connection.api}
              locale={locale}
              currentSolutionId={connection.currentSolutionId}
              refreshToken={connection.refreshToken}
              onOpen={connection.onOpenSolution}
              onCreate={connection.onCreateSolution}
            />
          )}
          {evaluation && (
            <div className="sidebar-section">
              <EvaluationActions
                controller={evaluation}
                locale={locale}
                disabled={connection?.recoveryPending ?? false}
              />
              <ReportPanel controller={evaluation} locale={locale} />
            </div>
          )}
          {connection && coordinator && (
            <div className="sidebar-section canvas-actions">
              <PublishToCatalog
                locale={locale}
                revision={() => coordinator.revision}
                onPublish={async (body) => {
                  await coordinator.manualSave();
                  await connection.api.publishToCatalog(
                    connection.solution.id,
                    {
                      ...body,
                      revision: coordinator.revision,
                    },
                  );
                }}
              />
              <hr className="action-divider" />
              <DeleteDialog
                canvasName={nameRef.current}
                locale={locale}
                onDelete={() =>
                  connection.api.deleteSolution(
                    connection.solution.id,
                    coordinator.revision,
                  )
                }
                onDeleted={connection.onCreateSolution}
              />
            </div>
          )}
          <div className="sidebar-section">
            <div className="section-heading">
              <h2>{ru ? "ДОБАВИТЬ НА ХОЛСТ" : "ADD TO CANVAS"}</h2>
              <span>+</span>
            </div>
            {BRANCHES.map((branch) => (
              <details
                key={branch.id}
                className="palette-branch"
                data-branch={branch.id}
                open={branch.id === "hld"}
              >
                <summary>
                  <span className="palette-branch-name">
                    {branch.names[locale]}
                  </span>
                  <small>{branch.hints[locale]}</small>
                </summary>
                <div className="palette-grid">
                  {presetsOf(branch.id).map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="palette-item"
                      data-preset={preset.id}
                      title={preset.names[locale]}
                      aria-label={`${ru ? "Добавить блок" : "Add block"}: ${preset.names[locale]}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() =>
                        void addBlock(preset.id).catch((e) =>
                          setError(String(e)),
                        )
                      }
                    >
                      <span className="palette-icon">{preset.icon}</span>
                      <span className="palette-name">
                        {preset.names[locale]}
                      </span>
                    </button>
                  ))}
                </div>
              </details>
            ))}
            <button
              className="tool-button"
              onClick={() =>
                void add("annotation").catch((e) => setError(String(e)))
              }
              aria-label={ru ? "Добавить подпись" : "Add annotation"}
            >
              <span className="tool-icon amber">T</span>
              <span>
                <strong>{ru ? "Подпись" : "Annotation"}</strong>
                <small>
                  {ru ? "Текст рядом с блоком" : "Text next to a block"}
                </small>
              </span>
              <span className="tool-plus">+</span>
            </button>
          </div>
          <div className="sidebar-section">
            <div className="section-heading">
              <h2>{ru ? "СЦЕНАРИЙ" : "SEQUENCE"}</h2>
              <span>⇄</span>
            </div>
            <p className="section-help">
              {ru
                ? "Порядок сообщений не зависит от расположения участников."
                : "Message order is independent of participant positions."}
            </p>
            <div className="message-add">
              {(["sync", "async", "return"] as const).map((kind) => (
                <button
                  key={kind}
                  onClick={() => store.addMessage(kind)}
                  aria-label={`${ru ? "Добавить сообщение" : "Add message"} ${kind}`}
                >
                  + {kind}
                </button>
              ))}
            </div>
            <div className="message-list">
              {sequence?.type === "sequence" &&
                [...sequence.messages]
                  .sort((a, b) => a.order - b.order)
                  .map((message, index, messages) => (
                    <div className="message-item" key={message.id}>
                      <span>{message.order.toString().padStart(2, "0")}</span>
                      <span title={message.label}>{message.label}</span>
                      <button
                        aria-label={`${ru ? "Поднять" : "Move up"} ${message.label}`}
                        disabled={index === 0}
                        onClick={() => store.reorderMessage(message.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        aria-label={`${ru ? "Опустить" : "Move down"} ${message.label}`}
                        disabled={index === messages.length - 1}
                        onClick={() => store.reorderMessage(message.id, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  ))}
            </div>
          </div>
          <div className="sidebar-section notes-section">
            <div className="section-heading">
              <h2>{ru ? "ЗАМЕТКИ К РЕШЕНИЮ" : "DESIGN NOTES"}</h2>
              <span>✎</span>
            </div>
            {document.semantic.notes.map((note, index) => (
              <div className="note-editor" key={note.id}>
                <span className="note-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <p className="note-summary">{note.text}</p>
              </div>
            ))}
          </div>
          <button
            className="tool-button"
            onClick={() => void add("note").catch((e) => setError(String(e)))}
            aria-label={ru ? "Добавить текст" : "Add text"}
          >
            ＋ {ru ? "Свободный текст" : "Free text"}
          </button>
          <div className="prototype-notice">
            <span>◌</span>
            <p>
              {ru
                ? "Работа в памяти вкладки. Скачайте JSON, чтобы сохранить результат."
                : "This tab keeps your work in memory. Download JSON to keep a copy."}
            </p>
          </div>
        </aside>
        <main className="editor-main">
          <div className="canvas-toolbar">
            <div className="canvas-title">
              <span className="active-tab">
                {ru ? "Смешанный холст" : "Mixed canvas"}
              </span>
              <span className="view-badge">HLD + ER + Sequence</span>
            </div>
            {/*
              Not a live region. Its content follows the mouse, and announcing
              every hover would leave a screen reader chattering; the save
              indicator stays the one status region on this screen. What this
              line says about a control is already in that control's own name.
            */}
            <p className="canvas-status">{statusText}</p>
            <span className="object-count">
              {totalBlocks} {ru ? "блоков" : "blocks"}
              <span>·</span>
              {document.semantic.annotations.length}{" "}
              {ru ? "подписей" : "annotations"}
            </span>
          </div>
          {error && (
            <div role="alert" className="error-banner">
              {error}
              <button onClick={() => setError(null)}>×</button>
            </div>
          )}
          <PrototypeCanvas
            store={store}
            locale={locale}
            onSelect={setSelected}
            onHover={setHovered}
          />
        </main>
      </div>
      {connection && account && (
        <AccountPanel
          api={connection.api}
          login={connection.session.user.login}
          onClose={() => setAccount(false)}
          onSignOut={async () => {
            setAccount(false);
            await connection.onSignOut();
          }}
        />
      )}
    </div>
  );
}
