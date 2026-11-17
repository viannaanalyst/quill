import { useEffect, useRef, useState } from "react";
import iconLight from "../assets/brand/app-icon-light-128.png";
import iconDark from "../assets/brand/app-icon-dark-128.png";
import { Fingerprint } from "./icons";

async function authenticate(): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("touch_id_authenticate", { reason: "abrir o Quill" });
}

/** Tela de bloqueio: pede o Touch ID (ou a senha do Mac) ao abrir o app, quando ligado em Ajustes. */
export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);

  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      if (await authenticate()) onUnlock();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  // pede sozinho assim que abre (uma vez); depois, pelo botão
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void unlock();
  }, []);

  return (
    <div className="lock" data-tauri-drag-region>
      <div className="lock-card">
        <img className="only-light" src={iconLight} alt="" width={72} height={72} draggable={false} />
        <img className="only-dark" src={iconDark} alt="" width={72} height={72} draggable={false} />
        <h1>Quill está bloqueado</h1>
        <p>Use o Touch ID ou a senha do Mac para abrir.</p>
        <button className="btn solid lg" onClick={() => void unlock()} disabled={busy}>
          <Fingerprint size={18} aria-hidden />
          {busy ? "Esperando o Touch ID…" : "Desbloquear"}
        </button>
        {error && (
          <p className="lock-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** O Mac tem Touch ID (ou senha) para pedir? */
export async function touchIdAvailable(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("touch_id_available");
  } catch {
    return false;
  }
}

/** Pede o Touch ID uma vez (para confirmar ao ligar a opção). */
export async function confirmTouchId(): Promise<boolean> {
  try {
    return await authenticate();
  } catch {
    return false;
  }
}
