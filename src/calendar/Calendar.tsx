import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import "./calendar.css";
import { SliderGroup } from "../components/SliderGroup";
import { Dot, Select } from "../components/Select";
import { DatePicker, TimeSelect } from "../components/DatePicker";
import { TopBar } from "../components/TopBar";
import { toast } from "../components/Toasts";
import { EventRsvpButtons, useEventRsvp } from "../components/EventRsvp";
import { isTauri } from "../lib/platform";
import { initialsOf } from "../components/MyAvatar";
import {
  Bell,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  Cloud,
  Ellipsis,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  User,
  Users,
  Video,
  X,
} from "../components/icons";
import { useMailbox } from "../state/mailbox";
import { navigate, type CalendarMode } from "../state/store";
import {
  addDays,
  createEvent,
  editableCalendars,
  eventsOnDay,
  loadRange,
  now,
  reloadCalendar,
  sameDay,
  startOfDay,
  startOfWeek,
  timeRange,
  toggleCalendar,
  useCalendar,
  visibleEvents,
  type AgendaEvent,
  type Attendee,
  type RsvpStatus,
} from "../state/calendar";
import {
  calendarMap,
  cap,
  clearCalendarIntent,
  dayLong,
  dowLong,
  dowShort,
  fmtTime,
  matchesQuery,
  meetLabel,
  monthShort,
  peekCalendarIntent,
  useClock,
} from "./shared";

/** A grade mostra o dia inteiro (0h–24h). */
const HOURS = 24;
/** Quantas horas cabem na tela, no mínimo; com janela alta cada hora cresce para preencher o espaço. */
const VISIBLE_HOURS = 13;
const MIN_HOUR_PX = 44;
/** Ao abrir, a grade começa às 7h30. */
const START_SCROLL_HOUR = 7.5;
/** Na prévia do navegador, as telas abrem como nos desenhos (convite aberto na semana, criação rápida no mês). */
const PREVIEW = !isTauri;

type Vars = CSSProperties & Record<`--${string}`, string>;

/**
 * Ajusta a altura de cada hora ao espaço disponível (--hh) e rola até o começo do dia útil.
 * A altura só muda com o tamanho da janela; nada é medido durante animações.
 */
function useHourGrid() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let first = true;
    const apply = (height: number) => {
      const hh = Math.max(MIN_HOUR_PX, Math.floor(height / VISIBLE_HOURS));
      el.style.setProperty("--hh", `${hh}px`);
      if (first) {
        el.scrollTop = hh * START_SCROLL_HOUR;
        first = false;
      }
    };
    apply(el.clientHeight);
    const ro = new ResizeObserver(([entry]) => apply(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return ref;
}

/** Fecha o cartão flutuante com Esc. */
function useEscape(onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);
}

/* ---------------- datas ---------------- */

const firstOfMonth = (t: number | Date) => {
  const d = startOfDay(t);
  d.setDate(1);
  return d;
};
/** Hora do dia em número (9,5 = 09:30). */
const hourOf = (t: number) => {
  const d = new Date(t);
  return d.getHours() + d.getMinutes() / 60;
};
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Intervalo que a visão mostra (o mês inclui as 6 semanas da grade). */
function viewRange(mode: CalendarMode, anchor: number) {
  if (mode === "day") {
    const s = startOfDay(anchor);
    return { start: s, end: addDays(s, 1) };
  }
  if (mode === "week") {
    const s = startOfWeek(anchor);
    return { start: s, end: addDays(s, 7) };
  }
  const s = startOfWeek(firstOfMonth(anchor));
  return { start: s, end: addDays(s, 42) };
}

function rangeTitle(mode: CalendarMode, anchor: number) {
  const d = new Date(anchor);
  if (mode === "day") return cap(d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  if (mode === "month") return cap(d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }));
  const s = startOfWeek(anchor);
  const e = addDays(s, 6);
  const month = (x: Date) => x.toLocaleDateString("pt-BR", { month: "long" });
  if (s.getFullYear() !== e.getFullYear())
    return `${s.getDate()} de ${month(s)} de ${s.getFullYear()} – ${e.getDate()} de ${month(e)} de ${e.getFullYear()}`;
  if (s.getMonth() !== e.getMonth()) return `${s.getDate()} de ${month(s)} – ${e.getDate()} de ${month(e)} de ${e.getFullYear()}`;
  return `${s.getDate()} – ${e.getDate()} de ${month(e)} de ${e.getFullYear()}`;
}

/** Dias (meia-noite, em ms) que têm algum evento dentro de [s, e). */
function busyDays(events: AgendaEvent[], s: number, e: number) {
  const out = new Set<number>();
  for (const ev of events) {
    if (ev.start >= e || (ev.end <= s && ev.start < s)) continue;
    const stop = Math.min(ev.end, e);
    let d = startOfDay(Math.max(ev.start, s));
    do {
      out.add(d.getTime());
      d = addDays(d, 1);
    } while (d.getTime() < stop);
  }
  return out;
}

/* ---------------- posição dos eventos na grade ---------------- */

interface Placed {
  ev: AgendaEvent;
  /** hora de início e duração, em horas, dentro do dia */
  top: number;
  dur: number;
  /** coluna e total de colunas quando há eventos no mesmo horário */
  col: number;
  cols: number;
}

/** Eventos com hora de um dia, lado a lado quando se sobrepõem. */
function layoutDay(events: AgendaEvent[], day: Date): Placed[] {
  const s = startOfDay(day).getTime();
  const e = addDays(s, 1).getTime();
  const items = events
    .filter((ev) => !ev.allDay)
    .map((ev) => {
      const top = ev.start <= s ? 0 : hourOf(ev.start);
      const bottom = ev.end >= e ? HOURS : hourOf(ev.end);
      return { ev, top, dur: Math.max(bottom - top, 0.25), col: 0, cols: 1 };
    })
    .toSorted((a, b) => a.top - b.top || b.dur - a.dur);
  let group: Placed[] = [];
  let ends: number[] = [];
  let groupEnd = -1;
  const flush = () => {
    for (const it of group) it.cols = ends.length;
    group = [];
    ends = [];
  };
  for (const it of items) {
    if (it.top >= groupEnd) {
      flush();
      groupEnd = -1;
    }
    let c = ends.findIndex((end) => end <= it.top);
    if (c === -1) {
      c = ends.length;
      ends.push(it.top + it.dur);
    } else ends[c] = it.top + it.dur;
    it.col = c;
    group.push(it);
    groupEnd = Math.max(groupEnd, it.top + it.dur);
  }
  flush();
  return items;
}

