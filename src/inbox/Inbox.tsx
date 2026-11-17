import { useEffect, useMemo, useState } from "react";
import "./inbox.css";
import { Logo } from "../components/Logo";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { TopBar } from "../components/TopBar";
import { MessageAvatar } from "../components/MessageAvatar";
import { InviteGate, RsvpButtons } from "../components/Rsvp";
import { EventRsvpButtons, useEventRsvp } from "../components/EventRsvp";
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
import type { Account, AccountId, Message } from "./types";
import { folderMessages, loadFolder, markReadRemote, refreshMailbox, useMailbox, type FolderId } from "../state/mailbox";
import { SliderGroup } from "../components/SliderGroup";
import { usePref } from "../lib/usePref";
import { ConnectGoogleButton } from "../components/ConnectGoogle";
import { isTauri } from "../lib/platform";
import { markRead, navigate, useStore } from "../state/store";
import { addDays, eventsOnDay, loadRange, sameDay, startOfDay, startOfWeek, timeRange, useCalendar, visibleEvents, type AgendaEvent } from "../state/calendar";
import { calendarMap, dayLong, dayShort, dowShort, fmtDuration, fmtTime, openCalendarAt, useClock } from "../calendar/shared";

type Filter = "all" | AccountId;

export const FOLDERS: { id: FolderId; label: string; icon: typeof InboxIcon }[] = [
  { id: "inbox", label: "Entrada", icon: InboxIcon },
  { id: "starred", label: "Importantes", icon: Star },
  { id: "sent", label: "Enviados", icon: Send },
  { id: "drafts", label: "Rascunhos", icon: FileText },
  { id: "archive", label: "Arquivo", icon: Archive },
  { id: "spam", label: "Spam", icon: OctagonAlert },
];

