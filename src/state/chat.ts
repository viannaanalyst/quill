import { notify } from "../lib/notify";
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
  type ChatQuoteDto,
  type ChatQuoteRef,
  type ChatPersonDto,
  type ChatSpaceDto,
} from "../lib/api";
import { devParams, isTauri } from "../lib/platform";
import { getPref, setPref } from "../lib/storage";
import { getMailbox, onMailboxLoaded } from "./mailbox";
import { getStore } from "./store";
export { quickReactions } from "../chat/reactions";

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
/** Mensagem que vai ser citada: o que a API pede e o cartão que aparece enquanto envia. */
export interface QuoteDraft {
  ref: ChatQuoteRef;
  preview: ChatQuoteDto;
}

/** Cartão de citação a partir de uma mensagem carregada. */
export function quoteOf(m: ChatMessageDto): QuoteDraft {
  return {
    ref: { name: m.name, lastUpdateTime: m.updateTime || m.createTime },
    preview: { name: m.name, sender: m.mine ? { ...m.sender, name: "Você" } : m.sender, text: m.text || (m.attachments[0] ? `Anexo: ${m.attachments[0].name}` : "") },
  };
}

export interface Outgoing {
  id: string;
  account: string;
  space: string;
  text: string;
  textSent?: boolean;
  thread?: string | null;
  /** mensagem citada: vai junto com o texto (ou com o primeiro arquivo) */
  quote?: QuoteDraft | null;
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
  /** `${conta}|${mensagem}` → emojis com que você reagiu (a API só diz a contagem, não quem reagiu) */
  reacted: Record<string, string[]>;
  /** mensagens saindo da tela (animação de apagar) */
  removing: string[];
  /** emoji → quantas vezes você reagiu com ele (as 3 mais usadas aparecem na barra da mensagem) */
  reactionUse: Record<string, number>;
}

const SEEN_PREF = "chat.seen";
const PINNED_PREF = "chat.pinned";
const REACTED_PREF = "chat.reacted";
const ACCOUNT_PREF = "chat.account";
const REACTION_USE_PREF = "chat.reactionUse";

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
  reacted: getPref<Record<string, string[]>>(REACTED_PREF, {}),
  removing: [],
  reactionUse: getPref<Record<string, number>>(REACTION_USE_PREF, {}),
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

/** Aviso de mensagem nova: conversas cuja atividade avançou, com a última mensagem de outra pessoa. */
let announcedFor: string | null = null;
function announceNewChat(account: string, before: ChatSpaceDto[], after: ChatSpaceDto[]) {
  // primeira lista desta conta: só registra
  if (announcedFor !== account || before.length === 0) {
    announcedFor = account;
    return;
  }
  const prev = new Map(before.map((sp) => [sp.name, sp.lastActiveMs]));
  const view = getStore().view;
  for (const sp of after) {
    const was = prev.get(sp.name) ?? 0;
    if (sp.lastActiveMs <= was || !sp.lastMessage || sp.lastMessage.mine) continue;
    // a conversa já está aberta na tela, com o Quill na frente: não precisa avisar
    if (view.name === "chat" && view.space === sp.name && document.hasFocus()) continue;
    const who = sp.lastMessage.senderName;
    void notify("chat", sp.title, `${who && sp.kind !== "dm" ? `${who}: ` : ""}${sp.lastMessage.text || "Enviou um anexo"}`);
  }
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
      if (Object.keys(state.reacted).length === 0) set({ reacted: s.sampleReacted(account) });
      set({ spaces: s.sampleSpaces(), status: "ready", problem: null, error: null, pinned: state.pinned.length ? state.pinned : s.samplePinned(account) });
      return;
    }
    const spaces = await api.chatSpaces(account);
    baseline(account, spaces);
    announceNewChat(account, state.spaces, spaces);
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
      // a citação vai na mensagem que leva o texto (ou no primeiro arquivo, quando não há texto)
      const quote = !cur().textSent ? o.quote : null;
      if (isTauri) return api.chatSend(o.account, o.space, text, o.thread, refs, quote?.ref);
      const local = file ? [{ name: file.name, contentType: file.type, resourceName: `local:${file.id}` }] : [];
      return (await loadSample()).sampleSent(o.space, text, o.thread ?? null, local, quote?.preview);
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
export function sendChat(space: string, text: string, files: PendingFile[], thread?: string | null, quote?: QuoteDraft | null) {
  const account = state.account;
  if (!account || (!text.trim() && files.length === 0)) return;
  const o: Outgoing = { id: uid(), account, space, text: text.trim(), thread: thread ?? null, quote: quote ?? null, files, status: "sending", createMs: Date.now() };
  set({ outgoing: [...state.outgoing, o] });
  void run(o.id);
}