/* ---------------- tela ---------------- */

interface Creating {
  day: number;
  /** abre junto do dia clicado no mês (senão, no canto do calendário) */
  cell?: boolean;
  title?: string;
}

export default function Calendar({ mode }: { mode: CalendarMode }) {
  // pedido vindo da caixa de entrada (dia escolhido no cartão "Hoje", botão +)
  const [anchor, setAnchor] = useState(() => startOfDay(peekCalendarIntent()?.day ?? now()).getTime());
  const [creating, setCreating] = useState<Creating | null>(() => {
    const intent = peekCalendarIntent();
    if (intent?.create) return { day: startOfDay(intent.day).getTime() };
    return PREVIEW && mode === "month" ? { day: new Date(2026, 10, 25).getTime(), cell: true, title: "Reunião com a gráfica" } : null;
  });
  useEffect(() => clearCalendarIntent(), []);

  const query = "";
  const clock = useClock();
  const all = useCalendar(visibleEvents);
  const status = useCalendar((s) => s.status);
  const error = useCalendar((s) => s.error);
  const connected = useMailbox((s) => s.connected.length);
  const mailStatus = useMailbox((s) => s.status);

  const q = query.trim().toLocaleLowerCase("pt-BR");
  const events = useMemo(() => (q ? all.filter((e) => matchesQuery(e, q)) : all), [all, q]);

  const { start, end } = viewRange(mode, anchor);
  const startMs = start.getTime();
  const endMs = end.getTime();
  // carrega o período visível (com folga); repete quando uma conta entra
  useEffect(() => {
    void loadRange(new Date(startMs), new Date(endMs));
  }, [startMs, endMs, connected]);

  const step = (dir: 1 | -1) => {
    if (mode === "day") return setAnchor(addDays(anchor, dir).getTime());
    if (mode === "week") return setAnchor(addDays(anchor, 7 * dir).getTime());
    const m = firstOfMonth(anchor);
    m.setMonth(m.getMonth() + dir);
    // no mês de hoje, o dia escolhido é hoje; nos outros, o dia 1
    setAnchor(m.getMonth() === new Date(clock).getMonth() && m.getFullYear() === new Date(clock).getFullYear() ? startOfDay(clock).getTime() : m.getTime());
  };
  const pick = (day: number) => setAnchor(startOfDay(day).getTime());
  const closeCreate = () => setCreating(null);

  const noAccount = isTauri && connected === 0 && mailStatus !== "idle" && mailStatus !== "loading";
  const loading = !noAccount && (status === "loading" || (isTauri && connected === 0));
  const todayCount = eventsOnDay(events, clock).length;
  const [prevLabel, nextLabel] = mode === "day" ? ["Dia anterior", "Próximo dia"] : mode === "week" ? ["Semana anterior", "Próxima semana"] : ["Mês anterior", "Próximo mês"];

  return (
    <>
      <TopBar
        title="Calendário"
        sub={todayCount ? `${plural(todayCount, "compromisso", "compromissos")} hoje` : "Nenhum compromisso hoje"}
        searchPlaceholder="Buscar eventos e pessoas"
      />
      <div className="cal">
        <div className="toolbar cal-toolbar">
          <div className="cal-tb-main">
            <button className="btn glass ic" aria-label={prevLabel} data-tip="Anterior" onClick={() => step(-1)}>
              <ChevronLeft size={17} aria-hidden />
            </button>
            <button className="btn glass ic" aria-label={nextLabel} data-tip="Próximo" onClick={() => step(1)}>
              <ChevronRight size={17} aria-hidden />
            </button>
            <button className="btn glass lg" onClick={() => pick(clock)}>
              Hoje
            </button>
            <span className="cal-range" aria-live="polite">
              {rangeTitle(mode, anchor)}
            </span>
            {loading && (
              <span className="cal-status" role="status">
                <span className="spinning" style={{ display: "flex" }}>
                  <LoaderCircle size={14} aria-hidden />
                </span>
                Carregando agenda…
              </span>
            )}
            <button className="btn solid lg" onClick={() => setCreating({ day: anchor })}>
              <Plus size={17} aria-hidden />
              Novo evento
            </button>
          </div>
          <div className="cal-tb-side">
            <SliderGroup activeKey={mode} className="cal-views" role="group" label="Visão">
              {(
                [
                  ["day", "Dia"],
                  ["week", "Semana"],
                  ["month", "Mês"],
                ] as const
              ).map(([m, label]) => (
                <button key={m} className="pill" aria-pressed={mode === m} onClick={() => navigate({ name: "calendar", mode: m })}>
                  {label}
                </button>
              ))}
            </SliderGroup>
          </div>
        </div>
        <div className="cal-content">
          {mode === "day" && <DayView events={events} anchor={anchor} clock={clock} onPick={pick} />}
          {mode === "week" && <WeekView events={events} anchor={anchor} clock={clock} onPick={pick} />}
          {mode === "month" && (
            <MonthView
              events={events}
              anchor={anchor}
              clock={clock}
              onPick={pick}
              creating={creating?.cell ? creating : null}
              onCreate={(day) => setCreating({ day, cell: true })}
              onCloseCreate={closeCreate}
            />
          )}
          {creating && !creating.cell && (
            <QuickCreate key={creating.day} day={creating.day} className="cal-pop-new" style={{}} onClose={closeCreate} />
          )}
          {(noAccount || status === "error") && (
            <div className="cal-notice">
              <div className="card cal-notice-box" role={noAccount ? "status" : "alert"}>
                <CalendarDays size={20} aria-hidden />
                {noAccount ? (
                  <>
                    <p>Conecte uma conta Google em Ajustes para ver sua agenda aqui.</p>
                    <button className="btn solid sm" onClick={() => navigate({ name: "settings" })}>
                      Abrir Ajustes
                    </button>
                  </>
                ) : (
                  <>
                    <p>Não deu para carregar a agenda{error ? `: ${error}` : "."}</p>
                    <button className="btn glass sm" onClick={() => void reloadCalendar()}>
                      Tentar de novo
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

interface ViewProps {
  events: AgendaEvent[];
  anchor: number;
  clock: number;
  onPick: (day: number) => void;
}

/* ---------------- blocos comuns ---------------- */

function Times() {
  return (
    <div className="cal-times" aria-hidden>
      {Array.from({ length: HOURS - 1 }, (_, i) => i + 1).map((h) => (
        <span key={h} style={{ top: `calc(var(--hh) * ${h})` }}>
          {hourLabel(h)}
        </span>
      ))}
    </div>
  );
}

const isPending = (e: AgendaEvent) => e.myStatus === "needsAction";
const isDeclined = (e: AgendaEvent) => e.myStatus === "declined";

function eventLabel(e: AgendaEvent) {
  return `${e.title}, ${timeRange(e)}${isPending(e) ? ", convite sem resposta" : ""}${isDeclined(e) ? ", recusado" : ""}`;
}

/** Bolinhas das contas/agendas onde o mesmo evento aparece (só quando são várias). */
function CopyDots({ e, className = "cal-ev-accts" }: { e: AgendaEvent; className?: string }) {
  const map = calendarMap(useCalendar((s) => s.calendars));
  if (e.copies.length < 2) return null;
  return (
    <span className={className} aria-hidden>
      {e.copies.map((c) => (
        <i key={c.calendarKey} style={{ background: map.get(c.calendarKey)?.color ?? e.color }} />
      ))}
    </span>
  );
}

/** Cabeçalho do cartão: bolinha e nome de cada agenda onde o evento está. */
function CalendarsLabel({ e, suffix = "" }: { e: AgendaEvent; suffix?: string }) {
  const map = calendarMap(useCalendar((s) => s.calendars));
  const names = e.copies.map((c) => map.get(c.calendarKey)?.name).filter(Boolean);
  return (
    <>
      {e.copies.map((c) => (
        <span key={c.calendarKey} className="dot" style={{ background: map.get(c.calendarKey)?.color ?? e.color }} />
      ))}
      <span className="cal-pop-cals">
        {names.join(" · ") || "Agenda"}
        {suffix}
      </span>
    </>
  );
}

function EventBlock({ it, past, selected, onClick }: { it: Placed; past?: boolean; selected?: boolean; onClick: () => void }) {
  const e = it.ev;
  const short = it.dur <= 0.5;
  const style: Vars = {
    "--c": e.color,
    top: `calc(var(--hh) * ${it.top} + 1px)`,
    height: `calc(var(--hh) * ${it.dur} - 3px)`,
  };
  if (it.cols > 1) {
    style["--col"] = String(it.col);
    style["--cols"] = String(it.cols);
  }
  const cls = [
    "cal-ev",
    short && "short",
    it.cols > 1 && "split",
    past && "past",
    isPending(e) && "pending",
    isDeclined(e) && "declined",
    selected && "selected",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} style={style} onClick={onClick} aria-label={eventLabel(e)}>
      <span className="cal-ev-title">{e.title}</span>
      <span className="cal-ev-time">
        {short ? fmtTime(e.start) : timeRange(e)}
        {e.location && !short ? ` · ${e.location}` : ""}
      </span>
      {isPending(e) && !short && <span className="cal-ev-tag">Convite sem resposta</span>}
      <CopyDots e={e} />
    </button>
  );
}

function NowLine({ clock }: { clock: number }) {
  return <div className="cal-now" style={{ top: `calc(var(--hh) * ${hourOf(clock)})` }} aria-hidden />;
}

const TONES = ["peach", "neutral"] as const;
/** Iniciais do convidado; as minhas vêm do perfil da conta (como no avatar do canto). */
function useInitials() {
  const profiles = useMailbox((s) => s.profiles);
  return (p: Attendee) =>
    p.isSelf ? initialsOf(p.email || undefined, profiles[p.email]?.name) : initialsOf(p.email || undefined, p.name !== p.email ? p.name : undefined);
}
function tone(a: Attendee) {
  if (a.isSelf) return "blue";
  if (a.organizer) return "neutral";
  let h = 0;
  for (const ch of a.name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return TONES[Math.abs(h) % TONES.length];
}
const displayName = (a: Attendee) => (a.isSelf ? "Você" : a.name);

const STATUS_TEXT: Record<RsvpStatus, string> = {
  accepted: "Confirmou",
  tentative: "Talvez",
  declined: "Recusou",
  needsAction: "Sem resposta",
};

function Avatars({ people }: { people: Attendee[] }) {
  const initials = useInitials();
  return (
    <span className="cal-avatars" aria-hidden>
      {people.slice(0, 3).map((p) => (
        <span key={p.email || p.name} className={`av ${tone(p)}`}>
          {initials(p)}
        </span>
      ))}
    </span>
  );
}

const confirmed = (people: Attendee[]) => people.filter((p) => p.status === "accepted" && !p.organizer).length;
const organizerName = (e: AgendaEvent) => (e.organizer?.self ? "você" : (e.organizer?.name ?? e.organizer?.email));

function Calendars() {
  const calendars = useCalendar((s) => s.calendars);
  const hidden = useCalendar((s) => s.hidden);
  const accounts = useMailbox((s) => s.accounts);
  // agrupadas por conta, a principal primeiro
  const groups = useMemo(() => {
    const by = new Map<string, typeof calendars>();
    for (const c of calendars) by.set(c.account, [...(by.get(c.account) ?? []), c]);
    return [...by.entries()].map(([k, list]) => [k, list.toSorted((a, b) => Number(b.primary) - Number(a.primary))] as const);
  }, [calendars]);
  return (
    <section className="card cal-list" aria-label="Calendários">
      <div className="section-label">
        <CalendarDays size={14} aria-hidden />
        Calendários
      </div>
      <div style={{ marginTop: 8 }}>
        {calendars.length === 0 && <p className="cal-list-empty">Nenhuma agenda ainda.</p>}
        {groups.map(([account, list]) => (
          <div key={account} className="cal-list-group">
            {isTauri ? <div className="cal-list-account">{accounts.find((a) => a.id === account)?.id ?? account}</div> : null}
            {list.map((c) => {
              const on = !hidden.has(c.key);
              return (
                <button
                  key={c.key}
                  className="cal-check"
                  role="switch"
                  aria-checked={on}
                  onClick={() => toggleCalendar(c.key)}
                  style={{ "--c": c.color } as Vars}
                >
                  <span className="cal-box">{on && <Check size={12} aria-hidden />}</span>
                  <span className="cal-check-name">{isTauri && c.primary ? "Agenda principal" : c.name}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="cal-note">
        <Cloud size={14} aria-hidden />
        As agendas vêm das contas Google conectadas em Ajustes → Contas.
      </p>
    </section>
  );
}

function MiniMonth({ events, anchor, clock, onPick, highlightWeek }: ViewProps & { highlightWeek?: boolean }) {
  const [month, setMonth] = useState(() => firstOfMonth(anchor).getTime());
  // quando o dia escolhido muda (setas de cima, Hoje), o mini mês acompanha
  const [seen, setSeen] = useState(anchor);
  if (seen !== anchor) {
    setSeen(anchor);
    setMonth(firstOfMonth(anchor).getTime());
  }
  const gridStart = startOfWeek(month).getTime();
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const busy = useMemo(() => busyDays(events, gridStart, addDays(gridStart, 42).getTime()), [events, gridStart]);
  const weekStart = startOfWeek(anchor).getTime();
  const weekEnd = addDays(weekStart, 7).getTime();
  const current = new Date(month).getMonth();
  const title = `${cap(new Date(month).toLocaleDateString("pt-BR", { month: "long" }))} ${new Date(month).getFullYear()}`;
  const shift = (dir: number) => {
    const m = new Date(month);
    m.setMonth(m.getMonth() + dir);
    setMonth(m.getTime());
  };

  return (
    <section className="card cal-mini" aria-label={title}>
      <div className="cal-mini-head">
        <span className="cal-mini-title" aria-live="polite">
          {title}
        </span>
        <span>
          <button className="btn ic" aria-label="Mês anterior" data-tip="Mês anterior" onClick={() => shift(-1)}>
            <ChevronLeft size={15} aria-hidden />
          </button>
          <button className="btn ic" aria-label="Próximo mês" data-tip="Próximo mês" data-tip-pos="left" onClick={() => shift(1)}>
            <ChevronRight size={15} aria-hidden />
          </button>
        </span>
      </div>
      <div className="cal-mini-grid">
        {["S", "T", "Q", "Q", "S", "S", "D"].map((d, i) => (
          <span key={i} className="dow" aria-hidden>
            {d}
          </span>
        ))}
        {cells.map((d, i) => {
          const t = d.getTime();
          const today = sameDay(d, clock);
          const inWeek = highlightWeek && t >= weekStart && t < weekEnd;
          const cls = [
            d.getMonth() !== current && "out",
            inWeek && "in-week",
            inWeek && i % 7 === 0 && "week-start",
            inWeek && i % 7 === 6 && "week-end",
            today && "is-today",
            !highlightWeek && !today && sameDay(d, anchor) && "is-selected",
            !today && busy.has(t) && "has-events",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={t}
              className={cls}
              aria-label={dayLong(d)}
              aria-current={sameDay(d, anchor) ? "date" : undefined}
              onClick={() => onPick(t)}
            >
              {today ? <b>{d.getDate()}</b> : d.getDate()}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function EventDetails({ e, onClose }: { e: AgendaEvent; onClose?: () => void }) {
  const rsvp = useEventRsvp(e.key);
  const pending = isPending(e);
  const org = organizerName(e);
  return (
    <>
      <div className="cal-pop-head">
        <CalendarsLabel e={e} suffix={pending ? " · convite" : ""} />
        <span className="cal-pop-actions">
          <button className="btn ic" aria-label="Editar evento" data-tip="Editar">
            <Pencil size={15} aria-hidden />
          </button>
          <button className="btn ic" aria-label="Apagar evento" data-tip="Apagar">
            <Trash2 size={15} aria-hidden />
          </button>
          {onClose && (
            <button className="btn ic" aria-label="Fechar" data-tip="Fechar" onClick={onClose}>
              <X size={15} aria-hidden />
            </button>
          )}
        </span>
      </div>
      <div className="cal-pop-title">{e.title}</div>
      <div className="cal-pop-when">
        {dayLong(e.start)} · {timeRange(e)}
      </div>
      {e.location && e.location !== "Google Meet" && (
        <div className="cal-pop-row">
          <MapPin size={15} aria-hidden />
          <span className="cal-pop-text">{e.location}</span>
        </div>
      )}
      {e.meetUrl && <MeetRow url={e.meetUrl} />}
      {e.attendees.length > 0 && (
        <div className="cal-pop-row">
          <Users size={15} aria-hidden />
          {plural(e.attendees.length, "convidado", "convidados")} · {confirmed(e.attendees)} confirmaram
          <Avatars people={e.attendees} />
        </div>
      )}
      {org && (
        <div className="cal-pop-row">
          <User size={15} aria-hidden />
          Organizado por {org}
        </div>
      )}
      {(pending || rsvp.answer) && (
        <div className={rsvp.leaving ? "invite-leaving" : undefined}>
          <div className="cal-pop-q">Você vai?</div>
          <EventRsvpButtons rsvp={rsvp} size="sm" />
        </div>
      )}
    </>
  );
}

function MeetRow({ url }: { url: string }) {
  return (
    <div className="cal-pop-row">
      <Video size={15} aria-hidden />
      <a className="cal-pop-link" href={url} target="_blank" rel="noreferrer">
        {meetLabel(url)}
      </a>
      <button
        className="btn glass sm"
        onClick={() =>
          navigator.clipboard?.writeText(url).then(
            () => toast("Link copiado"),
            () => toast("Não deu para copiar o link", "error"),
          )
        }
      >
        Copiar
      </button>
    </div>
  );
}

/* ---------------- dia ---------------- */

function DayView(props: ViewProps) {
  const { events, anchor, clock } = props;
  const dayEvents = useMemo(() => eventsOnDay(events, anchor), [events, anchor]);
  const placed = useMemo(() => layoutDay(dayEvents, new Date(anchor)), [dayEvents, anchor]);
  const allDay = dayEvents.filter((e) => e.allDay);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const gridRef = useHourGrid();
  const isToday = sameDay(anchor, clock);
  // sem escolha: o próximo compromisso (ou o que está acontecendo agora)
  const selected =
    dayEvents.find((e) => e.key === selectedKey) ??
    placed.find((p) => p.ev.end > clock)?.ev ??
    placed[0]?.ev ??
    dayEvents[0];

  return (
    <>
      <section className="card cal-card" aria-label="Dia">
        <div className="cal-dayview">
          <div className="cal-dayline">
            <div className="cal-dayline-head">
              <span className="dow">{dowShort(anchor)}</span>
              <b className={isToday ? undefined : "not-today"}>{new Date(anchor).getDate()}</b>
              <span className="count">{plural(placed.length, "compromisso", "compromissos")}</span>
            </div>
            {allDay.length > 0 && (
              <div className="cal-dayallday">
                {allDay.map((e) => (
                  <button
                    key={e.key}
                    className={`cal-chip all${isDeclined(e) ? " declined" : ""}`}
                    style={{ "--c": e.color } as Vars}
                    onClick={() => setSelectedKey(e.key)}
                    aria-label={eventLabel(e)}
                  >
                    <span className="cal-chip-text">{e.title}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="cal-scroll" ref={gridRef}>
              <div className="cal-grid cal-oneday">
                <Times />
                <div className="cal-cols one">
                  <div className="cal-col">
                    {placed.map((p) => (
                      <EventBlock
                        key={p.ev.key}
                        it={p}
                        past={p.ev.end <= clock}
                        selected={p.ev.key === selected?.key}
                        onClick={() => setSelectedKey(p.ev.key)}
                      />
                    ))}
                  </div>
                  {isToday && <NowLine clock={clock} />}
                </div>
                {isToday && (
                  <span className="cal-now-label" style={{ top: `calc(var(--hh) * ${hourOf(clock)})` }} aria-hidden>
                    {fmtTime(clock)}
                  </span>
                )}
              </div>
            </div>
          </div>
          {selected ? (
            <DayDetail key={selected.key} e={selected} clock={clock} />
          ) : (
            <div className="cal-detail cal-detail-empty">
              <p>Nada marcado neste dia.</p>
            </div>
          )}
        </div>
      </section>
      <aside className="cal-side">
        <MiniMonth {...props} />
        <Calendars />
      </aside>
    </>
  );
}

const MINE_TEXT: Record<Exclude<RsvpStatus, "needsAction">, string> = {
  accepted: "Você confirmou presença",
  tentative: "Você respondeu talvez",
  declined: "Você recusou o convite",
};

function DayDetail({ e, clock }: { e: AgendaEvent; clock: number }) {
  const [changing, setChanging] = useState(false);
  const rsvp = useEventRsvp(e.key, () => setChanging(false));
  const startsIn = e.start > clock && sameDay(e.start, clock) ? Math.round((e.start - clock) / 60_000) : null;
  const map = calendarMap(useCalendar((s) => s.calendars));
  const initials = useInitials();
  const answering = isPending(e) || changing || !!rsvp.answer;
  const showMine = !!e.myStatus || e.attendees.some((a) => a.isSelf);

  return (
    <div className="cal-detail" aria-live="polite">
      <div className="cal-pop-head">
        <CalendarsLabel e={e} suffix={e.meetUrl ? " · Google Agenda" : ""} />
        <span className="cal-pop-actions">
          <button className="btn ic" aria-label="Editar evento" data-tip="Editar">
            <Pencil size={15} aria-hidden />
          </button>
          <button className="btn ic" aria-label="Apagar evento" data-tip="Apagar">
            <Trash2 size={15} aria-hidden />
          </button>
          <button className="btn ic" aria-label="Mais ações" data-tip="Mais ações">
            <Ellipsis size={15} aria-hidden />
          </button>
        </span>
      </div>
      <h2 className="cal-detail-title">{e.title}</h2>
      <div className="cal-pop-when">
        {sameDay(e.start, clock) ? "Hoje" : dayLong(e.start)} · {timeRange(e)}
        {e.recurring ? " · se repete" : ""}
      </div>
      {startsIn !== null && startsIn <= 60 && (
        <span className="cal-soon">
          <Clock size={13} aria-hidden />
          Começa em {startsIn} min
        </span>
      )}
      {e.meetUrl && (
        <a className="btn solid lg" href={e.meetUrl} target="_blank" rel="noreferrer">
          <Video size={17} aria-hidden />
          Entrar no Google Meet
        </a>
      )}
      {e.meetUrl && (
        <div className="cal-pop-row">
          <Video size={15} aria-hidden />
          <span className="cal-pop-text">{meetLabel(e.meetUrl)}</span>
        </div>
      )}
      {e.location && e.location !== "Google Meet" && (
        <div className="cal-pop-row">
          <MapPin size={15} aria-hidden />
          <span className="cal-pop-text">{e.location}</span>
        </div>
      )}
      {e.attendees.length > 0 && (
        <div className="cal-section">
          <div className="section-label">Participantes · {e.attendees.length}</div>
          {e.attendees.map((p) => (
            <div key={p.email || p.name} className="cal-person">
              <span className={`av ${tone(p)}`} aria-hidden>
                {initials(p)}
              </span>
              <span className="cal-person-name">{displayName(p)}</span>
              <span className={`cal-person-status${p.status === "accepted" && !p.organizer ? " ok" : ""}`}>
                {p.status === "accepted" && !p.organizer && <CircleCheck size={13} aria-hidden />}
                {p.organizer ? "Organizador" : STATUS_TEXT[p.status]}
              </span>
            </div>
          ))}
        </div>
      )}
      {e.description && (
        <div className="cal-section">
          <div className="section-label">Descrição</div>
          <p className="cal-desc">{e.description}</p>
        </div>
      )}
      {showMine && (
        <div className={`cal-section${rsvp.leaving ? " invite-leaving" : ""}`}>
          <div className="section-label">Sua resposta</div>
          {answering ? (
            <EventRsvpButtons rsvp={rsvp} size="sm" />
          ) : e.myStatus && e.myStatus !== "needsAction" ? (
            <div className={`cal-mine${e.myStatus === "declined" ? " no" : ""}`}>
              {e.myStatus === "declined" ? <X size={16} aria-hidden /> : <CircleCheck size={16} aria-hidden />}
              {MINE_TEXT[e.myStatus]}
              <button className="btn glass sm" onClick={() => setChanging(true)}>
                Mudar
              </button>
            </div>
          ) : null}
        </div>
      )}
      {e.copies.length > 1 && (
        <p className="cal-copies">
          <CopyDots e={e} className="cal-copies-dots" />
          Aparece em {e.copies.map((c) => map.get(c.calendarKey)?.name ?? c.account).join(", ")}
        </p>
      )}
    </div>
  );
}

/* ---------------- semana ---------------- */

function WeekView(props: ViewProps) {
  const { events, anchor, clock } = props;
  const weekStart = startOfWeek(anchor).getTime();
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const perDay = useMemo(() => days.map((d) => eventsOnDay(events, d)), [days, events]);
  const placed = useMemo(() => days.map((d, i) => layoutDay(perDay[i], d)), [days, perDay]);
  const [openKey, setOpenKey] = useState<string | null>(PREVIEW ? "q1" : null);
  const gridRef = useHourGrid();
  const weekEnd = addDays(weekStart, 7).getTime();
  const open = events.find((e) => e.key === openKey && e.start < weekEnd && e.end > weekStart) ?? null;
  const close = () => setOpenKey(null);
  useEscape(close, !!open);
  const todayStart = startOfDay(clock).getTime();
  const col = open ? days.findIndex((d) => sameDay(d, Math.max(open.start, weekStart))) : -1;
  const openTop = open && !open.allDay ? (open.start <= days[col].getTime() ? 0 : hourOf(open.start)) : 0;
  // o cartão abre ao lado do evento; perto da borda direita, abre à esquerda
  const popLeft = col >= 4 ? `calc(56px + (100% - 56px) * ${col} / 7 - 352px)` : `calc(56px + (100% - 56px) * ${col + 1} / 7 + 8px)`;

  return (
    <>
      <section className="card cal-card" aria-label="Semana">
        <div className="cal-weekhead">
          <div />
          {days.map((d) => (
            <div key={d.getTime()} className={`cal-dayhead${sameDay(d, clock) ? " is-today" : ""}`}>
              <span>{dowShort(d)}</span>
              <b>{d.getDate()}</b>
            </div>
          ))}
        </div>
        <div className="cal-allday">
          <div>dia todo</div>
          {days.map((d, i) => (
            <div key={d.getTime()}>
              {perDay[i]
                .filter((e) => e.allDay)
                .map((e) => (
                  <button
                    key={e.key}
                    className={`cal-chip all${isDeclined(e) ? " declined" : ""}`}
                    style={{ "--c": e.color } as Vars}
                    onClick={() => setOpenKey(e.key)}
                    aria-label={eventLabel(e)}
                  >
                    <span className="cal-chip-text">{e.title}</span>
                  </button>
                ))}
            </div>
          ))}
        </div>
        <div className="cal-scroll" ref={gridRef}>
          <div className="cal-grid">
            <Times />
            <div className="cal-cols">
              {days.map((d, i) => (
                <div key={d.getTime()} className={`cal-col${i >= 5 ? " weekend" : ""}`}>
                  {placed[i].map((p) => (
                    <EventBlock
                      key={p.ev.key}
                      it={p}
                      past={d.getTime() < todayStart || p.ev.end <= clock}
                      selected={p.ev.key === openKey}
                      onClick={() => setOpenKey(p.ev.key)}
                    />
                  ))}
                  {sameDay(d, clock) && <NowLine clock={clock} />}
                </div>
              ))}
            </div>
            {/* o cartão fica dentro da grade para rolar junto com o evento */}
            {open && !open.allDay && (
              <div
                className="cal-pop"
                role="dialog"
                aria-label={open.title}
                style={{ left: popLeft, top: `clamp(8px, calc(var(--hh) * ${openTop} - 40px), calc(var(--hh) * ${HOURS} - 380px))` }}
              >
                <EventDetails key={open.key} e={open} onClose={close} />
              </div>
            )}
          </div>
        </div>
        {open && open.allDay && (
          <div className="cal-pop" role="dialog" aria-label={open.title} style={{ left: popLeft, top: 96 }}>
            <EventDetails key={open.key} e={open} onClose={close} />
          </div>
        )}
      </section>
      <aside className="cal-side">
        <MiniMonth {...props} highlightWeek />
        <Calendars />
      </aside>
    </>
  );
}

/* ---------------- mês ---------------- */

function MonthView({
  creating,
  onCreate,
  onCloseCreate,
  ...props
}: ViewProps & { creating: Creating | null; onCreate: (day: number) => void; onCloseCreate: () => void }) {
  const { events, anchor, clock, onPick } = props;
  const month = firstOfMonth(anchor);
  const gridStart = startOfWeek(month).getTime();
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);
  const todayStart = startOfDay(clock).getTime();

  const cellIndex = creating ? cells.findIndex((d) => sameDay(d, creating.day)) : -1;
  const col = cellIndex % 7;
  const row = Math.floor(cellIndex / 7);

  return (
    <>
      <section className="card cal-card" aria-label="Mês">
        <div className="cal-monthhead">
          {["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="cal-month">
          {cells.map((d, i) => {
            const out = d.getMonth() !== month.getMonth();
            return (
              <MonthCell
                key={d.getTime()}
                day={d}
                out={out}
                weekend={i % 7 >= 5}
                today={d.getTime() === todayStart}
                past={d.getTime() < todayStart}
                events={out ? [] : eventsOnDay(events, d)}
                selected={!out && sameDay(d, anchor)}
                onClick={() => {
                  if (out) return;
                  onPick(d.getTime());
                  onCreate(d.getTime());
                }}
              />
            );
          })}
        </div>
        {creating && cellIndex >= 0 && (
          <QuickCreate
            key={creating.day}
            day={creating.day}
            initialTitle={creating.title}
            style={{
              left: `clamp(8px, calc(100% * ${col} / 7 + 100% / 14 - 172px), calc(100% - 352px))`,
              top: row >= 3 ? `calc(40px + (100% - 40px) * ${row - 3} / 6 + 8px)` : `calc(40px + (100% - 40px) * ${row + 1} / 6 + 8px)`,
            }}
            onClose={onCloseCreate}
          />
        )}
      </section>
      <aside className="cal-side">
        <DayAgenda day={anchor} clock={clock} events={eventsOnDay(events, anchor)} />
        <Calendars />
      </aside>
    </>
  );
}

function MonthCell({
  day,
  out,
  weekend,
  today,
  past,
  events,
  selected,
  onClick,
}: {
  day: Date;
  out: boolean;
  weekend: boolean;
  today: boolean;
  past: boolean;
  events: AgendaEvent[];
  selected: boolean;
  onClick: () => void;
}) {
  const allDay = events.filter((e) => e.allDay);
  const timed = events.filter((e) => !e.allDay);
  const limit = allDay.length ? 2 : 3;
  const shown = timed.slice(0, limit);
  const more = timed.length - shown.length;
  const n = day.getDate();
  const dow = (day.getDay() + 6) % 7;
  const monthName = day.toLocaleDateString("pt-BR", { month: "long" });
  return (
    <div
      className={`cal-cell${out ? " out" : ""}${weekend ? " weekend" : ""}${today ? " is-today" : ""}${selected ? " selected" : ""}`}
      role={out ? undefined : "button"}
      tabIndex={out ? -1 : 0}
      aria-label={out ? undefined : `${n} de ${monthName}, ${plural(events.length, "evento", "eventos")}. Criar evento`}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}
    >
      <span className="cal-daynum">{n === 1 ? `1 ${monthShort(day)}` : n}</span>
      {allDay.map((e) => {
        // faixa contínua; recomeça na segunda e termina no domingo quando atravessa a semana
        const first = startOfDay(e.start);
        const last = startOfDay(Math.max(e.start, e.end - 1));
        const multi = last.getTime() > first.getTime();
        const isFirst = sameDay(day, first) || dow === 0;
        const isLast = sameDay(day, last) || dow === 6;
        const bar = multi ? (isFirst && isLast ? "" : isFirst ? " bar-start" : isLast ? " bar-end" : " bar-mid") : "";
        return (
          <span key={e.key} className={`cal-chip all${bar}${isDeclined(e) ? " declined" : ""}`} style={{ "--c": e.color } as Vars}>
            <span className="cal-chip-text">{!multi || isFirst ? e.title : "\u00a0"}</span>
          </span>
        );
      })}
      {shown.map((e) => (
        <span
          key={e.key}
          className={`cal-chip${isPending(e) ? " pending" : ""}${e.key.startsWith("novo-") ? " new" : ""}${past ? " past" : ""}${isDeclined(e) ? " declined" : ""}`}
          style={{ "--c": e.color } as Vars}
        >
          <i />
          <span className="cal-chip-time">{e.start < startOfDay(day).getTime() ? "…" : fmtTime(e.start)}</span>
          <span className="cal-chip-text">{e.title}</span>
        </span>
      ))}
      {more > 0 && <span className="cal-chip more">+{more} mais</span>}
    </div>
  );
}

/* ---------------- criação rápida ---------------- */

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (h: number, m = 0) => `${pad(h)}:${pad(m)}`;
/** "2026-11-25" + "14:30" → Date local */
function toDate(date: string, time = "00:00") {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0);
}

function QuickCreate({
  day,
  initialTitle = "",
  style,
  className = "",
  onClose,
}: {
  day: number;
  initialTitle?: string;
  style: CSSProperties;
  className?: string;
  onClose: () => void;
}) {
  const cal = useCalendar((s) => s);
  const editable = useMemo(() => editableCalendars(cal), [cal.calendars]);
  const [title, setTitle] = useState(initialTitle);
  const [date, setDate] = useState(() => ymd(new Date(day)));
  // hoje: a próxima hora cheia; outros dias: 14h
  const [[initStart, initEnd]] = useState(() => {
    if (!sameDay(day, now())) return ["14:00", "15:00"];
    const h = Math.min(new Date(now()).getHours() + 1, 23);
    return [hm(h), h === 23 ? "23:59" : hm(h + 1)];
  });
  const [startT, setStartT] = useState(initStart);
  const [endT, setEndT] = useState(initEnd);
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [calendarKey, setCalendarKey] = useState("");
  const [saving, setSaving] = useState(false);
  useEscape(onClose, true);

  const key = editable.some((c) => c.key === calendarKey) ? calendarKey : (editable[0]?.key ?? "");
  const start = toDate(date, allDay ? "00:00" : startT);
  const end = toDate(date, allDay ? "00:00" : endT);
  const badTime = !allDay && end <= start;
  const canSave = !!title.trim() && !!key && !badTime && !saving;

  const changeStart = (v: string) => {
    // mantém a duração ao mudar o início
    const dur = toDate(date, endT).getTime() - toDate(date, startT).getTime();
    setStartT(v);
    const nextEnd = new Date(toDate(date, v).getTime() + Math.max(dur, 30 * 60_000));
    if (sameDay(nextEnd, toDate(date))) setEndT(hm(nextEnd.getHours(), nextEnd.getMinutes()));
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const created = await createEvent({ calendarKey: key, title: title.trim(), start, end, allDay, location: location.trim() || undefined });
    setSaving(false);
    if (created) onClose();
  };

  return (
    <div className={`cal-pop ${className}`} role="dialog" aria-label="Novo evento" style={style} onClick={(e) => e.stopPropagation()}>
      <div className="cal-pop-head">
        <CalendarPlus size={14} aria-hidden />
        Novo evento
        <span className="cal-pop-actions">
          <button className="btn ic" aria-label="Fechar" data-tip="Fechar" onClick={onClose}>
            <X size={15} aria-hidden />
          </button>
        </span>
      </div>
      <input
        className="cal-pop-input"
        autoFocus
        value={title}
        placeholder="Título do evento"
        aria-label="Título do evento"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void save()}
      />
      <div className="cal-pop-row">
        <Clock size={15} aria-hidden />
        <DatePicker label="Data" value={date} onChange={setDate} />
        <label className="cal-pop-allday">
          Dia todo
          <button className="toggle" role="switch" aria-checked={allDay} aria-label="Dia todo" onClick={() => setAllDay((v) => !v)} />
        </label>
      </div>
      {!allDay && (
        <div className="cal-pop-row cal-pop-times">
          <TimeSelect label="Começa às" value={startT} onChange={changeStart} />
          <span aria-hidden>–</span>
          <TimeSelect label="Termina às" value={endT} onChange={setEndT} invalid={badTime} />
          {badTime && (
            <span id="cal-new-time-err" className="cal-pop-err" role="alert">
              Termina antes de começar
            </span>
          )}
        </div>
      )}
      <div className="cal-pop-row">
        <CalendarDays size={15} aria-hidden />
        {editable.length > 0 ? (
          <Select
            size="sm"
            label="Agenda"
            value={key}
            onChange={setCalendarKey}
            options={editable.map((c) => ({ value: c.key, label: c.name, leading: <Dot color={c.color} /> }))}
          />
        ) : (
          <span className="muted">Conecte uma conta Google em Ajustes</span>
        )}
      </div>
      <div className="cal-pop-row">
        <MapPin size={15} aria-hidden />
        <input
          className="cal-pop-field cal-pop-place"
          value={location}
          placeholder="Adicionar local"
          aria-label="Local"
          onChange={(e) => setLocation(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
        />
      </div>
      <div className="cal-pop-row">
        <Users size={15} aria-hidden />
        <span className="muted">Convidar pessoas</span>
      </div>
      <div className="cal-pop-row">
        <Video size={15} aria-hidden />
        <span className="muted">Adicionar Google Meet</span>
      </div>
      <div className="cal-pop-row">
        <Bell size={15} aria-hidden />
        <span className="muted">Avisar 10 min antes</span>
      </div>
      <div className="cal-pop-foot">
        <a className="btn glass sm" href="https://calendar.google.com/calendar/r/eventedit" target="_blank" rel="noreferrer">
          Mais opções
        </a>
        <button className="btn solid sm" onClick={() => void save()} disabled={!canSave} style={!canSave ? { opacity: 0.5 } : undefined}>
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}

function DayAgenda({ day, clock, events }: { day: number; clock: number; events: AgendaEvent[] }) {
  const map = calendarMap(useCalendar((s) => s.calendars));
  const timed = events.filter((e) => !e.allDay);
  const isToday = sameDay(day, clock);
  return (
    <section className="card cal-agenda" aria-label={dayLong(day)}>
      <div className="cal-agenda-title">
        {dowLong(day).split("-")[0]}, {new Date(day).getDate()}
      </div>
      <div className="cal-agenda-sub">{plural(events.length, "compromisso", "compromissos")}</div>
      <ul>
        {events
          .filter((e) => e.allDay)
          .map((e) => (
            <li key={e.key} className={isDeclined(e) ? "declined" : undefined}>
              <span className="cal-agenda-time">dia</span>
              <span className="cal-agenda-dot" style={{ background: e.color }} aria-hidden />
              <span>
                <span className="cal-agenda-name" style={{ display: "block" }}>
                  {e.title}
                </span>
                <span className="cal-agenda-meta" style={{ display: "block" }}>
                  Dia inteiro
                </span>
              </span>
            </li>
          ))}
        {timed.map((e) => (
          <li
            key={e.key}
            className={[isToday && e.start > clock && e.start - clock < 30 * 60_000 && "soon", isDeclined(e) && "declined"].filter(Boolean).join(" ") || undefined}
          >
            <span className="cal-agenda-time">{fmtTime(e.start)}</span>
            <span className="cal-agenda-dot" style={{ background: e.color }} aria-hidden />
            <span>
              <span className="cal-agenda-name" style={{ display: "block" }}>
                {e.title}
              </span>
              <span className="cal-agenda-meta" style={{ display: "block" }}>
                {e.location ?? map.get(e.copies[0].calendarKey)?.name}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <button className="btn glass" onClick={() => navigate({ name: "calendar", mode: "day" })}>
        <CalendarDays size={15} aria-hidden />
        Ver o dia
      </button>
    </section>
  );
}
