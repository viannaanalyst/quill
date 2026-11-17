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
  to?: { name: string; email: string } | null;
  initials: string;
  subject: string;
  preview: string;
  date: string;
  internalDate: number;
  unread: boolean;
  starred: boolean;
  hasAttachment: boolean;
}

/** E-mail a enviar (quill-core::gmail::OutgoingMessage). */
export interface OutgoingMessage {
  from: string;
  fromName?: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  attachments?: OutAttachment[];
}

/** Anexo recebido (quill-core::gmail::AttachmentInfo). */
export interface AttachmentInfo {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

/** Arquivo anexado para enviar (conteúdo em base64 comum). */
export interface OutAttachment {
  name: string;
  mimeType: string;
  data: string;
}

export type MessageAction = "archive" | "unarchive" | "spam" | "notspam" | "star" | "unstar" | "unread" | "read" | "trash";

/** Erros conhecidos que a parte nativa devolve como texto. */
export const NEEDS_LOGIN = "needs_login";
export const NOT_CONFIGURED = "not_configured";
export const CANCELLED = "cancelled";

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
  googleSignInCancel: () => call<void>("google_sign_in_cancel"),
  googleSignInReopen: () => call<void>("google_sign_in_reopen"),
  googleSignInUrl: () => call<string | null>("google_sign_in_url"),
  accountsList: () => call<AccountInfo[]>("accounts_list"),
  accountRemove: (email: string) => call<void>("account_remove", { email }),
  inbox: (email: string) => call<MessageSummaryDto[]>("inbox_fetch", { email, tzOffsetMin: tzOffsetMin() }),
  folder: (email: string, folder: string) => call<MessageSummaryDto[]>("folder_fetch", { email, folder, tzOffsetMin: tzOffsetMin() }),
  /** busca no Gmail (mesma sintaxe da busca do Gmail), em todas as caixas */
  search: (email: string, q: string) => call<MessageSummaryDto[]>("folder_fetch", { email, folder: `search:${q}`, tzOffsetMin: tzOffsetMin() }),
  counts: (email: string) => call<Record<string, number>>("folder_counts", { email }),
  profile: (email: string) => call<{ name?: string | null; picture?: string | null }>("account_profile", { email }),
  body: (email: string, id: string) => call<{ text: string; attachments: AttachmentInfo[] }>("message_body", { email, id }),
  /** baixa um anexo: "save" (Downloads), "open" (app padrão) ou "preview" (Quick Look) */
  attachment: (email: string, messageId: string, attachmentId: string, name: string, action: "save" | "open" | "preview") =>
    call<string>("attachment_get", { email, messageId, attachmentId, name, action }),
  revealDownload: (path: string) => call<void>("reveal_download", { path }),
  markRead: (email: string, id: string) => call<void>("message_mark_read", { email, id }),
  send: (message: OutgoingMessage, threadId?: string) => call<string>("message_send", { message, threadId: threadId ?? null }),
  action: (email: string, id: string, action: MessageAction) => call<void>("message_action", { email, id, action }),
};

/** Mensagem amigável para um erro vindo da parte nativa. */
export function friendlyError(e: unknown): string {
  const msg = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  if (msg === NOT_CONFIGURED) return "O login com Google ainda não foi configurado nesta versão do Quill.";
  if (msg === NEEDS_LOGIN) return "Essa conta precisa entrar de novo.";
  if (msg === CANCELLED) return "Login cancelado. Tente de novo quando quiser.";
  return msg;
}
