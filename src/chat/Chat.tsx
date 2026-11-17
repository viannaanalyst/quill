import * as Popover from "@radix-ui/react-popover";
import { useEffect, useMemo, useRef, useState } from "react";
import "./chat.css";
import { TopBar } from "../components/TopBar";
import { Select, Dot } from "../components/Select";
import { SliderGroup } from "../components/SliderGroup";
import { toast } from "../components/Toasts";
import { Logo } from "../components/Logo";
import {
  Building2,
  Check,
  Ellipsis,
  ExternalLink,
  ImageIcon,
  KeyRound,
  LoaderCircle,
  Mic,
  Paperclip,
  Pin,
  RefreshCw,
  Search,
  SquarePen,
  TriangleAlert,
  Users,
  Video,
  X,
} from "../components/icons";
import { friendlyError, type ChatMessageDto, type ChatSpaceDto } from "../lib/api";
import { isTauri } from "../lib/platform";
import { accountName, getMailbox, signInWithGoogle, useMailbox } from "../state/mailbox";
import { navigate } from "../state/store";
import { now as clockNow } from "../state/calendar";
import {
  isPinned,
  loadMembers,
  loadMessages,
  loadOlder,
  loadSpaces,
  markSeen,
  selectAccount,
  togglePin,
  unreadCount,
  unreadSpaces,
  useChat,
  workspaceAccounts,
} from "../state/chat";
import { Composer } from "./Composer";
import { ChatAvatar, hhmm, MessageList, PersonAvatar, SpaceIcon } from "./Messages";
import { openLink } from "./chatText";
import { kindOf } from "./media";

const SPACES_EVERY = 30_000;
const MESSAGES_EVERY = 8_000;

type Tab = "all" | "unread" | "spaces";
const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "unread", label: "Não lidas" },
  { id: "spaces", label: "Espaços" },
];

/** Horário na lista: hoje "10:24", ontem "Ontem", na semana "seg", antes "14 nov". */
function listTime(ms: number, now: number) {
  if (!ms) return "";
  const d = new Date(ms);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return hhmm(ms);
  if (d.toDateString() === new Date(now - 86_400_000).toDateString()) return "Ontem";
  if (now - ms < 6 * 86_400_000) return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "");
}

/** Prévia da última mensagem: anexo vira "Foto", "Mensagem de voz", "Vídeo" ou o nome do arquivo, com ícone. */
function Preview({ s }: { s: ChatSpaceDto }) {
  const m = s.lastMessage;
  if (!m) return <span className="chat-crp">{s.kind === "dm" ? "Conversa direta" : s.memberCount ? `${s.memberCount} pessoas` : "Sem mensagens"}</span>;
  const who = m.mine ? "Você: " : m.senderName ? `${m.senderName}: ` : "";
  const att = m.text.startsWith("Anexo: ") ? m.text.slice(7) : null;
  let icon = null;
  let text = m.text;
  if (att) {
    const k = kindOf({ name: att, contentType: null });
    icon = k === "image" ? <ImageIcon size={14} aria-hidden /> : k === "audio" ? <Mic size={14} aria-hidden /> : k === "video" ? <Video size={14} aria-hidden /> : <Paperclip size={14} aria-hidden />;
    text = k === "image" ? "Foto" : k === "audio" ? "Mensagem de voz" : k === "video" ? "Vídeo" : att;
  }
  return (
    <span className="chat-crp">
      {m.mine && <Check size={14} aria-hidden />}
      {icon && !m.mine && !m.senderName && icon}
      <span className="chat-crp-text">
        {who}
        {icon && (m.mine || m.senderName) ? <span className="chat-crp-ic">{icon}</span> : null}
        {text}
      </span>
    </span>
  );
}

