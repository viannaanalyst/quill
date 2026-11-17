import { useSyncExternalStore } from "react";
import {
  api,
  chatUpload,
  CHAT_NOT_CONFIGURED,
  CHAT_NOT_WORKSPACE,
  CHAT_PERMISSION,
  friendlyError,
  NEEDS_LOGIN,
  NOT_CONFIGURED,
  type ChatAttachmentRef,
  type ChatMessageDto,
  type ChatPersonDto,
  type ChatSpaceDto,
} from "../lib/api";
import { devParams, isTauri } from "../lib/platform";
import { getPref, setPref } from "../lib/storage";
import { getMailbox, onMailboxLoaded } from "./mailbox";
import { getStore } from "./store";

/**
 * Google Chat das contas Workspace: conversas, mensagens, envio (com anexos e áudio) e não lidas.
 * As não lidas são controladas no app: guardamos quando cada conversa foi vista
 * (`quill.chat.seen`) e comparamos com a atividade que a API devolve.
 * Na prévia do navegador usa as conversas de exemplo (src/chat/sample.ts).
 */

type Status = "idle" | "loading" | "ready" | "error";
/** Avisos com tela própria. */
export type ChatProblem = "permission" | "needs_login" | "not_configured" | "not_workspace" | null;

export interface PendingFile {
  id: string;
  file: Blob;
  name: string;
  type: string;
  size: number;
  /** 0 a 1 enquanto sobe */
  progress: number;
  ref?: ChatAttachmentRef;
  /** já saiu numa mensagem (não reenvia ao tentar de novo) */
  sent?: boolean;
  /** miniatura local (imagem ou vídeo) */
  thumb?: string;
}

/** Mensagem que ainda está saindo (aparece na hora, com "enviando" ou erro). */
export interface Outgoing {
  id: string;
  account: string;
  space: string;
  text: string;
  textSent?: boolean;
  thread?: string | null;
  files: PendingFile[];
  status: "sending" | "error";
  error?: string;
  createMs: number;
}

interface ChatState {
  account: string | null;
  spaces: ChatSpaceDto[];
  status: Status;
  problem: ChatProblem;
  error: string | null;
  messages: Record<string, ChatMessageDto[]>;
  next: Record<string, string | null>;
  msgStatus: Record<string, Status>;
  msgError: Record<string, string | null>;
  olderLoading: boolean;
  members: Record<string, ChatPersonDto[]>;
  outgoing: Outgoing[];
  /** `${conta}|${conversa}` → até quando foi vista (ms) */
  seen: Record<string, number>;
  /** `${conta}|${conversa}` fixadas pela pessoa */
  pinned: string[];
}

const SEEN_PREF = "chat.seen";
const PINNED_PREF = "chat.pinned";
const ACCOUNT_PREF = "chat.account";

