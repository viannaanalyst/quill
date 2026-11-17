import { useMemo, useState } from "react";
import "./inbox.css";
import { Logo } from "../components/Logo";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { TopBar } from "../components/TopBar";
import { MessageAvatar } from "../components/MessageAvatar";
import { InviteGate, RsvpButtons } from "../components/Rsvp";
import {
  Archive,
  CalendarDays,
  CircleCheck,
  Clock,
  FileText,
  Inbox as InboxIcon,
  Layers,
  ListFilter,
  MapPin,
  OctagonAlert,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  SquarePen,
  Star,
  Video,
} from "../components/icons";
import { ACCOUNT_BY_ID, AGENDA, PENDING_INVITE, TODAY_LABEL, WEEK } from "./sampleData";
import type { Account, AccountId, AgendaItem, Message } from "./types";
import { loadMailbox, markReadRemote, useMailbox } from "../state/mailbox";
import { markRead, navigate, useStore } from "../state/store";

type Filter = "all" | AccountId;

export const FOLDERS = [
  { id: "inbox", label: "Entrada", icon: InboxIcon, count: 0 },
  { id: "starred", label: "Importantes", icon: Star, count: 6 },
  { id: "sent", label: "Enviados", icon: Send },
  { id: "drafts", label: "Rascunhos", icon: FileText, count: 2 },
  { id: "archive", label: "Arquivo", icon: Archive },
  { id: "spam", label: "Spam", icon: OctagonAlert, count: 3 },
] as const;

