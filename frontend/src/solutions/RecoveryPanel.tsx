/**
 * Shown when the account's current canvas moved while this tab had work that the
 * server has not confirmed.
 *
 * The rule this encodes: another device switching is not consent to lose local
 * edits. The draft stays here, editing of it stops, and the owner decides. There
 * is deliberately no automatic resolution and no timeout.
 */
import { useState } from "react";

export type RecoveryChoice = "save" | "discard" | "postpone";

interface Props {
  locale: "ru" | "en";
  /** Name of the canvas this tab still holds. */
  name: string;
  /** Set when the save that would resolve this failed, so the reason is visible. */
  problem: string | null;
  onChoice: (choice: RecoveryChoice) => Promise<void> | void;
  onExport: () => Promise<void> | void;
}

export function RecoveryPanel({
  locale,
  name,
  problem,
  onChoice,
  onExport,
}: Props) {
  const ru = locale === "ru";
  const [busy, setBusy] = useState(false);
  const run = async (choice: RecoveryChoice) => {
    setBusy(true);
    try {
      await onChoice(choice);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="recovery"
      role="region"
      aria-label={ru ? "Несохранённые изменения" : "Unsaved changes"}
    >
      <div className="recovery-card">
        <span className="eyebrow">{ru ? "Восстановление" : "Recovery"}</span>
        <h2>
          {ru
            ? "Текущий холст аккаунта изменён на другом устройстве"
            : "The account's current canvas changed on another device"}
        </h2>
        <p>
          {ru
            ? `В этой вкладке остались неподтверждённые изменения холста «${name}». Они не потеряны и не будут отправлены автоматически.`
            : `This tab still holds unconfirmed changes to "${name}". They are not lost and will not be sent automatically.`}
        </p>
        {problem && (
          <p className="recovery-error" role="alert">
            {problem}
          </p>
        )}
        <div className="recovery-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("save")}
          >
            {ru ? "Сохранить и перейти" : "Save and switch"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("discard")}
          >
            {ru ? "Отбросить и перейти" : "Discard and switch"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("postpone")}
          >
            {ru ? "Отложить" : "Decide later"}
          </button>
          <button type="button" disabled={busy} onClick={() => void onExport()}>
            {ru ? "Скачать JSON" : "Download JSON"}
          </button>
        </div>
        <p className="recovery-note">
          {ru
            ? "«Отбросить» относится только к неподтверждённым правкам: уже отправленный запрос мог сохраниться на сервере."
            : "Discard applies only to unconfirmed edits: a request already sent may have been stored."}
        </p>
      </div>
    </section>
  );
}