let state: ChatState = {
  account: null,
  spaces: [],
  status: "idle",
  problem: null,
  error: null,
  messages: {},
  next: {},
  msgStatus: {},
  msgError: {},
  olderLoading: false,
  members: {},
  outgoing: [],
  seen: getPref<Record<string, number>>(SEEN_PREF, {}),
  pinned: getPref<string[]>(PINNED_PREF, []),
};
const listeners = new Set<() => void>();
function set(patch: Partial<ChatState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

/** Lê um pedaço do Chat. O seletor deve devolver um valor estável (campo do estado ou primitivo). */
export function useChat<T>(selector: (s: ChatState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}
export const getChat = () => state;

const key = (space: string, account = state.account ?? "") => `${account}|${space}`;
const isConsumer = (email: string) => /@(gmail|googlemail)\.com$/i.test(email);

/* ---------- prévia ---------- */
type Sample = typeof import("../chat/sample");
let sample: Sample | null = null;
const loadSample = async () => (sample ??= await import("../chat/sample"));
/** Prévia: ?chat=none mostra a tela sem conta Workspace. */
const previewNone = !isTauri && devParams.get("chat") === "none";

/** Contas Google Workspace conectadas (as que têm Chat). */
export function workspaceAccounts(): string[] {
  if (!isTauri) return previewNone ? [] : ["voce@empresa.com.br", "voce@estudio.com.br"];
  return getMailbox()
    .connected.filter((a) => a.provider === "google" && !isConsumer(a.email))
    .map((a) => a.email);
}

function problemOf(e: unknown): ChatProblem {
  const msg = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  if (msg === CHAT_PERMISSION) return "permission";
  if (msg === NEEDS_LOGIN) return "needs_login";
  if (msg === CHAT_NOT_CONFIGURED || msg === NOT_CONFIGURED) return "not_configured";
  if (msg === CHAT_NOT_WORKSPACE) return "not_workspace";
  return null;
}

function pickAccount(): string | null {
  const list = workspaceAccounts();
  if (state.account && list.includes(state.account)) return state.account;
  const saved = getPref<string | null>(ACCOUNT_PREF, null);
  return saved && list.includes(saved) ? saved : (list[0] ?? null);
}

/** Troca a conta do Chat (quando há mais de uma conta Workspace). */
export function selectAccount(email: string) {
  if (email === state.account) return;
  setPref(ACCOUNT_PREF, email);
  set({ account: email, spaces: [], status: "idle", problem: null, error: null, messages: {}, next: {}, msgStatus: {}, members: {} });
  void loadSpaces();
}

/** Primeira vez que a conta abre o Chat: o que já existe conta como lido (não aparece tudo em negrito). */
function baseline(account: string, spaces: ChatSpaceDto[]) {
  const flag = `chat.baseline.${account}`;
  if (getPref(flag, false)) return;
  const seen = { ...state.seen };
  for (const s of spaces) seen[key(s.name, account)] = Math.max(seen[key(s.name, account)] ?? 0, s.lastActiveMs);
  setPref(SEEN_PREF, seen);
  setPref(flag, true);
  set({ seen });
}

let spacesBusy = false;
/** Busca as conversas da conta escolhida. `silent` não mostra carregando nem apaga a lista. */
export async function loadSpaces(silent = false) {
  const account = pickAccount();
  if (!account) {
    set({ account: null, spaces: [], status: "ready" });
    return;
  }
  if (spacesBusy) return;
  spacesBusy = true;
  if (account !== state.account) set({ account });
  if (!silent || state.status !== "ready") set({ status: state.spaces.length ? state.status : "loading" });
  try {
    if (!isTauri) {
      const s = await loadSample();
      if (Object.keys(state.seen).length === 0) set({ seen: s.sampleSeen(account) });
      set({ spaces: s.sampleSpaces(), status: "ready", problem: null, error: null, pinned: state.pinned.length ? state.pinned : s.samplePinned(account) });
      return;
    }
    const spaces = await api.chatSpaces(account);
    baseline(account, spaces);
    set({ spaces, status: "ready", problem: null, error: null });
  } catch (e) {
    const problem = problemOf(e);
    set({ status: "error", problem, error: problem ? null : friendlyError(e) });
  } finally {
    spacesBusy = false;
  }
}

/** Junta uma página nova às mensagens já carregadas (sem repetir), em ordem de horário. */
export function mergeMessages(old: ChatMessageDto[], incoming: ChatMessageDto[]): ChatMessageDto[] {
  const byName = new Map(old.map((m) => [m.name, m]));
  for (const m of incoming) byName.set(m.name, m);
  return [...byName.values()].toSorted((a, b) => a.createMs - b.createMs);
}

/** Mensagens mais novas da conversa (a primeira página), juntando com as que já estavam. */
export async function loadMessages(space: string) {
  const account = state.account;
  if (!account) return;
  const first = !state.messages[space];
  if (first) set({ msgStatus: { ...state.msgStatus, [space]: "loading" } });
  try {
    const page = isTauri ? await api.chatMessages(account, space) : (await loadSample()).samplePage(space);
    if (state.account !== account) return;
    set({
      messages: { ...state.messages, [space]: mergeMessages(state.messages[space] ?? [], page.messages) },
      next: first ? { ...state.next, [space]: page.nextPageToken ?? null } : state.next,
      msgStatus: { ...state.msgStatus, [space]: "ready" },
      msgError: { ...state.msgError, [space]: null },
    });
    markSeen(space);
  } catch (e) {
    const problem = problemOf(e);
    if (problem) set({ problem });
    if (first) set({ msgStatus: { ...state.msgStatus, [space]: "error" }, msgError: { ...state.msgError, [space]: friendlyError(e) } });
  }
}

/** "Carregar anteriores": a página seguinte (mais antiga). */
export async function loadOlder(space: string) {
  const account = state.account;
  const token = state.next[space];
  if (!account || !token || state.olderLoading) return;
  set({ olderLoading: true });
  try {
    const page = await api.chatMessages(account, space, token);
    set({
      messages: { ...state.messages, [space]: mergeMessages(state.messages[space] ?? [], page.messages) },
      next: { ...state.next, [space]: page.nextPageToken ?? null },
    });
  } catch (e) {
    const { toast } = await import("../components/Toasts");
    toast(`Não consegui carregar as anteriores: ${friendlyError(e)}`, "error");
  } finally {
    set({ olderLoading: false });
  }
}

/** Pessoas da conversa (para o cabeçalho), uma vez por conversa. */
export async function loadMembers(space: string) {
  const account = state.account;
  if (!account || state.members[space]) return;
  try {
    const list = isTauri ? await api.chatMembers(account, space) : (await loadSample()).sampleMembers(space);
    set({ members: { ...state.members, [space]: list } });
  } catch {
    /* sem a lista, o cabeçalho mostra só o nome */
  }
}

/** Marca a conversa como vista até a mensagem mais nova (só com a janela à vista). */
export function markSeen(space: string) {
  // a prévia não guarda nada (mantém as não lidas do desenho)
  if (!isTauri) return;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  const s = state.spaces.find((x) => x.name === space);
  const newest = state.messages[space]?.at(-1)?.createMs ?? 0;
  const until = Math.max(s?.lastActiveMs ?? 0, newest);
  const k = key(space);
  if ((state.seen[k] ?? 0) >= until) return;
  const seen = { ...state.seen, [k]: until };
  setPref(SEEN_PREF, seen);
  set({ seen });
}

/** Quantas mensagens dos outros chegaram depois da última vez que a conversa foi vista (10 = "9+"). */
export function unreadCount(s: ChatState, space: ChatSpaceDto): number {
  const seen = s.seen[key(space.name, s.account ?? "")] ?? 0;
  if (space.lastActiveMs <= seen) return 0;
  if (space.lastMessage?.mine) return 0;
  const fromList = space.recentMs.filter((t) => t > seen).length;
  const loaded = s.messages[space.name]?.filter((m) => !m.mine && !m.deleted && m.createMs > seen).length ?? 0;
  return Math.max(fromList, loaded, 1);
}

/** Conversas com mensagens não lidas (para o título e a bolinha da barra lateral). */
export const unreadSpaces = (s: ChatState) => s.spaces.filter((sp) => unreadCount(s, sp) > 0).length;

export const isPinned = (s: ChatState, space: string) => s.pinned.includes(key(space, s.account ?? ""));

/** Fixa ou solta uma conversa (guardado só neste computador; a API não diz o que está fixado no Google Chat). */
export function togglePin(space: string) {
  const k = key(space);
  const pinned = state.pinned.includes(k) ? state.pinned.filter((p) => p !== k) : [...state.pinned, k];
  setPref(PINNED_PREF, pinned);
  set({ pinned });
}

/* ---------- envio ---------- */
let seq = 0;
const uid = () => `o${Date.now()}-${++seq}`;

function patchOutgoing(id: string, patch: Partial<Outgoing> | ((o: Outgoing) => Partial<Outgoing>)) {
  set({ outgoing: state.outgoing.map((o) => (o.id === id ? { ...o, ...(typeof patch === "function" ? patch(o) : patch) } : o)) });
}
function patchFile(id: string, fileId: string, patch: Partial<PendingFile>) {
  patchOutgoing(id, (o) => ({ files: o.files.map((f) => (f.id === fileId ? { ...f, ...patch } : f)) }));
}

/** Arquivo novo para enviar (com miniatura local quando é imagem). */
export function pendingFile(file: Blob, name: string, type = file.type || "application/octet-stream"): PendingFile {
  const thumb = type.startsWith("image/") || type.startsWith("video/") ? URL.createObjectURL(file) : undefined;
  return { id: uid(), file, name, type, size: file.size, progress: 0, thumb };
}

/** Prévia: finge o envio com uma barrinha que anda. */
function fakeUpload(onProgress: (p: number) => void): Promise<ChatAttachmentRef> {
  return new Promise((resolve) => {
    let p = 0;
    const t = window.setInterval(() => {
      p = Math.min(1, p + 0.12);
      onProgress(p);
      if (p >= 1) {
        window.clearInterval(t);
        resolve({ attachmentUploadToken: "previa" });
      }
    }, 180);
  });
}

function addSent(space: string, m: ChatMessageDto) {
  const messages = { ...state.messages, [space]: mergeMessages(state.messages[space] ?? [], [m]) };
  const spaces = state.spaces
    .map((s) =>
      s.name === space
        ? {
            ...s,
            lastActiveMs: Math.max(s.lastActiveMs, m.createMs),
            lastMessage: { text: m.text || (m.attachments[0] ? `Anexo: ${m.attachments[0].name}` : ""), mine: true, createMs: m.createMs },
          }
        : s,
    )
    .toSorted((a, b) => b.lastActiveMs - a.lastActiveMs);
  set({ messages, spaces });
}

async function run(id: string) {
  const o = state.outgoing.find((x) => x.id === id);
  if (!o) return;
  patchOutgoing(id, { status: "sending", error: undefined });
  try {
    for (const f of o.files) {
      if (f.ref || f.sent) continue;
      const onProgress = (p: number) => patchFile(id, f.id, { progress: p });
      const ref = isTauri ? await chatUpload(o.account, o.space, f.file, f.name, f.type, onProgress) : await fakeUpload(onProgress);
      patchFile(id, f.id, { ref, progress: 1 });
    }
    const cur = () => state.outgoing.find((x) => x.id === id)!;
    const send = async (text: string, refs: ChatAttachmentRef[], file?: PendingFile): Promise<ChatMessageDto> => {
      if (isTauri) return api.chatSend(o.account, o.space, text, o.thread, refs);
      return (await loadSample()).sampleSent(o.space, text, o.thread ?? null, file ? [{ name: file.name, contentType: file.type, resourceName: `local:${file.id}` }] : []);
    };
    const files = cur().files.filter((f) => !f.sent);
    if (files.length === 0 && !cur().textSent) {
      addSent(o.space, await send(o.text, []));
    }
    // um arquivo por mensagem (o texto vai junto com o primeiro)
    for (const f of files) {
      const text = cur().textSent ? "" : o.text;
      const m = await send(text, [f.ref!], f);
      if (!isTauri && f.file) (await import("../chat/media")).rememberLocal(`local:${f.id}`, f.file);
      patchOutgoing(id, { textSent: true });
      patchFile(id, f.id, { sent: true });
      addSent(o.space, m);
    }
    const done = state.outgoing.find((x) => x.id === id);
    done?.files.forEach((f) => f.thumb && URL.revokeObjectURL(f.thumb));
    set({ outgoing: state.outgoing.filter((x) => x.id !== id) });
    markSeen(o.space);
  } catch (e) {
    patchOutgoing(id, { status: "error", error: friendlyError(e) });
  }
}

/** Envia texto e/ou arquivos na conversa; aparece na hora, com "enviando" e, se falhar, "Tentar de novo". */
export function sendChat(space: string, text: string, files: PendingFile[], thread?: string | null) {
  const account = state.account;
  if (!account || (!text.trim() && files.length === 0)) return;
  const o: Outgoing = { id: uid(), account, space, text: text.trim(), thread: thread ?? null, files, status: "sending", createMs: Date.now() };
  set({ outgoing: [...state.outgoing, o] });
  void run(o.id);
}

export const retryOutgoing = (id: string) => void run(id);

export function discardOutgoing(id: string) {
  state.outgoing.find((x) => x.id === id)?.files.forEach((f) => f.thumb && URL.revokeObjectURL(f.thumb));
  set({ outgoing: state.outgoing.filter((x) => x.id !== id) });
}

/* ---------- atualização ---------- */
/** Com o app atualizando os e-mails (a cada 3 min), a lista do Chat também atualiza (bolinha da barra lateral). */
onMailboxLoaded(() => {
  if (isTauri && workspaceAccounts().length > 0 && getStore().view.name !== "chat") return loadSpaces(true);
});
