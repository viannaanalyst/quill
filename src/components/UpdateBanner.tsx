import { useState } from "react";
import { Download, X } from "./icons";
import { installUpdate, useUpdate } from "../lib/updater";

/** Aviso discreto no canto: "Nova versão disponível · Atualizar". */
export function UpdateBanner() {
  const u = useUpdate();
  const [hidden, setHidden] = useState<string | null>(null);
  if (!["available", "downloading", "ready"].includes(u.phase) || hidden === u.version) return null;
  const busy = u.phase !== "available";
  return (
    <div className="upd" role="status">
      <Download size={15} aria-hidden />
      <span>
        {u.phase === "available" ? (
          <>
            Quill <b>{u.version}</b> disponível
          </>
        ) : u.phase === "downloading" ? (
          `Baixando… ${u.progress !== undefined ? Math.round(u.progress * 100) + "%" : ""}`
        ) : (
          "Reabrindo…"
        )}
      </span>
      {!busy && (
        <>
          <button onClick={() => void installUpdate()}>Atualizar</button>
          <button className="upd-x" aria-label="Agora não" data-tip="Agora não" onClick={() => setHidden(u.version ?? "")}>
            <X size={13} aria-hidden />
          </button>
        </>
      )}
      {u.phase === "downloading" && <i className="upd-bar" style={{ transform: `scaleX(${u.progress ?? 0.1})` }} aria-hidden />}
    </div>
  );
}