export default function Inbox({ folder: folderParam }: { folder: string }) {
  const folder = (FOLDERS.some((f) => f.id === folderParam) ? folderParam : folderParam === "trash" ? "trash" : "inbox") as FolderId;
  const [filter, setFilter] = useState<Filter>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [query, setQuery] = useState("");
  const readIds = useStore((s) => s.readIds);
  const accounts = useMailbox((s) => s.accounts);
  const messages = useMailbox((s) => folderMessages(s, folder));
  const folderStatus = useMailbox((s) => s.folderStatus[folder]);
  const counts = useMailbox((s) => s.counts);
  const [showBanner] = usePref("showBanner", true);
  const [showPreview] = usePref("showPreview", true);
  const [density] = usePref<"comfortable" | "compact">("density", "comfortable");
  const [markOnOpen] = usePref("markReadOnOpen", true);
  const [visibleFolders] = usePref<string[]>("folders.visible", FOLDERS.map((f) => f.id));
  const refreshing = useMailbox((s) => s.refreshing);
  const live = useMailbox((s) => s.live);
  const status = useMailbox((s) => s.status);
  const needsLogin = useMailbox((s) => s.needsLogin);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const folderInfo = FOLDERS.find((f) => f.id === folder) ?? { id: "trash", label: "Lixeira", icon: InboxIcon };

  // abre uma caixa que ainda não foi carregada (cada caixa vem do Gmail só quando é aberta)
  useEffect(() => {
    if (live && folder !== "inbox") void loadFolder(folder);
  }, [live, folder]);

  const isUnread = (m: Message) => m.unread && !readIds.has(m.id);

  // Filtros calculados na renderização (sem efeitos).
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("pt-BR");
    return messages.filter((m) => {
      if (filter !== "all" && m.account !== filter) return false;
      if (unreadOnly && !(m.unread && !readIds.has(m.id))) return false;
      if (q && !`${m.from} ${m.subject} ${m.preview}`.toLocaleLowerCase("pt-BR").includes(q)) return false;
      return true;
    });
  }, [filter, unreadOnly, query, readIds, messages]);

  const loadingList = live && (folderStatus === "loading" || (status === "loading" && messages.length === 0));
  const showsRecipient = folder === "sent" || folder === "drafts";

  const open = (id: string) => {
    if (markOnOpen) {
      markRead(id);
      markReadRemote(id);
    }
    navigate({ name: "read", id });
  };

  return (
    <>
      <TopBar
        title="Caixa de entrada"
        sub={live ? `${folderInfo.label} · ${messages.length} recentes` : "1.284 e-mails"}
        search={query}
        onSearch={setQuery}
        actions={
          <button className="btn glass ic" aria-label="Atualizar" data-tip="Atualizar" onClick={() => void refreshMailbox()} disabled={refreshing}>
            <span className={refreshing ? "spinning" : undefined} style={{ display: "flex" }}>
              <RefreshCw size={17} aria-hidden />
            </span>
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
          <SliderGroup activeKey={folder} role="navigation" label="Caixas">
            {FOLDERS.filter((f) => f.id === "inbox" || f.id === folder || visibleFolders.includes(f.id)).map((f) => (
              // contadores reais: não lidos na Entrada e no Spam, total em Rascunhos
              <button
                key={f.id}
                className="pill"
                aria-current={f.id === folder ? "page" : undefined}
                onClick={() => navigate({ name: "inbox", folder: f.id })}
              >
                <f.icon size={17} aria-hidden />
                {f.label}
                {counts[f.id] ? <span className="count">{counts[f.id]}</span> : null}
              </button>
            ))}
          </SliderGroup>
        </div>

        <div className="content">
          <div className="col-main">
            {accounts.length > 0 && <AccountsBar accounts={accounts} filter={filter} onChange={setFilter} />}

            <section className="card list" aria-label="E-mails">
              <div className="list-head">
                <span className="checkbox" aria-hidden />
                <span>
                  {folderInfo.label} · {filter === "all" ? "todas as contas" : accountById.get(filter)?.name}
                </span>
                <SliderGroup activeKey={String(unreadOnly)} className="segmented" role="group" label="Mostrar" style={{ marginLeft: "auto" }}>
                  <button aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>Todas</button>
                  <button aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Não lidas</button>
                </SliderGroup>
                <button className="btn ic" aria-label="Filtros" data-tip="Filtros" style={{ color: "var(--ink2)" }}>
                  <ListFilter size={18} aria-hidden />
                </button>
              </div>

              <div className={`list-scroll${density === "compact" ? " compact" : ""}${showPreview ? "" : " no-preview"}`}>
                {isTauri && !live && status !== "loading" && (
                  <div className="inbox-connect">
                    <h2>Conecte seu e-mail</h2>
                    <p>
                      Entre com a sua conta Google pela página oficial. Gmail e Google Workspace funcionam; Microsoft, iCloud e IMAP
                      chegam em seguida.
                    </p>
                    <ConnectGoogleButton />
                  </div>
                )}
                {folder === "inbox" && showBanner && (live || !isTauri) && <Banner unread={messages.filter(isUnread).length} accounts={accounts.length} />}
                {needsLogin.length > 0 && (
                  <p className="list-empty" role="alert">
                    {needsLogin.join(", ")} precisa entrar de novo. Abra Ajustes → Contas.
                  </p>
                )}
                {visible.length === 0 && loadingList ? (
                  <p className="list-empty" role="status">Carregando seus e-mails…</p>
                ) : visible.length === 0 && isTauri && !live ? null : visible.length === 0 ? (
                  <p className="list-empty">
                    {folder === "inbox" ? "Nenhum e-mail com esse filtro." : `Nada em ${folderInfo.label} por enquanto.`}
                  </p>
                ) : (
                  <ul className="rows stagger" key={folder}>
                    {visible.map((m) => (
                      <MessageRow
                        key={m.id}
                        message={m}
                        account={accountById.get(m.account)}
                        unread={isUnread(m)}
                        showRecipient={showsRecipient}
                        onOpen={() => open(m.id)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          <aside className="col-side" aria-label="Hoje">
            <TodayCard />
            <PendingInvite />
            {(live || !isTauri) && (
              <p className="sync">
                <CircleCheck size={15} aria-hidden />
                {status === "loading" ? "Atualizando…" : "Tudo sincronizado"}
              </p>
            )}
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

function MessageRow({
  message: m,
  account,
  unread,
  showRecipient,
  onOpen,
}: {
  message: Message;
  account?: Account;
  unread: boolean;
  showRecipient?: boolean;
  onOpen: () => void;
}) {
  const who = showRecipient && m.toName ? `Para: ${m.toName}` : m.from;
  return (
    <li className={`row${unread ? " unread" : ""}`}>
      <button className="row-hit" onClick={onOpen} aria-label={`${unread ? "Não lido. " : ""}${who}: ${m.subject}`} />
      <MessageAvatar message={m} />
      <div className="row-body">
        <div className="row-top">
          <span className="row-from">{who}</span>
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

/** Cartão "Hoje": a semana com bolinha nos dias com evento e os próximos compromissos do dia escolhido. */
function TodayCard() {
  const clock = useClock();
  const events = useCalendar(visibleEvents);
  const connected = useMailbox((s) => s.connected.length);
  const weekStart = startOfWeek(clock).getTime();
  const [picked, setPicked] = useState<number | null>(null);
  const day = picked ?? startOfDay(clock).getTime();
  const isToday = sameDay(day, clock);

  // a semana atual (com folga, ver loadRange); repete quando uma conta entra
  useEffect(() => {
    void loadRange(new Date(weekStart), addDays(weekStart, 7));
  }, [weekStart, connected]);

  const week = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = addDays(weekStart, i);
        return { t: d.getTime(), busy: eventsOnDay(events, d).length > 0 };
      }),
    [weekStart, events],
  );
  // hoje: só o que ainda não acabou; outro dia: tudo
  const items = eventsOnDay(events, day)
    .filter((e) => !isToday || e.end > clock)
    .slice(0, 3);
  const label = isToday ? "Hoje" : sameDay(day, addDays(clock, 1)) ? "Amanhã" : sameDay(day, addDays(clock, -1)) ? "Ontem" : dayLong(day).split(",")[0];

  return (
    <section className="card today" aria-label={label}>
      <div className="today-head">
        <div>
          <h2 className="today-title">{label}</h2>
          <div className="today-date">{dayLong(day)}</div>
        </div>
        <button
          className="btn glass ic"
          aria-label="Novo evento"
          data-tip="Novo evento"
          data-tip-pos="left"
          onClick={() => openCalendarAt("day", day, true)}
        >
          <Plus size={16} aria-hidden />
        </button>
      </div>
      <ul className="week" aria-label="Esta semana">
        {week.map((d) => (
          <li key={d.t} className={`${sameDay(d.t, clock) ? "is-today" : ""}${d.busy ? " has-events" : ""}`}>
            <button
              className={`inbox-week-day${d.t === day && !sameDay(d.t, clock) ? " is-picked" : ""}`}
              aria-pressed={d.t === day}
              aria-label={`${dayLong(d.t)}${d.busy ? ", com eventos" : ""}`}
              onClick={() => setPicked(sameDay(d.t, clock) ? null : d.t)}
            >
              <span aria-hidden>{dowShort(d.t)}</span>
              <b aria-hidden>{new Date(d.t).getDate()}</b>
            </button>
          </li>
        ))}
      </ul>
      {items.length > 0 ? (
        <ul className="agenda">
          {items.map((e) => (
            <AgendaRow key={e.key} event={e} clock={clock} />
          ))}
        </ul>
      ) : (
        <p className="inbox-agenda-empty">{isToday ? (eventsOnDay(events, day).length ? "Nada mais por hoje." : "Nada marcado para hoje.") : "Nada marcado neste dia."}</p>
      )}
      <button className="btn glass" onClick={() => openCalendarAt("day", day)}>
        <CalendarDays size={15} aria-hidden />
        Abrir calendário
      </button>
    </section>
  );
}

function AgendaRow({ event: e, clock }: { event: AgendaEvent; clock: number }) {
  const mins = Math.round((e.start - clock) / 60_000);
  const soon = !e.allDay && mins > 0 && mins < 60 ? `em ${mins} min` : !e.allDay && e.start <= clock && e.end > clock ? "agora" : null;
  const [Icon, meta] = e.meetUrl
    ? [Video, `Meet · ${fmtDuration(e.end - e.start)}`]
    : e.location
      ? [MapPin, e.location]
      : [Clock, e.allDay ? "Dia inteiro" : timeRange(e)];
  return (
    <li className={`${soon ? "soon" : ""}${e.myStatus === "declined" ? " inbox-agenda-declined" : ""}`}>
      <span className="agenda-time">{e.allDay ? "dia" : fmtTime(e.start)}</span>
      <span className="agenda-dot" style={{ background: e.color }} aria-hidden />
      <span className="agenda-body">
        <span className="agenda-title" style={{ display: "block" }}>
          {e.title}
        </span>
        <span className="agenda-meta">
          <Icon size={13} aria-hidden />
          <span className="inbox-agenda-meta">{meta}</span>
        </span>
      </span>
      {soon && <span className="soon-chip">{soon}</span>}
    </li>
  );
}

/** Próximo convite da agenda ainda sem resposta (some quando não há nenhum). */
function PendingInvite() {
  const clock = useClock();
  const events = useCalendar(visibleEvents);
  const invite = events.find((e) => e.myStatus === "needsAction" && e.start > clock);
  if (!invite) return null;
  return <InviteCard key={invite.key} e={invite} />;
}

function InviteCard({ e }: { e: AgendaEvent }) {
  const rsvp = useEventRsvp(e.key);
  const map = calendarMap(useCalendar((s) => s.calendars));
  const from = e.organizer?.name ?? e.organizer?.email;
  const cal = map.get(e.copies[0].calendarKey)?.name;
  return (
    <section className={`card invite${rsvp.leaving ? " invite-leaving" : ""}`} aria-label="Convite pendente">
      <div className="section-label">
        <CalendarDays size={14} aria-hidden />
        Convite pendente
      </div>
      <div className="invite-title">{e.title}</div>
      <div className="invite-when">
        {dayShort(e.start)} · {timeRange(e)}
        {e.location ? ` · ${e.location}` : ""}
      </div>
      {(from || cal) && (
        <div className="invite-from">
          {from ? `De ${from}` : ""}
          {from && cal ? " · " : ""}
          {cal ? `agenda ${cal}` : ""}
        </div>
      )}
      <EventRsvpButtons rsvp={rsvp} />
    </section>
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
  const clock = useClock();
  const events = useCalendar(visibleEvents);
  // compromissos que ainda faltam hoje
  const left = eventsOnDay(events, clock).filter((e) => e.end > clock).length;
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
          {unread} {unread === 1 ? "e-mail novo" : "e-mails novos"} em {accounts} {accounts === 1 ? "conta" : "contas"}
          {left > 0 ? ` · ${left} ${left === 1 ? "compromisso" : "compromissos"} hoje` : ""}
        </p>
      </div>
    </div>
  );
}
