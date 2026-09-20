/**
 * The account panel: who is signed in, what they have chosen, and the way out.
 *
 * It exists because the header was collecting one control per account concern --
 * a badge with the login, a button that signed out, a language toggle -- and
 * none of them belonged among the drawing tools. They are all here now, behind
 * one button in the corner, which is where a reader looks for their own account.
 *
 * Two of the settings are announced rather than offered. A dark theme and a
 * second block style are real intentions, and saying so is more honest than a
 * blank panel that gives no hint they are coming; they are disabled, so nobody
 * can pick one and wonder why nothing changed.
 *
 * Changing a password rotates the session on the server, so the answer carries
 * a new CSRF token; the API client takes it and the panel says the change went
 * through. Nothing is stored here -- the fields are cleared as soon as they are
 * used, because a password left in a form is a password left on the screen.
 */
import { useEffect, useRef, useState } from "react";
import {
  BLOCK_BORDERS,
  EDGE_WEIGHTS,
  preferences,
  type Locale,
} from "./preferences";
import { usePreferences } from "./usePreferences";
import type { SysdesApi } from "../solutions/api";

interface Props {
  api: SysdesApi;
  login: string;
  onClose: () => void;
  onSignOut: () => Promise<void>;
}

export function AccountPanel({ api, login, onClose, onSignOut }: Props) {
  const chosen = usePreferences();
  const ru = chosen.locale === "ru";
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  const changePassword = async () => {
    setProblem(null);
    setDone(null);
    if (next !== repeat) {
      setProblem(ru ? "Пароли не совпадают." : "The passwords do not match.");
      return;
    }
    if (next.length < 12) {
      setProblem(
        ru
          ? "Новый пароль короче 12 символов."
          : "The new password is shorter than 12 characters.",
      );
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setRepeat("");
      setDone(ru ? "Пароль изменён." : "The password was changed.");
    } catch (failure) {
      setProblem(
        failure instanceof Error
          ? failure.message
          : ru
            ? "Пароль не изменён."
            : "The password was not changed.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="account-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="account-panel"
        role="dialog"
        aria-modal="true"
        aria-label={ru ? "Личный кабинет" : "Account"}
      >
        <header className="account-head">
          <div>
            <span className="eyebrow">{ru ? "Аккаунт" : "Account"}</span>
            <h2>{login}</h2>
          </div>
          <button type="button" ref={closeRef} onClick={onClose}>
            {ru ? "Закрыть" : "Close"}
          </button>
        </header>

        <div className="account-section">
          <span className="eyebrow">{ru ? "Язык" : "Language"}</span>
          <div className="account-choices">
            {(["ru", "en"] as Locale[]).map((value) => (
              <button
                key={value}
                type="button"
                className={chosen.locale === value ? "is-chosen" : ""}
                onClick={() => preferences.update({ locale: value })}
              >
                {value === "ru" ? "Русский" : "English"}
              </button>
            ))}
          </div>
          <p className="account-note">
            {ru
              ? "Выбор запоминается в этом браузере."
              : "The choice is remembered in this browser."}
          </p>
        </div>

        <div className="account-section">
          <span className="eyebrow">
            {ru ? "Границы блоков" : "Block outlines"}
          </span>
          <div className="account-choices">
            {BLOCK_BORDERS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={chosen.blockBorder === option.id ? "is-chosen" : ""}
                onClick={() => preferences.update({ blockBorder: option.id })}
              >
                <span
                  className="border-sample"
                  style={{
                    borderWidth: option.width,
                    borderColor: option.hld,
                  }}
                />
                {ru ? option.names.ru : option.names.en}
              </button>
            ))}
          </div>
        </div>

        <div className="account-section">
          <span className="eyebrow">
            {ru ? "Толщина связей" : "Connection weight"}
          </span>
          <div className="account-choices">
            {EDGE_WEIGHTS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={chosen.edgeWeight === option.id ? "is-chosen" : ""}
                onClick={() => preferences.update({ edgeWeight: option.id })}
              >
                <span
                  className="edge-sample"
                  style={{
                    height: `${option.width}px`,
                    background: option.colour,
                  }}
                />
                {ru ? option.names.ru : option.names.en}
              </button>
            ))}
          </div>
        </div>

        <div className="account-section is-planned">
          <span className="eyebrow">{ru ? "В планах" : "Planned"}</span>
          <div className="account-choices">
            <button type="button" disabled>
              {ru ? "Тема оформления: светлая" : "Theme: light"}
            </button>
            <button type="button" disabled>
              {ru ? "Стиль элементов: базовый" : "Element style: basic"}
            </button>
          </div>
          <p className="account-note">
            {ru
              ? "Тёмная тема и другие варианты отрисовки блоков — в плане улучшений."
              : "A dark theme and other block styles are on the improvement list."}
          </p>
        </div>

        <div className="account-section">
          <span className="eyebrow">
            {ru ? "Смена пароля" : "Change the password"}
          </span>
          <label>
            {ru ? "Текущий пароль" : "Current password"}
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </label>
          <label>
            {ru ? "Новый пароль" : "New password"}
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </label>
          <label>
            {ru ? "Новый пароль ещё раз" : "The new password again"}
            <input
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void changePassword();
              }}
            />
          </label>
          <button
            type="button"
            className="account-primary"
            disabled={busy || !current || !next || !repeat}
            onClick={() => void changePassword()}
          >
            {ru ? "Сменить пароль" : "Change the password"}
          </button>
          {problem && (
            <p className="account-problem" role="alert">
              {problem}
            </p>
          )}
          {done && <p className="account-done">{done}</p>}
        </div>

        <div className="account-section account-exit">
          <button
            type="button"
            className="account-signout"
            disabled={busy}
            onClick={() => void onSignOut()}
          >
            {ru ? "Выйти из аккаунта" : "Sign out"}
          </button>
        </div>
      </section>
    </div>
  );
}
