import { useState } from "react";
import { LoaderCircle } from "./icons";
import { toast } from "./Toasts";
import { api } from "../lib/api";

/**
 * Enquanto o login do Google está aberto (folha do macOS ou navegador): explica o que fazer e deixa
 * abrir a página de novo, copiar o link (para colar em outro navegador) ou cancelar.
 */
export function LoginWaiting({ className = "" }: { className?: string }) {
  const [cancelling, setCancelling] = useState(false);

  const copy = async () => {
    try {
      const url = await api.googleSignInUrl();
      if (!url) return;
      await navigator.clipboard.writeText(url);
      toast("Link do login copiado. Cole no navegador em que você usa essa conta.");
    } catch {
      toast("Não consegui copiar o link", "error");
    }
  };

  return (
    <div className={`lw ${className}`} role="status">
      <p>
        <LoaderCircle size={14} className="spinning" aria-hidden />
        Termine o login na janela que abriu. Depois, volte para cá.
      </p>
      <div className="lw-actions">
        <button type="button" onClick={() => void api.googleSignInReopen().catch(() => undefined)}>
          Abrir de novo
        </button>
        <button type="button" onClick={() => void copy()}>
          Copiar link
        </button>
        <button
          type="button"
          className="lw-cancel"
          disabled={cancelling}
          onClick={() => {
            setCancelling(true);
            void api.googleSignInCancel().finally(() => setCancelling(false));
          }}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
