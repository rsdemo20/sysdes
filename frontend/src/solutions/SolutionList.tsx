/**
 * The account's canvases, with the used/limit counter the quota contract asks the
 * UI to show. Switching goes through the caller so unsaved work is resolved first;
 * this component never changes the shared selection by itself.
 */
import { useEffect, useState } from "react";
import type { SolutionSummary, SysdesApi } from "./api";

interface Props {
  api: SysdesApi;
  locale: "ru" | "en";
  currentSolutionId: string | null;
  /** Bumped by the caller to force a refresh after a create or a switch. */
  refreshToken: number;
  onOpen: (id: string) => void;
  onCreate: () => Promise<void>;
}

export function SolutionList({
  api,
  locale,
  currentSolutionId,
  refreshToken,
  onOpen,
  onCreate,
}: Props) {
  const ru = locale === "ru";
  const [items, setItems] = useState<SolutionSummary[]>([]);
  const [capacity, setCapacity] = useState({ used: 0, limit: 0 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const page = await api.listSolutions();
        if (cancelled) return;
        setItems(page.items);
        setCapacity(page.capacity);
        setError(null);
      } catch {
        if (!cancelled)
          setError(ru ? "Список недоступен." : "The list is unavailable.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, refreshToken, ru]);

  const full = capacity.limit > 0 && capacity.used >= capacity.limit;

  return (
    <div className="solution-list" aria-label={ru ? "Холсты" : "Canvases"}>
      <div className="solution-list-head">
        <span className="eyebrow">{ru ? "Холсты" : "Canvases"}</span>
        <span className="solution-capacity" data-used={capacity.used}>
          {capacity.used} / {capacity.limit}
        </span>
      </div>
      {error && (
        <p className="solution-list-error" role="alert">
          {error}
        </p>
      )}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={item.id === currentSolutionId ? "current" : ""}
              aria-current={item.id === currentSolutionId ? "true" : undefined}
              onClick={() => onOpen(item.id)}
            >
              <strong>{item.name}</strong>
              <small>{item.domainId}</small>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="solution-create"
        disabled={busy || full}
        title={
          full
            ? ru
              ? "Достигнут лимит холстов. Удалите ненужный."
              : "Canvas limit reached. Delete one to free a slot."
            : undefined
        }
        onClick={async () => {
          setBusy(true);
          try {
            await onCreate();
          } finally {
            setBusy(false);
          }
        }}
      >
        {ru ? "Создать холст" : "Create canvas"}
      </button>
    </div>
  );
}
