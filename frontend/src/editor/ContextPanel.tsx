/**
 * One of the three task panels on the canvas.
 *
 * It can be moved by its body, sized from its outline once selected, and every
 * item in it is edited in place; what it cannot be is deleted -- there is no
 * button for that, and the Delete key has nothing in the document to remove.
 * Items come and go with the + and × beside them.
 */
import { NodeResizer } from "@xyflow/react";
import type { EditorStore } from "./EditorStore";
import { TextField } from "./TextField";
import {
  CONTEXT_SECTIONS,
  KIND_NAMES,
  MAX_ACCEPTANCE_CRITERIA,
  type ContextItemKind,
  type ContextPanelModel,
} from "./contextPanels";
import type { CanvasContext } from "../model/types";

interface Props {
  id: string;
  model: ContextPanelModel;
  store: EditorStore;
  locale: "ru" | "en";
  readOnly?: boolean;
  selected: boolean;
}

const COMPARATORS: Record<string, string> = {
  eq: "=",
  le: "≤",
  ge: "≥",
  range: "∈",
};

function ItemFields({
  kind,
  item,
  index,
  store,
  locale,
  readOnly,
}: {
  kind: ContextItemKind;
  item: { id: string };
  index: number;
  store: EditorStore;
  locale: "ru" | "en";
  readOnly: boolean;
}) {
  const ru = locale === "ru";
  const one = `${KIND_NAMES[kind][locale].one} ${index + 1}`;

  if (kind === "technicalParameters") {
    const parameter = item as CanvasContext["technicalParameters"][number];
    return (
      <div className="context-fields context-parameter">
        <TextField
          store={store}
          readOnly={readOnly}
          objectId={parameter.id}
          field="name"
          value={parameter.name}
          label={`${one}: ${ru ? "название" : "name"}`}
          placeholder={ru ? "Метрика" : "Metric"}
          className="context-text"
          multiline
          autoSize={{ columns: 28 }}
        />
        <TextField
          store={store}
          readOnly={readOnly}
          objectId={parameter.id}
          field="value"
          value={parameter.value === null ? "" : String(parameter.value)}
          label={`${one}: ${ru ? "значение" : "value"}`}
          placeholder="—"
          className="context-value"
        />
        <TextField
          store={store}
          readOnly={readOnly}
          objectId={parameter.id}
          field="unit"
          value={parameter.unit}
          label={`${one}: ${ru ? "единица" : "unit"}`}
          placeholder={ru ? "ед." : "unit"}
          maxLength={100}
          className="context-unit"
        />
      </div>
    );
  }

  if (kind === "acceptanceCriteria") {
    const criterion = item as CanvasContext["acceptanceCriteria"][number];
    const condition = criterion.condition as Record<string, unknown>;
    const parts = [
      ["given", ru ? "Дано" : "Given"],
      ["when", ru ? "Когда" : "When"],
      ["then", ru ? "Тогда" : "Then"],
    ] as const;
    return (
      <div className="context-fields">
        <TextField
          store={store}
          readOnly={readOnly}
          objectId={criterion.id}
          field="text"
          value={criterion.text}
          label={one}
          placeholder={ru ? "Что должно выполняться" : "What must hold"}
          className="context-text"
          multiline
          autoSize={{ columns: 44 }}
        />
        {condition.kind === "scenario" &&
          parts.map(([part, name]) => (
            <div className="context-condition" key={part}>
              <span>{name}</span>
              <TextField
                store={store}
                readOnly={readOnly}
                objectId={criterion.id}
                field={`condition.${part}`}
                value={String(condition[part] ?? "")}
                label={`${one}: ${name}`}
                className="context-text"
                multiline
                autoSize={{ columns: 36 }}
              />
            </div>
          ))}
        {condition.kind === "boolean" && (
          <div className="context-condition">
            <span>{ru ? "Условие" : "Condition"}</span>
            <TextField
              store={store}
              readOnly={readOnly}
              objectId={criterion.id}
              field="condition.statement"
              value={String(condition.statement ?? "")}
              label={`${one}: ${ru ? "условие" : "condition"}`}
              className="context-text"
              multiline
              autoSize={{ columns: 36 }}
            />
          </div>
        )}
        {condition.kind === "numeric" && (
          <p className="context-numeric">
            {String(condition.metricName ?? "")}{" "}
            {COMPARATORS[String(condition.comparator)] ?? ""}{" "}
            {condition.value === null ? "" : String(condition.value)}
            {condition.comparator === "range" && condition.upperValue !== null
              ? `…${String(condition.upperValue)}`
              : ""}{" "}
            {String(condition.unit ?? "")}
          </p>
        )}
      </div>
    );
  }

  const plain = item as { id: string; text: string };
  return (
    <div className="context-fields">
      <TextField
        store={store}
        readOnly={readOnly}
        objectId={plain.id}
        field="text"
        value={plain.text}
        label={one}
        placeholder={ru ? "Текст пункта" : "Item text"}
        className="context-text"
        multiline
        autoSize={{ columns: 44 }}
      />
    </div>
  );
}

export function ContextPanel({
  id,
  model,
  store,
  locale,
  readOnly = false,
  selected,
}: Props) {
  const ru = locale === "ru";
  const section = CONTEXT_SECTIONS.find((s) => s.id === model.section)!;
  // A new item is empty, so the author is taken straight to it.
  const focusItem = (itemId: string) =>
    requestAnimationFrame(() => {
      window.document
        .querySelector<HTMLElement>(
          `[data-context-item="${itemId}"] textarea, [data-context-item="${itemId}"] input`,
        )
        ?.focus();
    });

  return (
    <div
      className={`context-panel context-${section.id}${selected ? " is-selected" : ""}`}
      data-section={section.id}
      data-panel-id={id}
    >
      <NodeResizer
        minWidth={240}
        minHeight={120}
        isVisible={selected && !readOnly}
        color="#7f9ac9"
      />
      <div className="context-heading">
        <span className="context-title">{section.names[locale]}</span>
        <span className="drag-grip" aria-hidden="true">
          ⠿
        </span>
      </div>
      <div className="context-body nowheel">
        {section.kinds.map((kind) => {
          const names = KIND_NAMES[kind][locale];
          const items = model.context[kind] as Array<{ id: string }>;
          const full =
            kind === "acceptanceCriteria" &&
            items.length >= MAX_ACCEPTANCE_CRITERIA;
          return (
            <div className="context-group" data-kind={kind} key={kind}>
              {section.kinds.length > 1 && (
                <div className="context-group-title">{names.group}</div>
              )}
              <ul className="context-items">
                {items.map((item, index) => (
                  <li
                    key={item.id}
                    className="context-item"
                    data-context-item={item.id}
                  >
                    <ItemFields
                      kind={kind}
                      item={item}
                      index={index}
                      store={store}
                      locale={locale}
                      readOnly={readOnly}
                    />
                    {!readOnly && (
                      <button
                        type="button"
                        className="context-remove nodrag"
                        title={ru ? "Удалить пункт" : "Remove this item"}
                        aria-label={`${ru ? "Удалить" : "Remove"}: ${names.one} ${index + 1}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => store.removeContextItem(item.id)}
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {!readOnly && (
                <button
                  type="button"
                  className="context-add nodrag"
                  disabled={full}
                  title={
                    full
                      ? ru
                        ? `Оценка принимает не больше ${MAX_ACCEPTANCE_CRITERIA} критериев`
                        : `An evaluation takes at most ${MAX_ACCEPTANCE_CRITERIA} criteria`
                      : names.add
                  }
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => focusItem(store.addContextItem(kind))}
                >
                  {names.add}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
