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
  /** imagem embutida no texto (cid:) */
  contentId?: string | null;
}

/** Arquivo anexado para enviar (conteúdo em base64 comum). */
export interface OutAttachment {
  name: string;
  mimeType: string;
  data: string;
}

/** Rascunho do Gmail aberto para editar (draft_get). */
export interface DraftContent {
  draftId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html?: string | null;
  text: string;
}

/** Servidores de uma conta iCloud/IMAP (quill-core::imap::ImapConfig). A senha vai à parte. */
export interface ImapConfig {
  email: string;
  name?: string | null;
  provider: "icloud" | "imap";
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /** vazio = pela porta (465 → TLS, outras → STARTTLS) */
  smtpSecurity?: "tls" | "starttls" | null;
  /** vazio = o próprio e-mail */
  username: string;
}

/** Palpite de servidores (quill-core::imap_client::Guess). */
export interface ImapGuess {
  config: ImapConfig | null;
  source: "known" | "mx" | "generic";
  label?: string | null;
  hint?: string | null;
}

/* ---------- Google Chat (quill-core::chat) ---------- */
export interface ChatPersonDto {
  id: string;
  name: string;
  photo?: string | null;
  email?: string | null;
  bot: boolean;
}
export interface ChatAttachmentDto {
  name: string;
  contentType?: string | null;
  /** arquivo enviado ao Chat: conteúdo por chat_attachment */
  resourceName?: string | null;
  /** arquivo do Google Drive: abre no navegador */
  driveUrl?: string | null;
}
export interface ChatMessageDto {
  name: string;
  text: string;
  formattedText?: string | null;
  sender: ChatPersonDto;
  mine: boolean;
  createTime: string;
  createMs: number;
  thread?: string | null;
  threadReply: boolean;
  attachments: ChatAttachmentDto[];
  deleted: boolean;
}
export interface ChatPageDto {
  messages: ChatMessageDto[];
  nextPageToken?: string | null;
}
export interface ChatSpaceDto {
  name: string;
  kind: "space" | "group" | "dm";
  title: string;
  photo?: string | null;
  email?: string | null;
  lastActiveTime?: string | null;
  lastActiveMs: number;
  lastMessage?: { text: string; senderName?: string | null; mine: boolean; createMs: number } | null;
  /** horário das últimas mensagens dos outros (até 10), para contar as não lidas */
  recentMs: number[];
  /** até 3 pessoas da conversa (a API não tem ícone de espaço): fotos empilhadas */
  faces: ChatPersonDto[];
  /** pessoas na conversa */
  memberCount?: number | null;
  /** link para abrir no Google Chat */
  uri?: string | null;
}
/** Arquivo já enviado ao Chat (attachments:upload), para pôr na mensagem. */
export interface ChatAttachmentRef {
  resourceName?: string | null;
  attachmentUploadToken?: string | null;
}

export type MessageAction = "archive" | "unarchive" | "spam" | "notspam" | "star" | "unstar" | "unread" | "read" | "trash" | "untrash";