export default function Inbox({ folder }: { folder: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [query, setQuery] = useState("");
  const readIds = useStore((s) => s.readIds);
  const accounts = useMailbox((s) => s.accounts);
  const messages = useMailbox((s) => s.messages);
  const live = useMailbox((s) => s.live);
  const status = useMailbox((s) => s.status);
  const needsLogin = useMailbox((s) => s.needsLogin);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const totalUnread = accounts.reduce((sum, a) => sum + a.unread, 0);
  const folderInfo = FOLDERS.find((f) => f.id === folder) ?? FOLDERS[0];

  const isUnread = (m: Message) => m.unread && !readIds.has(m.id);

  // Filtros calculados na renderização (sem efeitos). Só a Entrada tem dados de exemplo.
  const visible = useMemo(() => {
    if (folder !== "inbox") return [];
    const q = query.trim().toLocaleLowerCase("pt-BR");
    return messages.filter((m) => {
      if (filter !== "all" && m.account !== filter) return false;
      if (unreadOnly && !(m.unread && !readIds.has(m.id))) return false;
      if (q && !`${m.from} ${m.subject} ${m.preview}`.toLocaleLowerCase("pt-BR").includes(q)) return false;
      return true;
    });
  }, [folder, filter, unreadOnly, query, readIds, messages]);

  const open = (id: string) => {
    markRead(id);
    markReadRemote(id);
    navigate({ name: "read", id });
  };

  return (
    <>
      <TopBar
        title="Caixa de entrada"
        sub={live ? `${messages.length} e-mails recentes` : "1.284 e-mails"}
        search={query}
        onSearch={setQuery}
        actions={
          <button className="btn glass ic" aria-label="Atualizar" data-tip="Atualizar" onClick={() => void loadMailbox()}>
            <RefreshCw size={17} aria-hidden />
          </button>
        }
      />

      <div className="inbox">
        <div className="toolbar">
          <button className="btn solid lg" onClick={() => navigate({ name: "compose" })}>
            <SquarePen size={17} aria-hidden />
            Escrever
          </button>
          <span className="vsep" aria-hidden />
          <nav aria-label="Caixas" style={{ display: "flex", gap: 6 }}>
            {FOLDERS.map((f) => (
              <button
                key={f.id}
                className="pill"
                aria-current={f.id === folder ? "page" : undefined}
                onClick={() => navigate({ name: "inbox", folder: f.id })}
              >
                <f.icon size={17} aria-hidden />
                {f.label}
                {"count" in f && <span className="count">{f.id === "inbox" ? totalUnread : f.count}</span>}
              </button>
            ))}
          </nav>
        </div>

        <div className="content">
          <div className="col-main">
            <AccountsBar accounts={accounts} filter={filter} onChange={setFilter} />

            <section className="card list" aria-label="E-mails">
              <div className="list-head">
                <span className="checkbox" aria-hidden />
                <span>
                  {folderInfo.label} · {filter === "all" ? "todas as contas" : accountById.get(filter)?.name}
                </span>
                <div className="segmented" role="group" aria-label="Mostrar" style={{ marginLeft: "auto" }}>
                  <button aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>Todas</button>
                  <button aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Não lidas</button>
                </div>
                <button className="btn ic" aria-label="Filtros" data-tip="Filtros" style={{ color: "var(--ink2)" }}>
                  <ListFilter size={18} aria-hidden />
                </button>
              </div>

              <div className="list-scroll">
                {folder === "inbox" && <Banner unread={messages.filter(isUnread).length} accounts={accounts.length} />}
                {needsLogin.length > 0 && (
                  <p className="list-empty" role="alert">
                    {needsLogin.join(", ")} precisa entrar de novo. Abra Ajustes → Contas.
                  </p>
                )}
                {visible.length === 0 && live && status === "loading" ? (
                  <p className="list-empty" role="status">Carregando seus e-mails…</p>
                ) : visible.length === 0 ? (
                  <p className="list-empty">
                    {folder === "inbox" ? "Nenhum e-mail com esse filtro." : `Nada em ${folderInfo.label} por enquanto.`}
                  </p>
                ) : (
                  <ul className="rows">
                    {visible.map((m) => (
                      <MessageRow key={m.id} message={m} account={accountById.get(m.account)} unread={isUnread(m)} onOpen={() => open(m.id)} />
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          <aside className="col-side" aria-label="Hoje">
            <TodayCard />
            <InviteGate>
              <section className="card invite" aria-label="Convite pendente">
                <div className="section-label">
                  <CalendarDays size={14} aria-hidden />
                  Convite pendente
                </div>
                <div className="invite-title">{PENDING_INVITE.title}</div>
                <div className="invite-when">{PENDING_INVITE.when}</div>
                <div className="invite-from">{PENDING_INVITE.from}</div>
                <RsvpButtons />
              </section>
            </InviteGate>
            <p className="sync">
              <CircleCheck size={15} aria-hidden />
              Tudo sincronizado · há 1 min
            </p>
          </aside>
        </div>
      </div>
    </>
  );
}

function AccountsBar({ accounts, filter, onChange }: { accounts: Account[]; filter: Filter; onChange: (f: Filter) => void }) {
  const total = accounts.reduce((sum, a) => sum + a.unread, 0);
  return (
    <div className="card accounts" role="group" aria-label="Contas">
      <button className="account" aria-pressed={filter === "all"} onClick={() => onChange("all")}>
        <span className="account-logo">
          <Layers size={17} aria-hidden />
        </span>
        <span className="account-text">
          <span className="account-name" style={{ display: "block" }}>Todas</span>
          <span className="account-sub" style={{ display: "block" }}>{accounts.length} {accounts.length === 1 ? "conta" : "contas"}</span>
        </span>
        <span className="account-count" aria-label={`${total} não lidos`}>{total}</span>
      </button>
      {accounts.map((a) => (
        <button key={a.id} className="account" aria-pressed={filter === a.id} onClick={() => onChange(a.id)}>
          <span className="account-logo">
            <Logo name={a.logo} size={17} />
            <i style={{ background: a.color }} />
          </span>
          <span className="account-text">
            <span className="account-name" style={{ display: "block" }}>{a.name}</span>
            <span className="account-sub" style={{ display: "block" }}>{a.provider}</span>
          </span>
          <span className="account-count" aria-label={`${a.unread} não lidos`}>{a.unread}</span>
        </button>
      ))}
    </div>
  );
}

function MessageRow({ message: m, account, unread, onOpen }: { message: Message; account?: Account; unread: boolean; onOpen: () => void }) {
  return (
    <li className={`row${unread ? " unread" : ""}`}>
      <button className="row-hit" onClick={onOpen} aria-label={`${unread ? "Não lido. " : ""}${m.from}: ${m.subject}`} />
      <MessageAvatar message={m} />
      <div className="row-body">
        <div className="row-top">
          <span className="row-from">{m.from}</span>
          {m.verified && <VerifiedBadge />}
          {account && (
            <span className="acct">
              <i style={{ background: account.color }} />
              {account.name}
            </span>
          )}
          <span className="row-date">{m.date}</span>
        </div>
        <div className="row-subject">{m.subject}</div>
        <div className="row-preview">{m.preview}</div>
        {m.attachment && (
          <span className="row-attachment">
            <Paperclip size={13} aria-hidden />
            {m.attachment}
          </span>
        )}
        {m.invite && (
          <InviteGate>
            <RsvpButtons size="sm" />
          </InviteGate>
        )}
      </div>
    </li>
  );
}

const AGENDA_ICON = { video: Video, "map-pin": MapPin, clock: Clock } as const;

function TodayCard() {
  return (
    <section className="card today">
      <div className="today-head">
        <div>
          <h2 className="today-title">Hoje</h2>
          <div className="today-date">{TODAY_LABEL}</div>
        </div>
        <button className="btn glass ic" aria-label="Novo evento" data-tip="Novo evento" onClick={() => navigate({ name: "calendar", mode: "month" })}>
          <Plus size={16} aria-hidden />
        </button>
      </div>
      <ul className="week" aria-label="Esta semana">
        {WEEK.map((d) => (
          <li key={d.n} className={`${d.today ? "is-today" : ""}${d.dot ? " has-events" : ""}`}>
            {d.day}
            <b>{d.n}</b>
          </li>
        ))}
      </ul>
      <ul className="agenda">
        {AGENDA.map((e) => (
          <AgendaRow key={e.id} item={e} />
        ))}
      </ul>
      <button className="btn glass" onClick={() => navigate({ name: "calendar", mode: "day" })}>
        <CalendarDays size={15} aria-hidden />
        Abrir calendário
      </button>
    </section>
  );
}

function AgendaRow({ item }: { item: AgendaItem }) {
  const Icon = AGENDA_ICON[item.icon];
  return (
    <li className={item.soon ? "soon" : undefined}>
      <span className="agenda-time">{item.time}</span>
      <span className="agenda-dot" style={{ background: ACCOUNT_BY_ID.get(item.account)!.color }} aria-hidden />
      <span className="agenda-body">
        <span className="agenda-title" style={{ display: "block" }}>{item.title}</span>
        <span className="agenda-meta">
          <Icon size={13} aria-hidden />
          {item.meta}
        </span>
      </span>
      {item.soon && <span className="soon-chip">{item.soon}</span>}
    </li>
  );
}

function Envelope({ x, y, w, rotate }: { x: number; y: number; w: number; rotate: number }) {
  const h = w * 0.66;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={w * 0.09} fill="var(--env)" stroke="var(--envline)" strokeWidth="1.2" />
      <path
        d={`M${-w / 2 + 2} ${-h / 2 + 2} L0 ${h * 0.08} L${w / 2 - 2} ${-h / 2 + 2}`}
        fill="none"
        stroke="var(--envline)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </g>
  );
}

/** Banner ilustrado do topo da lista (de dia no claro, à noite no escuro). */
function Banner({ unread, accounts }: { unread: number; accounts: number }) {
  return (
    <div className="banner">
      <svg viewBox="0 0 1000 112" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <defs>
          <linearGradient id="quill-sky" x1="0" x2="1" y1="0" y2=".5">
            <stop offset=".25" stopColor="var(--sky1)" />
            <stop offset="1" stopColor="var(--sky2)" />
          </linearGradient>
          <radialGradient id="quill-glow">
            <stop offset="0" stopColor="var(--sun)" stopOpacity=".9" />
            <stop offset="1" stopColor="var(--sun)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1000" height="112" fill="url(#quill-sky)" />
        <g fill="var(--star)">
          <circle cx="560" cy="18" r="1.2" />
          <circle cx="640" cy="40" r="1" />
          <circle cx="720" cy="14" r="1.4" />
          <circle cx="790" cy="52" r="1" />
          <circle cx="960" cy="22" r="1.2" />
          <circle cx="600" cy="70" r=".9" />
        </g>
        <circle cx="905" cy="32" r="44" fill="url(#quill-glow)" />
        <circle cx="905" cy="32" r="15" fill="var(--sun)" />
        <g fill="var(--cloud2)">
          <circle cx="700" cy="122" r="40" />
          <circle cx="760" cy="104" r="38" />
          <circle cx="830" cy="114" r="44" />
          <circle cx="900" cy="98" r="36" />
          <circle cx="970" cy="108" r="42" />
        </g>
        <g fill="var(--cloud)">
          <circle cx="760" cy="132" r="34" />
          <circle cx="815" cy="120" r="30" />
          <circle cx="870" cy="134" r="36" />
          <circle cx="940" cy="124" r="30" />
          <circle cx="1000" cy="130" r="34" />
        </g>
        <path d="M470 82 C540 56 590 88 650 62 S770 28 860 46" fill="none" stroke="#8FAA87" strokeWidth="2" strokeDasharray="1 7" strokeLinecap="round" />
        <Envelope x={470} y={82} w={24} rotate={-10} />
        <Envelope x={600} y={58} w={30} rotate={8} />
        <Envelope x={745} y={36} w={38} rotate={-6} />
      </svg>
      <div className="banner-text">
        <h2>Bom dia, Gabriel</h2>
        <p>
          {unread} {unread === 1 ? "e-mail novo" : "e-mails novos"} em {accounts} {accounts === 1 ? "conta" : "contas"} · 3 compromissos hoje
        </p>
      </div>
    </div>
  );
}
