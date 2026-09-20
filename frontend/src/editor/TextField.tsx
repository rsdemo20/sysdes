import { memo, useEffect, useRef, useState } from "react";
import type { EditorStore, TextPatch } from "./EditorStore";

/** The key that changes what a click or a drag on the canvas means. */
const MODIFIERS = new Set(["Shift"]);

interface Props {
  store: EditorStore;
  objectId: string;
  field?: string;
  value: string;
  label: string;
  multiline?: boolean;
  /**
   * Size a multi-line field by its text instead of a fixed three rows: as many
   * rows as the lines take and as wide as the widest, up to `columns`.
   */
  autoSize?: { columns: number };
  maxLength?: number;
  className?: string;
  placeholder?: string;
  /** Show the value without accepting changes to it. */
  readOnly?: boolean;
  onCommit?: (value: string) => void;
}

export const TextField = memo(function TextField({
  store,
  objectId,
  field = "label",
  value,
  label,
  multiline = false,
  autoSize,
  maxLength = 4000,
  className = "",
  placeholder,
  readOnly = false,
  onCommit,
}: Props) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  // Spelling is checked only while the field is being edited. A browser keeps
  // its red underlines on a field that was once checked, so a canvas someone
  // merely reads would otherwise be covered in them.
  const [editing, setEditing] = useState(false);
  const current = useRef(value),
    committed = useRef(value),
    composing = useRef(false);
  const waits = useRef<Array<() => void>>([]),
    blurred = useRef(false);
  const customCommit = useRef(onCommit);
  customCommit.current = onCommit;
  const read = (): TextPatch | null => {
    if (current.current.length > maxLength) {
      setInvalid(true);
      throw new Error(`Поле «${label}» превышает ${maxLength} символов.`);
    }
    return current.current === committed.current
      ? null
      : { objectId, field, value: current.current };
  };
  const commit = () => {
    if (composing.current) return;
    const patch = read();
    if (patch) {
      if (customCommit.current) customCommit.current(patch.value);
      else store.commit([patch]);
      committed.current = patch.value;
    }
  };
  useEffect(() => {
    // A graph update elsewhere must never overwrite an active local draft.
    if (current.current === committed.current || current.current === value) {
      current.current = value;
      setDraft(value);
    }
    committed.current = value;
  }, [value]);
  useEffect(
    () =>
      store.register(`${objectId}:${field}`, {
        read,
        isComposing: () => composing.current,
        apply: onCommit
          ? (patch) => customCommit.current?.(patch.value)
          : undefined,
        wait: () =>
          composing.current
            ? new Promise<void>((resolve) => {
                waits.current.push(resolve);
              })
            : Promise.resolve(),
        acknowledge: () => {
          committed.current = current.current;
        },
      }),
    [store, objectId, field, maxLength, onCommit],
  );
  const common = {
    value: draft,
    readOnly,
    "aria-label": label,
    "aria-invalid": invalid || undefined,
    className: `text-field nodrag nopan nowheel ${className}`,
    maxLength,
    placeholder,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      current.current = event.currentTarget.value;
      setDraft(current.current);
      setInvalid(false);
    },
    spellCheck: editing,
    onFocus: () => {
      blurred.current = false;
      setEditing(true);
    },
    onBlur: (
      event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      blurred.current = true;
      setEditing(false);
      // A field scrolled while editing would otherwise be left showing the
      // middle of its text, and its scrollbar, to everyone reading the canvas.
      event.currentTarget.scrollTop = 0;
      commit();
    },
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: (
      event: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      current.current = event.currentTarget.value;
      setDraft(current.current);
      composing.current = false;
      waits.current.splice(0).forEach((resolve) => resolve());
      if (blurred.current) commit();
    },
    onKeyDown: (
      event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      // Typing stays in the field, but a held Shift is news for the canvas:
      // pressed while a block's title has the focus, it is how the next click
      // adds a block to the selection, or a drag draws a box.
      if (!MODIFIERS.has(event.key)) event.stopPropagation();
      if (composing.current || event.nativeEvent.isComposing) return;
      if (event.key === "Escape") {
        current.current = committed.current;
        setDraft(committed.current);
        setInvalid(false);
      }
      if (
        event.key === "Enter" &&
        (!multiline || event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault();
        commit();
      }
    },
  };
  if (multiline && autoSize) {
    const lines = draft.split("\n");
    const widest = Math.max(0, ...lines.map((line) => line.length));
    const cols = Math.min(autoSize.columns, Math.max(8, widest));
    const rows = lines.reduce(
      (total, line) => total + Math.max(1, Math.ceil(line.length / cols)),
      0,
    );
    return <textarea {...common} rows={rows} cols={cols} />;
  }
  return multiline ? (
    <textarea {...common} rows={3} />
  ) : (
    <input {...common} type="text" />
  );
});