export const retryOutgoing = (id: string) => void run(id);

export function discardOutgoing(id: string) {
  state.outgoing.find((x) => x.id === id)?.files.forEach((f) => f.thumb && URL.revokeObjectURL(f.thumb));
  set({ outgoing: state.outgoing.filter((x) => x.id !== id) });
}

/* ---------- reações, editar e apagar ---------- */
/** Quantas mensagens com reação sua o app lembra (as mais antigas saem). */
const MAX_REACTED = 2000;

/** Emojis com que você reagiu nesta mensagem (só os que a mensagem ainda mostra). */
export function myReactions(s: ChatState, m: ChatMessageDto): string[] {
  const list = s.reacted[key(m.name, s.account ?? "")];
  return list ? list.filter((e) => m.reactions.some((r) => r.emoji === e)) : [];
}

function patchMessage(space: string, name: string, f: (m: ChatMessageDto) => ChatMessageDto) {
  const list = state.messages[space];
  if (!list) return;
  set({ messages: { ...state.messages, [space]: list.map((m) => (m.name === name ? f(m) : m)) } });
}

function setReacted(k: string, emojis: string[]) {
  const reacted = { ...state.reacted };
  delete reacted[k];
  if (emojis.length) reacted[k] = emojis;
  const keys = Object.keys(reacted);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_REACTED))) delete reacted[old];
  setPref(REACTED_PREF, reacted);
  set({ reacted });
}

/** Soma (ou tira) uma reação na contagem da mensagem. */
export function bumpReaction(m: ChatMessageDto, emoji: string, delta: 1 | -1): ChatMessageDto {
  const has = m.reactions.some((r) => r.emoji === emoji);
  const reactions = has
    ? m.reactions.flatMap((r) => (r.emoji !== emoji ? [r] : r.count + delta > 0 ? [{ ...r, count: r.count + delta }] : []))
    : delta > 0
      ? [...m.reactions, { emoji, count: 1 }]
      : m.reactions;
  return { ...m, reactions };
}

const busyReactions = new Set<string>();

/** Conta mais um uso do emoji (para as reações rápidas da barra da mensagem). */
function countReactionUse(emoji: string) {
  const reactionUse = { ...state.reactionUse, [emoji]: (state.reactionUse[emoji] ?? 0) + 1 };
  // só os 40 mais usados ficam guardados
  const keep = Object.entries(reactionUse).toSorted((a, b) => b[1] - a[1]).slice(0, 40);
  const trimmed = Object.fromEntries(keep);
  setPref(REACTION_USE_PREF, trimmed);
  set({ reactionUse: trimmed });
}

/** Reage com o emoji ou, se a reação já é sua, tira. A tela muda na hora e volta se der erro. */
export async function toggleReaction(space: string, message: ChatMessageDto, emoji: string) {
  const account = state.account;
  if (!account) return;
  const k = key(message.name, account);
  const busy = `${k}|${emoji}`;
  if (busyReactions.has(busy)) return;
  busyReactions.add(busy);
  const before = state.reacted[k] ?? [];
  const cur = state.messages[space]?.find((m) => m.name === message.name) ?? message;
  const removing = myReactions(state, cur).includes(emoji);
  patchMessage(space, message.name, (m) => bumpReaction(m, emoji, removing ? -1 : 1));
  setReacted(k, removing ? before.filter((e) => e !== emoji) : [...before.filter((e) => e !== emoji), emoji]);
  if (!removing) countReactionUse(emoji);
  try {
    if (!isTauri) {
      (await loadSample()).sampleReact(space, message.name, emoji, !removing);
    } else if (removing) {
      await api.chatUnreact(account, message.name, emoji);
    } else if (!(await api.chatReact(account, message.name, emoji))) {
      // você já tinha reagido com ele (em outro aparelho): a contagem já incluía você
      patchMessage(space, message.name, (m) => bumpReaction(m, emoji, -1));
    }
  } catch (e) {
    patchMessage(space, message.name, (m) => bumpReaction(m, emoji, removing ? 1 : -1));
    setReacted(k, before);
    const { toast } = await import("../components/Toasts");
    toast(`${removing ? "Não consegui tirar a reação" : "Não consegui reagir"}: ${friendlyError(e)}`, "error");
  } finally {
    busyReactions.delete(busy);
  }
}

