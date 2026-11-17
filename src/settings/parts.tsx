import { useEffect, useRef, type ReactNode } from "react";
import { SliderGroup } from "../components/SliderGroup";

/** Chave liga/desliga (botão com role="switch"). */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button className="toggle" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

/** Escolha entre poucas opções, com destaque que desliza. */
export function Seg<T extends string | number>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  label: string;
}) {
  return (
    <SliderGroup className="segmented st-seg" role="group" label={label} activeKey={String(value)}>
      {options.map((o) => (
        <button key={String(o.value)} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </SliderGroup>
  );
}

/** Cartão de uma seção: título, texto de apoio e a lista de linhas. */
export function Panel({ id, title, sub, children }: { id: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section className="card st-panel screen-enter" aria-labelledby={`${id}-title`}>
      <header className="st-panel-head">
        <h2 className="st-title" id={`${id}-title`}>
          {title}
        </h2>
        <div className="st-sub">{sub}</div>
      </header>
      {children}
    </section>
  );
}

/** Lista de linhas com entrada escalonada. */
export function Rows({ children }: { children: ReactNode }) {
  return <div className="st-rows stagger">{children}</div>;
}

/** Uma linha: texto à esquerda, controle à direita. */
export function Row({ title, sub, children, icon }: { title: string; sub?: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="st-prow">
      {icon && <span className="st-prow-icon">{icon}</span>}
      <div className="st-prow-text">
        <div className="st-prow-title">{title}</div>
        {sub && <div className="st-prow-sub">{sub}</div>}
      </div>
      <div className="st-prow-ctl">{children}</div>
    </div>
  );
}

/** Confirmação antes de uma ação difícil de desfazer (Esc ou Cancelar fecham; o foco volta ao botão de origem). */
export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  icon,
  onCancel,
  onConfirm,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  icon?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      if (e.key !== "Tab" || !boxRef.current) return;
      const items = boxRef.current.querySelectorAll<HTMLElement>("button");
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      origin?.focus?.();
    };
  }, [onCancel]);

  return (
    <div className="st-overlay" onClick={onCancel}>
      <div ref={boxRef} className="st-dialog" role="alertdialog" aria-modal="true" aria-labelledby="st-dlg-title" aria-describedby="st-dlg-desc" onClick={(e) => e.stopPropagation()}>
        <h2 id="st-dlg-title">{title}</h2>
        <p id="st-dlg-desc">{text}</p>
        <div className="st-dialog-actions">
          <button ref={cancelRef} className="btn glass" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn solid danger-solid" onClick={onConfirm}>
            {icon}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