function Row({ s, active, unread, now }: { s: ChatSpaceDto; active: boolean; unread: number; now: number }) {
  return (
    <button
      type="button"
      className={`chat-cr${unread ? " is-unread" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={() => navigate({ name: "chat", space: s.name })}
    >
      <SpaceIcon s={s} />
      <span className="chat-crb">
        <span className="chat-cr1">
          <span className="chat-crn">{s.title}</span>
          <span className="chat-crt">{listTime(s.lastActiveMs, now)}</span>
        </span>
        <span className="chat-cr2">
          <Preview s={s} />
          {unread > 0 && (
            <span className="chat-cnt" aria-label={`${unread >= 10 ? "mais de 9" : unread} não lidas`}>
              {unread >= 10 ? "9+" : unread}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/* ---------- sem conta Workspace e outros avisos ---------- */
function Illustration() {
  return (
    <div className="chat-ill" aria-hidden>
      <svg viewBox="0 0 440 220" width="440" height="220">
        <defs>
          <linearGradient id="chat-esky" x1="0" x2="1" y1="0" y2=".6">
            <stop offset=".2" style={{ stopColor: "var(--chat-sky1)" }} />
            <stop offset="1" style={{ stopColor: "var(--chat-sky2)" }} />
          </linearGradient>
          <radialGradient id="chat-eglow">
            <stop offset="0" style={{ stopColor: "var(--chat-sun)", stopOpacity: 0.9 }} />
            <stop offset="1" style={{ stopColor: "var(--chat-sun)", stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        <rect width="440" height="220" fill="url(#chat-esky)" />
        <circle cx="372" cy="50" r="58" fill="url(#chat-eglow)" />
        <circle cx="372" cy="50" r="17" style={{ fill: "var(--chat-sun)" }} />
        <g style={{ fill: "var(--chat-cloud2)" }}>
          <circle cx="40" cy="226" r="44" />
          <circle cx="120" cy="214" r="40" />
          <circle cx="330" cy="222" r="46" />
          <circle cx="420" cy="208" r="40" />
        </g>
        <g transform="translate(78 64)">
          <rect width="92" height="140" rx="7" style={{ fill: "var(--env)", stroke: "var(--envline)" }} strokeWidth="1.4" />
          <g style={{ fill: "var(--chat-cloud2)" }}>
            {[16, 38, 60, 82].flatMap((y) => [14, 38, 62].filter((x) => !(y === 82 && x === 38)).map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="16" height="13" rx="2" />))}
          </g>
          <rect x="34" y="104" width="24" height="36" rx="3" style={{ fill: "var(--envline)" }} opacity=".7" />
        </g>
        <g transform="translate(170 116)">
          <rect width="52" height="88" rx="6" style={{ fill: "var(--env)", stroke: "var(--envline)" }} strokeWidth="1.4" />
          <g style={{ fill: "var(--chat-cloud2)" }}>
            {[14, 33, 52].flatMap((y) => [10, 29].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="13" height="11" rx="2" />))}
          </g>
        </g>
        <g style={{ fill: "var(--chat-cloud)" }}>
          <circle cx="60" cy="236" r="40" />
          <circle cx="150" cy="232" r="38" />
          <circle cx="240" cy="240" r="40" />
          <circle cx="380" cy="236" r="44" />
        </g>
        <path d="M172 70 C206 30 236 40 258 66" fill="none" stroke="#8FAA87" strokeWidth="2" strokeDasharray="1 7" strokeLinecap="round" />
        <g transform="translate(250 58)">
          <g className="chat-fl">
            <path d="M18 0h104a18 18 0 0 1 18 18v28a18 18 0 0 1-18 18H40l-16 13 2-13h-8A18 18 0 0 1 0 46V18A18 18 0 0 1 18 0z" style={{ fill: "var(--env)", stroke: "var(--envline)" }} strokeWidth="1.4" />
            <circle cx="50" cy="32" r="6" fill="#4F86B5" />
            <circle cx="70" cy="32" r="6" fill="#6F9068" />
            <circle cx="90" cy="32" r="6" fill="#D9A57A" />
          </g>
        </g>
        <g transform="translate(286 138)">
          <g className="chat-fl2">
            <path d="M14 0h70a14 14 0 0 1 14 14v16a14 14 0 0 1-14 14H22l-2 10-11-10A14 14 0 0 1 0 30V14A14 14 0 0 1 14 0z" style={{ fill: "var(--env)", stroke: "var(--envline)" }} strokeWidth="1.4" />
            <path d="M16 17h56M16 27h36" style={{ stroke: "var(--envline)" }} strokeWidth="3" strokeLinecap="round" />
          </g>
        </g>
      </svg>
    </div>
  );
}

async function connectWork(hint?: string) {
  if (!isTauri) {
    toast("Prévia: abriria o login do Google");
    return;
  }
  try {
    await signInWithGoogle(hint);
    await loadSpaces();
  } catch (e) {
    toast(friendlyError(e), "error");
  }
}

function NoWorkspace() {
  const accounts = useMailbox((s) => s.accounts);
  const personal = accounts.filter((a) => a.provider !== "Workspace");
  return (
    <section className="card chat-emp stagger">
      <Illustration />
      <h1>
        O Google Chat funciona com contas
        <br />
        do Google Workspace (empresa)
      </h1>
      <p>
        {personal.length ? "As contas que você conectou são pessoais. " : ""}Entre com o e-mail do trabalho para ver as conversas e os espaços da sua equipe aqui, ao lado dos seus
        e-mails.
      </p>
      <div className="chat-eacts">
        <button type="button" className="btn solid lg" onClick={() => void connectWork()}>
          <Building2 size={17} aria-hidden />
          Conectar conta da empresa
        </button>
        <button type="button" className="btn glass lg" onClick={() => navigate({ name: "inbox", folder: "inbox" })}>
          Agora não
        </button>
      </div>
      {personal.length > 0 && (
        <div className="chat-eacc">
          <span className="chat-eacc-lb">Suas contas conectadas</span>
          <ul className="chat-chips">
            {personal.map((a) => (
              <li className="chat-chip" key={a.id}>
                <span className="chat-chip-lo">
                  <Logo name={a.logo} size={15} />
                  <b style={{ background: a.color }} />
                </span>
                {a.name}
                <em>· sem Chat</em>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Notice({ kind, account, error }: { kind: "permission" | "needs_login" | "not_configured" | "error"; account: string | null; error?: string | null }) {
  const text = {
    permission: ["Entre de novo com a conta para liberar o Chat", "O Quill ganhou permissão para o Google Chat depois que você entrou. Entre de novo com a conta para ver suas conversas."],
    needs_login: ["Essa conta precisa entrar de novo", "O acesso ao Google expirou. Entre de novo para continuar usando o Chat."],
    not_configured: ["O Google Chat ainda não foi liberado para o Quill", "Falta configurar o app de Chat no projeto do Quill no Google Cloud (Google Chat API → Configuração)."],
    error: ["Não consegui abrir o Chat", error ?? "Tente de novo daqui a pouco."],
  }[kind];
  return (
    <section className="card chat-emp chat-notice stagger">
      <span className="chat-notice-ic" aria-hidden>
        {kind === "not_configured" || kind === "error" ? <TriangleAlert size={22} /> : <KeyRound size={22} />}
      </span>
      <h1>{text[0]}</h1>
      <p>{text[1]}</p>
      <div className="chat-eacts">
        {(kind === "permission" || kind === "needs_login") && (
          <button type="button" className="btn solid lg" onClick={() => void connectWork(account ?? undefined)}>
            Entrar de novo
          </button>
        )}
        {(kind === "error" || kind === "not_configured") && (
          <button type="button" className="btn glass lg" onClick={() => void loadSpaces()}>
            <RefreshCw size={16} aria-hidden />
            Tentar de novo
          </button>
        )}
      </div>
    </section>
  );
}

/* ---------- conversa aberta ---------- */
function Conversation({ s, account }: { s: ChatSpaceDto; account: string }) {
  const messages = useChat((st) => st.messages[s.name]);
  const status = useChat((st) => st.msgStatus[s.name] ?? "idle");
  const msgError = useChat((st) => st.msgError[s.name]);
  const hasOlder = useChat((st) => !!st.next[s.name]);
  const olderLoading = useChat((st) => st.olderLoading);
  const members = useChat((st) => st.members[s.name]);
  const allOutgoing = useChat((st) => st.outgoing);
  const pinned = useChat((st) => isPinned(st, s.name));
  const outgoing = useMemo(() => allOutgoing.filter((o) => o.space === s.name && o.account === account), [allOutgoing, s.name, account]);
  const [replyTo, setReplyTo] = useState<ChatMessageDto | null>(null);
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState("");
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<{ files: File[]; seq: number } | null>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    setReplyTo(null);
    setFilter("");
    setSearching(false);
    void loadMessages(s.name);
    if (s.kind !== "dm") void loadMembers(s.name);
  }, [s.name, s.kind]);

  const others = (members ?? []).filter((p) => !(p.name === "Você" && p.email === account));
  const count = s.memberCount ?? members?.length ?? null;
  const uri = s.uri ?? "https://chat.google.com/";

  return (
    <section
      className="card chat-cv"
      aria-label={`Conversa: ${s.title}`}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (e.dataTransfer.files.length) setDropped({ files: [...e.dataTransfer.files], seq: Date.now() });
      }}
    >
      <header className="chat-cvh">
        <SpaceIcon s={s} />
        <div className="chat-cvt">
          <div className="chat-cvn">{s.title}</div>
          <div className="chat-cvs">
            {s.kind === "dm" ? (
              (s.email ?? "Conversa direta")
            ) : (
              <>
                <Users size={13} aria-hidden />
                {s.kind === "space" ? "Espaço" : "Grupo"}
                {count ? ` · ${count} ${count === 1 ? "pessoa" : "pessoas"}` : ""}
              </>
            )}
          </div>
        </div>
        {searching ? (
          <label className="chat-cvsearch">
            <Search size={15} aria-hidden />
            <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar nesta conversa" aria-label="Buscar nesta conversa" />
            <button
              type="button"
              className="chat-link"
              aria-label="Fechar busca"
              onClick={() => {
                setFilter("");
                setSearching(false);
              }}
            >
              <X size={14} aria-hidden />
            </button>
          </label>
        ) : (
          s.kind !== "dm" &&
          others.length > 0 && (
            <div className="chat-stack" aria-label={`${count ?? others.length} pessoas`}>
              {others.slice(0, 4).map((p) => (
                <PersonAvatar key={p.id} p={p} account={account} size={28} />
              ))}
              {(count ?? others.length) > 4 && <span className="chat-more">+{(count ?? others.length) - 4}</span>}
            </div>
          )
        )}
        <button type="button" className="btn glass ic" data-tip="Ligar pelo Google Chat" aria-label="Ligar pelo Google Chat (abre no navegador)" onClick={() => openLink(uri)}>
          <Video size={17} aria-hidden />
        </button>
        <button type="button" className="btn glass ic" data-tip="Buscar nesta conversa" aria-label="Buscar nesta conversa" aria-pressed={searching} onClick={() => setSearching(!searching)}>
          <Search size={17} aria-hidden />
        </button>
        <button type="button" className="btn glass ic" data-tip={pinned ? "Soltar conversa" : "Fixar conversa"} aria-label={pinned ? "Soltar conversa" : "Fixar conversa"} aria-pressed={pinned} onClick={() => togglePin(s.name)}>
          <Pin size={17} aria-hidden />
        </button>
        <Popover.Root>
          <Popover.Trigger asChild>
            <button type="button" className="btn glass ic" data-tip="Mais" data-tip-pos="left" aria-label="Mais opções">
              <Ellipsis size={17} aria-hidden />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="qp-content chat-menu" align="end" sideOffset={8}>
              <Popover.Close asChild>
                <button type="button" onClick={() => openLink(uri)}>
                  <ExternalLink size={15} aria-hidden />
                  Abrir no Google Chat
                </button>
              </Popover.Close>
              <Popover.Close asChild>
                <button type="button" onClick={() => void loadMessages(s.name)}>
                  <RefreshCw size={15} aria-hidden />
                  Atualizar conversa
                </button>
              </Popover.Close>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </header>

      {status === "loading" && !messages ? (
        <div className="chat-center" role="status">
          <LoaderCircle size={20} className="spinning" aria-hidden />
          Carregando mensagens…
        </div>
      ) : status === "error" && !messages ? (
        <div className="chat-center" role="alert">
          {msgError}
          <button type="button" className="btn glass sm" onClick={() => void loadMessages(s.name)}>
            Tentar de novo
          </button>
        </div>
      ) : (
        <MessageList
          account={account}
          space={s.name}
          messages={messages ?? []}
          outgoing={outgoing}
          now={clockNow()}
          hasOlder={hasOlder}
          olderLoading={olderLoading}
          onOlder={() => void loadOlder(s.name)}
          onReply={setReplyTo}
          filter={filter}
          onClearFilter={() => setFilter("")}
        />
      )}
      <Composer account={account} space={s.name} replyTo={replyTo} onClearReply={() => setReplyTo(null)} dropped={dropped} />
      {dragging && (
        <div className="chat-drop" aria-hidden>
          <Paperclip size={22} />
          Solte para enviar nesta conversa
        </div>
      )}
    </section>
  );
}

/* ---------- tela ---------- */
export default function Chat({ space }: { space?: string }) {
  const connected = useMailbox((s) => s.connected);
  const accounts = useMemo(() => workspaceAccounts(), [connected]); // eslint-disable-line react-hooks/exhaustive-deps
  const account = useChat((s) => s.account);
  const spaces = useChat((s) => s.spaces);
  const status = useChat((s) => s.status);
  const problem = useChat((s) => s.problem);
  const error = useChat((s) => s.error);
  const unread = useChat(unreadSpaces);
  const chat = useChat((s) => s);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const now = clockNow();

  useEffect(() => {
    void loadSpaces();
  }, [accounts.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // abre a primeira conversa quando nenhuma foi escolhida
  const ordered = useMemo(() => {
    const pins = spaces.filter((s) => isPinned(chat, s.name));
    return { pins, rest: spaces.filter((s) => !pins.includes(s)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaces, chat.pinned, chat.account]);
  const open = spaces.find((s) => s.name === space) ?? (space ? undefined : (ordered.pins[0] ?? ordered.rest[0]));

  // atualização: lista a cada 30 s e conversa aberta a cada 8 s, só com a janela à vista
  const openName = open?.name;
  useEffect(() => {
    if (!isTauri) return;
    const tickSpaces = window.setInterval(() => document.visibilityState === "visible" && void loadSpaces(true), SPACES_EVERY);
    const tickMsgs = window.setInterval(() => document.visibilityState === "visible" && openName && void loadMessages(openName), MESSAGES_EVERY);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void loadSpaces(true);
      if (openName) {
        void loadMessages(openName);
        markSeen(openName);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(tickSpaces);
      window.clearInterval(tickMsgs);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [openName]);

  const q = query.trim().toLowerCase();
  const match = (s: ChatSpaceDto) =>
    (!q || s.title.toLowerCase().includes(q) || (s.lastMessage?.text ?? "").toLowerCase().includes(q)) &&
    (tab === "all" || (tab === "unread" ? unreadCount(chat, s) > 0 : s.kind === "space"));
  const pins = ordered.pins.filter(match);
  const rest = ordered.rest.filter(match);
  const colorOf = (email: string) => getMailbox().accounts.find((a) => a.id === email)?.color ?? "var(--acc-inchurch)";

  let body;
  if (accounts.length === 0 || problem === "not_workspace") body = <NoWorkspace />;
  else if (problem === "permission" || problem === "needs_login" || problem === "not_configured") body = <Notice kind={problem} account={account} />;
  else if (status === "error" && spaces.length === 0) body = <Notice kind="error" account={account} error={error} />;
  else
    body = (
      <>
        <section className="card chat-cl" aria-label="Conversas">
          <div className="chat-clh">
            <div className="chat-clt">
              <h2>Conversas</h2>
              {accounts.length > 1 && account ? (
                <Select
                  size="sm"
                  className="chat-accp"
                  label="Conta do Chat"
                  value={account}
                  onChange={selectAccount}
                  options={accounts.map((a) => ({ value: a, label: isTauri ? accountName(a) : "Conta da empresa", leading: <Dot color={colorOf(a)} /> }))}
                />
              ) : (
                account && (
                  <span className="chat-accp is-static">
                    <Dot color={colorOf(account)} />
                    {accountName(account)}
                  </span>
                )
              )}
              <button type="button" className="btn glass ic chat-new" data-tip="Nova conversa (abre o Google Chat)" data-tip-pos="left" aria-label="Nova conversa (abre o Google Chat no navegador)" onClick={() => openLink("https://chat.google.com/")}>
                <SquarePen size={16} aria-hidden />
              </button>
            </div>
            <label className="chat-cls">
              <Search size={16} aria-hidden />
              <input type="search" placeholder="Buscar conversas" aria-label="Buscar conversas" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <SliderGroup className="segmented chat-seg" activeKey={tab} role="group" label="Filtrar conversas">
              {TABS.map((t) => (
                <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </SliderGroup>
          </div>
          <div className="chat-rows">
            {status === "loading" && spaces.length === 0 ? (
              <div className="chat-center" role="status">
                <LoaderCircle size={18} className="spinning" aria-hidden />
                Carregando conversas…
              </div>
            ) : pins.length + rest.length === 0 ? (
              <div className="chat-center">{q || tab !== "all" ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda."}</div>
            ) : (
              <>
                {pins.length > 0 && (
                  <>
                    <div className="chat-lbl">Fixadas</div>
                    {pins.map((s) => (
                      <Row key={s.name} s={s} active={s.name === open?.name} unread={unreadCount(chat, s)} now={now} />
                    ))}
                  </>
                )}
                {rest.length > 0 && (
                  <>
                    <div className="chat-lbl">Recentes</div>
                    {rest.map((s) => (
                      <Row key={s.name} s={s} active={s.name === open?.name} unread={unreadCount(chat, s)} now={now} />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </section>
        {open && account ? (
          <Conversation s={open} account={account} />
        ) : (
          <section className="card chat-cv chat-center">
            <ChatAvatar name="Chat" size={44} square icon={<Users size={20} />} />
            {spaces.length ? "Escolha uma conversa" : "Suas conversas do Google Chat aparecem aqui."}
          </section>
        )}
      </>
    );

  return (
    <div className="chat">
      <TopBar title="Chat" sub={unread > 0 && accounts.length > 0 && !problem ? `${unread} não lidas` : undefined} />
      <div className="chat-content">{body}</div>
    </div>
  );
}