/** Troca o texto de uma mensagem sua. Devolve se deu certo (com erro, o texto antigo volta). */
export async function editMessage(space: string, message: ChatMessageDto, text: string): Promise<boolean> {
  const account = state.account;
  const clean = text.trim();
  if (!account || !clean) return false;
  if (clean === message.text.trim()) return true;
  const old = { text: message.text, edited: message.edited, formattedText: message.formattedText };
  patchMessage(space, message.name, (m) => ({ ...m, text: clean, formattedText: null, edited: true }));
  try {
    const saved = isTauri ? await api.chatEdit(account, message.name, clean) : (await loadSample()).sampleEdit(space, message.name, clean);
    // a reação pode ter mudado enquanto salvava: mantém a da tela
    patchMessage(space, message.name, (m) => ({ ...saved, reactions: m.reactions, edited: true }));
    syncPreview(space, message);
    return true;
  } catch (e) {
    patchMessage(space, message.name, (m) => ({ ...m, ...old }));
    const { toast } = await import("../components/Toasts");
    toast(`Não consegui editar: ${friendlyError(e)}`, "error");
    return false;
  }
}

/** Quanto dura a saída da mensagem apagada (igual ao CSS de .chat-gone). */
const REMOVE_MS = 180;

/** Apaga uma mensagem sua (a confirmação fica na tela). A mensagem sai com animação; com erro, volta. */
export async function deleteMessage(space: string, message: ChatMessageDto): Promise<boolean> {
  const account = state.account;
  if (!account) return false;
  set({ removing: [...state.removing, message.name] });
  const started = Date.now();
  try {
    if (isTauri) await api.chatDelete(account, message.name);
    else (await loadSample()).sampleDelete(space, message.name);
    await new Promise((r) => window.setTimeout(r, Math.max(0, REMOVE_MS - (Date.now() - started))));
    const list = state.messages[space] ?? [];
    set({ messages: { ...state.messages, [space]: list.filter((m) => m.name !== message.name) } });
    syncPreview(space, message);
    return true;
  } catch (e) {
    const { toast } = await import("../components/Toasts");
    toast(`Não consegui apagar: ${friendlyError(e)}`, "error");
    return false;
  } finally {
    set({ removing: state.removing.filter((n) => n !== message.name) });
  }
}

/** Se a mensagem editada ou apagada era a última da lista, a prévia passa a mostrar a mais nova que sobrou. */
function syncPreview(space: string, changed: ChatMessageDto) {
  const last = state.messages[space]?.at(-1);
  set({
    spaces: state.spaces.map((s) => {
      if (s.name !== space || !s.lastMessage || changed.createMs < s.lastMessage.createMs) return s;
      if (!last) return { ...s, lastMessage: null };
      const text = last.deleted ? "Mensagem apagada" : last.text || (last.attachments[0] ? `Anexo: ${last.attachments[0].name}` : "");
      const senderName = last.mine || s.kind === "dm" ? null : (last.sender.name.split(/\s+/)[0] ?? null);
      return { ...s, lastMessage: { text, senderName, mine: last.mine, createMs: last.createMs } };
    }),
  });
}

/* ---------- atualização ---------- */
/** Com o app atualizando os e-mails (a cada 3 min), a lista do Chat também atualiza (bolinha da barra lateral). */
onMailboxLoaded(() => {
  if (isTauri && workspaceAccounts().length > 0 && getStore().view.name !== "chat") return loadSpaces(true);
});
