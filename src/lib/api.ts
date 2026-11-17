import { isTauri } from "./platform";

/** Conta conectada (vem da parte nativa). */
export interface AccountInfo {
  email: string;
  provider: "google" | string;
  messagesTotal?: number | null;
}

/** Resumo de e-mail como a parte nativa devolve (quill-core::gmail::MessageSummary). */
export interface MessageSummaryDto {
  id: string;
  threadId: string;
  from: { name: string; email: string };
  initials: string;
  subject: string;
  preview: string;
  date: string;
  internalDate: number;
  unread: boolean;
  starred: boolean;
  hasAttachment: boolean;
}

/** Erros conhecidos que a parte nativa devolve como texto. */
export const NEEDS_LOGIN = "needs_login";
export const NOT_CONFIGURED = "not_configured";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error("preview");
  // carregado sob demanda: na prévia do navegador o módulo do Tauri nem entra
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Fuso local em minutos (São Paulo = -180). */
const tzOffsetMin = () => -new Date().getTimezoneOffset();

export const api = {
  googleSignIn: (loginHint?: string) => call<AccountInfo>("google_sign_in", { loginHint: loginHint ?? null }),
  accountsList: () => call<AccountInfo[]>("accounts_list"),
  accountRemove: (email: string) => call<void>("account_remove", { email }),
  inbox: (email: string) => call<MessageSummaryDto[]>("inbox_fetch", { email, tzOffsetMin: tzOffsetMin() }),
  body: (email: string, id: string) => call<string>("message_body", { email, id }),
  markRead: (email: string, id: string) => call<void>("message_mark_read", { email, id }),
};

/** Mensagem amigável para um erro vindo da parte nativa. */
export function friendlyError(e: unknown): string {
  const msg = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  if (msg === NOT_CONFIGURED) return "O login com Google ainda não foi configurado nesta versão do Quill.";
  if (msg === NEEDS_LOGIN) return "Essa conta precisa entrar de novo.";
  return msg;
}
