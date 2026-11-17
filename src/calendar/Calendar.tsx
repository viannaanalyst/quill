import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import "./calendar.css";
import { TopBar } from "../components/TopBar";
import { RsvpButtons } from "../components/Rsvp";
import {
  Bell,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  Cloud,
  Ellipsis,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  User,
  Users,
  Video,
  X,
} from "../components/icons";
import { navigate, toggleCalendar, useStore, type CalendarMode } from "../state/store";
import {
  CALENDARS,
  CAL_COLOR,
  CAL_NAME,
  EVENTS,
  NOW,
  TODAY,
  dowLong,
  dowShort,
  fmtHour,
  weekdayOf,
  type CalEvent,
  type CalendarId,
} from "./events";

/** A grade mostra o dia inteiro (0h–24h). */
const H0 = 0;
const HOURS = 24;
/** Quantas horas cabem na tela, no mínimo; com janela alta cada hora cresce para preencher o espaço. */
const VISIBLE_HOURS = 13;
const MIN_HOUR_PX = 44;
/** Ao abrir, a grade começa às 7h30. */
const START_SCROLL_HOUR = 7.5;

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
const WEEK_DAYS = [16, 17, 18, 19, 20, 21, 22];
type Vars = CSSProperties & Record<`--${string}`, string>;

/** Eventos visíveis: respeita as agendas desligadas, a resposta ao convite e os eventos criados agora. */
function useVisibleEvents(created: CalEvent[]) {
  const hidden = useStore((s) => s.hiddenCalendars);
  const rsvp = useStore((s) => s.rsvp);
  return useMemo(() => {
    return [...EVENTS, ...created]
      .filter((e) => !hidden.has(e.calendar))
      .filter((e) => !(e.invite && rsvp.value === "declined" && rsvp.phase !== "idle"))
      .map((e) => (e.invite && rsvp.value && rsvp.value !== "declined" ? { ...e, invite: false } : e));
  }, [hidden, rsvp, created]);
}

const eventsOn = (events: CalEvent[], day: number) =>
  events.filter((e) => (e.endDay ? day >= e.day && day <= e.endDay : e.day === day));

function timeLabel(e: CalEvent) {
  if (e.allDay) return "Dia inteiro";
  return `${fmtHour(e.start!)} – ${fmtHour(e.end!)}`;
}

export default function Calendar({ mode }: { mode: CalendarMode }) {
  const [created, setCreated] = useState<CalEvent[]>([]);
  const events = useVisibleEvents(created);
  const todayCount = eventsOn(events, TODAY).length;

  const range = mode === "day" ? `${dowLong(TODAY)}, ${TODAY} de novembro de 2026` : mode === "week" ? "16 – 22 de novembro de 2026" : "Novembro de 2026";

  return (
    <>
      <TopBar title="Calendário" sub={`${todayCount} compromissos hoje`} searchPlaceholder="Buscar eventos e pessoas" />
      <div className="cal">
        <div className="toolbar">
          <button className="btn solid lg" onClick={() => navigate({ name: "calendar", mode: "month" })}>
            <Plus size={17} aria-hidden />
            Novo evento
          </button>
          <button className="btn glass lg">Hoje</button>
          <button className="btn glass ic" aria-label="Período anterior" data-tip="Anterior">
            <ChevronLeft size={17} aria-hidden />
          </button>
          <button className="btn glass ic" aria-label="Próximo período" data-tip="Próximo">
            <ChevronRight size={17} aria-hidden />
          </button>
          <span className="cal-range">{range}</span>
          <div className="cal-views" role="group" aria-label="Visão">
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
          </div>
        </div>
        <div className="cal-content">
          {mode === "day" && <DayView events={events} />}
          {mode === "week" && <WeekView events={events} />}
          {mode === "month" && <MonthView events={events} onCreate={(e) => setCreated((c) => [...c, e])} />}
        </div>
      </div>
    </>
  );
}

/* ---------------- blocos comuns ---------------- */

