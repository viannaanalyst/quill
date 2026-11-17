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
  Check,
  Mail,
  MailOpen,
  Minus,
  Trash2,
  X,
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
import { bulkAction, folderMessages, loadFolder, markReadRemote, refreshMailbox, useMailbox, type FolderId } from "../state/mailbox";
import { SliderGroup } from "../components/SliderGroup";
import { usePref } from "../lib/usePref";
import { AccountPhoto, AVATAR_PREF } from "../components/MyAvatar";
import { ConnectGoogleButton } from "../components/ConnectGoogle";
import { Banner } from "./Banner";
import { isTauri } from "../lib/platform";
import { markRead, markUnread, navigate, useStore } from "../state/store";
import { getPref } from "../lib/storage";
import { askConfirm } from "../components/ConfirmHost";
import type { MessageAction } from "../lib/api";
import { api, friendlyError } from "../lib/api";
import { toast } from "../components/Toasts";
import { sanitizeHtml, textToHtml } from "../compose/richText";
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

/** Ações em massa de cada caixa (marcar lido/não lido entra em todas, menos Rascunhos). */
const BULK: Record<FolderId, { action: MessageAction; label: string; icon: typeof InboxIcon }[]> = {
  inbox: [
    { action: "archive", label: "Arquivar", icon: Archive },
    { action: "trash", label: "Lixeira", icon: Trash2 },
    { action: "spam", label: "Spam", icon: OctagonAlert },
  ],
  starred: [
    { action: "unstar", label: "Tirar de Importantes", icon: Star },
    { action: "archive", label: "Arquivar", icon: Archive },
    { action: "trash", label: "Lixeira", icon: Trash2 },
  ],
  sent: [{ action: "trash", label: "Lixeira", icon: Trash2 }],
  drafts: [{ action: "trash", label: "Descartar", icon: Trash2 }],
  archive: [
    { action: "unarchive", label: "Mover para a Entrada", icon: InboxIcon },
    { action: "trash", label: "Lixeira", icon: Trash2 },
  ],
  spam: [
    { action: "notspam", label: "Não é spam", icon: InboxIcon },
    { action: "trash", label: "Lixeira", icon: Trash2 },
  ],
  trash: [{ action: "untrash", label: "Mover para a Entrada", icon: InboxIcon }],
};

