/**
 * Choosing what to work on: a catalog card, or an empty Custom canvas.
 *
 * The stars a card shows are the server's, recomputed as the reader picks how
 * much to open. Nothing here decides difficulty or reveals content on its own:
 * the hidden part of a reference solution is never sent to the browser.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CatalogPreview, TextList } from "./CatalogPreview";
import type {
  CatalogEntryBody,
  CatalogSummary,
  Domain,
  SysdesApi,
} from "./api";

const LEVEL_LABELS: Record<number, { ru: string; en: string }> = {
  3: {
    ru: "Только описание задания",
    en: "Task description only",
  },
  2: {
    ru: "Плюс состав блоков HLD",
    en: "Plus the HLD block composition",
  },
  1: {
    ru: "Плюс часть схемы HLD",
    en: "Plus part of the HLD schema",
  },
};

interface Props {
  api: SysdesApi;
  locale: "ru" | "en";
  /** An administrator may correct a template from the preview. */
  role: "user" | "admin";
  onCancel: () => void;
  onChoose: (choice: {
    entry: CatalogSummary | null;
    disclosure: number;
  }) => Promise<void>;
}

export function CatalogPicker({
  api,
  locale,
  role,
  onCancel,
  onChoose,
}: Props) {
  const ru = locale === "ru";
  const [items, setItems] = useState<CatalogSummary[]>([]);
  // The server answers one page at a time; the catalog is past one page.
  const [cursor, setCursor] = useState<string | null>(null);
  // A page is already on its way, so scrolling further must not ask again.
  const loadingMore = useRef(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  // Domains come from the server: adding one is a data change, never a code edit.
  const [domains, setDomains] = useState<Domain[]>([]);
  const [domain, setDomain] = useState("");
  const [stars, setStars] = useState("");
  const [origin, setOrigin] = useState("");
  const [selected, setSelected] = useState<CatalogSummary | null>(null);
  const [disclosure, setDisclosure] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the selected card actually asks for. The list carries only titles, so
  // the statement is fetched for the one card the reader is looking at.
  const [statement, setStatement] = useState<CatalogEntryBody | null>(null);
  const [previewing, setPreviewing] = useState<CatalogSummary | null>(null);
  // Bumped when an administrator saves a template, so the list shows what the
  // catalog now holds rather than what it held when the view opened.
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await api.listDomains(locale).catch(() => []);
      if (!cancelled) setDomains(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, locale]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const page = await api.listCatalog({
          domainId: domain || undefined,
          stars: stars ? Number(stars) : undefined,
          origin: origin || undefined,
          locale,
        });
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        loadingMore.current = false;
        setError(null);
      } catch {
        if (!cancelled)
          setError(ru ? "Каталог недоступен." : "The catalog is unavailable.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, domain, stars, origin, locale, ru, reloads]);

  useEffect(() => {
    if (!selected) {
      setStatement(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const body = await api.readCatalogEntry(
          selected.entryId,
          selected.entryVersion,
          disclosure,
          locale,
        );
        if (!cancelled) setStatement(body);
      } catch {
        if (!cancelled) setStatement(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, selected, disclosure, locale]);

  /**
   * Reads the next page when the list nears its end.
   *
   * The reader scrolls the list because they are looking for something; asking
   * them to press a button at the bottom of every page is asking them to
   * operate the pagination instead.
   */
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const page = await api.listCatalog({
        domainId: domain || undefined,
        stars: stars ? Number(stars) : undefined,
        origin: origin || undefined,
        locale,
        cursor,
      });
      setItems((shown) => [...shown, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      setError(ru ? "Каталог недоступен." : "The catalog is unavailable.");
    } finally {
      loadingMore.current = false;
    }
  }, [api, cursor, domain, stars, origin, locale, ru]);

  // A filter can leave a page too short to scroll while more pages remain;
  // without this the list would stop at content the reader cannot scroll past.
  useEffect(() => {
    const list = listRef.current;
    if (list && cursor && list.scrollHeight <= list.clientHeight)
      void loadMore();
  }, [items, cursor, loadMore]);

  const levels = selected?.allowedDisclosureLevels ?? [];
  const shownStars = selected ? disclosure + selected.difficultyReserve : null;

  return (
    <section
      className="picker"
      role="region"
      aria-label={ru ? "Каталог заданий" : "Task catalog"}
    >
      <div className="picker-card">
        <span className="eyebrow">{ru ? "Новый холст" : "New canvas"}</span>
        <h2>{ru ? "С чего начать" : "Where to start"}</h2>

        <div className="picker-filters">
          <label>
            {ru ? "Домен" : "Domain"}
            <select
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
            >
              <option value="">{ru ? "Любой" : "Any"}</option>
              {domains.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            {ru ? "Сложность" : "Difficulty"}
            <select
              value={stars}
              onChange={(event) => setStars(event.target.value)}
            >
              <option value="">{ru ? "Любая" : "Any"}</option>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {"★".repeat(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {ru ? "Происхождение" : "Origin"}
            <select
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
            >
              <option value="">{ru ? "Любое" : "Any"}</option>
              <option value="starter">{ru ? "Стартовые" : "Starter"}</option>
              <option value="user">{ru ? "Пользователи" : "Users"}</option>
            </select>
          </label>
        </div>

        {error && (
          <p className="picker-error" role="alert">
            {error}
          </p>
        )}

        <ul
          ref={listRef}
          className="picker-list"
          onScroll={(event) => {
            const list = event.currentTarget;
            // A screen's worth of slack, so the next page arrives before the
            // reader reaches the bottom rather than after they wait there.
            if (
              list.scrollHeight - list.scrollTop - list.clientHeight <
              list.clientHeight
            )
              void loadMore();
          }}
        >
          {items.length === 0 && !error && (
            <li className="picker-empty">
              {ru
                ? "Ничего не найдено по фильтрам."
                : "Nothing matches these filters."}
            </li>
          )}
          {items.map((item) => (
            <li key={`${item.entryId}:${item.entryVersion}`}>
              <button
                type="button"
                className={selected?.entryId === item.entryId ? "current" : ""}
                onClick={() => {
                  setSelected(item);
                  setDisclosure(Math.max(...item.allowedDisclosureLevels));
                }}
              >
                <strong>{item.title}</strong>
                <small>
                  {item.domainId} · {"★".repeat(item.stars)}
                  {item.origin === "user" && item.exportTag
                    ? ` · @${item.exportTag}`
                    : ""}
                  {item.gradable ? "" : ru ? " · без оценки" : " · not graded"}
                </small>
              </button>
            </li>
          ))}
          {cursor && (
            <li className="picker-loading" aria-hidden="true">
              {ru ? "Загружается…" : "Loading…"}
            </li>
          )}
        </ul>

        {selected && (
          <div className="picker-levels">
            <span className="eyebrow">
              {ru ? "Сколько открыть" : "How much to open"}
            </span>
            {[...levels]
              .sort((a, b) => b - a)
              .map((level) => (
                <label key={level}>
                  <input
                    type="radio"
                    name="disclosure"
                    checked={disclosure === level}
                    onChange={() => setDisclosure(level)}
                  />
                  {ru ? LEVEL_LABELS[level].ru : LEVEL_LABELS[level].en}
                </label>
              ))}
            <p className="picker-stars" data-stars={shownStars}>
              {ru ? "Сложность карточки: " : "Card difficulty: "}
              {"★".repeat(shownStars ?? 0)}
            </p>
          </div>
        )}

        {statement && (
          <div className="picker-statement">
            <TextList
              title={ru ? "Задание" : "The task"}
              items={statement.baseRequirements}
            />
            <TextList
              title={ru ? "Ключевые метрики" : "Key metrics"}
              items={statement.keyMetrics}
            />
            <TextList
              title={ru ? "Критерии приёмки" : "Acceptance criteria"}
              items={statement.acceptanceCriteria}
            />
          </div>
        )}

        <div className="picker-actions">
          <button
            type="button"
            disabled={busy || !selected}
            onClick={async () => {
              if (!selected) return;
              setBusy(true);
              try {
                await onChoose({ entry: selected, disclosure });
              } finally {
                setBusy(false);
              }
            }}
          >
            {ru ? "Начать задание" : "Start the task"}
          </button>
          <button
            type="button"
            disabled={busy || !selected}
            onClick={() => setPreviewing(selected)}
          >
            {ru ? "Посмотреть шаблон" : "See the template"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onChoose({ entry: null, disclosure: 3 });
              } finally {
                setBusy(false);
              }
            }}
          >
            {ru ? "Пустой холст (Custom)" : "Empty canvas (Custom)"}
          </button>
          <button type="button" disabled={busy} onClick={onCancel}>
            {ru ? "Отмена" : "Cancel"}
          </button>
        </div>
      </div>
      {previewing && (
        <CatalogPreview
          api={api}
          locale={locale}
          role={role}
          entry={previewing}
          onClose={() => setPreviewing(null)}
          onSaved={(saved) => {
            // The saved template is what the reader is now looking at, and it
            // is selected: a correction they just made must be startable
            // without hunting for it in the list again.
            setPreviewing(saved);
            setSelected(saved);
            setDisclosure(Math.max(...saved.allowedDisclosureLevels));
            setReloads((count) => count + 1);
          }}
        />
      )}
    </section>
  );
}
