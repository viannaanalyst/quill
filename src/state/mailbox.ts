import { useSyncExternalStore } from "react";
import { api, friendlyError, NEEDS_LOGIN, type AccountInfo, type MessageSummaryDto } from "../lib/api";
import { isTauri } from "../lib/platform";
import { ACCOUNTS, MESSAGES } from "../inbox/sampleData";
import type { Account, Message } from "../inbox/types";
import type { LogoName } from "../components/Logo";

/**
 * Fonte dos e-mails das telas. Com conta conectada (app no Mac), usa os e-mails reais;
 * sem conta ou na prévia do navegador, mostra os dados de exemplo.
 */
type Status = "idle" | "loading" | "ready" | "error";

interface MailboxState {
  /** contas reais conectadas (vazio = usar exemplo) */
  connected: AccountInfo[];
  accounts: Account[];
  messages: Message[];
  live: boolean;
  status: Status;
  error: string | null;
  /** contas que precisam entrar de novo */
  needsLogin: string[];
  bodies: Record<string, string>;
}

const COLORS = ["var(--acc-pessoal)", "var(--acc-moradah)", "var(--acc-inchurch)", "var(--acc-outlook)", "var(--acc-icloud)", "#c77b8b"];
const TONES = ["peach", "blue", "neutral"] as const;

// No app, sem conta conectada, não há nada de exemplo; os exemplos ficam só na prévia de design.
let state: MailboxState = {
  connected: [],
  accounts: isTauri ? [] : ACCOUNTS,
  messages: isTauri ? [] : MESSAGES,
  live: false,
  status: "idle",
  error: null,
  needsLogin: [],
  bodies: {},
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

/** Apelido e visual de uma conta real a partir do e-mail. */
function toAccount(info: AccountInfo, index: number, unread: number): Account {
  const [local, domain = ""] = info.email.split("@");
  const isGmail = domain === "gmail.com" || domain === "googlemail.com";
  const logo: LogoName = domain.includes("inchurch") ? "inchurch" : "gmail";
  const name = isGmail ? local : domain.split(".")[0];
  return {
    id: info.email,
    name,
    provider: isGmail ? "Gmail" : "Workspace",
    logo,
    color: COLORS[index % COLORS.length],
    unread,
  };
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
    avatar: { kind: "initials", initials: dto.initials, tone: TONES[hash(dto.from.email) % TONES.length] },
    subject: dto.subject,
    preview: dto.preview,
    date: dto.date,
    unread: dto.unread,
    attachment: dto.hasAttachment ? "Anexo" : undefined,
    internalDate: dto.internalDate,
  };
}

/** Busca as contas conectadas e os e-mails de todas elas (em paralelo). */
export async function loadMailbox() {
  if (!isTauri) return;
  set({ status: "loading", error: null });
  try {
    const connected = await api.accountsList();
    if (connected.length === 0) {
      set({ connected, accounts: [], messages: [], live: false, status: "ready" });
      return;
    }
    const needsLogin: string[] = [];
    const results = await Promise.all(
      connected.map((a) =>
        api.inbox(a.email).catch((e) => {
          if (String(e) === NEEDS_LOGIN || (e as Error)?.message === NEEDS_LOGIN) needsLogin.push(a.email);
          return [] as MessageSummaryDto[];
        }),
      ),
    );
    const messages = results
      .flatMap((list, i) => list.map((dto) => toMessage(dto, connected[i].email)))
      .toSorted((a, b) => (b.internalDate ?? 0) - (a.internalDate ?? 0));
    const accounts = connected.map((a, i) => toAccount(a, i, results[i].filter((m) => m.unread).length));
    set({ connected, accounts, messages, live: true, status: "ready", needsLogin });
  } catch (e) {
    set({ status: "error", error: friendlyError(e) });
  }
}

/** Entra com uma conta Google pelo navegador e recarrega a caixa de entrada. */
export async function signInWithGoogle(loginHint?: string): Promise<AccountInfo> {
  const account = await api.googleSignIn(loginHint);
  // aparece na hora na lista de contas; os e-mails chegam logo depois
  set({ connected: [...state.connected.filter((a) => a.email !== account.email), account] });
  void loadMailbox();
  return account;
}

export async function disconnect(email: string) {
  await api.accountRemove(email);
  await loadMailbox();
}

/** Marca como lido no Gmail (e na lista, na hora). */
export function markReadRemote(id: string) {
  const m = state.messages.find((x) => x.id === id);
  if (!m?.accountEmail || !m.unread) return;
  set({ messages: state.messages.map((x) => (x.id === id ? { ...x, unread: false } : x)) });
  api.markRead(m.accountEmail, id).catch(() => {
    /* sem conexão: fica lido só aqui até a próxima atualização */
  });
}

/** Texto completo de um e-mail real (guardado depois da primeira leitura). */
export async function loadBody(id: string) {
  const m = state.messages.find((x) => x.id === id);
  if (!m?.accountEmail || state.bodies[id] !== undefined) return;
  try {
    const text = await api.body(m.accountEmail, id);
    set({ bodies: { ...state.bodies, [id]: text } });
  } catch (e) {
    set({ bodies: { ...state.bodies, [id]: `Não consegui abrir este e-mail: ${friendlyError(e)}` } });
  }
}

/** Sai de todas as contas neste computador (nada é apagado no Google). */
export async function signOutAll() {
  for (const a of state.connected) {
    await api.accountRemove(a.email).catch(() => undefined);
  }
  set({ connected: [], accounts: [], messages: [], live: false, bodies: {}, needsLogin: [] });
}
