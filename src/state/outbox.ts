import { useSyncExternalStore } from "react";
import { getPref } from "../lib/storage";
import { api, friendlyError, type OutgoingMessage } from "../lib/api";
import { toast } from "../components/Toasts";
import { sendMessage } from "./mailbox";
import { navigate, type ComposeDraft } from "./store";

/**
 * Caixa de saída com "Desfazer": o e-mail espera alguns segundos (Ajustes → Geral → Tempo para desfazer)
 * antes de ir para o Gmail. Desfazendo, volta para a tela Escrever com tudo preenchido.
 */
export interface Pending {
  id: number;
  message: OutgoingMessage;
  threadId?: string;
  restore: ComposeDraft;
  /** quando sai de fato (ms) */
  at: number;
  seconds: number;
}

let pending: Pending | null = null;
let timer: number | undefined;
let seq = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function usePendingSend() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => pending,
  );
}

async function deliver(p: Pending) {
  if (pending?.id === p.id) {
    pending = null;
    emit();
  }
  try {
    await sendMessage(p.message, p.threadId);
    toast(p.threadId ? "Resposta enviada" : "E-mail enviado");
    // enviado: o rascunho salvo no Gmail sai de Rascunhos
    if (p.restore.draftId) void api.draftDelete(p.message.from, p.restore.draftId).catch(() => undefined);
  } catch (e) {
    toast(`Não enviou: ${friendlyError(e)}`, "error");
    // nada se perde: volta para a tela Escrever com o e-mail como estava
    navigate({ name: "compose", draft: p.restore });
  }
}

/** Põe o e-mail na fila. Se outro estiver esperando, ele sai na hora. */
export function queueSend(message: OutgoingMessage, threadId: string | undefined, restore: ComposeDraft) {
  if (pending) {
    window.clearTimeout(timer);
    void deliver(pending);
  }
  const seconds = Number(getPref<number | string>("undoSeconds", 10)) || 0;
  const p: Pending = { id: seq++, message, threadId, restore, at: Date.now() + seconds * 1000, seconds };
  if (seconds <= 0) {
    void deliver(p);
    return;
  }
  pending = p;
  emit();
  timer = window.setTimeout(() => void deliver(p), seconds * 1000);
}

/** Cancela o envio e reabre o e-mail para editar. */
export function undoSend() {
  if (!pending) return;
  window.clearTimeout(timer);
  const p = pending;
  pending = null;
  emit();
  navigate({ name: "compose", draft: p.restore });
  toast("Envio desfeito");
}

/** Manda agora, sem esperar. */
export function sendNow() {
  if (!pending) return;
  window.clearTimeout(timer);
  void deliver(pending);
}
