import * as Dialog from "@radix-ui/react-dialog";
import { useSyncExternalStore } from "react";

/**
 * Confirmação no estilo do Quill (o `window.confirm` do navegador não funciona dentro do app).
 * Uso: `if (!(await askConfirm({ title, text, action }))) return;`
 */
interface Ask {
  title: string;
  text?: string;
  /** texto do botão de confirmar (vermelho) */
  action: string;
  resolve: (ok: boolean) => void;
}

let current: Ask | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function askConfirm(opts: Omit<Ask, "resolve">): Promise<boolean> {
  current?.resolve(false);
  return new Promise((resolve) => {
    current = { ...opts, resolve };
    emit();
  });
}

function answer(ok: boolean) {
  const c = current;
  current = null;
  emit();
  c?.resolve(ok);
}

export function ConfirmHost() {
  const ask = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
  return (
    <Dialog.Root open={!!ask} onOpenChange={(o) => !o && answer(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="cmd-overlay" />
        <Dialog.Content className="crop-box confirm-box" aria-describedby={ask?.text ? "q-confirm-text" : undefined}>
          {ask && (
            <>
              <Dialog.Title className="crop-title">{ask.title}</Dialog.Title>
              {ask.text && (
                <p id="q-confirm-text" className="confirm-text">
                  {ask.text}
                </p>
              )}
              <div className="crop-actions">
                <button className="btn glass" onClick={() => answer(false)} autoFocus>
                  Cancelar
                </button>
                <button className="btn solid danger-solid" onClick={() => answer(true)}>
                  {ask.action}
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