export default function Inbox({ folder: folderParam }: { folder: string }) {
  const folder = (FOLDERS.some((f) => f.id === folderParam) ? folderParam : folderParam === "trash" ? "trash" : "inbox") as FolderId;
  const [filter, setFilter] = useState<Filter>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const query = "";
  // seleção para ações em massa; zera ao trocar de caixa ou de conta
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [selKey, setSelKey] = useState(`${folderParam}|all`);
  const readIds = useStore((s) => s.readIds);
  const accounts = useMailbox((s) => s.accounts);
  const messages = useMailbox((s) => folderMessages(s, folder));
  // a saudação aparece em todas as pastas e conta os não lidos da Entrada
  const inboxMessages = useMailbox((s) => folderMessages(s, "inbox"));
  const folderStatus = useMailbox((s) => s.folderStatus[folder]);
  const counts = useMailbox((s) => s.counts);
  const [showBanner] = usePref("showBanner", true);
  const [showPreview] = usePref("showPreview", true);
  const [density] = usePref<"comfortable" | "compact">("density", "comfortable");
  const [markOnOpen] = usePref("markReadOnOpen", true);
  const [visibleFolders] = usePref<string[]>("folders.visible", FOLDERS.map((f) => f.id));
  const refreshing = useMailbox((s) => s.refreshing);
  const updatedAt = useMailbox((s) => s.updatedAt);
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
  if (selKey !== `${folder}|${filter}`) {
    setSelKey(`${folder}|${filter}`);
    setSelected(new Set());
  }

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

  const selectedVisible = visible.filter((m) => selected.has(m.id));
  const allSelected = visible.length > 0 && selectedVisible.length === visible.length;
  const anyUnreadSelected = selectedVisible.some(isUnread);
  const bulkActions = BULK[folder];
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const runBulk = (action: MessageAction) => {
    const ids = selectedVisible.map((m) => m.id);
    if (action === "trash" && getPref("confirmDelete", true)) {
      void askConfirm({
        title: ids.length === 1 ? "Mover para a Lixeira?" : `Mover ${ids.length} e-mails para a Lixeira?`,
        text: "Dá para tirar de lá depois, pela pasta Lixeira.",
        action: "Mover para a Lixeira",
      }).then((ok) => ok && doBulk(ids, action));
      return;
    }
    doBulk(ids, action);
  };
  const doBulk = (ids: string[], action: MessageAction) => {
    if (action === "read") ids.forEach(markRead);
    if (action === "unread") ids.forEach(markUnread);
    setSelected(new Set());
    void bulkAction(ids, action);
  };
  const loadingList = live && (folderStatus === "loading" || (status === "loading" && messages.length === 0));
  const showsRecipient = folder === "sent" || folder === "drafts";

  const open = (id: string) => {
    // rascunho: abre no Escrever para continuar (e atualizar o mesmo rascunho no Gmail)
    const draftMsg = live && folder === "drafts" ? messages.find((m) => m.id === id) : undefined;
    if (draftMsg?.accountEmail) {
      const email = draftMsg.accountEmail;
      const people = (list: string[]) =>
        list.map((raw) => {
          const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
          return m ? { name: m[1].trim(), email: m[2].trim() } : { name: "", email: raw.trim() };
        });
      void api
        .draftGet(email, id)
        .then((d) =>
          navigate({
            name: "compose",
            draft: {
              draftId: d.draftId,
              from: email,
              to: people(d.to),
              cc: people(d.cc),
              bcc: people(d.bcc),
              subject: d.subject,
              body: d.html ? sanitizeHtml(d.html, "draft") : textToHtml(d.text),
            },
          }),
        )
        .catch((e) => {
          toast(`Não abriu o rascunho: ${friendlyError(e)}`, "error");
          navigate({ name: "read", id });
        });
      return;
    }
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
            {accounts.length > 1 && <AccountsBar accounts={accounts} filter={filter} onChange={setFilter} />}

            <section className="card list" aria-label="E-mails">
              <div className={`list-head${selectedVisible.length ? " selecting" : ""}`}>
                <Checkbox
                  checked={allSelected ? true : selectedVisible.length ? "mixed" : false}
                  label={allSelected ? "Desmarcar todos" : "Selecionar todos"}
                  disabled={visible.length === 0}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((m) => m.id)))}
                />
                {selectedVisible.length > 0 ? (
                  <div className="inbox-bulk" role="toolbar" aria-label="Ações nos selecionados">
                    <span className="inbox-bulk-count">
                      {selectedVisible.length} {selectedVisible.length === 1 ? "selecionado" : "selecionados"}
                    </span>
                    {bulkActions.map((b) => (
                      <button key={b.action} className="btn glass sm" onClick={() => runBulk(b.action)}>
                        <b.icon size={15} aria-hidden />
                        {b.label}
                      </button>
                    ))}
                    {folder !== "drafts" && (
                      <button className="btn glass sm" onClick={() => runBulk(anyUnreadSelected ? "read" : "unread")}>
                        {anyUnreadSelected ? <MailOpen size={15} aria-hidden /> : <Mail size={15} aria-hidden />}
                        {anyUnreadSelected ? "Marcar como lido" : "Marcar como não lido"}
                      </button>
                    )}
                    <button className="btn ic inbox-bulk-close" aria-label="Limpar seleção" data-tip="Limpar seleção" onClick={() => setSelected(new Set())}>
                      <X size={16} aria-hidden />
                    </button>
                  </div>
                ) : (
                  <>
                    <span>
                      {folderInfo.label} · {filter === "all" ? "todas as contas" : accountById.get(filter)?.name}
                    </span>
                    <SliderGroup activeKey={String(unreadOnly)} className="segmented" role="group" label="Mostrar" style={{ marginLeft: "auto" }}>
                      <button aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>Todas</button>
                      <button aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Não lidas</button>
                    </SliderGroup>
                  </>
                )}
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
                {showBanner && (live || !isTauri) && <Banner unread={inboxMessages.filter(isUnread).length} accounts={accounts.length} />}
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
                        selected={selected.has(m.id)}
                        selecting={selectedVisible.length > 0}
                        onSelect={() => toggleSelect(m.id)}
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
                {status === "loading" || refreshing ? "Atualizando…" : <SyncedAgo at={updatedAt} />}
              </p>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}

