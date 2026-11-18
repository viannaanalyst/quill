import * as Popover from "@radix-ui/react-popover";
import { useState } from "react";
import { Download, LoaderCircle } from "../components/icons";
import { installUpdate, useUpdate } from "../lib/updater";
import { version as CURRENT } from "../../package.json";

/**
 * Versão nova do Quill: ícone com um pontinho na barra lateral, logo acima de Ajustes (como no runelay).
 * Só aparece quando há atualização; a janelinha mostra a versão e o botão "Atualizar" (baixa, instala e reabre).
 */
export function UpdateButton() {
  const u = useUpdate();
  const [open, setOpen] = useState(false);
  // depois de achar uma versão, continua visível até atualizar (mesmo se uma conferência seguinte falhar)
  if (!u.version || u.phase === "none") return null;
  const busy = u.phase === "downloading" || u.phase === "ready";
  const label = busy ? `Atualizando para o Quill ${u.version}` : `Atualização disponível: Quill ${u.version}`;
  const pct = u.progress !== undefined ? Math.round(u.progress * 100) : undefined;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="rail-btn rail-upd" data-tip={label} data-tip-pos="right" aria-label={label}>
          {busy ? <LoaderCircle size={16} className="spinning" aria-hidden /> : <Download size={16} aria-hidden />}
          {!busy && <span className="badge" aria-hidden />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="qp-content rail-upd-pop" side="right" align="end" sideOffset={12} collisionPadding={12} aria-label="Atualização do Quill">
          <div className="rail-upd-head">
            <span className="rail-upd-icon" aria-hidden>
              <Download size={16} />
            </span>
            <div>
              <div className="rail-upd-title">Quill {u.version} disponível</div>
              <div className="rail-upd-sub">Você está na versão {CURRENT}.</div>
            </div>
          </div>
          {u.notes && <p className="rail-upd-notes">{u.notes}</p>}
          {busy ? (
            <div className="rail-upd-progress" role="status">
              <span>{u.phase === "ready" ? "Instalando e reabrindo…" : `Baixando…${pct !== undefined ? ` ${pct}%` : ""}`}</span>
              <i aria-hidden>
                <b style={{ transform: `scaleX(${u.phase === "ready" ? 1 : (u.progress ?? 0.08)})` }} />
              </i>
            </div>
          ) : (
            <>
              {u.phase === "error" && u.error && <p className="rail-upd-error">Não deu certo: {u.error}</p>}
              <p className="rail-upd-hint">O Quill baixa a versão nova, instala e abre de novo sozinho. Leva poucos segundos.</p>
              <div className="rail-upd-actions">
                <button className="btn glass sm" onClick={() => setOpen(false)}>
                  Agora não
                </button>
                <button className="btn solid sm" onClick={() => void installUpdate()}>
                  {u.phase === "error" ? "Tentar de novo" : "Atualizar"}
                </button>
              </div>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
