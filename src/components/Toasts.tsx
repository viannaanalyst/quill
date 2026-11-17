import { useSyncExternalStore } from "react";
import { CircleCheck, TriangleAlert } from "./icons";

interface Toast {
  id: number;
  text: string;
  kind: "ok" | "error";
  leaving?: boolean;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Aviso rápido no canto (some sozinho em ~2,5 s). */
export function toast(text: string, kind: "ok" | "error" = "ok") {
  const id = nextId++;
  const wait = kind === "error" ? 4200 : 2400;
  toasts = [...toasts.slice(-2), { id, text, kind }];
  emit();
  window.setTimeout(() => {
    toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
    emit();
  }, wait);
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, wait + 200);
}

export function Toasts() {
  const list = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => toasts,
  );
  return (
    <div className="toast-area" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast${t.kind === "error" ? " error" : ""}${t.leaving ? " leaving" : ""}`}>
          {t.kind === "error" ? <TriangleAlert size={15} aria-hidden /> : <CircleCheck size={15} aria-hidden />}
          {t.text}
        </div>
      ))}
    </div>
  );
}
