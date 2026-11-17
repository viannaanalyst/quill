import { useSyncExternalStore } from "react";
import { api, friendlyError, NEEDS_LOGIN, type AccountInfo, type AttachmentInfo, type ImapConfig, type MessageAction, type MessageSummaryDto, type OutgoingMessage } from "../lib/api";
import { isTauri } from "../lib/platform";
import { getPref } from "../lib/storage";
import { isAutomatedSender, notify } from "../lib/notify";
import { ACCOUNTS, MESSAGES } from "../inbox/sampleData";
import type { Account, Message } from "../inbox/types";
import type { LogoName } from "../components/Logo";
import { toast } from "../components/Toasts";
import { getStore } from "./store";

/**
 * Fonte dos e-mails das telas. Com conta conectada (app), usa o Gmail de verdade, caixa por caixa;
 * na prévia do navegador mostra os dados de exemplo; no app sem conta, nada.
 */
type Status = "idle" | "loading" | "ready" | "error";
export type FolderId = "inbox" | "starred" | "sent" | "drafts" | "archive" | "spam" | "trash";

export interface Profile {
  name?: string | null;
  picture?: string | null;
}

interface MailboxState {
  connected: AccountInfo[];
  accounts: Account[];
  /** e-mails por caixa */
  folders: Partial<Record<FolderId | "search", Message[]>>;
  folderStatus: Partial<Record<FolderId, Status>>;
  /** contadores reais (somados entre as contas) */
  counts: Partial<Record<FolderId, number>>;
  profiles: Record<string, Profile>;
  live: boolean;
  status: Status;
  error: string | null;
  needsLogin: string[];
  bodies: Record<string, string>;
  /** versão formatada (HTML) de cada e-mail aberto */
  htmlBodies: Record<string, string | null>;
  /** anexos de cada e-mail aberto */
  attachments: Record<string, AttachmentInfo[]>;
  /** quando a última atualização terminou (ms) */
  updatedAt: number | null;
  /** atualização pedida pela pessoa (botão, ⌘R, ⌘K) em andamento */
  refreshing: boolean;
}

const COLORS = ["var(--acc-pessoal)", "var(--acc-moradah)", "var(--acc-inchurch)", "var(--acc-outlook)", "var(--acc-icloud)", "#c77b8b"];
const TONES = ["peach", "blue", "neutral"] as const;

