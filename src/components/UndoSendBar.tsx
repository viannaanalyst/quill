import { useEffect, useState } from "react";
import { SendHorizontal } from "./icons";
import { sendNow, undoSend, usePendingSend } from "../state/outbox";

/** Barrinha "Enviando em 8 s · Desfazer" enquanto o e-mail espera para sair. */
export function UndoSendBar() {
  const p = usePendingSend();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!p) return;
    const t = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, [p]);
  if (!p) return null;
  const left = Math.max(0, Math.ceil((p.at - Date.now()) / 1000));
  return (
    <div className="undo-send" role="status" key={p.id}>
      <SendHorizontal size={15} aria-hidden />
      <span>
        Enviando em <b>{left} s</b>
      </span>
      <button onClick={undoSend}>Desfazer</button>
      <button className="undo-send-now" onClick={sendNow}>
        Enviar agora
      </button>
      <i className="undo-send-bar" style={{ animationDuration: `${p.seconds}s` }} aria-hidden />
    </div>
  );
}
