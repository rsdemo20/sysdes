/**
 * Sign in or register. Deliberately minimal: registration is open, there is no
 * email, and the same wording answers a wrong login and a wrong password so the
 * form cannot be used to discover which accounts exist.
 */
import { useState } from "react";
import { ApiError, type Session, type SysdesApi } from "../solutions/api";

interface Props {
  api: SysdesApi;
  locale: "ru" | "en";
  onSignedIn: (session: Session) => void;
}

export function SignIn({ api, locale, onSignedIn }: Props) {
  const ru = locale === "ru";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session =
        mode === "login"
          ? await api.login(login, password)
          : await api.register(login, password);
      onSignedIn(session);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? describe(caught, ru)
          : ru
            ? "Сервер недоступен."
            : "The server is unavailable.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <form className="signin-card" onSubmit={submit}>
        <span className="eyebrow">sysdes</span>
        <h1>{ru ? "Вход" : "Sign in"}</h1>
        <p>
          {ru
            ? "Логин и пароль. Регистрация открыта, электронная почта не нужна."
            : "Login and password. Registration is open and needs no email."}
        </p>
        <label>
          {ru ? "Логин" : "Login"}
          <input
            name="login"
            value={login}
            autoComplete="username"
            onChange={(event) => setLogin(event.target.value)}
            required
            minLength={3}
            maxLength={32}
          />
        </label>
        <label>
          {ru ? "Пароль" : "Password"}
          <input
            name="password"
            type="password"
            value={password}
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        {mode === "register" && (
          <p className="signin-hint">
            {ru ? "Не короче 12 символов." : "At least 12 characters."}
          </p>
        )}
        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy
            ? ru
              ? "Отправка..."
              : "Sending..."
            : mode === "login"
              ? ru
                ? "Войти"
                : "Sign in"
              : ru
                ? "Зарегистрироваться"
                : "Register"}
        </button>
        <button
          type="button"
          className="signin-switch"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login"
            ? ru
              ? "Создать аккаунт"
              : "Create an account"
            : ru
              ? "У меня уже есть аккаунт"
              : "I already have an account"}
        </button>
      </form>
    </div>
  );
}

function describe(error: ApiError, ru: boolean): string {
  switch (error.code) {
    case "invalid_credentials":
      return ru ? "Неверный логин или пароль." : "Invalid login or password.";
    case "login_taken":
      return ru ? "Такой логин уже занят." : "That login is already taken.";
    case "rate_limited":
      return ru
        ? "Слишком много попыток. Подождите."
        : "Too many attempts. Please wait.";
    case "invalid_request":
      return ru
        ? "Логин 3–32 символа, пароль не короче 12."
        : "Login is 3 to 32 characters, password at least 12.";
    default:
      return error.message;
  }
}