/** Erros conhecidos que a parte nativa devolve como texto. */
export const NEEDS_LOGIN = "needs_login";
export const NOT_CONFIGURED = "not_configured";
export const CANCELLED = "cancelled";
/** Erros do Chat: falta a permissão (entrar de novo), app de Chat não configurado, conta sem Workspace. */
export const CHAT_PERMISSION = "chat_permission";
export const CHAT_NOT_CONFIGURED = "chat_not_configured";
export const CHAT_NOT_WORKSPACE = "chat_not_workspace";

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
  body: (email: string, id: string) => call<{ text: string; html?: string | null; attachments: AttachmentInfo[] }>("message_body", { email, id }),
  /** abre link (http, https, mailto) no navegador */
  openLink: (url: string) => call<void>("open_link", { url }),
  /** baixa um anexo: "save" (Downloads), "open" (app padrão) ou "preview" (Quick Look) */
  attachment: (email: string, messageId: string, attachmentId: string, name: string, action: "save" | "open" | "preview") =>
    call<string>("attachment_get", { email, messageId, attachmentId, name, action }),
  attachmentData: (email: string, messageId: string, attachmentId: string) => call<string>("attachment_data", { email, messageId, attachmentId }),
  revealDownload: (path: string) => call<void>("reveal_download", { path }),
  markRead: (email: string, id: string) => call<void>("message_mark_read", { email, id }),
  send: (message: OutgoingMessage, threadId?: string) => call<string>("message_send", { message, threadId: threadId ?? null }),
  /** cria (sem draftId) ou atualiza o rascunho no Gmail; devolve o id do rascunho */
  draftSave: (message: OutgoingMessage, draftId?: string | null, threadId?: string | null) =>
    call<string>("draft_save", { message, draftId: draftId ?? null, threadId: threadId ?? null }),
  draftDelete: (email: string, draftId: string) => call<void>("draft_delete", { email, draftId }),
  /** conteúdo de um rascunho a partir do id da mensagem (lista Rascunhos) */
  draftGet: (email: string, messageId: string) => call<DraftContent>("draft_get", { email, messageId }),
  action: (email: string, id: string, action: MessageAction) => call<void>("message_action", { email, id, action }),
  /** palpite de servidores IMAP/SMTP para um e-mail (domínio conhecido, MX ou imap./smtp.<domínio>) */
  imapGuess: (email: string, provider: "icloud" | "imap") => call<ImapGuess>("imap_guess", { email, provider }),
  /** testa IMAP e SMTP e, se der certo, guarda a senha nas Chaves do sistema e conecta a conta */
  imapConnect: (config: ImapConfig, password: string) => call<AccountInfo>("imap_connect", { config, password }),
  /** conversas do Google Chat (só contas Workspace), mais recentes primeiro */
  chatSpaces: (email: string) => call<ChatSpaceDto[]>("chat_spaces", { email }),
  /** mensagens da mais antiga para a mais nova; pageToken busca as anteriores */
  chatMessages: (email: string, space: string, pageToken?: string | null) => call<ChatPageDto>("chat_messages", { email, space, pageToken: pageToken ?? null }),
  /** pessoas da conversa (a própria conta por último, como "Você") */
  chatMembers: (email: string, space: string) => call<ChatPersonDto[]>("chat_members", { email, space }),
  chatSend: (email: string, space: string, text: string, thread?: string | null, attachments?: ChatAttachmentRef[]) =>
    call<ChatMessageDto>("chat_send", { email, space, text, thread: thread ?? null, attachments: attachments ?? null }),
  /** conteúdo de um anexo do Chat em base64 (até 50 MB) */
  chatAttachment: (email: string, resourceName: string) => call<string>("chat_attachment", { email, resourceName }),
  /** baixa um anexo do Chat para Downloads ("save") ou baixa e abre ("open"); devolve o caminho */
  chatAttachmentSave: (email: string, resourceName: string, name: string, action: "save" | "open") =>
    call<string>("chat_attachment_save", { email, resourceName, name, action }),
};

/**
 * Envia um arquivo para uma conversa do Chat sem passar por base64: o conteúdo vai cru no corpo do
 * pedido e os dados nos cabeçalhos. `onProgress` recebe de 0 a 1 enquanto o arquivo sobe.
 */
export async function chatUpload(email: string, space: string, file: Blob, name: string, type: string, onProgress: (p: number) => void): Promise<ChatAttachmentRef> {
  if (!isTauri) throw new Error("preview");
  const [{ invoke }, { listen }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")]);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const stop = await listen<{ id: string; sent: number; total: number }>("chat-upload-progress", (e) => {
    if (e.payload.id === id && e.payload.total > 0) onProgress(e.payload.sent / e.payload.total);
  });
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return await invoke<ChatAttachmentRef>("chat_upload", bytes, {
      headers: {
        "x-quill-email": encodeURIComponent(email),
        "x-quill-space": encodeURIComponent(space),
        "x-quill-name": encodeURIComponent(name),
        "x-quill-type": encodeURIComponent(type),
        "x-quill-upload": id,
      },
    });
  } finally {
    stop();
  }
}

/** Mensagem amigável para um erro vindo da parte nativa. */
export function friendlyError(e: unknown): string {
  const msg = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  if (msg === NOT_CONFIGURED) return "O login com Google ainda não foi configurado nesta versão do Quill.";
  if (msg === NEEDS_LOGIN) return "Essa conta precisa entrar de novo.";
  if (msg === CANCELLED) return "Login cancelado. Tente de novo quando quiser.";
  if (msg === CHAT_PERMISSION) return "Entre de novo com a conta para liberar o Chat.";
  if (msg === CHAT_NOT_CONFIGURED) return "O Google Chat ainda não foi liberado para o Quill no Google Cloud.";
  if (msg === CHAT_NOT_WORKSPACE) return "O Google Chat funciona com contas do Google Workspace (empresa).";
  return msg;
}
