import { useState } from "react";
import { Logo } from "./Logo";
import { LoaderCircle } from "./icons";
import { friendlyError } from "../lib/api";
import { signInWithGoogle } from "../state/mailbox";
import { LoginWaiting } from "./LoginWaiting";

/** Botão "Conectar com Google": abre o login (folha do macOS ou navegador) e mostra o andamento ou o erro. */
export function ConnectGoogleButton({
  label = "Conectar com Google",
  onConnected,
  size = "lg",
}: {
  label?: string;
  onConnected?: () => void;
  size?: "lg" | "md";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      onConnected?.();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cg">
      <button className={`btn solid${size === "lg" ? " lg" : ""}`} onClick={() => void connect()} disabled={busy} aria-busy={busy}>
        {busy ? (
          <span className="spinner" style={{ display: "inline-flex", animation: "spin 1s linear infinite" }}>
            <LoaderCircle size={17} aria-hidden />
          </span>
        ) : (
          <span className="cg-logo">
            <Logo name="gmail" size={14} />
          </span>
        )}
        {busy ? "Esperando o login…" : label}
      </button>
      {busy && <LoginWaiting className="cg-note" />}
      {error && (
        <p className="cg-note cg-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