function Times() {
  return (
    <div className="cal-times" aria-hidden>
      {Array.from({ length: HOURS - 1 }, (_, i) => H0 + 1 + i).map((h) => (
        <span key={h} style={{ top: `calc(var(--hh) * ${h - H0})` }}>
          {fmtHour(h)}
        </span>
      ))}
    </div>
  );
}

function EventBlock({
  e,
  past,
  selected,
  onClick,
}: {
  e: CalEvent;
  past?: boolean;
  selected?: boolean;
  onClick: () => void;
}) {
  const short = e.end! - e.start! <= 0.5;
  const style: Vars = {
    "--c": CAL_COLOR[e.calendar],
    top: `calc(var(--hh) * ${e.start! - H0} + 1px)`,
    height: `calc(var(--hh) * ${e.end! - e.start!} - 3px)`,
  };
  return (
    <button
      className={`cal-ev${short ? " short" : ""}${past ? " past" : ""}${e.invite ? " pending" : ""}${selected ? " selected" : ""}`}
      style={style}
      onClick={onClick}
      aria-label={`${e.title}, ${timeLabel(e)}${e.invite ? ", convite sem resposta" : ""}`}
    >
      <span className="cal-ev-title">{e.title}</span>
      <span className="cal-ev-time">
        {short ? fmtHour(e.start!) : timeLabel(e)}
        {e.place && !short ? ` · ${e.place}` : ""}
      </span>
      {e.invite && !short && <span className="cal-ev-tag">Convite sem resposta</span>}
    </button>
  );
}

function NowLine({ label }: { label?: boolean }) {
  const top = `calc(var(--hh) * ${NOW - H0})`;
  return (
    <>
      <div className="cal-now" style={{ top }} aria-hidden />
      {label && (
        <span className="cal-now-label" style={{ top }} aria-hidden>
          {fmtHour(NOW)}
        </span>
      )}
    </>
  );
}

function Avatars({ people }: { people: NonNullable<CalEvent["people"]> }) {
  return (
    <span className="cal-avatars" aria-hidden>
      {people.slice(0, 3).map((p) => (
        <span key={p.initials} className={`av ${p.tone}`}>
          {p.initials}
        </span>
      ))}
    </span>
  );
}

function Calendars() {
  const hidden = useStore((s) => s.hiddenCalendars);
  return (
    <section className="card cal-list" aria-label="Calendários">
      <div className="section-label">
        <CalendarDays size={14} aria-hidden />
        Calendários
      </div>
      <div style={{ marginTop: 8 }}>
        {CALENDARS.map((c) => {
          const on = !hidden.has(c.id);
          return (
            <button
              key={c.id}
              className="cal-check"
              role="switch"
              aria-checked={on}
              onClick={() => toggleCalendar(c.id)}
              style={{ "--c": CAL_COLOR[c.id] } as Vars}
            >
              <span className="cal-box">{on && <Check size={12} aria-hidden />}</span>
              {c.name}
              <span className="cal-check-sub">{c.provider}</span>
            </button>
          );
        })}
      </div>
      <p className="cal-note">
        <Cloud size={14} aria-hidden />
        As agendas vêm das contas que o Mac já tem em Ajustes → Contas de Internet.
      </p>
    </section>
  );
}

