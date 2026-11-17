import { useSyncExternalStore } from "react";
import type { AccountId, Rsvp } from "../inbox/types";
import { getPref } from "../lib/storage";

/** Texto já preenchido ao abrir Escrever (responder, encaminhar, escrever para alguém). */
export interface ComposeDraft {
  /** rascunho do Gmail que está sendo editado */
  draftId?: string;
  from?: string;
  to?: { name: string; email: string }[];
  subject?: string;
  /** HTML inicial do corpo */
  body?: string;
  threadId?: string;
  cc?: { name: string; email: string }[];
  bcc?: { name: string; email: string }[];
  /** anexos já lidos (ao desfazer um envio) */
  attachments?: { name: string; mimeType: string; data: string; size: number }[];
  /** veio da resposta rápida deste e-mail: mostra "Voltar ao e-mail" no lugar do Fechar */
  returnTo?: string;
}

/** Telas do app. */
export type CalendarMode = "day" | "week" | "month";
export type View =
  | { name: "inbox"; folder: string }
  | { name: "read"; id: string }
  | { name: "compose"; draft?: ComposeDraft }
  | { name: "calendar"; mode: CalendarMode }
  /** Google Chat (contas Workspace); `space` = conversa aberta (`spaces/<id>`) */
  | { name: "chat"; space?: string }
  | { name: "settings" };

/**
 * Resposta ao convite: escolhe → mostra a confirmação com uma barrinha de tempo (dá para desfazer)
 * → some com uma animação curta → fica escondido.
 */
export type RsvpPhase = "idle" | "confirm" | "leaving" | "done";

interface State {
  view: View;
  /** última caixa aberta (para o Voltar da leitura) */
  lastFolder: string;
  readIds: ReadonlySet<string>;
  rsvp: { value: Rsvp | null; phase: RsvpPhase };
  hiddenCalendars: ReadonlySet<AccountId | "feriado">;
}

export const RSVP_CONFIRM_MS = 4000;
const RSVP_LEAVE_MS = 260;

let state: State = {
  // tela inicial escolhida em Ajustes → Geral
  view: getPref<string>("startScreen", "inbox") === "calendar" ? { name: "calendar", mode: "week" } : { name: "inbox", folder: "inbox" },
  lastFolder: "inbox",
  readIds: new Set(),
  rsvp: { value: null, phase: "idle" },
  hiddenCalendars: new Set(),
};

const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Lê um pedaço do estado. O seletor deve devolver um valor estável (campo do estado ou primitivo). */
export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

export const getStore = () => state;

export function navigate(view: View) {
  set(view.name === "inbox" ? { view, lastFolder: view.folder } : { view });
}

/** Volta para a última caixa aberta. */
export function backToFolder() {
  navigate({ name: "inbox", folder: state.lastFolder });
}

export function markRead(id: string) {
  if (state.readIds.has(id)) return;
  set({ readIds: new Set(state.readIds).add(id) });
}

export function markUnread(id: string) {
  if (!state.readIds.has(id)) return;
  const next = new Set(state.readIds);
  next.delete(id);
  set({ readIds: next });
}

let rsvpTimers: number[] = [];
function clearRsvpTimers() {
  rsvpTimers.forEach((t) => window.clearTimeout(t));
  rsvpTimers = [];
}

export function respondInvite(value: Rsvp) {
  clearRsvpTimers();
  set({ rsvp: { value, phase: "confirm" } });
  rsvpTimers.push(
    window.setTimeout(() => set({ rsvp: { value, phase: "leaving" } }), RSVP_CONFIRM_MS),
    window.setTimeout(() => set({ rsvp: { value, phase: "done" } }), RSVP_CONFIRM_MS + RSVP_LEAVE_MS),
  );
}

export function undoInvite() {
  clearRsvpTimers();
  set({ rsvp: { value: null, phase: "idle" } });
}

export function toggleCalendar(id: AccountId | "feriado") {
  const next = new Set(state.hiddenCalendars);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  set({ hiddenCalendars: next });
}