/** Filtro por conta: pílulas compactas com o destaque que desliza (some quando há uma conta só). */
function AccountsBar({ accounts, filter, onChange }: { accounts: Account[]; filter: Filter; onChange: (f: Filter) => void }) {
  const profiles = useMailbox((s) => s.profiles);
  const firstEmail = useMailbox((s) => s.connected[0]?.email);
  const [customPhoto] = usePref<string | null>(AVATAR_PREF, null);
  const total = accounts.reduce((sum, a) => sum + a.unread, 0);
  return (
    <SliderGroup activeKey={filter} className="inbox-accounts" role="group" label="Contas">
      <button className="inbox-acc" aria-pressed={filter === "all"} onClick={() => onChange("all")}>
        <Layers size={15} aria-hidden />
        Todas
        {total > 0 && <span className="inbox-acc-count" aria-label={`${total} não lidos`}>{total}</span>}
      </button>
      {accounts.map((a) => (
        <button key={a.id} className="inbox-acc" aria-pressed={filter === a.id} onClick={() => onChange(a.id)} data-tip={a.id}>
          {/* foto da conta (Google ou a escolhida no Quill); sem foto, o logo do serviço */}
          <span className={`inbox-acc-logo${profiles[a.id]?.picture || a.id === firstEmail ? " has-photo" : ""}`}>
            {profiles[a.id]?.picture || (a.id === firstEmail && customPhoto) ? (
              <AccountPhoto email={a.id} size={22} />
            ) : (
              <Logo name={a.logo} size={13} />
            )}
            <i style={{ background: a.color }} />
          </span>
          {a.name}
          {a.unread > 0 && <span className="inbox-acc-count" aria-label={`${a.unread} não lidos`}>{a.unread}</span>}
        </button>
      ))}
    </SliderGroup>
  );
}

/** "Atualizado agora" / "Atualizado há 3 min" (anda sozinho a cada 30 s). */
function SyncedAgo({ at }: { at: number | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  if (!at) return <>Tudo sincronizado</>;
  const min = Math.floor((Date.now() - at) / 60_000);
  return <>{min < 1 ? "Atualizado agora" : min < 60 ? `Atualizado há ${min} min` : `Atualizado às ${new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}</>;
}

/** Caixinha de seleção no estilo do Quill (marcada, desmarcada ou "alguns"). */
function Checkbox({ checked, onChange, label, disabled }: { checked: boolean | "mixed"; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      className="qcheck"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
    >
      {checked === "mixed" ? <Minus size={12} aria-hidden /> : checked ? <Check size={12} aria-hidden /> : null}
    </button>
  );
}

function MessageRow({
  message: m,
  account,
  unread,
  showRecipient,
  selected,
  selecting,
  onSelect,
  onOpen,
}: {
  message: Message;
  account?: Account;
  unread: boolean;
  showRecipient?: boolean;
  selected: boolean;
  selecting: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const who = showRecipient && m.toName ? `Para: ${m.toName}` : m.from;
  return (
    <li className={`row${unread ? " unread" : ""}${selected ? " is-selected" : ""}${selecting ? " selecting" : ""}`}>
      <button className="row-hit" onClick={selecting ? onSelect : onOpen} aria-label={`${unread ? "Não lido. " : ""}${who}: ${m.subject}`} />
      <span className="row-check">
        <Checkbox checked={selected} onChange={onSelect} label={`Selecionar ${who}`} />
      </span>
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