function MiniMonth({ highlightWeek, events }: { highlightWeek?: boolean; events: CalEvent[] }) {
  const busy = new Set(events.map((e) => e.day));
  const cells: { n: number; out?: boolean }[] = [];
  for (let i = 26; i <= 31; i++) cells.push({ n: i, out: true });
  for (let i = 1; i <= 30; i++) cells.push({ n: i });
  for (let i = 1; i <= 6; i++) cells.push({ n: i, out: true });
  return (
    <section className="card cal-mini" aria-label="Novembro de 2026">
      <div className="cal-mini-head">
        <span className="cal-mini-title">Novembro 2026</span>
        <span>
          <button className="btn ic" aria-label="Mês anterior" data-tip="Mês anterior">
            <ChevronLeft size={15} aria-hidden />
          </button>
          <button className="btn ic" aria-label="Próximo mês" data-tip="Próximo mês">
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
        {cells.map((c, i) => {
          const inWeek = !c.out && highlightWeek && c.n >= 16 && c.n <= 22;
          const cls = [
            c.out && "out",
            inWeek && "in-week",
            inWeek && c.n === 16 && "week-start",
            inWeek && c.n === 22 && "week-end",
            !c.out && c.n === TODAY && "is-today",
            !c.out && c.n !== TODAY && busy.has(c.n) && "has-events",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <span key={i} className={cls}>
              {!c.out && c.n === TODAY ? <b>{c.n}</b> : c.n}
            </span>
          );
        })}
      </div>
    </section>
  );
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

function EventDetails({ e, onClose }: { e: CalEvent; onClose?: () => void }) {
  return (
    <>
      <div className="cal-pop-head">
        <span className="dot" style={{ background: CAL_COLOR[e.calendar] }} />
        {CAL_NAME[e.calendar]}
        {e.invite ? " · convite" : ""}
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
        {dowLong(e.day)}, {e.day} de novembro · {timeLabel(e)}
      </div>
      {e.place && e.place !== "Google Meet" && (
        <div className="cal-pop-row">
          <MapPin size={15} aria-hidden />
          {e.place}
        </div>
      )}
      {e.meet && (
        <div className="cal-pop-row">
          <Video size={15} aria-hidden />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.meet}</span>
          <button className="btn glass sm" onClick={() => navigator.clipboard?.writeText(e.meet!)}>Copiar</button>
        </div>
      )}
      {e.people && (
        <div className="cal-pop-row">
          <Users size={15} aria-hidden />
          {e.people.length} convidados · {e.people.filter((p) => p.ok).length} confirmaram
          <Avatars people={e.people} />
        </div>
      )}
      {e.people && (
        <div className="cal-pop-row">
          <User size={15} aria-hidden />
          Organizado por {e.people[0].name}
        </div>
      )}
      {e.invite && (
        <>
          <div className="cal-pop-q">Você vai?</div>
          <RsvpButtons size="sm" />
        </>
      )}
    </>
  );
}

/* ---------------- dia ---------------- */

function DayView({ events }: { events: CalEvent[] }) {
  const today = eventsOn(events, TODAY).filter((e) => !e.allDay);
  const [selectedId, setSelectedId] = useState("daily-17");
  const gridRef = useHourGrid();
  const selected = today.find((e) => e.id === selectedId) ?? today[0];

  return (
    <>
      <section className="card cal-card" aria-label="Dia">
        <div className="cal-dayview">
          <div className="cal-dayline">
            <div className="cal-dayline-head">
              <span className="dow">{dowShort(TODAY)}</span>
              <b>{TODAY}</b>
              <span className="count">{today.length} compromissos</span>
            </div>
            <div className="cal-scroll" ref={gridRef}>
              <div className="cal-grid cal-oneday">
                <Times />
                <div className="cal-cols one">
                  <div className="cal-col">
                    {today.map((e) => (
                      <EventBlock key={e.id} e={e} past={e.end! <= NOW} selected={e.id === selected?.id} onClick={() => setSelectedId(e.id)} />
                    ))}
                  </div>
                  <NowLine />
                </div>
                <span className="cal-now-label" style={{ top: `calc(var(--hh) * ${NOW - H0})` }} aria-hidden>
                  {fmtHour(NOW)}
                </span>
              </div>
            </div>
          </div>
          {selected && <DayDetail e={selected} />}
        </div>
      </section>
      <aside className="cal-side">
        <MiniMonth events={events} />
        <Calendars />
      </aside>
    </>
  );
}