let state: MailboxState = {
  connected: [],
  accounts: isTauri ? [] : ACCOUNTS,
  folders: isTauri ? {} : { inbox: MESSAGES },
  folderStatus: {},
  counts: isTauri ? {} : { inbox: 48, drafts: 2, spam: 3 },
  profiles: {},
  live: false,
  status: "idle",
  error: null,
  needsLogin: [],
  bodies: {},
  htmlBodies: {},
  attachments: {},
  updatedAt: null,
  refreshing: false,
};
const listeners = new Set<() => void>();
function set(patch: Partial<MailboxState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export function useMailbox<T>(selector: (s: MailboxState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}
export const getMailbox = () => state;

const EMPTY: Message[] = [];
export const folderMessages = (s: MailboxState, f: FolderId) => s.folders[f] ?? EMPTY;

/** Lista (caixa) onde o e-mail está, para navegar entre anterior e próximo. */
export function listContaining(s: MailboxState, id: string): Message[] {
  for (const list of Object.values(s.folders)) if (list?.some((x) => x.id === id)) return list;
  return EMPTY;
}

/** Procura um e-mail em qualquer caixa já carregada. */
export function findMessage(id: string): Message | undefined {
  for (const list of Object.values(state.folders)) {
    const m = list?.find((x) => x.id === id);
    if (m) return m;
  }
  return undefined;
}

/** Apelido de uma conta real a partir do e-mail. */
export function accountName(email: string) {
  const [local, domain = ""] = email.split("@");
  const isGmail = domain === "gmail.com" || domain === "googlemail.com";
  return isGmail ? local : domain.split(".")[0];
}

/** Rótulo e logo do serviço da conta (Gmail/Workspace, iCloud ou IMAP genérico). */
export function providerOf(info: Pick<AccountInfo, "email" | "provider">): { label: string; logo: LogoName } {
  if (info.provider === "icloud") return { label: "iCloud", logo: "icloud" };
  if (info.provider === "imap") return { label: "IMAP", logo: "mail" };
  const domain = info.email.split("@")[1] ?? "";
  const isGmail = domain === "gmail.com" || domain === "googlemail.com";
  return { label: isGmail ? "Gmail" : "Workspace", logo: domain.includes("inchurch") ? "inchurch" : "gmail" };
}

function toAccount(info: AccountInfo, index: number, unread: number): Account {
  const { label, logo } = providerOf(info);
  return {
    id: info.email,
    // apelido e cor escolhidos em Ajustes → Contas valem no app todo
    name: getPref<string>(`account:${info.email}:nickname`, "").trim() || accountName(info.email),
    provider: label,
    logo,
    color: getPref<string>(`account:${info.email}:color`, COLORS[index % COLORS.length]),
    unread,
  };
}

/** Reaplica apelido e cor das contas (depois de mudar nos Ajustes), sem buscar nada de novo. */
export function applyAccountLook() {
  if (state.connected.length === 0) return;
  set({ accounts: state.connected.map((a, i) => toAccount(a, i, state.accounts.find((x) => x.id === a.email)?.unread ?? 0)) });
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function toMessage(dto: MessageSummaryDto, accountEmail: string): Message {
  return {
    id: dto.id,
    account: accountEmail,
    accountEmail,
    from: dto.from.name,
    fromEmail: dto.from.email,
    toName: dto.to?.name,
    toEmail: dto.to?.email,
    threadId: dto.threadId,
    starred: dto.starred,
    avatar: { kind: "initials", initials: dto.initials, tone: TONES[hash(dto.from.email) % TONES.length] },
    subject: dto.subject,
    preview: dto.preview,
    date: dto.date,
    unread: dto.unread,
    attachment: dto.hasAttachment ? "Anexo" : undefined,
    internalDate: dto.internalDate,
  };
}

const isNeedsLogin = (e: unknown) => String(e) === NEEDS_LOGIN || (e as Error)?.message === NEEDS_LOGIN;

/** Busca uma caixa em todas as contas (em paralelo) e junta, mais recentes primeiro. */
export async function loadFolder(folder: FolderId) {
  if (!isTauri || state.connected.length === 0) return;
  set({ folderStatus: { ...state.folderStatus, [folder]: "loading" } });
  const needsLogin = new Set(state.needsLogin);
  const results = await Promise.all(
    state.connected.map((a) =>
      api.folder(a.email, folder).catch((e) => {
        if (isNeedsLogin(e)) needsLogin.add(a.email);
        return [] as MessageSummaryDto[];
      }),
    ),
  );
  const list = results
    .flatMap((r, i) => r.map((dto) => toMessage(dto, state.connected[i].email)))
    .toSorted((a, b) => (b.internalDate ?? 0) - (a.internalDate ?? 0));
  set({
    folders: { ...state.folders, [folder]: list },
    folderStatus: { ...state.folderStatus, [folder]: "ready" },
    needsLogin: [...needsLogin],
  });
  if (folder === "inbox") announceNewMail(list);
  return results;
}

/** Busca no Gmail de todas as contas (para o ⌘K). Os resultados ficam guardados para abrir o e-mail. */
export async function searchAll(q: string): Promise<Message[]> {
  if (!isTauri || state.connected.length === 0 || !q.trim()) return [];
  const results = await Promise.all(state.connected.map((a) => api.search(a.email, q).catch(() => [] as MessageSummaryDto[])));
  const list = results
    .flatMap((r, i) => r.map((dto) => toMessage(dto, state.connected[i].email)))
    .toSorted((a, b) => (b.internalDate ?? 0) - (a.internalDate ?? 0));
  set({ folders: { ...state.folders, search: list } });
  return list;
}

/** E-mails da Entrada já vistos nesta sessão (a primeira carga só registra, sem avisar). */
let knownInbox: Set<string> | null = null;
function announceNewMail(list: Message[]) {
  const fresh = knownInbox ? list.filter((m) => m.unread && !knownInbox!.has(m.id)) : [];
  knownInbox = new Set([...(knownInbox ?? []), ...list.map((m) => m.id)]);
  const peopleOnly = getPref("notifyPeopleOnly", true);
  const worth = fresh.filter((m) => !peopleOnly || !isAutomatedSender(m.fromEmail));
  if (worth.length === 0) return;
  if (worth.length === 1) void notify("email", worth[0].from, worth[0].subject || "(sem assunto)");
  else void notify("email", `${worth.length} e-mails novos`, worth.slice(0, 3).map((m) => `${m.from}: ${m.subject}`).join("\n"));
}

async function loadCounts() {
  const all = await Promise.all(state.connected.map((a) => api.counts(a.email).catch(() => ({}) as Record<string, number>)));
  const counts: Partial<Record<FolderId, number>> = {};
  for (const c of all) for (const [k, v] of Object.entries(c)) counts[k as FolderId] = (counts[k as FolderId] ?? 0) + v;
  set({ counts });
}

async function loadProfiles() {
  const entries = await Promise.all(state.connected.map(async (a) => [a.email, await api.profile(a.email).catch(() => ({}))] as const));
  set({ profiles: Object.fromEntries(entries) });
}

/** Outras partes (a agenda) que atualizam junto quando os e-mails são buscados de novo. */
const afterLoad = new Set<() => Promise<unknown> | void>();
export function onMailboxLoaded(f: () => Promise<unknown> | void) {
  afterLoad.add(f);
  return () => afterLoad.delete(f);
}

/** Busca as contas conectadas, a Entrada (e a caixa aberta), os contadores e as fotos. */
export async function loadMailbox(currentFolder: FolderId = "inbox") {
  if (!isTauri) return;
  set({ status: "loading", error: null });
  try {
    const connected = await api.accountsList();
    if (connected.length === 0) {
      set({ connected, accounts: [], folders: {}, counts: {}, live: false, status: "ready", updatedAt: Date.now() });
      await Promise.all([...afterLoad].map((f) => Promise.resolve(f()).catch(() => undefined)));
      return;
    }
    set({ connected, live: true });
    const [results] = await Promise.all([
      loadFolder("inbox"),
      currentFolder !== "inbox" ? loadFolder(currentFolder) : Promise.resolve(undefined),
      loadCounts(),
      loadProfiles(),
    ]);
    const accounts = connected.map((a, i) => toAccount(a, i, results?.[i]?.filter((m) => m.unread).length ?? 0));
    set({ accounts, status: "ready", updatedAt: Date.now() });
    await Promise.all([...afterLoad].map((f) => Promise.resolve(f()).catch(() => undefined)));
  } catch (e) {
    set({ status: "error", error: friendlyError(e) });
  }
}

/** Entra com uma conta Google (folha de login do macOS ou navegador) e recarrega tudo. */
export async function signInWithGoogle(loginHint?: string): Promise<AccountInfo> {
  const account = await api.googleSignIn(loginHint);
  set({ connected: [...state.connected.filter((a) => a.email !== account.email), account] });
  void loadMailbox();
  return account;
}

/** Conecta uma conta iCloud ou IMAP (testa a senha no servidor antes) e recarrega tudo. */
export async function connectImap(config: ImapConfig, password: string): Promise<AccountInfo> {
  const account = await api.imapConnect(config, password);
  set({ connected: [...state.connected.filter((a) => a.email !== account.email), account] });
  void loadMailbox();
  return account;
}

export async function disconnect(email: string) {
  await api.accountRemove(email);
  await loadMailbox();
}

/** Sai de todas as contas neste computador (nada é apagado no Google). */
export async function signOutAll() {
  for (const a of state.connected) {
    await api.accountRemove(a.email).catch(() => undefined);
  }
  set({ connected: [], accounts: [], folders: {}, counts: {}, live: false, bodies: {}, attachments: {}, needsLogin: [], profiles: {} });
  // avisa quem depende das contas (a agenda limpa os eventos)
  await loadMailbox();
}

/** Marca como lido no Gmail (e na lista, na hora). */
export function markReadRemote(id: string) {
  const m = findMessage(id);
  if (!m?.accountEmail || !m.unread) return;
  const folders = Object.fromEntries(
    Object.entries(state.folders).map(([k, list]) => [k, list?.map((x) => (x.id === id ? { ...x, unread: false } : x))]),
  ) as MailboxState["folders"];
  const inboxCount = state.counts.inbox;
  set({ folders, counts: { ...state.counts, inbox: inboxCount ? Math.max(0, inboxCount - 1) : inboxCount } });
  api.markRead(m.accountEmail, id).catch(() => {
    /* sem conexão: fica lido só aqui até a próxima atualização */
  });
}

/** Texto completo de um e-mail real (guardado depois da primeira leitura). */
export async function loadBody(id: string) {
  const m = findMessage(id);
  if (!m?.accountEmail || state.bodies[id] !== undefined) return;
  try {
    const body = await api.body(m.accountEmail, id);
    set({
      bodies: { ...state.bodies, [id]: body.text },
      htmlBodies: { ...state.htmlBodies, [id]: body.html ?? null },
      attachments: { ...state.attachments, [id]: body.attachments },
    });
  } catch (e) {
    set({ bodies: { ...state.bodies, [id]: `Não consegui abrir este e-mail: ${friendlyError(e)}` } });
  }
}

/** Caixa aberta agora (para atualizar junto com a Entrada). */
function currentFolder(): FolderId {
  const v = getStore().view;
  return v.name === "inbox" ? (v.folder as FolderId) : "inbox";
}

/** Atualização pedida pela pessoa: busca de novo e avisa quando terminar. */
export async function refreshMailbox() {
  if (!isTauri) {
    toast("Prévia: nada para atualizar");
    return;
  }
  if (state.refreshing) return;
  set({ refreshing: true });
  try {
    await loadMailbox(currentFolder());
    toast(state.error ?? "E-mails atualizados", state.error ? "error" : "ok");
  } finally {
    set({ refreshing: false });
  }
}

/** Atualização silenciosa de tempos em tempos (só com o app aberto e visível). */
let autoTimer: number | undefined;
export function startAutoRefresh(minutes = 3) {
  window.clearInterval(autoTimer);
  if (!isTauri || minutes <= 0) return;
  autoTimer = window.setInterval(() => {
    if (document.visibilityState === "visible" && state.live && !state.refreshing && state.status !== "loading") void loadMailbox(currentFolder());
  }, minutes * 60_000);
}

/** Envia pelo Gmail e atualiza Enviados. */
export async function sendMessage(message: OutgoingMessage, threadId?: string) {
  const id = await api.send(message, threadId);
  void loadFolder("sent");
  return id;
}

/** Tira um e-mail das listas na hora (antes da resposta do Gmail). */
function removeEverywhere(id: string, from?: FolderId[]) {
  const folders = Object.fromEntries(
    Object.entries(state.folders).map(([k, list]) => [k, !from || from.includes(k as FolderId) ? list?.filter((x) => x.id !== id) : list]),
  ) as MailboxState["folders"];
  set({ folders });
}

function patchEverywhere(id: string, patch: Partial<Message>) {
  const folders = Object.fromEntries(
    Object.entries(state.folders).map(([k, list]) => [k, list?.map((x) => (x.id === id ? { ...x, ...patch } : x))]),
  ) as MailboxState["folders"];
  set({ folders });
}

const BULK_DONE: Partial<Record<MessageAction, (n: number) => string>> = {
  archive: (n) => (n === 1 ? "Arquivado" : `${n} e-mails arquivados`),
  trash: (n) => (n === 1 ? "Movido para a Lixeira" : `${n} e-mails na Lixeira`),
  spam: (n) => (n === 1 ? "Marcado como spam" : `${n} marcados como spam`),
  notspam: (n) => (n === 1 ? "Voltou para a Entrada" : `${n} e-mails voltaram para a Entrada`),
  unarchive: (n) => (n === 1 ? "Voltou para a Entrada" : `${n} e-mails voltaram para a Entrada`),
  untrash: (n) => (n === 1 ? "Voltou para a Entrada" : `${n} e-mails voltaram para a Entrada`),
  read: (n) => (n === 1 ? "Marcado como lido" : `${n} marcados como lidos`),
  unread: (n) => (n === 1 ? "Marcado como não lido" : `${n} marcados como não lidos`),
};

/** Tira/ajusta os e-mails nas listas na hora, conforme a ação. */
function applyLocally(id: string, action: MessageAction) {
  if (action === "archive") removeEverywhere(id, ["inbox"]);
  else if (action === "trash") removeEverywhere(id);
  else if (action === "spam") removeEverywhere(id, ["inbox", "starred", "archive"]);
  else if (action === "notspam") removeEverywhere(id, ["spam"]);
  else if (action === "untrash") removeEverywhere(id, ["trash"]);
  else if (action === "unarchive") removeEverywhere(id, ["archive"]);
  else if (action === "star" || action === "unstar") patchEverywhere(id, { starred: action === "star" });
  else if (action === "unread" || action === "read") patchEverywhere(id, { unread: action === "unread" });
}

/** A mesma ação em vários e-mails (seleção na lista), com um aviso só no fim. */
export async function bulkAction(ids: string[], action: MessageAction) {
  const items = ids.map((id) => findMessage(id)).filter((m): m is Message => !!m);
  if (items.length === 0) return;
  const before = state.folders;
  items.forEach((m) => applyLocally(m.id, action));
  const done = BULK_DONE[action]?.(items.length);
  const real = items.filter((m) => m.accountEmail);
  if (real.length === 0) {
    if (done) toast(done);
    return;
  }
  const results = await Promise.allSettled(real.map((m) => api.action(m.accountEmail!, m.id, action)));
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed === 0) {
    if (done) toast(done);
  } else {
    set({ folders: before });
    toast(failed === real.length ? "Não deu certo. Tente de novo." : `${failed} de ${real.length} não deram certo. Atualize a lista.`, "error");
  }
  if (["untrash", "notspam", "unarchive"].includes(action)) void loadFolder("inbox");
  void loadCounts();
}

const DONE: Partial<Record<MessageAction, string>> = {
  archive: "Arquivado",
  trash: "Movido para a Lixeira",
  spam: "Marcado como spam",
  notspam: "Não é spam: voltou para a Entrada",
  unarchive: "Voltou para a Entrada",
  untrash: "Voltou para a Entrada",
};

/** Arquivar, lixeira, spam, estrela, não lido. Atualiza a tela na hora e desfaz se o Gmail recusar. */
export async function messageAction(id: string, action: MessageAction) {
  const m = findMessage(id);
  if (!m) return;
  const before = state.folders;
  applyLocally(id, action);
  if (!m.accountEmail) {
    if (DONE[action]) toast(DONE[action]!);
    return;
  }
  try {
    await api.action(m.accountEmail, id, action);
    if (DONE[action]) toast(DONE[action]!);
    if (action === "star" || action === "unstar") void loadFolder("starred");
    void loadCounts();
  } catch (e) {
    set({ folders: before });
    toast(`Não deu certo: ${friendlyError(e)}`, "error");
  }
}
