/**
 * The unobtrusive corner status.
 *
 * It subscribes to the coordinator directly so that "Saving..." repaints this
 * element alone. Routing the status through the editor's state would re-render
 * the canvas on every write, which is exactly what input isolation avoids.
 */
import { useSyncExternalStore } from "react";
import type { SaveCoordinator } from "./SaveCoordinator";
import type { SaveState } from "./saveState";

const RU: Record<SaveState["status"], string> = {
  saved: "Все изменения сохранены",
  dirty: "Есть несохранённые изменения",
  saving: "Автосохранение...",
  saved_with_new_changes: "Есть новые несохранённые изменения",
  error: "Не удалось сохранить. Повторить",
  unknown: "Проверяем сохранение...",
  auth_required: "Войдите для сохранения",
  conflict: "Конфликт версий",
  invalid: "Исправьте ошибки",
};

const EN: Record<SaveState["status"], string> = {
  saved: "All changes saved",
  dirty: "Unsaved changes",
  saving: "Saving...",
  saved_with_new_changes: "New unsaved changes",
  error: "Could not save. Retry",
  unknown: "Checking the save...",
  auth_required: "Sign in to save",
  conflict: "Version conflict",
  invalid: "Fix the errors",
};

export function SaveIndicator({
  coordinator,
  locale,
}: {
  coordinator: SaveCoordinator;
  locale: "ru" | "en";
}) {
  const state = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getState,
  );
  const words = locale === "ru" ? RU : EN;
  return (
    <span
      className={`save-status save-status-${state.status}`}
      role="status"
      aria-live="polite"
      data-status={state.status}
      data-dirty={state.isDirty}
    >
      {words[state.status]}
    </span>
  );
}