function DayDetail({ e }: { e: CalEvent }) {
  const startsIn = e.start! > NOW && e.day === TODAY ? Math.round((e.start! - NOW) * 60) : null;
  return (
    <div className="cal-detail" aria-live="polite">
      <div className="cal-pop-head">
        <span className="dot" style={{ background: CAL_COLOR[e.calendar] }} />
        {CAL_NAME[e.calendar]}
        {e.meet ? " · Google Agenda" : ""}
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
        Hoje · {timeLabel(e)}
        {e.id.startsWith("daily") ? " · repete de segunda a sexta" : ""}
      </div>
      {startsIn !== null && startsIn <= 60 && (
        <span className="cal-soon">
          <Clock size={13} aria-hidden />
          Começa em {startsIn} min
        </span>
      )}
      {e.meet && (
        <button className="btn solid lg">
          <Video size={17} aria-hidden />
          Entrar no Google Meet
        </button>
      )}
      {e.meet && (
        <div className="cal-pop-row">
          <Video size={15} aria-hidden />
          {e.meet}
        </div>
      )}
      {e.place && !e.meet && (
        <div className="cal-pop-row">
          <MapPin size={15} aria-hidden />
          {e.place}
        </div>
      )}
      {e.people && (
        <div className="cal-section">
          <div className="section-label">Participantes · {e.people.length}</div>
          {e.people.map((p) => (
            <div key={p.initials} className="cal-person">
              <span className={`av ${p.tone}`} aria-hidden>
                {p.initials}
              </span>
              {p.name}
              <span className={`cal-person-status${p.ok ? " ok" : ""}`}>
                {p.ok && <CircleCheck size={13} aria-hidden />}
                {p.status}
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
      {e.people && (
        <div className="cal-section">
          <div className="section-label">Sua resposta</div>
          <div className="cal-mine">
            <CircleCheck size={16} aria-hidden />
            Você confirmou presença
            <button className="btn glass sm">Mudar</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- semana ---------------- */

function WeekView({ events }: { events: CalEvent[] }) {
  const [openId, setOpenId] = useState<string | null>("q1");
  const gridRef = useHourGrid();
  const open = events.find((e) => e.id === openId) ?? null;
  const close = () => setOpenId(null);
  useEscape(close, !!open);
  const col = open ? WEEK_DAYS.indexOf(open.day) : -1;
  // o cartão abre ao lado do evento; perto da borda direita, abre à esquerda
  const popLeft = col >= 4 ? `calc(56px + (100% - 56px) * ${col} / 7 - 352px)` : `calc(56px + (100% - 56px) * ${col + 1} / 7 + 8px)`;

  return (
    <>
      <section className="card cal-card" aria-label="Semana">
        <div className="cal-weekhead">
          <div />
          {WEEK_DAYS.map((d) => (
            <div key={d} className={`cal-dayhead${d === TODAY ? " is-today" : ""}`}>
              <span>{dowShort(d)}</span>
              <b>{d}</b>
            </div>
          ))}
        </div>
        <div className="cal-allday">
          <div>dia todo</div>
          {WEEK_DAYS.map((d) => (
            <div key={d}>
              {eventsOn(events, d)
                .filter((e) => e.allDay)
                .map((e) => (
                  <button key={e.id} className="cal-chip all" style={{ "--c": CAL_COLOR[e.calendar] } as Vars} onClick={() => setOpenId(e.id)}>
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
              {WEEK_DAYS.map((d) => (
                <div key={d} className={`cal-col${weekdayOf(d) >= 5 ? " weekend" : ""}`}>
                  {eventsOn(events, d)
                    .filter((e) => !e.allDay)
                    .map((e) => (
                      <EventBlock
                        key={e.id}
                        e={e}
                        past={d < TODAY || (d === TODAY && e.end! <= NOW)}
                        selected={e.id === openId}
                        onClick={() => setOpenId(e.id)}
                      />
                    ))}
                  {d === TODAY && <NowLine />}
                </div>
              ))}
            </div>
            {/* o cartão fica dentro da grade para rolar junto com o evento */}
            {open && !open.allDay && (
              <div className="cal-pop" role="dialog" aria-label={open.title} style={{ left: popLeft, top: `max(8px, calc(var(--hh) * ${open.start! - H0} - 40px))` }}>
                <EventDetails e={open} onClose={close} />
              </div>
            )}
          </div>
        </div>
        {open && open.allDay && (
          <div className="cal-pop" role="dialog" aria-label={open.title} style={{ left: popLeft, top: 96 }}>
            <EventDetails e={open} onClose={close} />
          </div>
        )}
      </section>
      <aside className="cal-side">
        <MiniMonth highlightWeek events={events} />
        <Calendars />
      </aside>
    </>
  );
}

/* ---------------- mês ---------------- */

const MONTH_CELLS = (() => {
  const cells: { n: number; out?: boolean }[] = [];
  for (let i = 26; i <= 31; i++) cells.push({ n: i, out: true });
  for (let i = 1; i <= 30; i++) cells.push({ n: i });
  for (let i = 1; i <= 6; i++) cells.push({ n: i, out: true });
  return cells;
})();

function MonthView({ events, onCreate }: { events: CalEvent[]; onCreate: (e: CalEvent) => void }) {
  const [selectedDay, setSelectedDay] = useState(TODAY);
  const [creatingDay, setCreatingDay] = useState<number | null>(25);
  const close = () => setCreatingDay(null);
  useEscape(close, creatingDay !== null);

  const cellIndex = creatingDay ? MONTH_CELLS.findIndex((c) => !c.out && c.n === creatingDay) : -1;
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
          {MONTH_CELLS.map((c, i) => (
            <MonthCell
              key={i}
              cell={c}
              weekend={i % 7 >= 5}
              events={c.out ? [] : eventsOn(events, c.n)}
              selected={!c.out && c.n === selectedDay}
              onClick={() => {
                if (c.out) return;
                setSelectedDay(c.n);
                setCreatingDay(c.n);
              }}
            />
          ))}
        </div>
        {creatingDay !== null && (
          <QuickCreate
            key={creatingDay}
            day={creatingDay}
            style={{
              left: `clamp(8px, calc(100% * ${col} / 7 + 100% / 14 - 172px), calc(100% - 352px))`,
              top: row >= 3 ? `calc(40px + (100% - 40px) * ${row - 3} / 6 + 8px)` : `calc(40px + (100% - 40px) * ${row + 1} / 6 + 8px)`,
            }}
            onClose={close}
            onSave={(e) => {
              onCreate(e);
              close();
            }}
          />
        )}
      </section>
      <aside className="cal-side">
        <DayAgenda day={selectedDay} events={eventsOn(events, selectedDay)} />
        <Calendars />
      </aside>
    </>
  );
}

function MonthCell({
  cell,
  weekend,
  events,
  selected,
  onClick,
}: {
  cell: { n: number; out?: boolean };
  weekend: boolean;
  events: CalEvent[];
  selected: boolean;
  onClick: () => void;
}) {
  const allDay = events.filter((e) => e.allDay);
  const timed = events.filter((e) => !e.allDay).sort((a, b) => a.start! - b.start!);
  const cap = allDay.length ? 2 : 3;
  const shown = timed.slice(0, cap);
  const more = timed.length - shown.length;
  const past = !cell.out && cell.n < TODAY;
  return (
    <div
      className={`cal-cell${cell.out ? " out" : ""}${weekend ? " weekend" : ""}${!cell.out && cell.n === TODAY ? " is-today" : ""}${selected ? " selected" : ""}`}
      role={cell.out ? undefined : "button"}
      tabIndex={cell.out ? -1 : 0}
      aria-label={cell.out ? undefined : `${cell.n} de novembro, ${events.length} eventos. Criar evento`}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}
    >
      <span className="cal-daynum">{cell.n === 1 && !cell.out ? "1 nov" : cell.n === 1 ? "1 dez" : cell.n}</span>
      {allDay.map((e) => {
        // faixa contínua; recomeça na segunda e termina no domingo quando atravessa a semana
        const isFirst = cell.n === e.day || weekdayOf(cell.n) === 0;
        const isLast = cell.n === e.endDay || weekdayOf(cell.n) === 6;
        const bar = e.endDay ? (isFirst && isLast ? "" : isFirst ? " bar-start" : isLast ? " bar-end" : " bar-mid") : "";
        return (
          <span key={e.id} className={`cal-chip all${bar}`} style={{ "--c": CAL_COLOR[e.calendar] } as Vars}>
            <span className="cal-chip-text">{!e.endDay || cell.n === e.day ? e.title : " "}</span>
          </span>
        );
      })}
      {shown.map((e) => (
        <span
          key={e.id}
          className={`cal-chip${e.invite ? " pending" : ""}${e.id.startsWith("new-") ? " new" : ""}${past ? " past" : ""}`}
          style={{ "--c": CAL_COLOR[e.calendar] } as Vars}
        >
          <i />
          <span className="cal-chip-time">{fmtHour(e.start!)}</span>
          <span className="cal-chip-text">{e.title}</span>
        </span>
      ))}
      {more > 0 && <span className="cal-chip more">+{more} mais</span>}
    </div>
  );
}

function QuickCreate({
  day,
  style,
  onClose,
  onSave,
}: {
  day: number;
  style: CSSProperties;
  onClose: () => void;
  onSave: (e: CalEvent) => void;
}) {
  const [title, setTitle] = useState(day === 25 ? "Reunião com a gráfica" : "");
  const [calendar, setCalendar] = useState<CalendarId>("inchurch");
  const [allDay, setAllDay] = useState(false);
  const save = () =>
    title.trim() &&
    onSave({
      id: `new-${Date.now()}`,
      day,
      start: allDay ? undefined : 14,
      end: allDay ? undefined : 15,
      allDay,
      title: title.trim(),
      calendar,
    });

  return (
    <div className="cal-pop" role="dialog" aria-label="Novo evento" style={style} onClick={(e) => e.stopPropagation()}>
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
        onKeyDown={(e) => e.key === "Enter" && save()}
      />
      <div className="cal-pop-row">
        <Clock size={15} aria-hidden />
        {dowShort(day)}, {day} nov{allDay ? " · dia inteiro" : " · 14:00 – 15:00"}
        <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink3)" }}>
          Dia todo
          <button className="toggle" role="switch" aria-checked={allDay} aria-label="Dia todo" onClick={() => setAllDay((v) => !v)} />
        </label>
      </div>
      <div className="cal-pop-row">
        <CalendarDays size={15} aria-hidden />
        <span className="cal-select">
          <i style={{ background: CAL_COLOR[calendar] }} />
          {CAL_NAME[calendar]}
          <ChevronDown size={13} aria-hidden style={{ color: "var(--ink3)" }} />
          <select aria-label="Agenda" value={calendar} onChange={(e) => setCalendar(e.target.value as CalendarId)}>
            {CALENDARS.filter((c) => c.id !== "feriado").map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="cal-pop-row">
        <MapPin size={15} aria-hidden />
        <span className="muted">Adicionar local</span>
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
        <button className="btn glass sm">Mais opções</button>
        <button className="btn solid sm" onClick={save} disabled={!title.trim()} style={!title.trim() ? { opacity: 0.5 } : undefined}>
          Salvar
        </button>
      </div>
    </div>
  );
}

function DayAgenda({ day, events }: { day: number; events: CalEvent[] }) {
  const timed = events.filter((e) => !e.allDay).sort((a, b) => a.start! - b.start!);
  return (
    <section className="card cal-agenda" aria-label={`${day} de novembro`}>
      <div className="cal-agenda-title">
        {dowLong(day).split("-")[0]}, {day}
      </div>
      <div className="cal-agenda-sub">
        {events.length} {events.length === 1 ? "compromisso" : "compromissos"}
      </div>
      <ul>
        {events
          .filter((e) => e.allDay)
          .map((e) => (
            <li key={e.id}>
              <span className="cal-agenda-time">dia</span>
              <span className="cal-agenda-dot" style={{ background: CAL_COLOR[e.calendar] }} aria-hidden />
              <span>
                <span className="cal-agenda-name" style={{ display: "block" }}>{e.title}</span>
                <span className="cal-agenda-meta" style={{ display: "block" }}>Dia inteiro</span>
              </span>
            </li>
          ))}
        {timed.map((e) => (
          <li key={e.id} className={day === TODAY && e.start! > NOW && e.start! - NOW < 0.5 ? "soon" : undefined}>
            <span className="cal-agenda-time">{fmtHour(e.start!)}</span>
            <span className="cal-agenda-dot" style={{ background: CAL_COLOR[e.calendar] }} aria-hidden />
            <span>
              <span className="cal-agenda-name" style={{ display: "block" }}>{e.title}</span>
              <span className="cal-agenda-meta" style={{ display: "block" }}>
                {e.place ?? CAL_NAME[e.calendar]}
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
